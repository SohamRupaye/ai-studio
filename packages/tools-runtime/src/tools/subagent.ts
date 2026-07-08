/**
 * subagent.ts — Parallel & background subagent execution.
 *
 * Agent execution is fully injected via setSubagentDependencies — this package
 * has no direct dependency on @ai-studio/ai-core.
 */

import type { ToolDefinition } from "../types.js";
import type { ToolHandler } from "../registry.js";

// Injected task runner — set by ai-core at startup
type RunTask = (
  task: string,
  model: string,
  systemPrompt: string,
  allowedTools?: string[],
) => Promise<string>;

let _runTask: RunTask | null = null;
// Refreshed by setSubagentDependencies on every turn — falls back to the
// current chat's model, never a hardcoded id.
let _defaultModel = "";

export function setSubagentDependencies(runTask: RunTask, defaultModel: string) {
  _runTask = runTask;
  _defaultModel = defaultModel;
}

interface DelegateJob {
  id: string;
  task: string;
  status: "running" | "done" | "failed";
  startedAt: Date;
  finishedAt?: Date;
  result?: string;
  error?: string;
}

const backgroundJobs = new Map<string, DelegateJob>();

export const subagentDef: ToolDefinition = {
  name: "subagent",
  description: "Delegate complex tasks to up to 4 specialized subagents running in parallel. MAX 4 agents.",
  parameters: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        description: "List of tasks to run in parallel. MAX 4.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Short identifier for this task, used to label its result." },
            task: { type: "string", description: "The full task for this subagent, self-contained (it cannot see this conversation)." },
            system_prompt: { type: "string", description: "Optional system prompt for this subagent." },
            model: { type: "string", description: "Optional model id to run this task on. Omit to use the current chat's model." },
            tools: { type: "array", items: { type: "string" }, description: "Optional allowlist of tool names this subagent may use." },
          },
        },
      },
    },
    required: ["tasks"],
  },
};

export const subagent: ToolHandler = async (args) => {
  if (!_runTask) return "Error: subagent dependencies not initialized.";

  const tasks = args["tasks"] as Array<{
    id: string;
    task: string;
    system_prompt?: string;
    model?: string;
    tools?: string[];
  }>;

  if (!tasks?.length) return "Error: no tasks provided.";

  const capped = tasks.slice(0, 4);
  const startTime = Date.now();
  const results = await Promise.allSettled(
    capped.map(t => _runTask!(
      t.task,
      t.model || _defaultModel,
      t.system_prompt || "",
      t.tools,
    ))
  );

  const totalMs = Date.now() - startTime;
  const lines = [`Subagent results (${capped.length} agent${capped.length !== 1 ? "s" : ""}, ${(totalMs / 1000).toFixed(1)}s):\n`];

  for (let i = 0; i < capped.length; i++) {
    const task = capped[i]!;
    const result = results[i]!;
    lines.push(`-- [${task.id}] --`);
    if (result.status === "fulfilled") {
      lines.push(result.value);
    } else {
      lines.push(`Failed: ${result.reason?.message || "unknown error"}`);
    }
    lines.push("");
  }

  return lines.join("\n");
};

export const delegateDef: ToolDefinition = {
  name: "delegate",
  description: "Fire-and-forget: start a background agent for a long-running task. Use delegate_result to check progress.",
  parameters: {
    type: "object",
    properties: {
      task: { type: "string", description: "The full task, self-contained (the background agent cannot see this conversation)." },
      job_id: { type: "string", description: "Unique id for this job, used to check its result later." },
      model: { type: "string", description: "Optional model id to run the job on. Omit to use the current chat's model." },
      tools: { type: "array", items: { type: "string" }, description: "Optional allowlist of tool names the job may use." },
    },
    required: ["task", "job_id"],
  },
};

export const delegate: ToolHandler = async (args) => {
  if (!_runTask) return "Error: subagent dependencies not initialized.";

  const task = args["task"] as string;
  const jobId = args["job_id"] as string;
  const model = (args["model"] as string) || _defaultModel;
  const tools = args["tools"] as string[] | undefined;

  const running = [...backgroundJobs.values()].filter(j => j.status === "running");
  if (running.length >= 4) {
    return `Too many background jobs (${running.length}/4 running). Wait for one to finish.`;
  }

  if (backgroundJobs.has(jobId)) {
    return `Job '${jobId}' already exists.`;
  }

  const job: DelegateJob = { id: jobId, task, status: "running", startedAt: new Date() };
  backgroundJobs.set(jobId, job);

  _runTask(task, model, "", tools).then(result => {
    job.status = "done";
    job.result = result;
    job.finishedAt = new Date();
  }).catch(err => {
    job.status = "failed";
    job.error = err?.message || "unknown error";
    job.finishedAt = new Date();
  });

  return `Background job '${jobId}' started.\nModel: ${model}\nTask: ${task.slice(0, 100)}${task.length > 100 ? "..." : ""}`;
};

export const delegateResultDef: ToolDefinition = {
  name: "delegate_result",
  description: "Check the status and result of a background delegate job.",
  parameters: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] },
};

export const delegateResult: ToolHandler = async (args) => {
  const jobId = args["job_id"] as string;
  const job = backgroundJobs.get(jobId);
  if (!job) return `No job with id '${jobId}'.`;

  if (job.status === "running") {
    const elapsed = Math.round((Date.now() - job.startedAt.getTime()) / 1000);
    return `Job '${jobId}' is still running (${elapsed}s elapsed).`;
  }

  if (job.status === "failed") {
    return `Job '${jobId}' failed: ${job.error}`;
  }

  const duration = job.finishedAt
    ? Math.round((job.finishedAt.getTime() - job.startedAt.getTime()) / 1000)
    : 0;
  return `Job '${jobId}' completed (${duration}s):\n\n${job.result}`;
};

export const delegateListDef: ToolDefinition = {
  name: "delegate_list",
  description: "List all background delegate jobs and their statuses.",
  parameters: { type: "object", properties: {}, required: [] },
};

export const delegateList: ToolHandler = async () => {
  if (!backgroundJobs.size) return "No background jobs.";
  const lines = [`Background jobs (${backgroundJobs.size}):\n`];
  for (const [id, job] of backgroundJobs) {
    const elapsed = job.finishedAt
      ? `${Math.round((job.finishedAt.getTime() - job.startedAt.getTime()) / 1000)}s`
      : `${Math.round((Date.now() - job.startedAt.getTime()) / 1000)}s running`;
    lines.push(`  ${id.padEnd(25)} ${job.status.padEnd(8)} ${elapsed}`);
    lines.push(`     Task: ${job.task.slice(0, 80)}${job.task.length > 80 ? "..." : ""}`);
  }
  return lines.join("\n");
};
