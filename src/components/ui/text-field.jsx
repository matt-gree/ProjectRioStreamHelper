import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

let idCounter = 0;

/* ------------------------------------------------------------------ *
 * TextField — Mantine-`TextInput`-shaped wrapper over the shadcn Input.
 *
 * Carries the label / description / error chrome so the many
 * `<TextInput label=… value=… onChange={e => …e.currentTarget.value} />`
 * call sites port unchanged (the raw change event is passed through, and
 * native events expose `currentTarget`). `leftSection` / `rightSection`
 * render inline adornments like Mantine.
 * ------------------------------------------------------------------ */
export const TextField = React.forwardRef(function TextField(
  { label, description, error, leftSection, rightSection, className, inputClassName,
    id, required, ...props }, ref
) {
  const autoId = React.useMemo(() => id || `tf-${++idCounter}`, [id]);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label htmlFor={autoId} className="field-label">
          {label}{required && <span className="text-primary"> *</span>}
        </Label>
      )}
      <div className="relative flex items-center">
        {leftSection && (
          <span className="absolute left-2.5 flex items-center text-muted-foreground">
            {leftSection}
          </span>
        )}
        <Input
          ref={ref}
          id={autoId}
          aria-invalid={!!error}
          className={cn(leftSection && "pl-8", rightSection && "pr-8", inputClassName)}
          {...props}
        />
        {rightSection && (
          <span className="absolute right-2.5 flex items-center text-muted-foreground">
            {rightSection}
          </span>
        )}
      </div>
      {description && !error && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
});
