// lowerthird-mount.js — the re-themable SVG lower-third element.
//
// A DIRECT element (its own OBS source). The producer authors the band on the
// Production page (Break phase); this mount renders it. The visual is a THEME
// SVG with named data slots — the mount binds live data into the slots and
// recolours via CSS vars, so a streamer can drop their own SVG into
// /layout/lowerthird/themes/<name>.svg without touching code.
//
//   const lt = mountLowerThird({ host });
//   lt.update(OverlayBase.state, OverlayBase.settings);
//   lt.replay();    // re-run the reveal (e.g. OBS source made active)
//   lt.dispose();
//
// SLOT CONTRACT (elements carrying a data-slot attribute; missing = skipped):
//   logo, logo-default, status, side1-name, side2-name, side1-sprite,
//   side2-sprite, side1-score, side2-score, title, subtitle, clock-label, clock.
// Text slots may carry data-maxw="<svg-units>" to auto-fit (shrink) long values.
//
// Requires overlay-base.js (OverlayBase) + rio-data.js (RioData, for sprites).
// This file is the reusable SVG-element engine; future SVG elements (stat cards,
// scoreboards) can reuse loadThemeSvg + bindText/auto-fit + the colour seam.

const SETTINGS_TYPE = 'lowerthird';
const THEMES_BASE = '/layout/lowerthird/themes';
const DEFAULT_THEME = 'rio';

// Controller-port → colour (0-indexed), used to tint each side. Overridable per
// port via overlays.lowerthird.port{N}Color. Falls back to the token side colours
// when a match has no port.
const PORT_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];

// Minimal inline fallback if a theme SVG can't be fetched (offline / typo).
const FALLBACK_SVG = `
<svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
  <rect x="48" y="860" width="1824" height="160" rx="16" style="fill:var(--band)"/>
  <rect x="48" y="860" width="10" height="160" style="fill:var(--accent)"/>
  <text data-slot="side1-name" data-maxw="600" x="96" y="912" style="fill:var(--ink);font-family:var(--font-display)" font-size="34" font-weight="700">Player One</text>
  <text data-slot="side2-name" data-maxw="600" x="96" y="976" style="fill:var(--ink);font-family:var(--font-display)" font-size="34" font-weight="700">Player Two</text>
  <text data-slot="title" data-maxw="600" x="900" y="930" style="fill:var(--ink);font-family:var(--font-display)" font-size="46" font-weight="700">Title</text>
  <text data-slot="clock" x="1844" y="952" text-anchor="end" style="fill:var(--clock-ink,var(--ink));font-family:var(--font-mono)" font-size="72" font-weight="700">5:00</text>
</svg>`;

const CSS = `
.lt-host { position: fixed; inset: 0; }
.lt-host svg { width: 100%; height: 100%; display: block; }
.lt-host.lt-reveal { animation: lt-rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both; }
@keyframes lt-rise { from { opacity: 0; transform: translateY(36px); } to { opacity: 1; transform: translateY(0); } }
.lt-host.lt-warn [data-slot="clock"] { animation: lt-pulse 1s ease-in-out infinite; }
@keyframes lt-pulse { 50% { opacity: 0.4; } }
@media (prefers-reduced-motion: reduce) { .lt-host.lt-reveal { animation: none; } .lt-host.lt-warn [data-slot="clock"] { animation: none; } }
`;

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.id = 'lowerthird-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }

function fmtDur(ms) {
  let s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function fmtTimeOfDay(d) {
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${ap}`;
}

export function mountLowerThird({ host }) {
  injectCss();
  host.classList.add('lt-host');

  let themeName = null;          // currently injected theme
  let slots = {};                // data-slot -> element (rebuilt on theme swap)
  let refitList = [];            // text slots with data-maxw to auto-fit
  let revealKey = '';            // identity of last reveal (avoid replay on clock ticks)
  let themeCache = {};           // name -> svg text
  let clockTimer = null;
  let disposed = false;

  // ── theme load / inject ───────────────────────────────────────────────────
  async function loadThemeSvg(name) {
    if (themeCache[name] != null) return themeCache[name];
    try {
      const r = await fetch(`${OverlayBase.BASE_URL}${THEMES_BASE}/${encodeURIComponent(name)}.svg`);
      const svg = r.ok ? await r.text() : FALLBACK_SVG;
      themeCache[name] = svg;
      return svg;
    } catch {
      themeCache[name] = FALLBACK_SVG;
      return FALLBACK_SVG;
    }
  }

  async function ensureTheme(name) {
    if (name === themeName) return;
    const svg = await loadThemeSvg(name);
    host.innerHTML = svg;
    const el = host.querySelector('svg');
    if (el) { el.removeAttribute('width'); el.removeAttribute('height'); }
    slots = {};
    refitList = [];
    host.querySelectorAll('[data-slot]').forEach((node) => {
      slots[node.getAttribute('data-slot')] = node;
      if (node.tagName.toLowerCase() === 'text' && node.getAttribute('data-maxw')) refitList.push(node);
    });
    themeName = name;
    revealKey = ''; // force a reveal after a theme change
  }

  // ── slot binding ──────────────────────────────────────────────────────────
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

  // Auto-fit: squeeze a text slot to its data-maxw with spacingAndGlyphs so long
  // names/titles never overflow. Runs after fonts are ready (measurement needs
  // the real metrics).
  function refitText() {
    for (const el of refitList) {
      el.removeAttribute('textLength');
      el.removeAttribute('lengthAdjust');
      const maxw = parseFloat(el.getAttribute('data-maxw'));
      if (!maxw || !el.textContent) continue;
      let len = 0;
      try { len = el.getComputedTextLength(); } catch { len = 0; }
      if (len > maxw) {
        el.setAttribute('textLength', String(maxw));
        el.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      }
    }
  }

  // ── colour seam (the only runtime-overridden vars) ────────────────────────
  function portColor(port, settings) {
    const idx = Number.isInteger(port) ? port : -1;
    if (idx >= 0) {
      const ov = OverlayBase.deepGet(settings, `overlays.${SETTINGS_TYPE}.port${idx}Color`, null);
      if (ov) return ov;
      if (idx < PORT_COLORS.length) return PORT_COLORS[idx];
    }
    return null;
  }

  function applyColours(settings, side1Port, side2Port) {
    // Per-layout accent pin only (the "+ Add style override" UI writes here).
    // We deliberately do NOT fall back to overlays.global.accentColor so the
    // default stays the Rio brand red from tokens.css, not the global amber.
    const accent = OverlayBase.deepGet(settings, `overlays.${SETTINGS_TYPE}.accentColor`, null);
    if (accent) host.style.setProperty('--accent', accent);
    else host.style.removeProperty('--accent');

    const c1 = portColor(side1Port, settings);
    const c2 = portColor(side2Port, settings);
    if (c1) host.style.setProperty('--side1', c1); else host.style.removeProperty('--side1');
    if (c2) host.style.setProperty('--side2', c2); else host.style.removeProperty('--side2');
  }

  // ── data resolution ───────────────────────────────────────────────────────
  function resolveSide(state, match, lt, T) {
    const g = OverlayBase.deepGet;
    const ov = g(lt, `override.side${T}`, '');
    const name = ov || (match ? g(match, `player.${T}.rioName`, '') : '');
    const captain = match ? g(match, `player.${T}.captain`, '') : '';
    const port = match ? g(match, `player.${T}.port`, null) : null;
    const score = g(lt, `score.${T}`, '');
    return { name, captain, port: Number.isInteger(port) ? port : null, score };
  }

  function spriteUrl(captain) {
    if (!captain) return '';
    // Captain headshot from the character-icon pack (same as rosters/stats).
    return (window.RioData && RioData.charIconUrl) ? RioData.charIconUrl(captain)
      : `${OverlayBase.BASE_URL}/game_assets/msb/characterIcons/${encodeURIComponent(captain)}.png`;
  }

  // ── clock ─────────────────────────────────────────────────────────────────
  function renderClock() {
    if (disposed) return;
    const g = OverlayBase.deepGet;
    const c = g(OverlayBase.state, 'lowerthird.clock', {}) || {};
    const mode = c.mode || 'off';
    const labelEl = slots['clock-label'];
    const clockEl = slots['clock'];
    if (!clockEl) return;

    if (mode === 'off') {
      clockEl.setAttribute('opacity', '0');
      if (labelEl) labelEl.setAttribute('opacity', '0');
      host.classList.remove('lt-warn');
      return;
    }
    clockEl.setAttribute('opacity', '1');

    let text = '', warn = false, label = c.label || '';
    if (mode === 'clock') {
      text = fmtTimeOfDay(new Date());
    } else if (mode === 'countdown') {
      const ms = c.running
        ? (c.endsAt || 0) - Date.now()
        : (c.remainingMs != null ? c.remainingMs : (c.durationSec || 300) * 1000);
      text = fmtDur(ms);
      warn = c.running && ms > 0 && ms < 10000;
    } else if (mode === 'countup') {
      const ms = c.running ? Date.now() - (c.startedAt || Date.now()) : (c.elapsedMs || 0);
      text = fmtDur(ms);
    }
    if (clockEl.textContent !== text) clockEl.textContent = text;
    if (labelEl) {
      labelEl.textContent = label;
      labelEl.setAttribute('opacity', label ? '1' : '0');
    }
    host.classList.toggle('lt-warn', warn);
  }

  // ── reveal ────────────────────────────────────────────────────────────────
  function playReveal() {
    host.classList.remove('lt-reveal');
    void host.offsetWidth; // reflow so the animation restarts
    host.classList.add('lt-reveal');
  }

  // ── main update ───────────────────────────────────────────────────────────
  async function update(state, settings) {
    const g = OverlayBase.deepGet;
    const lt = g(state, 'lowerthird', {}) || {};
    const theme = g(settings, `overlays.${SETTINGS_TYPE}.theme`, null) || lt.theme || DEFAULT_THEME;
    await ensureTheme(theme);
    if (disposed) return;

    const matchId = lt.matchId != null ? String(lt.matchId) : '';
    const match = matchId ? g(state, `match.${matchId}`, null) : null;
    const role = lt.role === 'current' ? 'current' : 'upnext';

    const s1 = resolveSide(state, match, lt, 1);
    const s2 = resolveSide(state, match, lt, 2);
    const title = lt.title || '';
    const subtitle = lt.subtitle || '';
    const status = g(lt, 'override.status', '') || (role === 'current' ? 'CURRENT' : 'UP NEXT');
    const clockMode = g(lt, 'clock.mode', 'off');

    // Nothing authored → keep the source blank on air.
    const hasContent = s1.name || s2.name || title || clockMode !== 'off';
    host.style.display = hasContent ? '' : 'none';
    if (!hasContent) { revealKey = ''; return; }

    applyColours(settings, s1.port, s2.port);

    setText('status', status);
    setText('side1-name', s1.name || 'Player One');
    setText('side2-name', s2.name || 'Player Two');
    setText('side1-score', s1.score, { optional: true });
    setText('side2-score', s2.score, { optional: true });
    setImage('side1-sprite', spriteUrl(s1.captain));
    setImage('side2-sprite', spriteUrl(s2.captain));
    setText('title', title, { optional: true });
    setText('subtitle', subtitle, { optional: true });

    // Logo: tournament branding if present, else the theme's default mark.
    const logoUrl = OverlayBase.brandingLogoUrl();
    if (slots['logo']) {
      const img = new Image();
      img.onload = () => { if (!disposed) { setImage('logo', logoUrl); if (slots['logo-default']) slots['logo-default'].setAttribute('opacity', '0'); } };
      img.onerror = () => { if (!disposed) { setImage('logo', ''); if (slots['logo-default']) slots['logo-default'].setAttribute('opacity', '1'); } };
      img.src = logoUrl;
    }

    renderClock();

    // Auto-fit now and again once webfonts settle.
    refitText();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!disposed) refitText(); });

    // Reveal only when the identity changes (not on every clock tick / pause).
    const key = `${theme}|${matchId}|${s1.name}|${s2.name}|${title}|${subtitle}|${role}`;
    if (key !== revealKey) { revealKey = key; playReveal(); }
  }

  function replay() {
    if (host.style.display !== 'none' && revealKey) playReveal();
  }

  function dispose() {
    disposed = true;
    if (clockTimer) clearInterval(clockTimer);
    window.removeEventListener('resize', refitText);
    host.classList.remove('lt-host', 'lt-reveal', 'lt-warn');
    host.innerHTML = '';
  }

  // Clock ticks independently of state updates so the countdown is smooth.
  clockTimer = setInterval(renderClock, 250);
  window.addEventListener('resize', refitText);

  return { update, replay, dispose };
}
