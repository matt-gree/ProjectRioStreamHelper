import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/* ------------------------------------------------------------------ *
 * SimpleTooltip — Mantine-shaped `<Tooltip label>` wrapper.
 *
 * Mantine call sites do `<Tooltip label="…"><Thing/></Tooltip>`. This
 * preserves that ergonomics over the composed shadcn primitives. A
 * single <TooltipProvider> lives at the app root.
 * ------------------------------------------------------------------ */
export function SimpleTooltip({ label, children, side = "top", disabled, ...props }) {
  if (disabled || label == null || label === "") return children;
  return (
    <Tooltip {...props}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
