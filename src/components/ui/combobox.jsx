import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Combobox — a searchable / clearable single-select.
 *
 * Replaces Mantine `<Select searchable clearable />`. Controlled
 * `value` / `onChange(value | null)`; `data` is strings or
 * `{ label, value, image }`. When an item carries an `image` url it
 * renders a small sprite (pixelated) before the label in both the
 * trigger and the dropdown — used for MSB team logos / character icons.
 * Built on shadcn Command + Popover.
 * ------------------------------------------------------------------ */
export const Combobox = React.forwardRef(function Combobox(
  { data = [], value, onChange, placeholder = "Select…", searchPlaceholder = "Search…",
    nothingFound = "Nothing found", clearable = false, disabled, className, ...props }, ref
) {
  const [open, setOpen] = React.useState(false);
  const items = data.map((d) => (typeof d === "string" ? { label: d, value: d } : d));
  const selected = items.find((i) => i.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-2.5 py-1 text-sm",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none disabled:opacity-50",
            !selected && "text-muted-foreground",
            className
          )}
          {...props}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {selected?.image && (
              <img src={selected.image} alt="" className="size-4 shrink-0 object-contain pixelated" />
            )}
            <span className="truncate">{selected ? selected.label : placeholder}</span>
          </span>
          <span className="flex items-center gap-1">
            {clearable && selected && (
              <X
                className="size-3.5 opacity-60 hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); onChange?.(null); }}
              />
            )}
            <ChevronsUpDown className="size-4 opacity-50" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{nothingFound}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.value}
                  value={item.label}
                  onSelect={() => { onChange?.(item.value); setOpen(false); }}
                >
                  <Check className={cn("mr-2 size-4", item.value === value ? "opacity-100" : "opacity-0")} />
                  {item.image && (
                    <img src={item.image} alt="" className="mr-1.5 size-4 shrink-0 object-contain pixelated" />
                  )}
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
