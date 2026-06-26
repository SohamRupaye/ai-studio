import { useState } from "react";
import { BookOpen, Plus, Trash2, Search, X } from "lucide-react";
import { PageContainer, PageHeader, EmptyState, LoadingState } from "../components/page-primitives";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Text } from "../components/ui/typography";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../components/ui/select";
import { useKnowledgeBase, useMutation } from "../hooks/use-ipc-data";
import type { KnowledgeEntryInfo } from "@ai-studio/event-bus";
import { toast } from "sonner";

const CATEGORIES: KnowledgeEntryInfo["category"][] = ["architecture", "style", "api", "gotcha", "decision", "note"];

const CATEGORY_COLOR: Record<KnowledgeEntryInfo["category"], "default" | "highlight" | "warning" | "destructive" | "secondary"> = {
  architecture: "highlight",
  style: "secondary",
  api: "default",
  gotcha: "warning",
  decision: "highlight",
  note: "secondary",
};

export default function KnowledgeBasePage() {
  const { data: entries = [], loading, refetch } = useKnowledgeBase();
  const searchKb = useMutation("kb:search");
  const addEntry = useMutation("kb:add");
  const removeEntry = useMutation("kb:remove");

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KnowledgeEntryInfo[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<KnowledgeEntryInfo["category"]>("note");
  const [saving, setSaving] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) { setSearchResults(null); return; }
    try {
      const results = await searchKb.mutate({ query: query.trim() });
      setSearchResults(results);
    } catch (err) {
      toast.error(`Search failed: ${(err as Error).message}`);
    }
  };

  const clearSearch = () => { setQuery(""); setSearchResults(null); };

  const handleAdd = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      await addEntry.mutate({ title: title.trim(), content: content.trim(), category });
      await refetch();
      setTitle(""); setContent(""); setCategory("note"); setShowForm(false);
      toast.success("Knowledge entry added");
    } catch (err) {
      toast.error(`Failed to add: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: number) => {
    try {
      await removeEntry.mutate({ id });
      await refetch();
      if (searchResults) setSearchResults((prev) => prev?.filter((e) => e.id !== id) ?? null);
      toast.success("Entry removed");
    } catch (err) {
      toast.error(`Failed to remove: ${(err as Error).message}`);
    }
  };

  const visible = searchResults ?? entries;

  return (
    <PageContainer wide>
      <PageHeader
        title="Knowledge base"
        description="Durable architecture notes, style decisions, API contracts, and gotchas — separate from chat memory."
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus className="h-4 w-4" />
            Add entry
          </Button>
        }
      />

      <div className="mb-6 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search knowledge base…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="pl-9"
          />
        </div>
        {searchResults ? (
          <Button variant="ghost" onClick={clearSearch}>
            <X className="h-4 w-4" />
            Clear
          </Button>
        ) : (
          <Button variant="outline" onClick={handleSearch} disabled={!query.trim()}>
            Search
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>New knowledge entry</CardTitle>
            <CardDescription>Markdown content is supported.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px]">
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] text-muted-foreground">Title</span>
                <Input placeholder="e.g. Auth flow overview" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] text-muted-foreground">Category</span>
                <Select value={category} onValueChange={(v) => setCategory(v as KnowledgeEntryInfo["category"])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] text-muted-foreground">Content</span>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Describe the decision, contract, or gotcha…"
                rows={5}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button onClick={handleAdd} disabled={!title.trim() || !content.trim() || saving}>
                <Plus className="h-4 w-4" />
                Add entry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <LoadingState />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={searchResults ? "No matches" : "Knowledge base is empty"}
          description={searchResults ? "Try a different search term." : "Add architecture notes, API contracts, or gotchas the agent should remember about your project."}
        />
      ) : (
        <Card className="divide-y divide-border/70 overflow-hidden">
          {visible.map((entry) => (
            <div key={entry.id} className="group flex items-start gap-3 px-5 py-4">
              <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{entry.title}</span>
                  <Badge variant={CATEGORY_COLOR[entry.category]}>{entry.category}</Badge>
                  {entry.tags.map((tag) => (
                    <Badge key={tag} variant="outline">{tag}</Badge>
                  ))}
                </div>
                <Text size="sm" variant="muted" className="mt-1 whitespace-pre-wrap">
                  {entry.content}
                </Text>
                <Text size="xs" variant="subtle" className="mt-1.5">
                  Updated {new Date(entry.updatedAt).toLocaleString()}
                </Text>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => handleRemove(entry.id)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </Card>
      )}
    </PageContainer>
  );
}
