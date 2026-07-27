/**
 * JSON Schema → Zod raw shape.
 *
 * The Agent SDK's `tool()` helper only accepts a Zod raw shape, while every
 * tool in `@squirl/tools-runtime` declares its parameters as a JSON Schema
 * (`ToolDefinition.parameters`). That shape IS what the model sees as the
 * tool's signature, so a permissive `z.record(...)` passthrough would hide
 * every parameter name and description from the model — this converter is
 * load-bearing for tool use, not a formality.
 *
 * Scope is deliberately the subset `JSONSchema` in tools-runtime can express:
 * type / properties / required / items / enum / description / default /
 * additionalProperties. Anything unrecognised degrades to `z.unknown()`
 * instead of throwing — a tool with an exotic schema should still be callable,
 * and `ToolRegistry.execute` re-validates against the real JSON Schema anyway,
 * so this layer is the model's view rather than the enforcement boundary.
 */
import { z } from "zod";

export interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  additionalProperties?: boolean | JsonSchemaNode;
  [key: string]: unknown;
}

/** `type` may be a union (`["string", "null"]`); nullability is re-expressed via .nullable(). */
function primaryType(node: JsonSchemaNode): string | undefined {
  if (typeof node.type === "string") return node.type;
  if (Array.isArray(node.type)) return node.type.find(t => t !== "null");
  return undefined;
}

function isNullable(node: JsonSchemaNode): boolean {
  return Array.isArray(node.type) && node.type.includes("null");
}

function convertEnum(values: unknown[]): z.ZodTypeAny | undefined {
  if (!values.length) return undefined;
  if (values.every(v => typeof v === "string")) {
    return z.enum(values as [string, ...string[]]);
  }
  // Mixed/numeric enums: a union of literals. z.union needs two members, so a
  // single-value enum collapses to the bare literal.
  const literals = values.map(v => z.literal(v as string | number | boolean));
  if (literals.length === 1) return literals[0]!;
  return z.union(literals as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

function convertObject(node: JsonSchemaNode): z.ZodTypeAny {
  const props = node.properties;
  if (!props || !Object.keys(props).length) {
    // Free-form object — keep whatever keys arrive rather than stripping to {}.
    return z.record(z.string(), z.unknown());
  }
  const obj = z.object(shapeFor(props, Array.isArray(node.required) ? node.required : []));
  // JSON Schema defaults to permissive; Zod defaults to stripping. Stripping
  // would silently drop arguments a tool actually reads, so only an explicit
  // `additionalProperties: false` gets the strict object.
  return node.additionalProperties === false ? obj : obj.catchall(z.unknown());
}

function convertNode(node: JsonSchemaNode): z.ZodTypeAny {
  let base: z.ZodTypeAny;

  if (Array.isArray(node.enum) && node.enum.length) {
    base = convertEnum(node.enum) ?? z.unknown();
  } else {
    switch (primaryType(node)) {
      case "string": base = z.string(); break;
      case "number": base = z.number(); break;
      case "integer": base = z.number().int(); break;
      case "boolean": base = z.boolean(); break;
      case "null": base = z.null(); break;
      case "array": base = z.array(node.items ? convertNode(node.items) : z.unknown()); break;
      case "object": base = convertObject(node); break;
      // No declared type but carrying properties — an object in all but name.
      default: base = node.properties ? convertObject(node) : z.unknown();
    }
  }

  if (isNullable(node)) base = base.nullable();
  if (node.description) base = base.describe(node.description);
  return base;
}

function shapeFor(
  props: Record<string, JsonSchemaNode>,
  required: string[],
): z.ZodRawShape {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, child] of Object.entries(props)) {
    let field = convertNode(child);
    if (child.default !== undefined) {
      // .default() already makes the field optional on input. The cast is
      // unavoidable: the default's type is only known at runtime.
      field = (field as unknown as { default: (v: unknown) => z.ZodTypeAny }).default(child.default);
    } else if (!required.includes(key)) {
      field = field.optional();
    }
    shape[key] = field;
  }
  return shape;
}

/**
 * Convert a tool's `parameters` JSON Schema into the raw shape `tool()` wants.
 * A schema with no properties yields `{}` — a tool that takes no arguments.
 */
export function jsonSchemaToZodShape(schema: unknown): z.ZodRawShape {
  const node = (schema ?? {}) as JsonSchemaNode;
  const props = node.properties;
  if (!props || !Object.keys(props).length) return {};
  return shapeFor(props, Array.isArray(node.required) ? node.required : []);
}
