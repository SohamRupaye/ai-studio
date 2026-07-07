import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

// One-field "give it a name" modal shared by new project / space / chat flows.
interface NameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  placeholder?: string;
  submitLabel?: string;
  /** Pre-filled value — for rename flows. */
  initialValue?: string;
  /** Allow submitting with an empty name (onSubmit receives "") — for flows
   * where the caller has a sensible default, e.g. auto-titled chats. */
  optional?: boolean;
  onSubmit: (name: string) => Promise<void> | void;
}

export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder = "Name",
  submitLabel = "Create",
  initialValue,
  optional = false,
  onSubmit,
}: NameDialogProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setName(initialValue ?? "");
  }, [open, initialValue]);

  const submit = async () => {
    const trimmed = name.trim();
    if ((!trimmed && !optional) || busy) return;
    setBusy(true);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } catch {
      // Keep the dialog open; the caller surfaces the error (e.g. a toast).
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="px-5">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={placeholder}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={(!name.trim() && !optional) || busy}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
