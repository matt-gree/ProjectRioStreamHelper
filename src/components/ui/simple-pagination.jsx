import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * SimplePagination — Mantine-`Pagination`-shaped numeric pager.
 *
 * `total` = page count, `value` = current page (1-based),
 * `onChange(page)`. Renders a compact windowed list of page buttons.
 * ------------------------------------------------------------------ */
export function SimplePagination({ total, value, onChange, siblings = 1, className }) {
  if (!total || total < 1) return null;

  const pages = [];
  const start = Math.max(1, value - siblings);
  const end = Math.min(total, value + siblings);
  if (start > 1) pages.push(1);
  if (start > 2) pages.push("…");
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push("…");
  if (end < total) pages.push(total);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        variant="outline"
        size="icon-sm"
        disabled={value <= 1}
        onClick={() => onChange?.(value - 1)}
      >
        <ChevronLeft size={14} />
      </Button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-1 text-sm text-muted-foreground">…</span>
        ) : (
          <Button
            key={p}
            variant={p === value ? "default" : "outline"}
            size="icon-sm"
            className="tabular-nums"
            onClick={() => onChange?.(p)}
          >
            {p}
          </Button>
        )
      )}
      <Button
        variant="outline"
        size="icon-sm"
        disabled={value >= total}
        onClick={() => onChange?.(value + 1)}
      >
        <ChevronRight size={14} />
      </Button>
    </div>
  );
}
