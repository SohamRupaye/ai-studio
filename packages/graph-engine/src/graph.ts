import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface GraphNode {
  id: number;
  text: string;
  embedding: number[];
  domain: string;
  subtopic: string;
  meta: Record<string, unknown>;
  history: Array<{ turn?: number; decision?: string; constraint?: string }>;
}

export interface GraphEdge {
  source: number;
  target: number;
  weight: number;
}

const SIMILARITY_THRESHOLD = 0.35;
const MERGE_THRESHOLD = 0.88;

let embedPipeline: any = null;
let embedAvailable = true;

async function getEmbedder() {
  if (!embedAvailable) return null;
  if (!embedPipeline) {
    try {
      const { pipeline } = await import("@huggingface/transformers");
      embedPipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "fp32" });
    } catch {
      embedAvailable = false;
      return null;
    }
  }
  return embedPipeline;
}

export async function embed(text: string): Promise<number[]> {
  const embedder = await getEmbedder();
  if (!embedder) return [];
  const output = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array).slice(0, 384);
}

export function cosineSim(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

const GRAPH_SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
  id        INTEGER PRIMARY KEY,
  text      TEXT NOT NULL,
  embedding BLOB NOT NULL,
  domain    TEXT NOT NULL DEFAULT '',
  subtopic  TEXT NOT NULL DEFAULT '',
  meta      TEXT NOT NULL DEFAULT '{}',
  history   TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS edges (
  source INTEGER NOT NULL,
  target INTEGER NOT NULL,
  weight REAL NOT NULL,
  PRIMARY KEY (source, target)
);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
`;

function float32ToBuffer(arr: number[]): Buffer {
  const buf = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) buf.writeFloatLE(arr[i]!, i * 4);
  return buf;
}

function bufferToFloat32(buf: Buffer): number[] {
  const arr: number[] = [];
  for (let i = 0; i < buf.length; i += 4) arr.push(buf.readFloatLE(i));
  return arr;
}

export class MetaGraph {
  private db: Database.Database;
  private nodeCache = new Map<number, GraphNode>();

  constructor(dataDir?: string) {
    const dir = dataDir ?? join(process.cwd(), "data", "graphs");
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "graph.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(GRAPH_SCHEMA);
  }

  async addNode(id: number, meta: Record<string, unknown>): Promise<{ merged: boolean; edges: GraphEdge[] }> {
    const text = this.buildText(meta);
    const embedding = await embed(text);
    if (!embedding.length) return { merged: false, edges: [] };

    const [domain, subtopic] = this.parseDomain(meta["topic"] as string || "");

    // Check for merge candidate
    let bestSim = 0, bestId: number | null = null;
    const allNodes = this.db.prepare("SELECT id, embedding FROM nodes").all() as any[];
    for (const row of allNodes) {
      const nodeEmb = bufferToFloat32(row.embedding);
      const sim = cosineSim(embedding, nodeEmb);
      if (sim > bestSim) { bestSim = sim; bestId = row.id; }
    }

    if (bestId !== null && bestSim >= MERGE_THRESHOLD) {
      const existing = this.getNode(bestId)!;
      const mergedMeta = { ...existing.meta, ...meta };
      const history = [...existing.history];
      if (meta["decision"]) history.push({ turn: meta["_turn"] as number, decision: meta["decision"] as string });
      if (meta["constraint"]) history.push({ turn: meta["_turn"] as number, constraint: meta["constraint"] as string });
      this.db.prepare("UPDATE nodes SET meta = ?, history = ? WHERE id = ?")
        .run(JSON.stringify(mergedMeta), JSON.stringify(history), bestId);
      this.nodeCache.delete(bestId);
      return { merged: true, edges: [] };
    }

    // Insert new node
    const history: GraphNode["history"] = [];
    if (meta["decision"]) history.push({ turn: meta["_turn"] as number, decision: meta["decision"] as string });
    if (meta["constraint"]) history.push({ turn: meta["_turn"] as number, constraint: meta["constraint"] as string });

    this.db.prepare("INSERT OR REPLACE INTO nodes (id, text, embedding, domain, subtopic, meta, history) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, text, float32ToBuffer(embedding), domain, subtopic, JSON.stringify(meta), JSON.stringify(history));

    // Create edges
    const newEdges: GraphEdge[] = [];
    for (const row of allNodes) {
      if (row.id === id) continue;
      const nodeEmb = bufferToFloat32(row.embedding);
      const sim = cosineSim(embedding, nodeEmb);
      if (sim >= SIMILARITY_THRESHOLD) {
        const weight = Math.round(sim * 1000) / 1000;
        this.db.prepare("INSERT OR IGNORE INTO edges (source, target, weight) VALUES (?, ?, ?)")
          .run(id, row.id, weight);
        newEdges.push({ source: id, target: row.id, weight });
      }
    }

    return { merged: false, edges: newEdges };
  }

  query(_text: string, _topK = 5): Array<{ id: number; score: number; meta: Record<string, unknown> }> {
    return [];
  }

  async queryAsync(text: string, topK = 5): Promise<Array<{ id: number; score: number; meta: Record<string, unknown> }>> {
    const emb = await embed(text);
    if (!emb.length) return [];

    const rows = this.db.prepare("SELECT id, embedding, meta FROM nodes").all() as any[];
    const scored: Array<{ id: number; score: number; meta: Record<string, unknown> }> = [];
    for (const row of rows) {
      const nodeEmb = bufferToFloat32(row.embedding);
      const score = cosineSim(emb, nodeEmb);
      scored.push({ id: row.id, score, meta: JSON.parse(row.meta) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  getNode(id: number): GraphNode | undefined {
    if (this.nodeCache.has(id)) return this.nodeCache.get(id)!;
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    const node: GraphNode = {
      id: row.id,
      text: row.text,
      embedding: bufferToFloat32(row.embedding),
      domain: row.domain,
      subtopic: row.subtopic,
      meta: JSON.parse(row.meta),
      history: JSON.parse(row.history),
    };
    this.nodeCache.set(id, node);
    return node;
  }

  getNeighbors(id: number): Array<{ id: number; weight: number }> {
    const rows = this.db.prepare(
      "SELECT target as id, weight FROM edges WHERE source = ? UNION SELECT source as id, weight FROM edges WHERE target = ?"
    ).all(id, id) as any[];
    return rows.map(r => ({ id: r.id, weight: r.weight }));
  }

  get size(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM nodes").get() as any;
    return row.cnt;
  }

  get edgeCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM edges").get() as any;
    return row.cnt;
  }

  summary(): { nodeCount: number; edgeCount: number; domains: Record<string, number> } {
    const domains: Record<string, number> = {};
    const rows = this.db.prepare("SELECT domain, COUNT(*) as cnt FROM nodes GROUP BY domain").all() as any[];
    for (const r of rows) domains[r.domain] = r.cnt;
    return { nodeCount: this.size, edgeCount: this.edgeCount, domains };
  }

  public buildText(meta: Record<string, unknown>): string {
    return [meta["topic"], meta["intent"], meta["decision"], meta["constraint"]].filter(Boolean).join(" — ");
  }

  private parseDomain(topic: string): [string, string] {
    if (!topic) return ["unknown", ""];
    if (topic.includes("/")) { const [d, s] = topic.split("/", 2); return [d!.trim(), s!.trim()]; }
    const parts = topic.trim().split(/\s+/, 2);
    return [parts[0]!, parts[1] || ""];
  }
}
