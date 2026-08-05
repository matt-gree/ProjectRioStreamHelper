// stats-card-mount.js — the re-themable per-team Stats bar (?team=1|2).
//
// The scoreboard-bound stats element: shows the character currently batting /
// pitching for one side, with their headline stats and (HUD games) the
// current-game line. The look lives in the active DESIGN PACKAGE's theme SVG
// (/design/{package}/stats.svg, element-by-element fallback to `default`).
// Data resolution stays in RioData.getStatsLine — this mount only binds.
//
// DATA SLOTS (all optional):
//   card-bg(rect)      the card, sized by its two OPTIONAL CAPTION BANDS. A band
//                      that isn't showing is dead space, so each one owns an
//                      edge: declare data-top-open / data-top-closed (card y with
//                      and without the header) and data-bot-open /
//                      data-bot-closed (bottom edge with and without the line),
//                      and the mount animates between them — 0.45s power3.out,
//                      the scorecard stack's easing. A theme with only a footer
//                      may declare data-h-full / data-h-compact instead (heights,
//                      fixed top edge); a theme declaring neither keeps its
//                      authored geometry.
//   content(g)         fade target for batter-change transitions
//   head-group(g)      header band wrapper, hidden unless the header is on
//   head-text(text,maxw) the header caption
//   char-icon(image)   the active character
//   stat-{i}-value / stat-{i}-label (text, i = 0..5; RioData emits 4 today)
//   line-group(g)      bottom row wrapper (divider + texts), hidden when empty
//   line-label(text)   "Game" / "Season Stats" prefix (empty when no prefix)
//   line-text(text,maxw) the game line itself
//
// Settings: overlays.{type}.transitionType ('fade' | 'none') gates the batter-
// change dissolve; subLine / subLineText choose the footer's content and
// topLine / topLineText the header's. Stat-value changes flash through
// var(--stat-flash) (falls back to the accent). statValueColor / subtextColor
// keep working on app-vars themes (classic) via --stat-value-color /
// --stat-subtext-color.
//
//   const m = mountStatsCard({ host, sb, team });
//   m.update(OverlayBase.state, OverlayBase.settings);
//   m.dispose();
//
// Requires overlay-base.js (OverlayBase) + rio-data.js (RioData).

import { createThemeEngine } from './svg-theme-engine.js';
import { ensureGsap } from './gsap-loader.js';

const ELEMENT = 'stats';
const DEFAULT_PACKAGE = 'default';
const MAX_STATS = 6;

const FALLBACK_SVG = `
<svg viewBox="0 0 452 118" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <rect data-slot="card-bg" x="2" y="2" width="448" height="114" rx="10" data-h-full="114" data-h-compact="76" style="fill:var(--band,#0b0b12);stroke:var(--border,#1f1f30)"/>
  <g data-slot="content">
    <image data-slot="char-icon" x="13" y="17" width="44" height="44" preserveAspectRatio="xMidYMid meet" style="image-rendering:pixelated" opacity="0"/>
    <text data-slot="stat-0-value" data-maxw="86" x="114" y="43" text-anchor="middle" style="fill:var(--ink,#f5f5f8);font-family:var(--font-mono,monospace)" font-size="24" font-weight="700">0</text>
    <text data-slot="stat-0-label" x="114" y="61" text-anchor="middle" style="fill:var(--ink-dim,#8f8fa3);font-family:var(--font-body,sans-serif)" font-size="12">-</text>
    <text data-slot="stat-1-value" data-maxw="86" x="209" y="43" text-anchor="middle" style="fill:var(--ink,#f5f5f8);font-family:var(--font-mono,monospace)" font-size="24" font-weight="700">0</text>
    <text data-slot="stat-1-label" x="209" y="61" text-anchor="middle" style="fill:var(--ink-dim,#8f8fa3);font-family:var(--font-body,sans-serif)" font-size="12">-</text>
    <text data-slot="stat-2-value" data-maxw="86" x="304" y="43" text-anchor="middle" style="fill:var(--ink,#f5f5f8);font-family:var(--font-mono,monospace)" font-size="24" font-weight="700">0</text>
    <text data-slot="stat-2-label" x="304" y="61" text-anchor="middle" style="fill:var(--ink-dim,#8f8fa3);font-family:var(--font-body,sans-serif)" font-size="12">-</text>
    <text data-slot="stat-3-value" data-maxw="86" x="399" y="43" text-anchor="middle" style="fill:var(--ink,#f5f5f8);font-family:var(--font-mono,monospace)" font-size="24" font-weight="700">0</text>
    <text data-slot="stat-3-label" x="399" y="61" text-anchor="middle" style="fill:var(--ink-dim,#8f8fa3);font-family:var(--font-body,sans-serif)" font-size="12">-</text>
    <g data-slot="line-group">
      <text data-slot="line-label" x="16" y="101" style="fill:var(--ink-dim,#8f8fa3);font-family:var(--font-body,sans-serif)" font-size="13" font-weight="600"></text>
      <text data-slot="line-text" data-maxw="330" x="226" y="101" text-anchor="middle" style="fill:var(--ink,#f5f5f8);font-family:var(--font-mono,monospace)" font-size="13"></text>
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

export function mountStatsCard({ host, sb, team, settingsType = 'stats',
                                 svgElement = ELEMENT, fallbackSvg = FALLBACK_SVG }) {
  injectCss();
  host.classList.add('st-host');
  const SB = sb || 1;
  const TEAM = team === 2 ? 2 : 1;
  // Which settings namespace this card reads (overlays.{SETTINGS_TYPE}.*). The
  // standalone Stats source uses 'stats' and the container MEMBER passes
  // 'statscard', so each card is configured independently.
  const SETTINGS_TYPE = settingsType || 'stats';

  // Which design-package SVG this card renders. The standalone Stats source uses
  // the wide 4-across 'stats' card; the Stat Card container member passes
  // 'statscard' for the compact 2x2 card, so the two are themed independently
  // even though they share this mount and the same RioData resolution.
  const engine = createThemeEngine({ host, element: svgElement, fallbackSvg });

  let disposed = false;
  let prevCharKey = '';       // theme|charName — resets flash/fade baselines
  let prevValues = {};        // stat label -> last shown value (flash detection)
  let fadeTimer = null;
  // Has the bottom row been placed once on THIS theme? Gates animate-vs-snap,
  // the same way the scorecard's `laidOut` does: a card must not slide open on
  // its first paint (or on a theme swap, which rebuilds every slot), only when
  // the producer changes something while it is on air.
  let lineLaidOut = false;

  let gsap = null;
  ensureGsap().then(lib => { if (!disposed) gsap = lib; });

  const g = OverlayBase.deepGet;

  function useFade(settings) {
    return g(settings, `overlays.${SETTINGS_TYPE}.transitionType`, 'fade') === 'fade';
  }

  // Resolve the bottom line from the producer's choice:
  //   'gameLine' (default) — the live HUD game line, or the Season Stats label
  //                          for API games (the original auto behavior)
  //   'custom'             — a fixed user string (hidden + compact when blank)
  //   'off'                — always hidden; card shrinks to data-h-compact
  function resolveLine(info, settings) {
    const mode = g(settings, `overlays.${SETTINGS_TYPE}.subLine`, 'gameLine');
    if (mode === 'off') return { show: false, label: '', text: '' };
    if (mode === 'custom') {
      const text = String(g(settings, `overlays.${SETTINGS_TYPE}.subLineText`, '') || '').trim();
      return { show: !!text, label: '', text };
    }
    const text = info.gameLine || info.bottomLabel || '';
    const label = info.gameLine ? info.bottomLabel : '';
    return { show: !!text, label, text };
  }

  /*
   * Resolve the HEADER caption — the card's other optional band, and the one
   * that says what the four numbers ARE while the footer says what just
   * happened:
   *   'off'    (default) — no header; the card's top edge stays closed
   *   'custom'           — a fixed user string
   *   'auto'             — the game mode plus " Stats" ("Stars On Showdown XXI
   *                        Stats"), which is the stat set these values come from
   *
   * Auto hides itself when the mode is unknown rather than printing a bare
   * "Stats" — a board with no game loaded has no stat set to name.
   */
  function resolveHead(info, settings) {
    const mode = g(settings, `overlays.${SETTINGS_TYPE}.topLine`, 'off');
    if (mode === 'custom') {
      const text = String(g(settings, `overlays.${SETTINGS_TYPE}.topLineText`, '') || '').trim();
      return { show: !!text, text };
    }
    if (mode === 'auto') {
      const name = String(info.gameMode || '').trim();
      return { show: !!name, text: name ? `${name} Stats` : '' };
    }
    return { show: false, text: '' };
  }

  function flash(el) {
    if (!el) return;
    el.style.transition = 'fill 0s';
    el.style.fill = 'var(--stat-flash, var(--accent, #f59e0b))';
    void el.getBoundingClientRect();
    el.style.transition = 'fill 0.6s ease';
    el.style.fill = '';
  }

  // Where the card's two edges sit for a given pair of caption states.
  //
  // The card is not a fixed box with rows switched off inside it: a band that
  // isn't showing is dead space, so the card ends where its content does. Each
  // caption owns ONE EDGE — the header the top, the line the bottom — which is
  // what lets four on/off combinations come out of one pair of authored
  // positions instead of four authored layouts.
  //
  //   data-top-open / data-top-closed    card y with and without the header
  //   data-bot-open / data-bot-closed    card bottom edge with and without the line
  //
  // A theme that predates the header declares only `data-h-full` /
  // `data-h-compact` (heights, fixed top edge); that path still works and is
  // how slice26's card keeps behaving exactly as it did. A theme that declares
  // neither keeps its authored geometry — the mount can't invent where a card's
  // content stops.
  function cardEdges(bg, showHead, showLine) {
    if (!bg) return null;
    const num = (name) => parseFloat(bg.getAttribute(name));
    const topOpen = num('data-top-open'), topClosed = num('data-top-closed');
    const botOpen = num('data-bot-open'), botClosed = num('data-bot-closed');
    if (Number.isFinite(topOpen) && Number.isFinite(topClosed) &&
        Number.isFinite(botOpen) && Number.isFinite(botClosed)) {
      const y = showHead ? topOpen : topClosed;
      return { y, height: (showLine ? botOpen : botClosed) - y };
    }
    const hFull = num('data-h-full'), hCompact = num('data-h-compact');
    if (Number.isFinite(hFull) && Number.isFinite(hCompact)) {
      return { y: null, height: showLine ? hFull : hCompact };
    }
    return null;
  }

  // Show or hide the two caption bands, and move the card's edges to match.
  //
  // ANIMATED, like the scorecard's stack — same 0.45s power3.out on the card
  // edge, so the two elements move the same way on the same broadcast. A band
  // fades faster than the edge travels (and, on the way in, only after the edge
  // has cleared it) so copy never appears outside the card. First paint and
  // theme swaps snap: `lineLaidOut` is the scorecard's `laidOut`.
  function setBands(showHead, showLine) {
    const bg = engine.slots['card-bg'];
    const edges = cardEdges(bg, showHead, showLine);
    const bands = [
      [engine.slots['head-group'], showHead],
      [engine.slots['line-group'], showLine],
    ];

    // No gsap yet (it loads async) or nothing on screen to move: place it.
    if (!gsap || !lineLaidOut) {
      for (const [group, show] of bands) {
        if (!group) continue;
        if (gsap) gsap.set(group, { opacity: show ? 1 : 0 });
        else group.setAttribute('opacity', show ? '1' : '0');
      }
      if (bg && edges) {
        if (edges.y != null) bg.setAttribute('y', edges.y);
        bg.setAttribute('height', edges.height);
      }
      lineLaidOut = true;
      return;
    }

    if (bg && edges) {
      const attr = { height: edges.height };
      if (edges.y != null) attr.y = edges.y;
      gsap.to(bg, { attr, duration: 0.45, ease: 'power3.out' });
    }
    for (const [group, show] of bands) {
      if (!group) continue;
      gsap.to(group, {
        opacity: show ? 1 : 0,
        duration: show ? 0.28 : 0.18,
        delay: show ? 0.14 : 0,
        ease: 'power2.out',
      });
    }
  }

  function bind(info, { flashChanges, line, head }) {
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

    // The two caption bands, both producer-controlled. Text goes in only while a
    // band is (or is becoming) visible — on the way out it keeps its last words
    // so the fade has something to fade. It is invisible afterwards, and the
    // next reveal rebinds before it opens.
    if (line.show) {
      engine.setText('line-label', line.label);
      engine.setText('line-text', line.text);
    }
    if (head.show) engine.setText('head-text', head.text, { optional: true });
    setBands(head.show, line.show);

    engine.refitText();
  }

  async function update(state, settings) {
    const theme = g(settings, 'overlays.global.designPackage', null) || DEFAULT_PACKAGE;
    const themeChanged = await engine.ensureTheme(theme);
    // A theme swap rebuilds every slot, so the new card places itself rather
    // than animating from the old one's geometry.
    if (themeChanged) { prevCharKey = ''; prevValues = {}; lineLaidOut = false; }
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
    // No stats line for this side → nothing to draw. Name the gap so the empty
    // card doesn't read as a broken source in the preview.
    OverlayBase.setBlank(
      info ? null
        : `No stats for side ${TEAM} on scoreboard ${SB} — check the board has a game with this player.`,
      `Stats ${TEAM}`,
    );
    if (!info) { prevCharKey = ''; prevValues = {}; return; }

    const charKey = `${theme}|${info.charName}`;
    const charChanged = charKey !== prevCharKey;
    const wasShowing = prevCharKey !== '';
    prevCharKey = charKey;

    const line = resolveLine(info, settings);
    const head = resolveHead(info, settings);

    const content = engine.slots['content'];
    if (charChanged && wasShowing && useFade(settings) && content) {
      // Dissolve: fade the content group out, rebind, fade back in.
      prevValues = {};
      if (fadeTimer) clearTimeout(fadeTimer);
      content.style.transition = 'opacity 0.2s ease';
      content.style.opacity = '0';
      fadeTimer = setTimeout(() => {
        if (disposed || content !== engine.slots['content']) return;
        bind(info, { flashChanges: false, line, head });
        content.style.transition = 'opacity 0.25s ease';
        content.style.opacity = '1';
      }, 200);
    } else {
      if (content) { content.style.transition = ''; content.style.opacity = '1'; }
      bind(info, { flashChanges: !charChanged && useFade(settings), line, head });
    }

    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
      if (!disposed) engine.refitText();
    });
  }

  function dispose() {
    disposed = true;
    if (fadeTimer) clearTimeout(fadeTimer);
    if (gsap) {
      for (const slot of ['line-group', 'card-bg']) {
        if (engine.slots[slot]) gsap.killTweensOf(engine.slots[slot]);
      }
    }
    host.classList.remove('st-host');
    host.innerHTML = '';
  }

  return { update, dispose };
}
