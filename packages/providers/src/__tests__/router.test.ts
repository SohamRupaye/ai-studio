import { describe, it, expect, vi, beforeEach } from "vitest";
import { Router } from "../router.js";
import type { Provider } from "../base.js";

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    call: vi.fn().mockResolvedValue({ text: "", toolCalls: [], usage: {} }),
    stream: vi.fn(),
    ...overrides,
  } as unknown as Provider;
}

describe("Router.refreshModels", () => {
  beforeEach(() => {
    // Router's model cache is module-level; use a fresh provider `name` per
    // test (below) rather than trying to reset internal module state.
  });

  it("keeps the hardcoded fallback list when the provider has no listModels()", async () => {
    const router = new Router();
    const provider = makeProvider(); // no listModels
    router.register("no-list-a", ["claude"], provider, ["hardcoded-1", "hardcoded-2"]);

    await router.refreshModels();

    expect(router.listModels()).toEqual({ "no-list-a": ["hardcoded-1", "hardcoded-2"] });
  });

  it("keeps the hardcoded fallback list when listModels() rejects", async () => {
    const router = new Router();
    const provider = makeProvider({ listModels: vi.fn().mockRejectedValue(new Error("network down")) });
    router.register("fails-b", ["claude"], provider, ["hardcoded-1"]);

    await router.refreshModels();

    expect(router.listModels()).toEqual({ "fails-b": ["hardcoded-1"] });
  });

  it("keeps the hardcoded fallback list when listModels() resolves empty", async () => {
    const router = new Router();
    const provider = makeProvider({ listModels: vi.fn().mockResolvedValue([]) });
    router.register("empty-c", ["claude"], provider, ["hardcoded-1"]);

    await router.refreshModels();

    expect(router.listModels()).toEqual({ "empty-c": ["hardcoded-1"] });
  });

  it("replaces the model list on successful fetch for a plain (non-namespaced, non-exact-id) provider", async () => {
    const router = new Router();
    const provider = makeProvider({ listModels: vi.fn().mockResolvedValue(["live-model-1", "live-model-2"]) });
    router.register("live-d", ["claude"], provider, ["hardcoded-1"]);

    await router.refreshModels();

    expect(router.listModels()).toEqual({ "live-d": ["live-model-1", "live-model-2"] });
  });

  it("re-namespaces model ids for namespaced providers on successful fetch", async () => {
    const router = new Router();
    const provider = makeProvider({ listModels: vi.fn().mockResolvedValue(["llama-70b", "llama-8b"]) });
    router.register("groq-e", ["groq-e/"], provider, ["groq-e/old-model"], { namespaced: true });

    await router.refreshModels();

    expect(router.listModels()).toEqual({ "groq-e": ["groq-e/llama-70b", "groq-e/llama-8b"] });
  });

  it("replaces exact-id prefixes for exactIdRouting providers (OpenRouter-style) on successful fetch", async () => {
    const router = new Router();
    const provider = makeProvider({ listModels: vi.fn().mockResolvedValue(["vendor/live-free-model:free"]) });
    router.register("openrouter-f", ["vendor/stale-model:free"], provider, ["vendor/stale-model:free"], { exactIdRouting: true });

    await router.refreshModels();

    expect(router.listModels()).toEqual({ "openrouter-f": ["vendor/live-free-model:free"] });

    // Routing (resolve) must now match against the NEW exact id, proving
    // prefixes were actually updated, not just the display list.
    await router.call("vendor/live-free-model:free", [], "sys");
    expect(provider.call).toHaveBeenCalledWith("vendor/live-free-model:free", [], "sys", undefined, undefined);
  });

  it("caches a successful fetch so a second refreshModels() within the TTL does not call listModels() again", async () => {
    const router = new Router();
    const listModels = vi.fn().mockResolvedValue(["live-model-1"]);
    const provider = makeProvider({ listModels });
    router.register("cached-g", ["claude"], provider, ["hardcoded-1"]);

    await router.refreshModels();
    expect(listModels).toHaveBeenCalledTimes(1);

    // A brand new Router instance registering the SAME provider name should
    // reuse the shared module-level cache instead of re-fetching.
    const router2 = new Router();
    const provider2 = makeProvider({ listModels });
    router2.register("cached-g", ["claude"], provider2, ["hardcoded-1"]);
    await router2.refreshModels();

    expect(listModels).toHaveBeenCalledTimes(1); // still 1 — served from cache
    expect(router2.listModels()).toEqual({ "cached-g": ["live-model-1"] });
  });

  it("never leaves an entry with zero models after a refresh", async () => {
    const router = new Router();
    const provider = makeProvider({ listModels: vi.fn().mockRejectedValue(new Error("boom")) });
    router.register("never-empty-h", ["claude"], provider, ["fallback-1", "fallback-2"]);

    await router.refreshModels();

    const models = router.listModels()["never-empty-h"];
    expect(models).toBeDefined();
    expect(models!.length).toBeGreaterThan(0);
  });
});
