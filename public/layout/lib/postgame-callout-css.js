// postgame-callout-css.js — Character Spotlight scoped stylesheet.
// Split out of postgame-callout-mount.js (was a ~360-line template literal
// inline in the mount) purely to keep the orchestrator file navigable; no
// behavior change. Scoped entirely under .cs-root — see CHARACTER-SPOTLIGHT.md
// for the design rationale behind these rules.

export const REF_W = 1920, REF_H = 1080;

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
.cs-abchip .res { margin-top: 5px; display: flex; align-items: center;
  justify-content: space-between; gap: 8px; }
.cs-abchip .res .abbr { font-family: var(--mono); font-size: 31px; font-weight: 800;
  line-height: 1; color: rgba(255,255,255,0.85); white-space: nowrap; }
/* detail bits stack as right-aligned rows beside the abbreviation ("346FT"
   over "3 RBI") — the chip has vertical room to spare where a single line
   would truncate */
.cs-abchip .res .dtxt { display: flex; flex-direction: column; align-items: flex-end;
  gap: 2px; min-width: 0; font-family: var(--mono); font-size: 13px; font-weight: 700;
  letter-spacing: 0.5px; color: rgba(255,255,255,0.6); text-transform: uppercase; }
.cs-abchip .res .dtxt span { white-space: nowrap; line-height: 1.1; }
.cs-abchip.hit .dtxt, .cs-abchip.hr .dtxt { color: rgba(255,255,255,0.85); }
/* detail line beneath: contact quality fills the freed left slot — a
   dimmed NONE on contactless PAs keeps every chip's vertical rhythm */
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
.cs-abchip .ctag.none { color: rgba(255,255,255,0.3); }
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

let _cssInjected = false;
export function injectCss() {
  if (_cssInjected) return;
  const style = document.createElement('style');
  style.id = 'postgame-callout-css';
  style.textContent = CSS;
  document.head.appendChild(style);
  _cssInjected = true;
}
