import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsInIcon,
  GraphIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import type { GraphEdgeInfo, GraphNodeInfo } from "@squirl/event-bus";
import { cn } from "../lib/utils";
import { useWorkspace } from "./workspace-provider";
import { useGraph } from "../hooks/use-ipc-data";
import { Drawer, DrawerBody, DrawerContent, DrawerHeader, DrawerTitle } from "./ui/drawer";
import { Input } from "./ui/input";

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge graph — the classifier's auto-extracted, embedding-linked
// decisions/constraints for this project (packages/graph-engine). Distinct
// from the Knowledge base: nothing here is authored, it fills in on its own
// as you chat. Force-directed layout computed once per data load (Fruchterman-
// Reingold, same algorithm the old static-SVG exporter used — that exporter
// is dead code against a pre-SQLite graph shape, not reused directly); pan
// and zoom are a single CSS transform, so interaction stays cheap regardless
// of node count. Hover highlights a node's neighborhood; clicking a domain in
// the legend isolates it; the search box dims everything that doesn't match.
// ─────────────────────────────────────────────────────────────────────────────

interface Pt { x: number; y: number }

function layout(nodeIds: number[], edges: GraphEdgeInfo[]): Map<number, Pt> {
  const pos = new Map<number, Pt>();
  const spread = Math.max(260, Math.sqrt(Math.max(1, nodeIds.length)) * 130);
  nodeIds.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, nodeIds.length);
    pos.set(id, { x: spread * 0.6 * Math.cos(angle), y: spread * 0.6 * Math.sin(angle) });
  });
  if (nodeIds.length <= 1) return pos;

  const k = Math.sqrt((spread * spread * 4) / nodeIds.length) * 0.9;
  let temp = spread / 5;
  for (let iter = 0; iter < 120; iter++) {
    const disp = new Map<number, Pt>();
    nodeIds.forEach((id) => disp.set(id, { x: 0, y: 0 }));

    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const pi = pos.get(nodeIds[i]!)!, pj = pos.get(nodeIds[j]!)!;
        const dx = pi.x - pj.x, dy = pi.y - pj.y;
        const dist = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
        const force = (k * k) / dist;
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        disp.get(nodeIds[i]!)!.x += fx; disp.get(nodeIds[i]!)!.y += fy;
        disp.get(nodeIds[j]!)!.x -= fx; disp.get(nodeIds[j]!)!.y -= fy;
      }
    }
    for (const e of edges) {
      const pi = pos.get(e.source), pj = pos.get(e.target);
      if (!pi || !pj) continue;
      const dx = pi.x - pj.x, dy = pi.y - pj.y;
      const dist = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
      const force = (dist * dist) / k;
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      disp.get(e.source)!.x -= fx; disp.get(e.source)!.y -= fy;
      disp.get(e.target)!.x += fx; disp.get(e.target)!.y += fy;
    }
    for (const id of nodeIds) {
      const d = disp.get(id)!;
      const dist = Math.max(0.01, Math.sqrt(d.x * d.x + d.y * d.y));
      const p = pos.get(id)!;
      p.x += (d.x / dist) * Math.min(dist, temp);
      p.y += (d.y / dist) * Math.min(dist, temp);
      p.x = Math.max(-spread, Math.min(spread, p.x));
      p.y = Math.max(-spread, Math.min(spread, p.y));
    }
    temp *= 0.94;
  }
  return pos;
}

function hashDomain(domain: string): number {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) hash = (hash * 31 + domain.charCodeAt(i)) | 0;
  return Math.abs(hash) % 8;
}

function domainColor(domain: string): string {
  if (!domain || domain === "unknown") return "var(--fg-subtle)";
  return `var(--viz-${hashDomain(domain) + 1})`;
}

function nodeLabel(n: GraphNodeInfo): string {
  const label = n.subtopic || n.domain || n.text || `#${n.id}`;
  return label.length > 24 ? `${label.slice(0, 24)}…` : label;
}

export function GraphPage() {
  const { activeProjectId } = useWorkspace();
  const { data, loading } = useGraph(activeProjectId);
  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 600 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const positions = useMemo(() => layout(nodes.map((n) => n.id), edges), [nodes, edges]);

  const degree = useMemo(() => {
    const d = new Map<number, number>();
    for (const n of nodes) d.set(n.id, 0);
    for (const e of edges) {
      d.set(e.source, (d.get(e.source) ?? 0) + 1);
      d.set(e.target, (d.get(e.target) ?? 0) + 1);
    }
    return d;
  }, [nodes, edges]);

  const neighborsOf = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const n of nodes) m.set(n.id, new Set());
    for (const e of edges) {
      m.get(e.source)?.add(e.target);
      m.get(e.target)?.add(e.source);
    }
    return m;
  }, [nodes, edges]);

  const domains = useMemo(
    () => [...new Set(nodes.map((n) => n.domain || "unknown"))].sort(),
    [nodes],
  );

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const centeredRef = useRef(false);

  useEffect(() => {
    if (nodes.length && !centeredRef.current) {
      centeredRef.current = true;
      setPan({ x: size.w / 2, y: size.h / 2 });
    }
  }, [nodes.length, size.w, size.h]);

  const recenter = () => setPan({ x: size.w / 2, y: size.h / 2 });

  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [isolatedDomain, setIsolatedDomain] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<GraphNodeInfo | null>(null);

  const matchesQuery = (n: GraphNodeInfo) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return n.text.toLowerCase().includes(q) || n.subtopic.toLowerCase().includes(q) || n.domain.toLowerCase().includes(q);
  };

  // Priority: hover (transient) > domain isolation > search. Only one filter
  // dims at a time — combining them adds more confusion than it saves.
  const nodeActive = (n: GraphNodeInfo): boolean => {
    if (hoveredId !== null) return n.id === hoveredId || (neighborsOf.get(hoveredId)?.has(n.id) ?? false);
    if (isolatedDomain) return (n.domain || "unknown") === isolatedDomain;
    if (query.trim()) return matchesQuery(n);
    return true;
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.min(4, Math.max(0.2, zoom * factor));
    setPan({ x: cx - ((cx - pan.x) / zoom) * newZoom, y: cy - ((cy - pan.y) / zoom) * newZoom });
    setZoom(newZoom);
  };

  const onBgPointerDown = (e: React.PointerEvent<SVGRectElement>) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
  };
  const onBgPointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.panX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.panY + (e.clientY - dragRef.current.startY),
    });
  };
  const onBgPointerUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-5">
        <div>
          <h1 className="text-heading-md text-fg">Knowledge graph</h1>
          <p className="mt-1 text-body-sm text-fg-muted">
            Decisions and topics the agent has extracted while you chat — fills in on its own.
            {nodes.length > 0 && (
              <span className="ml-1.5 font-mono text-[11px] text-fg-subtle">
                {nodes.length} nodes · {edges.length} connections
              </span>
            )}
          </p>
        </div>
        {nodes.length > 0 && (
          <div className="relative w-56 shrink-0">
            <MagnifyingGlassIcon size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <Input
              placeholder="Search nodes…"
              className="pl-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
      </header>

      {loading && !data ? null : nodes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex max-w-sm flex-col items-center gap-2 text-center">
            <GraphIcon size={28} className="text-fg-subtle" />
            <p className="text-body-sm text-fg-subtle">
              Nothing here yet. Decisions, constraints, and topics your agent extracts while you chat
              get linked here automatically.
            </p>
          </div>
        </div>
      ) : (
        <div className="relative flex-1">
          <div ref={containerRef} className="absolute inset-0">
            <svg
              width={size.w}
              height={size.h}
              viewBox={`0 0 ${size.w} ${size.h}`}
              onWheel={onWheel}
              className={cn("touch-none select-none", dragging ? "cursor-grabbing" : "cursor-grab")}
            >
              <rect
                x={0}
                y={0}
                width={size.w}
                height={size.h}
                fill="transparent"
                onPointerDown={onBgPointerDown}
                onPointerMove={onBgPointerMove}
                onPointerUp={onBgPointerUp}
                onPointerLeave={onBgPointerUp}
              />
              <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
                {edges.map((e, i) => {
                  const p1 = positions.get(e.source), p2 = positions.get(e.target);
                  if (!p1 || !p2) return null;
                  const srcNode = nodes.find((n) => n.id === e.source);
                  const tgtNode = nodes.find((n) => n.id === e.target);
                  const active = (srcNode && nodeActive(srcNode)) || (tgtNode && nodeActive(tgtNode));
                  return (
                    <line
                      key={i}
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke="var(--line-strong)"
                      strokeWidth={active ? 1.4 : 1}
                      strokeOpacity={active ? Math.max(0.4, e.weight) : 0.06}
                    />
                  );
                })}
                {nodes.map((n) => {
                  const p = positions.get(n.id);
                  if (!p) return null;
                  const r = Math.min(24, 9 + (degree.get(n.id) ?? 0) * 3);
                  const active = nodeActive(n);
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${p.x} ${p.y})`}
                      opacity={active ? 1 : 0.15}
                      className="cursor-pointer"
                      onPointerEnter={() => setHoveredId(n.id)}
                      onPointerLeave={() => setHoveredId((h) => (h === n.id ? null : h))}
                      onClick={() => setSelected(n)}
                    >
                      <circle
                        r={r}
                        fill={domainColor(n.domain)}
                        stroke="var(--surface-1)"
                        strokeWidth={selected?.id === n.id ? 2.5 : 1.25}
                      />
                      <text
                        y={r + 13}
                        textAnchor="middle"
                        fontSize={10}
                        className="pointer-events-none select-none"
                        fill="var(--fg-muted)"
                      >
                        {nodeLabel(n)}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>

          {/* Legend + recenter — floating chrome over the canvas, not a
              second panel competing with it. */}
          <div className="pointer-events-none absolute inset-4 flex flex-col justify-between">
            <div />
            <div className="flex items-end justify-between">
              <div className="pointer-events-auto flex max-w-[70%] flex-wrap gap-1.5">
                {domains.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setIsolatedDomain((cur) => (cur === d ? null : d))}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-label-sm transition-colors duration-100",
                      isolatedDomain === d
                        ? "border-line-strong bg-surface-2 text-fg"
                        : "border-line bg-surface-1 text-fg-muted hover:bg-surface-2",
                    )}
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ background: domainColor(d) }} />
                    {d}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={recenter}
                className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-2.5 py-1.5 text-label-sm text-fg-muted shadow-raised transition-colors duration-100 hover:bg-surface-2 hover:text-fg"
              >
                <ArrowsInIcon size={13} /> Recenter
              </button>
            </div>
          </div>
        </div>
      )}

      <Drawer open={selected !== null} onOpenChange={(open) => !open && setSelected(null)} modal={false}>
        <DrawerContent showBackdrop={false}>
          {selected && (
            <>
              <DrawerHeader className="border-b border-line">
                <div className="flex items-center gap-1.5 text-label-sm text-fg-subtle">
                  <span className="size-2 rounded-full" style={{ background: domainColor(selected.domain) }} />
                  {selected.domain || "unknown"}
                  {selected.subtopic && ` · ${selected.subtopic}`}
                </div>
                <DrawerTitle className="mt-1">{selected.text || nodeLabel(selected)}</DrawerTitle>
              </DrawerHeader>
              <DrawerBody className="space-y-5 py-4">
                {selected.history.length > 0 && (
                  <div>
                    <h3 className="text-label-md text-fg">History</h3>
                    <div className="mt-2 space-y-2">
                      {selected.history.map((h, i) => (
                        <div key={i} className="rounded-md border border-line bg-surface-1 px-3 py-2">
                          {h.turn !== undefined && (
                            <span className="font-mono text-[10px] text-fg-subtle">Turn {h.turn}</span>
                          )}
                          {h.decision && <p className="mt-0.5 text-body-sm text-fg">{h.decision}</p>}
                          {h.constraint && <p className="mt-0.5 text-body-sm text-fg-muted">{h.constraint}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <h3 className="text-label-md text-fg">
                    Connected ({neighborsOf.get(selected.id)?.size ?? 0})
                  </h3>
                  <div className="mt-2 space-y-0.5">
                    {[...(neighborsOf.get(selected.id) ?? [])].map((nid) => {
                      const neighbor = nodes.find((n) => n.id === nid);
                      if (!neighbor) return null;
                      return (
                        <button
                          key={nid}
                          type="button"
                          onClick={() => setSelected(neighbor)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-sm text-fg-muted transition-colors duration-100 hover:bg-surface-2 hover:text-fg"
                        >
                          <span className="size-1.5 shrink-0 rounded-full" style={{ background: domainColor(neighbor.domain) }} />
                          <span className="truncate">{nodeLabel(neighbor)}</span>
                        </button>
                      );
                    })}
                    {(neighborsOf.get(selected.id)?.size ?? 0) === 0 && (
                      <p className="px-2 text-body-sm text-fg-subtle">No connections yet.</p>
                    )}
                  </div>
                </div>
              </DrawerBody>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
