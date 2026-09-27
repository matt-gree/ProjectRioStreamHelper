// roster-layouts.js — the Roster element's three shapes, and the canvas each one
// is drawn on.
//
// ONE MODULE, TWO RUNTIMES: roster-mount.js / roster.html draw a layout at this
// size, and the console (stage/rosterlayout.jsx) resizes the OBS browser source
// to it when the producer switches. The two must not disagree, or a switch would
// leave a source whose page draws one canvas inside a source sized for another.
// Imports nothing, so the console can import it the way it does
// container-members.js and match-format.js.
//
// THE LAYOUT IS THE SOURCE'S, NOT THE ELEMENT'S — `?layout=` on the URL, the
// scoreboard's `?size=` shape. A size is a fact about one browser source, so a
// global setting would force every Roster source in every scene to one shape and
// could only be honoured by resizing sources the producer was not looking at.
// Grid is the absent param, so every source made before layouts existed is a
// grid source and keeps its 452x140.
//
//   grid    the captain spanning two rows, the other eight in a 2x4 grid, then
//           the bat/glove and the team logo — what the Roster has always drawn
//   vgrid   the grid stood on end: the captain across the top, the eight in
//           four rows of two, the bat/glove and logo below — at the grid's
//           scale, on its canvas turned
//   row     all of it in one line, every icon one size, the captain leading
//   column  the same line stood on end
//   field   the nine where they are FIELDING, on a diamond (FIELD_SPOTS)

export const ROSTER_LAYOUTS = {
  grid:   { label: 'Grid',   width: 452, height: 140 },
  vgrid:  { label: 'Vertical Grid', width: 140, height: 452 },
  row:    { label: 'Row',    width: 628, height: 68 },
  column: { label: 'Column', width: 68,  height: 628 },
  field:  { label: 'Field',  width: 340, height: 300 },
};

/*
 * THE FIELD LAYOUT: where each position stands, as the CENTRE of its icon on the
 * 340x300 canvas, seen from behind home plate — outfield across the top, the
 * middle infield under it, the corners flanking the pitcher, the catcher at the
 * foot. Not to scale: a real diamond puts the outfield three times further out
 * than the infield, which at this size would crowd the nine into a strip at the
 * bottom. What it keeps is every relationship a viewer reads a field by (SS left
 * of 2B, 3B and 1B on the lines, P between them, C behind).
 *
 * The bat/glove takes the bottom-right corner, level with the catcher. The team
 * logo is NOT drawn here: a diamond is a picture of the team already, and a
 * crest in the corner of it only competes with the nine.
 */
export const FIELD_SPOTS = {
  LF: [60, 80],   CF: [170, 34],  RF: [280, 80],
  SS: [115, 124], '2B': [225, 124],
  '3B': [48, 180], P: [170, 186], '1B': [292, 180],
  C: [170, 266],
  role: [300, 266],
};

export const DEFAULT_ROSTER_LAYOUT = 'grid';

// An unknown or absent layout is the grid, the way an unknown ?size= is `l`.
export function rosterLayout(value) {
  return Object.prototype.hasOwnProperty.call(ROSTER_LAYOUTS, value) ? value : DEFAULT_ROSTER_LAYOUT;
}

const ORIGIN = typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost';

export function rosterLayoutOfUrl(url) {
  try { return rosterLayout(new URL(url || '', ORIGIN).searchParams.get('layout')); }
  catch { return DEFAULT_ROSTER_LAYOUT; }
}

// The same URL with `?layout=` rewritten; the grid DROPS the param rather than
// spelling the default, so a grid source reads exactly as it always has.
export function urlForRosterLayout(url, layout) {
  const u = new URL(url, ORIGIN);
  if (rosterLayout(layout) === DEFAULT_ROSTER_LAYOUT) u.searchParams.delete('layout');
  else u.searchParams.set('layout', layout);
  return u.toString();
}
