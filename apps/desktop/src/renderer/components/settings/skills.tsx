import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowsClockwiseIcon,
  DotsThreeIcon,
  LightningIcon,
  PlusIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import type { SkillEntry } from "@ai-studio/event-bus";
import { cn, counted } from "../../lib/utils";
import { useMutation, useQuery, useSkills } from "../../hooks/use-ipc-data";
import { ConfirmDialog } from "../confirm-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { Markdown } from "../ui/markdown";
import { Switch } from "../ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../ui/menu";
import { ScopeHeader, SettingsSection } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// Skills — reusable SKILL.md instruction packages. Installed skills live in
// the app's skills directory; enable/disable is a config filter (new skills
// start enabled). Invocation: /name in the composer, or the model's `skill`
// tool when a task matches a description.
// ─────────────────────────────────────────────────────────────────────────────

export function SkillsSettings() {
  const { data: skills = [] } = useSkills();
  const [addingUrl, setAddingUrl] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SkillEntry | null>(null);
  const removeSkill = useMutation("skills:remove");
  const reloadSkills = useMutation("skills:reload");
  const [importing, setImporting] = useState(false);

  // Import opens main's native picker — the IPC resolves after the user
  // finishes (or cancels), with per-file outcomes.
  const runImport = async () => {
    setImporting(true);
    try {
      const { imported, skipped } = await window.ipc.invoke("skills:import", undefined);
      if (imported.length) toast.success(`Imported ${counted(imported.length, "skill")}: ${imported.join(", ")}`);
      for (const s of skipped) toast.error(`${s.source}: ${s.reason}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't import skills");
    } finally {
      setImporting(false);
    }
  };

  const runReload = () =>
    reloadSkills
      .mutate(undefined)
      .then((count) => toast.success(`Rescanned — ${counted(count, "skill")} installed`))
      .catch(() => toast.error("Couldn't rescan the skills folder"));

  return (
    <>
      <ScopeHeader
        title="Skills"
        hint="Reusable instruction packs the assistant can follow — start a message with / to invoke one, or let the model load one when a task matches."
      />

      <SettingsSection
        title="Installed"
        hint={skills.length ? counted(skills.length, "skill") : undefined}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Rescan skills folder"
              disabled={reloadSkills.loading}
              onClick={() => void runReload()}
            >
              <ArrowsClockwiseIcon size={15} className={reloadSkills.loading ? "animate-spin" : undefined} />
            </Button>
            <Button variant="outline" size="sm" disabled={importing} onClick={() => void runImport()}>
              <UploadSimpleIcon size={14} />
              {importing ? "Importing…" : "Import"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAddingUrl(true)}>
              <PlusIcon size={14} />
              Add from URL
            </Button>
          </>
        }
      >
        <div className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line">
          {skills.length === 0 && (
            <p className="px-4 py-3.5 text-body-sm text-fg-subtle">
              No skills installed yet. A skill is a folder with a SKILL.md (name + description
              frontmatter, instructions below) — import one from disk or add one from a URL.
            </p>
          )}
          {skills.map((skill) => (
            <SkillRow
              key={skill.name}
              skill={skill}
              onView={() => setViewing(skill.name)}
              onRemove={() => setRemoving(skill)}
            />
          ))}
        </div>
      </SettingsSection>

      <AddSkillFromUrlDialog open={addingUrl} onOpenChange={setAddingUrl} />
      <ViewSkillDrawer name={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? "skill"}?`}
        description="This deletes the skill's folder from disk, including any supporting files. Conversations that used it are unaffected."
        confirmLabel="Remove skill"
        onConfirm={async () => {
          if (!removing) return;
          const ok = await removeSkill.mutate({ name: removing.name });
          if (ok) toast.success(`Removed ${removing.name}`);
          else toast.error(`Couldn't remove ${removing.name}`);
        }}
      />
    </>
  );
}

function SkillRow({
  skill,
  onView,
  onRemove,
}: {
  skill: SkillEntry;
  onView: () => void;
  onRemove: () => void;
}) {
  const setEnabled = useMutation("skills:set-enabled");

  return (
    <div className="group/row flex min-h-14 items-center gap-3.5 px-4 py-2.5">
      <LightningIcon
        size={18}
        className={cn("shrink-0", skill.enabled ? "text-fg" : "text-fg-subtle")}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "truncate font-mono text-label-md",
              skill.enabled ? "text-fg" : "text-fg-muted",
            )}
          >
            /{skill.name}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-body-sm text-fg-subtle">
          {skill.userOnly ? "Slash-only — invoked with /, never by the model. " : ""}
          {skill.description ||
            (skill.userOnly ? "" : "No description — the model won't discover this skill on its own.")}
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <Switch
          checked={skill.enabled}
          aria-label={`${skill.name} enabled`}
          onCheckedChange={(checked) =>
            setEnabled
              .mutate({ name: skill.name, enabled: checked })
              .catch(() => toast.error(`Couldn't ${checked ? "enable" : "disable"} ${skill.name}`))
          }
        />
        <Menu>
          <MenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={`${skill.name} actions`} />
            }
          >
            <DotsThreeIcon size={16} weight="bold" />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem onClick={onView}>View instructions</MenuItem>
            <MenuItem onClick={() => void window.ipc.invoke("skills:reveal", { name: skill.name })}>
              Show in Finder
            </MenuItem>
            <MenuSeparator />
            <MenuItem className="text-danger-text data-[highlighted]:bg-danger-soft" onClick={onRemove}>
              Remove…
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </div>
  );
}

type DiscoveredSkillRow = { name: string; description?: string; source: string; installed: boolean };

/**
 * Two steps, one dialog: paste a URL (GitHub repo — the ecosystem's
 * distribution unit — raw SKILL.md, or catalogue) → the discovered skills
 * appear as a pick-list → install the checked ones. The pick-list is the UI
 * equivalent of `npx skills add <repo> --skill <name>`.
 */
function AddSkillFromUrlDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<DiscoveredSkillRow[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setUrl("");
      setFound(null);
      setPicked(new Set());
    }
  }, [open]);

  const discover = async () => {
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const { skills, skipped } = await window.ipc.invoke("skills:discover", { url: trimmed });
      for (const s of skipped) toast.error(`${s.source}: ${s.reason}`);
      if (!skills.length) {
        if (!skipped.length) toast.error("No skills found at that URL.");
        return;
      }
      setFound(skills);
      setPicked(new Set(skills.filter((s) => !s.installed).map((s) => s.name)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't fetch that URL");
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    if (!picked.size || busy) return;
    setBusy(true);
    try {
      const { imported, skipped } = await window.ipc.invoke("skills:pull", {
        url: url.trim(),
        skills: [...picked],
      });
      if (imported.length) toast.success(`Installed ${counted(imported.length, "skill")}: ${imported.join(", ")}`);
      for (const s of skipped) toast.error(`${s.source}: ${s.reason}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't install those skills");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add skills from URL</DialogTitle>
          <DialogDescription>
            A GitHub repository (e.g. github.com/mattpocock/skills), a direct SKILL.md link, or a
            skill catalogue.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void (found ? install() : discover());
          }}
        >
          <div className="space-y-4 px-5">
            <Input
              autoFocus
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                // A different URL invalidates the current pick-list.
                setFound(null);
                setPicked(new Set());
              }}
              placeholder="https://github.com/owner/skills-repo"
              className="font-mono"
            />
            {found && (
              <div className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                {found.map((s) => (
                  <label
                    key={s.name}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 px-3.5 py-2.5",
                      s.installed && "cursor-default opacity-60",
                    )}
                  >
                    <Checkbox
                      checked={picked.has(s.name)}
                      disabled={s.installed}
                      onCheckedChange={(checked) =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(s.name);
                          else next.delete(s.name);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-mono text-label-md text-fg">/{s.name}</span>
                        {s.installed && (
                          <Badge className="px-2 py-0.5 text-label-sm">Installed</Badge>
                        )}
                      </span>
                      {s.description && (
                        <span className="mt-0.5 block truncate text-body-sm text-fg-subtle">
                          {s.description}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {found ? (
              <Button type="submit" variant="primary" disabled={!picked.size || busy}>
                {busy ? "Installing…" : `Install ${counted(picked.size, "skill")}`}
              </Button>
            ) : (
              <Button type="submit" variant="primary" disabled={!url.trim() || busy}>
                {busy ? "Looking…" : "Find skills"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Read-only view of a skill's markdown body — what the model receives.
 * A Drawer, not a Dialog: this is a reference document to read (often long),
 * and the system's rule is Dialog = confirmations/forms, Drawer = reference
 * panels — same call as the subagent transcript. */
function ViewSkillDrawer({ name, onClose }: { name: string | null; onClose: () => void }) {
  const { data: skill } = useQuery("skills:read", { name: name! }, { enabled: !!name });

  return (
    <Drawer open={name !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="w-[560px]">
        <DrawerHeader className="border-b border-line">
          <DrawerTitle className="font-mono">/{name}</DrawerTitle>
          {skill?.description && <DrawerDescription>{skill.description}</DrawerDescription>}
        </DrawerHeader>
        <DrawerBody className="py-4">
          {skill ? (
            <Markdown text={skill.content} />
          ) : (
            <p className="text-body-sm text-fg-subtle">Loading…</p>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
