import { describe, it, expect } from "vitest";
import { toProviderMessages, hasImages, type ContentBlock, type MultimodalMessage } from "../multimodal.js";

// ProviderMessage shape: { role: string; content: string }
type ProviderMessage = { role: string; content: string };

describe("toProviderMessages", () => {
  it("passes through messages with string content unchanged", () => {
    const messages: MultimodalMessage[] = [
      { role: "user", content: "Hello, world!" },
    ];
    const result = toProviderMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: "user", content: "Hello, world!" });
  });

  it("passes through multiple string-content messages", () => {
    const messages: MultimodalMessage[] = [
      { role: "user", content: "First message" },
      { role: "assistant", content: "Second message" },
    ];
    const result = toProviderMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0]!.content).toBe("First message");
    expect(result[1]!.content).toBe("Second message");
  });

  it("strips image blocks and returns only joined text from array content", () => {
    const messages: MultimodalMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "What do you see in this image?" },
          { type: "image_url", image_url: { url: "https://example.com/image.png" } },
        ],
      },
    ];
    const result = toProviderMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("What do you see in this image?");
  });

  it("joins multiple text blocks in array content", () => {
    const messages: MultimodalMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "First part. " },
          { type: "text", text: "Second part." },
        ],
      },
    ];
    const result = toProviderMessages(messages);
    expect(result[0]!.content).toBe("First part. Second part.");
  });

  it("handles array with only image blocks — returns empty string", () => {
    const messages: MultimodalMessage[] = [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "https://example.com/a.jpg" } },
          { type: "image_url", image_url: { url: "https://example.com/b.jpg" } },
        ],
      },
    ];
    const result = toProviderMessages(messages);
    expect(result[0]!.content).toBe("");
  });

  it("handles empty content array — returns empty string", () => {
    const messages: MultimodalMessage[] = [{ role: "user", content: [] }];
    const result = toProviderMessages(messages);
    expect(result[0]!.content).toBe("");
  });

  it("preserves role and other properties when converting array content", () => {
    const messages: MultimodalMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "I see a cat." },
          { type: "image_url", image_url: { url: "https://example.com/cat.jpg" } },
        ],
      },
    ];
    const result = toProviderMessages(messages);
    expect(result[0]!.role).toBe("assistant");
    expect(result[0]!.content).toBe("I see a cat.");
  });

  it("handles mixed string and array content across multiple messages", () => {
    const messages: MultimodalMessage[] = [
      { role: "user", content: "Plain string" },
      {
        role: "user",
        content: [
          { type: "text", text: "With image " },
          { type: "image_url", image_url: { url: "https://example.com/img.png" } },
          { type: "text", text: "and more text" },
        ],
      },
    ];
    const result = toProviderMessages(messages);
    expect(result[0]!.content).toBe("Plain string");
    expect(result[1]!.content).toBe("With image and more text");
  });
});

describe("hasImages", () => {
  it("returns false for string content", () => {
    expect(hasImages("Hello, world!")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(hasImages("")).toBe(false);
  });

  it("returns false for text-only content array", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "Just text" },
      { type: "text", text: "More text" },
    ];
    expect(hasImages(content)).toBe(false);
  });

  it("returns true for array with an image block", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "Look at this:" },
      { type: "image_url", image_url: { url: "https://example.com/photo.jpg" } },
    ];
    expect(hasImages(content)).toBe(true);
  });

  it("returns true for array with only image blocks", () => {
    const content: ContentBlock[] = [
      { type: "image_url", image_url: { url: "https://example.com/a.png" } },
    ];
    expect(hasImages(content)).toBe(true);
  });

  it("returns false for empty array", () => {
    expect(hasImages([])).toBe(false);
  });

  it("returns true when image appears anywhere in the array", () => {
    const content: ContentBlock[] = [
      { type: "text", text: "Before" },
      { type: "text", text: "Middle" },
      { type: "image_url", image_url: { url: "https://example.com/last.gif" } },
    ];
    expect(hasImages(content)).toBe(true);
  });
});
