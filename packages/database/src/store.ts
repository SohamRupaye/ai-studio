import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Branch, Message, MessageImage, Summary, Organisation, Project, Space, Chat } from "@ai-studio/shared";
import { SCHEMA, applyMigrations } from "./schema.js";
import { OrganisationsRepository } from "./repositories/organisations.js";
import { ProjectsRepository } from "./repositories/projects.js";
import { SpacesRepository } from "./repositories/spaces.js";
import { ChatsRepository } from "./repositories/chats.js";
import { BranchesRepository } from "./repositories/branches.js";
import { MessagesRepository } from "./repositories/messages.js";
import { ArtifactsRepository } from "./repositories/artifacts.js";
import { CostsRepository } from "./repositories/costs.js";
import { MetaRepository } from "./repositories/meta.js";

/**
 * Facade over the SQLite workspace database. Owns the connection, schema and
 * migrations; every method delegates to a domain repository (see
 * src/repositories/) so callers keep a single import and a stable API.
 */
export class Store {
  private db: Database.Database;
  private organisations: OrganisationsRepository;
  private projects: ProjectsRepository;
  private spaces: SpacesRepository;
  private chats: ChatsRepository;
  private branches: BranchesRepository;
  private messages: MessagesRepository;
  private artifacts: ArtifactsRepository;
  private costs: CostsRepository;
  private meta: MetaRepository;

  constructor(dbPath?: string) {
    const path = dbPath ?? join(process.cwd(), "data", "workspace.db");
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.organisations = new OrganisationsRepository(this.db);
    this.projects = new ProjectsRepository(this.db);
    this.spaces = new SpacesRepository(this.db);
    this.branches = new BranchesRepository(this.db);
    this.chats = new ChatsRepository(this.db, this.spaces, this.branches);
    this.messages = new MessagesRepository(this.db);
    this.artifacts = new ArtifactsRepository(this.db);
    this.costs = new CostsRepository(this.db);
    this.meta = new MetaRepository(this.db);
    this.db.exec(SCHEMA);
    this.migrate();
  }

  private migrate() {
    applyMigrations(this.db);
    // Backfill: chats that predate spaces move into their project's default space.
    const orphanProjects = this.db
      .prepare("SELECT DISTINCT project_id FROM chats WHERE space_id IS NULL")
      .all() as any[];
    for (const row of orphanProjects) {
      const space = this.spaces.ensureDefaultSpace(row.project_id);
      this.db
        .prepare("UPDATE chats SET space_id = ? WHERE project_id = ? AND space_id IS NULL")
        .run(space.id, row.project_id);
    }
    // Backfill the "every chat has a trunk" invariant: live chats with no live
    // branches (pre-auto-main chats, or chats whose branches were all deleted)
    // get a fresh empty "main" so they're usable. Model resolves to the
    // configured default at runtime.
    const branchless = this.db
      .prepare("SELECT id FROM chats WHERE deleted_at IS NULL AND id NOT IN (SELECT DISTINCT chat_id FROM branches WHERE chat_id IS NOT NULL AND deleted_at IS NULL)")
      .all() as any[];
    for (const row of branchless) {
      this.createBranch("main", "", undefined, undefined, row.id);
    }
  }

  // ── Organisations ──────────────────────────────────────────────────────────

  createOrganisation(name: string): Organisation {
    return this.organisations.createOrganisation(name);
  }

  getOrganisation(id: string): Organisation | undefined {
    return this.organisations.getOrganisation(id);
  }

  listOrganisations(): Organisation[] {
    return this.organisations.listOrganisations();
  }

  renameOrganisation(id: string, name: string): void {
    this.organisations.renameOrganisation(id, name);
  }

  listProjectIds(orgId: string): string[] {
    return this.organisations.listProjectIds(orgId);
  }

  deleteOrganisation(id: string): boolean {
    return this.organisations.deleteOrganisation(id);
  }

  getOrgApiKeys(id: string): Record<string, string> {
    return this.organisations.getOrgApiKeys(id);
  }

  setOrgApiKeys(id: string, patch: Record<string, string | null>): void {
    this.organisations.setOrgApiKeys(id, patch);
  }

  // ── Projects ───────────────────────────────────────────────────────────────

  createProject(orgId: string, name: string): Project {
    return this.projects.createProject(orgId, name);
  }

  getProject(id: string): Project | undefined {
    return this.projects.getProject(id);
  }

  listProjects(orgId: string): Project[] {
    return this.projects.listProjects(orgId);
  }

  renameProject(id: string, name: string): void {
    this.projects.renameProject(id, name);
  }

  updateProject(id: string, patch: { name?: string; description?: string; icon?: string | null; systemPrompt?: string }): void {
    this.projects.updateProject(id, patch);
  }

  moveProject(id: string, orgId: string): void {
    this.projects.moveProject(id, orgId);
  }

  reorderProjects(orgId: string, ids: string[]): void {
    this.projects.reorderProjects(orgId, ids);
  }

  projectImpact(id: string): { spaceIds: string[]; chatIds: string[]; branchIds: string[]; artifacts: number } {
    return this.projects.projectImpact(id);
  }

  deleteProject(id: string): { chatIds: string[]; branchIds: string[] } | null {
    return this.projects.deleteProject(id);
  }

  // ── Spaces ─────────────────────────────────────────────────────────────────

  createSpace(projectId: string, name: string): Space {
    return this.spaces.createSpace(projectId, name);
  }

  getSpace(id: string): Space | undefined {
    return this.spaces.getSpace(id);
  }

  listSpaces(projectId: string): Space[] {
    return this.spaces.listSpaces(projectId);
  }

  renameSpace(id: string, name: string): void {
    this.spaces.renameSpace(id, name);
  }

  spaceImpact(id: string): { chatIds: string[]; branchIds: string[]; artifacts: number } {
    return this.spaces.spaceImpact(id);
  }

  deleteSpace(id: string): boolean {
    return this.spaces.deleteSpace(id);
  }

  // ── Chats ──────────────────────────────────────────────────────────────────

  createChat(projectId: string, name: string, spaceId?: string, mainBranchModel?: string, autoName = false): Chat {
    return this.chats.createChat(projectId, name, spaceId, mainBranchModel, autoName);
  }

  getChat(id: string): Chat | undefined {
    return this.chats.getChat(id);
  }

  listChats(projectId: string): Chat[] {
    return this.chats.listChats(projectId);
  }

  renameChat(id: string, name: string): void {
    this.chats.renameChat(id, name);
  }

  chatImpact(id: string): { branchIds: string[]; branches: number; artifacts: number } {
    return this.chats.chatImpact(id);
  }

  deleteChat(id: string): boolean {
    return this.chats.deleteChat(id);
  }

  // ── Branches ───────────────────────────────────────────────────────────────

  createBranch(name: string, model: string, parentId?: string, forkAt?: number, chatId?: string): Branch {
    return this.branches.createBranch(name, model, parentId, forkAt, chatId);
  }

  setSelectedArtifacts(branchId: string, artifactIds: string[]): void {
    this.branches.setSelectedArtifacts(branchId, artifactIds);
  }

  getBranch(id: string): Branch | undefined {
    return this.branches.getBranch(id);
  }

  getBranchByName(name: string): Branch | undefined {
    return this.branches.getBranchByName(name);
  }

  listBranches(chatId?: string): Branch[] {
    return this.branches.listBranches(chatId);
  }

  updateBranchModel(id: string, model: string): void {
    this.branches.updateBranchModel(id, model);
  }

  updateBranchName(id: string, name: string): void {
    this.branches.updateBranchName(id, name);
  }

  deleteBranch(id: string): boolean {
    return this.branches.deleteBranch(id);
  }

  addPin(branchId: string, text: string): void {
    this.branches.addPin(branchId, text);
  }

  removePin(branchId: string, index: number): boolean {
    return this.branches.removePin(branchId, index);
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  addMessage(branchId: string, role: string, content: string, model?: string, toolCalls?: Message["toolCalls"], images?: MessageImage[], thinking?: string): Message {
    return this.messages.addMessage(branchId, role, content, model, toolCalls, images, thinking);
  }

  getMessages(branchId: string): Message[] {
    return this.messages.getMessages(branchId);
  }

  getMessageCount(branchId: string): number {
    return this.messages.getMessageCount(branchId);
  }

  deleteLastMessage(branchId: string): boolean {
    return this.messages.deleteLastMessage(branchId);
  }

  editMessage(branchId: string, turn: number): void {
    this.messages.editMessage(branchId, turn);
  }

  deleteMessagePair(branchId: string, turn: number): number {
    return this.messages.deleteMessagePair(branchId, turn);
  }

  undoLastTurn(branchId: string): number {
    return this.messages.undoLastTurn(branchId);
  }

  // ── Summaries ──────────────────────────────────────────────────────────────

  addSummary(branchId: string, fromTurn: number, toTurn: number, content: string): Summary {
    return this.messages.addSummary(branchId, fromTurn, toTurn, content);
  }

  getSummaries(branchId: string): Summary[] {
    return this.messages.getSummaries(branchId);
  }

  replaceSummaries(branchId: string, newSummaries: Summary[]): void {
    this.messages.replaceSummaries(branchId, newSummaries);
  }

  // ── Artifacts ──────────────────────────────────────────────────────────────

  createArtifact(branchId: string, projectId: string, type: string, title: string, content: string): any {
    return this.artifacts.createArtifact(branchId, projectId, type, title, content);
  }

  createUploadedArtifact(fields: {
    id: string;
    branchId: string;
    projectId: string;
    type: string;
    title: string;
    content: string;
    originalFilename: string;
    mime: string;
    blobPath: string | null;
    byteSize: number;
    sha256: string;
  }): any {
    return this.artifacts.createUploadedArtifact(fields);
  }

  findUploadedArtifactBySha(branchId: string, sha256: string): { id: string; title: string } | undefined {
    return this.artifacts.findUploadedArtifactBySha(branchId, sha256);
  }

  referencedBlobPaths(): Set<string> {
    return this.artifacts.referencedBlobPaths();
  }

  updateArtifact(id: string, content: string, title?: string): void {
    this.artifacts.updateArtifact(id, content, title);
  }

  getArtifact(id: string): any | undefined {
    return this.artifacts.getArtifact(id);
  }

  listArtifacts(projectId: string): any[] {
    return this.artifacts.listArtifacts(projectId);
  }

  // ── Costs ──────────────────────────────────────────────────────────────────

  recordCost(branchId: string, model: string, inputTokens: number, outputTokens: number, costUsd: number): void {
    this.costs.recordCost(branchId, model, inputTokens, outputTokens, costUsd);
  }

  getCosts(branchId: string): Array<{ model: string; inputTokens: number; outputTokens: number; costUsd: number; timestamp: number }> {
    return this.costs.getCosts(branchId);
  }

  getProjectCosts(projectId: string): { totalCost: number; totalInput: number; totalOutput: number } {
    return this.costs.getProjectCosts(projectId);
  }

  // ── Meta ───────────────────────────────────────────────────────────────────

  getMeta(key: string): string | undefined {
    return this.meta.getMeta(key);
  }

  setMeta(key: string, value: string): void {
    this.meta.setMeta(key, value);
  }

  getActiveBranchId(): string | undefined {
    return this.meta.getActiveBranchId();
  }

  setActiveBranchId(id: string): void {
    this.meta.setActiveBranchId(id);
  }

  // ── Defaults ───────────────────────────────────────────────────────────────

  ensureDefaults(defaultModel: string): void {
    const orgs = this.listOrganisations();
    if (orgs.length) return;

    const org = this.createOrganisation("Personal");
    const project = this.createProject(org.id, "Default Project");
    // createChat gives the chat its "main" trunk; adopt any orphaned
    // pre-chats-era branches into it.
    const chat = this.createChat(project.id, "General", undefined, defaultModel);
    for (const b of this.listBranches()) {
      if (!b.chatId) {
        this.db.prepare("UPDATE branches SET chat_id = ? WHERE id = ?").run(chat.id, b.id);
      }
    }
  }
}
