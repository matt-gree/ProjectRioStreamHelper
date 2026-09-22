import * as React from "react";

import { notifications } from "../../lib/notify";

/* ------------------------------------------------------------------ *
 * CopyButton — Mantine-shaped render-prop copy helper.
 *
 * Usage: <CopyButton value={url}>{({ copied, copy }) => …}</CopyButton>
 * `copied` resets after `timeout` ms.
 *
 * navigator.clipboard IS NOT ALWAYS THERE, and the one surface that needs
 * this most is the one that doesn't have it: the console's Copy URL exists for
 * a producer whose OBS is on ANOTHER MACHINE, who therefore reaches PRSH over
 * the LAN (server.allow_lan) at http://<host>:5260 — a non-secure context,
 * where the async Clipboard API is simply absent. `navigator.clipboard?.write`
 * then short-circuits to undefined and the `.then()` threw inside the click
 * handler, so the button neither copied nor said anything: the same silent
 * nothing as a failed write.
 *
 * So: the async API where it exists, the execCommand textarea where it doesn't
 * (it predates secure contexts and still works on plain HTTP), and a RED
 * NOTIFICATION when neither lands. A copy that fails must say so — a producer
 * mid-build otherwise pastes whatever was in the clipboard before.
 * ------------------------------------------------------------------ */

/* The pre-Clipboard-API copy: a selected off-screen textarea + execCommand.
 * Deprecated, still universally implemented, and the only thing that works in a
 * non-secure context. Returns whether the copy actually took. */
function execCommandCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  // Off-screen but still selectable — display:none or visibility:hidden would
  // make the selection (and therefore the copy) a no-op.
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
  document.body.appendChild(ta);
  try {
    ta.select();
    ta.setSelectionRange(0, ta.value.length);   // iOS/Safari ignore select() alone
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}

export async function copyText(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Present but refused — an unfocused document, a permissions policy. Fall
    // through rather than reporting failure while a path that works remains.
  }
  return execCommandCopy(text);
}

export function CopyButton({ value, timeout = 1500, children }) {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef(null);

  const copy = React.useCallback(async () => {
    const ok = await copyText(value);
    if (!ok) {
      notifications.show({
        message: "Couldn’t reach the clipboard — select the URL and copy it by hand.",
        color: "red",
      });
      return;
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), timeout);
  }, [value, timeout]);

  React.useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return children({ copied, copy });
}
