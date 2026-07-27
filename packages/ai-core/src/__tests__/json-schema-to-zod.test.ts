import { describe, it, expect } from "vitest";
import { z } from "zod";
import { jsonSchemaToZodShape } from "../engines/json-schema-to-zod.js";

/** The shape is only useful wrapped back into an object for parsing. */
function parser(schema: unknown) {
  return z.object(jsonSchemaToZodShape(schema));
}

describe("jsonSchemaToZodShape", () => {
  it("returns an empty shape for a schema with no properties", () => {
    expect(jsonSchemaToZodShape({ type: "object" })).toEqual({});
    expect(jsonSchemaToZodShape(undefined)).toEqual({});
  });

  it("makes non-required properties optional and keeps required ones required", () => {
    const p = parser({
      type: "object",
      properties: { path: { type: "string" }, limit: { type: "integer" } },
      required: ["path"],
    });

    expect(p.parse({ path: "a.ts" })).toEqual({ path: "a.ts" });
    expect(p.safeParse({ limit: 5 }).success).toBe(false);
  });

  it("preserves descriptions — this is what the model reads", () => {
    const shape = jsonSchemaToZodShape({
      type: "object",
      properties: { path: { type: "string", description: "Absolute file path" } },
      required: ["path"],
    });

    // Zod 4 doesn't surface `description` on the base type, but it's there at
    // runtime — and it's the whole point of the conversion, so assert on it.
    const described = shape["path"] as unknown as { description?: string };
    expect(described.description).toBe("Absolute file path");
  });

  it("maps scalar types, including integer", () => {
    const p = parser({
      type: "object",
      properties: {
        s: { type: "string" },
        n: { type: "number" },
        i: { type: "integer" },
        b: { type: "boolean" },
      },
      required: ["s", "n", "i", "b"],
    });

    expect(p.parse({ s: "x", n: 1.5, i: 2, b: true })).toEqual({ s: "x", n: 1.5, i: 2, b: true });
    expect(p.safeParse({ s: "x", n: 1.5, i: 2.5, b: true }).success).toBe(false);
  });

  it("maps string enums", () => {
    const p = parser({
      type: "object",
      properties: { mode: { type: "string", enum: ["read", "write"] } },
      required: ["mode"],
    });

    expect(p.parse({ mode: "write" })).toEqual({ mode: "write" });
    expect(p.safeParse({ mode: "delete" }).success).toBe(false);
  });

  it("maps a single-value enum to a bare literal (z.union needs two members)", () => {
    const p = parser({
      type: "object",
      properties: { kind: { enum: ["only"] } },
      required: ["kind"],
    });

    expect(p.parse({ kind: "only" })).toEqual({ kind: "only" });
  });

  it("maps arrays with typed items", () => {
    const p = parser({
      type: "object",
      properties: { paths: { type: "array", items: { type: "string" } } },
      required: ["paths"],
    });

    expect(p.parse({ paths: ["a", "b"] })).toEqual({ paths: ["a", "b"] });
    expect(p.safeParse({ paths: [1] }).success).toBe(false);
  });

  it("recurses into nested objects", () => {
    const p = parser({
      type: "object",
      properties: {
        opts: {
          type: "object",
          properties: { deep: { type: "boolean" } },
          required: ["deep"],
        },
      },
      required: ["opts"],
    });

    expect(p.parse({ opts: { deep: true } })).toEqual({ opts: { deep: true } });
    expect(p.safeParse({ opts: {} }).success).toBe(false);
  });

  it("keeps unknown extra keys unless additionalProperties is false", () => {
    const permissive = parser({
      type: "object",
      properties: {
        opts: { type: "object", properties: { a: { type: "string" } } },
      },
      required: ["opts"],
    });
    // Dropping unknown keys would silently discard arguments a tool reads.
    expect(permissive.parse({ opts: { a: "x", extra: 1 } })).toEqual({
      opts: { a: "x", extra: 1 },
    });

    const strict = parser({
      type: "object",
      properties: {
        opts: {
          type: "object",
          properties: { a: { type: "string" } },
          additionalProperties: false,
        },
      },
      required: ["opts"],
    });
    expect(strict.parse({ opts: { a: "x", extra: 1 } })).toEqual({ opts: { a: "x" } });
  });

  it("applies defaults, which also makes the field optional", () => {
    const p = parser({
      type: "object",
      properties: { limit: { type: "integer", default: 10 } },
    });

    expect(p.parse({})).toEqual({ limit: 10 });
  });

  it("treats a union type containing null as nullable", () => {
    const p = parser({
      type: "object",
      properties: { note: { type: ["string", "null"] } },
      required: ["note"],
    });

    expect(p.parse({ note: null })).toEqual({ note: null });
    expect(p.parse({ note: "hi" })).toEqual({ note: "hi" });
  });

  it("degrades an untyped property to unknown rather than throwing", () => {
    const p = parser({
      type: "object",
      properties: { anything: { description: "no type given" } },
      required: ["anything"],
    });

    expect(p.parse({ anything: { arbitrary: true } })).toEqual({
      anything: { arbitrary: true },
    });
  });
});
