import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ROSTER_LAYOUTS, FIELD_SPOTS, rosterLayout, rosterLayoutOfUrl, urlForRosterLayout,
} from '../../public/layout/lib/roster-layouts.js';
import { lineFitScale } from '../../public/layout/lib/roster-mount.js';

/*
 * The Roster's three layouts. The canvas each one declares is the size the
 * console resizes an OBS source to, so it has to be the size the mount actually
 * lays the line out for — pinned here by solving the line at full width (both
 * trailing icons on) and requiring it to fit exactly, not just fit.
 */
describe('roster layouts', () => {
  it('resolves an unknown or absent layout to the grid', () => {
    expect(rosterLayout(undefined)).toBe('grid');
    expect(rosterLayout('diagonal')).toBe('grid');
    expect(rosterLayout('row')).toBe('row');
  });

  it('reads and rewrites ?layout=, dropping it for the grid', () => {
    const url = 'http://localhost:5260/layout/scoreboard1/roster.html?scoreboard=1&team=2';
    const row = urlForRosterLayout(url, 'row');
    expect(row).toBe(`${url}&layout=row`);
    expect(rosterLayoutOfUrl(row)).toBe('row');
    // Back to the grid is the URL every pre-layout source already has.
    expect(urlForRosterLayout(row, 'grid')).toBe(url);
    expect(rosterLayoutOfUrl(url)).toBe('grid');
  });

  it('draws each line layout at exactly its declared canvas', () => {
    expect(lineFitScale('row', 2)).toBe(1);
    expect(lineFitScale('column', 2)).toBe(1);
    // A line and its column are the same length, turned.
    expect(ROSTER_LAYOUTS.column).toMatchObject({
      width: ROSTER_LAYOUTS.row.height, height: ROSTER_LAYOUTS.row.width,
    });
  });

  /* The vertical grid is the grid transposed at the SAME scale, which only
   * holds if its canvas is the grid's turned — the mount reuses the grid's fit. */
  it('draws the vertical grid on the grid canvas, turned', () => {
    expect(ROSTER_LAYOUTS.vgrid).toMatchObject({
      width: ROSTER_LAYOUTS.grid.height, height: ROSTER_LAYOUTS.grid.width,
    });
  });

  it('keeps the grid at the size roster.html declares for an absent layout', () => {
    const html = readFileSync('public/layout/scoreboard1/roster.html', 'utf8');
    expect(html).toMatch(/width: 452px;/);
    expect(html).toMatch(/height: 140px;/);
    expect(ROSTER_LAYOUTS.grid).toMatchObject({ width: 452, height: 140 });
  });
});

/*
 * The Field layout places each icon (52 square) by its CENTRE. Every position
 * the server writes must have a spot — a missing one is a player silently left
 * off the diamond — and no two cells may overlap or leave the canvas.
 */
describe('field layout', () => {
  const CELL = 52;
  const MARGIN = 8;

  it('has a spot for every position the server writes', () => {
    const src = readFileSync('server/rio/apply.py', 'utf8');
    const positions = src.match(/_FIELD_POSITIONS = \(([^)]*)\)/)[1].match(/"([^"]+)"/g).map(p => p.slice(1, -1));
    expect(positions).toHaveLength(9);
    for (const p of positions) expect(FIELD_SPOTS[p], p).toBeDefined();
  });

  it('keeps every cell on the canvas, inside the margin', () => {
    const { width, height } = ROSTER_LAYOUTS.field;
    for (const [name, [x, y]] of Object.entries(FIELD_SPOTS)) {
      expect(x - CELL / 2, name).toBeGreaterThanOrEqual(MARGIN);
      expect(x + CELL / 2, name).toBeLessThanOrEqual(width - MARGIN);
      expect(y - CELL / 2, name).toBeGreaterThanOrEqual(MARGIN);
      expect(y + CELL / 2, name).toBeLessThanOrEqual(height - MARGIN);
    }
  });

  it('never overlaps two cells', () => {
    const spots = Object.entries(FIELD_SPOTS);
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const [a, [ax, ay]] = spots[i];
        const [b, [bx, by]] = spots[j];
        const apart = Math.abs(ax - bx) >= CELL || Math.abs(ay - by) >= CELL;
        expect(apart, `${a} / ${b}`).toBe(true);
      }
    }
  });
});
