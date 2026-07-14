# Squirl 🐿️

> Squirl is the mascot of Squirl — the model-agnostic context layer that never forgets.

The name is a deliberate misspelling of "squirrel." Squirrels bury things and dig them up later. That's the entire product in one animal behavior.

---

## Character

Squirl is a small, round, expressive eastern grey squirrel with an oversized fluffy tail. Big eyes, small snout, slightly chubby cheeks. Designed to live comfortably at 32×32px but readable at 16×16. Think Duolingo owl in terms of expressiveness — simple enough to animate, distinct enough to brand.

**Personality:** curious, a little scatterbrained, but secretly has everything filed away and can find it instantly. Never panics. Slightly smug when it retrieves the exact thing you needed.

**Color palette:**
- Body: warm grey (#8B8680) with a cream belly (#F5F0E8)
- Eyes: large, dark amber (#3D2B1F)
- Tail: lighter grey with a subtle gradient, slightly bushy
- Accent: soft acorn-brown (#8B5E3C) for highlights and props

---

## Animation States

These map directly to UI states in the app. All animations should be Lottie-compatible (vector, loopable).

### Core states

| State | Animation | Notes |
|-------|-----------|-------|
| **Idle** | Squirl sits upright, tail sways gently, eyes blink every ~4s | Default resting state |
| **Thinking** | Sits up tall, one paw on chin, eyes drift upward, tail curls | Shown while model is generating |
| **Typing / Generating** | Squirl's cheeks puff rapidly (like nibbling), small text particles float up | Fast, loopable, represents active output |
| **Tool call** | Squirl digs — front paws scratch downward in quick bursts | Executing a tool; maps to the core squirrel behavior |
| **Waiting for user** | Relaxed pose, slow tail flick, occasional glance sideways | Prompt submitted, waiting for response to start |
| **Cancelled / Stopped** | Squirl freezes mid-action, goes rigid, one paw raised | Mirrors the real freeze-in-place behavior of squirrels |
| **Success** | Squirl holds up an acorn, takes a satisfied bite, small sparkle | Task complete |
| **Error** | Squirl looks down at two empty paws, confused tilt of head | Generic failure state |

### Squirl-specific states

| State | Animation | Notes |
|-------|-----------|-------|
| **Storing context** | Squirl carefully buries a glowing acorn | When knowledge is saved to context |
| **Retrieving from context (RAG)** | Squirl's nose twitches, it digs up a glowing acorn and presents it | When relevant context is pulled into prompt |
| **Forgot / context miss** | Squirl digs in three spots and comes up empty, shrugs | When RAG returns nothing useful |
| **Branching** | Squirl pauses at a Y-shaped tree fork, looks both ways, then darts one direction | Branch creation |
| **Rate limited / quota hit** | Squirl tries to dig, hits a rock, sits back and shrugs with empty paws | API limit reached |
| **Loading / startup** | Squirl runs on a tiny wheel, tail streaming behind it | App startup or heavy load |

### Personality moments (optional / easter eggs)

| Trigger | Animation |
|---------|-----------|
| **Onboarding / first launch** | Squirl peeks over the bottom edge of the screen, then hops up and waves |
| **Idle too long (>5 min)** | Squirl curls up on a branch and falls asleep, small Zzz's float up |
| **Very long context window filled** | Squirl's cheeks bulge comically, it looks overwhelmed |
| **Many branches open** | Squirl runs back and forth between branches, increasingly frantic |
| **Successful OAuth sign-in** | Squirl digs up a golden acorn (special variant) |
| **Dark mode toggle** | Squirl opens one eye, squints at screen brightness, goes back to sleep |

---

## Design Principles

**Squirl never judges.** It's not snarky, never condescending. If something failed, it looks confused — not guilty.

**Squirl is always doing something physical.** Every state maps to something a real squirrel does. Digging, burying, running, freezing, nibbling. This grounds the animations in a coherent character logic rather than abstract loading spinners.

**Squirl's props are acorns.** An acorn = a piece of knowledge. A glowing acorn = important retrieved context. A golden acorn = something special. The prop language is simple and consistent.

**Squirl does not speak.** No speech bubbles, no text, no tooltips from Squirl. The app's UI handles text. Squirl is purely visual.

**Squirl is one character.** No seasonal variants, no outfits, no holiday skins. The character is consistent across the whole app.

---

## Usage in the App

Squirl appears in:

- **Empty states** — when a chat is new, when no results are found, when a panel has no content yet
- **Loading overlays** — on startup and heavy async operations
- **Inline status indicators** — small (24px) Squirl beside the message input during generation
- **Onboarding flow** — full-size Squirl walks the user through first setup
- **Error pages** — confused Squirl with empty paws

Squirl does **not** appear in:
- Decorative headers or backgrounds (too noisy)
- Every tool call (only when the tool panel is open and focused)
- Notifications or toasts (icon only, no animation)

---

## File Format

Animations: `.lottie` (Lottie 5+), bundled as static assets in `apps/desktop/src/renderer/assets/squirl/`.

Static variants: `.svg` for icons, `.png` @ 1×/2× for raster contexts.

Naming convention:
```
squirl-idle.lottie
squirl-thinking.lottie
squirl-typing.lottie
squirl-digging.lottie        ← tool call
squirl-burying.lottie        ← storing context
squirl-retrieving.lottie     ← RAG hit
squirl-empty.lottie          ← RAG miss / forgot
squirl-freeze.lottie         ← cancelled
squirl-success.lottie
squirl-error.lottie
squirl-loading.lottie
squirl-branch.lottie
squirl-sleeping.lottie       ← idle easter egg
squirl-onboarding.lottie     ← first launch
squirl.svg                   ← static default pose
squirl-icon.svg              ← 32px app icon variant
```
