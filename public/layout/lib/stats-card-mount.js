// stats-card-mount.js — the shared stat-line mount, worn two ways.
//
// ONE mount, two elements: the wide Stat Bar (`statsbar`, 452x118) and the 2x2
// Stat Card (`statscard`, 380x294). Each owns a dedicated ?team= source; the
// card is ALSO a container member, and both of its paths pass the same pair, so
// it is one element configured once wherever it is drawn. The caller picks
// which card by passing `settingsType` + `svgElement`; the defaults below are
// the bar's.
//
// The scoreboard-bound stats element: shows the character currently batting /
// pitching for one side, with their headline stats and (HUD games) the
// current-game line. The look lives in the active DESIGN PACKAGE's theme SVG
// (/design/{package}/statsbar.svg, element-by-element fallback to `default`).
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
//   line-label(text)   "Game" prefix, bound only for a HUD game's line
//   roster-group(g)    the optional roster band, below the footer. Authored
//                      under an OPEN footer; data-dy-closed is how far it lifts
//                      when the footer is closed. card-bg's data-roster-open /
//                      data-roster-closed are the card's bottom edge with the
//                      band on under an open / closed footer.
//   roster-char-{i}(image, i = 0..8) the side's nine
//   roster-cap-ring(shape) parked around the captain's slot (data-pad)
//   line-text(text,maxw) the game line itself. A theme that LEFT-ALIGNS it beside
//                      that label declares data-x-labelled / data-x-bare (its two
//                      left edges) and data-maxr (its one right bound), and the
//                      mount picks — see placeLine.
//
// Caption alignment: subLineAlign / topLineAlign ('left' | 'center' | 'right')
// align the header and the bottom line on the card's row, the bottom line
// taking its "Game" label with it — see captionSpan / captionGroupX in
// mount-utils.js. UNSET means the theme's own alignment, untouched, so a
// package that authored a centred line keeps it until the producer picks one.
//
// Settings: overlays.{type}.transitionType ('fade' | 'none') gates the batter-
// change dissolve; subLine / subLineText choose the footer's content and
// topLine / topLineText the header's; showRoster adds the roster band. Stat-value changes flash through
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
import { lineTextBox, captionSpan, captionGroupX, layoutStatCells } from './mount-utils.js';
import { styleNs, styleSetting } from './side-styles.js';

const ELEMENT = 'statsbar';
const DEFAULT_PACKAGE = 'default';
const MAX_STATS = 6;
const ALIGNS = new Set(['left', 'center', 'right']);

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

export function mountStatsCard({ host, sb, team, settingsType = 'statsbar',
                                 svgElement = ELEMENT, fallbackSvg = FALLBACK_SVG }) {
  injectCss();
  host.classList.add('st-host');
  const SB = sb || 1;
  const TEAM = team === 2 ? 2 : 1;
  // Which settings namespace this card reads (overlays.{SETTINGS_TYPE}.*). The
  // Stat Bar uses 'statsbar' and the Stat Card 'statscard' — from its own layout
  // and from a container's roster alike — so the two cards are configured
  // independently and the card is configured once.
  const SETTINGS_TYPE = settingsType || 'statsbar';

  // Which design-package SVG this card renders. The Stat Bar uses the wide
  // 4-across 'statsbar'; the Stat Card passes 'statscard' for the compact 2x2
  // card, so the two are themed independently even though they share this mount
  // and the same RioData resolution.
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
  // What each band node was last sent to, per property (see setBands). Keyed
  // by node, so a theme swap — which rebuilds every slot — starts clean.
  const tweenTargets = new WeakMap();
  ensureGsap().then(lib => { if (!disposed) gsap = lib; });

  const g = OverlayBase.deepGet;
  // This side's copy when Separate side styles is on, else the shared one
  // (./side-styles.js).
  const sideSetting = (settings, key, def) => styleSetting(settings, SETTINGS_TYPE, TEAM, key, def);

  function useFade(settings) {
    return sideSetting(settings, 'transitionType', 'fade') === 'fade';
  }

  // Resolve the bottom line from the producer's choice:
  //   'gameLine' (default) — the live HUD game line, or the Season Stats label
  //                          for API games (the original auto behavior)
  //   'custom'             — a fixed user string (hidden + compact when blank)
  //   'off'                — always hidden; card shrinks to data-h-compact
  function resolveLine(info, settings) {
    const mode = sideSetting(settings, 'subLine', 'gameLine');
    if (mode === 'off') return { show: false, label: '', text: '' };
    const align = sideSetting(settings, 'subLineAlign', null);
    if (mode === 'custom') {
      const text = String(sideSetting(settings, 'subLineText', '') || '').trim();
      return { show: !!text, label: '', text, align };
    }
    const text = info.gameLine || info.bottomLabel || '';
    const label = info.gameLine ? info.bottomLabel : '';
    return { show: !!text, label, text, align };
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
    const mode = sideSetting(settings, 'topLine', 'off');
    const align = sideSetting(settings, 'topLineAlign', null);
    if (mode === 'custom') {
      const text = String(sideSetting(settings, 'topLineText', '') || '').trim();
      return { show: !!text, text, align };
    }
    if (mode === 'auto') {
      const name = String(info.gameMode || '').trim();
      return { show: !!name, text: name ? `${name} Stats` : '', align };
    }
    return { show: false, text: '' };
  }

  /*
   * Resolve the ROSTER band: the side's nine from the board, the captain by
   * INDEX (rio_captainIndex, never a guess at slot 0). Off unless the producer
   * turned it on, and off on a theme that draws no band (no roster-open /
   * roster-closed on card-bg, so the card has nowhere to put it). Two or more
   * characters, like the Scoreboard L's band: a completed record with no roster
   * still has its captain, and one icon is not a roster.
   */
  function resolveRoster(state, settings) {
    const off = { show: false, names: [], capIdx: null };
    if (!OverlayBase.settingOn(sideSetting(settings, 'showRoster', false), false)) return off;
    const bg = engine.slots['card-bg'];
    if (!engine.slots['roster-group'] || !bg ||
        !Number.isFinite(parseFloat(bg.getAttribute('data-roster-open')))) return off;
    const names = [];
    for (let i = 0; i < 9; i++) {
      names.push(String(g(state, `score.${SB}.player.${TEAM}.character.${i}.name`, '') || ''));
    }
    if (names.filter(Boolean).length < 2) return off;
    const cap = g(state, `score.${SB}.player.${TEAM}.rio_captainIndex`, null);
    const capIdx = cap == null || cap === '' ? null : Number(cap);
    return { show: true, names, capIdx: Number.isFinite(capIdx) ? capIdx : null };
  }

  // The theme's own x / text-anchor / data-maxw for a caption, read once per
  // node. Alignment rewrites all three, so every later pass has to start from
  // what the theme authored, not from the previous pass's answer — and an
  // alignment set back to unset has to be able to put them back.
  const authored = new WeakMap();
  function baseOf(el) {
    let b = authored.get(el);
    if (!b) {
      b = {
        x: parseFloat(el.getAttribute('x')),
        anchor: el.getAttribute('text-anchor') || 'start',
        maxw: parseFloat(el.getAttribute('data-maxw')),
        rawMaxw: el.getAttribute('data-maxw'),
      };
      authored.set(el, b);
    }
    return b;
  }

  // Write a caption's geometry, telling the fit when it moved. refitText skips
  // a slot whose TEXT hasn't changed, so a bound that moved under unchanged
  // copy has to say so or the line keeps the old fit.
  //
  // `x` null leaves the position alone: an aligned line's x is settled AFTER
  // its fit (settleLineGroup), and resetting it here every frame would read as
  // a moved bound and refit the line on every HUD frame.
  function setGeometry(el, x, anchor, maxw) {
    const curAnchor = el.getAttribute('text-anchor') || 'start';
    if ((x == null || parseFloat(el.getAttribute('x')) === x) && curAnchor === anchor &&
        el.getAttribute('data-maxw') === maxw) return;
    if (x != null) el.setAttribute('x', String(x));
    el.setAttribute('text-anchor', anchor);
    if (maxw == null) el.removeAttribute('data-maxw');
    else el.setAttribute('data-maxw', maxw);
    engine.invalidateFit(el);
  }

  function restoreAuthored(el) {
    const base = baseOf(el);
    setGeometry(el, base.x, base.anchor, base.rawMaxw);
  }

  function setX(el, x) {
    if (el && parseFloat(el.getAttribute('x')) !== x) el.setAttribute('x', String(x));
  }

  // Place the header caption: the theme's centred line, unless the producer
  // aligned it — then on the card's row (captionSpan in mount-utils.js).
  function placeHead(align) {
    const el = engine.slots['head-text'];
    if (!el) return;
    const span = ALIGNS.has(align) ? captionSpan(el, baseOf(el)) : null;
    if (!span) { restoreAuthored(el); return; }
    const maxw = String(span.end - span.start);
    if (align === 'center') setGeometry(el, (span.start + span.end) / 2, 'middle', maxw);
    else if (align === 'right') setGeometry(el, span.end, 'end', maxw);
    else setGeometry(el, span.start, 'start', maxw);
  }

  // A producer-aligned bottom line, waiting on its fit: the line's width is
  // only known once refitText has sized it, so the group is placed after it
  // (settleLineGroup). Null while the theme's own alignment stands.
  let lineGroup = null;

  // Place the bottom line, which is left-aligned beside its label on themes
  // that say where — see lineTextBox in mount-utils.js for why the label being
  // conditional is what makes this two authored positions rather than one.
  //
  // A producer's alignment moves the label WITH the line: "Game" names the line
  // beside it, so the two are one group, aligned on the card's row
  // (captionGroupX). Aligning the line alone centred it in whatever the label
  // left over, which read as off-centre by half the label.
  function placeLine(hasLabel, align) {
    const el = engine.slots['line-text'];
    const label = engine.slots['line-label'];
    if (!el) return;
    baseOf(el);                             // read before anything moves it
    if (label) baseOf(label);
    // The label's real width, in whatever face the producer set it in — the
    // authored `data-x-labelled` assumes the theme's own. Half the label's
    // type size is the gap, which is roughly what the shipped themes leave.
    let labelW = 0, gap = 0;
    if (hasLabel && label && label.getComputedTextLength) {
      try {
        const len = label.getComputedTextLength();
        if (len > 0) {
          labelW = len;
          gap = 0.5 * (parseFloat(label.getAttribute('font-size')) || 0);
        }
      } catch { /* detached or unrendered: keep the authored edge */ }
    }

    const span = ALIGNS.has(align) ? captionSpan(el, baseOf(el)) : null;
    if (span) {
      // The fit bound is the row minus the label, whatever the alignment — so
      // a line fits the same size left, centred or right.
      // The label-to-line spacing is the theme's where it says so
      // (data-x-labelled), never less than the measured label plus its gap —
      // so an explicit Left draws exactly what the theme's own layout does.
      const authoredLead = parseFloat(el.getAttribute('data-x-labelled')) - span.start;
      const lead = labelW > 0
        ? Math.max(labelW + gap, Number.isFinite(authoredLead) ? authoredLead : 0) : 0;
      setGeometry(el, null, 'start', String(span.end - span.start - lead));
      lineGroup = { span, align, labelW: labelW > 0 ? lead - gap : 0, gap };
      return;
    }

    lineGroup = null;
    if (label) setX(label, baseOf(label).x);
    const labelEnd = labelW > 0 ? baseOf(label).x + labelW : null;
    const box = lineTextBox(el, hasLabel, labelEnd, gap);
    if (box) setGeometry(el, box.x, 'start', String(box.maxw));
    else restoreAuthored(el);               // centred theme: its own geometry
  }

  // Place an aligned label + line group now that the line has its fitted size.
  function settleLineGroup() {
    if (!lineGroup) return;
    const el = engine.slots['line-text'];
    if (!el) return;
    let textW = 0;
    try { textW = el.getComputedTextLength ? el.getComputedTextLength() : 0; }
    catch { /* unrendered: place it as if empty */ }
    const { span, align, labelW, gap } = lineGroup;
    const { labelX, textX } = captionGroupX(span, align, labelW, gap, textW);
    setX(engine.slots['line-label'], labelX);
    setX(el, textX);
  }

  function refit() {
    engine.refitText();
    settleLineGroup();
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
  //
  // The roster band, where a theme draws one, owns the bottom edge whenever it
  // is on: data-roster-open / data-roster-closed are that edge under an open
  // and a closed footer. A theme without the pair never shows the band.
  function cardEdges(bg, showHead, showLine, showRoster) {
    if (!bg) return null;
    const num = (name) => parseFloat(bg.getAttribute(name));
    const topOpen = num('data-top-open'), topClosed = num('data-top-closed');
    const botOpen = num('data-bot-open'), botClosed = num('data-bot-closed');
    if (Number.isFinite(topOpen) && Number.isFinite(topClosed) &&
        Number.isFinite(botOpen) && Number.isFinite(botClosed)) {
      const y = showHead ? topOpen : topClosed;
      let bottom = showLine ? botOpen : botClosed;
      if (showRoster) {
        const r = num(showLine ? 'data-roster-open' : 'data-roster-closed');
        if (Number.isFinite(r)) bottom = r;
      }
      return { y, height: bottom - y };
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
  //
  // The roster band also MOVES: it is authored under an open footer and lifts
  // by data-dy-closed when the footer closes, so it always sits directly under
  // whatever is above it. Its offset rides the same edge tween.
  function setBands(showHead, showLine, showRoster) {
    const bg = engine.slots['card-bg'];
    const edges = cardEdges(bg, showHead, showLine, showRoster);
    const roster = engine.slots['roster-group'];
    const bands = [
      [engine.slots['head-group'], showHead],
      [engine.slots['line-group'], showLine],
      [roster, showRoster],
    ];
    const dy = showLine ? 0 : (parseFloat(roster?.getAttribute('data-dy-closed')) || 0);
    const rosterAt = `translate(0,${dy})`;

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
      if (roster) roster.setAttribute('transform', rosterAt);
      for (const [group, show] of bands) if (group) tweenTargets.set(group, { opacity: show });
      if (roster) tweenTargets.set(roster, { ...tweenTargets.get(roster), attr: rosterAt });
      if (bg && edges) tweenTargets.set(bg, { attr: `${edges.y}:${edges.height}` });
      lineLaidOut = true;
      return;
    }

    // Tween only what CHANGED, and a new tween KILLS the old one's claim on
    // the same property — including one still waiting out its delay. This runs
    // on every update (every HUD frame), and a show fade carries a delay:
    // re-issued blindly, a show queued by one update started AFTER the hide
    // the next update issued, and won — two quick setting changes left a band
    // drawn outside a card that had already closed over it. Keyed per node AND
    // property, because the roster band tweens both its offset and its fade.
    const tween = (el, prop, key, vars) => {
      if (!el) return;
      const seen = tweenTargets.get(el) || {};
      if (seen[prop] === key) return;
      tweenTargets.set(el, { ...seen, [prop]: key });
      gsap.killTweensOf(el, prop);
      gsap.to(el, vars);
    };

    tween(roster, 'attr', rosterAt, { attr: { transform: rosterAt }, duration: 0.45, ease: 'power3.out' });
    if (bg && edges) {
      const attr = { height: edges.height };
      if (edges.y != null) attr.y = edges.y;
      tween(bg, 'attr', `${edges.y}:${edges.height}`, { attr, duration: 0.45, ease: 'power3.out' });
    }
    for (const [group, show] of bands) {
      tween(group, 'opacity', show, {
        opacity: show ? 1 : 0,
        duration: show ? 0.28 : 0.18,
        delay: show ? 0.14 : 0,
        ease: 'power2.out',
      });
    }
  }

  // The side's nine into the roster band, the captain ring parked around the
  // captain's slot — the Scoreboard L's bindRoster, for one side.
  function bindRoster(roster) {
    let capEl = null;
    for (let i = 0; i < 9; i++) {
      const name = roster.names[i] || '';
      engine.setImage(`roster-char-${i}`, name && window.RioData ? RioData.charIconUrl(name) : '');
      if (name && i === roster.capIdx) capEl = engine.slots[`roster-char-${i}`];
    }
    const ring = engine.slots['roster-cap-ring'];
    if (!ring) return;
    if (capEl) {
      const pad = parseFloat(ring.getAttribute('data-pad')) || 3;
      ring.setAttribute('x', (parseFloat(capEl.getAttribute('x')) || 0) - pad);
      ring.setAttribute('y', (parseFloat(capEl.getAttribute('y')) || 0) - pad);
      ring.setAttribute('opacity', '1');
    } else {
      ring.setAttribute('opacity', '0');
    }
  }

  function bind(info, { flashChanges, line, head, roster }) {
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

    // Cells sized by what each CATEGORY needs, on themes that declare the band.
    // Runs before refitText because it is what sets each value's fit bound.
    layoutStatCells(engine, info.stats);

    // The two caption bands, both producer-controlled. Text goes in only while a
    // band is (or is becoming) visible — on the way out it keeps its last words
    // so the fade has something to fade. It is invisible afterwards, and the
    // next reveal rebinds before it opens.
    if (line.show) {
      engine.setText('line-label', line.label);
      engine.setText('line-text', line.text);
      placeLine(!!line.label, line.align);
    }
    if (head.show) {
      engine.setText('head-text', head.text, { optional: true });
      placeHead(head.align);
    }
    if (roster.show) bindRoster(roster);
    setBands(head.show, line.show, roster.show);

    refit();
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

    if (engine.usesAppVars) OverlayBase.applyDesignSettings(SETTINGS_TYPE, styleNs(settings, SETTINGS_TYPE, TEAM));
    else OverlayBase.clearDesignSettings(SETTINGS_TYPE, styleNs(settings, SETTINGS_TYPE, TEAM));

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

    // The ROLE is part of the identity, not just the character: batting and
    // pitching are different stat sets with different column budgets, so a flip
    // between them re-lays-out the row and wants the same dissolve a new batter
    // gets. Without it, a player who bats and pitches kept one key across both.
    const charKey = `${theme}|${info.role}|${info.charName}`;
    const charChanged = charKey !== prevCharKey;
    const wasShowing = prevCharKey !== '';
    prevCharKey = charKey;

    const line = resolveLine(info, settings);
    const head = resolveHead(info, settings);
    const roster = resolveRoster(state, settings);

    const content = engine.slots['content'];
    if (charChanged && wasShowing && useFade(settings) && content) {
      // Dissolve: fade the content group out, rebind, fade back in.
      prevValues = {};
      if (fadeTimer) clearTimeout(fadeTimer);
      content.style.transition = 'opacity 0.2s ease';
      content.style.opacity = '0';
      fadeTimer = setTimeout(() => {
        if (disposed || content !== engine.slots['content']) return;
        bind(info, { flashChanges: false, line, head, roster });
        content.style.transition = 'opacity 0.25s ease';
        content.style.opacity = '1';
      }, 200);
    } else {
      if (content) { content.style.transition = ''; content.style.opacity = '1'; }
      bind(info, { flashChanges: !charChanged && useFade(settings), line, head, roster });
    }

    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
      if (!disposed) refit();
    });
  }

  function dispose() {
    disposed = true;
    if (fadeTimer) clearTimeout(fadeTimer);
    if (gsap) {
      for (const slot of ['line-group', 'card-bg', 'roster-group']) {
        if (engine.slots[slot]) gsap.killTweensOf(engine.slots[slot]);
      }
    }
    host.classList.remove('st-host');
    host.innerHTML = '';
  }

  return { update, dispose };
}
