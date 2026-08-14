import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function ScrollArea({
  className,
  children,
  viewportRef,
  ...props
}) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn("relative", className)} {...props}>
      {/* `[&>div]:!block` is load-bearing. Radix wraps the viewport's children
          in a shrink-to-fit `display: table` so a list CAN scroll sideways —
          but we only ever render the vertical scrollbar, so sideways content is
          clipped, not reachable. Meanwhile the table sizes to the widest
          `truncate` label (which is `white-space: nowrap`), so rows grow PAST
          the pane instead of ellipsizing: the rack's board rows measured 313px
          inside a 278px pane, with the pin and the trash pushed out of sight.
          A block box has the pane's definite width, which is what a truncating
          label needs to measure against. (Same trap, written up again in
          ../../routes/production/addsource.jsx, which sidesteps it with a plain
          scroll container.) */}
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className="size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 [&>div]:!block">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent",
        className
      )}
      {...props}>
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar }
