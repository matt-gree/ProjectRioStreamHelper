// scorecard-mount.js — the re-themable vertical Scorecard element.
//
// A scoreboard-bound element (its own OBS source, ?scoreboard=N). The source is
// the SIZE OF THE CARD (496x766), not the stream frame: where the column sits is
// a scene decision a producer makes once in OBS, and a full-canvas source made
// them make it inside a 1920x1080 box whose other three quarters were empty.
// The look lives in the active DESIGN PACKAGE's theme SVG
// (/design/{package}/scorecard.svg, element-by-element fallback to `default`).
//
// This mount is a STACK-LAYOUT ENGINE: the nine numbered design elements are
// authored in the theme at a local y-origin of 0 (each declaring data-h); the
// mount melds the active ones into one continuous card — translating each to
// its stacked Y, sizing the shared card-bg + accent rail, hiding the top
// section's divider — and reflows/animates the stack when the producer toggles
// elements via overlays.scorecard.* (broadcast live over the settings socket).
//
//   const sc = mountScorecard({ host, sb });
//   sc.update(OverlayBase.state, OverlayBase.settings);
//   sc.setShown(bool);  sc.dispose();
//
// Requires overlay-base.js (OverlayBase) + rio-data.js (RioData).

import { createThemeEngine } from './svg-theme-engine.js';
import { createRevealGate, clearAnimClassOnEnd } from './reveal-gate.js';
import { ensureGsap } from './gsap-loader.js';
import { DOT_OFF, dot, applyCardRail, bindImageProbe, prettyStadium, layoutBox } from './mount-utils.js';
import { ensurePortPalette, portColor as portPaletteColor } from './port-colors.js';

const ELEMENT = 'scorecard';
const SETTINGS_TYPE = 'scorecard';
const DEFAULT_PACKAGE = 'default';
const MAX_INN = 9;

// The source is the size of the CARD, not the stream frame. 496 x 766 is the
// card's 480-wide column inside an 8-unit gutter, by the tallest the melded
// stack gets (every band plus the full score block). The card TOP-anchors, so
// the slack below it as bands come and go is transparent and a producer's OBS
// placement holds. Themes still authored on the retired 1920x1080 canvas are
// re-framed onto this one — see ensureCardBox.
const NATIVE_W = 496;
const NATIVE_H = 766;
const CARD_GUTTER = 8;

// Stacked element order + its visibility predicate over the resolved toggles.
// The three score blocks are mutually exclusive branches of ONE setting
// (mainMode), so their order among themselves never shows: whichever is chosen
// occupies the same slot in the stack.
const STACK = [
  ['el-header',    v => v.showHeader],
  ['el-phase',     v => v.showPhase && v.hasPhase],
  ['el-mode',      v => v.showGameMode && v.hasMode],
  ['el-main',      v => v.mainMode === 'full'],
  ['el-rosters',   v => v.mainMode === 'rosters'],
  ['el-condensed', v => v.mainMode === 'condensed'],
  ['el-atbat',     v => v.showAtBat && !v.isFinal],
  ['el-box',       v => v.showBoxScore && v.hasBox],
  ['el-stadium',   v => !!v.footer],
];

/*
 * THE FOOTER IS TWO FACTS ON ONE LINE.
 *
 * The stadium and the date are peers — each is a thing about the game a
 * producer may or may not want under the card — so each has its own eye, the
 * way every other band on this card does. Where they go is NOT a third
 * question: they are two short centred strings, and stacking them under six
 * other bands spends 88 units saying what fits in 44. A `footerLayout` picker
 * offering "one line / two bars" shipped for about an hour and came straight
 * back out — the second arrangement is the worse one in every state, so the
 * control could only ever be a way to make the card taller and no better.
 *
 * One composition, one band, one string: an empty one self-hides, so `off`
 * needs no case of its own.
 */
export function footerLine(parts) {
  return parts.filter(Boolean).join(' \u00b7 ');
}

/*
 * WHERE EACH SCORE BLOCK DRAWS THE INNING AND THE FINAL BADGE.
 *
 * All three answer one pair of facts — which half of which inning, or that the
 * game is over — and they answered it in three hand-written copies that agreed
 * only because nothing had changed since each was written. They are one
 * function over three slot names now (bindGameMark).
 *
 * The full block puts the marker at the head of its situation row; the other
 * two have no situation row, which is exactly why they need their own: a
 * producer who cuts to a block without a diamond has not asked to stop being
 * told what inning it is.
 */
const MARK_FULL     = { num: 'inn-num',   up: 'inn-arrow-up',   down: 'inn-arrow-down',   final: 'final-badge' };
const MARK_ROSTERS  = { num: 'r-inn-num', up: 'r-inn-arrow-up', down: 'r-inn-arrow-down', final: 'r-final' };
const MARK_CONDENSED = { num: 'c-inn-num', up: 'c-inn-arrow-up', down: 'c-inn-arrow-down', final: 'c-final' };

/*
 * THE COUNT IS 3 · 2 · 2, one short of each terminal value: a fourth ball is a
 * walk, a third strike and a third out end something, so each resets before the
 * next frame and a dot drawn for it could never come on. The Scoreboard's
 * themes and the classic Scorecard have always been authored this way and the
 * mount looped 4 / 3 / 3 over them — which drew nothing on those packages
 * (a missing slot is a no-op) and drew a dead fourth dot on default's.
 *
 * RETIRED holds the slots that convention leaves out. A package authored before
 * this still declares them, and an unbound dot is a dot that sits off for the
 * whole broadcast — worse than the gap left by hiding it, and not something a
 * producer can fix from the console. Re-export such a package to reclaim the
 * width.
 */
const COUNT = [
  { prefix: 'ball',   max: 3, on: '#22c55e', retired: ['ball-3'] },
  { prefix: 'strike', max: 2, on: '#eab308', retired: ['strike-2'] },
  { prefix: 'out',    max: 2, on: '#ef4444', retired: ['out-2'] },
];

const FALLBACK_SVG = `
<svg viewBox="0 0 496 766" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <rect data-slot="card-rail" x="8" y="8" width="6" height="180" rx="3" style="fill:var(--accent)"/>
  <rect data-slot="card-bg" x="14" y="8" width="474" height="180" rx="16" style="fill:var(--band);stroke:var(--border)"/>
  <g data-slot="el-main" data-h="180">
    <text data-slot="s1-name" data-maxw="300" x="34" y="60" style="fill:var(--ink);font-family:var(--font-display)" font-size="30" font-weight="700">Player One</text>
    <text data-slot="s1-score" x="460" y="60" text-anchor="end" style="fill:var(--ink);font-family:var(--font-mono)" font-size="40" font-weight="700">0</text>
    <text data-slot="s2-name" data-maxw="300" x="34" y="120" style="fill:var(--ink);font-family:var(--font-display)" font-size="30" font-weight="700">Player Two</text>
    <text data-slot="s2-score" x="460" y="120" text-anchor="end" style="fill:var(--ink);font-family:var(--font-mono)" font-size="40" font-weight="700">0</text>
  </g>
</svg>`;

const CSS = `
.sc-host { position: fixed; inset: 0; }
.sc-host svg { width: 100%; height: 100%; display: block; }
.sc-host.sc-reveal { animation: sc-rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both; }
.sc-host.sc-off { opacity: 0 !important; }
@keyframes sc-rise { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .sc-host.sc-reveal { animation: none; } }
`;

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.id = 'scorecard-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

export function mountScorecard({ host, sb }) {
  injectCss();
  host.classList.add('sc-host');
  const SB = sb || 1;

  const engine = createThemeEngine({ host, element: ELEMENT, fallbackSvg: FALLBACK_SVG });
  let gsap = null;
  ensureGsap().then(g => { gsap = g; });

  let revealKey = '';
  let laidOut = {};           // el-* -> bool (has been positioned once; gates animate-vs-snap)
  let baseState = [false, false, false];
  let cardBox = null;         // theme-authored card box (captured once per theme)
  let disposed = false;

  const g = OverlayBase.deepGet;

  // Per-scoreboard settings namespace. Each scorecard source keeps its own
  // config under overlays.scorecard.{N}.*; a plain overlays.scorecard.* leaf is
  // the legacy (pre-per-scoreboard) global, used as a non-destructive fallback
  // so scoreboards that were never individually edited keep their old look.
  const NS = `${SETTINGS_TYPE}.${SB}`;
  function scGet(settings, k, def) {
    const perSb = g(settings, `overlays.${SETTINGS_TYPE}.${SB}.${k}`, undefined);
    if (perSb !== undefined) return perSb;
    return g(settings, `overlays.${SETTINGS_TYPE}.${k}`, def);
  }

  // ── settings / toggles ──────────────────────────────────────────────────────
  function readToggles(settings) {
    const t = k => scGet(settings, k, null);
    // settingOn, not `!== false` — see the note in scoreboard-mount's readToggles.
    const bool = (k, d) => { const v = t(k); return v == null ? d : OverlayBase.settingOn(v, d); };
    // The accent bar down the card's outer edge is PACKAGE CHROME, so it is a
    // global (Design → Display Toggles) with a per-board pin over it — the same
    // resolution as the Scoreboard's showLogo. See applyCardRail.
    const perSbRail = t('showRail');
    const showRail = perSbRail == null
      ? OverlayBase.settingOn(OverlayBase.readSetting(SETTINGS_TYPE, 'showRail', false), false)
      : OverlayBase.settingOn(perSbRail, false);
    return {
      showRail,
      showHeader:   bool('showHeader', true),
      showPhase:    bool('showPhase', true),
      showGameMode: bool('showGameMode', true),
      // full | condensed | off — the score block's whole control. The rosters
      // and the base diamond are PARTS OF the full block, not switches beside
      // it: a producer who wants less than the full block picks the condensed
      // bar, which is the state that was actually designed.
      mainMode:     t('mainMode') || 'full',
      showAtBat:    bool('showAtBat', true),
      showBoxScore: bool('showBoxScore', true),
      showStadium:  bool('showStadium', true),
      showDate:     bool('showDate', false),
      titleText:    t('titleText'),   // null when unset → default brand title
      phaseText:    t('phaseText') || '',
      showTeamLogos: true,
    };
  }

  // Resolve a side's colour from its controller port, falling back to
  // fallbackIdx when no port is assigned (side 1 → P1/index 0, side 2 →
  // P2/index 1). The palette itself is the app's — Design tab → Controller
  // Ports, with the active package's own `portColors` under it. See
  // lib/port-colors.js.
  function portColor(port, fallbackIdx) {
    return portPaletteColor(Number.isInteger(port) ? port : fallbackIdx);
  }

  function applyColours(settings, p1Port, p2Port) {
    const accent = scGet(settings, 'accentColor', null);
    if (accent) host.style.setProperty('--accent', accent); else host.style.removeProperty('--accent');
    const c1 = portColor(p1Port, 0);
    const c2 = portColor(p2Port, 1);
    if (c1) host.style.setProperty('--side1', c1); else host.style.removeProperty('--side1');
    if (c2) host.style.setProperty('--side2', c2); else host.style.removeProperty('--side2');
  }

  // ── the card's own box, read off the THEME ──────────────────────────────────
  // Two things depend on where the theme parks its column: where the melded
  // stack starts (card-bg's authored y) and what "centred" means for the header
  // (the rail+bg span). Both were constants pinned to the default package's old
  // full-frame canvas, in the same file that already reads the box score's
  // column x's back off the SVG — so a theme that placed its card anywhere else
  // stacked from the wrong y and drew its header off-centre.
  //
  // Captured once per theme, BEFORE sizeCard overwrites card-bg/card-rail's
  // y and height, and reset on a theme swap.
  function ensureCardBox() {
    if (cardBox) return cardBox;
    const bg = engine.slots['card-bg'];
    const rail = engine.slots['card-rail'];
    const num = (el, a, d) => {
      const v = el ? parseFloat(el.getAttribute(a)) : NaN;
      return isNaN(v) ? d : v;
    };
    const bgX = num(bg, 'x', CARD_GUTTER);
    const bgW = num(bg, 'width', NATIVE_W - 2 * CARD_GUTTER);
    const x0 = Math.min(bgX, num(rail, 'x', bgX));
    const top = num(bg, 'y', num(rail, 'y', CARD_GUTTER));
    cardBox = { top, left: x0, right: bgX + bgW, centerX: (x0 + bgX + bgW) / 2 };
    reframeLegacyCanvas(cardBox);
    return cardBox;
  }

  // A theme still authored on the retired 1920x1080 canvas parks a 480-wide card
  // in a stream frame. The source is now the size of the card, so letting
  // preserveAspectRatio fit that frame into it would draw the card at a quarter
  // scale. Cropping the viewBox to the card's own box (plus the gutter) lands it
  // at full size instead — the same rescue the bottom-anchored band elements
  // make for their alt canvas, done here on the theme's declared geometry rather
  // than in CSS because the scorecard's card differs from the frame on BOTH axes.
  // A theme already authored at the native canvas keeps its own framing: it may
  // deliberately draw outside the card, and cropping it would be the bug.
  function reframeLegacyCanvas(box) {
    const svg = host.querySelector('svg');
    const vb = svg && svg.getAttribute('viewBox');
    if (!vb) return;
    const n = vb.replace(/,/g, ' ').trim().split(/\s+/).map(Number);
    if (n.length !== 4 || n.some(v => !isFinite(v))) return;
    if (Math.round(n[2]) === NATIVE_W && Math.round(n[3]) === NATIVE_H) return;
    const w = (box.right - box.left) + 2 * CARD_GUTTER;
    const h = w * NATIVE_H / NATIVE_W;
    svg.setAttribute('viewBox', `${box.left - CARD_GUTTER} ${box.top - CARD_GUTTER} ${w} ${h}`);
  }

  // ── stack layout (the meld) ─────────────────────────────────────────────────
  function moveGroup(el, name, y, show, fresh) {
    if (!gsap) {
      el.setAttribute('transform', `translate(0,${y})`);
      el.setAttribute('opacity', show ? '1' : '0');
    } else if (fresh || laidOut[name] === undefined) {
      gsap.set(el, { y, opacity: show ? 1 : 0 });
    } else {
      gsap.to(el, { y, opacity: show ? 1 : 0, duration: 0.45, ease: 'power3.out' });
    }
    laidOut[name] = show;
  }

  function sizeCard(total, fresh) {
    const bg = engine.slots['card-bg'];
    const rail = engine.slots['card-rail'];
    const top = ensureCardBox().top;
    const h = Math.max(total, 1);
    const vis = total > 0 ? '1' : '0';
    for (const el of [bg, rail]) {
      if (!el) continue;
      el.setAttribute('y', top);
      el.setAttribute('opacity', vis);
      if (!gsap || fresh || laidOut['__card'] === undefined) el.setAttribute('height', h);
      else gsap.to(el, { attr: { height: h }, duration: 0.45, ease: 'power3.out' });
    }
    laidOut['__card'] = true;
  }

  function relayout(vis, fresh) {
    const top = ensureCardBox().top;
    let off = 0, activeCount = 0;
    for (const [name, want] of STACK) {
      const el = engine.slots[name];
      if (!el) continue;
      const show = !!want(vis);
      const div = el.querySelector('.sc-div');
      if (show) {
        moveGroup(el, name, top + off, true, fresh);
        if (div) div.setAttribute('opacity', activeCount === 0 ? '0' : '1');
        off += parseFloat(el.getAttribute('data-h')) || 0;
        activeCount++;
      } else {
        moveGroup(el, name, top + off, false, fresh);
      }
    }
    sizeCard(off, fresh);
  }

  // ── header: centre logo + title together ────────────────────────────────────
  function centerHeader(titleText) {
    const logoG = engine.slots['header-logo'];
    const titleEl = engine.slots['header-title'];
    if (!logoG || !titleEl) return;
    const hasTitle = !!titleText;
    let tW = 0;
    if (hasTitle) { try { tW = titleEl.getComputedTextLength(); } catch { tW = 0; } }
    const logoW = 40, gap = hasTitle ? 14 : 0;
    const totalW = logoW + gap + tW;
    const startX = ensureCardBox().centerX - totalW / 2;
    logoG.setAttribute('transform', `translate(${startX},0)`);
    titleEl.setAttribute('x', startX + logoW + gap);
  }

  // ── slot helpers ────────────────────────────────────────────────────────────
  function setOpacity(name, on) {
    const el = engine.slots[name];
    if (el) el.setAttribute('opacity', on ? '1' : '0');
  }

  function teamLogoUrl(team) { return team && window.RioData ? RioData.teamLogoUrl(team) : ''; }
  function charIconUrl(name) { return name && window.RioData ? RioData.charIconUrl(name) : ''; }

  /*
   * WHAT GOES IN A SIDE'S LOGO WELL: its MSB team logo, and failing that its
   * CAPTAIN. The well is the only square on the row, so an empty one is a hole
   * in the plate rather than a fact left unsaid — and it was empty in the states
   * a producer hits most often on purpose: a completed record with no team
   * assigned, a fixture bound before the first pitch, an asset pack missing that
   * one file. The captain is the truest thing the record has to put there (the
   * team IS the captain's in MSB), which is why the Scoreboard has fallen back
   * this way all along; the rule itself is RioData's so the two cannot drift.
   *
   * Every block on this card draws the same pair of wells, so all three go
   * through here.
   */
  function sideLogoUrl(state, team, teamName, vis) {
    if (!vis.showTeamLogos) return '';
    return teamLogoUrl(teamName) || (window.RioData ? RioData.captainIconUrl(state, SB, team) : '');
  }

  // The inning marker and the FINAL badge, for whichever block is drawing them.
  // See MARK_FULL / MARK_ROSTERS / MARK_CONDENSED.
  function bindGameMark(d, mark) {
    engine.setText(mark.num, d.isFinal ? '' : d.inn);
    setOpacity(mark.num, !d.isFinal);
    setOpacity(mark.up, !d.isFinal && d.isTop);
    setOpacity(mark.down, !d.isFinal && !d.isTop);
    setOpacity(mark.final, d.isFinal);
  }

  // ── data binding ────────────────────────────────────────────────────────────
  // Standard roster order 0..8 (no captain reordering; the team logo already
  // tells the viewer who the captain is).
  function bindRoster(prefix, team) {
    for (let i = 0; i < 9; i++) {
      const name = g(OverlayBase.state, `score.${SB}.player.${team}.character.${i}.name`, '');
      engine.setImage(`${prefix}-char-${i}`, name ? charIconUrl(name) : '');
    }
  }

  function bindMain(state, d, vis) {
    engine.setText('s1-name', d.p1 || 'Player One');
    engine.setText('s2-name', d.p2 || 'Player Two');
    engine.setText('s1-score', d.sL);
    engine.setText('s2-score', d.sR);
    engine.setImage('s1-logo', sideLogoUrl(state, 1, d.team1, vis));
    engine.setImage('s2-logo', sideLogoUrl(state, 2, d.team2, vis));

    bindRoster('s1', 1);
    bindRoster('s2', 2);

    bindGameMark(d, MARK_FULL);
    bindCount(d);
    bindBases(d);
  }

  // The count, 3 · 2 · 2, plus the retired fourth/third dots a package authored
  // before that convention still draws. See COUNT.
  // `at` is the block's slot prefix: the full block's count is unprefixed, the
  // rosters strip's is `r-`. Same dots, same rule, two places on the card that
  // can draw them.
  function bindCount(d, at = '') {
    const held = { ball: d.balls, strike: d.strikes, out: d.outs };
    for (const { prefix, max, on, retired } of COUNT) {
      for (let i = 0; i < max; i++) dot(engine, `${at}${prefix}-${i}`, i < held[prefix], on);
      for (const name of retired) setOpacity(`${at}${name}`, false);
    }
  }

  /*
   * THE ROSTERS BLOCK — the full block's two plates and two roster bands, with
   * the situation row replaced by a strip carrying the one thing that row held
   * which is not about the pitch in flight: what inning it is, or that the game
   * is over.
   *
   * That strip is the whole reason this is a block and not a switch on the full
   * one. A producer who wants the teams without the count/diamond is asking for
   * a card that sits on air between at-bats, and the inning is the LAST thing to
   * drop from one — it was the only fact in the situation row a still frame
   * still needs. Dropping the row wholesale took it along, which is what made
   * "hide the diamond" a state nobody could actually use.
   */
  function bindRosters(state, d, vis) {
    engine.setText('r-s1-name', d.p1 || 'Player One');
    engine.setText('r-s2-name', d.p2 || 'Player Two');
    engine.setText('r-s1-score', d.sL);
    engine.setText('r-s2-score', d.sR);
    engine.setImage('r-s1-logo', sideLogoUrl(state, 1, d.team1, vis));
    engine.setImage('r-s2-logo', sideLogoUrl(state, 2, d.team2, vis));

    bindRoster('r-s1', 1);
    bindRoster('r-s2', 2);

    bindGameMark(d, MARK_ROSTERS);
    bindCount(d, 'r-');
    // FINAL takes the strip alone: everything else on it describes a pitch that
    // is coming, so a count left beside the badge is the card's loudest claim
    // that the game is still going.
    setOpacity('r-count', !d.isFinal);
  }

  function bindBases(d) {
    const on = [d.r1, d.r2, d.r3];
    const names = [d.r1Name, d.r2Name, d.r3Name];
    for (let b = 1; b <= 3; b++) {
      const occupied = !d.isFinal && !!on[b - 1];
      const baseEl = engine.slots[`base-${b}`];
      const runnerEl = engine.slots[`runner-${b}`];
      if (baseEl) {
        baseEl.style.fill = occupied ? 'var(--accent)' : DOT_OFF;
        baseEl.style.stroke = occupied ? 'none' : 'var(--border)';
      }
      engine.setImage(`runner-${b}`, occupied && names[b - 1] ? charIconUrl(names[b - 1]) : '');
      const changed = occupied !== baseState[b - 1];
      if (changed && occupied && gsap && runnerEl) {
        gsap.fromTo(runnerEl, { transformOrigin: '50% 50%', scale: 0.4, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)' });
      }
      baseState[b - 1] = occupied;
    }
  }

  function bindCondensed(state, d, vis) {
    engine.setText('c-s1-name', d.p1 || 'Player One');
    engine.setText('c-s2-name', d.p2 || 'Player Two');
    engine.setText('c-s1-score', d.sL);
    engine.setText('c-s2-score', d.sR);
    engine.setImage('c-s1-logo', sideLogoUrl(state, 1, d.team1, vis));
    engine.setImage('c-s2-logo', sideLogoUrl(state, 2, d.team2, vis));
    bindGameMark(d, MARK_CONDENSED);
  }

  // Batter/pitcher game lines, read straight from state (not HUD-gated).
  function resolveLine(state, team, role) {
    const name = role === 'batting' ? g(state, `score.${SB}.batter`, '') : g(state, `score.${SB}.pitcher`, '');
    if (!name) return { icon: '', line: '' };
    let idx = role === 'batting' ? g(state, `score.${SB}.batter_roster_index`, null) : g(state, `score.${SB}.pitcher_roster_index`, null);
    if (idx == null || idx < 0) idx = window.RioData ? RioData.findCharIndex(state, SB, team, name) : -1;
    const lineKey = role === 'batting' ? 'batting_line' : 'pitching_line';
    const line = (idx != null && idx >= 0)
      ? g(state, `score.${SB}.stats.${team}.character.${idx}.current_game.${lineKey}`, '')
      : '';
    return { icon: charIconUrl(name), line: line || '' };
  }

  function bindAtBat(state, d) {
    const bat = resolveLine(state, d.batTeam, 'batting');
    const pit = resolveLine(state, d.pitTeam, 'pitching');
    engine.setImage('bat-icon', bat.icon);
    engine.setText('bat-line', bat.line || '—');
    engine.setImage('pit-icon', pit.icon);
    engine.setText('pit-line', pit.line || '—');
  }

  function bindBox(d) {
    // How many inning columns this game warrants: its configured length (so a
    // live game holds a stable width) but never fewer than have been played
    // (extra innings), capped at nine.
    const played = Math.max(d.away.length, d.home.length, 0);
    const sel = parseInt(d.inningsSelected, 10) || 0;
    const shown = Math.min(Math.max(sel, played, 1), MAX_INN);

    for (let i = 1; i <= MAX_INN; i++) {
      const col = engine.slots[`box-col-${i}`];
      const active = i <= shown;
      if (col) col.setAttribute('opacity', active ? '1' : '0');
      const a = d.away[i - 1];
      const h = d.home[i - 1];
      engine.setText(`box-away-${i}`, active ? (a != null ? a : '-') : '');
      engine.setText(`box-home-${i}`, active ? (h != null ? h : '-') : '');
    }
    engine.setText('box-away-r', d.sL);
    engine.setText('box-home-r', d.sR);

    /*
     * THE PITCH IS FIXED AND THE BLOCK MOVES — the SLIDE policy, shared with the
     * Scoreboard (layoutBox, mount-utils.js). This table is UNRULED: one
     * vertical before R and nothing else, so there is no frame for the columns
     * to fill and stretching them would make every gap in the row a function of
     * how long the game is. A five-inning card would draw an 80 pitch beside a
     * dot column and an R column still sized for 40, which is the complaint
     * this row was just fixed for, arriving by a different route.
     *
     * It replaces a first->last span that rewrote each column's `x`: that both
     * stretched the gaps AND left the dot and the R column where they were, so
     * the two ends of the table drifted out of step with its middle.
     */
    layoutBox(engine, shown, MAX_INN);
  }

  /*
   * The game's date, as the footer draws it. `date_time_end` is what a
   * completed record carries and is the honest answer once there is one; a LIVE
   * game has only a start, and falling back to it is what stops the Date band
   * from being a band that appears at the final out. Same `toLocaleDateString`
   * shape as the Scoreboard's meta pane (scoreboard-mount's bindFinal), so the
   * two elements can't print the same game's date two ways.
   */
  function gameDate(state) {
    const raw = g(state, `score.${SB}.date_time_end`, '') || g(state, `score.${SB}.date_time_start`, '');
    if (!raw) return '';
    const dt = new Date(raw);
    if (isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function bindHeader(vis) {
    const title = vis.titleText == null ? 'Project Rio' : vis.titleText;
    engine.setText('header-title', title);
    bindImageProbe(engine, () => disposed, 'logo', OverlayBase.brandingLogoUrl(), 'logo-default');
    return title;
  }

  // ── main update ─────────────────────────────────────────────────────────────
  async function update(state, settings) {
    const theme = g(settings, 'overlays.global.designPackage', null) || DEFAULT_PACKAGE;
    // The package's port palette rides along with its SVG: applyColours reads
    // it synchronously, so it has to have landed by the time this returns.
    const [themeChanged] = await Promise.all([engine.ensureTheme(theme), ensurePortPalette(theme)]);
    if (themeChanged) { revealKey = ''; laidOut = {}; baseState = [false, false, false]; cardBox = null; }
    if (disposed) return;

    if (engine.usesAppVars) OverlayBase.applyDesignSettings(SETTINGS_TYPE, NS);
    else OverlayBase.clearDesignSettings(SETTINGS_TYPE, NS);

    const p1 = g(state, `score.${SB}.player.1.rioName`, '');
    const p2 = g(state, `score.${SB}.player.2.rioName`, '');
    const hasGame = !!(p1 || p2);
    host.style.display = hasGame ? '' : 'none';
    if (!hasGame) { revealKey = ''; return; }

    const vis = readToggles(settings);
    const half = g(state, `score.${SB}.half_inning`, 'Top');
    const gameCompleted = g(state, `score.${SB}.game_completed`, false) === true;
    const sourceType = g(state, `score.${SB}.source_type`, '');
    const isFinal = half === 'Final' || gameCompleted || sourceType === 'completed_api';

    const role1 = window.RioData ? RioData.getTeamRole(state, SB, 1) : 'batting';
    const batTeam = role1 === 'batting' ? 1 : 2;
    const pitTeam = batTeam === 1 ? 2 : 1;

    // One answer to "what mode is this", for every overlay: the producer's
    // override, else the game's own mode, else the tag (rio-data.js gameMode).
    // Reading stats_tag alone was right only while the feed kept it in step, and
    // an override is exactly the case where it doesn't.
    const modeName = (window.RioData
        ? RioData.gameMode(state, SB)
        : g(settings, `scoreboards.binding.${SB}.stats_tag`, '')) || '';
    const stadium = prettyStadium(g(state, `score.${SB}.stadium`, ''));

    const d = {
      p1, p2,
      team1: g(state, `score.${SB}.player.1.logo`, '') || g(state, `score.${SB}.player.1.msb_team`, ''),
      team2: g(state, `score.${SB}.player.2.logo`, '') || g(state, `score.${SB}.player.2.msb_team`, ''),
      sL: g(state, `score.${SB}.score_left`, 0),
      sR: g(state, `score.${SB}.score_right`, 0),
      inn: g(state, `score.${SB}.inning`, ''),
      isTop: half === 'Top',
      isFinal,
      outs: parseInt(g(state, `score.${SB}.outs`, 0)) || 0,
      balls: parseInt(g(state, `score.${SB}.balls`, 0)) || 0,
      strikes: parseInt(g(state, `score.${SB}.strikes`, 0)) || 0,
      r1: g(state, `score.${SB}.cbRioRunnerOn1`, false),
      r2: g(state, `score.${SB}.cbRioRunnerOn2`, false),
      r3: g(state, `score.${SB}.cbRioRunnerOn3`, false),
      r1Name: g(state, `score.${SB}.runner1Name`, ''),
      r2Name: g(state, `score.${SB}.runner2Name`, ''),
      r3Name: g(state, `score.${SB}.runner3Name`, ''),
      away: g(state, `score.${SB}.away_linescore`, []) || [],
      home: g(state, `score.${SB}.home_linescore`, []) || [],
      inningsSelected: g(state, `score.${SB}.innings_selected`, 0),
      batTeam, pitTeam,
    };

    // Phase resolves from the assigned match (score.{N}.phase, projected from
    // the match's round label). A producer-typed phaseText overrides it; when
    // neither is set the field stays blank and the stack closes the gap.
    const matchPhase = (g(state, `score.${SB}.phase`, '') || '').trim();
    const manualPhase = (vis.phaseText || '').trim();
    vis.phaseText = manualPhase || matchPhase;

    vis.isFinal = isFinal;
    vis.hasPhase = !!vis.phaseText;
    vis.hasMode = !!modeName;

    vis.hasBox = Array.isArray(d.away) && d.away.length > 0;
    vis.footer = footerLine([vis.showStadium && stadium, vis.showDate && gameDate(state)]);

    applyColours(settings, g(state, `score.${SB}.player.1.port`, null), g(state, `score.${SB}.player.2.port`, null));

    const title = bindHeader(vis);
    engine.setText('phase', vis.phaseText || '', { optional: true });
    engine.setText('mode', modeName ? modeName.toUpperCase() : '', { optional: true });
    bindMain(state, d, vis);
    bindRosters(state, d, vis);
    bindCondensed(state, d, vis);
    bindAtBat(state, d);
    bindBox(d);
    engine.setText('stadium', vis.footer, { optional: true });

    engine.refitText();
    centerHeader(title);
    relayout(vis, themeChanged);
    // AFTER relayout: the rail's recentre rewrites the root viewBox, and so does
    // ensureCardBox's legacy-canvas reframe (which relayout is what triggers).
    // Stashing the base viewBox before that reframe would stash the wrong frame.
    applyCardRail(engine, vis.showRail);

    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
      if (!disposed) { engine.refitText(); centerHeader(title); }
    });

    const key = `${theme}|${g(state, `score.${SB}.game_id`, '')}|${p1}|${p2}`;
    if (key !== revealKey) { revealKey = key; gate.requestReveal(); }
  }

  function playReveal() {
    host.classList.remove('sc-reveal');
    void host.offsetWidth;
    host.classList.add('sc-reveal');
    // Drop the class once the rise finishes so the retained end-state transform
    // (fill-mode `both`) doesn't pin the host to a blurry GPU-scaled composited
    // layer — see reveal-gate.js.
    clearAnimClassOnEnd(host, 'sc-reveal');
  }

  // Gate playReveal behind the OBS on-screen signal: dedupe redundant activates,
  // snap dark on hide, one clean rise per show (see reveal-gate.js).
  const gate = createRevealGate({ host, offClass: 'sc-off', play: playReveal });

  function setShown(shown) { gate.setShown(shown); }

  function dispose() {
    disposed = true;
    gate.dispose();
    window.removeEventListener('resize', engine.refitText);
    host.classList.remove('sc-host', 'sc-reveal');
    host.innerHTML = '';
  }

  window.addEventListener('resize', engine.refitText);
  return { update, setShown, dispose };
}
