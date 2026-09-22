import * as React from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Panel — the Rio `.panel` card.
 *
 * night-900 fill, 1px night-700 hairline border, 12px radius, clipped so
 * flush headers/tables don't bleed past the corners. `glow` adds the
 * signature red bloom on hover.
 *
 * Pass `title` (and optionally `actions`) to render a flush header strip
 * — a raised night-850 band with an uppercase Rajdhani title on the left
 * and controls on the right. This is what makes each card read as a
 * titled module rather than a floating box of inputs. `header` is kept as
 * an alias for `title` for back-compat.
 * ------------------------------------------------------------------ */
export const Panel = React.forwardRef(function Panel(
  { glow = true, title, header, actions, withBorder = true, className, children, ...props }, ref
) {
  const heading = title ?? header;
  return (
    <div
      ref={ref}
      className={cn(
        "overflow-hidden rounded-[12px] bg-card",
        withBorder && "border border-border",
        glow && "panel-glow",
        className
      )}
      {...props}
    >
      {(heading != null || actions != null) && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-popover px-4 py-2.5">
          {heading != null && <span className="label-display text-xs text-foreground">{heading}</span>}
          {actions != null && <div className="flex items-center gap-1.5">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
});
