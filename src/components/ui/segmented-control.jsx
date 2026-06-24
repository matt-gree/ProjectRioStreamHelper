import * as React from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * SegmentedControl — replaces Mantine's component.
 *
 * Controlled value/onChange. `data` accepts either an array of strings
 * or `{ label, value }` objects, matching Mantine's API so callers port
 * with no shape changes. Rio styling: night-800 track, night-700 active
 * segment, Rajdhani labels.
 * ------------------------------------------------------------------ */
export function SegmentedControl({
  data = [],
  value,
  onChange,
  fullWidth = false,
  size = "sm",
  disabled = false,
  className,
  ...props
}) {
  const items = data.map((d) => (typeof d === "string" ? { label: d, value: d } : d));
  const pad = size === "xs" ? "px-2 py-0.5 text-xs" : size === "lg" ? "px-4 py-2 text-sm" : "px-3 py-1 text-xs";

  return (
    <div
      role="radiogroup"
      className={cn(
        "inline-flex items-stretch rounded-[8px] border border-border bg-muted p-0.5",
        fullWidth && "flex w-full",
        className
      )}
      {...props}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled || item.disabled}
            onClick={() => !active && onChange?.(item.value)}
            className={cn(
              "label-display rounded-[6px] transition-colors disabled:pointer-events-none disabled:opacity-50",
              pad,
              fullWidth && "flex-1",
              active
                ? "bg-secondary text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
