import { describe, it, expect } from "vitest";
import { Router } from "../router.js";
import { AnthropicProvider } from "../anthropic.js";
import {
  CLAUDE_SUBSCRIPTION_ENTRY,
  CLAUDE_SUBSCRIPTION_MODELS,
  ClaudeSubscriptionProvider,
  bareClaudeModel,
  isClaudeSubscriptionModel,
  utilityModelFor,
} from "../claude_subscription.js";

/** Mirrors how Router.fromEnv registers the pair, including order. */
function routerWithBoth(): Router {
  const router = new Router();
  router.register(
    CLAUDE_SUBSCRIPTION_ENTRY,
    [`${CLAUDE_SUBSCRIPTION_ENTRY}/`],
    new ClaudeSubscriptionProvider(),
    CLAUDE_SUBSCRIPTION_MODELS.map(id => `${CLAUDE_SUBSCRIPTION_ENTRY}/${id}`),
    { namespaced: true },
  );
  router.register("anthropic", ["claude"], new AnthropicProvider("sk-test"), [
    "claude-opus-4-8",
  ]);
  return router;
}

describe("claude subscription helpers", () => {
  it("recognises only namespaced ids", () => {
    expect(isClaudeSubscriptionModel("claude_subscription/claude-opus-4-8")).toBe(true);
    // A bare id belongs to the API-key entry and must not be captured.
    expect(isClaudeSubscriptionModel("claude-opus-4-8")).toBe(false);
    expect(isClaudeSubscriptionModel("bedrock/claude-opus-4-8")).toBe(false);
  });

  it("strips the namespace to the bare id the SDK expects", () => {
    expect(bareClaudeModel("claude_subscription/claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(bareClaudeModel("claude-opus-4-8")).toBe("claude-opus-4-8");
  });

  it("swaps subscription ids for the utility model but leaves others alone", () => {
    expect(utilityModelFor("claude_subscription/claude-opus-4-8", "gpt-5.4-mini")).toBe("gpt-5.4-mini");
    expect(utilityModelFor("claude-opus-4-8", "gpt-5.4-mini")).toBe("claude-opus-4-8");
  });

  it("keeps the exported model list bare — the namespace is applied at registration", () => {
    for (const id of CLAUDE_SUBSCRIPTION_MODELS) {
      expect(isClaudeSubscriptionModel(id)).toBe(false);
    }
  });
});

describe("router registration alongside an API key", () => {
  it("lists subscription models namespaced from the moment they register", () => {
    // register() uses the supplied list verbatim; applyModels only namespaces on
    // a later refresh. A bare list here would surface as `claude-opus-4-8` and
    // route to the API-key entry instead.
    const listed = routerWithBoth().listModels()[CLAUDE_SUBSCRIPTION_ENTRY] ?? [];
    expect(listed).toContain("claude_subscription/claude-opus-4-8");
    expect(listed).not.toContain("claude-opus-4-8");
  });

  it("keeps both entries visible so each billing path is selectable", () => {
    const models = routerWithBoth().listModels();
    expect(models["anthropic"]).toContain("claude-opus-4-8");
    expect(models[CLAUDE_SUBSCRIPTION_ENTRY]).toContain("claude_subscription/claude-opus-4-8");
  });

  it("does not let the `claude` prefix entry shadow the namespaced one", async () => {
    // resolve() is first-wins on startsWith, and "claude_subscription/…" also
    // startsWith "claude" — so registration order is load-bearing.
    const router = routerWithBoth();
    await expect(
      router.call("claude_subscription/claude-opus-4-8", [{ role: "user", content: "hi" }], ""),
    ).rejects.toThrow(/chat turns only/i);
  });
});
