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
