import * as React from "react";
import { HexColorPicker } from "react-colorful";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * ColorInput — replaces Mantine's component.
 *
 * Controlled `value`/`onChange(hex)`. A swatch button opens a popover
 * with react-colorful's hex picker plus a text field and an optional
 * row of preset swatches. Matches the Mantine API closely enough to
 * port the Layouts design tab with minimal churn.
 * ------------------------------------------------------------------ */
export const ColorInput = React.forwardRef(function ColorInput(
  { value = "", onChange, swatches = [], disabled, placeholder = "#000000", className, ...props }, ref
) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div ref={ref} className={cn("relative flex items-center", className)} {...props}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label="Pick color"
            disabled={disabled}
            className="absolute left-2 size-5 rounded-[4px] border border-border disabled:opacity-50"
            style={{ backgroundColor: value || "transparent" }}
          />
        </PopoverTrigger>
        <Input
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange?.(e.target.value)}
          className="pl-9 tabular-nums"
        />
      </div>
      <PopoverContent className="w-auto p-3">
        <HexColorPicker color={value || "#000000"} onChange={onChange} />
        {swatches.length > 0 && (
          <div className="mt-3 grid grid-cols-7 gap-1">
            {swatches.map((s) => (
              <button
                key={s}
                type="button"
                aria-label={s}
                onClick={() => onChange?.(s)}
                className="size-5 rounded-[4px] border border-border"
                style={{ backgroundColor: s }}
              />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
});
