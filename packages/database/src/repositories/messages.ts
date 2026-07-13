import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Message, MessageImage, Summary } from "@ai-studio/shared";

/** Messages and their compaction summaries — both keyed by branch and turn. */
export class MessagesRepository {
  constructor(private db: Database.Database) {}

  addMessage(branchId: string, role: string, content: string, model?: string, toolCalls?: Message["toolCalls"], images?: MessageImage[], thinking?: string): Message {
    // Use MAX(turn)+1 to avoid reuse after undo
    const row = this.db.prepare("SELECT MAX(turn) as maxTurn FROM messages WHERE branch_id = ?").get(branchId) as any;
    const turn = (row?.maxTurn ?? -1) + 1;
    const msg: Message = {
      id: randomUUID(),
      role: role as Message["role"],
      content,
      turn,
      timestamp: Date.now(),
      toolCalls,
      images: images?.length ? images : undefined,
      thinking: thinking || undefined,
    };
    this.db.prepare(
      `INSERT INTO messages (id, branch_id, role, content, model, turn, timestamp, tool_calls, images, thinking) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(msg.id, branchId, msg.role, msg.content, model ?? null, msg.turn, msg.timestamp, toolCalls?.length ? JSON.stringify(toolCalls) : null, images?.length ? JSON.stringify(images) : null, thinking || null);
    return msg;
  }

  getMessages(branchId: string): Message[] {
    const rows = this.db.prepare("SELECT * FROM messages WHERE branch_id = ? ORDER BY turn").all(branchId) as any[];
    return rows.map(r => {
      let toolCalls: Message["toolCalls"];
      if (r.tool_calls) {
        try { toolCalls = JSON.parse(r.tool_calls); } catch { /* corrupt row — show the message without activity */ }
      }
      let images: Message["images"];
      if (r.images) {
        try { images = JSON.parse(r.images); } catch { /* corrupt row — show the message without its images */ }
      }
      return { id: r.id, role: r.role, content: r.content, turn: r.turn, timestamp: r.timestamp, model: r.model ?? undefined, toolCalls, images, thinking: r.thinking ?? undefined };
    });
  }

  getMessageCount(branchId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM messages WHERE branch_id = ?").get(branchId) as any;
    return row.cnt;
  }

  deleteLastMessage(branchId: string): boolean {
    const row = this.db.prepare("SELECT id FROM messages WHERE branch_id = ? ORDER BY turn DESC LIMIT 1").get(branchId) as any;
    if (!row) return false;
    this.db.prepare("DELETE FROM messages WHERE id = ?").run(row.id);
    return true;
  }

  /**
   * Delete a user message at `turn` and everything after it in the branch
   * (the old assistant response plus any later turns). The caller is
   * expected to immediately re-send the edited text via the normal chat
   * flow (which calls addMessage and picks the next free turn), so this
   * never leaves two rows fighting over the same turn number.
   * No-op if there's no message at that turn.
   */
  editMessage(branchId: string, turn: number): void {
    this.db.transaction(() => {
      const row = this.db.prepare("SELECT id FROM messages WHERE branch_id = ? AND turn = ?").get(branchId, turn) as any;
      if (!row) return;
      this.db.prepare("DELETE FROM messages WHERE branch_id = ? AND turn >= ?").run(branchId, turn);
    })();
  }

  /**
   * Delete the user message at `turn` plus its paired assistant response
   * (the very next message, if present) so a deleted prompt also removes
   * its reply. Returns the number of messages actually deleted.
   */
  deleteMessagePair(branchId: string, turn: number): number {
    let removed = 0;
    this.db.transaction(() => {
      const target = this.db.prepare("SELECT id, turn FROM messages WHERE branch_id = ? AND turn = ?").get(branchId, turn) as any;
      if (!target) return;
      this.db.prepare("DELETE FROM messages WHERE id = ?").run(target.id);
      removed++;
      const next = this.db.prepare("SELECT id, role FROM messages WHERE branch_id = ? AND turn = ?").get(branchId, turn + 1) as any;
      if (next && next.role === "assistant") {
        this.db.prepare("DELETE FROM messages WHERE id = ?").run(next.id);
        removed++;
      }
    })();
    return removed;
  }

  undoLastTurn(branchId: string): number {
    let removed = 0;
    this.db.transaction(() => {
      const msgs = this.db.prepare("SELECT id, role FROM messages WHERE branch_id = ? ORDER BY turn DESC LIMIT 2").all(branchId) as any[];
      if (msgs.length && msgs[0].role === "assistant") {
        this.db.prepare("DELETE FROM messages WHERE id = ?").run(msgs[0].id);
        removed++;
        if (msgs.length > 1 && msgs[1].role === "user") {
          this.db.prepare("DELETE FROM messages WHERE id = ?").run(msgs[1].id);
          removed++;
        }
      }
    })();
    return removed;
  }

  // ── Summaries ──────────────────────────────────────────────────────────────

  addSummary(branchId: string, fromTurn: number, toTurn: number, content: string): Summary {
    const s: Summary = { branchId, fromTurn, toTurn, content, timestamp: Date.now() };
    this.db.prepare(
      `INSERT INTO summaries (branch_id, from_turn, to_turn, content, timestamp) VALUES (?, ?, ?, ?, ?)`
    ).run(branchId, fromTurn, toTurn, content, s.timestamp);
    return s;
  }

  getSummaries(branchId: string): Summary[] {
    const rows = this.db.prepare("SELECT * FROM summaries WHERE branch_id = ? ORDER BY from_turn").all(branchId) as any[];
    return rows.map(r => ({ branchId: r.branch_id, fromTurn: r.from_turn, toTurn: r.to_turn, content: r.content, timestamp: r.timestamp }));
  }

  replaceSummaries(branchId: string, newSummaries: Summary[]): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM summaries WHERE branch_id = ?").run(branchId);
      const stmt = this.db.prepare("INSERT INTO summaries (branch_id, from_turn, to_turn, content, timestamp) VALUES (?, ?, ?, ?, ?)");
      for (const s of newSummaries) stmt.run(branchId, s.fromTurn, s.toTurn, s.content, s.timestamp || Date.now());
    })();
  }
}
