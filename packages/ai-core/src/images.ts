import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";

const IMAGE_PATH_RE = /(?:^|\s)((?:\.?\/)?[\w\-./]+\.(?:png|jpg|jpeg|gif|webp|bmp))/gi;

const MIME_MAP: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
};

export function detectImages(text: string): string[] {
  const matches = [...text.matchAll(IMAGE_PATH_RE)];
  return matches.map(m => m[1]!).filter(p => existsSync(p));
}

export function encodeImage(path: string): { type: string; image_url: { url: string } } | null {
  if (!existsSync(path)) return null;
  const ext = extname(path).toLowerCase();
  const mime = MIME_MAP[ext] || "image/png";
  const data = readFileSync(path).toString("base64");
  return { type: "image_url", image_url: { url: `data:${mime};base64,${data}` } };
}

export function buildMultimodalContent(text: string, imagePaths: string[]): Array<{ type: string; text?: string; image_url?: { url: string } }> {
  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [{ type: "text", text }];
  for (const path of imagePaths) {
    const img = encodeImage(path);
    if (img) content.push(img);
  }
  return content;
}

export function stripImagePaths(text: string, paths: string[]): string {
  let result = text;
  for (const p of paths) result = result.replace(p, "").trim();
  return result;
}
