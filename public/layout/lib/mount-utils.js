// mount-utils.js — tiny shared helpers duplicated (byte-for-byte) across the
// SVG-theme-engine mounts before this module existed. Kept intentionally
// small: these are primitives every `slots`-based mount needs, not a general
// dumping ground. See rio-data.js for URL/data helpers and reveal-gate.js for
// the show/hide + reveal-sequencing helpers.

// Count-dot / base "off" fill shared by Scoreboard and Scorecard.
export const DOT_OFF = 'rgba(255,255,255,0.08)';

// Set a theme engine slot's fill to `color` when on, DOT_OFF when off.
// No-ops when the theme doesn't declare the slot.
export function dot(engine, name, on, color) {
  const el = engine.slots[name];
  if (el) el.style.fill = on ? color : DOT_OFF;
}

// Stadium values reach state as slugs (server/rio/provider.py:_stadium_slug),
// which is right for lookups and wrong on air — "peach_garden" is not a name
// anyone writes. Title-casing the slug gets six of the seven right and "DK
// Jungle" wrong ("Dk"), so the names are SPELLED here rather than derived; the
// set is closed and has been for the life of the game. Mirrors
// _STADIUM_SLUGS in server/rio/provider.py and STADIUM_OPTIONS in
// src/data/stadiums.js — the same seven, inverted.
const STADIUM_NAMES = {
  mario_stadium: 'Mario Stadium',
  bowser_castle: 'Bowser Castle',
  wario_palace: 'Wario Palace',
  yoshi_park: 'Yoshi Park',
  peach_garden: 'Peach Garden',
  dk_jungle: 'DK Jungle',
  toy_field: 'Toy Field',
};

// Slug -> display name. Anything already reading as a display name is left
// alone (the HUD and completed-game feeds both send real names through here),
// and an unknown slug still title-cases rather than reaching air as a slug.
export function prettyStadium(slug) {
  if (!slug) return '';
  const key = String(slug);
  if (STADIUM_NAMES[key]) return STADIUM_NAMES[key];
  if (/[a-z].*[A-Z ]/.test(key) || key.includes(' ')) return key;
  return key.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Probe-load an image URL before committing it to a theme engine slot, so a
// 404 (missing asset pack file) never leaves a broken-image icon on air —
// it falls back to an optional sibling slot (e.g. a default mark) instead.
// `isDisposed` is a () => bool so the mount can cancel a stale probe after
// dispose() or a theme swap replaces the slot element out from under it.
export function bindImageProbe(engine, isDisposed, slotName, url, fallbackSlot) {
  const el = engine.slots[slotName];
  if (!el) return;
  if (!url) {
    engine.setImage(slotName, '');
    if (fallbackSlot && engine.slots[fallbackSlot]) engine.slots[fallbackSlot].setAttribute('opacity', '1');
    return;
  }
  const img = new Image();
  img.onload = () => {
    if (isDisposed() || el !== engine.slots[slotName]) return;
    engine.setImage(slotName, url);
    if (fallbackSlot && engine.slots[fallbackSlot]) engine.slots[fallbackSlot].setAttribute('opacity', '0');
  };
  img.onerror = () => {
    if (isDisposed() || el !== engine.slots[slotName]) return;
    engine.setImage(slotName, '');
    if (fallbackSlot && engine.slots[fallbackSlot]) engine.slots[fallbackSlot].setAttribute('opacity', '1');
  };
  img.src = url;
}

// How many innings a linescore covers — UNCAPPED, so the caller can both size
// its grid and work out which window of innings to show when a game runs past
// it (the last N, not the first).
//
// The feeds only ever hand over the innings that have HAPPENED, so counting
// those made a live game grow its own table: four innings into a nine-inning
// game the board drew four columns — and since the columns divide their band,
// those four stretched across the full width. A scoreboard's linescore is a
// fixed frame you fill in, not a frame that tracks the filling.
//
// Regulation or what was played, whichever is greater: the max is what keeps
// EXTRA innings visible once a game runs past its own length. A record with no
// innings_selected falls back to what it played.
export function linescoreColumns(played, inningsSelected) {
  if (!(played > 0)) return 0;
  return Math.max(played, inningsSelected || 0);
}

/*
 * Where a linescore's columns sit once you know how many there are.
 *
 * TWO POLICIES, and which one a theme gets is not a preference — it follows
 * from whether its table is RULED.
 *
 *   SPREAD  (theme declares `data-span-x` + `data-span-w` on box-grid)
 *     The band is divided into `shown` equal CELLS and each column is centred
 *     in its own, so the columns always fill their pane and anything authored
 *     downstream at a fixed x — an R column, a pane rule, a caption — can never
 *     be collided with. That is what a framed table needs: the default
 *     Scoreboard-L draws verticals at 80/512/568, and a run of columns that
 *     did not fill 80..512 would leave a hole inside a ruled box.
 *
 *     CELLS, NOT ENDPOINTS. Pinning the first and last column to the band's
 *     edges is the obvious reading and it is wrong: at five innings the outer
 *     numbers hug the walls while the inner gaps stretch to take up the slack,
 *     so the run reads as four gaps rather than five columns — and under a
 *     ruled table it puts the outer cells half outside the box.
 *
 *     The cost is honest and bounded: a five-inning game's cells are wider than
 *     a nine's by exactly 9/5, and nothing else changes.
 *
 *   SLIDE  (no band declared — box-grid, optionally wrapping box-total)
 *     The PITCH never changes and the whole block stays on the centre the theme
 *     composed it on. box-total closes onto the last real inning by the full
 *     slack and box-grid pushes back half of it; because box-total is NESTED
 *     inside box-grid those translates compose, so the innings move right by
 *     slack/2 and the total moves left by slack/2 — equal and opposite, centre
 *     preserved. This is what an UNRULED table wants: with no frame to fill,
 *     stretching the cells just makes the spacing a function of game length,
 *     while moving the block keeps every gap exactly as it was drawn.
 *
 * A theme with only box-total and no box-grid gets a left-anchored table whose
 * R column simply follows the innings in.
 *
 * Nothing here rewrites an authored `x`: both policies work in transforms, so
 * the theme's own geometry stays pristine and a longer game restores it.
 */
export function layoutBox(engine, shown, maxInn) {
  const grid = engine.slots['box-grid'];
  const total = engine.slots['box-total'];
  if (!grid && !total) return;
  const h1 = engine.slots['box-h-1'];
  const h2 = engine.slots['box-h-2'];
  const x1 = h1 ? parseFloat(h1.getAttribute('x')) : NaN;
  const pitch = h2 && Number.isFinite(x1)
    ? (parseFloat(h2.getAttribute('x')) || 0) - x1 : 0;
  if (!(pitch > 0)) return;

  const spanX = grid ? parseFloat(grid.getAttribute('data-span-x')) : NaN;
  const spanW = grid ? parseFloat(grid.getAttribute('data-span-w')) : NaN;
  if (Number.isFinite(spanX) && Number.isFinite(spanW)) {
    const n = Math.max(shown, 1);
    const cell = spanW / n;
    for (let i = 1; i <= maxInn; i++) {
      // Only the active columns move; a hidden one keeps its authored x, which
      // is where it will be wanted again the moment a longer game arrives.
      const dx = i <= n ? (spanX + cell * (i - 0.5)) - (x1 + (i - 1) * pitch) : 0;
      // box-h-{i} rides inside box-col-{i}; translating both would move it twice.
      for (const nm of [`box-col-${i}`, `box-away-${i}`, `box-home-${i}`]) {
        const el = engine.slots[nm];
        if (el) el.setAttribute('transform', `translate(${dx},0)`);
      }
    }
    return;
  }

  const slack = (maxInn - Math.max(shown, 1)) * pitch;
  if (total) total.setAttribute('transform', `translate(${-slack},0)`);
  if (grid) grid.setAttribute('transform', `translate(${slack / 2},0)`);
}

// Where a caption LINE starts, when the theme left-aligns it beside a label
// that is only there some of the time (stats-card-mount's `line-text`).
//
// A label-and-value pair reads as one thing when it reads left to right, and
// that is also what frees the width: a CENTRED line grows out from the middle
// in both directions, so to clear a label on its left it must reserve the same
// gap on its right and never use it — the Stat Card threw away 86 of 340 units
// that way, on the one row that carries the longest string on the card.
//
// But the label is conditional. `line-label` is bound only for a HUD game's
// line; an API board's caption arrives as the LINE itself, with nothing to its
// left, and a line indented past a label that isn't there just looks lost. So
// the theme authors both left edges against one right bound and the caller
// picks — the same shape as the stat card's four `data-{top,bot}-{open,closed}`
// edges, and for the same reason: two states, one pair of authored positions,
// rather than a mount inventing geometry a designer never saw.
//
//   data-x-labelled / data-x-bare   the left edge with and without a label
//   data-maxr                       the right bound; maxw follows from the two
//
// Returns null when the theme declares fewer than all three, which is not a
// fault: it means the line is centred (classic's bar, slice26's card) and its
// authored geometry stands. All-or-nothing, so a theme that loses one modifier
// through a design tool falls back to something coherent instead of drawing a
// line off the edge of the card.
export function lineTextBox(el, hasLabel) {
  if (!el) return null;
  const num = (name) => parseFloat(el.getAttribute(name));
  const labelled = num('data-x-labelled');
  const bare = num('data-x-bare');
  const right = num('data-maxr');
  // BOTH edges are required even though only one is used, or a theme that lost
  // the other one would switch layout MODELS when a game arrived — left-aligned
  // while the label is bound, centred the moment it isn't.
  if (![labelled, bare, right].every(Number.isFinite)) return null;
  const x = hasLabel ? labelled : bare;
  if (right <= x) return null;
  return { x, maxw: right - x };
}

// How much of a cell its value may fill before auto-fit bites. The remainder is
// the gutter, so it scales with the column: a 3-character AB gets a narrower
// gap than a 5-character AVG, which is what keeps each label glued to its own
// number rather than floating between two.
const CELL_FILL = 0.86;

// Divide a stat row's band between cells sized by what each CATEGORY needs.
//
// Four equal columns treat AB and AVG as the same kind of thing. They are not:
// one is a two-digit integer and the other a rate with a leading dot, so equal
// columns leave the integer floating in a cell built for the rate — which on
// the batting set is most of the row. Each stat carries `width`, the characters
// its category needs at its WIDEST (RioData.getStatsLine), and the band is
// divided in that ratio.
//
// The budgets are maxima, so at the theme's authored size nothing auto-fits in
// either stat set — which is the point. A value that renders smaller than the
// three beside it reads as a mistake, and `data-maxw` firing is invisible in a
// preview built from typical data.
//
// THE ROW RE-LAYS-OUT WHEN THE STAT SET CHANGES, not when a value does. That is
// deliberate and it is the whole reason the budget is per category rather than
// per value: a column sized to the number currently in it would shove the three
// beside it every time an AB ticked 9 to 10, which is the jitter `tabular-nums`
// exists to prevent one digit lower down. Batting and pitching have different
// budgets, so the columns do move between them — under the batter-change
// cross-fade the mount already runs.
//
// The theme declares the band on a `stat-row` group, the same `data-span-x` /
// `data-span-w` pair the scoreboard's linescore uses for SPREAD; a theme that
// declares neither keeps its authored columns. That is not a fallback so much
// as the other right answer: this policy suits an UNRULED row, where the cells
// are free to move, and a theme whose cells sit inside drawn dividers (the Stat
// Card's 2x2, the scoreboard's live block) cannot move one without moving the
// rule beside it — the same distinction layoutBox draws above.
export function layoutStatCells(engine, stats) {
  const row = engine.slots['stat-row'];
  if (!row || !Array.isArray(stats) || !stats.length) return;
  const bandX = parseFloat(row.getAttribute('data-span-x'));
  const bandW = parseFloat(row.getAttribute('data-span-w'));
  if (!Number.isFinite(bandX) || !Number.isFinite(bandW) || bandW <= 0) return;

  const widths = stats.map((st) => (Number(st.width) > 0 ? Number(st.width) : 1));
  const total = widths.reduce((a, b) => a + b, 0);

  let left = bandX;
  for (let i = 0; i < stats.length; i++) {
    const cell = bandW * (widths[i] / total);
    const centre = left + cell / 2;
    left += cell;
    const value = engine.slots[`stat-${i}-value`];
    const label = engine.slots[`stat-${i}-label`];
    for (const el of [value, label]) {
      if (el) el.setAttribute('x', String(Math.round(centre * 100) / 100));
    }
    if (!value) continue;
    const maxw = Math.round(cell * CELL_FILL * 100) / 100;
    if (parseFloat(value.getAttribute('data-maxw')) !== maxw) {
      value.setAttribute('data-maxw', String(maxw));
      // refitText skips a slot whose TEXT hasn't changed, so a cell that
      // resized under an unchanged value has to say so or it keeps the old fit.
      engine.invalidateFit(value);
    }
  }
}
