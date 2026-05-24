/**
 * render_graph.ts — Render knowledge graph to SVG.
 * Uses force-directed layout (Fruchterman-Reingold) and outputs SVG.
 */

import { writeFileSync } from "node:fs";
import { MetaGraph } from "./graph.js";

interface Vec2 { x: number; y: number }

function domainColor(domain: string): string {
  if (!domain || domain === "unknown") return "#90a4ae";
  let hash = 0;
  for (let i = 0; i < domain.length; i++) hash = ((hash << 5) - hash + domain.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 62%)`;
}

function layout(nodeIds: number[], edges: Array<{ source: number; target: number; weight: number }>, width: number, height: number): Map<number, Vec2> {
  const pos = new Map<number, Vec2>();
  nodeIds.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / nodeIds.length;
    pos.set(id, { x: width / 2 + (width * 0.35) * Math.cos(angle), y: height / 2 + (height * 0.35) * Math.sin(angle) });
  });

  if (nodeIds.length <= 1) return pos;

  const iterations = 100;
  const k = Math.sqrt((width * height) / nodeIds.length) * 0.8;
  let temp = width / 10;

  for (let iter = 0; iter < iterations; iter++) {
    const disp = new Map<number, Vec2>();
    nodeIds.forEach(id => disp.set(id, { x: 0, y: 0 }));

    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const pi = pos.get(nodeIds[i]!)!;
        const pj = pos.get(nodeIds[j]!)!;
        const dx = pi.x - pj.x;
        const dy = pi.y - pj.y;
        const dist = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
        const force = (k * k) / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        disp.get(nodeIds[i]!)!.x += fx;
        disp.get(nodeIds[i]!)!.y += fy;
        disp.get(nodeIds[j]!)!.x -= fx;
        disp.get(nodeIds[j]!)!.y -= fy;
      }
    }

    for (const edge of edges) {
      const pi = pos.get(edge.source);
      const pj = pos.get(edge.target);
      if (!pi || !pj) continue;
      const dx = pi.x - pj.x;
      const dy = pi.y - pj.y;
      const dist = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
      const force = (dist * dist) / k;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      disp.get(edge.source)!.x -= fx;
      disp.get(edge.source)!.y -= fy;
      disp.get(edge.target)!.x += fx;
      disp.get(edge.target)!.y += fy;
    }

    for (const id of nodeIds) {
      const d = disp.get(id)!;
      const dist = Math.max(0.01, Math.sqrt(d.x * d.x + d.y * d.y));
      const p = pos.get(id)!;
      p.x += (d.x / dist) * Math.min(dist, temp);
      p.y += (d.y / dist) * Math.min(dist, temp);
      p.x = Math.max(60, Math.min(width - 60, p.x));
      p.y = Math.max(60, Math.min(height - 60, p.y));
    }
    temp *= 0.95;
  }
  return pos;
}

export function renderGraph(graph: MetaGraph, outputPath = "meta_graph.svg"): string {
  const summary = graph.summary();
  if (summary.nodeCount === 0) return "No nodes in graph — nothing to render.";

  const width = 1200;
  const height = 800;

  const nodes = (graph as any).nodes as Map<number, any>;
  const edges = (graph as any).edges as Array<{ source: number; target: number; weight: number }>;
  const nodeIds = [...nodes.keys()];

  const pos = layout(nodeIds, edges, width, height);

  const degrees = new Map<number, number>();
  nodeIds.forEach(id => degrees.set(id, 0));
  for (const e of edges) {
    degrees.set(e.source, (degrees.get(e.source) || 0) + 1);
    degrees.set(e.target, (degrees.get(e.target) || 0) + 1);
  }

  const svgParts: string[] = [];
  svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  svgParts.push(`<rect width="100%" height="100%" fill="#1a1a2e"/>`);

  for (const edge of edges) {
    const p1 = pos.get(edge.source);
    const p2 = pos.get(edge.target);
    if (!p1 || !p2) continue;
    const opacity = Math.max(0.2, edge.weight);
    svgParts.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#455a64" stroke-opacity="${opacity}" stroke-width="2"/>`);
  }

  for (const id of nodeIds) {
    const p = pos.get(id)!;
    const node = nodes.get(id)!;
    const color = domainColor(node.domain);
    const r = Math.max(12, 8 + (degrees.get(id) || 0) * 4);
    const label = node.subtopic || node.meta?.topic || String(id);
    svgParts.push(`<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${color}" stroke="white" stroke-width="0.5"/>`);
    svgParts.push(`<text x="${p.x}" y="${p.y + r + 14}" text-anchor="middle" fill="white" font-size="10" font-family="sans-serif">${escapeXml(String(label).slice(0, 20))}</text>`);
  }

  const domains = [...new Set([...nodes.values()].map((n: any) => n.domain))].sort();
  let ly = 30;
  for (const domain of domains) {
    const color = domainColor(domain as string);
    svgParts.push(`<circle cx="30" cy="${ly}" r="6" fill="${color}"/>`);
    svgParts.push(`<text x="42" y="${ly + 4}" fill="white" font-size="11" font-family="sans-serif">${escapeXml(domain as string)}</text>`);
    ly += 20;
  }

  svgParts.push(`<text x="${width / 2}" y="30" text-anchor="middle" fill="white" font-size="16" font-family="sans-serif" font-weight="bold">Meta Knowledge Graph</text>`);
  svgParts.push("</svg>");

  const svg = svgParts.join("\n");
  writeFileSync(outputPath, svg);
  return `Saved -> ${outputPath} (${summary.nodeCount} nodes, ${summary.edgeCount} edges)`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
