import * as React from "react";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * SimpleSelect — a Mantine-shaped wrapper over the shadcn Select.
 *
 * Accepts `data` (array of strings or `{ label, value, disabled }`, or
 * grouped `{ group, items }`) plus `value` / `onChange(value)`, so the
 * many Mantine `<Select data=… value=… onChange=… />` call sites port
 * without restructuring into the composed shadcn form.
 *
 * Note: Radix Select cannot represent an empty-string item value. Use
 * `clearable` + a placeholder for "no selection" instead.
 * ------------------------------------------------------------------ */
export const SimpleSelect = React.forwardRef(function SimpleSelect(
  { data = [], value, onChange, placeholder, disabled, size = "sm",
    triggerClassName, contentClassName, ...props }, ref
) {
  const normalize = (d) => (typeof d === "string" ? { label: d, value: d } : d);
  const isGrouped = data.length > 0 && data[0] && data[0].group !== undefined && data[0].items;

  return (
    <Select
      value={value ?? undefined}
      onValueChange={(v) => onChange?.(v)}
      disabled={disabled}
      {...props}
    >
      <SelectTrigger ref={ref} size={size} className={cn("w-full", triggerClassName)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        {isGrouped
          ? data.map((grp) => (
              <SelectGroup key={grp.group}>
                <SelectLabel>{grp.group}</SelectLabel>
                {grp.items.map(normalize).map((it) => (
                  <SelectItem key={it.value} value={it.value} disabled={it.disabled}>
                    {it.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))
          : data.map(normalize).map((it) => (
              <SelectItem key={it.value} value={it.value} disabled={it.disabled}>
                {it.label}
              </SelectItem>
            ))}
      </SelectContent>
    </Select>
  );
});
