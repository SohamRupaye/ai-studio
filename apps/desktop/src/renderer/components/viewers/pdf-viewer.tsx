import { useEffect, useRef, useState } from "react";
// The LEGACY build is deliberate: pdf.js v6's modern build assumes brand-new
// JS built-ins (Uint8Array.prototype.toHex landed in Chromium ~140; the worker
// dies with "toHex is not a function" on anything older) — Electron 33 is
// Chromium 130. The legacy build ships the polyfills. Revisit on Electron 40+.
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import {
  ArrowsOutLineHorizontalIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
} from "@phosphor-icons/react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

// In-app PDF viewer — pdf.js pages rendered to canvas under our own chrome,
// replacing Chromium's <iframe> viewer (which brought its own toolbar and
// ignored the app's design language). Continuous scroll over a sunken well,
// pages as raised paper; zoom is fit-width by default with manual override.

GlobalWorkerOptions.workerSrc = workerUrl;

// Rendered-canvas budget: pages render only near the viewport and are freed
// when they leave it, so a hundred-page document doesn't hold a hundred
// full-resolution bitmaps in memory.
const RENDER_MARGIN = "1200px 0px";
const ZOOM_STEP = 1.2;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
/** Fit-width never upscales past 2× — beyond that a small page just blurs. */
const FIT_MAX = 2;
/** Horizontal breathing room around the widest page, in px (px-8 each side). */
const WELL_PADDING = 64;

interface LoadedPdf {
  doc: PDFDocumentProxy;
  /** Per page: the proxy plus its base (scale-1) CSS dimensions. */
  pages: Array<{ page: PDFPageProxy; width: number; height: number }>;
}

export function PdfViewer({ id }: { id: string }) {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [fitScale, setFitScale] = useState(1);
  /** Manual zoom level, or null while following fit-width. */
  const [zoom, setZoom] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pageElsRef = useRef<Array<HTMLDivElement | null>>([]);

  // Load bytes over IPC → parse. Destroying the loading task on cleanup tears
  // down its document and worker with it, whichever stage the load was in.
  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof getDocument> | null = null;
    setPdf(null);
    setFailed(null);
    setZoom(null);
    setCurrentPage(1);
    window.ipc
      .invoke("artifact:file", { id })
      .then(async (res) => {
        if (cancelled || !res) {
          if (!cancelled) setFailed("The original file is missing.");
          return;
        }
        const binary = atob(res.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        loadingTask = getDocument({ data: bytes });
        const doc = await loadingTask.promise;
        const pages = await Promise.all(
          Array.from({ length: doc.numPages }, async (_, i) => {
            const page = await doc.getPage(i + 1);
            const { width, height } = page.getViewport({ scale: 1 });
            return { page, width, height };
          }),
        );
        if (cancelled) return;
        setPdf({ doc, pages });
      })
      .catch((err: unknown) => {
        console.error("PDF load failed:", err);
        if (!cancelled) setFailed(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [id]);

  // Fit-width tracks the scroller's size (ResizeObserver fires once on
  // observe, so this also sets the initial scale).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !pdf) return;
    const maxPageWidth = Math.max(...pdf.pages.map((p) => p.width));
    const observer = new ResizeObserver(([entry]) => {
      const available = (entry?.contentRect.width ?? el.clientWidth) - WELL_PADDING;
      setFitScale(Math.min(Math.max(available / maxPageWidth, ZOOM_MIN), FIT_MAX));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [pdf]);

  const scale = zoom ?? fitScale;

  // "Page N of M" follows the page sitting in the upper part of the viewport.
  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const anchor = scroller.scrollTop + scroller.clientHeight * 0.4;
    let page = 1;
    pageElsRef.current.forEach((el, i) => {
      if (el && el.offsetTop <= anchor) page = i + 1;
    });
    setCurrentPage(page);
  };

  const stepZoom = (direction: 1 | -1) => {
    const next = scale * (direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP);
    setZoom(Math.min(Math.max(next, ZOOM_MIN), ZOOM_MAX));
  };

  if (failed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-8">
        <p className="text-body-md text-fg-subtle">Couldn&apos;t load the PDF.</p>
        <p className="max-w-md text-center text-body-sm text-fg-subtle">{failed}</p>
      </div>
    );
  }
  if (!pdf) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-fg-subtle">
        <Spinner size="sm" />
        <span className="text-body-sm">Loading PDF…</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center border-b border-line bg-surface-1 px-4 py-1.5">
        <span className="text-body-sm tabular-nums text-fg-muted">
          Page {currentPage} <span className="text-fg-subtle">of {pdf.pages.length}</span>
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            onClick={() => stepZoom(-1)}
            disabled={scale <= ZOOM_MIN}
          >
            <MagnifyingGlassMinusIcon size={16} />
          </Button>
          <span className="w-11 text-center text-body-sm tabular-nums text-fg-muted">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            onClick={() => stepZoom(1)}
            disabled={scale >= ZOOM_MAX}
          >
            <MagnifyingGlassPlusIcon size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Fit width"
            onClick={() => setZoom(null)}
            className={cn("ml-1", zoom === null && "bg-surface-3 text-fg")}
          >
            <ArrowsOutLineHorizontalIcon size={16} />
          </Button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-auto bg-sunken shadow-sunken"
      >
        <div className="flex min-w-fit flex-col items-center gap-5 px-8 py-8">
          {pdf.pages.map(({ page, width, height }, i) => (
            <PdfPage
              key={i}
              page={page}
              width={width}
              height={height}
              scale={scale}
              refCallback={(el) => (pageElsRef.current[i] = el)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PdfPage({
  page,
  width,
  height,
  scale,
  refCallback,
}: {
  page: PDFPageProxy;
  width: number;
  height: number;
  scale: number;
  refCallback: (el: HTMLDivElement | null) => void;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(entry?.isIntersecting ?? false),
      { rootMargin: RENDER_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Render when near the viewport, free the bitmap when it drifts away.
  // Cleanup cancels an in-flight render so a fast zoom/scroll never paints a
  // stale frame over a newer one.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!nearViewport) {
      canvas.width = 0;
      canvas.height = 0;
      setPainted(false);
      return;
    }
    let cancelled = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: scale * dpr });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const task = page.render({ canvas, viewport });
    task.promise.then(
      () => {
        if (!cancelled) setPainted(true);
      },
      () => {}, // cancelled renders reject; nothing to do
    );
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [nearViewport, scale, page]);

  return (
    <div
      ref={(el) => {
        holderRef.current = el;
        refCallback(el);
      }}
      style={{ width: Math.floor(width * scale), height: Math.floor(height * scale) }}
      className={cn(
        "relative shrink-0 overflow-hidden rounded-xs shadow-md",
        painted ? "bg-white" : "skeleton",
      )}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
