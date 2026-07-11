// postgame-callout-mount.js — CHARACTER SPOTLIGHT: full-screen post-game
// per-character callout with a live hit-visualizer AB walkthrough.
//
// A fed element (Callout Stage occupant, sibling of the Game Summary): the
// producer picks one finished-game roster character on the Production page;
// this mount tells that character's whole game as a story —
//
//   · left column (flex-stacked, hero-first): identity plate (name, event /
//     bracket context, rio name · team, tags) → a merged BATTING card
//     (H-AB headline + runs/RBI/stolen/star-hit-spent + OBP/SLG) with
//     optional half-width PITCHING / DEFENSE cards beneath it → HERO ART,
//     which claims whatever vertical room the stat cards don't use (no
//     reserved gaps — pitchers get a taller hero shot than position players)
//   · the AB THEATER: an embedded RioVisualizer (three.js) viewport that
//     replays every resolved plate appearance — real recorded flight (the
//     hero crane for home runs / deep flies, the same crane at infield
//     scale for every other ball in play), result stamp (swing info,
//     distance in feet, Star Chance outcome), runner movement on a live
//     diamond, score odometers
//   · the game-state bar: a live scoreboard strip that MORPHS into a big
//     "9TH INNING · 2 OUTS" transition card that ESTABLISHES each new at-bat
//     (the theater resets under it), then morphs back — and retires into a
//     FINAL score card once the walkthrough ends
//   · an AB ticker along the bottom: chips build progressively (one per PA,
//     inning + result + swing tag + every star spent), each landing the
//     moment its result is known — when the ball lands / the play concludes
//     — so the ticker stays in lockstep with the replay
//   · finale: every flight redraws at once — the spray chart — and the stat
//     panels lock to their final totals. Plays once, holds on the spray.
//
//   const m = mountPostgameCallout({ host });
//   m.update(OverlayBase.state, { scoreboard, team, charIndex });
//   m.replay();   // re-run the whole show (e.g. OBS source made active)
//   m.dispose();
//
// Data: postgame.{N}.* (State) for the box score; GET /api/v1/postgame/abs for
// the heavy per-AB payload (trajectories never travel through State).
//
// THEME CONTRACT: same as the Game Summary (postgame-vs-mount.js) — the
// backdrop SVG comes from /design/{pkg}/callout.svg; a package may declare
// --side1/--side2/--well/--accent-neutral on the SVG root (slice26 does) and
// the mount keys every surface to them, falling back to controller-port
// colours. Requires the host page's `three` importmap (callout-stage has it).

import { ensureGsap } from './gsap-loader.js';
import { HitRenderer } from '/rio-visualizer/renderer.js';

const REF_W = 1920, REF_H = 1080;
const SETTINGS_TYPE = 'postgamecallout';
const PORT_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];
const NEUTRAL_ACCENT = '#f59e0b';

// Walkthrough pacing (seconds).
const BEAT = {
  transIn: 0.28,    // band morphs into the between-AB transition card
  transHold: 0.95,  // the big "9TH INNING · 2 OUTS" card holds (theater resets under it)
  transOut: 0.28,   // card morphs back into the scoreboard band
  situate: 0.25,    // breath between the bar reveal and the pitch firing
  stampHold: 1.45,  // result stamp + runner movement dwell before the next PA
  shortHold: 0.5,   // extra landed dwell for short balls in play
  hrStampHold: 2.2, // home runs earn a longer dwell
  noFlight: 0.8,    // dim-theater beat length for K / BB / HBP
  finaleHold: 0.9,  // pause before the spray chart fires
};

// Final-result code → ticker abbreviation / stamp text / flavor.
const RESULT_META = {
  1: { abbr: 'K',   stamp: 'STRIKEOUT',   neg: true },
  2: { abbr: 'BB',  stamp: 'WALK' },
  3: { abbr: 'HBP', stamp: 'HIT BY PITCH' },
  // Rio's contact-out subtype labels (caught / line out / foul catch) are
  // unreliable — every contact out reads simply OUT.
  4: { abbr: 'OUT', stamp: 'OUT',         neg: true },
  5: { abbr: 'OUT', stamp: 'OUT',         neg: true },
  6: { abbr: 'OUT', stamp: 'OUT',         neg: true },
  7: { abbr: '1B',  stamp: 'SINGLE',      hit: true },
  8: { abbr: '2B',  stamp: 'DOUBLE',      hit: true },
  9: { abbr: '3B',  stamp: 'TRIPLE',      hit: true },
  10: { abbr: 'HR', stamp: 'HOME RUN',    hit: true },
  11: { abbr: 'E',  stamp: 'ERROR' },
  12: { abbr: 'E',  stamp: 'CHEM ERROR' },
  13: { abbr: 'BNT', stamp: 'BUNT' },
  14: { abbr: 'SF', stamp: 'SAC FLY' },
  15: { abbr: 'DP', stamp: 'DOUBLE PLAY', neg: true },
  16: { abbr: 'OUT', stamp: 'OUT',        neg: true },
};
// Codes that do NOT count as an official at-bat (walks, HBP, sac fly).
const NON_AB_CODES = new Set([2, 3, 14]);
const ORDINALS = ['', '1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH',
  '9TH', '10TH', '11TH', '12TH', '13TH', '14TH', '15TH'];

let _cssInjected = false;

function charArtUrl(name) {
  const id = OverlayBase.charId(name);
  return id === undefined ? '' : `${OverlayBase.BASE_URL}/game_assets/msb/characters/${id}.png`;
}
function teamLogoUrl(teamName) {
  const id = OverlayBase.teamId(teamName);
  return id === undefined ? '' : `${OverlayBase.BASE_URL}/game_assets/msb/teamLogos/${id}.png`;
}

// ── styles (scoped under .cs-root) ──────────────────────────────────────────
const CSS = `
.cs-root { position: absolute; inset: 0; overflow: hidden; font-family: var(--cs-font, 'Inter', sans-serif); }
.cs-stage {
  position: absolute; top: 0; left: 0; width: ${REF_W}px; height: ${REF_H}px;
  transform-origin: top left; color: #fff;
  --s1: #c5f707; --s1-rgb: 197, 247, 7;
  --s2: #57e0e7; --s2-rgb: 87, 224, 231;
  --side: #c5f707; --side-rgb: 197, 247, 7;
  --well: rgba(255, 255, 255, 0.08);
  --accent: #f93f91; --accent-rgb: 249, 63, 145;
  --mono: 'Chivo Mono', ui-monospace, 'SF Mono', monospace;
}
.cs-backdrop { position: absolute; inset: 0; }
.cs-theme-svg, .cs-theme-svg svg { position: absolute; inset: 0; width: 100%; height: 100%; }
/* team logo — a full-frame-height BACKGROUND graphic anchoring the left
   side of the scene: over the theme backdrop, under every card, ghosted
   enough to reinforce team identity without competing with the content.
   The band is inset to the theme's 28px rainbow-border stage window and the
   clip-path cuts the logo at the border on the LEFT/top/bottom only — a
   wide logo bleeds freely to the right, living behind the frame content. */
.cs-bglogo { position: absolute; top: 28px; bottom: 28px; left: 28px; width: 684px;
  clip-path: inset(0 -400px 0 0 round 26px 0 0 26px);
  display: flex; align-items: center; justify-content: center; pointer-events: none; }
.cs-bglogo img { height: 90%; width: auto; opacity: 0.2; filter: saturate(0.9); }
.cs-vignette { position: absolute; inset: 0; box-shadow: inset 0 0 300px rgba(0,0,0,0.55); pointer-events: none; }

/* Shared glass-well surface + the moving trail-gradient rim (same vocabulary
   as the Game Summary board). */
.cs-well {
  position: absolute; box-sizing: border-box; border-radius: 18px;
  background: var(--well); border: 1.5px solid rgba(255,255,255,0.18);
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.14), 0 12px 40px rgba(0,0,0,0.4);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
}
.cs-rim::before {
  content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 2.5px;
  background: linear-gradient(90deg, var(--s1), var(--accent), var(--s2), var(--accent), var(--s1));
  background-size: 300% 100%;
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  animation: cs-rim 7s linear infinite;
  opacity: 0.85; pointer-events: none;
}
@keyframes cs-rim { to { background-position: -300% 0; } }

/* ── left column: header plate → stat cards (top) → hero art (bottom),
   flex-stacked so the hero always claims whatever room the stat cards don't
   need — no reserved gaps; a bench player's smaller card stack means a
   bigger hero shot, not empty space. ── */
.cs-leftcol {
  /* left inset mirrors the right column's 40px frame margin (theater right
     edge sits at x=1880 on the 1920 stage) */
  position: absolute; left: 40px; top: 52px; bottom: 30px; width: 650px;
  display: flex; flex-direction: column; gap: 18px; z-index: 3;
}

/* identity plate — names + event/bracket context; team identity lives in
   the full-height background logo behind the left column. Slice 26
   vocabulary: tracked uppercase text on the plate itself, no pill chips —
   statuses live as a bare right-aligned column. */
.cs-plate { position: relative; flex: 0 0 auto; box-sizing: border-box;
  padding: 18px 26px 18px 32px; border-radius: 13px;
  display: flex; align-items: center; gap: 18px;
  background: rgba(var(--side-rgb), 0.20); border: 1.5px solid rgba(255,255,255,0.18);
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.14);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.cs-plate .rail { position: absolute; top: 8px; bottom: 8px; left: 8px; width: 6px;
  border-radius: 3px; background: var(--side); transform-origin: center top; }
.cs-id { min-width: 0; flex: 1 1 auto; }
.cs-id .meta { font-size: 17px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase;
  color: rgba(var(--side-rgb), 0.95); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cs-id .char { margin-top: 4px; font-size: 56px; font-weight: 900; line-height: 1; letter-spacing: -0.5px;
  white-space: nowrap; text-shadow: 0 3px 18px rgba(0,0,0,0.55); }
.cs-id .rio { margin-top: 8px; font-size: 21px; font-weight: 700; letter-spacing: 2.5px;
  text-transform: uppercase; color: rgba(255,255,255,0.78); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.cs-id .ctx { margin-top: 7px; font-size: 14px; font-weight: 600; letter-spacing: 2px;
  text-transform: uppercase; color: rgba(255,255,255,0.55); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.cs-id .ctx b { font-weight: 800; color: rgba(255,255,255,0.75); }
/* status column — bare tracked text, right-aligned, one per line */
.cs-status { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end;
  gap: 8px; text-align: right; }
.cs-status .st { font-size: 15px; font-weight: 800; letter-spacing: 2.5px; text-transform: uppercase;
  color: rgba(255,255,255,0.7); white-space: nowrap; line-height: 1; }
.cs-status .st.win { color: var(--side); text-shadow: 0 0 14px rgba(var(--side-rgb), 0.6); }
.cs-status .st.star { color: var(--accent); text-shadow: 0 0 14px rgba(var(--accent-rgb), 0.6); }

/* stat cards — merged batting card (headline H-AB + rate stats), optional
   half-width pitching / defense row */
.cs-statzone { flex: 0 0 auto; display: flex; flex-direction: column; gap: 14px; }
.cs-box { position: relative; box-sizing: border-box; padding: 12px 18px 14px; border-radius: 16px;
  background: var(--well); border: 1.5px solid rgba(255,255,255,0.18);
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.14);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.cs-box .bt { font-size: 14px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase;
  color: rgba(var(--side-rgb), 0.95); margin-bottom: 8px; }
.cs-box .grid { display: flex; justify-content: space-around; align-items: flex-start; gap: 8px; }
.cs-stat { display: flex; flex-direction: column; align-items: center; min-width: 0; }
.cs-stat .v { font-family: var(--mono); font-variant-numeric: tabular-nums;
  font-size: 34px; font-weight: 800; line-height: 1; }
.cs-stat .l { margin-top: 5px; font-size: 11px; font-weight: 700; letter-spacing: 1px;
  color: rgba(255,255,255,0.55); text-transform: uppercase; white-space: nowrap;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.cs-stat .v .dim { color: rgba(255,255,255,0.4); }
.cs-statrow .cs-stat .v { font-size: 30px; }

.cs-batcard .top { display: flex; align-items: center; gap: 24px; }
.cs-batcard .hab { display: flex; align-items: baseline; gap: 10px; flex: 0 0 auto; }
.cs-batcard .hab .v { font-family: var(--mono); font-variant-numeric: tabular-nums;
  font-size: 76px; font-weight: 800; line-height: 0.95; color: var(--side);
  text-shadow: 0 4px 26px rgba(0,0,0,0.5); }
/* minis distribute evenly with per-stat padding instead of flex gaps, so the
   collapsed OBP/SLG placeholders occupy literally zero width — the card is
   balanced BEFORE the reveal (no reserved dead space) and rebalances itself
   as the rates animate open at the finale */
.cs-batcard .minis { flex: 1 1 auto; display: flex; justify-content: space-evenly;
  align-items: flex-start; min-width: 0; }
.cs-batcard .minis .cs-stat { padding: 0 8px; }
/* OBP/SLG stay collapsed through the AB walkthrough (their story is still
   being told); the finale animates them open — to a max-width generous
   enough that a four-digit SLG (1.000) never clips — and the other stats
   slide over as space-evenly redistributes */
.cs-batcard .minis .cs-stat.rate { max-width: 0; opacity: 0; overflow: hidden; padding: 0; }

/* pitching / defense cards share the row proportionally to how many stats
   each actually records (inline flex weights from buildDom) — a single-stat
   defense card hugs its content instead of stretching across a half-row */
.cs-statrow { display: flex; gap: 14px; }
.cs-statrow .cs-box { min-width: 0; }

/* hero art — the primary visual focus; fills whatever vertical room the
   plate + stat cards leave, scaling up naturally when they're shorter */
.cs-hero {
  position: relative; flex: 1 1 auto; min-height: 0;
  display: flex; align-items: flex-end; justify-content: center;
  filter: drop-shadow(0 24px 44px rgba(0,0,0,0.65));
}
.cs-hero img { max-width: 92%; max-height: 96%; object-fit: contain; object-position: bottom; opacity: 0.94; }
.cs-hero .bloom {
  position: absolute; bottom: 8%; width: 60%; height: 60%; border-radius: 50%;
  background: radial-gradient(circle, rgba(var(--side-rgb), 0.45) 0%, transparent 62%);
  filter: blur(22px); z-index: -1;
}

/* ── AB theater ── */
.cs-theater { left: 720px; top: 52px; width: 1160px; height: 624px; overflow: hidden; z-index: 3; }
.cs-viewport { position: absolute; inset: 2px; border-radius: 16px; overflow: hidden; }
.cs-labels { position: absolute; inset: 0; opacity: 0; pointer-events: none; overflow: hidden; }
.cs-dim { position: absolute; inset: 0; background: rgba(6,8,13,0.66); opacity: 0;
  pointer-events: none; }
/* perfect-contact flash — a localized radial flare in the theater's own
   accent colours (screen-blended, transparent at the edges) instead of a
   full-viewport white fill, so it reads as a light glint, not a dropped
   frame / broadcast glitch. */
.cs-flash { position: absolute; inset: 0; opacity: 0; pointer-events: none;
  background: radial-gradient(circle at center, rgba(var(--side-rgb), 0.55) 0%, rgba(var(--accent-rgb), 0.3) 45%, transparent 74%);
  mix-blend-mode: screen; }
/* result stamp */
.cs-stamp { position: absolute; left: 0; right: 0; top: 42%; text-align: center;
  transform: translateY(-50%); z-index: 5; pointer-events: none; opacity: 0; }
.cs-stamp .main { display: inline-block; padding: 10px 44px; border-radius: 14px;
  font-size: 86px; font-weight: 900; letter-spacing: 4px; line-height: 1.05;
  color: #fff; background: rgba(6,8,13,0.55);
  border: 3px solid var(--side); box-shadow: 0 0 60px rgba(var(--side-rgb), 0.5);
  text-shadow: 0 4px 30px rgba(0,0,0,0.7);
  -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }
.cs-stamp.neg .main { border-color: rgba(255,255,255,0.35); box-shadow: 0 0 40px rgba(0,0,0,0.5);
  color: rgba(255,255,255,0.9); }
.cs-stamp.hr .main { border-color: var(--accent); box-shadow: 0 0 80px rgba(var(--accent-rgb), 0.8); }
.cs-stamp .subs { margin-top: 14px; display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
.cs-stamp .sub { display: inline-block; padding: 6px 16px; border-radius: 7px;
  font-family: var(--mono); font-size: 24px; font-weight: 800; letter-spacing: 2px;
  background: rgba(6,8,13,0.6); border: 1.5px solid rgba(255,255,255,0.25); color: #fff; }
.cs-stamp .sub.rob { background: var(--accent); border-color: transparent;
  box-shadow: 0 0 30px rgba(var(--accent-rgb), 0.7); }
.cs-stamp .sub.perf { background: #fff; color: #0a0d16; border-color: transparent; }
.cs-stamp .sub.clutch { border-color: var(--side); color: var(--side); }
/* finale banner */
.cs-finale { position: absolute; left: 0; right: 0; bottom: 20px; text-align: center;
  z-index: 5; opacity: 0; pointer-events: none; }
.cs-finale span { display: inline-block; padding: 8px 26px; border-radius: 9px;
  background: rgba(6,8,13,0.65); border: 1.5px solid rgba(255,255,255,0.22);
  font-size: 22px; font-weight: 800; letter-spacing: 3.5px; text-transform: uppercase;
  color: rgba(255,255,255,0.9);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }

/* ── game-state bar: normal scoreboard content, a between-AB transition
   card, and an end-of-game final card share the same well — only one is
   visible at a time (opacity+scale crossfade, GPU-friendly transform/opacity
   only). ── */
.cs-situation { left: 720px; top: 700px; width: 1160px; height: 148px; z-index: 3;
  overflow: hidden; }
.cs-bar-content, .cs-transcard, .cs-finalcard {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
}
/* space-between with hard-capped children so nothing can overflow the well
   — the pitcher block used to hang off the right edge. Starts hidden: the
   first inning transition card establishes the show before any game-state
   numbers appear (the first hideTransitionCard reveals it). */
.cs-bar-content { gap: 20px; padding: 0 34px; justify-content: space-between; box-sizing: border-box;
  opacity: 0; }
.cs-transcard, .cs-finalcard { flex-direction: column; gap: 10px; opacity: 0; pointer-events: none;
  transform-origin: center; }

.cs-diamond { width: 132px; height: 132px; flex-shrink: 0; position: relative; }
.cs-diamond svg { width: 100%; height: 100%; overflow: visible; }
.cs-diamond .base { fill: rgba(255,255,255,0.14); stroke: rgba(255,255,255,0.4); stroke-width: 1.5; }
.cs-diamond .runner { fill: var(--side); filter: drop-shadow(0 0 6px rgba(var(--side-rgb), 0.9)); }
/* inning badge dead-center in the diamond — the infield is empty there
   (runner dots live on the bases), and it no longer collides with 2B */
.cs-diamond .inn { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-family: var(--mono); font-size: 15px; font-weight: 800; letter-spacing: 1px;
  color: var(--side); background: rgba(6,8,13,0.65); padding: 2px 9px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.18); white-space: nowrap; z-index: 1; }

/* count + outs — grouped, label-less, instantly readable */
.cs-cntouts { display: flex; align-items: center; gap: 14px; min-width: 110px; flex-shrink: 0; }
.cs-cntouts .cnt { font-family: var(--mono); font-variant-numeric: tabular-nums;
  font-size: 38px; font-weight: 800; line-height: 1; color: #fff; }
.cs-cntouts .sep { font-size: 22px; font-weight: 700; color: rgba(255,255,255,0.22); }
.cs-cntouts .dots { display: flex; gap: 9px; }
.cs-cntouts .dot { width: 20px; height: 20px; border-radius: 50%; background: rgba(255,255,255,0.14);
  border: 1.5px solid rgba(255,255,255,0.35); }
.cs-cntouts .dot.on { background: var(--accent); border-color: transparent;
  box-shadow: 0 0 12px rgba(var(--accent-rgb), 0.8); }

.cs-pitcher { display: flex; align-items: center; gap: 12px; flex: 0 1 200px; min-width: 0; }
.cs-pitcher .icon { width: 46px; height: 46px; border-radius: 10px; flex-shrink: 0; overflow: hidden;
  background: rgba(0,0,0,0.3); border: 1.5px solid rgba(255,255,255,0.18); display: flex;
  align-items: center; justify-content: center; }
.cs-pitcher .icon img { width: 100%; height: 100%; object-fit: contain; }
.cs-pitcher .info { min-width: 0; display: flex; flex-direction: column; }
.cs-pitcher .n { font-size: 21px; font-weight: 800; line-height: 1.1; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.cs-pitcher .l { font-size: 12px; font-weight: 700; letter-spacing: 2px; color: rgba(255,255,255,0.5);
  text-transform: uppercase; }

.cs-score { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 24px; }
.cs-score .side { display: flex; flex-direction: column; align-items: center; min-width: 120px; max-width: 210px; }
.cs-score .side .n { font-size: 17px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
.cs-score .side.s1 .n { color: var(--s1); }
.cs-score .side.s2 .n { color: var(--s2); }
.cs-score .side .r { font-family: var(--mono); font-variant-numeric: tabular-nums;
  font-size: 66px; font-weight: 800; line-height: 1; }
.cs-score .side.s1 .r { color: var(--s1); }
.cs-score .side.s2 .r { color: var(--s2); }
.cs-score .dash { font-size: 40px; font-weight: 700; color: rgba(255,255,255,0.4); }

.cs-stars { display: flex; flex-direction: column; align-items: center; gap: 8px; flex-shrink: 0;
  transition: filter 0.3s ease; }
.cs-stars.active { filter: drop-shadow(0 0 14px rgba(var(--accent-rgb), 0.85)); }
.cs-stars .row { display: flex; gap: 6px; font-size: 24px; line-height: 1; }
.cs-stars .st { color: rgba(255,255,255,0.18); }
.cs-stars .st.on { color: var(--accent); text-shadow: 0 0 12px rgba(var(--accent-rgb), 0.8); }
.cs-stars .l { font-size: 13px; font-weight: 700; letter-spacing: 2px; color: rgba(255,255,255,0.5);
  text-transform: uppercase; }
.cs-stars.active .l { color: var(--accent); }

/* between-AB transition card */
.cs-transcard .inn { font-family: var(--mono); font-size: 22px; font-weight: 800; letter-spacing: 3px;
  color: var(--side); text-transform: uppercase; }
.cs-transcard .outs { font-size: 46px; font-weight: 900; letter-spacing: 1px; color: #fff;
  text-shadow: 0 4px 20px rgba(0,0,0,0.5); }

/* end-of-game final card — a real closing frame: mirrored name / box-score
   lines flanking the big score, winner marked in text (Slice 26 vocabulary,
   no badge boxes), stadium context under the FINAL tag */
.cs-finalcard { flex-direction: row; gap: 0; padding: 0 44px; box-sizing: border-box;
  justify-content: space-between; align-items: center; }
.cs-finalcard .mid { display: flex; flex-direction: column; align-items: center; gap: 5px;
  flex: 0 0 auto; padding: 0 30px; }
.cs-finalcard .tag { font-size: 20px; font-weight: 900; letter-spacing: 7px; color: var(--accent);
  text-shadow: 0 0 20px rgba(var(--accent-rgb), 0.6); }
.cs-finalcard .ctx { font-size: 13px; font-weight: 700; letter-spacing: 2.5px;
  text-transform: uppercase; color: rgba(255,255,255,0.5); white-space: nowrap; }
.cs-finalcard .side { flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 24px; }
.cs-finalcard .side.s2 { flex-direction: row-reverse; }
.cs-finalcard .side .who { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.cs-finalcard .side.s1 .who { align-items: flex-start; text-align: left; }
.cs-finalcard .side.s2 .who { align-items: flex-end; text-align: right; }
.cs-finalcard .side .n { font-size: 26px; font-weight: 900; letter-spacing: 1.5px; text-transform: uppercase;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px; line-height: 1; }
.cs-finalcard .side.s1 .n { color: var(--s1); }
.cs-finalcard .side.s2 .n { color: var(--s2); }
.cs-finalcard .side .wtag { font-size: 13px; font-weight: 800; letter-spacing: 3px;
  text-transform: uppercase; color: var(--accent); line-height: 1;
  text-shadow: 0 0 12px rgba(var(--accent-rgb), 0.6); min-height: 13px; }
.cs-finalcard .side .bx { font-family: var(--mono); font-size: 14px; font-weight: 700;
  letter-spacing: 1.5px; color: rgba(255,255,255,0.55); text-transform: uppercase; white-space: nowrap; }
.cs-finalcard .side .r { font-family: var(--mono); font-variant-numeric: tabular-nums;
  font-size: 74px; font-weight: 800; line-height: 1; flex-shrink: 0; }
.cs-finalcard .side.s1 .r { color: var(--s1); }
.cs-finalcard .side.s2 .r { color: var(--s2); }
.cs-finalcard .side.win .r { text-shadow: 0 0 34px rgba(var(--accent-rgb), 0.55); }

/* ── AB ticker — chips build progressively as the replay reaches each PA;
   full prominence the moment they appear, no dimmed "waiting" state ── */
.cs-ticker { position: absolute; left: 720px; top: 878px; width: 1160px; height: 118px;
  display: flex; align-items: stretch; gap: 14px; z-index: 3; }
/* each chip lands at its FINAL width (--chipw is sized up-front from the
   total PA count) — the row grows rightward; already-shown chips never
   resize */
.cs-abchip { position: relative; box-sizing: border-box; flex: 0 0 var(--chipw, 215px); min-width: 0;
  padding: 12px 18px 13px; border-radius: 14px; text-align: left;
  display: flex; flex-direction: column; justify-content: center;
  background: var(--well); border: 1.5px solid rgba(255,255,255,0.14);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); overflow: hidden; }
.cs-abchip .top { display: flex; justify-content: space-between; gap: 8px;
  font-size: 14px; font-weight: 700; letter-spacing: 1.4px;
  color: rgba(255,255,255,0.55); text-transform: uppercase; white-space: nowrap; }
/* result row: big abbreviation left, the play detail (TO LF / ON 0-2 /
   168FT · 1 RBI) right-anchored beside it at its usual small size */
.cs-abchip .res { margin-top: 5px; display: flex; align-items: baseline;
  justify-content: space-between; gap: 10px; }
.cs-abchip .res .abbr { font-family: var(--mono); font-size: 31px; font-weight: 800;
  line-height: 1; color: rgba(255,255,255,0.85); white-space: nowrap; }
.cs-abchip .res .dtxt { font-family: var(--mono); font-size: 14.5px; font-weight: 700;
  letter-spacing: 1px; color: rgba(255,255,255,0.6); text-transform: uppercase;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; text-align: right; }
.cs-abchip.hit .dtxt, .cs-abchip.hr .dtxt { color: rgba(255,255,255,0.85); }
/* detail line beneath: contact quality fills the freed left slot; the row
   only exists when there was contact — no reserved space on a strikeout */
.cs-abchip .det { margin-top: 6px; display: flex; align-items: baseline; }
.cs-abchip .info { margin-top: 5px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cs-abchip .swingtag { font-family: var(--mono); font-size: 11.5px; font-weight: 800; letter-spacing: 1.2px;
  color: rgba(255,255,255,0.75); white-space: nowrap; border-left: 3px solid rgba(255,255,255,0.35);
  padding-left: 6px; line-height: 1.1; }
/* contact quality — owns the detail line's left slot: Perfect is the
   marquee tier, Nice reads brighter than Sour */
.cs-abchip .ctag { flex: 0 0 auto; font-family: var(--mono); font-size: 13px; font-weight: 800;
  letter-spacing: 1.4px; white-space: nowrap; color: rgba(255,255,255,0.55); }
.cs-abchip .ctag.nice { color: rgba(255,255,255,0.8); }
.cs-abchip .ctag.perf { color: var(--side); }
.cs-abchip .starsused { font-size: 13px; letter-spacing: 2px; line-height: 1; color: var(--accent);
  text-shadow: 0 0 8px rgba(var(--accent-rgb), 0.7); }
.cs-abchip.hit { background: rgba(var(--side-rgb), 0.22); border-color: rgba(var(--side-rgb), 0.7); }
.cs-abchip.hit .res .abbr { color: var(--side); }
.cs-abchip.hr { background: rgba(var(--accent-rgb), 0.24); border-color: var(--accent);
  box-shadow: 0 0 24px rgba(var(--accent-rgb), 0.45); }
.cs-abchip.hr .res .abbr { color: #fff; }
.cs-abchip.live { border-color: transparent; }
.cs-abchip.live::before {
  content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 2.5px;
  background: linear-gradient(90deg, var(--s1), var(--accent), var(--s2), var(--accent), var(--s1));
  background-size: 300% 100%;
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  animation: cs-rim 3.5s linear infinite; pointer-events: none;
}
`;

function injectCss() {
  if (_cssInjected) return;
  const style = document.createElement('style');
  style.id = 'postgame-callout-css';
  style.textContent = CSS;
  document.head.appendChild(style);
  _cssInjected = true;
}

// Same last-resort backdrop contract as before (public/design/README.md).
function builtinThemeSvg() {
  return `
  <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="csA" cx="14%" cy="24%" r="80%">
        <stop offset="0" style="stop-color:var(--port-color);stop-opacity:0.36"/>
        <stop offset="0.62" style="stop-color:var(--port-color);stop-opacity:0"/>
      </radialGradient>
      <radialGradient id="csB" cx="86%" cy="82%" r="80%">
        <stop offset="0" style="stop-color:var(--port-2);stop-opacity:0.28"/>
        <stop offset="0.62" style="stop-color:var(--port-2);stop-opacity:0"/>
      </radialGradient>
    </defs>
    <rect width="1920" height="1080" fill="#0b0d14"/>
    <rect width="1920" height="1080" fill="url(#csA)"/>
    <rect width="1920" height="1080" fill="url(#csB)"/>
    <rect x="0" y="0" width="1920" height="10" style="fill:var(--port-color)" opacity="0.9"/>
    <rect x="0" y="1070" width="1920" height="10" style="fill:var(--port-2)" opacity="0.7"/>
  </svg>`;
}

// Diamond base centers in the 132×132 svg space, by base index (0 home … 3rd),
// plus 4 = home again (a scored runner returns there before flying off).
const BASE_XY = { 0: [66, 118], 1: [118, 66], 2: [66, 14], 3: [14, 66], 4: [66, 118] };

function fmt3(n) { return (Number(n) || 0).toFixed(3).replace(/^0\./, '.'); }

// One-line result detail for a ticker chip: distance / RBI / star swing for
// balls that mattered, the fielder it went to for plain outs, the count a
// strikeout ended on. All distances render in feet (recorded data is metric).
function chipDetail(ab) {
  const meta = RESULT_META[ab.resultCode] || {};
  const bits = [];
  if (ab.contact && meta.hit) bits.push(`${Math.round(ab.contact.distance * 3.28084)}ft`);
  if (ab.rbi) bits.push(`${ab.rbi} RBI`);
  if (ab.swing === 'Star') bits.push('★ SWING');
  if (!bits.length && ab.fielder && ab.fielder.position) bits.push(`TO ${ab.fielder.position}`);
  if (!bits.length && ab.resultCode === 1) bits.push(`ON ${ab.before.balls}-${ab.before.strikes}`);
  return bits.slice(0, 2).join(' · ');
}

// Compact swing-type tag shared by the AB chips and the hit-summary stamp:
// Charge swings show their meter % — undercharged as a plain fraction, full
// as "100%", overcharged as "+N%" over the top (the meter's over-hold
// amount, i.e. chargePct - 100).
function swingTag(ab) {
  const type = (ab.swingInfo && ab.swingInfo.type) || ab.swing;
  if (!type || type === 'None') return '';
  if (type === 'Charge') {
    const pct = ab.swingInfo ? ab.swingInfo.chargePct : null;
    if (pct == null) return 'CHARGE';
    if (pct < 100) return `CHARGE ${pct}%`;
    if (pct === 100) return 'CHARGE 100%';
    return `CHARGE +${pct - 100}%`;
  }
  if (type === 'Slap') return 'SLAP';
  if (type === 'Star') return 'STAR';
  return String(type).toUpperCase();
}

// One AB chip's markup — built once (all data is known up front) but only
// inserted into the ticker DOM when the walkthrough reaches that PA (see
// playAb / chipSnapAll), so the ticker builds progressively instead of
// pre-rendering everything dimmed.
function chipMarkup(ab, i) {
  const meta = RESULT_META[ab.resultCode] || { abbr: '?' };
  // Rio's "Result of AB" reads plain "Out" for a fielder's choice (batter
  // safe, a different runner forced out) same as any contact out — the
  // server derives the distinction from the runner blocks and flags it
  // additively (fieldersChoice) rather than a separate resultCode.
  const abbr = ab.fieldersChoice ? 'FC' : meta.abbr;
  const tag = swingTag(ab);
  // contact quality gives every ball in play its context — it owns the
  // detail line's left slot (the play detail moved up beside the result);
  // same three-tier vocabulary as the stamp. No contact (K/BB/HBP) = the
  // row simply doesn't render; no space is reserved for it.
  const quality = contactQuality(ab);
  const starsBits = ab.starsUsed > 0 ? '★'.repeat(Math.min(ab.starsUsed, 6)) : '';
  const info = (tag || starsBits) ? `<div class="info">
      ${tag ? `<span class="swingtag">${escapeHtml(tag)}</span>` : ''}
      ${starsBits ? `<span class="starsused">${starsBits}</span>` : ''}
    </div>` : '';
  return `<div class="cs-abchip" id="cs-ab-${i}">
    <div class="top">
      <span>${ab.halfInning ? '▼' : '▲'}${ORDINALS[ab.inning] || ab.inning}</span>
      <span>${ab.before.outs} OUT</span>
    </div>
    <div class="res">
      <span class="abbr">${abbr}</span>
      <span class="dtxt">${escapeHtml(chipDetail(ab))}</span>
    </div>
    ${quality ? `<div class="det"><span class="ctag ${quality[0]}">${quality[1]}</span></div>` : ''}
    ${info}
  </div>`;
}

// Contact quality from the recorded contact-type name. The stat files label
// it inconsistently across games — "Nice - Left", "Right Nice", "Perfect" —
// so match the keyword anywhere rather than a fixed prefix.
function contactQuality(ab) {
  const ctype = String((ab.contact && ab.contact.typeName) || '');
  if (/perfect/i.test(ctype)) return ['perf', 'PERFECT'];
  if (/nice/i.test(ctype)) return ['nice', 'NICE'];
  if (/sour/i.test(ctype)) return ['', 'SOUR'];
  return null;
}

export function mountPostgameCallout({ host }) {
  injectCss();

  const root = document.createElement('div');
  root.className = 'cs-root';
  const stage = document.createElement('div');
  stage.className = 'cs-stage';
  root.appendChild(stage);
  host.appendChild(root);
  root.style.display = 'none';

  let prevKey = '';
  let themeCache = {};
  let renderer = null;       // HitRenderer, created with the theater DOM
  let loadedStadium = null;
  let runSeq = 0;            // cancels an in-flight walkthrough
  let beatTl = null;         // the currently-running GSAP timeline
  let showCtx = null;        // cached data for replay()

  function autoScale() {
    if (OverlayBase.PREVIEW_MODE) { stage.style.transform = `scale(${Math.min(host.clientWidth / REF_W, host.clientHeight / REF_H) || 1})`; return; }
    const scale = Math.min(window.innerWidth / REF_W, window.innerHeight / REF_H) || 1;
    stage.style.transform = `scale(${scale})`;
  }
  window.addEventListener('resize', autoScale);
  autoScale();

  function portColor(port) {
    const { deepGet: g, settings } = OverlayBase;
    const idx = Number.isInteger(port) ? port : -1;
    const override = idx >= 0 ? g(settings, `overlays.${SETTINGS_TYPE}.port${idx}Color`, null) : null;
    if (override) return override;
    if (idx >= 0 && idx < PORT_COLORS.length) return PORT_COLORS[idx];
    return g(settings, 'overlays.global.accentColor', NEUTRAL_ACCENT);
  }

  async function fetchThemeSvg(pkg) {
    const r = await fetch(`${OverlayBase.BASE_URL}/design/${encodeURIComponent(pkg)}/callout.svg`);
    return r.ok ? await r.text() : null;
  }
  async function loadTheme(pkg) {
    if (themeCache[pkg] != null) return themeCache[pkg];
    let svg = null;
    try {
      svg = await fetchThemeSvg(pkg);
      if (svg == null && pkg !== 'default') svg = await fetchThemeSvg('default');
    } catch { svg = null; }
    themeCache[pkg] = svg != null ? svg : builtinThemeSvg();
    return themeCache[pkg];
  }

  // Theme-declared side palette (slice26) with port-colour fallback; --side is
  // the spotlighted character's own side colour.
  function resolvePalette(ctx) {
    const svgEl = stage.querySelector('.cs-theme-svg svg');
    const read = (name) => svgEl ? (getComputedStyle(svgEl).getPropertyValue(name) || '').trim() : '';
    const s1 = read('--side1') || portColor(ctx.port1);
    const s2 = read('--side2') || portColor(ctx.port2);
    const well = read('--well');
    const accent = read('--accent-neutral')
      || OverlayBase.deepGet(OverlayBase.settings, 'overlays.global.accentColor', null)
      || '#f93f91';
    const side = ctx.side === 1 ? s1 : s2;
    const set = (k, v, fb) => { stage.style.setProperty(k, v); stage.style.setProperty(`${k}-rgb`, hexToRgbStr(v, fb)); };
    set('--s1', s1, '197, 247, 7');
    set('--s2', s2, '87, 224, 231');
    set('--side', side, ctx.side === 1 ? '197, 247, 7' : '87, 224, 231');
    set('--accent', accent, '249, 63, 145');
    if (well) stage.style.setProperty('--well', well);
    stage.style.setProperty('--port-color', s1);
    stage.style.setProperty('--port-2', s2);
  }

  // ── DOM builders ──────────────────────────────────────────────────────────

  // A stat that starts at 0 and counts up during the walkthrough (batting).
  function statHtml(id, label, value) {
    return `<div class="cs-stat"><span class="v" id="${id}" data-final="${value}">0</span><span class="l">${label}</span></div>`;
  }
  // A stat rendered at its final value from the first frame (pitching /
  // defense — their story isn't told play-by-play, so they don't count up).
  function statNowHtml(label, value) {
    return `<div class="cs-stat"><span class="v">${escapeHtml(String(value))}</span><span class="l">${escapeHtml(label)}</span></div>`;
  }
  // Half-width card whose share of the row is proportional to how many stats
  // it actually records — a lone single-stat card hugs its content instead of
  // stretching across the row.
  function halfBoxHtml(id, title, entries) {
    if (!entries.length) return '';
    const maxW = entries.length * 150 + 60;
    return `
      <div class="cs-box" id="${id}" style="flex:${entries.length} 1 0; max-width:${maxW}px">
        <div class="bt">${title}</div>
        <div class="grid">${entries.map(([label, v]) => statNowHtml(label, v)).join('')}</div>
      </div>`;
  }

  function buildDom(ctx) {
    const { char, sideData } = ctx;
    const b = char.batting || {};
    const p = char.pitching;
    const d = char.defense || {};
    const logo = sideData.teamName ? teamLogoUrl(sideData.teamName) : '';

    // header context: event name up top; bracket · phase · round beneath the
    // player identity (round emphasized). Empty pieces simply don't render.
    const metaLine = ctx.event ? `<div class="meta">${escapeHtml(ctx.event)}</div>` : '';
    const ctxBits = [];
    if (ctx.bracket) ctxBits.push(escapeHtml(ctx.bracket));
    if (ctx.phase) ctxBits.push(escapeHtml(ctx.phase));
    if (ctx.round) ctxBits.push(`<b>${escapeHtml(ctx.round)}</b>`);
    const ctxLine = ctxBits.length ? `<div class="ctx">${ctxBits.join(' · ')}</div>` : '';
    const statusCol = (sideData.isWinner || char.isStarred || char.isCaptain) ? `
      <div class="cs-status">
        ${sideData.isWinner ? '<span class="st win">Winner</span>' : ''}
        ${char.isStarred ? '<span class="st star">★ Superstar</span>' : ''}
        ${char.isCaptain ? '<span class="st">Captain</span>' : ''}
      </div>` : '';

    // pitching / defense populate at their final numbers from the first
    // frame — the walkthrough narrates the batting story, not these
    const pitchEntries = p ? [
      ['IP', p.ip ?? '0.0'],
      ['ER', p.earned_runs ?? 0],
      ['K', p.strikeouts_pitched ?? 0],
      ['H', p.hits_allowed ?? 0],
      ...(Number(p.star_pitches) > 0 ? [['★ Pitch', p.star_pitches]] : []),
    ] : [];

    // defense: only categories the player actually recorded — a bench of
    // zeros renders nothing and the hero takes the room instead. Outs are
    // broken out by the position they were recorded at (e.g. "Outs · SS").
    const opp = d.outs_per_position || {};
    const outsEntries = Object.entries(opp)
      .filter(([, n]) => Number(n) > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([pos, n]) => [`Outs · ${pos}`, n]);
    if (!outsEntries.length && Number(d.outs_at_position) > 0) {
      outsEntries.push(['Outs Made', d.outs_at_position]);
    }
    const defEntries = [];
    if (Number(d.big_plays) > 0) defEntries.push(['Big Plays', d.big_plays]);
    defEntries.push(...outsEntries);
    if (Number(d.sliding_catches) > 0) defEntries.push(['Sliding Catch', d.sliding_catches]);
    if (Number(d.wall_jumps) > 0) defEntries.push(['Wall Jumps', d.wall_jumps]);

    const pitchBox = halfBoxHtml('cs-box-pitch', 'Pitching', pitchEntries);
    const defBox = halfBoxHtml('cs-box-def', 'Defense', defEntries);
    const statRow = (pitchBox || defBox) ? `<div class="cs-statrow">${[pitchBox, defBox].filter(Boolean).join('')}</div>` : '';
    const stolenMini = Number(b.stolen_bases) > 0 ? statHtml('cs-sb', 'Stolen', b.stolen_bases) : '';
    // OBP/SLG carry class "rate": collapsed until the AB walkthrough finishes,
    // then the finale animates them open (see revealRates).
    const rateStat = (label, v) =>
      `<div class="cs-stat rate"><span class="v">${fmt3(v)}</span><span class="l">${label}</span></div>`;
    const starsRow = Array.from({ length: 5 }, (_, i) => `<span class="st" data-i="${i}">★</span>`).join('');

    // AB chips land at their final width, splitting the full ticker between
    // this player's ACTUAL plate appearances (a four-PA game gets four wider
    // chips, not four chips plus a phantom fifth slot); sized once so the
    // ticker grows rightward without ever reflowing earlier chips
    const nAbs = Math.max((ctx.abs || []).length, 1);
    const chipW = Math.max(96, Math.min(300, Math.floor((1160 - 14 * (nAbs - 1)) / nAbs)));
    stage.style.setProperty('--chipw', `${chipW}px`);

    stage.innerHTML = `
      <div class="cs-backdrop">
        <div class="cs-theme-svg">${ctx.themeSvg}</div>
        ${logo ? `<div class="cs-bglogo"><img src="${logo}" onerror="this.parentNode.style.display='none'" alt="" /></div>` : ''}
        <div class="cs-vignette"></div>
      </div>
      <div class="cs-leftcol">
        <div class="cs-plate">
          <div class="rail"></div>
          <div class="cs-id">
            ${metaLine}
            <div class="char">${escapeHtml(char.name || '')}</div>
            <div class="rio">${escapeHtml(sideData.rioName || '')}${sideData.teamName ? ' · ' + escapeHtml(sideData.teamName) : ''}</div>
            ${ctxLine}
          </div>
          ${statusCol}
        </div>
        <div class="cs-statzone">
          <div class="cs-box cs-batcard" id="cs-box-bat">
            <div class="bt">Batting</div>
            <div class="top">
              <div class="hab"><span class="v" id="cs-hab">0-0</span></div>
              <div class="minis">
                ${statHtml('cs-runs', 'Runs', b.runs ?? 0)}
                ${statHtml('cs-rbi', 'RBI', b.rbi ?? 0)}
                ${stolenMini}
                <div class="cs-stat"><span class="v"><span id="cs-sh">0</span><span class="dim">/</span><span id="cs-ss">0</span></span><span class="l">★ Hit / Spent</span></div>
                ${rateStat('OBP', b.obp)}
                ${rateStat('SLG', b.slg)}
              </div>
            </div>
          </div>
          ${statRow}
        </div>
        <div class="cs-hero">
          <div class="bloom"></div>
          <img src="${charArtUrl(char.name)}" onerror="this.style.opacity=0" alt="" />
        </div>
      </div>
      <div class="cs-well cs-rim cs-theater" id="cs-theater">
        <div class="cs-viewport" id="cs-viewport"></div>
        <div class="cs-labels" id="cs-labels"></div>
        <div class="cs-dim" id="cs-dim"></div>
        <div class="cs-flash" id="cs-flash"></div>
        <div class="cs-stamp" id="cs-stamp"></div>
        <div class="cs-finale" id="cs-finalebanner"><span>Spray Chart · ${escapeHtml(char.name || '')}</span></div>
      </div>
      <div class="cs-well cs-rim cs-situation" id="cs-situation">
        <div class="cs-bar-content" id="cs-barcontent">
          <div class="cs-diamond">
            <div class="inn" id="cs-diamond-inn"></div>
            <svg viewBox="0 0 132 132">
              <path d="M66 122 L122 66 L66 10 L10 66 Z" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
              <rect class="base" id="cs-base-1" x="108" y="56" width="20" height="20" transform="rotate(45 118 66)"/>
              <rect class="base" id="cs-base-2" x="56" y="4"  width="20" height="20" transform="rotate(45 66 14)"/>
              <rect class="base" id="cs-base-3" x="4"  y="56" width="20" height="20" transform="rotate(45 14 66)"/>
              <rect class="base" x="56" y="108" width="20" height="20" transform="rotate(45 66 118)" style="fill:rgba(255,255,255,0.06)"/>
              <g id="cs-runners"></g>
            </svg>
          </div>
          <div class="cs-cntouts">
            <span class="cnt" id="cs-count">0-0</span>
            <span class="sep">•</span>
            <div class="dots" id="cs-outdots"><span class="dot"></span><span class="dot"></span></div>
          </div>
          <div class="cs-score">
            <div class="side s1"><span class="n">${escapeHtml(ctx.p1?.rioName || '')}</span><span class="r" id="cs-r1">0</span></div>
            <span class="dash">—</span>
            <div class="side s2"><span class="n">${escapeHtml(ctx.p2?.rioName || '')}</span><span class="r" id="cs-r2">0</span></div>
          </div>
          <div class="cs-stars" id="cs-stars">
            <div class="row" id="cs-starrow">${starsRow}</div>
            <span class="l">Stars</span>
          </div>
          <div class="cs-pitcher">
            <div class="icon" id="cs-pitcher-icon"></div>
            <div class="info"><span class="n" id="cs-pitcher">—</span><span class="l">Pitching</span></div>
          </div>
        </div>
        <div class="cs-transcard" id="cs-transcard">
          <span class="inn" id="cs-trans-inn"></span>
          <span class="outs" id="cs-trans-outs"></span>
        </div>
        <div class="cs-finalcard" id="cs-finalcard">
          <div class="side s1" id="cs-final-s1">
            <div class="who"><span class="wtag"></span><span class="n"></span><span class="bx"></span></div>
            <span class="r"></span>
          </div>
          <div class="mid">
            <span class="tag">FINAL</span>
            <span class="ctx" id="cs-final-ctx"></span>
          </div>
          <div class="side s2" id="cs-final-s2">
            <div class="who"><span class="wtag"></span><span class="n"></span><span class="bx"></span></div>
            <span class="r"></span>
          </div>
        </div>
      </div>
      <div class="cs-ticker" id="cs-ticker"></div>`;
    resolvePalette(ctx);

    const font = OverlayBase.deepGet(OverlayBase.settings, 'overlays.global.fontFamily', 'Inter');
    root.style.setProperty('--cs-font', `'${font}', sans-serif`);
  }

  // ── theater / renderer plumbing ──────────────────────────────────────────

  function ensureRenderer() {
    const viewport = stage.querySelector('#cs-viewport');
    const labels = stage.querySelector('#cs-labels');
    if (renderer) { try { renderer.dispose(); } catch { /* ignore */ } }
    renderer = new HitRenderer({ viewport, labels, orbit: false, cinematic: true, fixedCam: true, viewMode: 'stream' });
    loadedStadium = null;
  }

  async function loadStadium(name) {
    if (!name || name === loadedStadium || !renderer) return;
    try {
      const resp = await fetch(`${OverlayBase.BASE_URL}/api/v1/visualizer/stadium/${encodeURIComponent(name)}`);
      if (!resp.ok) { console.warn('[charspotlight] stadium fetch failed', name, resp.status); return; }
      const json = await resp.json();
      // fixedCam mode locks the broadcast framing as part of setStadium, so
      // the field is on-camera from the first frame.
      if (renderer) { renderer.setStadium(name, json); loadedStadium = name; }
    } catch (e) {
      console.warn('[charspotlight] stadium fetch error', e.message);
    }
  }

  // Landing-marker semantics for the renderer: red X for outs (incl. a sac
  // fly's caught ball), circle for anything that landed safe (hits, errors,
  // bunts); home runs get the celebratory gradient-crawl trail.
  const OUT_CODES = new Set([4, 5, 6, 14, 15, 16]);
  const HR_CODE = 10;
  // "Deep fly" hero-camera threshold: chosen so a routine can-of-corn fly out
  // stays on the follow cam while anything that had real distance or hang
  // time — long outs, doubles/triples off the wall, not just home runs —
  // earns the hero treatment. 85m carry (~279ft) or a 30m apex (~98ft) both
  // qualify; either is well beyond a lazy fly ball in this game's field
  // scale.
  const DEEP_FLY_DISTANCE_M = 85;
  const DEEP_FLY_HEIGHT_M = 30;
  function isDeepFly(ab) {
    if (!ab.contact) return false;
    return (Number(ab.contact.distance) || 0) >= DEEP_FLY_DISTANCE_M
      || (Number(ab.contact.maxHeight) || 0) >= DEEP_FLY_HEIGHT_M;
  }
  function cameraFor(ab) {
    // home runs / deep flies get the full hero crane; EVERY other ball in
    // play gets the same crane at infield scale ('gentle') — the camera
    // always travels onto the field with the play. The pan-only follow cam
    // is never used here: mid-range hits on it read as "just a rotate from
    // behind home" against the hero treatment.
    return (ab.resultCode === HR_CODE || isDeepFly(ab)) ? 'hero' : 'gentle';
  }
  const abPath = (ab) => ({
    points: ab.contact.path,
    final: ab.contact.landing,
    out: OUT_CODES.has(ab.resultCode),
    hr: ab.resultCode === HR_CODE,
    star: ab.swing === 'Star',
  });

  // Fill the end-of-game FINAL card: names, box-score lines (from the
  // side-level totals), winner text-mark, stadium context.
  function fillFinalCard(ctx) {
    const q = (s) => stage.querySelector(s);
    const bxLine = (t) => {
      if (!t) return '';
      const bits = [`${t.hits ?? 0} H`, `${t.homeruns ?? 0} HR`];
      if (Number(t.stars_won) > 0) bits.push(`${t.stars_won} ★`);
      return bits.join(' · ');
    };
    const p1Score = ctx.p1?.score ?? 0, p2Score = ctx.p2?.score ?? 0;
    for (const [sel, p, score, won] of [
      ['#cs-final-s1', ctx.p1, p1Score, p1Score > p2Score],
      ['#cs-final-s2', ctx.p2, p2Score, p2Score > p1Score],
    ]) {
      const el = q(sel);
      el.querySelector('.n').textContent = p?.rioName || '';
      el.querySelector('.r').textContent = score;
      el.querySelector('.bx').textContent = bxLine(p?.totals);
      el.querySelector('.wtag').textContent = won ? 'Winner' : '';
      el.classList.toggle('win', won);
    }
    q('#cs-final-ctx').textContent = ctx.stadium || '';
  }

  // ── situation panel ───────────────────────────────────────────────────────

  function setSituation(ab, ctx) {
    const q = (s) => stage.querySelector(s);
    const half = ab.halfInning ? '▼' : '▲';
    const ord = ORDINALS[ab.inning] || ab.inning;
    q('#cs-diamond-inn').textContent = `${half} ${ord}`;
    q('#cs-count').textContent = `${ab.before.balls}-${ab.before.strikes}`;
    const icon = q('#cs-pitcher-icon');
    icon.innerHTML = ab.pitcher ? OverlayBase.charImg(ab.pitcher, 'picon', 48) : '';
    q('#cs-pitcher').textContent = ab.pitcher || '—';
    q('#cs-r1').textContent = ab.before.score['1'] ?? 0;
    q('#cs-r2').textContent = ab.before.score['2'] ?? 0;
    const dots = q('#cs-outdots').children;
    for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i < ab.before.outs);
    // our side's star stock
    const stars = Number(ab.before.stars[String(ctx.side)]) || 0;
    stage.querySelectorAll('#cs-starrow .st').forEach((el, i) => el.classList.toggle('on', i < stars));
    q('#cs-stars').classList.toggle('active', !!ab.before.starChance);
    // runner dots at their starting bases (batter's dot appears on movement)
    const g = q('#cs-runners');
    g.innerHTML = '';
    for (const r of ab.runners) {
      if (r.base === 0) continue;
      const [x, y] = BASE_XY[r.base] || [66, 66];
      g.insertAdjacentHTML('beforeend',
        `<circle class="runner" data-base="${r.base}" cx="${x}" cy="${y}" r="9"></circle>`);
    }
  }

  // Animate the play's runner movements + after-state (returns the timeline).
  function animateResolution(gsap, ab, ctx) {
    const q = (s) => stage.querySelector(s);
    const t = gsap.timeline();
    const g = q('#cs-runners');

    for (const r of ab.runners) {
      let dot = r.base === 0 ? null : g.querySelector(`.runner[data-base="${r.base}"]`);
      if (!dot && !r.out && r.resultBase != null && r.resultBase !== r.base) {
        // batter becomes a runner
        const [x, y] = BASE_XY[0];
        g.insertAdjacentHTML('beforeend', `<circle class="runner" data-base="0" cx="${x}" cy="${y}" r="9"></circle>`);
        dot = g.lastElementChild;
      }
      if (!dot) continue;
      if (r.out) {
        t.to(dot, { attr: { r: 12 }, fill: '#ff4d5e', opacity: 0, duration: 0.45, ease: 'power2.in' }, 0);
        continue;
      }
      const from = r.base, to = r.resultBase;
      if (to == null || to === from) continue;
      // walk base to base so the dot travels the diamond, not through it
      let pos = 0.05;
      for (let b = from + 1; b <= Math.min(to, 4); b++) {
        const [x, y] = BASE_XY[b];
        t.to(dot, { attr: { cx: x, cy: y }, duration: 0.2, ease: 'power1.inOut' }, pos);
        pos += 0.2;
      }
      if (r.scored) {
        t.to(dot, { attr: { r: 14 }, opacity: 0, duration: 0.4, ease: 'power2.out' }, pos);
      }
    }
    // outs dots + score odometers land with the movement
    t.add(() => {
      const dots = q('#cs-outdots').children;
      for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i < Math.min(ab.after.outs, 2));
      q('#cs-r1').textContent = ab.after.score['1'] ?? 0;
      q('#cs-r2').textContent = ab.after.score['2'] ?? 0;
    }, 0.35);
    const scored = (Number(ab.after.score[String(ctx.side)]) || 0) - (Number(ab.before.score[String(ctx.side)]) || 0);
    if (scored > 0) {
      const el = ctx.side === 1 ? q('#cs-r1') : q('#cs-r2');
      t.fromTo(el, { scale: 1.5, transformOrigin: 'center' }, { scale: 1, duration: 0.5, ease: 'back.out(2)' }, 0.35);
    }
    return t;
  }

  // ── between-AB transition + end-of-game final card ───────────────────────

  // Morphs the live bar into a big centered "9TH INNING · 2 OUTS" card —
  // makes each new plate appearance easy to follow instead of numbers just
  // ticking over mid-frame.
  function showTransitionCard(gsap, ab) {
    const q = (s) => stage.querySelector(s);
    const bar = q('#cs-barcontent'), card = q('#cs-transcard');
    const half = ab.halfInning ? '▼ BOTTOM' : '▲ TOP';
    q('#cs-trans-inn').textContent = `${half} ${ORDINALS[ab.inning] || ab.inning}`;
    q('#cs-trans-outs').textContent = `${ab.before.outs} OUT${ab.before.outs === 1 ? '' : 'S'}`;
    const t = gsap.timeline();
    t.to(bar, { autoAlpha: 0, scale: 0.94, duration: BEAT.transIn, ease: 'power2.in' }, 0);
    t.fromTo(card, { autoAlpha: 0, scale: 0.82 }, { autoAlpha: 1, scale: 1, duration: BEAT.transIn, ease: 'back.out(1.7)' }, 0.04);
    return t;
  }

  function hideTransitionCard(gsap) {
    const q = (s) => stage.querySelector(s);
    const bar = q('#cs-barcontent'), card = q('#cs-transcard');
    const t = gsap.timeline();
    t.to(card, { autoAlpha: 0, scale: 0.86, duration: BEAT.transOut, ease: 'power2.in' }, 0);
    t.fromTo(bar, { autoAlpha: 0, scale: 0.94 }, { autoAlpha: 1, scale: 1, duration: BEAT.transOut, ease: 'power2.out' }, 0.04);
    return t;
  }

  // ── stamps & odometers ────────────────────────────────────────────────────

  function bumpStat(gsap, t, id, delta = 1, pos = 0) {
    const el = stage.querySelector(id);
    if (!el || !delta) return;
    t.add(() => { el.textContent = String((parseInt(el.textContent, 10) || 0) + delta); }, pos);
    t.fromTo(el, { scale: 1.45, transformOrigin: 'center', color: '#fff' },
      { scale: 1, clearProps: 'color', duration: 0.45, ease: 'back.out(2)' }, pos);
  }

  function setHab(gsap, t, hits, abs, pos = 0) {
    const el = stage.querySelector('#cs-hab');
    if (!el) return;
    t.add(() => { el.textContent = `${hits}-${abs}`; }, pos);
    t.fromTo(el, { scale: 1.12, transformOrigin: 'left center' },
      { scale: 1, duration: 0.4, ease: 'power2.out' }, pos);
  }

  function stampFor(ab, ctx) {
    const meta = RESULT_META[ab.resultCode] || { stamp: String(ab.result || '').toUpperCase() };
    // Same additive distinction as chipMarkup — the landing marker / camera
    // keep the OUT treatment (OUT_CODES still keys off resultCode, which
    // stays 4: a force out really was recorded on the play), only the stamp
    // text changes so the batter reaching base doesn't read as a strict out.
    const stampMain = ab.fieldersChoice ? "FIELDER'S CHOICE" : meta.stamp;
    const subs = [];
    const f = ab.fielder || {};
    if (meta.neg && f.action === 'Walljump') subs.push(['rob', 'WALL JUMP · ' + (f.character || '').toUpperCase()]);
    else if (meta.neg && f.action === 'Sliding') subs.push(['rob', 'SLIDING CATCH · ' + (f.character || '').toUpperCase()]);
    if (f.bobble && f.bobble !== 'None') subs.push(['', 'BOBBLE']);
    // contact quality reads on every ball in play, one vocabulary: Perfect
    // keeps its white marquee chip, Nice/Sour take the standard chip (the
    // recorded names carry a side word — "Nice - Left" / "Right Nice",
    // format varies by game — that says nothing on broadcast, so only the
    // quality keyword survives; see contactQuality)
    const quality = contactQuality(ab);
    if (quality) subs.push([quality[0] === 'perf' ? 'perf' : '', `${quality[1]} CONTACT`]);
    if (ab.contact && meta.hit) subs.push(['', `${Math.round(ab.contact.distance * 3.28084)}ft`]);
    if (ab.swing === 'Star') {
      subs.push(['rob', ab.contact && ab.contact.fiveStar ? '5★ STAR SWING' : 'STAR SWING']);
    } else {
      const tag = swingTag(ab);
      if (tag) subs.push(['', tag]);
    }
    if (ab.starChanceOutcome) {
      subs.push([ab.starChanceOutcome === 'won' ? 'clutch' : '', `STAR CHANCE ${ab.starChanceOutcome.toUpperCase()}`]);
    }
    // clutch heat: runs scored on the play / lead change
    const s = String(ctx.side), o = String(3 - ctx.side);
    const before = (ab.before.score[s] || 0) - (ab.before.score[o] || 0);
    const after = (ab.after.score[s] || 0) - (ab.after.score[o] || 0);
    const scored = (ab.after.score[s] || 0) - (ab.before.score[s] || 0);
    if (scored > 0) {
      const label = before <= 0 && after > 0 ? `GO-AHEAD · +${scored}` : `+${scored} RUN${scored > 1 ? 'S' : ''}`;
      subs.push(['clutch', label]);
    }
    return { main: stampMain, neg: !!meta.neg, hr: ab.resultCode === HR_CODE, subs };
  }

  function showStamp(gsap, stamp) {
    const el = stage.querySelector('#cs-stamp');
    el.className = `cs-stamp${stamp.neg ? ' neg' : ''}${stamp.hr ? ' hr' : ''}`;
    el.innerHTML = `<div class="main">${escapeHtml(stamp.main)}</div>
      ${stamp.subs.length ? `<div class="subs">${stamp.subs.map(([cls, txt]) =>
        `<span class="sub ${cls}">${escapeHtml(txt)}</span>`).join('')}</div>` : ''}`;
    const t = gsap.timeline();
    t.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.12 }, 0);
    t.fromTo(el.querySelector('.main'), { scale: 1.7 }, { scale: 1, duration: 0.38, ease: 'power3.out' }, 0);
    const subs = el.querySelectorAll('.sub');
    if (subs.length) t.fromTo(subs, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, stagger: 0.07 }, 0.22);
    return t;
  }

  function hideStamp(gsap) {
    const el = stage.querySelector('#cs-stamp');
    return gsap.to(el, { opacity: 0, duration: 0.25 });
  }

  // ── the show ──────────────────────────────────────────────────────────────

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  function killBeat() { if (beatTl) { try { beatTl.kill(); } catch { /* ignore */ } beatTl = null; } }

  function introTimeline(gsap, ctx) {
    const q = (s) => stage.querySelector(s);
    const qa = (s) => stage.querySelectorAll(s);
    const t = gsap.timeline({ defaults: { ease: 'power3.out' } });
    const fromSide = ctx.side === 1 ? 'inset(0% 0% 0% 100%)' : 'inset(0% 100% 0% 0%)';
    t.fromTo(q('.cs-backdrop'), { clipPath: fromSide }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.65, ease: 'power4.inOut' });
    t.fromTo(q('.cs-plate'), { x: -60, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.5 }, '-=0.3');
    t.fromTo(q('.cs-plate .rail'), { scaleY: 0 }, { scaleY: 1, duration: 0.4 }, '<+=0.1');
    qa('.cs-statzone .cs-box').forEach((box, i) => {
      t.fromTo(box, { y: 28, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.42 }, i === 0 ? '-=0.2' : '<+=0.09');
    });
    t.fromTo(q('.cs-hero'), { y: 40, autoAlpha: 0, scale: 1.04 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.7, ease: 'power2.out' }, '-=0.25');
    t.fromTo(q('.cs-theater'), { scaleX: 0.001, autoAlpha: 0, transformOrigin: ctx.side === 1 ? 'left center' : 'right center' },
      { scaleX: 1, autoAlpha: 1, duration: 0.6, ease: 'power4.out' }, '-=0.5');
    t.fromTo(q('.cs-situation'), { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45 }, '-=0.3');
    return t;
  }

  // Lock every panel to its final box-score numbers (finale + snap fallback).
  function lockFinals(gsap) {
    const b = showCtx?.char?.batting || {};
    const habEl = stage.querySelector('#cs-hab');
    if (habEl) habEl.textContent = `${b.hits ?? 0}-${b.at_bats ?? 0}`;
    stage.querySelectorAll('[data-final]').forEach((el) => {
      const v = Number(el.getAttribute('data-final')) || 0;
      const fmt = el.getAttribute('data-fmt');
      const render = (x) => { el.textContent = fmt === 'f2' ? x.toFixed(2) : String(Math.round(x)); };
      if (!gsap) { render(v); return; }
      const cur = parseFloat(el.textContent) || 0;
      if (cur === v) return;
      const proxy = { v: cur };
      gsap.to(proxy, { v, duration: 0.7, ease: 'power1.out', onUpdate: () => render(proxy.v) });
    });
    const sh = stage.querySelector('#cs-sh'), ss = stage.querySelector('#cs-ss');
    if (sh) sh.textContent = String(b.star_hits ?? 0);
    if (ss) ss.textContent = String(b.star_swings ?? 0);
  }

  // OBP/SLG stay collapsed through the walkthrough (rates are a finished-
  // story stat); the finale animates them open and the neighboring stats
  // slide over to make room instead of popping.
  function revealRates(gsap) {
    const rates = stage.querySelectorAll('.cs-batcard .rate');
    if (!rates.length) return;
    if (!gsap) {
      rates.forEach((el) => { el.style.maxWidth = 'none'; el.style.opacity = '1'; el.style.padding = '0 8px'; });
      return;
    }
    // max-width 130 leaves room for a four-digit SLG (1.000) at full size;
    // the padding animates in with it so the spacing matches the other minis
    gsap.to(rates, { maxWidth: 130, opacity: 1, paddingLeft: 8, paddingRight: 8, duration: 0.65, ease: 'power2.inOut', stagger: 0.12 });
  }

  async function playAb(gsap, ab, i, ctx, my) {
    const alive = () => runSeq === my;
    const q = (s) => stage.querySelector(s);
    const meta = RESULT_META[ab.resultCode] || {};

    // the previous chip's rainbow emphasis retires the moment the next
    // at-bat begins — only the current AB ever carries the live ring
    stage.querySelectorAll('.cs-abchip.live').forEach((el) => el.classList.remove('live'));
    // the inning transition card establishes the new at-bat FIRST — the bar
    // morphs into it and the situation updates underneath while hidden. The
    // theater empties now and the camera GLIDES back to the broadcast pose
    // (clearHit's animated return), so the reset reads as part of the replay
    // sequence rather than a technical snap.
    beatTl = showTransitionCard(gsap, ab);
    if (renderer) renderer.clearHit({ animate: true });
    // a lingering strikeout dim also lifts under the card when a flight is coming
    if (ab.contact) gsap.to(q('#cs-dim'), { opacity: 0, duration: 0.35 });
    await sleep((BEAT.transIn + BEAT.transHold) * 1000);
    if (!alive()) return;
    setSituation(ab, ctx);
    beatTl = hideTransitionCard(gsap);
    await sleep((BEAT.transOut + BEAT.situate) * 1000);
    if (!alive()) return;

    let flightMs = 0;
    if (ab.contact && Array.isArray(ab.contact.path) && ab.contact.path.length && renderer) {
      // the flight — exact recorded arc, plays once; home runs and deep
      // flies get the hero cam (contact hold + crane), everything else the
      // follow cam
      gsap.to(q('#cs-dim'), { opacity: 0, duration: 0.2 });
      renderer.setHit({ paths: [abPath(ab)], random_points: [], fielders: [] },
        { camera: cameraFor(ab), batterHand: ctx.char.battingHand });
      flightMs = (ab.contact.path.length / 60) * 1000 + 150;
      if (ab.starsUsed > 0) {
        // every star the PA consumed visibly spends from the meter
        const lit = stage.querySelectorAll('#cs-starrow .st.on');
        for (let s = 0; s < Math.min(ab.starsUsed, lit.length); s++) {
          const el = lit[lit.length - 1 - s];
          gsap.to(el, { scale: 2.2, opacity: 0, transformOrigin: 'center', duration: 0.6, delay: s * 0.12, ease: 'power2.out', onComplete: () => { el.classList.remove('on'); el.style.cssText = ''; } });
        }
      }
      if (/perfect/i.test(String(ab.contact.typeName || ''))) {
        gsap.fromTo(q('#cs-flash'), { opacity: 0.85, scale: 0.85 }, { opacity: 0, scale: 1.25, duration: 0.55, ease: 'power2.out' });
      }
      await sleep(flightMs);
      if (!alive()) return;
    } else {
      // no ball in flight (K / BB / HBP) — the theater was cleared under the
      // transition card; dim it for the stamp
      gsap.to(q('#cs-dim'), { opacity: 1, duration: 0.3 });
      await sleep(BEAT.noFlight * 1000);
      if (!alive()) return;
    }

    // the result is now known — the AB chip lands in the ticker with it
    // (synchronized with the ball landing / the play concluding)
    q('#cs-ticker').insertAdjacentHTML('beforeend', chipMarkup(ab, i));
    const chip = q(`#cs-ab-${i}`);
    if (chip) {
      if (meta.hit) chip.classList.add('hit');
      if (ab.resultCode === HR_CODE) chip.classList.add('hr');
      chip.classList.add('live');
      gsap.fromTo(chip, { opacity: 0, y: 18, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: 'power2.out' });
    }

    // result stamp + runner movement + stats build
    beatTl = gsap.timeline();
    beatTl.add(showStamp(gsap, stampFor(ab, ctx)), 0);
    beatTl.add(animateResolution(gsap, ab, ctx), 0.15);
    if (!NON_AB_CODES.has(ab.resultCode) && ab.resultCode !== 13) ctx.runAb += 1;
    if (meta.hit) ctx.runHits += 1;
    setHab(gsap, beatTl, ctx.runHits, ctx.runAb, 0.2);
    if (ab.rbi) bumpStat(gsap, beatTl, '#cs-rbi', ab.rbi, 0.25);
    // a home run is the one PA where the batter's own run scores in-frame;
    // runs scored as a baserunner true up with lockFinals at the finale
    if (ab.resultCode === HR_CODE) bumpStat(gsap, beatTl, '#cs-runs', 1, 0.3);
    // whole-PA star accounting: ★ Spent moves by the cost-weighted total the
    // server derived (foul star swings and captain-eligible 2★ costs
    // included) so the card always agrees with the chip
    if (ab.starsUsed > 0) bumpStat(gsap, beatTl, '#cs-ss', ab.starsUsed, 0.2);
    if (ab.swing === 'Star' && meta.hit) bumpStat(gsap, beatTl, '#cs-sh', 1, 0.25);
    // shorter balls in play settle with a longer landed pause — the gentle
    // camera + extra beat keeps rapid-fire ground-ball PAs followable. The
    // renderer knows when it used the gentle shot and recommends the dwell.
    const recMs = (flightMs > 0 && renderer && typeof renderer.recommendedHoldMs === 'function')
      ? renderer.recommendedHoldMs() : null;
    const hold = ab.resultCode === HR_CODE ? BEAT.hrStampHold
      : recMs != null ? recMs / 1000
      : BEAT.stampHold + (flightMs > 0 && !isDeepFly(ab) ? BEAT.shortHold : 0);
    await sleep(hold * 1000);
    if (!alive()) return;
    hideStamp(gsap);
  }

  async function finale(gsap, ctx, my) {
    const alive = () => runSeq === my;
    const q = (s) => stage.querySelector(s);
    await sleep(BEAT.finaleHold * 1000);
    if (!alive()) return;

    stage.querySelectorAll('.cs-abchip.live').forEach((el) => el.classList.remove('live'));
    gsap.to(q('#cs-dim'), { opacity: 0, duration: 0.3 });
    q('#cs-runners').innerHTML = '';

    // the bar retires into a FINAL-score presentation — winner emphasized,
    // per-side box-score lines — instead of lingering as a stale in-game
    // scoreboard
    fillFinalCard(ctx);

    const bar = q('#cs-barcontent'), finalCard = q('#cs-finalcard');
    const t0 = gsap.timeline();
    t0.to(bar, { autoAlpha: 0, scale: 0.94, duration: 0.35, ease: 'power2.in' }, 0);
    t0.fromTo(finalCard, { autoAlpha: 0, scale: 0.85 }, { autoAlpha: 1, scale: 1, duration: 0.55, ease: 'back.out(1.5)' }, 0.15);

    // the spray chart: every recorded flight fires at once and holds
    const paths = ctx.abs.filter((a) => a.contact && a.contact.path?.length).map(abPath);
    if (paths.length && renderer) {
      renderer.setHit({ paths, random_points: [], fielders: [] }, { spray: true, batterHand: ctx.char.battingHand });
      gsap.fromTo(q('#cs-finalebanner'), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, delay: 0.4 });
    }
    lockFinals(gsap); // batting counters true up; H-AB locks to the box score
    revealRates(gsap); // OBP/SLG open up; neighbors animate over to make room
    gsap.fromTo(q('#cs-box-bat .hab .v'), { scale: 1.15, transformOrigin: 'left center' }, { scale: 1, duration: 0.6, ease: 'back.out(1.6)' });
  }

  async function startShow(ctx) {
    const my = ++runSeq;
    killBeat();
    const gsap = await ensureGsap();
    if (runSeq !== my) return;

    if (!gsap) {
      // no-GSAP fallback: everything snaps to its final state, spray +
      // FINAL card included
      lockFinals(null);
      revealRates(null);
      chipSnapAll(ctx);
      const q = (s) => stage.querySelector(s);
      fillFinalCard(ctx);
      q('#cs-barcontent').style.opacity = '0';
      q('#cs-finalcard').style.opacity = '1';
      if (renderer) {
        await loadStadium(ctx.stadium);
        const paths = ctx.abs.filter((a) => a.contact && a.contact.path?.length).map(abPath);
        if (paths.length && runSeq === my) renderer.setHit({ paths, random_points: [], fielders: [] }, { spray: true, batterHand: ctx.char.battingHand });
      }
      return;
    }

    ctx.runHits = 0;
    ctx.runAb = 0;
    const stadiumReady = loadStadium(ctx.stadium); // fetch while the intro plays
    beatTl = introTimeline(gsap, ctx);
    await sleep(beatTl.duration() * 1000 - 300);
    if (runSeq !== my) return;
    await stadiumReady;
    if (runSeq !== my) return;

    for (let i = 0; i < ctx.abs.length; i++) {
      // chips insert themselves (result-styled) inside playAb, the moment
      // each result lands; the newest stays "live" until the next one does
      await playAb(gsap, ctx.abs[i], i, ctx, my);
      if (runSeq !== my) return;
    }
    await finale(gsap, ctx, my);
  }

  function chipSnapAll(ctx) {
    const ticker = stage.querySelector('#cs-ticker');
    if (!ticker) return;
    ticker.innerHTML = ctx.abs.map((ab, i) => chipMarkup(ab, i)).join('');
    ctx.abs.forEach((ab, i) => {
      const chip = stage.querySelector(`#cs-ab-${i}`);
      const meta = RESULT_META[ab.resultCode] || {};
      if (!chip) return;
      if (meta.hit) chip.classList.add('hit');
      if (ab.resultCode === HR_CODE) chip.classList.add('hr');
    });
  }

  // ── element contract ──────────────────────────────────────────────────────

  // sel = { scoreboard, team, charIndex }
  async function update(state, sel) {
    const g = OverlayBase.deepGet;
    const sb = Number(sel?.scoreboard) || 1;
    const team = Number(sel?.team) || 1;
    const ci = Number(sel?.charIndex);

    const present = g(state, `postgame.${sb}.present`, false);
    const sideData = g(state, `postgame.${sb}.player.${team}`, null);
    const char = sideData && Array.isArray(sideData.characters) ? sideData.characters[ci] : null;

    if (!present || !sideData || !char || sel?.charIndex == null) {
      root.style.display = 'none';
      runSeq++;
      killBeat();
      prevKey = '';
      return;
    }

    const capturedAt = g(state, `postgame.${sb}.capturedAt`, '');
    const key = `${sb}:${team}:${ci}:${capturedAt}`;
    // No churn on unrelated ticks — including ones that land while the abs
    // fetch below is still in flight (the hide path resets prevKey, so a
    // re-show after hiding always rebuilds).
    if (key === prevKey) return;
    prevKey = key;

    // heavy per-AB payload (trajectories) comes over REST, not State
    let absPayload = null;
    try {
      const r = await fetch(`${OverlayBase.BASE_URL}/api/v1/postgame/abs?scoreboard=${sb}&team=${team}&char_index=${ci}`);
      if (r.ok) absPayload = await r.json();
    } catch { absPayload = null; }
    if (prevKey !== key) return; // superseded while fetching
    const abs = (absPayload && absPayload.success && Array.isArray(absPayload.abs)) ? absPayload.abs : [];

    // Prefer the REST payload's stat blocks — after a server restart the abs
    // endpoint rebuilds its cache from the stat file (fresh schema), while the
    // State projection can predate fields like batting.runs.
    const fresh = (absPayload && absPayload.success && absPayload.character) || null;
    const mergedChar = fresh && fresh.batting ? {
      ...char,
      batting: fresh.batting,
      pitching: fresh.pitching ?? char.pitching,
      defense: fresh.defense || char.defense,
    } : char;

    // Player-header context, most→least general: Event = the tournament name;
    // Bracket = the start.gg event within it (e.g. "Stars Off"); Phase = the
    // free-text Competition Phase field; Round = this scoreboard's bound-match
    // round label (e.g. "Winners Semifinal"). Empty pieces don't render.
    const event = g(state, 'tournamentInfo.name', '') || '';
    const bracket = g(state, 'tournamentInfo.event_name', '') || '';
    const phase = g(state, 'tournamentInfo.phase', '') || '';
    const round = g(state, `score.${sb}.phase`, '') || '';

    const ctx = {
      side: team,
      sb,
      char: mergedChar,
      sideData,
      event,
      bracket,
      phase,
      round,
      p1: g(state, `postgame.${sb}.player.1`, null),
      p2: g(state, `postgame.${sb}.player.2`, null),
      meta: g(state, `postgame.${sb}.meta`, {}),
      stadium: (absPayload && absPayload.stadium) || g(state, `postgame.${sb}.meta.stadium`, ''),
      abs,
      port1: Number.isInteger(g(state, `score.${sb}.player.1.port`, null)) ? g(state, `score.${sb}.player.1.port`, null) : null,
      port2: Number.isInteger(g(state, `score.${sb}.player.2.port`, null)) ? g(state, `score.${sb}.player.2.port`, null) : null,
      themeSvg: builtinThemeSvg(),
    };

    const themePkg = g(OverlayBase.settings, 'overlays.global.designPackage', null) || 'default';
    ctx.themeSvg = await loadTheme(themePkg);
    if (prevKey !== key) return;

    root.style.display = '';
    buildDom(ctx);
    autoScale();
    ensureRenderer();
    showCtx = ctx;
    startShow(ctx);
  }

  function replay() {
    if (root.style.display === 'none' || !showCtx) return;
    // rebuild the DOM so odometers/chips reset, then run the whole show again
    buildDom(showCtx);
    ensureRenderer();
    startShow(showCtx);
  }

  function dispose() {
    window.removeEventListener('resize', autoScale);
    runSeq++;
    killBeat();
    if (renderer) { try { renderer.dispose(); } catch { /* ignore */ } renderer = null; }
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return { update, dispose, replay };
}

// ── small helpers ───────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function hexToRgbStr(hex, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
