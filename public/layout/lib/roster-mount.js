// roster-mount.js — the reusable roster grid renderer.
//
// Extracted from public/layout/scoreboard1/roster.html so more than one overlay
// can draw the same captain-first 9-character roster: the standalone Roster
// source and the combined Roster + Stats source (rosterstats-mount.js) both call
// renderRoster(). Data comes from RioData.getRosterSlots; visibility toggles from
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
`;

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

/**
 * Render the captain-first roster grid for one side into `container`.
 * Behavior-preserving port of roster.html's render(): reads RioData.getRosterSlots
 * and the show* toggles. `settingsPrefix` selects which settings namespace holds
 * those toggles — the standalone Roster source uses overlays.roster.*, the
 * combined Roster + Stats source passes overlays.rosterstats.* for independent
 * control.
 */
export function renderRoster(container, { state, settings, sb, team, settingsPrefix = 'overlays.roster' }) {
  injectCss();
  if (!container) return;
  container.classList.add('roster-container');
  const { deepGet } = OverlayBase;
  container.innerHTML = '';

  const showSuperstars = deepGet(settings, `${settingsPrefix}.showSuperstars`, true) !== false;
  const showRole = deepGet(settings, `${settingsPrefix}.showRoleIcon`, true) !== false;
  const showTeamLogo = deepGet(settings, `${settingsPrefix}.showTeamLogo`, true) !== false;

  const slots = RioData.getRosterSlots(state, sb, team, {
    includeRole: showRole,
    includeTeamLogo: showTeamLogo,
  });

  const hasLogo = slots.some(s => s.kind === 'teamLogo');
  const trailingCount = (showRole ? 1 : 0) + (hasLogo ? 1 : 0);
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
  container.style.gridTemplateRows = `${rowH}px ${rowH}px`;

  let cols = `${captainSize}px repeat(4, ${charSize}px)`;
  if (showRole)  cols += ` ${captainSize}px`;
  if (hasLogo)   cols += ` ${captainSize}px`;
  container.style.gridTemplateColumns = cols;

  // Assign explicit grid positions to row-spanning items.
  let trailingCol = 5;
  for (const slot of slots) {
    const div = document.createElement('div');
    div.className = SLOT_CLASS[slot.kind];
    if (slot.kind === 'captain') {
      div.style.gridColumn = '1';
      div.style.gridRow = '1 / 3';
    } else if (slot.kind === 'role' || slot.kind === 'teamLogo') {
      trailingCol++;
      div.style.gridColumn = String(trailingCol);
      div.style.gridRow = '1 / 3';
    }
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
    container.appendChild(div);
  }
}

export const ROSTER_REF_W = REF_W;
export const ROSTER_REF_H = REF_H;
