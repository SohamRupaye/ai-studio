// File ingestion: turn an uploaded file into prompt-ready text.
//
// This is the "parse once, store text" half of file support. Documents whose
// meaning lives in their text (plain text, code, data, and the text layer of
// PDFs / Word docs) become a text artifact that flows through the exact same
// prompt/selection machinery as agent-extracted artifacts — so it works on
// every provider, not just the few with native document input.
//
// Deliberately Electron-free so it can be unit-tested directly. pdf-parse,
// mammoth, and xlsx are loaded lazily inside their branches: the common text
// path pulls in no heavy dependency, and none of them run at process startup.
import { open } from "node:fs/promises";
import { extname } from "node:path";

export type IngestKind = "text" | "pdf" | "docx" | "xlsx";

/** Upload ceiling. Bounds memory (files are read whole), DB row size, and the
 * per-turn token estimation that runs over stored artifact text. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export type IngestResult =
  /** `note`, when set, is a caveat worth showing the user (e.g. a scanned PDF
   * that only natively-PDF-capable models can actually read). */
  | { ok: true; kind: IngestKind; text: string; mime: string; note?: string }
  | { ok: false; reason: string };

// Extensions we read straight as UTF-8 text. The original file and its text are
// identical, so these never need a preserved blob copy.
const TEXT_EXTS = new Set([
  ".txt", ".text", ".md", ".markdown", ".mdx", ".rst",
  ".csv", ".tsv", ".json", ".jsonl", ".ndjson", ".yaml", ".yml", ".toml", ".ini", ".env",
  ".xml", ".html", ".htm", ".svg",
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".rb", ".go", ".rs",
  ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".php", ".swift",
  ".sh", ".bash", ".zsh", ".sql", ".css", ".scss", ".less", ".vue", ".astro",
  ".gradle", ".dockerfile", ".makefile", ".r", ".lua", ".pl", ".dart",
]);

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".html": "text/html",
  ".htm": "text/html",
  ".xml": "application/xml",
};

/** Which extensions the picker should offer (no leading dot). */
export function acceptedExtensions(): string[] {
  return [...[...TEXT_EXTS].map((e) => e.slice(1)), "pdf", "docx", "xlsx", "xls"].sort();
}

export function mimeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  return MIME_BY_EXT[ext] ?? (TEXT_EXTS.has(ext) ? "text/plain" : "application/octet-stream");
}

/** Kind we know how to parse, or null for anything unsupported. */
export function classify(path: string): IngestKind | null {
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".xlsx" || ext === ".xls") return "xlsx";
  if (TEXT_EXTS.has(ext)) return "text";
  return null;
}

/** True when the extracted text is the whole original (so no blob is needed). */
export function isLossless(kind: IngestKind): boolean {
  return kind === "text";
}

/**
 * Decode bytes to text, honouring UTF-16 BOMs (Excel's default CSV export on
 * Windows is UTF-16LE). Returns null when the bytes aren't text we can decode:
 * NULs or replacement characters mean a binary file or a foreign encoding, and
 * silently injecting mojibake into the prompt as "authoritative source
 * material" is worse than refusing.
 */
function decodeText(buf: Buffer): string | null {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return Buffer.from(buf.subarray(2)).swap16().toString("utf16le");
  }
  const text = buf.toString("utf8");
  return text.includes("\u0000") || text.includes("\uFFFD") ? null : text;
}

/**
 * Extract text from a file. Returns { ok: false, reason } for anything we
 * can't turn into useful text — an unsupported type, a legacy .doc, an image —
 * with a message fit to show a user. A scanned (image-only) PDF is the one
 * accepted-with-caveat case: it yields placeholder text plus a `note`, because
 * its preserved blob is still readable by natively-PDF-capable models.
 */
export async function extractText(path: string): Promise<IngestResult> {
  const ext = extname(path).toLowerCase();
  const kind = classify(path);

  if (!kind) {
    if (ext === ".doc") {
      return { ok: false, reason: "Legacy .doc isn't supported — re-save as .docx." };
    }
    if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".tiff"].includes(ext)) {
      return { ok: false, reason: "Images attach via “Add photos”, not file upload." };
    }
    return { ok: false, reason: `Unsupported file type (${ext || "no extension"}).` };
  }

  try {
    let buf: Buffer;
    const fh = await open(path, "r");
    try {
      const { size } = await fh.stat();
      if (size > MAX_FILE_BYTES) {
        return { ok: false, reason: `File is too large (max ${MAX_FILE_BYTES / 1024 / 1024}MB).` };
      }
      buf = await fh.readFile();
    } finally {
      await fh.close();
    }

    if (kind === "text") {
      const text = decodeText(buf);
      if (text === null) {
        return { ok: false, reason: "File isn't readable text — it looks binary or uses an unsupported encoding." };
      }
      if (!text.trim()) return { ok: false, reason: "File is empty." };
      return { ok: true, kind, text, mime: mimeFor(path) };
    }

    if (kind === "pdf") {
      // Import the library file directly, not the package index — the index
      // runs a debug harness that reads a bundled test PDF when it thinks it's
      // the main module, which throws in a packaged app.
      const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (
        b: Buffer,
      ) => Promise<{ text: string }>;
      const { text } = await pdfParse(buf);
      if (!text.trim()) {
        // Scanned (image-only) PDF: nothing to extract, but the preserved
        // blob still rides natively on models that read PDFs themselves
        // (Claude, Gemini — they OCR server-side), so accept it. The
        // placeholder keeps other models honest about what they can't see.
        return {
          ok: true,
          kind,
          text: "[Scanned PDF — no extractable text layer. Models with native PDF support (Claude, Gemini) read the original directly; other models cannot see this document's contents.]",
          mime: "application/pdf",
          note: "Scanned PDF (no text layer) — readable only by models with native PDF support, like Claude or Gemini.",
        };
      }
      return { ok: true, kind, text, mime: "application/pdf" };
    }

    if (kind === "xlsx") {
      // SheetJS happily "parses" arbitrary bytes by falling back to CSV, so
      // require a real container first: ZIP (.xlsx) or CFB (.xls).
      const isZip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b;
      const isCfb = buf.length >= 2 && buf[0] === 0xd0 && buf[1] === 0xcf;
      if (!isZip && !isCfb) {
        return { ok: false, reason: "Couldn't read this spreadsheet — it may be corrupted or password-protected." };
      }
      // CJS module — the callable API may sit on `default` or the namespace
      // depending on the bundler, so accept either.
      const mod: any = await import("xlsx");
      const XLSX = mod.default ?? mod;
      const workbook = XLSX.read(buf, { type: "buffer" });
      const parts: string[] = [];
      for (const name of workbook.SheetNames) {
        const csv: string = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
        if (csv.trim()) parts.push(`## Sheet: ${name}\n${csv.trim()}`);
      }
      if (!parts.length) return { ok: false, reason: "No data found in the spreadsheet." };
      return { ok: true, kind, text: parts.join("\n\n"), mime: mimeFor(path) };
    }

    // docx
    const mammoth = (await import("mammoth")).default as {
      extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>;
    };
    const { value } = await mammoth.extractRawText({ buffer: buf });
    if (!value.trim()) return { ok: false, reason: "No text found in the document." };
    return { ok: true, kind, text: value, mime: mimeFor(path) };
  } catch (err) {
    // Library errors are developer-speak ("Invalid PDF structure") — map the
    // known cases to something a user can act on.
    const detail = err instanceof Error ? err.message : "";
    if (kind === "pdf") {
      if (/password|encrypt/i.test(detail)) {
        return { ok: false, reason: "This PDF is password-protected — remove the password and re-upload." };
      }
      return { ok: false, reason: "Couldn't read this PDF — it may be corrupted." };
    }
    if (kind === "docx") {
      return { ok: false, reason: "Couldn't read this document — it may be corrupted or not a real .docx." };
    }
    if (kind === "xlsx") {
      return { ok: false, reason: "Couldn't read this spreadsheet — it may be corrupted or password-protected." };
    }
    return { ok: false, reason: detail || "Couldn't read the file." };
  }
}
