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
 * `data` is an array of strings or `{ label, value }`. An item may carry
 * a `group` name, in which case the list is sectioned under headings in
 * the order the groups first appear — the caller's order, so a tier that
 * should lead (today's options over retired ones) leads. `creatable`
 * lets typed text outside `data` be committed as-is, for a field whose
 * vocabulary is open (a search filter over a catalogue nobody enumerates
 * fully). Built on the shadcn Command + Popover combobox pattern.
 * ------------------------------------------------------------------ */
export function MultiSelect({
  data = [],
  value = [],
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  nothingFound = "Nothing found",
  creatable = false,
  disabled,
  className,
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const items = data.map((d) => (typeof d === "string" ? { label: d, value: d } : d));
  const labelFor = (v) => items.find((i) => i.value === v)?.label ?? v;
  const trimmed = search.trim();
  const showCreate = creatable && trimmed.length > 0 &&
    !items.some((i) => i.label.toLowerCase() === trimmed.toLowerCase());

  // Group name -> items, in first-appearance order. No group on any item is the
  // ungrouped case: one section, no heading, exactly as before.
  const sections = [];
  for (const item of items) {
    const name = item.group ?? null;
    const last = sections.find((s) => s.name === name);
    if (last) last.items.push(item);
    else sections.push({ name, items: [item] });
  }

  const toggle = (v) => {
    onChange?.(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}
    >
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
                {/* Wrap in a span: Badge sets [&>svg]:pointer-events-none on
                    direct svg children, which would eat the click otherwise. */}
                <span
                  role="button"
                  aria-label={`Remove ${labelFor(v)}`}
                  className="inline-flex cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); toggle(v); }}
                >
                  <X className="size-3" />
                </span>
              </Badge>
            ))}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {!showCreate && <CommandEmpty>{nothingFound}</CommandEmpty>}
            {sections.map((section) => (
              <CommandGroup key={section.name ?? "__all__"} heading={section.name ?? undefined}>
                {section.items.map((item) => (
                  <CommandItem key={item.value} value={item.label} onSelect={() => toggle(item.value)}>
                    <Check className={cn("mr-2 size-4", value.includes(item.value) ? "opacity-100" : "opacity-0")} />
                    {item.image && (
                      <img src={item.image} alt="" className="mr-1.5 size-4 shrink-0 object-contain pixelated" />
                    )}
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {showCreate && (
              <CommandGroup>
                <CommandItem
                  key="__create__"
                  value={trimmed}
                  onSelect={() => { toggle(trimmed); setSearch(""); }}
                >
                  <Check className="mr-2 size-4 opacity-0" />
                  Use "{trimmed}"
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
