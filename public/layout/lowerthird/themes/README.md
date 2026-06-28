# Lower Third — re-themable SVG themes

The **Lower Third** element renders a swappable **theme SVG** from this folder.
A theme is one self-contained SVG; the mount binds live data into named slots
and recolours a few CSS variables. Select one by setting
`overlays.lowerthird.theme` to the file name (without `.svg`). `rio` is the
built-in Project Rio look; `chalk` is a second reference theme.

Authoring is the same SVG-element pattern used across Project Rio overlays, so
the same approach works for future SVG elements (stat cards, scoreboards).

## Authoring

Author at the broadcast canvas, `viewBox="0 0 1920 1080"`, with
`preserveAspectRatio="xMidYMax meet"` so the band anchors to the bottom and
scales to any OBS source size. Draw your band wherever you like inside it.

### Data slots

Give an element a `data-slot="<name>"` attribute and the mount fills it. Any slot
you omit is simply skipped, so a minimal theme can use just a few.

| Slot | Element | Filled with |
|------|---------|-------------|
| `logo` | `<image>` | Tournament logo (`/branding/`). Hidden if none is uploaded. |
| `logo-default` | `<g>`/any | Your fallback brand mark — shown only when no logo is set. |
| `status` | `<text>` | `CURRENT` / `UP NEXT` (or the producer's manual status). |
| `side1-name` / `side2-name` | `<text>` | The two player names. |
| `side1-sprite` / `side2-sprite` | `<image>` | Captain headshot. Hidden if none. |
| `side1-score` / `side2-score` | `<text>` | Optional score; hidden when empty. |
| `title` | `<text>` | Free title text. |
| `subtitle` | `<text>` | Free subtitle text. |
| `clock-label` | `<text>` | e.g. `BACK IN` (hidden when empty). |
| `clock` | `<text>` | Countdown / count-up / time-of-day (tabular). |

**Auto-fit:** add `data-maxw="<svg-units>"` to a `<text>` slot and long values are
squeezed to that width (`lengthAdjust="spacingAndGlyphs"`) instead of overflowing.

### Colour variables

Paint with these so the band recolours to the live broadcast. **`var()` only
resolves through inline `style=""` in SVG** — never through `fill="var(...)"`
presentation attributes.

| Variable | Meaning | Overridden at runtime by |
|----------|---------|--------------------------|
| `--accent` | Brand accent (Rio red) | `overlays.lowerthird.accentColor` |
| `--side1` / `--side2` | Each player's controller-port colour | `overlays.lowerthird.port{0..3}Color` |
| `--gold` | Star gold | — |
| `--band` / `--band-2` | Surface fills | — |
| `--ink` / `--ink-dim` | Text | — |
| `--border` | Hairline borders | — |
| `--font-display` / `--font-body` / `--font-mono` | Type roles | — |

Example:

```xml
<rect x="48" y="792" width="1824" height="232" rx="18" style="fill:var(--band)"/>
<text data-slot="side1-name" data-maxw="380"
      style="fill:var(--ink);font-family:var(--font-display)" font-size="34">Player</text>
```

## Adding a theme

1. Copy `rio.svg`, rename it (e.g. `my-theme.svg`), and restyle it — keep the
   `data-slot` names you want filled.
2. Set `overlays.lowerthird.theme` to `my-theme`.
3. Hard-refresh the OBS browser source (Cmd/Ctrl+Shift+R).
