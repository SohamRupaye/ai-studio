import { Share2, Star, MoreHorizontal, GitBranch } from "lucide-react";
import { Button } from "./ui/button";

export function TitleBar() {
  return (
    <header className="drag-region flex h-11 shrink-0 items-center justify-between border-b border-border bg-background px-4">
      {/* macOS traffic lights spacer */}
      <div className="w-16" />

      {/* Breadcrumb */}
      <div className="no-drag flex items-center gap-1 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Chat name</span>
        <span>›</span>
        <span>Branch</span>
      </div>

      {/* Actions */}
      <div className="no-drag flex items-center gap-1">
        <Button variant="ghost" size="sm">
          <Share2 className="h-4 w-4" />
          Share
        </Button>
        <Button variant="ghost" size="icon">
          <Star className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm">
          <GitBranch className="h-4 w-4" />
          New Branch
        </Button>
      </div>
    </header>
  );
}
