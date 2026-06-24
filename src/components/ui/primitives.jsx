import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Lightweight layout primitives.
 *
 * These mirror the handful of Mantine layout components the app leaned
 * on (Stack, Group, Box, Text, Title, Loader, Divider, Anchor, Center)
 * so the migration stays mechanical. They are thin wrappers over plain
 * Tailwind utilities — no new design language, no theme coupling.
 * ------------------------------------------------------------------ */

// gap tokens map Mantine's xs/sm/md/lg/xl spacing onto the 4px grid.
const GAP = { xs: "gap-1", sm: "gap-2", md: "gap-4", lg: "gap-6", xl: "gap-8" };
const gapClass = (g) => (g == null ? GAP.md : GAP[g] ?? (typeof g === "number" ? "" : ""));
const gapStyle = (g) => (typeof g === "number" ? { gap: `${g}px` } : undefined);

// Vertical flex stack.
export const Stack = React.forwardRef(function Stack(
  { gap, align, justify, className, style, ...props }, ref
) {
  return (
    <div
      ref={ref}
      className={cn("flex flex-col", gapClass(gap), className)}
      style={{
        ...gapStyle(gap),
        alignItems: align,
        justifyContent: justify,
        ...style,
      }}
      {...props}
    />
  );
});

// Horizontal flex row (Mantine Group defaults to center-aligned, wrapping).
export const Group = React.forwardRef(function Group(
  { gap, align = "center", justify, wrap = true, className, style, ...props }, ref
) {
  return (
    <div
      ref={ref}
      className={cn("flex flex-row", wrap && "flex-wrap", gapClass(gap), className)}
      style={{
        ...gapStyle(gap),
        alignItems: align,
        justifyContent: justify,
        ...style,
      }}
      {...props}
    />
  );
});

// Plain div passthrough.
export const Box = React.forwardRef(function Box({ className, ...props }, ref) {
  return <div ref={ref} className={className} {...props} />;
});

// Centered flex container.
export const Center = React.forwardRef(function Center({ className, ...props }, ref) {
  return <div ref={ref} className={cn("flex items-center justify-center", className)} {...props} />;
});

const TEXT_SIZE = {
  xs: "text-xs", sm: "text-sm", md: "text-base", lg: "text-lg", xl: "text-xl",
};
const FW = { 400: "font-normal", 500: "font-medium", 600: "font-semibold", 700: "font-bold" };

// Text — span by default. `dimmed` → muted foreground. `c` passes a raw color.
export const Text = React.forwardRef(function Text(
  { size, fw, c, dimmed, span, ta, truncate, className, style, ...props }, ref
) {
  const Comp = span ? "span" : "p";
  return (
    <Comp
      ref={ref}
      className={cn(
        TEXT_SIZE[size] ?? "text-sm",
        fw != null && FW[fw],
        dimmed && "text-muted-foreground",
        truncate && "truncate",
        className
      )}
      style={{ color: dimmed ? undefined : c, textAlign: ta, ...style }}
      {...props}
    />
  );
});

const TITLE_TAG = { 1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" };
const TITLE_SIZE = { 1: "text-2xl", 2: "text-xl", 3: "text-lg", 4: "text-base", 5: "text-sm", 6: "text-xs" };

// Title — Rajdhani display heading.
export const Title = React.forwardRef(function Title(
  { order = 1, className, ...props }, ref
) {
  const Comp = TITLE_TAG[order] ?? "h1";
  return (
    <Comp
      ref={ref}
      className={cn("label-display font-bold", TITLE_SIZE[order], className)}
      {...props}
    />
  );
});

const LOADER_SIZE = { xs: 14, sm: 18, md: 24, lg: 32, xl: 40 };

// Loader — spinning Rio-red indicator.
export function Loader({ size = "md", className, ...props }) {
  const px = typeof size === "number" ? size : LOADER_SIZE[size] ?? 24;
  return (
    <Loader2
      size={px}
      className={cn("animate-spin text-primary", className)}
      {...props}
    />
  );
}

// Divider — horizontal or vertical hairline, with optional centered label.
export function Divider({ orientation = "horizontal", label, className, ...props }) {
  if (orientation === "vertical") {
    return <div className={cn("w-px self-stretch bg-border", className)} {...props} />;
  }
  if (label) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)} {...props}>
        <span className="h-px flex-1 bg-border" />
        <span className="label-display">{label}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }
  return <div className={cn("h-px w-full bg-border", className)} {...props} />;
}

// Anchor — styled link in Rio red.
export const Anchor = React.forwardRef(function Anchor({ className, ...props }, ref) {
  return (
    <a
      ref={ref}
      className={cn("text-primary underline-offset-4 hover:underline cursor-pointer", className)}
      {...props}
    />
  );
});
