// roster-mount.js — the reusable roster grid renderer.
//
// Extracted from public/layout/scoreboard1/roster.html so more than one overlay
// can draw the same captain-first 9-character roster: the standalone Roster
// source and — via mountRoster() at the bottom — the roster as a shared-CONTAINER
// member. Data comes from RioData.getRosterSlots; visibility toggles from
// overlays.roster.* — a single source of truth for both surfaces.
//
//   import { renderRoster } from '/layout/lib/roster-mount.js';
//   renderRoster(gridContainer, { state, settings, sb, team });
//
// `gridContainer` is the inline-grid element (class "roster-container"); the
// caller owns its placement/centering and any viewport scaling. Requires
// overlay-base.js (OverlayBase) + rio-data.js (RioData) loaded first.

// Reference roster icon sizes — trailing icons match captain, all scale
// uniformly to fit the 452×140 frame.
import { styleNs, styleSetting } from './side-styles.js';
import { ROSTER_LAYOUTS, FIELD_SPOTS, rosterLayout } from './roster-layouts.js';

const REF_W = 452, REF_H = 140;
const CHAR_SIZE = 52;
const CAPTAIN_SIZE = 104;
const ROW_H = 60;
const GAP = 4;
const PAD = 8;

const SLOT_CLASS = {
  captain: 'captain-container',
  char: 'character-container',
  role: 'role-container',
  teamLogo: 'team-logo-container',
};

// Grid CSS travels with the module (mirrors stats-card-mount.js) so the roster
// renders identically in any host, not just the original roster.html.
const CSS = `
.roster-container { display: inline-grid; padding: 8px; }
.captain-container { display: flex; align-items: center; justify-content: center; position: relative; overflow: visible; }
.captain-container img:not(.superstar-badge) { width: var(--captain-size, 104px); height: auto; object-fit: contain; }
.role-container, .team-logo-container { display: flex; align-items: center; justify-content: center; }
.role-container img { width: var(--trailing-size, 104px); height: auto; object-fit: contain; }
.team-logo-container img { width: var(--trailing-size, 104px); height: auto; object-fit: contain; }
.character-container { display: flex; align-items: center; justify-content: center; position: relative; overflow: visible; }
.character-container img:not(.superstar-badge) { width: var(--char-size, 52px); height: auto; object-fit: contain; }
.superstar-badge {
  position: absolute; bottom: -4px; right: -4px; width: 24px; height: 24px;
  object-fit: contain; filter: drop-shadow(0 0 3px rgba(245,159,0,0.9));
  pointer-events: none;
}
.superstar-badge--captain { width: 36px; height: 36px; }
/* The captain box (overlays.roster.captainBox) — the line and field layouts,
   where the captain is the same size as everyone else. A pseudo-element rather
   than an outline, which older CEF builds draw square whatever the radius. */
.roster-container .captain-box::after {
  content: ''; position: absolute; inset: -3px; pointer-events: none;
  border: 2px solid var(--accent, #f59e0b); border-radius: 8px;
}
.roster-container[data-portraits="pixel"] .captain-container img:not(.superstar-badge),
.roster-container[data-portraits="pixel"] .character-container img:not(.superstar-badge) {
  image-rendering: pixelated;
}
`;

/*
 * `overlays.roster.pixelPortraits` — how the character sprites are upscaled.
 * Anything but a literal `true` is the smooth default, so a stray value
 * degrades to what the roster has always drawn.
 *
 * Portraits only, never the bat/glove, the team logo or the superstar badge:
 * those are high-resolution art (300–900px) scaled DOWN into the grid, where
 * nearest-neighbour buys no crispness and costs jagged edges. It is the same
 * line the theme SVGs draw — every `image-rendering:pixelated` in them is on a
 * character or a runner, never a logo.
 */
export function resolvePortraitStyle(v) {
  return OverlayBase.settingOn(v, false) ? 'pixel' : 'smooth';
}

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.id = 'roster-mount-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

// Uniform fit-scale: shrink everything proportionally if the natural grid
// overflows the frame.
function rosterFitScale(trailingCount) {
  const cols = 5 + trailingCount;
  const naturalGridW = CAPTAIN_SIZE + 4 * CHAR_SIZE + trailingCount * CAPTAIN_SIZE + (cols - 1) * GAP;
  const naturalGridH = 2 * ROW_H + GAP;
  const availW = REF_W - 2 * PAD;
  const availH = REF_H - 2 * PAD;
  return Math.min(1, availW / naturalGridW, availH / naturalGridH);
}

// The same fit for a LINE: every cell at CHAR_SIZE — the captain, the eight and
// the trailing icons alike — one gap between each, along the line's length and
// one cell deep across it.
export function lineFitScale(layout, trailingCount) {
  const ref = ROSTER_LAYOUTS[layout];
  const cells = 9 + trailingCount;
  const length = cells * CHAR_SIZE + (cells - 1) * GAP;
  const [along, across] = layout === 'row' ? [ref.width, ref.height] : [ref.height, ref.width];
  return Math.min(1, (along - 2 * PAD) / length, (across - 2 * PAD) / CHAR_SIZE);
}

/*
 * The palette on the Roster's OWN page, for the captain box's --accent: the
 * global accent, or this Roster's pin (this side's, under Separate side styles).
 * Not part of renderRoster, which also draws inside a container — whose shell
 * owns that document's palette, and a member rewriting it would repaint every
 * other occupant.
 */
export function applyRosterPalette(settings, team) {
  OverlayBase.applyDesignSettings('roster', styleNs(settings, 'roster', team));
}

/**
 * Render the captain-first roster grid for one side into `container`.
 * Behavior-preserving port of roster.html's render(): reads RioData.getRosterSlots
 * and the show* toggles.
 *
 * The toggles come from overlays.roster.* wherever this is drawn. There used to
 * be a `settingsPrefix` here so the combined Roster + Stats source could carry
 * its own copy of the same three switches; that element is gone, and a container
 * resting on a roster is the SAME roster the standalone source shows — one look
 * to configure, not one per host.
 */
/*
 * Returns `{ blank }` — why nothing was drawn, when that is not simply "no game"
 * (today only the Field layout has such a reason) — for the page to hand to
 * OverlayBase.setBlank.
 */
export function renderRoster(container, { state, settings, sb, team, layout }) {
  injectCss();
  if (!container) return { blank: null };
  container.classList.add('roster-container');
  container.innerHTML = '';
  // The Field layout positions its cells absolutely; every other shape is a
  // grid, so undo that first rather than inherit it.
  for (const k of ['display', 'position', 'width', 'height', 'padding']) container.style[k] = '';

  // settingOn, not `!== false` — see the note in scoreboard-mount's readToggles.
  const on = OverlayBase.settingOn;
  // This side's copy when Separate side styles is on (./side-styles.js).
  const side = (key, def) => styleSetting(settings, 'roster', team, key, def);
  const showSuperstars = on(side('showSuperstars', true), true);
  const showRole = on(side('showRoleIcon', true), true);
  const showTeamLogo = on(side('showTeamLogo', true), true);
  container.dataset.portraits = resolvePortraitStyle(side('pixelPortraits'));

  const slots = RioData.getRosterSlots(state, sb, team, {
    includeRole: showRole,
    includeTeamLogo: showTeamLogo,
  });

  const hasLogo = slots.some(s => s.kind === 'teamLogo');
  const trailingCount = (showRole ? 1 : 0) + (hasLogo ? 1 : 0);
  const shape = rosterLayout(layout);
  container.dataset.layout = shape;

  // The captain box: only where the captain is not already told apart by size
  // (every layout but the two grids), and on by default there.
  const boxCaptain = shape !== 'grid' && shape !== 'vgrid' && on(side('captainBox', true), true);

  if (shape === 'field') return renderField(container, { state, sb, team, slots, showSuperstars, boxCaptain });

  if (shape === 'row' || shape === 'column') {
    // ROW / COLUMN: every slot in one line, in the grid's reading order
    // (captain, the eight, bat/glove, logo), ALL ONE SIZE. The grid can afford a
    // captain two rows tall because it has two rows; a line has one, and a
    // bigger captain there only makes the whole line that much deeper. It leads
    // the line, which is what says it is the captain.
    const s = lineFitScale(shape, trailingCount);
    const cell = CHAR_SIZE * s;
    container.style.setProperty('--char-size', cell + 'px');
    container.style.setProperty('--captain-size', cell + 'px');
    container.style.setProperty('--trailing-size', cell + 'px');
    container.style.columnGap = GAP * s + 'px';
    container.style.rowGap = GAP * s + 'px';
    const track = `repeat(${slots.length}, ${cell}px)`;
    container.style.gridTemplateColumns = shape === 'row' ? track : `${cell}px`;
    container.style.gridTemplateRows = shape === 'row' ? `${cell}px` : track;
    for (const slot of slots) {
      const div = slotNode(slot, showSuperstars);
      if (boxCaptain && slot.kind === 'captain') div.classList.add('captain-box');
      container.appendChild(div);
    }
    return { blank: null };
  }

  const s = rosterFitScale(trailingCount);
  const charSize = CHAR_SIZE * s;
  const captainSize = CAPTAIN_SIZE * s;
  const gap = GAP * s;
  const rowH = ROW_H * s;

  container.style.setProperty('--char-size', charSize + 'px');
  container.style.setProperty('--captain-size', captainSize + 'px');
  container.style.setProperty('--trailing-size', captainSize + 'px');
  container.style.columnGap = gap + 'px';
  container.style.rowGap = gap + 'px';

  // The VERTICAL grid is this one transposed: the long axis runs down instead of
  // across, so the captain spans the two COLUMNS at the top and the bat/glove and
  // logo span them at the foot. Same scale (the canvas is the grid's, turned), so
  // a character is the same size in either.
  const tall = shape === 'vgrid';
  let track = `${captainSize}px repeat(4, ${charSize}px)`;
  if (showRole)  track += ` ${captainSize}px`;
  if (hasLogo)   track += ` ${captainSize}px`;
  const pair = `${rowH}px ${rowH}px`;
  container.style.gridTemplateColumns = tall ? pair : track;
  container.style.gridTemplateRows = tall ? track : pair;
  const along = tall ? 'gridRow' : 'gridColumn';
  const across = tall ? 'gridColumn' : 'gridRow';

  // Assign explicit grid positions to the items spanning both lanes.
  let trailing = 5;
  for (const slot of slots) {
    const div = slotNode(slot, showSuperstars);
    if (slot.kind === 'captain') {
      div.style[along] = '1';
      div.style[across] = '1 / 3';
    } else if (slot.kind === 'role' || slot.kind === 'teamLogo') {
      trailing++;
      div.style[along] = String(trailing);
      div.style[across] = '1 / 3';
    }
    container.appendChild(div);
  }
  return { blank: null };
}

/*
 * FIELD: each of the nine at the spot of the position they are PLAYING
 * (`character.{i}.position`, P · C · 1B … RF — live, so a mid-game position
 * change moves them), every icon CHAR_SIZE, the captain included. The bat/glove
 * takes the bottom-right corner, from the same slots list as every other layout,
 * so its switch means the same thing here; the team logo is not drawn.
 *
 * A character with no position is not placed: guessing a spot would put a player
 * somewhere they are not, on the one layout whose whole claim is where everyone
 * is. A board with NO positions at all — a completed game from the Rio API,
 * whose record carries none — draws nothing, and says why.
 */
function renderField(container, { state, sb, team, slots, showSuperstars, boxCaptain }) {
  const { width, height } = ROSTER_LAYOUTS.field;
  container.style.display = 'block';
  container.style.position = 'relative';
  container.style.padding = '0';
  container.style.width = width + 'px';
  container.style.height = height + 'px';
  container.style.setProperty('--char-size', CHAR_SIZE + 'px');
  container.style.setProperty('--captain-size', CHAR_SIZE + 'px');
  container.style.setProperty('--trailing-size', CHAR_SIZE + 'px');

  const place = (slot, spot, isCaptain = false) => {
    const div = slotNode(slot, showSuperstars);
    if (isCaptain) div.classList.add('captain-box');
    div.style.position = 'absolute';
    div.style.width = div.style.height = CHAR_SIZE + 'px';
    div.style.left = (spot[0] - CHAR_SIZE / 2) + 'px';
    div.style.top = (spot[1] - CHAR_SIZE / 2) + 'px';
    container.appendChild(div);
  };

  // Straight off the roster SLOT (`character.{i}`), not matched back by name:
  // the position is a fact about a slot, and a name lookup would lose one of
  // two identical characters.
  let placed = 0, named = 0;
  const g = OverlayBase.deepGet;
  const capIdx = Number(g(state, `score.${sb}.player.${team}.rio_captainIndex`, -1));
  for (let i = 0; i < 9; i++) {
    const ch = g(state, `score.${sb}.player.${team}.character.${i}`, null) || {};
    if (!ch.name) continue;
    named++;
    const spot = FIELD_SPOTS[ch.position];
    if (!spot) continue;
    place({ kind: 'char', name: ch.name, imgUrl: RioData.charIconUrl(ch.name), isStarred: !!ch.is_starred },
      spot, boxCaptain && i === capIdx);
    placed++;
  }
  if (!placed) {
    return {
      blank: named
        ? 'No fielding positions for this game — a completed game from the Rio API does not record them. Use the Grid, Row or Column layout for it.'
        : null,
    };
  }
  // The bat/glove only; the team logo is not part of the field (FIELD_SPOTS).
  for (const slot of slots) if (slot.kind === 'role') place(slot, FIELD_SPOTS.role);
  return { blank: null };
}

// One slot's cell: the icon, and its superstar badge when it has one.
function slotNode(slot, showSuperstars) {
  const div = document.createElement('div');
  div.className = SLOT_CLASS[slot.kind];
  const img = document.createElement('img');
  img.src = slot.imgUrl;
  img.onerror = () => img.style.display = 'none';
  div.appendChild(img);
  if (showSuperstars && slot.isStarred) {
    const badge = document.createElement('img');
    badge.src = `${OverlayBase.BASE_URL}/game_assets/msb/gameIcons/superstar.png`;
    badge.className = slot.kind === 'captain'
      ? 'superstar-badge superstar-badge--captain'
      : 'superstar-badge';
    div.appendChild(badge);
  }
  return div;
}

/*
 * The roster as a CONTAINER MEMBER.
 *
 * `renderRoster` is a draw call; a container member is an object with a
 * lifecycle (`fed-container.js`'s MEMBERS registry — mount · update · dispose).
 * This is the adapter between the two, and it is what lets a container REST on a
 * roster — the steady state the combined Roster + Stats source used to own
 * internally, now the container's `resting` occupant.
 *
 * The drop-shadow lives here rather than on the host page for the same reason
 * the grid CSS does: roster.html applies it to its own <body>, and a member
 * inside a container has no body of its own to carry it.
 *
 * Frame of reference comes from the FEED, not from mount time — the engine
 * writes the container's scope into every payload it feeds, so one layer serves
 * whatever side the container is about and a scope change is an update rather
 * than a rebuild.
 */
const HOST_CSS = `
.rm-host {
  position: absolute; inset: 0; display: flex;
  align-items: center; justify-content: center;
  filter:
    drop-shadow(0 2px 2px rgba(0, 0, 0, 0.12))
    drop-shadow(0 3px 1px rgba(0, 0, 0, 0.14))
    drop-shadow(0 1px 5px rgba(0, 0, 0, 0.12))
    drop-shadow(0 -1px 2px rgba(0, 0, 0, 0.1));
}
`;

let _hostCssInjected = false;

export function mountRoster({ host }) {
  if (!_hostCssInjected) {
    const s = document.createElement('style');
    s.id = 'roster-mount-host-css';
    s.textContent = HOST_CSS;
    document.head.appendChild(s);
    _hostCssInjected = true;
  }

  const root = document.createElement('div');
  root.className = 'rm-host';
  const grid = document.createElement('div');
  root.appendChild(grid);
  host.appendChild(root);

  // sel = { scoreboard, team } — a scope, not a content pick. The roster has no
  // "which one" to choose; whose roster it is, is the only question.
  function update(state, sel) {
    renderRoster(grid, {
      state,
      settings: OverlayBase.settings,
      sb: Number(sel?.scoreboard) || 1,
      team: Number(sel?.team) === 2 ? 2 : 1,
    });
  }

  function dispose() {
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  // No entrance animation to re-run; declared so the container's activation
  // replay path is uniform across members.
  function replay() {}

  return { update, dispose, replay };
}
