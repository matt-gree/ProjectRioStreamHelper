# Vendored three.js (offline)

Vendored locally so OBS browser-source overlays (e.g. the RioVisualizer hit
overlay) run without a network connection — PRSH ships fully offline.

- **Version:** three.js `0.169.0`
- **Source:** https://cdn.jsdelivr.net/npm/three@0.169.0/
  - `three.module.js`           ← `build/three.module.js`
  - `addons/controls/OrbitControls.js`     ← `examples/jsm/controls/OrbitControls.js`
  - `addons/renderers/CSS2DRenderer.js`    ← `examples/jsm/renderers/CSS2DRenderer.js`

The addons import three via the bare `'three'` specifier, so consumers must
declare an importmap, e.g.:

```html
<script type="importmap">
{ "imports": {
    "three": "/layout/lib/three/three.module.js",
    "three/addons/": "/layout/lib/three/addons/"
} }
</script>
```

## Updating

To bump the version, re-download the three files from jsDelivr at the new
version and update this note. Keep the addon set in sync with what the
overlay/renderer actually imports.
