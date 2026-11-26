import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, mimeFor, isLossless, acceptedExtensions, extractText, MAX_FILE_BYTES } from "../main/ingestion.js";

describe("ingestion.classify", () => {
  it("classifies by extension", () => {
    expect(classify("/x/a.md")).toBe("text");
    expect(classify("/x/a.csv")).toBe("text");
    expect(classify("/x/a.ts")).toBe("text");
    expect(classify("/x/a.pdf")).toBe("pdf");
    expect(classify("/x/a.docx")).toBe("docx");
    expect(classify("/x/a.png")).toBeNull();
    expect(classify("/x/a.doc")).toBeNull();
  });

  it("only text kinds are lossless (need no blob)", () => {
    expect(isLossless("text")).toBe(true);
    expect(isLossless("pdf")).toBe(false);
    expect(isLossless("docx")).toBe(false);
  });

  it("acceptedExtensions covers pdf/docx/text and carries no leading dots", () => {
    const exts = acceptedExtensions();
    expect(exts).toContain("pdf");
    expect(exts).toContain("docx");
    expect(exts).toContain("md");
    expect(exts.every((e) => !e.startsWith("."))).toBe(true);
  });

  it("mimeFor maps known types and falls back for unknown", () => {
    expect(mimeFor("/x/a.pdf")).toBe("application/pdf");
    expect(mimeFor("/x/a.md")).toBe("text/markdown");
    expect(mimeFor("/x/a.py")).toBe("text/plain");
    expect(mimeFor("/x/unknown.xyz")).toBe("application/octet-stream");
  });
});

describe("ingestion.extractText", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ingest-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("reads a text file as-is", async () => {
    const p = join(dir, "note.md");
    writeFileSync(p, "# Hello\nworld");
    const r = await extractText(p);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe("text");
      expect(r.text).toContain("Hello");
      expect(r.mime).toBe("text/markdown");
    }
  });

  it("rejects an empty file", async () => {
    const p = join(dir, "empty.txt");
    writeFileSync(p, "   ");
    const r = await extractText(p);
    expect(r.ok).toBe(false);
  });

  it("rejects images with a clear reason", async () => {
    const p = join(dir, "pic.png");
    writeFileSync(p, "not really a png");
    const r = await extractText(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/image/i);
  });

  it("rejects legacy .doc and points at .docx", async () => {
    const p = join(dir, "old.doc");
    writeFileSync(p, "x");
    const r = await extractText(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/\.docx/);
  });

  it("rejects a file over the size cap with a clear reason", async () => {
    const p = join(dir, "huge.txt");
    writeFileSync(p, Buffer.alloc(MAX_FILE_BYTES + 1, 0x61));
    const r = await extractText(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too large/i);
  });

  it("decodes UTF-16LE text (Excel's default CSV export)", async () => {
    const p = join(dir, "export.csv");
    writeFileSync(p, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("a,b\n1,2", "utf16le")]));
    const r = await extractText(p);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("a,b\n1,2");
  });

  it("rejects binary bytes masquerading as text instead of ingesting mojibake", async () => {
    const p = join(dir, "fake.txt");
    writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0xfe, 0xff]));
    const r = await extractText(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/binary|encoding/i);
  });

  it("accepts a scanned (textless) PDF with placeholder text and a caveat note", async () => {
    // Real image-only single-page PDF (1×1 image, no text layer) — generated
    // once with macOS Quartz and checked in as a fixture.
    const fixture = join(__dirname, "fixtures", "scanned.pdf");
    const r = await extractText(fixture);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toMatch(/scanned pdf/i);
      expect(r.note).toMatch(/native pdf support/i);
    }
  });

  it("maps a corrupt PDF to a user-fit reason, not a library error", async () => {
    const p = join(dir, "broken.pdf");
    writeFileSync(p, "this is not a pdf");
    const r = await extractText(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/couldn't read this pdf/i);
  });

  it("maps a corrupt DOCX to a user-fit reason, not a library error", async () => {
    const p = join(dir, "broken.docx");
    writeFileSync(p, "this is not a zip");
    const r = await extractText(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/couldn't read this document/i);
  });

  it("extracts xlsx sheets as CSV with sheet headers", async () => {
    const mod: any = await import("xlsx");
    const XLSX = mod.default ?? mod;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["name", "qty"], ["apples", 3]]), "Inventory");
    const p = join(dir, "data.xlsx");
    writeFileSync(p, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

    const r = await extractText(p);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe("xlsx");
      expect(r.text).toContain("## Sheet: Inventory");
      expect(r.text).toContain("apples,3");
    }
  });

  it("maps a corrupt xlsx to a user-fit reason", async () => {
    const p = join(dir, "broken.xlsx");
    writeFileSync(p, "this is not a spreadsheet");
    const r = await extractText(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/couldn't read this spreadsheet/i);
  });
});
