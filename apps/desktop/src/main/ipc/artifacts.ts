import { dialog, shell } from "electron";
import { basename, extname, join, sep } from "node:path";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import type { MessageImage } from "@squirl/shared";
import { estimateTokens } from "@squirl/tokenizer";
import { acceptedExtensions, extractText, isLossless } from "../ingestion.js";
import { fitImageBytes, imageMime, IMAGE_MAX_BYTES, sniffImageExt } from "../images.js";
import { handle } from "./handle.js";
import { mainWindow, store, dataDirPath } from "../state.js";

export function registerArtifactHandlers() {
  // ── Image attachments ─────────────────────────────────────────────────────────

  // Shared staging core: fit the bytes (downscaling oversized PNG/JPEG), write
  // them into data/blobs atomically, and return the reference — or a reason.
  const stageImage = (
    bytes: Buffer,
    ext: string,
    filename: string,
  ): { ok: true; image: MessageImage } | { ok: false; reason: string } => {
    let mediaType = imageMime(ext);
    if (!mediaType) return { ok: false, reason: "Unsupported image type." };
    const fitted = fitImageBytes(bytes, ext);
    if (!fitted) {
      return { ok: false, reason: `Image is too large (max ${IMAGE_MAX_BYTES / 1024 / 1024}MB).` };
    }
    if (fitted !== bytes) { bytes = fitted; ext = ".jpg"; mediaType = "image/jpeg"; }
    const id = randomUUID();
    const rel = join("blobs", `${id}${ext}`);
    const abs = join(dataDirPath, rel);
    writeFileSync(`${abs}.tmp`, bytes);
    renameSync(`${abs}.tmp`, abs);
    return { ok: true, image: { blobPath: rel, mediaType, filename } };
  };

  // Stage images and return references; the refs ride the next chat:send.
  // Drag-drop passes `paths` directly; without them a native picker opens.
  // (Documents go through artifact:upload instead — images can't become text
  // artifacts.) Anything unfittable or unreadable comes back in `skipped`.
  handle("image:stage", async ({ paths }) => {
    const staged: MessageImage[] = [];
    const skipped: Array<{ filename: string; reason: string }> = [];
    let files = paths ?? [];
    if (!files.length) {
      if (!mainWindow) return { staged, skipped };
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: "Attach images",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
      });
      if (canceled) return { staged, skipped };
      files = filePaths;
    }
    for (const p of files) {
      const filename = basename(p);
      try {
        const result = stageImage(readFileSync(p), extname(p).toLowerCase(), filename);
        if (result.ok) staged.push(result.image);
        else skipped.push({ filename, reason: result.reason });
      } catch {
        skipped.push({ filename, reason: "Couldn't read the file." });
      }
    }
    return { staged, skipped };
  });

  // Stage images from raw bytes — pasted bitmaps and drags with no backing
  // file. The extension comes from the filename when it carries one, else
  // from the magic bytes (pasted screenshots are typically nameless PNGs).
  handle("image:stage-data", ({ images }) => {
    const staged: MessageImage[] = [];
    const skipped: Array<{ filename: string; reason: string }> = [];
    for (const { filename, dataBase64 } of images) {
      try {
        const bytes = Buffer.from(dataBase64, "base64");
        const ext = imageMime(extname(filename).toLowerCase()) ? extname(filename).toLowerCase() : sniffImageExt(bytes);
        if (!ext) { skipped.push({ filename, reason: "Unsupported image type." }); continue; }
        const result = stageImage(bytes, ext, filename);
        if (result.ok) staged.push(result.image);
        else skipped.push({ filename, reason: result.reason });
      } catch {
        skipped.push({ filename, reason: "Couldn't read the image data." });
      }
    }
    return { staged, skipped };
  });

  // Serve a staged/attached image back to the renderer as a data URL. Scoped to
  // the blobs dir so a crafted blobPath can't read arbitrary files.
  handle("attachment:data", ({ blobPath }) => {
    try {
      const abs = join(dataDirPath, blobPath);
      // Trailing separator so a sibling like "blobs-x/…" can't pass the check.
      if (!abs.startsWith(join(dataDirPath, "blobs") + sep)) return null;
      const mediaType = imageMime(extname(abs).toLowerCase()) ?? "application/octet-stream";
      return `data:${mediaType};base64,${readFileSync(abs).toString("base64")}`;
    } catch { return null; }
  });

  // ── Artifacts ───────────────────────────────────────────────────────────────

  handle("artifact:list", ({ projectId }) => store.listArtifacts(projectId));
  handle("artifact:get", ({ id }) => store.getArtifact(id) ?? null);
  handle("artifact:update", ({ id, content, title }) => { store.updateArtifact(id, content, title); });
  handle("artifact:rename", ({ id, title }) => { store.renameArtifact(id, title); });
  handle("artifact:delete", ({ id }) => store.deleteArtifact(id));

  // Resolve an artifact's preserved-original blob to an absolute path, scoped
  // to the blobs dir so a tampered row can't point the reader elsewhere.
  const artifactBlobAbs = (id: string): { abs: string; mime: string } | null => {
    const artifact = store.getArtifact(id);
    if (!artifact?.blobPath) return null;
    const abs = join(dataDirPath, artifact.blobPath);
    if (!abs.startsWith(join(dataDirPath, "blobs") + sep)) return null;
    return { abs, mime: artifact.mime ?? "application/octet-stream" };
  };

  // Original bytes (base64) for the renderer to render — e.g. a PDF turned
  // into a blob: URL for the built-in viewer. Null when no original was kept.
  handle("artifact:file", ({ id }) => {
    const resolved = artifactBlobAbs(id);
    if (!resolved) return null;
    try {
      return { base64: readFileSync(resolved.abs).toString("base64"), mime: resolved.mime };
    } catch { return null; }
  });

  // Convert a preserved .docx original to display HTML for the in-app viewer.
  // mammoth generates markup from a fixed tag whitelist (and escapes all text),
  // so the result is safe to inject; embedded images arrive as data: URLs,
  // which the CSP's img-src already allows. Lazy import, same as ingestion.
  handle("artifact:docx-html", async ({ id }) => {
    const resolved = artifactBlobAbs(id);
    if (!resolved || !resolved.mime.includes("wordprocessingml")) return null;
    try {
      const mammoth = (await import("mammoth")).default as {
        convertToHtml(input: { buffer: Buffer }): Promise<{ value: string }>;
      };
      const { value } = await mammoth.convertToHtml({ buffer: readFileSync(resolved.abs) });
      return value.trim() ? { html: value } : null;
    } catch {
      return null;
    }
  });

  handle("artifact:reveal", ({ id }) => {
    const resolved = artifactBlobAbs(id);
    if (!resolved) return false;
    shell.showItemInFolder(resolved.abs);
    return true;
  });

  handle("artifact:open-external", async ({ id }) => {
    const resolved = artifactBlobAbs(id);
    if (!resolved) return false;
    // Empty string = success; anything else is the OS error message.
    const err = await shell.openPath(resolved.abs);
    return err === "";
  });

  // Attach files to a branch: parse each to text, preserve non-text originals
  // as blobs, persist as artifacts, and auto-select them so the next turn sees
  // them. Order per file: extract text → (write blob) → insert row → select.
  handle("artifact:upload", async ({ branchId, paths }) => {
    const created: Array<{ id: string; title: string; type: string; note?: string }> = [];
    const skipped: Array<{ filename: string; reason: string }> = [];
    const branch = store.getBranch(branchId);
    const chat = branch?.chatId ? store.getChat(branch.chatId) : undefined;
    if (!branch || !chat) return { created, skipped };

    let files = paths ?? [];
    if (!files.length) {
      if (!mainWindow) return { created, skipped };
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: "Attach files to this branch",
        properties: ["openFile", "multiSelections"],
        filters: [
          { name: "Documents", extensions: acceptedExtensions() },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (canceled) return { created, skipped };
      files = filePaths;
    }

    const selection = [...branch.selectedArtifacts];
    let selectionChanged = false;
    for (const filePath of files) {
      const filename = basename(filePath);
      const result = await extractText(filePath);
      if (!result.ok) { skipped.push({ filename, reason: result.reason }); continue; }
      try {
        const id = randomUUID();
        const bytes = readFileSync(filePath);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        // Same bytes already on this branch: re-select the existing artifact
        // instead of duplicating it (and its context cost).
        const existing = store.findUploadedArtifactBySha(branchId, sha256);
        if (existing) {
          if (!selection.includes(existing.id)) { selection.push(existing.id); selectionChanged = true; }
          skipped.push({ filename, reason: "Already attached to this branch." });
          continue;
        }
        let blobPath: string | null = null;
        // Text uploads need no blob — the extracted text IS the whole original.
        // For PDF/DOCX the original carries layout the text can't, so keep it:
        // temp-write then atomic rename, before the row exists.
        if (!isLossless(result.kind)) {
          const rel = join("blobs", `${id}${extname(filePath).toLowerCase()}`);
          const abs = join(dataDirPath, rel);
          writeFileSync(`${abs}.tmp`, bytes);
          renameSync(`${abs}.tmp`, abs);
          blobPath = rel;
        }
        store.createUploadedArtifact({
          id, branchId, projectId: chat.projectId, type: "document",
          title: filename, content: result.text, originalFilename: filename,
          mime: result.mime, blobPath, byteSize: bytes.byteLength, sha256,
        });
        selection.push(id);
        selectionChanged = true;
        created.push({ id, title: filename, type: "document", note: result.note });
      } catch (err) {
        skipped.push({ filename, reason: err instanceof Error ? err.message : "Couldn't save the file." });
      }
    }
    if (selectionChanged) store.setSelectedArtifacts(branchId, selection);
    return { created, skipped };
  });

  // The whole project's artifacts (selection can pull docs from any branch)
  // plus this branch's current selection. Token estimates let the panel
  // project the context cost of a selection change before the next turn.
  handle("artifact:for-branch", ({ branchId }) => {
    const branch = store.getBranch(branchId);
    const chat = branch?.chatId ? store.getChat(branch.chatId) : undefined;
    if (!branch || !chat) return { selected: [], artifacts: [] };
    const artifacts = store.listArtifacts(chat.projectId).map((a: any) => ({
      id: a.id as string,
      type: a.type as string,
      title: a.title as string,
      version: a.version as number,
      updatedAt: a.updatedAt as number,
      tokens: estimateTokens(store.getArtifact(a.id)?.content ?? ""),
      fromThisBranch: a.branchId === branchId,
      source: (a.source as string) ?? "extracted",
    }));
    // This branch's own artifacts first, then the rest, newest first.
    artifacts.sort((x, y) => Number(y.fromThisBranch) - Number(x.fromThisBranch) || y.updatedAt - x.updatedAt);
    return { selected: branch.selectedArtifacts, artifacts };
  });
  handle("branch:artifacts-set", ({ branchId, artifactIds }) => {
    store.setSelectedArtifacts(branchId, artifactIds);
  });
}
