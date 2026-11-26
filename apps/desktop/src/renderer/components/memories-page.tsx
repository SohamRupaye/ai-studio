import { useState } from "react";
import { toast } from "sonner";
import { BrainIcon, TrashIcon } from "@phosphor-icons/react";
import type { MemoryFact } from "@squirl/event-bus";
import { counted } from "../lib/utils";
import { useWorkspace } from "./workspace-provider";
import { useMemory, useMutation } from "../hooks/use-ipc-data";
import { Button } from "./ui/button";
import { Textarea } from "./ui/input";
import { Skeleton } from "./ui/skeleton";

// ─────────────────────────────────────────────────────────────────────────────
// Memories — durable facts the model is given every turn, grouped by reach.
// Global facts follow you everywhere; project facts ride only this project's
// chats. (Chat- and branch-scoped memories are narrower still and live in the
// branch's right panel.) This is the manage-everything surface: the agent's
// `remember` tool and the panel both write here.
// ─────────────────────────────────────────────────────────────────────────────

export function MemoriesPage() {
  const { activeProjectId, activeProject } = useWorkspace();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-10 py-10">
        <header>
          <h1 className="text-heading-md text-fg">Memories</h1>
          <p className="mt-1 text-body-md text-fg-muted">
            Facts the assistant keeps and is reminded of on every turn.
          </p>
        </header>

        <MemoryScope
          scope="global"
          title="Global"
          hint="Available in every project and chat."
          placeholder="e.g. I prefer concise answers and TypeScript over JavaScript."
        />

        {activeProjectId ? (
          <MemoryScope
            scope={`project:${activeProjectId}`}
            title="Project"
            hint={`Only used in ${activeProject?.name ?? "this project"}.`}
            placeholder="e.g. This project ships as an Electron desktop app."
          />
        ) : (
          <p className="mt-8 text-body-sm text-fg-subtle">
            Select a project to manage its memories.
          </p>
        )}
      </div>
    </div>
  );
}

function MemoryScope({
  scope,
  title,
  hint,
  placeholder,
}: {
  scope: string;
  title: string;
  hint: string;
  placeholder: string;
}) {
  const { data: facts, loading, error, refetch } = useMemory(scope);
  const addMemory = useMutation("memory:add");
  const removeMemory = useMutation("memory:remove");
  const [draft, setDraft] = useState("");

  const add = async () => {
    const text = draft.trim();
    if (!text || addMemory.loading) return;
    try {
      await addMemory.mutate({ text, scope });
      setDraft("");
    } catch {
      toast.error("Couldn't save that memory");
    }
  };

  const remove = async (id: number) => {
    try {
      await removeMemory.mutate({ id });
    } catch {
      toast.error("Couldn't remove that memory");
    }
  };

  return (
    <section className="mt-9">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-label-lg text-fg">{title}</h2>
        {facts && facts.length > 0 && (
          <span className="text-body-sm text-fg-subtle">{counted(facts.length, "memory", "memories")}</span>
        )}
      </div>
      <p className="mt-0.5 text-body-sm text-fg-muted">{hint}</p>

      <div className="mt-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          rows={2}
          onKeyDown={(e) => {
            // ⌘/Ctrl+Enter adds — a bare Enter keeps newlines editable.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void add();
            }
          }}
        />
        <div className="mt-2 flex justify-end">
          <Button variant="secondary" size="sm" onClick={add} disabled={!draft.trim() || addMemory.loading}>
            Add memory
          </Button>
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-body-sm text-danger-text">Couldn&apos;t load memories.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : !facts?.length ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-line px-3 py-4 text-body-sm text-fg-subtle">
            <BrainIcon size={16} className="shrink-0 text-fg-subtle" />
            No {title.toLowerCase()} memories yet.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {facts.map((f: MemoryFact) => (
              <li key={f.id} className="group/memory flex items-start gap-3 py-3">
                <BrainIcon size={16} className="mt-0.5 shrink-0 text-fg-subtle" />
                <span className="min-w-0 flex-1 text-body-md leading-relaxed text-fg">{f.text}</span>
                <button
                  type="button"
                  aria-label="Remove memory"
                  onClick={() => remove(f.id)}
                  className="pressable mt-0.5 shrink-0 rounded-sm p-1 text-fg-subtle opacity-0 hover:text-danger-text focus-visible:opacity-100 group-hover/memory:opacity-100"
                >
                  <TrashIcon size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
