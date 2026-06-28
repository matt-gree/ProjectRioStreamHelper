# Stat Callout — backdrop themes

The post-game **Stat Callout** element (full-screen, port-coloured box-score
reveal) draws its backdrop from a theme. A theme is a single SVG file in this
folder. Select one by setting `overlays.postgamecallout.theme` to the file's
name (without `.svg`); `default` is the built-in backdrop baked into the element.

## Contract

Author the SVG at the broadcast canvas, `viewBox="0 0 1920 1080"`, and let it
**recolor to the live player** by using these inherited CSS custom properties
instead of hard-coded colors:

| Variable        | Meaning                                              |
|-----------------|------------------------------------------------------|
| `--port-color`  | The featured player's controller-port accent (1–4).  |
| `--port-2`      | A complementary port colour (secondary wash).        |
| `--accent`      | The global design accent (`overlays.global.accentColor`). |

Example usage inside the SVG — **use inline `style`**, since `var()` does not
resolve in SVG presentation attributes (`fill="var(...)"` will not recolor):

```xml
<rect width="1920" height="1080" style="fill:var(--port-color)" opacity="0.12"/>
<polygon points="0,1080 760,0 1060,0 300,1080" style="fill:var(--accent)" opacity="0.3"/>
<stop offset="0" style="stop-color:var(--port-2);stop-opacity:0.4"/>
```

The element injects your SVG full-bleed behind the character art and content,
clipped by the reveal wipe, so keep important shapes away from the extreme edges.
`aurora.svg` here is a working reference you can copy.

## Adding one

1. Drop `my-theme.svg` in this folder (use the variables above).
2. Set `overlays.postgamecallout.theme` to `my-theme`.
3. Hard-refresh the OBS browser source (Cmd/Ctrl+Shift+R).
