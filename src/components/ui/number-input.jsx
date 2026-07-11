import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * NumberInput — replaces Mantine's component.
 *
 * Controlled `value`/`onChange(number)` matching Mantine's signature
 * (onChange receives the parsed number, not the event). Honors min/max/
 * step and clamps on blur. Native spinner arrows are hidden via CSS in
 * index.css-adjacent utility; we render a clean numeric field.
 * ------------------------------------------------------------------ */
export const NumberInput = React.forwardRef(function NumberInput(
  { value, onChange, min, max, step = 1, disabled, className, allowDecimal = false, suffix, ...props }, ref
) {
  const clamp = (n) => {
    if (Number.isNaN(n)) return n;
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
  };

  const handleChange = (e) => {
    const raw = e.target.value;
    if (raw === "" || raw === "-") {
      onChange?.(raw === "" ? "" : raw);
      return;
    }
    // Do NOT clamp while typing — clamping to `min` on every keystroke makes a
    // field with a lower limit unusable (clear it, start typing "60" and it
    // snaps to the min on the first digit). Clamp on blur instead, so partial
    // entries below the minimum are allowed until the field loses focus.
    const parsed = allowDecimal ? parseFloat(raw) : parseInt(raw, 10);
    if (!Number.isNaN(parsed)) onChange?.(parsed);
  };

  const handleBlur = (e) => {
    const parsed = allowDecimal ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
    if (!Number.isNaN(parsed)) onChange?.(clamp(parsed));
    props.onBlur?.(e);
  };

  const input = (
    <Input
      ref={ref}
      type="number"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      value={value ?? ""}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={handleChange}
      onBlur={handleBlur}
      className={cn(
        "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none tabular-nums",
        suffix && "pr-7",
        className
      )}
      {...props}
    />
  );

  if (suffix == null) return input;
  return (
    <div className="relative flex items-center">
      {input}
      <span className="pointer-events-none absolute right-2.5 text-sm text-muted-foreground">{suffix}</span>
    </div>
  );
});
