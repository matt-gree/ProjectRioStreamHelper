import * as React from "react";
import { Combobox } from "./combobox";

// Bundled/Google-Fonts options always offered, regardless of what the OS reports.
const BUNDLED_FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Montserrat', 'Poppins', 'Lato', 'Oswald', 'Rajdhani', 'Bebas Neue', 'Lalezar',
];

/*
 * THE LIST A PICKER SHOWS: the pinned faces first, then everything else A-Z.
 *
 * `pinned` is `[{ value, detail, role }]` — the app's default face for each
 * type role, passed in by the caller (the UI kit does not import app
 * constants). They lead because they are the answer to "put it back": a
 * producer who tried a font and wants the shipped look again should not have
 * to remember that the numerals were Chivo Mono and scroll a few hundred
 * system fonts to find it. `role` puts THIS picker's own default at the very
 * top; each pinned face is listed once, never again under All fonts.
 */
export function fontOptions({ pinned = [], systemFonts = [], value, role } = {}) {
  const lead = [...pinned].sort((a, b) => (b.role === role) - (a.role === role));
  const pinnedNames = new Set(lead.map((p) => p.value));
  const rest = new Set(BUNDLED_FONTS);
  (systemFonts ?? []).forEach((f) => rest.add(f));
  if (value) rest.add(value);
  const others = Array.from(rest).filter((f) => !pinnedNames.has(f)).sort((a, b) => a.localeCompare(b));
  if (!lead.length) return others;
  return [
    ...lead.map((p) => ({ value: p.value, label: p.value, detail: p.detail, group: "Defaults" })),
    ...others.map((f) => ({ value: f, label: f, group: "All fonts" })),
  ];
}

/* ------------------------------------------------------------------ *
 * FontCombobox — font-family picker that populates itself from the
 * fonts actually installed on the machine, via the Local Font Access
 * API (`window.queryLocalFonts()`). Chromium-only (103+), secure
 * context, and gated behind a user gesture + one-time permission
 * prompt — so the query fires on the dropdown's own open click, not
 * on mount. Falls back to bundled web fonts + free-text entry
 * (`creatable`) everywhere else (Safari/Firefox, denied permission,
 * or OBS's embedded browser).
 * ------------------------------------------------------------------ */
export function FontCombobox({ value, onChange, pinned, role, ...props }) {
  const [systemFonts, setSystemFonts] = React.useState(null);
  const [status, setStatus] = React.useState("idle"); // idle | loading | loaded | unsupported | denied | error
  const attempted = React.useRef(false);

  const loadSystemFonts = React.useCallback(async () => {
    if (attempted.current) return;
    attempted.current = true;
    if (typeof window === "undefined" || !("queryLocalFonts" in window)) {
      setStatus("unsupported");
      return;
    }
    setStatus("loading");
    try {
      const fonts = await window.queryLocalFonts();
      const families = Array.from(new Set(fonts.map((f) => f.family))).sort((a, b) => a.localeCompare(b));
      setSystemFonts(families);
      setStatus("loaded");
    } catch (err) {
      console.warn("[FontCombobox] queryLocalFonts() failed:", err);
      setStatus(err?.name === "NotAllowedError" ? "denied" : "error");
    }
  }, []);

  const data = React.useMemo(
    () => fontOptions({ pinned, systemFonts, value, role }),
    [pinned, systemFonts, value, role],
  );

  return (
    <div className="flex flex-col gap-1">
      <Combobox
        value={value}
        onChange={onChange}
        data={data}
        creatable
        detailOnTrigger={false}
        searchPlaceholder={status === "loading" ? "Loading system fonts…" : "Search or type a font name…"}
        onOpen={loadSystemFonts}
        {...props}
      />
      {status === "denied" && (
        <p className="text-xs text-muted-foreground">
          Font access was declined — bundled fonts are still listed, and you can type any font name.
        </p>
      )}
      {status === "unsupported" && (
        <p className="text-xs text-muted-foreground">
          This browser can't list installed fonts — type any font name and it'll be used as-is.
        </p>
      )}
      {status === "error" && (
        <p className="text-xs text-muted-foreground">
          Couldn't read system fonts — bundled fonts are still listed, and you can type any font name.
        </p>
      )}
    </div>
  );
}
