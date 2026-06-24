import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * MultiSelect — replaces Mantine's component.
 *
 * Controlled `value` (array of string values) / `onChange(string[])`.
 * `data` is an array of strings or `{ label, value }`. Built on the
 * shadcn Command + Popover combobox pattern.
 * ------------------------------------------------------------------ */
export function MultiSelect({
  data = [],
  value = [],
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  nothingFound = "Nothing found",
  disabled,
  className,
}) {
  const [open, setOpen] = React.useState(false);
  const items = data.map((d) => (typeof d === "string" ? { label: d, value: d } : d));
  const labelFor = (v) => items.find((i) => i.value === v)?.label ?? v;

  const toggle = (v) => {
    onChange?.(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex min-h-8 w-full items-center justify-between gap-1 rounded-md border border-input bg-transparent px-2.5 py-1 text-sm",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none disabled:opacity-50",
            className
          )}
        >
          <span className="flex flex-1 flex-wrap gap-1">
            {value.length === 0 && <span className="text-muted-foreground">{placeholder}</span>}
            {value.map((v) => (
              <Badge key={v} variant="secondary" className="gap-1">
                {labelFor(v)}
                <X
                  className="size-3 cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); toggle(v); }}
                />
              </Badge>
            ))}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{nothingFound}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem key={item.value} value={item.label} onSelect={() => toggle(item.value)}>
                  <Check className={cn("mr-2 size-4", value.includes(item.value) ? "opacity-100" : "opacity-0")} />
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
}
