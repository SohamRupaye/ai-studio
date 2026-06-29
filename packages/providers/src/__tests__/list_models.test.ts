import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnthropicProvider } from "../anthropic.js";
import { OpenAIProvider } from "../openai.js";
import { GoogleProvider } from "../google.js";
import { OpenRouterProvider } from "../openrouter.js";
import { OpenAICompatibleProvider } from "../openai_compatible.js";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("Provider.listModels()", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("AnthropicProvider", () => {
    it("returns model ids from a single page", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: "claude-a" }, { id: "claude-b" }], has_more: false }),
      );

      const provider = new AnthropicProvider("key");
      const models = await provider.listModels!();

      expect(models).toEqual(["claude-a", "claude-b"]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toContain("/v1/models");
      expect((init as RequestInit).headers).toMatchObject({ "x-api-key": "key" });
    });

    it("follows has_more/last_id pagination across multiple pages", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ data: [{ id: "claude-a" }], has_more: true, last_id: "claude-a" }))
        .mockResolvedValueOnce(jsonResponse({ data: [{ id: "claude-b" }], has_more: false }));

      const provider = new AnthropicProvider("key");
      const models = await provider.listModels!();

      expect(models).toEqual(["claude-a", "claude-b"]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("throws on a non-ok response (caller is responsible for fallback)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, false, 401));
      const provider = new AnthropicProvider("bad-key");
      await expect(provider.listModels!()).rejects.toThrow(/401/);
    });
  });

  describe("OpenAIProvider", () => {
    it("returns model ids from the standard {data:[{id}]} shape", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ id: "gpt-a" }, { id: "gpt-b" }] }));

      const provider = new OpenAIProvider("key");
      const models = await provider.listModels!();

      expect(models).toEqual(["gpt-a", "gpt-b"]);
    });

    it("works against a custom baseUrl (OpenAI-shaped third-party endpoint)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ id: "custom-model" }] }));
      const provider = new OpenAIProvider("key", "https://example.com/v1");
      await provider.listModels!();
      expect(String(fetchMock.mock.calls[0]![0])).toBe("https://example.com/v1/models");
    });
  });

  describe("GoogleProvider", () => {
    it("strips the 'models/' prefix and filters by supportedGenerationMethods", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          models: [
            { name: "models/gemini-a", supportedGenerationMethods: ["generateContent"] },
            { name: "models/embedding-only", supportedGenerationMethods: ["embedContent"] },
            { name: "models/gemini-b" }, // no methods field -> not filtered out
          ],
        }),
      );

      const provider = new GoogleProvider("key");
      const models = await provider.listModels!();

      expect(models).toEqual(["gemini-a", "gemini-b"]);
    });

    it("paginates via nextPageToken", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ models: [{ name: "models/gemini-a", supportedGenerationMethods: ["generateContent"] }], nextPageToken: "tok" }),
        )
        .mockResolvedValueOnce(
          jsonResponse({ models: [{ name: "models/gemini-b", supportedGenerationMethods: ["generateContent"] }] }),
        );

      const provider = new GoogleProvider("key");
      const models = await provider.listModels!();

      expect(models).toEqual(["gemini-a", "gemini-b"]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("OpenRouterProvider", () => {
    it("filters to only free-tier models (pricing.prompt/completion === '0')", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: "vendor/free-model:free", pricing: { prompt: "0", completion: "0" } },
            { id: "vendor/paid-model", pricing: { prompt: "0.001", completion: "0.002" } },
          ],
        }),
      );

      const provider = new OpenRouterProvider("key");
      const models = await provider.listModels!();

      expect(models).toEqual(["vendor/free-model:free"]);
    });
  });

  describe("OpenAICompatibleProvider", () => {
    it("handles the standard {data:[{id}]} shape", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ id: "llama-70b" }] }));
      const provider = new OpenAICompatibleProvider({ apiKey: "key", baseUrl: "https://api.groq.com/openai/v1", name: "Groq" });
      const models = await provider.listModels!();
      expect(models).toEqual(["llama-70b"]);
    });

    it("handles Cohere's differing {models:[{name}]} shape at the v1 (not v2) path", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ models: [{ name: "command-a-03-2025" }] }));
      const provider = new OpenAICompatibleProvider({ apiKey: "key", baseUrl: "https://api.cohere.com/v2", name: "Cohere" });
      const models = await provider.listModels!();

      expect(models).toEqual(["command-a-03-2025"]);
      expect(String(fetchMock.mock.calls[0]![0])).toBe("https://api.cohere.com/v1/models");
    });

    it("returns an empty array for an unrecognized response shape rather than throwing", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ unexpected: true }));
      const provider = new OpenAICompatibleProvider({ apiKey: "key", baseUrl: "https://example.com/v1", name: "Unknown" });
      const models = await provider.listModels!();
      expect(models).toEqual([]);
    });
  });
});
