import { useState } from "react";
import { Send, Square, AtSign, GitFork, ChevronDown, Plus } from "lucide-react";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";

export function ChatView() {
  const [input, setInput] = useState("");

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Messages area */}
      <ScrollArea className="flex-1 px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-center h-full gap-4">
          <div className="text-4xl">👋</div>
          <p className="text-sm text-muted-foreground">Good Morning, Soham!</p>
          <h1 className="text-2xl font-semibold">What shall we build today?</h1>
        </div>
      </ScrollArea>

      {/* Input bar */}
      <div className="border-t border-border px-6 py-3">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-xl border border-input bg-background p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask anything or give a command..."
              rows={1}
              className="flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); /* send */ } }}
            />
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Action buttons below input */}
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                <Plus className="h-3 w-3" />
              </Button>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                <AtSign className="h-3 w-3" /> context
              </Button>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                <GitFork className="h-3 w-3" /> fork
              </Button>
            </div>
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
              claude opus 4.7 <ChevronDown className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
