import * as React from "react";
import {
  ArrowsClockwiseIcon,
  BrainIcon,
  CopyIcon,
  CubeIcon,
  GitForkIcon,
  DownloadSimpleIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  HouseIcon,
  ImagesIcon,
  LightningIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PaperclipIcon,
  PencilSimpleIcon,
  PlusIcon,
  SunIcon,
  TrashIcon,
  TextAlignLeftIcon,
  TextAlignCenterIcon,
  TextAlignRightIcon,
  TrayIcon,
} from "@phosphor-icons/react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  Badge,
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  Combobox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Radio,
  RadioGroup,
  Slider,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  Composer,
  ComposerButton,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  Highlighter,
  Input,
  KbdGroup,
  Marker,
  MarkerContent,
  MarkerIcon,
  Menu,
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageModel,
  MessageTimestamp,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Spinner,
  Switch,
  Textarea,
  toast,
} from "./ui";

// Temporary dev gallery — replaced by real pages as the rebuild lands.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-label-md text-fg-subtle">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

const MODELS = [
  { value: "claude-fable-5", label: "Claude Fable 5" },
  { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { value: "gpt-5.2", label: "GPT-5.2" },
  { value: "gemini-3-pro", label: "Gemini 3 Pro" },
];

const DEMO_MESSAGES = Array.from({ length: 24 }, (_, i) => ({
  id: `msg-${i + 1}`,
  role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
  text:
    i % 2 === 0
      ? `Question ${i / 2 + 1}: how does the context window slicing work?`
      : "The window is sliced per turn — older turns compact first, pinned turns survive until the hard limit.",
  time: `14:${String(10 + i).padStart(2, "0")}`,
}));

export function UiGallery({
  theme,
  onToggleTheme,
}: {
  theme: string;
  onToggleTheme: () => void;
}) {
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [alignment, setAlignment] = React.useState("left");
  const [view, setView] = React.useState("week");

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-8 py-12">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-heading-lg">Components</h1>
          <p className="mt-1 text-body-md text-fg-muted">
            Warm mono primitives — press, hover and right-click things.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onToggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? <SunIcon size={18} /> : <MoonIcon size={18} />}
        </Button>
      </header>

      <Section title="Buttons">
        <Button variant="primary">
          <PlusIcon size={16} weight="bold" /> New chat
        </Button>
        <Button>Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Delete</Button>
        <Button disabled>Disabled</Button>
        <Button variant="secondary" size="icon" aria-label="Copy">
          <CopyIcon size={16} />
        </Button>
      </Section>

      <Section title="Button group">
        <ButtonGroup value={alignment} onValueChange={setAlignment}>
          <ButtonGroupItem size="icon" value="left" aria-label="Align left">
            <TextAlignLeftIcon size={16} />
          </ButtonGroupItem>
          <ButtonGroupItem size="icon" value="center" aria-label="Align center">
            <TextAlignCenterIcon size={16} />
          </ButtonGroupItem>
          <ButtonGroupItem size="icon" value="right" aria-label="Align right">
            <TextAlignRightIcon size={16} />
          </ButtonGroupItem>
        </ButtonGroup>
        <ButtonGroup value={view} onValueChange={setView}>
          <ButtonGroupItem value="day">Day</ButtonGroupItem>
          <ButtonGroupItem value="week">Week</ButtonGroupItem>
          <ButtonGroupItem value="month">Month</ButtonGroupItem>
        </ButtonGroup>
        <ButtonGroup>
          <Button>Copy</Button>
          <Button>Duplicate</Button>
          <Button>Delete</Button>
        </ButtonGroup>
      </Section>

      <Section title="Badges">
        <Badge>claude-fable-5</Badge>
        <Badge variant="outline">draft</Badge>
        <Badge variant="info">running</Badge>
        <Badge variant="success">connected</Badge>
        <Badge variant="warning">rate limited</Badge>
        <Badge variant="danger">failed</Badge>
      </Section>

      <Section title="Inputs & select">
        <Input placeholder="Search projects…" className="max-w-56" />
        <Select
          defaultValue="claude-fable-5"
          items={Object.fromEntries(MODELS.slice(0, 4).map((m) => [m.value, m.label]))}
        >
          <SelectTrigger aria-label="Model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODELS.slice(0, 4).map((model) => (
              <SelectItem key={model.value} value={model.value}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Combobox
          items={MODELS}
          placeholder="Pick a model…"
          searchPlaceholder="Search models…"
          className="min-w-48"
        />
        <Textarea placeholder="System prompt…" className="max-w-md" />
      </Section>

      <Section title="Switch, spinner, skeleton & separator">
        <label className="flex items-center gap-2 text-body-md">
          <Switch defaultChecked /> Stream responses
        </label>
        <Separator orientation="vertical" className="h-5" />
        <Spinner size="sm" />
        <Spinner />
        <Spinner size="lg" />
        <Separator orientation="vertical" className="h-5" />
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      </Section>

      <Section title="Tabs, checkbox, radio & slider">
        <div className="flex w-full flex-col gap-5">
          <Tabs defaultValue="general">
            <TabsList>
              <TabsTab value="general">General</TabsTab>
              <TabsTab value="models">Models</TabsTab>
              <TabsTab value="advanced">Advanced</TabsTab>
            </TabsList>
            <TabsPanel value="general" className="pt-3 text-body-sm text-fg-muted">
              Workspace name, theme, language.
            </TabsPanel>
            <TabsPanel value="models" className="pt-3 text-body-sm text-fg-muted">
              Default model, fallbacks, routing.
            </TabsPanel>
            <TabsPanel value="advanced" className="pt-3 text-body-sm text-fg-muted">
              Proxies, telemetry, experimental flags.
            </TabsPanel>
          </Tabs>
          <div className="flex flex-wrap items-start gap-10">
            <div className="flex flex-col gap-2.5">
              <label className="flex items-center gap-2 text-body-md">
                <Checkbox defaultChecked /> Auto-title chats
              </label>
              <label className="flex items-center gap-2 text-body-md">
                <Checkbox /> Share anonymous usage
              </label>
            </div>
            <RadioGroup defaultValue="balanced">
              <label className="flex items-center gap-2 text-body-md">
                <Radio value="fast" /> Fast
              </label>
              <label className="flex items-center gap-2 text-body-md">
                <Radio value="balanced" /> Balanced
              </label>
              <label className="flex items-center gap-2 text-body-md">
                <Radio value="thorough" /> Thorough
              </label>
            </RadioGroup>
            <div className="flex w-64 flex-col gap-1.5">
              <span className="text-label-md text-fg-muted">Temperature</span>
              <Slider defaultValue={0.7} min={0} max={2} step={0.1} showValue />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Avatar & dialog">
        <Avatar fallback="SD" />
        <Avatar size="lg" fallback="AI" />
        <Avatar size="sm" fallback="Q" />
        <Dialog>
          <DialogTrigger render={<Button variant="outline" />}>Delete chat…</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this conversation?</DialogTitle>
              <DialogDescription>
                “Context window slicing” and its 24 messages will be permanently removed.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
              <DialogClose
                render={<Button variant="danger" />}
                onClick={() => toast("Conversation deleted")}
              >
                Delete
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <Section title="Collapsible (tool activity)">
        <Collapsible className="w-full max-w-md">
          <CollapsibleTrigger>
            <MagnifyingGlassIcon size={14} /> Explored 4 files
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="mt-2 flex flex-col gap-1 border-l border-line pl-5 font-mono text-[12px] text-fg-muted">
              <span>apps/desktop/src/renderer/App.tsx</span>
              <span>apps/desktop/src/renderer/globals.css</span>
              <span>packages/ai-core/src/agent.ts</span>
              <span>packages/providers/src/router.ts</span>
            </div>
          </CollapsiblePanel>
        </Collapsible>
      </Section>

      <Section title="Markers (chat timeline)">
        <div className="flex w-full max-w-md flex-col gap-4">
          <Marker>
            <MarkerIcon>
              <GitBranchIcon />
            </MarkerIcon>
            <MarkerContent>Switched to a new branch</MarkerContent>
          </Marker>
          <Marker>
            <MarkerIcon>
              <Spinner size="sm" />
            </MarkerIcon>
            <MarkerContent>Thinking…</MarkerContent>
          </Marker>
          <Marker rule>
            <MarkerContent>Conversation compacted</MarkerContent>
          </Marker>
          <Marker>
            <MarkerIcon>
              <MagnifyingGlassIcon />
            </MarkerIcon>
            <MarkerContent>Explored 4 files</MarkerContent>
          </Marker>
        </div>
      </Section>

      <Section title="Toasts">
        <Button onClick={() => toast("Draft saved", { description: "settings/models" })}>
          Toast
        </Button>
        <Button onClick={() => toast.success("Provider connected")}>Success</Button>
        <Button onClick={() => toast.error("Request failed", { description: "Rate limited — retrying in 30s" })}>
          Error
        </Button>
        <Button
          onClick={() =>
            toast("Chat archived", {
              action: { label: "Undo", onClick: () => toast("Restored") },
            })
          }
        >
          With action
        </Button>
      </Section>

      <Section title="Alerts">
        <div className="flex w-full flex-col gap-3">
          <Alert variant="info">
            <AlertTitle>Model updated</AlertTitle>
            <AlertDescription>Conversations now default to Fable 5.</AlertDescription>
          </Alert>
          <Alert variant="warning">
            <AlertTitle>Approaching context limit</AlertTitle>
            <AlertDescription>This thread is at 82% of the window.</AlertDescription>
          </Alert>
          <Alert variant="danger">
            <AlertTitle>Provider unreachable</AlertTitle>
            <AlertDescription>Check your API key in settings.</AlertDescription>
          </Alert>
        </div>
      </Section>

      <Section title="Card">
        <Card interactive className="w-72">
          <CardHeader>
            <CardTitle>Knowledge base</CardTitle>
            <CardDescription>128 documents · synced 2h ago</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="success">indexed</Badge>
          </CardContent>
        </Card>
      </Section>

      <Section title="Kbd & highlighter">
        <span className="text-body-md text-fg-muted">
          Press <KbdGroup keys={["⌘", "K"]} /> to open the command bar. The{" "}
          <Highlighter>highlighted passage</Highlighter> is what the model cited.
        </span>
      </Section>

      <Section title="Command bar (⌘K)">
        <Button variant="outline" onClick={() => setCommandOpen(true)}>
          Open command bar
          <KbdGroup keys={["⌘", "K"]} className="ml-1" />
        </Button>
        <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
          <CommandInput placeholder="Type a command or search…" />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Navigation">
              <CommandItem onSelect={() => setCommandOpen(false)}>
                <HouseIcon /> Home
                <CommandShortcut>⌘H</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => setCommandOpen(false)}>
                <TrayIcon /> Inbox
                <CommandShortcut>⌘I</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => setCommandOpen(false)}>
                <CubeIcon /> Documents
                <CommandShortcut>⌘D</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => setCommandOpen(false)}>
                <FolderIcon /> Folders
                <CommandShortcut>⌘F</CommandShortcut>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              <CommandItem onSelect={() => setCommandOpen(false)}>
                <PlusIcon /> New file
                <CommandShortcut>⌘N</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => setCommandOpen(false)}>
                <FolderPlusIcon /> New folder
                <CommandShortcut>⇧⌘N</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => setCommandOpen(false)}>
                <CopyIcon /> Copy
                <CommandShortcut>⌘C</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      </Section>

      <Section title="Message scroller">
        <Card className="h-72 w-full overflow-hidden p-0">
          <MessageScrollerProvider>
            <MessageScroller>
              <MessageScrollerViewport className="px-4 py-4">
                <MessageScrollerContent className="gap-3">
                  {DEMO_MESSAGES.map((message) => {
                    const copy = () => {
                      void navigator.clipboard.writeText(message.text);
                      toast("Copied to clipboard");
                    };
                    return (
                      <MessageScrollerItem key={message.id} messageId={message.id}>
                        <Message role={message.role}>
                          <MessageContent>{message.text}</MessageContent>
                          {message.role === "assistant" ? (
                            <MessageActions>
                              <MessageAction label="Copy response" onClick={copy}>
                                <CopyIcon />
                              </MessageAction>
                              <MessageAction
                                label="Regenerate response"
                                onClick={() => toast("Regenerating…")}
                              >
                                <ArrowsClockwiseIcon />
                              </MessageAction>
                              <MessageAction
                                label="Fork conversation"
                                onClick={() => toast("Forked conversation")}
                              >
                                <GitForkIcon />
                              </MessageAction>
                              <MessageAction
                                label="Delete response"
                                className="hover:bg-danger-soft hover:text-danger"
                                onClick={() => toast("Response deleted")}
                              >
                                <TrashIcon />
                              </MessageAction>
                              <MessageTimestamp>{message.time}</MessageTimestamp>
                              <MessageModel>claude-fable-5</MessageModel>
                            </MessageActions>
                          ) : (
                            <MessageActions>
                              <MessageAction label="Edit message" onClick={() => toast("Editing…")}>
                                <PencilSimpleIcon />
                              </MessageAction>
                              <MessageAction label="Copy message" onClick={copy}>
                                <CopyIcon />
                              </MessageAction>
                              <MessageAction label="Retry" onClick={() => toast("Retrying…")}>
                                <ArrowsClockwiseIcon />
                              </MessageAction>
                              <MessageTimestamp>{message.time}</MessageTimestamp>
                            </MessageActions>
                          )}
                        </Message>
                      </MessageScrollerItem>
                    );
                  })}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        </Card>
      </Section>

      <Section title="Context menu (right-click) & drawer">
        <ContextMenu>
          <ContextMenuTrigger className="flex h-24 w-64 select-none items-center justify-center rounded-lg border border-dashed border-line-strong text-body-sm text-fg-muted">
            Right-click here
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>
              <PencilSimpleIcon /> Rename
              <ContextMenuShortcut>⌘R</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem>
              <CopyIcon /> Duplicate
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <DownloadSimpleIcon /> Export
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem>Markdown</ContextMenuItem>
                <ContextMenuItem>JSON</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-danger data-[highlighted]:bg-danger-soft">
              <TrashIcon /> Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        <Drawer>
          <DrawerTrigger render={<Button variant="outline" />}>Open drawer</DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Session details</DrawerTitle>
              <DrawerDescription>Tokens, cost and tool calls for this run.</DrawerDescription>
            </DrawerHeader>
            <DrawerBody>
              <p className="text-body-md text-fg-muted">
                Drawer body content scrolls independently.
              </p>
            </DrawerBody>
            <DrawerFooter>
              <Button variant="ghost">Cancel</Button>
              <Button variant="primary">Done</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </Section>

      <Section title="Composer">
        <Composer
          className="w-full"
          leading={
            <Menu>
              <MenuTrigger render={<ComposerButton aria-label="Attach" />}>
                <PaperclipIcon size={18} />
              </MenuTrigger>
              <MenuContent side="top" align="start" sideOffset={10}>
                <MenuItem>
                  <ImagesIcon /> Add files and photos
                  <MenuShortcut>
                    <KbdGroup keys={["⌘", "U"]} />
                  </MenuShortcut>
                </MenuItem>
                <MenuSeparator />
                <MenuItem>
                  <LightningIcon /> Skills
                </MenuItem>
                <MenuItem>
                  <CubeIcon /> Artifacts
                </MenuItem>
                <MenuItem>
                  <BrainIcon /> Memories
                </MenuItem>
              </MenuContent>
            </Menu>
          }
          onSubmit={(value) => console.log("submit:", value)}
        />
      </Section>
    </div>
  );
}
