import { nativeImage } from "electron";
import { join } from "node:path";
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { dataDirPath, store } from "./state.js";

/** Image mime for a file extension (with leading dot), or null if unsupported. */
export function imageMime(ext: string): string | null {
  switch (ext) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    default: return null;
  }
}

// Providers hard-reject oversized images (Anthropic caps around 5MB), and the
// bytes ride every subsequent turn as base64 — so fit them at staging time.
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/** Image extension from magic bytes, or null if not a supported format. */
export function sniffImageExt(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return ".png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ".jpg";
  if (bytes.length >= 6 && bytes.subarray(0, 3).toString("ascii") === "GIF") return ".gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
  return null;
}

/**
 * Bytes for an image that fits IMAGE_MAX_BYTES, re-encoding/downscaling
 * PNG/JPEG as JPEG when needed (a returned buffer !== the input means it was
 * converted). Null when it can't be made to fit — GIF/WebP aren't resized
 * because that would strip animation.
 */
export function fitImageBytes(bytes: Buffer, ext: string): Buffer | null {
  if (bytes.byteLength <= IMAGE_MAX_BYTES) return bytes;
  if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg") return null;
  let img = nativeImage.createFromBuffer(bytes);
  if (img.isEmpty()) return null;
  for (let pass = 0; pass < 4; pass++) {
    const out = Buffer.from(img.toJPEG(80));
    if (out.byteLength <= IMAGE_MAX_BYTES) return out;
    const { width } = img.getSize();
    if (width <= 1) return null;
    img = img.resize({ width: Math.max(1, Math.round(width * 0.7)) });
  }
  return null;
}

/**
 * Blobs are written before any DB row references them (staged images before
 * send, upload originals before the artifact insert), so files get orphaned
 * by removed chips, abandoned drafts, deleted messages/branches, or a crash
 * between write and insert. Sweep whatever no row references — but only files
 * old enough that they can't belong to a draft still being composed.
 */
export function sweepOrphanBlobs() {
  const MIN_AGE_MS = 24 * 60 * 60 * 1000;
  try {
    const referenced = store.referencedBlobPaths();
    const dir = join(dataDirPath, "blobs");
    for (const name of readdirSync(dir)) {
      if (referenced.has(join("blobs", name))) continue;
      const abs = join(dir, name);
      try {
        if (Date.now() - statSync(abs).mtimeMs > MIN_AGE_MS) unlinkSync(abs);
      } catch { /* raced or unreadable — leave it for the next sweep */ }
    }
  } catch { /* sweep is best-effort housekeeping */ }
}
