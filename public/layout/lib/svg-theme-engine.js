// svg-theme-engine.js — the reusable, element-agnostic half of the re-themable
// SVG element pattern (first built for the Lower Third, Phase 7).
//
// Themes are grouped into DESIGN PACKAGES (see public/design/README.md): a
// package is a folder of per-element theme SVGs served at
// /design/{package}/{element}.svg — built-in packages ship in public/design/,
// user-installed ones live in user_data/design_packages/. This engine fetches
// and caches the current package's SVG for ONE element, injects it into
// `host`, rebuilds the slot map, and exposes slot-binding + auto-fit-text
// helpers. Everything element-specific (clock engines, colour seams, reveal
// animations, data resolution) stays in the caller's own mount module.
//
// A theme is one self-contained SVG with named `data-slot` attributes. If a
// package doesn't theme this element, the engine falls back to the `default`
// package's file, then to the caller's inline fallback — a partial package
// (e.g. one that only restyles the Commentary strip) is fully supported.
//
//   const engine = createThemeEngine({ host, element: 'lowerthird', fallbackSvg });
//   const changed = await engine.ensureTheme('slice26');  // package id; true on an actual swap
//   engine.setText('side1-name', 'Player One');
//   engine.setImage('logo', url);
//   engine.refitText();
//   engine.usesAppVars        // theme opted into the Design-tab CSS vars
//   engine.slots['clock']     // raw element access for anything beyond text/image

export function createThemeEngine({ host, element, fallbackSvg }) {
  let themeName = null;          // currently injected package id
  let slots = {};                // data-slot -> element (rebuilt on theme swap)
  let refitList = [];            // text slots with data-maxw to auto-fit
  let themeCache = {};           // package id -> svg text
  let usesAppVars = false;       // root <svg data-design-vars="app"> present

  async function fetchSvg(pkg) {
    const r = await fetch(`${OverlayBase.BASE_URL}/design/${encodeURIComponent(pkg)}/${encodeURIComponent(element)}.svg`);
    return r.ok ? await r.text() : null;
  }

  async function loadThemeSvg(pkg) {
    if (themeCache[pkg] != null) return themeCache[pkg];
    let svg = null;
    try {
      svg = await fetchSvg(pkg);
      // Element-by-element fallback: a package may theme only some elements.
      if (svg == null && pkg !== 'default') svg = await fetchSvg('default');
    } catch { svg = null; }
    themeCache[pkg] = svg != null ? svg : fallbackSvg;
    return themeCache[pkg];
  }

  // Returns true only when a different theme was actually injected, so
  // callers can reset their own identity/diff state on a real swap (and skip
  // that reset on a same-theme no-op call).
  async function ensureTheme(name) {
    if (name === themeName) return false;
    const svg = await loadThemeSvg(name);
    host.innerHTML = svg;
    const el = host.querySelector('svg');
    if (el) { el.removeAttribute('width'); el.removeAttribute('height'); }
    // Palette policy: a theme declares data-design-vars="app" on its root <svg>
    // to be painted with the user's Design-tab CSS variables (the mount then
    // runs OverlayBase.applyDesignSettings); without it the theme brings its
    // own fixed palette and the mount clears those vars instead.
    usesAppVars = !!(el && el.getAttribute('data-design-vars') === 'app');
    slots = {};
    refitList = [];
    host.querySelectorAll('[data-slot]').forEach((node) => {
      slots[node.getAttribute('data-slot')] = node;
      if (node.tagName.toLowerCase() === 'text' && node.getAttribute('data-maxw')) refitList.push(node);
    });
    themeName = name;
    return true;
  }

  function setText(slotName, value, { optional = false } = {}) {
    const el = slots[slotName];
    if (!el) return;
    const v = value == null ? '' : String(value);
    el.textContent = v;
    if (optional) el.setAttribute('opacity', v ? '1' : '0');
    else el.removeAttribute('opacity');
  }

  function setImage(slotName, url) {
    const el = slots[slotName];
    if (!el) return false;
    if (url) {
      el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', url);
      el.setAttribute('href', url);
      el.setAttribute('opacity', '1');
      return true;
    }
    el.removeAttribute('href');
    el.setAttribute('opacity', '0');
    return false;
  }

  // Auto-fit: shrink a text slot UNIFORMLY (font-size, in x and y together) so a
  // long value scales down proportionally instead of being squashed horizontally.
  // The authored size is captured once in data-basefs so the text can grow back
  // to full size when it later gets short again. Safe to call before fonts are
  // ready; callers typically also re-run this once document.fonts.ready resolves.
  function refitText() {
    for (const el of refitList) {
      // Drop any legacy horizontal-squash attributes if a theme still carries them.
      el.removeAttribute('textLength');
      el.removeAttribute('lengthAdjust');
      let base = parseFloat(el.getAttribute('data-basefs'));
      if (!base) {
        base = parseFloat(el.getAttribute('font-size')) || parseFloat(getComputedStyle(el).fontSize) || 0;
        if (base) el.setAttribute('data-basefs', String(base));
      }
      if (!base) continue;
      el.style.fontSize = base + 'px';   // reset to full size before measuring
      const maxw = parseFloat(el.getAttribute('data-maxw'));
      if (!maxw || !el.textContent) continue;
      let len = 0;
      try { len = el.getComputedTextLength(); } catch { len = 0; }
      if (len > maxw) el.style.fontSize = (base * maxw / len) + 'px';
    }
  }

  return {
    ensureTheme,
    setText,
    setImage,
    refitText,
    get slots() { return slots; },
    get usesAppVars() { return usesAppVars; },
  };
}
