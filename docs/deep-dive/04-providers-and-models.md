# 04 — Providers, Routing & Models

> How AI Studio stays "model-agnostic." Source: `packages/providers`, `packages/tokenizer`. This is where "it supports multiple LLM providers — how?" gets answered.

## The big idea

Every LLM provider (Anthropic, OpenAI, Google/Gemini, Codex/ChatGPT-OAuth, plus a dozen OpenAI-compatible hosts) is hidden behind **one interface**, and a **Router** picks the right provider for a given model id and handles retries. The rest of the app never knows which vendor it's talking to — it just says "run model `claude-sonnet-5`" and the router figures out the rest.

## The base interface (`base.ts`)

Every provider implements the same tiny contract:

```ts
interface Provider {
  call(model, messages, system, tools?, signal?)   // buffered — returns {text, toolCalls, usage}
  stream(model, messages, system, tools?, signal?)  // incremental — async generator of StreamEvent
  listModels?()                                     // OPTIONAL
}
```

- `call` vs `stream`: buffered vs token-by-token. (Codex actually implements `call` by just draining its own `stream` — one code path.)
- `listModels` is optional *on purpose* — some providers (Codex) don't have a reliable public model catalogue, so the router treats "no listModels" and "listModels threw" identically: keep a hardcoded fallback list.

**The neutral message type** (`ProviderMessage`) has a `content` that's *either a plain string or an ordered array of content blocks.* Text-only turns (the common case) stay plain strings and pass straight through — an optimization, not just a type.

### Content blocks: one neutral shape, five wire formats

Messages can carry `text`, `image`, and `document` (PDF) blocks. Each provider family has a pure converter that maps these neutral blocks into that vendor's exact wire shape:

| Converter | Images | Documents/PDF |
|---|---|---|
| Anthropic | native `image` base64 source | **native `document` block** (Claude reads PDF layout/tables) |
| Google/Gemini | `inline_data` | `inline_data` — *same shape as images* (Gemini reads PDFs natively) |
| OpenAI (chat) | `image_url` data URL | **degrades to a text placeholder** |
| OpenAI Responses (Codex) | `input_image` | degrades to `input_text` placeholder |
| Bedrock Converse | `image` + format token | native `document` block (name sanitized) |

Two things worth calling out:
- **Documents degrade legibly, never 400.** If a model can't take a PDF, the block becomes `"[Attached document: … — not viewable on this model.]"` instead of erroring. A capability gate (`supportsPdfInput`) is *supposed* to prevent a document block ever reaching a non-supporting model — the text fallback is the "the gate was wrong" safety net.
- **Bedrock name sanitization** — Converse rejects most non-alphanumeric characters in document names, so `"Q3 Report.pdf"` → `"Q3 Report pdf"`.

Cloud providers **compose rather than duplicate**: Azure and Cloudflare wrap an inner `OpenAICompatibleProvider` and just override the URL/auth, instead of reimplementing SSE parsing. Bedrock is the exception — it hand-rolls **AWS SigV4** signing because it can't use a Bearer token.

## The Router (`router.ts`)

### Model resolution — first-match-wins by prefix

The router holds an ordered list of provider entries, each with a set of `prefixes`. Resolution is literally `entries.find(e => e.prefixes.some(p => model.startsWith(p)))`. **Registration order is therefore semantically significant.** Three routing modes:

1. **Native-prefix** (default) — prefixes are model families like `["claude"]`, `["gemini"]`, `["gpt-4", "o1", "o3"]`.
2. **Namespaced** — multi-vendor hosts like Groq: prefix `["groq/"]`, and the `"groq/"` is stripped before the real API call.
3. **Exact-id** — OpenRouter: the prefixes *are* the exact model-id list from the last catalogue fetch.

The ordering payoff: OpenRouter's exact ids (like `"nvidia/…:free"`) are registered **before** the `"nvidia/"` namespace catch-all, so first-match-wins picks the right one. That coupling between an *ordering* and *correctness* is a good thing to be able to explain.

### Retry & fallback

- Max 3 retries with **exponential backoff** (1s → 2s → 4s).
- Only retries on **retryable errors** — classified by string-matching the error message against `429|rate limit`, `5xx`, or network errors (`ECONNRESET`, `fetch failed`, etc.). This works because every adapter throws a uniformly-formatted `` `Provider ${status}: ${body}` ``.
- **Abort short-circuits retries** — if the user cancelled, it throws immediately instead of retrying a request nobody's waiting for.
- Note: "fallback" here means *retry the same provider* and *fall back to the hardcoded model list* — there is **no** silent cross-provider fallback. (Honest nuance to mention.)

### The model cache and the "never zero models" invariant

- Model catalogues are cached at **module level** with a 1-hour TTL. This matters because the app **rebuilds the Router on every config change** (e.g. an org key edit) — a naive design would re-hit every `/models` endpoint each time. The shared cache avoids the network storm, and a still-warm cache is applied *immediately* on registration so a selected model never briefly fails to resolve during the async refresh gap.
- `refreshModels` guarantees it **never throws and never leaves a provider with zero models.** Three failure modes — no `listModels`, it throws, or it returns empty — all collapse to "keep the hardcoded fallback." Backed by dedicated tests.

### Per-org API keys — the settings cascade

`Router.fromEnv(keyOverrides?)` is the composition root. It loads the global config keys, then layers per-org overrides on top where **only non-empty values win** (so an org can override *some* keys and inherit the rest). The main process caches one router per org and invalidates it when keys change. This is the concrete implementation of the **global → org → project** settings cascade — built once here, meant to be reused for future scopes.

## Codex OAuth (the interesting one)

Codex is ChatGPT access via **OAuth, not an API key** — it impersonates the official Codex CLI. This is genuinely clever reverse-engineering and a great thing to walk through:

1. **PKCE authorization-code flow.** Generate a code verifier + SHA-256 challenge + random state, spin up a **local loopback HTTP server on port 1455** to catch the redirect, open the system browser to `auth.openai.com/oauth/authorize` with Codex-specific params, and on callback validate `state` and exchange the code for tokens.
2. **Reads account id/email by manually decoding the JWT** — splitting on `.`, base64url-decoding the payload, and probing several possible claim locations (different account tiers put it in different places). No signature check — it's just reading claims from a token received over TLS.
3. **Token refresh with a mutex** — if a refresh is already in flight, concurrent callers await the *same* promise instead of firing parallel refreshes that would race on the rotating refresh token.
4. **The model list hits an undocumented endpoint** (`chatgpt.com/backend-api/codex/models`) and — critically — **deliberately does NOT trigger interactive login.** Because model-listing runs from a background startup refresh, a login popup there would be terrible UX. Signed out → throw → router keeps the fallback list. On a 401 it does one silent refresh + retry.
5. Uses the **OpenAI Responses API** shape (not chat completions) and deliberately omits `max_output_tokens` (the Codex backend rejects it).

The whole thing is tested with an **in-memory fake filesystem** so tests never touch the real `~/.ai-studio/auth.json`.

## Streaming

All providers share a skeleton: `fetch` with `stream: true`, read the body reader, decode with a **line-buffering pattern** (`buf += chunk; lines = buf.split("\n"); buf = lines.pop()` — keeps the trailing partial line), parse SSE `data:` frames, terminate on `[DONE]`. The unified stream vocabulary is `text | tool_call | tool_call_streaming | usage`.

Two real-world stream failure modes handled (good "edge case" material):
- **OpenRouter can emit an error frame inside a 200 response** (free-tier upstream rate-limits mid-stream). A naive reader would silently end with zero tokens; instead it detects `chunk.error` and *throws*, so the retry logic sees a real exception. On 429 it throws a typed `ProviderRateLimitError` carrying `retryAfterSeconds` so the UI can show a countdown toast.
- **Codex races the read against the abort signal** (`abortableRead`) so a hung read can't block cancellation — more robust than just passing `signal` to `fetch`.

## Tokenizer package

Small, pure, three concerns:

1. **Token counting** — `estimateTokens` uses tiktoken's `cl100k_base` encoding via a lazily-created singleton. Honest naming: it's an *estimate* — cl100k is OpenAI's tokenizer applied uniformly, so it's approximate for Claude/Gemini — a natural trade-off question, and the answer is "good enough for budgeting, and avoids shipping three tokenizers."
2. **Context limits** — a prefix→limit map (claude 190k, gemini 900k, gpt 120k…), intentionally conservative (Claude's true 200k → 190k) to leave response headroom.
3. **Capability predicates** — `supportsVision` and `supportsPdfInput`, both **conservative**: unknown model → `false`. The rationale is asymmetric risk: a false negative just nudges a model switch, but a false positive ships unsupported content and 400s. `supportsPdfInput` is deliberately narrow (only Claude + Gemini read PDFs natively) — it's the exact gate deciding whether the app sends a real PDF block or falls back to extracted text.

## Quick "drill-in" answers

- **"What happens if a provider is down?"** Retry 3× with backoff on retryable errors; abort cancels retries; model list falls back to hardcoded. No cross-provider auto-failover (deliberate — silent model swaps surprise users).
- **"How do you add a new provider?"** Implement the 2-3 method `Provider` interface + a converter, register it in `Router.fromEnv` with its prefixes at the right position in the order. Azure/Cloudflare show you can often just wrap the OpenAI-compatible base.
- **"How is Codex free of an API key?"** OAuth PKCE against ChatGPT, impersonating the Codex CLI, tokens cached locally, refreshed with a mutex.
