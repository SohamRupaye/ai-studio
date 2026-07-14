import { describe, expect, it } from "vitest";
import { parseDelimited, parseSheets } from "../renderer/components/viewers/parse-delimited";

describe("parseDelimited", () => {
  it("parses plain comma-separated rows", () => {
    expect(parseDelimited("a,b,c\n1,2,3", ",")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps delimiters and newlines inside quoted fields", () => {
    expect(parseDelimited('name,notes\nAda,"loves, commas\nand newlines"', ",")).toEqual([
      ["name", "notes"],
      ["Ada", "loves, commas\nand newlines"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseDelimited('say\n"she said ""hi"""', ",")).toEqual([["say"], ['she said "hi"']]);
  });

  it("handles CRLF line endings", () => {
    expect(parseDelimited("a,b\r\n1,2\r\n", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("parses tab-separated input without splitting on commas", () => {
    expect(parseDelimited("a,x\tb\n1\t2", "\t")).toEqual([
      ["a,x", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps empty fields and ragged rows", () => {
    expect(parseDelimited("a,,c\n1,2", ",")).toEqual([
      ["a", "", "c"],
      ["1", "2"],
    ]);
  });

  it("returns nothing for empty input", () => {
    expect(parseDelimited("", ",")).toEqual([]);
  });
});

describe("parseSheets", () => {
  it("splits ingestion's multi-sheet text into named sheets", () => {
    const content = "## Sheet: Revenue\na,b\n1,2\n\n## Sheet: Costs\nx,y\n3,4";
    expect(parseSheets(content)).toEqual([
      { name: "Revenue", rows: [["a", "b"], ["1", "2"]] },
      { name: "Costs", rows: [["x", "y"], ["3", "4"]] },
    ]);
  });

  it("returns no sheets for content without sheet markers", () => {
    expect(parseSheets("just,a,csv\n1,2,3")).toEqual([]);
  });

  it("drops a trailing marker with no data", () => {
    expect(parseSheets("## Sheet: Empty")).toEqual([]);
  });
});
