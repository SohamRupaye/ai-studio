import * as React from "react";
import { Combobox as BaseCombobox } from "@base-ui-components/react/combobox";
import { CaretDownIcon, CheckIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { cn } from "../../lib/utils";
import { popupClasses, itemClasses } from "./menu";

// Select-with-search: a Select-looking trigger opening a filterable list
// (Base UI Combobox filters {value,label} items against the input for us).
// Use plain Select for short lists; this for models, files, branches…
interface ComboboxItem {
  value: string;
  label: string;
}

interface ComboboxProps {
  items: ComboboxItem[];
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
}

function Combobox({
  items,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyMessage = "No results.",
  disabled,
  className,
}: ComboboxProps) {
  const [innerValue, setInnerValue] = React.useState<string | null>(defaultValue ?? null);
  const currentValue = value !== undefined ? value : innerValue;
  const selected = items.find((item) => item.value === currentValue) ?? null;

  return (
    <BaseCombobox.Root
      items={items}
      value={selected}
      onValueChange={(item: ComboboxItem | null) => {
        if (value === undefined) setInnerValue(item?.value ?? null);
        onValueChange?.(item?.value ?? null);
      }}
      disabled={disabled}
    >
      <BaseCombobox.Trigger
        className={cn(
          "pressable flex h-8 min-w-36 select-none items-center justify-between gap-2 rounded-md border border-line bg-surface-2 pl-3 pr-2.5 text-label-md shadow-raised",
          "hover:border-line-strong hover:bg-surface-3 data-[popup-open]:border-line-strong data-[popup-open]:bg-surface-3",
          "data-[disabled]:pointer-events-none",
          selected ? "text-fg" : "text-fg-muted",
          className,
        )}
      >
        <span className="min-w-0 truncate">{selected?.label ?? placeholder}</span>
        <span className="flex shrink-0 text-fg-subtle transition-transform duration-200 ease-(--ease-standard) in-data-[popup-open]:rotate-180">
          <CaretDownIcon size={12} weight="bold" />
        </span>
      </BaseCombobox.Trigger>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner className="z-50 outline-none" sideOffset={6}>
          <BaseCombobox.Popup
            className={cn(popupClasses, "w-(--anchor-width) min-w-52 p-0")}
          >
            <div className="flex items-center gap-2 border-b border-line px-3">
              <MagnifyingGlassIcon size={14} className="shrink-0 text-fg-subtle" />
              <BaseCombobox.Input
                placeholder={searchPlaceholder}
                className="h-9 min-w-0 flex-1 bg-transparent text-body-md text-fg outline-none placeholder:text-fg-subtle"
              />
            </div>
            <BaseCombobox.Empty className="py-6 text-center text-body-sm text-fg-muted empty:hidden">
              {emptyMessage}
            </BaseCombobox.Empty>
            <BaseCombobox.List className="max-h-64 overflow-y-auto p-1.5">
              {(item: ComboboxItem) => (
                <BaseCombobox.Item
                  key={item.value}
                  value={item}
                  className={cn(itemClasses, "relative pr-8")}
                >
                  <span className="min-w-0 truncate">{item.label}</span>
                  <BaseCombobox.ItemIndicator className="absolute right-2.5 flex">
                    <CheckIcon size={14} weight="bold" />
                  </BaseCombobox.ItemIndicator>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}

export { Combobox, type ComboboxItem, type ComboboxProps };
