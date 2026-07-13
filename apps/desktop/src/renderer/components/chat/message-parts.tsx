import { useEffect, useState } from "react";
import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { BrainIcon, LightningIcon, XIcon } from "@phosphor-icons/react";
import type { MessageImage } from "@ai-studio/shared";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Markdown } from "../ui/markdown";
import { Spinner } from "../ui/spinner";

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Base64 for IPC transport, chunked so large images don't blow the one-shot
 * String.fromCharCode argument limit. */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Time-of-day greeting for the empty state — the sketch's "Good morning,
// Soham!" moment. Name comes from the user profile; degrades to just the
// greeting when none is set.
export function greetingLine(name?: string): string {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return name ? `${greeting}, ${name}` : greeting;
}

/** Loads a staged/attached image blob (main has the bytes; the renderer has no
 * filesystem access) and renders it. Shows nothing until the data URL arrives. */
function BlobImage({ blobPath, alt, className }: { blobPath: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    window.ipc.invoke("attachment:data", { blobPath }).then((url) => { if (live) setSrc(url); });
    return () => { live = false; };
  }, [blobPath]);
  if (!src) return <div className={className} aria-label={alt} />;
  return <img src={src} alt={alt} className={className} />;
}

export function StagedImage({ blobPath, filename }: { blobPath: string; filename: string }) {
  return (
    <BlobImage
      blobPath={blobPath}
      alt={filename}
      className="size-16 rounded-lg border border-line object-cover"
    />
  );
}

/** A user message's text, with a leading "/skill" invocation rendered as a
 * chip when the name matches an installed skill (the message text itself IS
 * the command — no separate metadata to drift from it). */
export function UserMessageBody({ text, skillNames }: { text: string; skillNames: ReadonlySet<string> }) {
  const match = /^\/([\w-]+)[ \t]*([\s\S]*)$/.exec(text);
  if (!match || !skillNames.has(match[1]!)) return <Markdown text={text} />;
  return (
    <div>
      <span className="mb-1 inline-flex items-center gap-1 rounded-full border border-line bg-surface-1 px-2.5 py-0.5 font-mono text-[12px] text-fg">
        <LightningIcon size={12} weight="fill" />
        {match[1]}
      </span>
      {match[2] ? <Markdown text={match[2]} /> : null}
    </div>
  );
}

/** A turn's images, rendered ABOVE the bubble (never inside it — an image
 * inside MessageContent stretches the bubble around long text). Click opens
 * the fullscreen viewer. Follows the Message's own role alignment. */
export function MessageImages({
  images,
  onOpen,
}: {
  images: MessageImage[];
  onOpen: (image: MessageImage) => void;
}) {
  return (
    <div className="flex max-w-[85%] flex-wrap gap-2 in-data-[role=user]:justify-end">
      {images.map((img) => (
        <button
          key={img.blobPath}
          type="button"
          aria-label={`View ${img.filename} fullscreen`}
          onClick={() => onOpen(img)}
          className="cursor-zoom-in overflow-hidden rounded-md border border-line transition-opacity hover:opacity-90"
        >
          <BlobImage blobPath={img.blobPath} alt={img.filename} className="max-h-48 object-contain" />
        </button>
      ))}
    </div>
  );
}

/** Fullscreen image viewer — Escape, the close button, or a click anywhere
 * dismisses it. */
export function ImageLightbox({
  image,
  onClose,
}: {
  image: MessageImage | null;
  onClose: () => void;
}) {
  return (
    <BaseDialog.Root open={image !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/80 data-[open]:animate-fade-in data-[closed]:animate-fade-out" />
        <BaseDialog.Popup
          className="fixed inset-0 z-50 flex cursor-zoom-out flex-col items-center justify-center gap-3 p-8 outline-none data-[open]:animate-fade-in data-[closed]:animate-fade-out"
          onClick={onClose}
        >
          {image && (
            <>
              <BlobImage
                blobPath={image.blobPath}
                alt={image.filename}
                className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-xl"
              />
              <span className="text-body-sm text-white/70 select-none">{image.filename}</span>
            </>
          )}
          <BaseDialog.Close
            aria-label="Close"
            className="pressable absolute right-4 top-4 flex size-8 items-center justify-center rounded-md bg-black/50 text-white/80 hover:bg-black/70 hover:text-white"
          >
            <XIcon size={18} />
          </BaseDialog.Close>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

/** The model's reasoning for a turn. Live (while no reply text yet) it stays
 * open and follows the stream; once the answer starts — and on persisted
 * messages — it rests collapsed. A user toggle always wins. */
export function ThinkingBlock({ text, live }: { text: string; live?: boolean }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  return (
    <Collapsible
      open={userOpen ?? live ?? false}
      onOpenChange={(o) => setUserOpen(o)}
      className="mb-1.5"
    >
      <CollapsibleTrigger className="py-1">
        {live ? <Spinner size="sm" /> : <BrainIcon size={12} />}
        {live ? "Thinking…" : "Thinking"}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="border-l border-line py-1.5 pl-4 pr-1 pt-2 text-body-sm text-fg-muted [&_*]:text-body-sm">
          <Markdown text={text.trim()} />
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

export function TypingDots() {
  return (
    <span className="flex items-center gap-1 px-1 py-1.5" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{ animationDelay: `${i * 150}ms` }}
          className="size-1.5 animate-typing rounded-full bg-fg-subtle"
        />
      ))}
    </span>
  );
}
