import { describe, it, expect } from "vitest";
import {
  FREE_MODELS,
  DEFAULT_FREE_MODEL,
  FAST_FREE_MODEL,
  FALLBACK_FREE_MODEL,
  recommendFreeModel,
  type FreeModelId,
} from "../free_models.js";

describe("FREE_MODELS", () => {
  it("has more than 10 entries", () => {
    expect(Object.keys(FREE_MODELS).length).toBeGreaterThan(10);
  });

  it("every entry has a name field", () => {
    for (const [id, model] of Object.entries(FREE_MODELS)) {
      expect(model, `${id} missing name`).toHaveProperty("name");
      expect(typeof model.name).toBe("string");
      expect(model.name.length).toBeGreaterThan(0);
    }
  });

  it("every entry has a context field that is a positive number", () => {
    for (const [id, model] of Object.entries(FREE_MODELS)) {
      expect(model, `${id} missing context`).toHaveProperty("context");
      expect(typeof model.context).toBe("number");
      expect(model.context).toBeGreaterThan(0);
    }
  });

  it("every entry has a strengths field that is a non-empty array", () => {
    for (const [id, model] of Object.entries(FREE_MODELS)) {
      expect(model, `${id} missing strengths`).toHaveProperty("strengths");
      expect(Array.isArray(model.strengths)).toBe(true);
      expect(model.strengths.length).toBeGreaterThan(0);
    }
  });

  it("all model IDs end with :free", () => {
    for (const id of Object.keys(FREE_MODELS)) {
      expect(id.endsWith(":free") || id === "openrouter/free").toBe(true);
    }
  });
});

describe("constants", () => {
  it("DEFAULT_FREE_MODEL exists as a key in FREE_MODELS", () => {
    expect(FREE_MODELS).toHaveProperty(DEFAULT_FREE_MODEL);
  });

  it("FAST_FREE_MODEL exists as a key in FREE_MODELS", () => {
    expect(FREE_MODELS).toHaveProperty(FAST_FREE_MODEL);
  });

  it("FALLBACK_FREE_MODEL exists as a key in FREE_MODELS", () => {
    expect(FREE_MODELS).toHaveProperty(FALLBACK_FREE_MODEL);
  });

  it("DEFAULT_FREE_MODEL is the nvidia nemotron ultra model", () => {
    expect(DEFAULT_FREE_MODEL).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");
  });

  it("FAST_FREE_MODEL is the gpt-oss-20b model", () => {
    expect(FAST_FREE_MODEL).toBe("openai/gpt-oss-20b:free");
  });

  it("FALLBACK_FREE_MODEL is the openrouter free router", () => {
    expect(FALLBACK_FREE_MODEL).toBe("openrouter/free");
  });
});

describe("recommendFreeModel", () => {
  const useCases: Array<Parameters<typeof recommendFreeModel>[0]> = [
    "coding",
    "reasoning",
    "fast",
    "multimodal",
    "general",
  ];

  for (const useCase of useCases) {
    it(`returns a valid FREE_MODELS key for use case: ${useCase}`, () => {
      const result = recommendFreeModel(useCase);
      expect(FREE_MODELS).toHaveProperty(result);
    });
  }

  it("coding use case returns the poolside laguna model", () => {
    expect(recommendFreeModel("coding")).toBe("poolside/laguna-m.1:free");
  });

  it("reasoning use case returns the nvidia nemotron ultra model", () => {
    expect(recommendFreeModel("reasoning")).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");
  });

  it("fast use case returns the gpt-oss-20b model", () => {
    expect(recommendFreeModel("fast")).toBe("openai/gpt-oss-20b:free");
  });

  it("multimodal use case returns the nemotron nano omni model", () => {
    expect(recommendFreeModel("multimodal")).toBe("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free");
  });

  it("general use case returns the nemotron super model", () => {
    expect(recommendFreeModel("general")).toBe("nvidia/nemotron-3-super-120b-a12b:free");
  });

  it("all recommendations are different models (diverse recommendations)", () => {
    const results = useCases.map(uc => recommendFreeModel(uc));
    const unique = new Set(results);
    expect(unique.size).toBe(useCases.length);
  });
});
