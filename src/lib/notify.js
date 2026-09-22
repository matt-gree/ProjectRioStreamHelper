import { toast } from "sonner";

/* ------------------------------------------------------------------ *
 * notify — a Mantine-`notifications`-shaped adapter over sonner.
 *
 * Lets the many `notifications.show({ message, color })` call sites port
 * by swapping only the import. Maps Mantine's color convention onto
 * sonner's typed variants.
 * ------------------------------------------------------------------ */

const VARIANT = {
  red: "error",
  green: "success",
  yellow: "warning",
  orange: "warning",
};

function show({ id, title, message, color, autoClose, loading } = {}) {
  const opts = { id };
  if (title && message) {
    opts.description = message;
  }
  const head = title || message;
  if (autoClose === false) opts.duration = Infinity;

  if (loading) return toast.loading(head, opts);

  const variant = VARIANT[color];
  if (variant) return toast[variant](head, opts);
  if (color === "blue" || color === "gray" || color === "grey") {
    return toast.info(head, opts);
  }
  return toast(head, opts);
}

export const notifications = {
  show,
  hide: (id) => toast.dismiss(id),
  clean: () => toast.dismiss(),
  update: ({ id, ...rest }) => show({ id, ...rest }),
};
