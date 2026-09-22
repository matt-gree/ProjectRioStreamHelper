import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * PasswordInput — masked input with a show/hide toggle.
 * Replaces Mantine's PasswordInput.
 * ------------------------------------------------------------------ */
export const PasswordInput = React.forwardRef(function PasswordInput(
  { className, ...props }, ref
) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative flex items-center">
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        className={cn("pr-9", className)}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible(v => !v)}
        className="absolute right-2 text-muted-foreground hover:text-foreground"
        aria-label={visible ? "Hide" : "Show"}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
});
