import { describe, it, expect } from "vitest";
import {
  toOpenAIContent,
  toAnthropicContent,
  toGoogleParts,
  toResponsesContent,
  toBedrockContent,
  contentToText,
  imageBlocks,
  type ContentBlock,
} from "../base.js";

const IMG: ContentBlock = { type: "image", mediaType: "image/png", data: "BASE64DATA" };
const withImage: ContentBlock[] = [{ type: "text", text: "look at this" }, IMG];

describe("string content passes through unchanged", () => {
  it("openai / anthropic / responses keep strings; google and bedrock wrap in a text part", () => {
    expect(toOpenAIContent("hi")).toBe("hi");
    expect(toAnthropicContent("hi")).toBe("hi");
    expect(toResponsesContent("hi")).toBe("hi");
    expect(toGoogleParts("hi")).toEqual([{ text: "hi" }]);
    expect(toBedrockContent("hi")).toEqual([{ text: "hi" }]);
  });
});

describe("image blocks map to each wire format", () => {
  it("OpenAI → image_url data URL", () => {
    expect(toOpenAIContent(withImage)).toEqual([
      { type: "text", text: "look at this" },
      { type: "image_url", image_url: { url: "data:image/png;base64,BASE64DATA" } },
    ]);
  });

  it("Anthropic → base64 source block", () => {
    expect(toAnthropicContent(withImage)).toEqual([
      { type: "text", text: "look at this" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "BASE64DATA" } },
    ]);
  });

  it("Google → inline_data part", () => {
    expect(toGoogleParts(withImage)).toEqual([
      { text: "look at this" },
      { inline_data: { mime_type: "image/png", data: "BASE64DATA" } },
    ]);
  });

  it("Responses API (Codex) → input_text / input_image parts", () => {
    expect(toResponsesContent(withImage)).toEqual([
      { type: "input_text", text: "look at this" },
      { type: "input_image", image_url: "data:image/png;base64,BASE64DATA" },
    ]);
  });

  it("Bedrock Converse → image block with format token from the mime", () => {
    expect(toBedrockContent(withImage)).toEqual([
      { text: "look at this" },
      { image: { format: "png", source: { bytes: "BASE64DATA" } } },
    ]);
    const jpeg: ContentBlock[] = [{ type: "image", mediaType: "image/jpeg", data: "D" }];
    expect(toBedrockContent(jpeg)).toEqual([{ image: { format: "jpeg", source: { bytes: "D" } } }]);
    const webp: ContentBlock[] = [{ type: "image", mediaType: "image/webp", data: "D" }];
    expect(toBedrockContent(webp)).toEqual([{ image: { format: "webp", source: { bytes: "D" } } }]);
  });
});

const DOC: ContentBlock = { type: "document", mediaType: "application/pdf", data: "PDFDATA", title: "Q3 Report.pdf" };
const withDoc: ContentBlock[] = [DOC, { type: "text", text: "summarise this" }];

describe("document blocks map to formats with native PDF support", () => {
  it("Anthropic → document base64 source block with title", () => {
    expect(toAnthropicContent(withDoc)).toEqual([
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "PDFDATA" }, title: "Q3 Report.pdf" },
      { type: "text", text: "summarise this" },
    ]);
  });

  it("Google → inline_data part (same shape as images)", () => {
    expect(toGoogleParts(withDoc)).toEqual([
      { inline_data: { mime_type: "application/pdf", data: "PDFDATA" } },
      { text: "summarise this" },
    ]);
  });

  it("Bedrock → document block with a sanitised name", () => {
    expect(toBedrockContent(withDoc)).toEqual([
      { document: { format: "pdf", name: "Q3 Report pdf", source: { bytes: "PDFDATA" } } },
      { text: "summarise this" },
    ]);
  });

  it("OpenAI-family formats degrade documents to a text placeholder, never a 400", () => {
    expect(toOpenAIContent(withDoc)).toEqual([
      { type: "text", text: "[Attached document: Q3 Report.pdf — not viewable on this model.]" },
      { type: "text", text: "summarise this" },
    ]);
    expect(toResponsesContent(withDoc)).toEqual([
      { type: "input_text", text: "[Attached document: Q3 Report.pdf — not viewable on this model.]" },
      { type: "input_text", text: "summarise this" },
    ]);
  });
});

describe("helpers", () => {
  it("contentToText flattens images to a placeholder", () => {
    expect(contentToText(withImage)).toBe("look at this[image]");
    expect(contentToText("plain")).toBe("plain");
  });

  it("contentToText flattens documents to a titled placeholder", () => {
    expect(contentToText(withDoc)).toBe("[document: Q3 Report.pdf]summarise this");
  });

  it("imageBlocks extracts only image parts", () => {
    expect(imageBlocks(withImage)).toEqual([IMG]);
    expect(imageBlocks("plain")).toEqual([]);
  });
});
