import { dialog } from "electron";
import { writeFileSync } from "node:fs";
import { compareBranches, getAncestryMessages, runPendingSummaries, shouldSummarize } from "@ai-studio/prompt-engine";
import { handle } from "./handle.js";
import { mainWindow, store, router, graph, activeBranchId, setActiveBranchId } from "../state.js";

export function registerBranchHandlers() {
  handle("branch:fork", ({ branchId, name }) => {
    // Fork at the current head so the new branch inherits the whole
    // conversation up to this point.
    const parent = store.getBranch(branchId);
    if (!parent) throw new Error("Branch not found");
    const messageCount = store.getMessageCount(branchId);
    return store.createBranch(
      name,
      parent.model,
      branchId,
      messageCount > 0 ? messageCount - 1 : undefined,
      parent.chatId,
    );
  });

  handle("branch:export", async ({ id }) => {
    const branch = store.getBranch(id);
    if (!branch || !mainWindow) return null;
    const chat = branch.chatId ? store.getChat(branch.chatId) : undefined;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${chat ? `${chat.name}-` : ""}${branch.name}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (canceled || !filePath) return null;

    const lines: string[] = [`# ${chat ? `${chat.name} — ` : ""}${branch.name}`, ""];
    for (const msg of store.getMessages(id)) {
      const speaker = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "System";
      lines.push(`**${speaker}:**`, "", msg.content, "");
    }
    writeFileSync(filePath, lines.join("\n"));
    return filePath;
  });

  // ── Branches ────────────────────────────────────────────────────────────────

  handle("branch:list", () => store.listBranches());
  handle("branch:create", ({ name, model, parentId, forkAtIndex, chatId }) => store.createBranch(name, model, parentId, forkAtIndex, chatId));
  handle("branch:delete", ({ id }) => store.deleteBranch(id));
  handle("branch:rename", ({ id, name }) => { store.updateBranchName(id, name); });
  handle("branch:update-model", ({ id, model }) => { store.updateBranchModel(id, model); });
  handle("branch:switch", async ({ id }) => {
    if (activeBranchId && activeBranchId !== id && shouldSummarize(store, activeBranchId)) {
      runPendingSummaries(store, router, activeBranchId).catch(() => {});
    }
    setActiveBranchId(id);
    store.setActiveBranchId(id);
  });
  handle("branch:pin-add", ({ branchId, text }) => { store.addPin(branchId, text); });
  handle("branch:pin-remove", ({ branchId, index }) => store.removePin(branchId, index));
  handle("branch:compare", ({ branchIdA, branchIdB }) => compareBranches(store, graph, branchIdA, branchIdB));

  // ── Messages ────────────────────────────────────────────────────────────────

  handle("message:list", ({ branchId }) => {
    // Forked branches inherit their ancestry's transcript — the SAME walk
    // prompt assembly uses (getAncestryMessages), so what the user sees is
    // exactly what the model gets. Inherited rows are flagged: they belong
    // to ancestor branches, so turn-based mutations must not target them.
    const branch = store.getBranch(branchId);
    const pack = (m: ReturnType<typeof store.getMessages>[number], inherited: boolean) => ({
      id: m.id, role: m.role, content: m.content, turn: m.turn, timestamp: m.timestamp,
      model: m.model, toolCalls: m.toolCalls, images: m.images, thinking: m.thinking,
      inherited: inherited || undefined,
    });
    const own = store.getMessages(branchId).map(m => pack(m, false));
    if (!branch?.parentId) return own;
    return [...getAncestryMessages(branch, store).map(m => pack(m, true)), ...own];
  });
  handle("message:undo", ({ branchId }) => store.undoLastTurn(branchId));
  handle("message:edit", ({ branchId, turn }) => { store.editMessage(branchId, turn); });
  handle("message:delete", ({ branchId, turn }) => store.deleteMessagePair(branchId, turn));
}
