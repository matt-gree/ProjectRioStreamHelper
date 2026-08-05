// postgame-callout-css.js — Character Spotlight scoped stylesheet.
// Split out of postgame-callout-mount.js (was a ~360-line template literal
// inline in the mount) purely to keep the orchestrator file navigable; no
// behavior change. Scoped entirely under .cs-root — see CHARACTER-SPOTLIGHT.md
// for the design rationale behind these rules.
//
// NO backdrop-filter. Every card here used to carry `blur(6px)`, and it cost
// real frames for an effect nobody could see: the wells are ~80% opaque black,
// so there is almost no backdrop left to blur. The price is not the blur, it is
// that a backdrop-filter element forces the compositor to read back everything
// painted beneath it — and it re-reads on every frame that anything under or
// over it moves, which for this scene is the entire GSAP walkthrough, times a
// full row of AB chips. The wells carry their own alpha instead. Same applies
// to the Game Summary (postgame-vs-mount.js).

export const REF_W = 1920, REF_H = 1080;

const CSS = `
.cs-root { position: absolute; inset: 0; overflow: hidden; font-family: var(--cs-font, 'Inter', sans-serif); }
.cs-stage {
  position: absolute; top: 0; left: 0; width: ${REF_W}px; height: ${REF_H}px;
  transform-origin: top left; color: var(--ink);
  --s1: #e53935; --s1-rgb: 229, 57, 53;
  --s2: #1e88e5; --s2-rgb: 30, 136, 229;
  --side: #e53935; --side-rgb: 229, 57, 53;
  /* Fallback well, for a package that declares no - -well. Opaque enough to
     stand on its own now that nothing blurs the backdrop behind it. */
  --well: rgba(13, 13, 21, 0.82);
  --accent: #ff3d4e; --accent-rgb: 255, 61, 78;
  --mono: 'Chivo Mono', ui-monospace, 'SF Mono', monospace;
  /* Neutral vocabulary — the Rio night/fog scale (lib/rio-theme/tokens.css),
     NOT white. Shared, name for name, with the Game Summary
     (postgame-vs-mount.js) so the two callouts read as one package. White
     chrome between two saturated side colours is what made these scenes read
     as a flag; the only saturated things here are the two players and the
     Rio-red accent. */
  --ink: #f5f5f8;                        /* fog-100 — headline numerals/names */
  --ink-2: #c9c9d6;                      /* fog-300 — secondary values */
  --ink-3: #8f8fa3;                      /* fog-500 — labels, captions */
  --ink-4: #5a5a70;                      /* dimmed — empty pips, zeroed stats */
  --edge: rgba(143, 143, 163, 0.26);     /* card border */
  --edge-soft: rgba(143, 143, 163, 0.14);/* hairline dividers */
  --sheen: rgba(201, 201, 214, 0.10);    /* inner top highlight */
  --slab: rgba(31, 31, 48, 0.62);        /* inset chips + tracks */
  --scrim: rgba(6, 8, 13, 0.78);         /* stamp / badge backing over the 3D */
}
.cs-backdrop { position: absolute; inset: 0; }
.cs-theme-svg, .cs-theme-svg svg { position: absolute; inset: 0; width: 100%; height: 100%; }
/* team logo — a big BACKGROUND graphic behind the left column: over the
   theme backdrop, under every card, ghosted enough to reinforce team
   identity without competing with the content.

   WHOLE AND HARD-EDGED. This used to be a full-frame-height band with
   clip-path: inset(0 -400px 0 0 ...) cutting it at a 28px frame border, on
   the theory that a wide logo could bleed off to the right. What that
   actually produced was a logo sliced flat down its left side — a visible
   straight cut through the mark, which reads as a rendering bug, not as a
   design. It is now a fixed square box positioned wholly inside the 1920x1080
   stage, so there is no geometry to cut and no clip-path at all. Same
   resolution the Game Summary reached (postgame-vs-mount.js .pv-logo).

   AND NO FEATHER. Do not reach for mask-image to soften the edges either —
   a radial fade on a team mark looks like a smudge. If the logo is in the
   wrong place, move the box; don't dissolve the logo. The blur(1px) below is
   a hair of optical softening on the whole image, not an edge treatment.

   SITTING HIGH IS DELIBERATE. Centred on the column the logo ended up exactly
   concentric with the hero art, which turned it into a halo round the
   character rather than a backdrop behind them. Anchored high, its lower half
   falls behind the character's shoulders and its upper half fills the gap
   between the stat cards and the art — the one part of this column that was
   genuinely empty. */
.cs-bglogo { position: absolute; left: 40px; top: 210px; width: 560px; height: 560px;
  display: flex; align-items: center; justify-content: center; pointer-events: none; }
/* the brightness lift is not a stylistic flourish. Team marks are mostly dark
   artwork, and a dark mark ghosted over a dark backdrop reads as a STAIN on
   the frame rather than as a watermark — it looks like something went wrong in
   the render. Lifting it above the backdrop's own luminance is what makes it
   read as deliberate. Desaturating at the same time keeps it from becoming a
   second colour arguing with the port colour that owns this scene. */
.cs-bglogo img { width: 100%; height: 100%; object-fit: contain;
  opacity: 0.17; filter: blur(1px) saturate(0.65) brightness(1.4); }
/* vignette — lighter than it was (was 300px / 0.55). The backdrop now carries
   the spotlighted player's port colour in its corners and down both edges, and
   a heavy inset shadow was smothering exactly the region that colour lives in. */
.cs-vignette { position: absolute; inset: 0; box-shadow: inset 0 0 220px rgba(0,0,0,0.4); pointer-events: none; }

/* Shared glass-well surface (same vocabulary as the Game Summary board).
   The animated trail-gradient rim these cards used to carry is GONE, here and
   in postgame-vs-mount.js: a permanently crawling s1-accent-s2 border ran on
   every card for the whole show, competing with the walkthrough it framed —
   the one thing on screen that is supposed to hold attention. The .cs-rim
   class is kept as a hook (theater + game-state bar still carry it) so
   a package can give the framed surfaces their own edge treatment; by default
   it just brightens the border a step over a plain well. */
.cs-well {
  position: absolute; box-sizing: border-box; border-radius: 18px;
  background: var(--well); border: 1.5px solid var(--edge);
  box-shadow: inset 0 2px 0 var(--sheen), 0 12px 40px rgba(0,0,0,0.4);
}
.cs-rim { border-color: rgba(143, 143, 163, 0.4); }

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
   the big ghosted background logo behind the left column, never as a line of
   text on the plate. Slice 26 vocabulary: tracked uppercase text on the plate
   itself, no pill chips — statuses live as a bare right-aligned column, and
   that column is WINNER / CAPTAIN only (see the mount's statusCol). */
/* PORT COLOUR DOMINATES THE CALLOUT, and this plate is where that is decided —
   it is the one card carrying the player's identity, so it is the one card that
   should be unmistakably in their colour rather than a neutral well with a tint
   on one corner. Was: a 0.26 wash dying by 78% behind a grey border and a
   floating 6px pip. Now the colour runs half the card, the border is the
   player's, and the rail is a full-height spine welded to the card's left edge.
   The rest of the scene stays neutral so this reads as THE player's card. */
.cs-plate { position: relative; flex: 0 0 auto; box-sizing: border-box;
  padding: 18px 26px 18px 34px; border-radius: 13px; overflow: hidden;
  display: flex; align-items: center; gap: 18px;
  /* the colour is CONCENTRATED AT THE RAIL END rather than spread across the
     card. Same peak, but it lands and falls away inside the first third, so
     the text sits on dark glass and the card still reads unmistakably as the
     player's. Spread evenly (0.2 out to 42%) it put mid-saturation ground
     under every line of the smallest type in the frame. */
  background: linear-gradient(100deg,
    rgba(var(--side-rgb), 0.55) 0%, rgba(var(--side-rgb), 0.16) 34%, var(--well) 70%);
  border: 1.5px solid rgba(var(--side-rgb), 0.55);
  box-shadow: inset 0 2px 0 var(--sheen), 0 0 44px rgba(var(--side-rgb), 0.22); }
.cs-plate .rail { position: absolute; top: 0; bottom: 0; left: 0; width: 10px;
  background: var(--side); transform-origin: center top;
  box-shadow: 0 0 22px rgba(var(--side-rgb), 0.75); }
.cs-id { min-width: 0; flex: 1 1 auto; }
/* CONTRAST NOTE FOR EVERY LINE BELOW. When this plate was a neutral well with a
   0.26 tint on one corner, the secondary lines could be side-coloured or sat at
   --ink-3 and still read. They cannot now: the card is the player's colour at
   0.5, so side-coloured type is colour-on-colour and --ink-3 (fog-500) is a mid
   grey on a mid-saturation ground. Every line here moved up the fog scale by
   one step, and the event line stopped being side-coloured entirely. If you
   strengthen the plate background again, walk these up with it — the plate is
   the first thing a viewer reads and it is the smallest type in the frame. */
.cs-id .meta { font-size: 17px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase;
  color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  text-shadow: 0 1px 6px rgba(0,0,0,0.5); }
/* the two identity lines are SIZED IN JS (fitPlateText in the mount), not by
   these font-sizes alone — the values here are the design maximum and the
   fitter only ever steps down from them. The char line carried nowrap with no
   overflow rule at all, so a long name ran straight out of the card; the rio
   line ellipsed, which is a bad thing to do to a person's name. The
   overflow/ellipsis below is the backstop for when the fitter hits its floor,
   not the primary mechanism. The team name is gone from the rio line
   entirely — team identity is the big ghosted logo behind this column. */
/* THE padding-bottom IS NOT SPACING, IT IS DESCENDER ROOM. This line pairs
   line-height: 1 (a display line, set tight on purpose) with overflow: hidden
   (the ellipsis backstop for the fitter) — and at line-height 1 the line box is
   exactly the font-size tall, so anything below the baseline falls outside it
   and gets clipped. "Magikoopa(B)" lost the bottom of its p and its parens.
   overflow-x alone is not an option: a non-visible value on one axis forces the
   other to auto, which would make this a scroll container. So the box carries
   its own descent, in em so the fitter's font-size steps carry it too. */
.cs-id .char { margin-top: 4px; font-size: 56px; font-weight: 900; line-height: 1; letter-spacing: -0.5px;
  padding-bottom: 0.17em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  text-shadow: 0 3px 18px rgba(0,0,0,0.55); }
.cs-id .rio { margin-top: 3px; font-size: 21px; font-weight: 700; letter-spacing: 2.5px;
  text-transform: uppercase; color: var(--ink); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 6px rgba(0,0,0,0.5); }
.cs-id .ctx { margin-top: 7px; font-size: 14px; font-weight: 700; letter-spacing: 2px;
  text-transform: uppercase; color: var(--ink-2); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 6px rgba(0,0,0,0.5); }
.cs-id .ctx b { font-weight: 800; color: var(--ink); }
/* status column — bare tracked text, right-aligned, one per line */
.cs-status { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end;
  gap: 8px; text-align: right; }
.cs-status .st { font-size: 15px; font-weight: 800; letter-spacing: 2.5px; text-transform: uppercase;
  color: var(--ink-2); white-space: nowrap; line-height: 1;
  text-shadow: 0 1px 6px rgba(0,0,0,0.5); }
/* WINNER is the exception that proves the note above: it is the one line that
   is allowed to be a colour, and on a side-coloured plate the side colour is
   the one colour it cannot be. It takes the Rio accent instead. */
.cs-status .st.win { color: var(--accent); text-shadow: 0 0 14px rgba(var(--accent-rgb), 0.6); }

/* stat cards — merged batting card (headline H-AB + rate stats), optional
   half-width pitching / defense row */
.cs-statzone { flex: 0 0 auto; display: flex; flex-direction: column; gap: 14px; }
.cs-box { position: relative; box-sizing: border-box; padding: 12px 18px 14px; border-radius: 16px;
  background: var(--well); border: 1.5px solid var(--edge);
  box-shadow: inset 0 2px 0 var(--sheen); }
.cs-box .bt { font-size: 14px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase;
  color: rgba(var(--side-rgb), 0.95); margin-bottom: 8px; }
.cs-box .grid { display: flex; justify-content: space-around; align-items: flex-start; gap: 8px; }
.cs-stat { display: flex; flex-direction: column; align-items: center; min-width: 0; }
.cs-stat .v { font-family: var(--mono); font-variant-numeric: tabular-nums;
  font-size: 34px; font-weight: 800; line-height: 1; }
.cs-stat .l { margin-top: 5px; font-size: 11px; font-weight: 700; letter-spacing: 1px;
  color: var(--ink-3); text-transform: uppercase; white-space: nowrap;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.cs-stat .v .dim { color: var(--ink-4); }
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
/* fills its slot — the 92%/96% caps this used to carry meant the hero could
   never actually use the room the flex column gave it, so a short stat stack
   (a bench player, or a game with no start.gg event to print in the plate)
   opened a dead gap above the art instead of a bigger character. */
/* ...and the scale is not decoration either. The MSB character renders carry a
   lot of transparent margin, so an image fitted to the box leaves the actual
   character occupying about half of it. Growing about the BOTTOM CENTRE keeps
   the feet planted on the ground glow while the head climbs into the room the
   caps used to waste. .cs-hero is not overflow-hidden so nothing crops, and
   GSAP animates .cs-hero (the container), never this img.

   1.08 IS A CLEARANCE NUMBER, NOT A TASTE ONE. A square-ish render fitted to
   the 650px column is 650x600; the column is centred at x=365 and the AB
   theater starts at x=720, so the scaled half-width has to stay under 355.
   1.08 lands it at 350 (x 15..715). 1.18 — which is what filling the box
   vertically would need — puts it at 383 and drives the art both off the left
   of the stage and under the theater. Re-check this if the column ever
   changes width. */
.cs-hero img { max-width: 100%; max-height: 100%; object-fit: contain; object-position: bottom;
  opacity: 0.94; transform: scale(1.08); transform-origin: bottom center; }
/* GROUND GLOW, not a halo. This was a 60%x60% circle sitting centred on the
   character — which put a saturated disc right on top of the team logo behind
   it, the two of them fighting over the same square of frame. A wide, shallow
   pool at the character's feet reads as the same stadium light the backdrop's
   floor pool is made of, stands the character on something, and leaves the
   logo's own area clear. */
/* left / bottom / width / height here are only the FALLBACK. alignHeroGlow in
   the mount overrides all four from the character art's actual opaque bounding
   box — the renders are not centred in their own PNGs, so a box-centred glow
   lands off to one side and at a different spot for every character. These
   values are what you get if the art hasn't loaded or the canvas read fails. */
.cs-hero .bloom {
  position: absolute; left: 50%; bottom: -3%; transform: translateX(-50%);
  width: 84%; height: 22%; border-radius: 50%;
  /* the pale core matters MORE now than it used to. The backdrop behind this
     scene is the spotlighted player's own colour end to end, so a glow made
     purely of that colour has nothing to be brighter than and simply
     disappears. The light is what reads; the side colour is what tints it. */
  background: radial-gradient(ellipse at center,
    rgba(232, 236, 255, 0.3) 0%, rgba(var(--side-rgb), 0.62) 30%,
    rgba(var(--side-rgb), 0.2) 60%, transparent 78%);
  filter: blur(24px); z-index: -1;
}

/* ── AB theater ── */
.cs-theater { left: 720px; top: 52px; width: 1160px; height: 624px; overflow: hidden; z-index: 3; }
.cs-viewport { position: absolute; inset: 2px; border-radius: 16px; overflow: hidden; }
.cs-labels { position: absolute; inset: 0; opacity: 0; pointer-events: none; overflow: hidden; }
.cs-dim { position: absolute; inset: 0; background: rgba(6,8,13,0.72); opacity: 0;
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
  color: var(--ink); background: var(--scrim);
  border: 3px solid var(--side); box-shadow: 0 0 60px rgba(var(--side-rgb), 0.5);
  text-shadow: 0 4px 30px rgba(0,0,0,0.7); }
.cs-stamp.neg .main { border-color: var(--ink-4); box-shadow: 0 0 40px rgba(0,0,0,0.5);
  color: var(--ink-2); }
.cs-stamp.hr .main { border-color: var(--accent); box-shadow: 0 0 80px rgba(var(--accent-rgb), 0.8); }
.cs-stamp .subs { margin-top: 14px; display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
.cs-stamp .sub { display: inline-block; padding: 6px 16px; border-radius: 7px;
  font-family: var(--mono); font-size: 24px; font-weight: 800; letter-spacing: 2px;
  background: var(--scrim); border: 1.5px solid var(--edge); color: var(--ink); }
.cs-stamp .sub.rob { background: var(--accent); border-color: transparent;
  box-shadow: 0 0 30px rgba(var(--accent-rgb), 0.7); }
.cs-stamp .sub.perf { background: var(--ink); color: #0b0b12; border-color: transparent; }
.cs-stamp .sub.clutch { border-color: var(--side); color: var(--side); }
/* finale banner */
.cs-finale { position: absolute; left: 0; right: 0; bottom: 20px; text-align: center;
  z-index: 5; opacity: 0; pointer-events: none; }
.cs-finale span { display: inline-block; padding: 8px 26px; border-radius: 9px;
  background: var(--scrim); border: 1.5px solid var(--edge);
  font-size: 22px; font-weight: 800; letter-spacing: 3.5px; text-transform: uppercase;
  color: var(--ink-2); }

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
.cs-diamond .base { fill: var(--slab); stroke: var(--ink-4); stroke-width: 1.5; }
.cs-diamond .runner { fill: var(--side); filter: drop-shadow(0 0 6px rgba(var(--side-rgb), 0.9)); }
/* inning badge dead-center in the diamond — the infield is empty there
   (runner dots live on the bases), and it no longer collides with 2B */
.cs-diamond .inn { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-family: var(--mono); font-size: 15px; font-weight: 800; letter-spacing: 1px;
  color: var(--side); background: var(--scrim); padding: 2px 9px; border-radius: 8px;
  border: 1px solid var(--edge); white-space: nowrap; z-index: 1; }

/* count + outs — grouped, label-less, instantly readable */
.cs-cntouts { display: flex; align-items: center; gap: 14px; min-width: 110px; flex-shrink: 0; }
.cs-cntouts .cnt { font-family: var(--mono); font-variant-numeric: tabular-nums;
  font-size: 38px; font-weight: 800; line-height: 1; color: var(--ink); }
.cs-cntouts .sep { font-size: 22px; font-weight: 700; color: var(--ink-4); }
.cs-cntouts .dots { display: flex; gap: 9px; }
.cs-cntouts .dot { width: 20px; height: 20px; border-radius: 50%; background: var(--slab);
  border: 1.5px solid var(--ink-4); }
.cs-cntouts .dot.on { background: var(--accent); border-color: transparent;
  box-shadow: 0 0 12px rgba(var(--accent-rgb), 0.8); }

.cs-pitcher { display: flex; align-items: center; gap: 12px; flex: 0 1 200px; min-width: 0; }
.cs-pitcher .icon { width: 46px; height: 46px; border-radius: 10px; flex-shrink: 0; overflow: hidden;
  background: rgba(0,0,0,0.3); border: 1.5px solid var(--edge); display: flex;
  align-items: center; justify-content: center; }
.cs-pitcher .icon img { width: 100%; height: 100%; object-fit: contain; }
.cs-pitcher .info { min-width: 0; display: flex; flex-direction: column; }
.cs-pitcher .n { font-size: 21px; font-weight: 800; line-height: 1.1; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.cs-pitcher .l { font-size: 12px; font-weight: 700; letter-spacing: 2px; color: var(--ink-3);
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
.cs-score .dash { font-size: 40px; font-weight: 700; color: var(--ink-4); }

.cs-stars { display: flex; flex-direction: column; align-items: center; gap: 8px; flex-shrink: 0;
  transition: filter 0.3s ease; }
.cs-stars.active { filter: drop-shadow(0 0 14px rgba(var(--accent-rgb), 0.85)); }
.cs-stars .row { display: flex; gap: 6px; font-size: 24px; line-height: 1; }
.cs-stars .st { color: var(--ink-4); }
.cs-stars .st.on { color: var(--accent); text-shadow: 0 0 12px rgba(var(--accent-rgb), 0.8); }
.cs-stars .l { font-size: 13px; font-weight: 700; letter-spacing: 2px; color: var(--ink-3);
  text-transform: uppercase; }
.cs-stars.active .l { color: var(--accent); }

/* between-AB transition card */
.cs-transcard .inn { font-family: var(--mono); font-size: 22px; font-weight: 800; letter-spacing: 3px;
  color: var(--side); text-transform: uppercase; }
.cs-transcard .outs { font-size: 46px; font-weight: 900; letter-spacing: 1px; color: var(--ink);
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
  text-transform: uppercase; color: var(--ink-3); white-space: nowrap; }
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
  letter-spacing: 1.5px; color: var(--ink-3); text-transform: uppercase; white-space: nowrap; }
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
  background: var(--well); border: 1.5px solid var(--edge-soft); overflow: hidden; }
.cs-abchip .top { display: flex; justify-content: space-between; gap: 8px;
  font-size: 14px; font-weight: 700; letter-spacing: 1.4px;
  color: var(--ink-3); text-transform: uppercase; white-space: nowrap; }
/* result row: big abbreviation left, the play detail (TO LF / ON 0-2 /
   168FT · 1 RBI) right-anchored beside it at its usual small size */
.cs-abchip .res { margin-top: 5px; display: flex; align-items: center;
  justify-content: space-between; gap: 8px; }
.cs-abchip .res .abbr { font-family: var(--mono); font-size: 31px; font-weight: 800;
  line-height: 1; color: var(--ink-2); white-space: nowrap; }
/* detail bits stack as right-aligned rows beside the abbreviation ("346FT"
   over "3 RBI") — the chip has vertical room to spare where a single line
   would truncate */
.cs-abchip .res .dtxt { display: flex; flex-direction: column; align-items: flex-end;
  gap: 2px; min-width: 0; font-family: var(--mono); font-size: 13px; font-weight: 700;
  letter-spacing: 0.5px; color: var(--ink-3); text-transform: uppercase; }
.cs-abchip .res .dtxt span { white-space: nowrap; line-height: 1.1; }
.cs-abchip.hit .dtxt, .cs-abchip.hr .dtxt { color: var(--ink-2); }
/* detail line beneath: contact quality fills the freed left slot — a
   dimmed NONE on contactless PAs keeps every chip's vertical rhythm */
.cs-abchip .det { margin-top: 6px; display: flex; align-items: baseline; }
.cs-abchip .info { margin-top: 5px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cs-abchip .swingtag { font-family: var(--mono); font-size: 11.5px; font-weight: 800; letter-spacing: 1.2px;
  color: var(--ink-2); white-space: nowrap; border-left: 3px solid var(--ink-4);
  padding-left: 6px; line-height: 1.1; }
/* contact quality — owns the detail line's left slot: Perfect is the
   marquee tier, Nice reads brighter than Sour */
.cs-abchip .ctag { flex: 0 0 auto; font-family: var(--mono); font-size: 13px; font-weight: 800;
  letter-spacing: 1.4px; white-space: nowrap; color: var(--ink-3); }
.cs-abchip .ctag.nice { color: var(--ink-2); }
.cs-abchip .ctag.perf { color: var(--side); }
.cs-abchip .ctag.none { color: var(--ink-4); }
.cs-abchip .starsused { font-size: 13px; letter-spacing: 2px; line-height: 1; color: var(--accent);
  text-shadow: 0 0 8px rgba(var(--accent-rgb), 0.7); }
.cs-abchip.hit { background: rgba(var(--side-rgb), 0.22); border-color: rgba(var(--side-rgb), 0.7); }
.cs-abchip.hit .res .abbr { color: var(--side); }
.cs-abchip.hr { background: rgba(var(--accent-rgb), 0.24); border-color: var(--accent);
  box-shadow: 0 0 24px rgba(var(--accent-rgb), 0.45); }
.cs-abchip.hr .res .abbr { color: var(--ink); }
/* The chip currently being replayed. This marker STAYS — it is the only thing
   tying the ticker to the theater — but it is no longer a crawling rainbow
   ring: a solid accent edge plus a lift off the row says "this one" without a
   second animation running beside the replay. */
.cs-abchip.live { border-color: var(--accent);
  box-shadow: 0 0 0 1.5px rgba(var(--accent-rgb), 0.55), 0 0 26px rgba(var(--accent-rgb), 0.35); }
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
