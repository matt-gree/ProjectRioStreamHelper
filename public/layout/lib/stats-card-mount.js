// stats-card-mount.js — the re-themable per-team Stats bar (?team=1|2).
//
// The scoreboard-bound stats element: shows the character currently batting /
// pitching for one side, with their headline stats and (HUD games) the
// current-game line. The look lives in the active DESIGN PACKAGE's theme SVG
// (/design/{package}/stats.svg, element-by-element fallback to `default`).
// Data resolution stays in RioData.getStatsLine — this mount only binds.
//
// DATA SLOTS (all optional):
//   card-bg(rect)      may declare data-h-full / data-h-compact — the mount
//                      swaps its height when the bottom line row is empty
//   content(g)         fade target for batter-change transitions
//   char-icon(image)   the active character
//   stat-{i}-value / stat-{i}-label (text, i = 0..5; RioData emits 4 today)
//   line-group(g)      bottom row wrapper (divider + texts), hidden when empty
//   line-label(text)   "Game" / "Season Stats" prefix (empty when no prefix)
//   line-text(text,maxw) the game line itself
//
// Settings: overlays.stats.transitionType ('fade' | 'none') gates the batter-
// change dissolve; stat-value changes flash through var(--stat-flash) (falls
// back to the accent). statValueColor / subtextColor keep working on app-vars
// themes (classic) via --stat-value-color / --stat-subtext-color.
//
//   const m = mountStatsCard({ host, sb, team });
//   m.update(OverlayBase.state, OverlayBase.settings);
//   m.dispose();
//
// Requires overlay-base.js (OverlayBase) + rio-data.js (RioData).

import { createThemeEngine } from './svg-theme-engine.js';

const ELEMENT = 'stats';
const SETTINGS_TYPE = 'stats';
const DEFAULT_PACKAGE = 'default';
const MAX_STATS = 6;

const FALLBACK_SVG = `
<svg viewBox="0 0 325 120" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <rect data-slot="card-bg" x="2" y="2" width="321" height="76" rx="10" data-h-full="112" data-h-compact="76" style="fill:var(--band,#0b0b12);stroke:var(--border,#1f1f30)"/>
  <g data-slot="content">
    <image data-slot="char-icon" x="12" y="16" width="44" height="44" preserveAspectRatio="xMidYMid meet" style="image-rendering:pixelated" opacity="0"/>
    <text data-slot="stat-0-value" x="80" y="42" style="fill:var(--ink,#f5f5f8);font-family:var(--font-mono,monospace)" font-size="20" font-weight="700">0</text>
    <text data-slot="stat-0-label" x="80" y="62" style="fill:var(--ink-dim,#8f8fa3);font-family:var(--font-body,sans-serif)" font-size="11">-</text>
    <text data-slot="stat-1-value" x="145" y="42" style="fill:var(--ink,#f5f5f8);font-family:var(--font-mono,monospace)" font-size="20" font-weight="700">0</text>
    <text data-slot="stat-1-label" x="145" y="62" style="fill:var(--ink-dim,#8f8fa3);font-family:var(--font-body,sans-serif)" font-size="11">-</text>
    <text data-slot="stat-2-value" x="210" y="42" style="fill:var(--ink,#f5f5f8);font-family:var(--font-mono,monospace)" font-size="20" font-weight="700">0</text>
    <text data-slot="stat-2-label" x="210" y="62" style="fill:var(--ink-dim,#8f8fa3);font-family:var(--font-body,sans-serif)" font-size="11">-</text>
    <text data-slot="stat-3-value" x="275" y="42" style="fill:var(--ink,#f5f5f8);font-family:var(--font-mono,monospace)" font-size="20" font-weight="700">0</text>
    <text data-slot="stat-3-label" x="275" y="62" style="fill:var(--ink-dim,#8f8fa3);font-family:var(--font-body,sans-serif)" font-size="11">-</text>
    <g data-slot="line-group">
      <text data-slot="line-label" x="16" y="100" style="fill:var(--ink-dim,#8f8fa3);font-family:var(--font-body,sans-serif)" font-size="13" font-weight="600"></text>
      <text data-slot="line-text" data-maxw="240" x="76" y="100" style="fill:var(--ink,#f5f5f8);font-family:var(--font-mono,monospace)" font-size="13"></text>
    </g>
  </g>
</svg>`;

const CSS = `
.st-host { position: fixed; inset: 0; }
.st-host svg { width: 100%; height: 100%; display: block; }
`;

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.id = 'stats-card-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

export function mountStatsCard({ host, sb, team }) {
  injectCss();
  host.classList.add('st-host');
  const SB = sb || 1;
  const TEAM = team === 2 ? 2 : 1;

  const engine = createThemeEngine({ host, element: ELEMENT, fallbackSvg: FALLBACK_SVG });

  let disposed = false;
  let prevCharKey = '';       // theme|charName — resets flash/fade baselines
  let prevValues = {};        // stat label -> last shown value (flash detection)
  let fadeTimer = null;

  const g = OverlayBase.deepGet;

  function useFade(settings) {
    return g(settings, `overlays.${SETTINGS_TYPE}.transitionType`, 'fade') === 'fade';
  }

  function flash(el) {
    if (!el) return;
    el.style.transition = 'fill 0s';
    el.style.fill = 'var(--stat-flash, var(--accent, #f59e0b))';
    void el.getBoundingClientRect();
    el.style.transition = 'fill 0.6s ease';
    el.style.fill = '';
  }

  function bind(info, { flashChanges }) {
    engine.setImage('char-icon', info.charIconUrl || '');

    for (let i = 0; i < MAX_STATS; i++) {
      const st = info.stats[i];
      const valEl = engine.slots[`stat-${i}-value`];
      engine.setText(`stat-${i}-value`, st ? st.value : '', { optional: true });
      engine.setText(`stat-${i}-label`, st ? st.label : '', { optional: true });
      if (st && flashChanges && valEl && prevValues[st.label] !== undefined &&
          prevValues[st.label] !== String(st.value)) {
        flash(valEl);
      }
    }
    prevValues = {};
    for (const st of info.stats) prevValues[st.label] = String(st.value);

    // Bottom line: "Game: <line>" for HUD games, "Season Stats" otherwise.
    const hasLine = !!(info.gameLine || info.bottomLabel);
    const lineGroup = engine.slots['line-group'];
    if (lineGroup) lineGroup.setAttribute('opacity', hasLine ? '1' : '0');
    engine.setText('line-label', info.gameLine ? info.bottomLabel : '');
    engine.setText('line-text', info.gameLine || info.bottomLabel || '');

    const bg = engine.slots['card-bg'];
    if (bg) {
      const hFull = parseFloat(bg.getAttribute('data-h-full'));
      const hCompact = parseFloat(bg.getAttribute('data-h-compact'));
      if (hFull && hCompact) bg.setAttribute('height', hasLine ? hFull : hCompact);
    }

    engine.refitText();
  }

  async function update(state, settings) {
    const theme = g(settings, 'overlays.global.designPackage', null) || DEFAULT_PACKAGE;
    const themeChanged = await engine.ensureTheme(theme);
    if (themeChanged) { prevCharKey = ''; prevValues = {}; }
    if (disposed) return;

    // Expose the side on the root <svg> so a theme can vary paint per team
    // (e.g. a per-side card gradient) via `svg[data-team="1"] …` CSS.
    const rootSvg = host.querySelector('svg');
    if (rootSvg && rootSvg.getAttribute('data-team') !== String(TEAM)) {
      rootSvg.setAttribute('data-team', String(TEAM));
    }

    if (engine.usesAppVars) OverlayBase.applyDesignSettings(SETTINGS_TYPE);
    else OverlayBase.clearDesignSettings();

    const info = window.RioData ? RioData.getStatsLine(state, SB, TEAM) : null;
    host.style.display = info ? '' : 'none';
    if (!info) { prevCharKey = ''; prevValues = {}; return; }

    const charKey = `${theme}|${info.charName}`;
    const charChanged = charKey !== prevCharKey;
    const wasShowing = prevCharKey !== '';
    prevCharKey = charKey;

    const content = engine.slots['content'];
    if (charChanged && wasShowing && useFade(settings) && content) {
      // Dissolve: fade the content group out, rebind, fade back in.
      prevValues = {};
      if (fadeTimer) clearTimeout(fadeTimer);
      content.style.transition = 'opacity 0.2s ease';
      content.style.opacity = '0';
      fadeTimer = setTimeout(() => {
        if (disposed || content !== engine.slots['content']) return;
        bind(info, { flashChanges: false });
        content.style.transition = 'opacity 0.25s ease';
        content.style.opacity = '1';
      }, 200);
    } else {
      if (content) { content.style.transition = ''; content.style.opacity = '1'; }
      bind(info, { flashChanges: !charChanged && useFade(settings) });
    }

    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
      if (!disposed) engine.refitText();
    });
  }

  function dispose() {
    disposed = true;
    if (fadeTimer) clearTimeout(fadeTimer);
    host.classList.remove('st-host');
    host.innerHTML = '';
  }

  return { update, dispose };
}
