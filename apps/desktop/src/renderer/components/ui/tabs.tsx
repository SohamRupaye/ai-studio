import * as React from "react";
import { Tabs as BaseTabs } from "@base-ui-components/react/tabs";
import { cn } from "../../lib/utils";

// Segmented tabs: recessed list, and a raised indicator rectangle that
// SLIDES between tabs (positioned via Base UI's --active-tab-* vars).
// List 10px radius − 4px padding = 6px indicator. NB: the active attribute
// is data-active, not data-selected.
const Tabs = BaseTabs.Root;

function TabsList({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      className={cn(
        "relative inline-flex items-center gap-1 rounded-md border border-line bg-surface-1 p-1",
        className,
      )}
      {...props}
    >
      {children}
      <BaseTabs.Indicator
        className={cn(
          "absolute left-(--active-tab-left) top-(--active-tab-top) h-(--active-tab-height) w-(--active-tab-width)",
          "rounded-[6px] bg-surface-3 shadow-raised",
          "transition-[left,top,width,height] duration-200 ease-(--ease-standard)",
        )}
      />
    </BaseTabs.List>
  );
}

function TabsTab({ className, ...props }: React.ComponentProps<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      className={cn(
        "pressable relative z-[1] flex h-7 select-none items-center gap-1.5 rounded-[6px] px-3 text-label-md text-fg-muted",
        "hover:text-fg data-[active]:text-fg",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function TabsPanel({ className, ...props }: React.ComponentProps<typeof BaseTabs.Panel>) {
  return <BaseTabs.Panel className={cn("outline-none", className)} {...props} />;
}

export { Tabs, TabsList, TabsTab, TabsPanel };
