import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";

export const questionDef: ToolDefinition = {
  name: "question",
  description: "Ask the user a question for clarification or confirmation before proceeding.",
  parameters: { type: "object", properties: { text: { type: "string", description: "The question to ask" }, options: { type: "string", description: "Comma-separated options (optional)" } }, required: ["text"] },
};

let _askCallback: ((text: string, options: string) => Promise<string>) | null = null;

export function setAskCallback(cb: (text: string, options: string) => Promise<string>) {
  _askCallback = cb;
}

export const question: ToolHandler = async (args) => {
  const text = args["text"] as string;
  const options = (args["options"] as string) || "";
  if (!_askCallback) return "(no user interaction available)";
  return _askCallback(text, options);
};
