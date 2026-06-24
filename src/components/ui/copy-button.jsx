import * as React from "react";

/* ------------------------------------------------------------------ *
 * CopyButton — Mantine-shaped render-prop copy helper.
 *
 * Usage: <CopyButton value={url}>{({ copied, copy }) => …}</CopyButton>
 * `copied` resets after `timeout` ms.
 * ------------------------------------------------------------------ */
export function CopyButton({ value, timeout = 1500, children }) {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef(null);

  const copy = React.useCallback(() => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), timeout);
    }).catch(() => {});
  }, [value, timeout]);

  React.useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return children({ copied, copy });
}
