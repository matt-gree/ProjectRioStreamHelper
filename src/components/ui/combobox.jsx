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
 * `{ label, value, image, detail }`. When an item carries an `image` url
 * it renders a small sprite (pixelated) before the label in both the
 * trigger and the dropdown — used for MSB team logos / character icons.
 * An item may carry a `group` name, in which case the list is sectioned
 * under headings in the order the groups first appear — the caller's
 * order, so a tier that should lead (today's options over retired ones)
 * leads. `creatable` lets typed text outside `data` be committed as-is
 * (e.g. a free-text system font name the picker doesn't enumerate).
 * Built on shadcn Command + Popover.
 *
 * `detail` IS THE SECOND HALF OF AN ITEM, not a tooltip on it. A picker
 * whose options are people or characters is scanned for the label and
 * chosen on something else — what that character did at the plate, what
 * a font looks like — and a list of bare names asks the producer to hold
 * that elsewhere. It renders under the label in the list and trails the
 * label, dimmed, on the trigger, so the closed control still says the
 * whole answer and nothing below it has to repeat the selection.
 *
 * THE CMDK VALUE IS THE ITEM'S VALUE, NOT ITS LABEL. cmdk keys, filters
 * and dedupes on `value`, so two items sharing a label (both sides of a
 * game fielding the same character) were one row that highlighted in two
 * places. Search still matches the label — and now the detail — through
 * `keywords`.
 *
 * `columns` LAYS THE SECTIONS SIDE BY SIDE instead of stacking them, and
 * gives the list the height to finish them. It is for the case where the
 * groups are PEERS of a known, bounded size — the two sides of a ball
 * game, nine roster slots each — where stacking asks a producer to scroll
 * past one whole team to see the other, and where seeing both at once is
 * the comparison they opened the picker to make. It is opt-in because it
 * is wrong for the ordinary case (many groups, or unbounded ones), and it
 * needs a wide trigger: the popover matches the trigger's width.
 * ------------------------------------------------------------------ */

/*
 * MSB art is USER-SUPPLIED (Nintendo IP; PRSH ships none of it), so a
 * missing file is an ordinary state, not a broken picker. Hide the ink
 * and keep the box: a row that loses its icon must not re-flow the rows
 * either side of it into a ragged column.
 */
function ItemImage({ src, className }) {
  return (
    <img
      src={src}
      alt=""
      className={cn("shrink-0 object-contain pixelated", className)}
      onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
    />
  );
}
export const Combobox = React.forwardRef(function Combobox(
  { data = [], value, onChange, placeholder = "Select…", searchPlaceholder = "Search…",
    nothingFound = "Nothing found", clearable = false, clearLabel = "Clear selection",
    disabled, className, creatable = false, columns = false,
    onOpen, ...props }, ref
) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const items = data.map((d) => (typeof d === "string" ? { label: d, value: d } : d));
  const selected = items.find((i) => i.value === value);
  const trimmed = search.trim();
  const showCreate = creatable && trimmed.length > 0 &&
    !items.some((i) => i.label.toLowerCase() === trimmed.toLowerCase());

  // Group name -> items, in first-appearance order. No group on any item is the
  // ungrouped case: one section, no heading, exactly as before.
  const sections = [];
  for (const item of items) {
    const name = item.group ?? null;
    const section = sections.find((s) => s.name === name);
    if (section) section.items.push(item);
    else sections.push({ name, items: [item] });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => { setOpen(o); if (o) onOpen?.(); else setSearch(""); }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        <button
          ref={ref}
          type="button"
          role="combobox"
          aria-expanded={open}
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
            {selected?.image && <ItemImage src={selected.image} className="size-4" />}
            <span className="truncate">
              {selected ? selected.label : (creatable && value) ? value : placeholder}
            </span>
            {selected?.detail && (
              <span className="min-w-0 truncate text-xs text-muted-foreground">{selected.detail}</span>
            )}
          </span>
          <span className="flex items-center gap-1">
            {/* Named, because on a picker whose whole job is to hold one
                value, clearing it is a distinct act with a distinct
                consequence — and an unlabelled glyph is one a screen reader
                (and a test) can only call "×". It stays a span inside the
                trigger rather than a nested <button>, which is invalid. */}
            {clearable && (selected || (creatable && value)) && (
              <X
                role="button"
                aria-label={clearLabel}
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
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList
            className={cn(
              // cmdk wraps the list's children in its own sizer div, so the
              // columns have to be laid out one level in from here.
              columns && "max-h-[min(70vh,30rem)] [&>[cmdk-list-sizer]]:flex [&>[cmdk-list-sizer]]:items-start"
            )}
          >
            {!showCreate && <CommandEmpty>{nothingFound}</CommandEmpty>}
            {sections.map((section) => (
              <CommandGroup
                key={section.name ?? "__all__"}
                heading={section.name ?? undefined}
                className={cn(columns && "min-w-0 flex-1")}
              >
                {section.items.map((item) => (
                  <CommandItem
                    key={item.value}
                    value={String(item.value)}
                    keywords={[item.label, item.detail].filter(Boolean)}
                    onSelect={() => { onChange?.(item.value); setSearch(""); setOpen(false); }}
                    // A two-line item is not two rows of padding. The vertical
                    // space that reads as comfortable under one line reads as
                    // a gap under two, and it is paid for in how many options
                    // fit on screen at once — which on a roster picker is the
                    // whole point of the list.
                    className={cn(item.detail && "gap-1.5 py-1")}
                  >
                    <Check className={cn(
                      "shrink-0 opacity-0",
                      item.detail ? "mr-0.5 size-3.5" : "mr-2 size-4",
                      item.value === value && "opacity-100",
                    )} />
                    {item.image && (
                      <ItemImage src={item.image} className={cn("mr-1.5", item.detail ? "size-6" : "size-4")} />
                    )}
                    {item.detail ? (
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate leading-[1.15]">{item.label}</span>
                        <span className="truncate text-[0.6875rem] leading-[1.15] text-muted-foreground">
                          {item.detail}
                        </span>
                      </span>
                    ) : item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {showCreate && (
              <CommandGroup>
                <CommandItem
                  key="__create__"
                  value={trimmed}
                  onSelect={() => { onChange?.(trimmed); setSearch(""); setOpen(false); }}
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
});
