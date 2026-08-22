/*
 * playername-mount.js — one side's player name, as its own OBS source.
 *
 * Draws `score.{N}.player.{T}.rioName`, with the address-book prefix
 * (`…player.{T}.team` — the sponsor/tag) beside it. Two producer settings shape
 * it, both under `overlays.playername.*` and therefore SHARED by both sides:
 *
 *   align           auto | left | center | right
 *   prefixPosition  above | below | inline | off
 *
 * `auto` is the default and has to exist. The setting is global (one namespace,
 * like the roster's), and the behaviour it replaces was side-dependent — side 1
 * hugged the left edge and side 2 the right, which is what a name sitting at
 * either end of a scoreboard wants. A global setting cannot express that with
 * three literal values, so `auto` is the value that means "mirror the sides",
 * and defaulting to it is what keeps every source already in a producer's scene
 * looking the way it does today.
 *
 * Styles are injected and class-scoped (`.pn-*`) rather than left in the page,
 * because this mount also runs inside a container shell that has no stylesheet
 * of its own.
 *
 *   const pn = mountPlayerName({ host, sb, team });
 *   pn.update(OverlayBase.state, OverlayBase.settings);
 *
 * Requires overlay-base.js (OverlayBase).
 */

const REF_W = 400, REF_H = 100;

const CSS = `
.pn-root { position: absolute; inset: 0; overflow: hidden; }
.pn-stage {
  position: absolute; left: 0; top: 0;
  width: ${REF_W}px; height: ${REF_H}px;
  transform-origin: top left;
  font-family: var(--font-family, 'Inter'), 'Inter', sans-serif;
}
.pn-box {
  box-sizing: border-box; margin: 0; padding: 16px;
  display: flex; width: 100%; height: 100%;
  flex-direction: column; justify-content: center; gap: 2px;
}
/* Column mode: the cross axis is horizontal, so alignment is align-items… */
.pn-a-left   { align-items: flex-start; text-align: left; }
.pn-a-center { align-items: center;     text-align: center; }
.pn-a-right  { align-items: flex-end;   text-align: right; }
/* …and inline mode turns the box on its side, where BOTH questions get new
   answers. Horizontal is justify-content now, per the rules below. Vertical is
   align-content, not align-items: align-items is spending itself on the
   baseline, and a single flex line only answers to align-content once wrapping
   is allowed — left at nowrap the pair sat hard against the top of the card.
   (No backticks in here: this whole block is a template literal.) */
.pn-p-inline {
  flex-direction: row; align-items: baseline; gap: 10px;
  flex-wrap: wrap; align-content: center;
}
.pn-p-inline.pn-a-left   { justify-content: flex-start; }
.pn-p-inline.pn-a-center { justify-content: center; }
.pn-p-inline.pn-a-right  { justify-content: flex-end; }
/* Below = the same stack, reordered. Nothing moves in the DOM, so the name
   keeps its place in the reading order for anything that cares. */
.pn-p-below .pn-tag { order: 1; }
.pn-p-off .pn-tag { display: none; }
.pn-tag {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--tag-color, var(--accent, #f59f00));
  text-shadow: var(--text-shadow, none);
  white-space: nowrap;
}
/* A participant with no prefix leaves no gap — the gap belongs to a row that
   has something in it. */
.pn-tag:empty { display: none; }
.pn-name {
  margin: 0;
  font-size: 36px;
  font-weight: 700;
  line-height: 1.05;
  color: var(--text-primary, #ffffff);
  text-shadow: var(--text-shadow, none);
  white-space: nowrap;
}
`;

let cssInjected = false;
function injectCss() {
    if (cssInjected) return;
    const style = document.createElement('style');
    style.id = 'playername-mount-css';
    style.textContent = CSS;
    document.head.appendChild(style);
    cssInjected = true;
}

const ALIGNMENTS = new Set(['left', 'center', 'right']);
const PREFIX_POSITIONS = new Set(['above', 'below', 'inline', 'off']);

/**
 * Which edge the name sits on, for one side.
 *
 * `auto` — and anything unrecognised, so a stale or hand-edited value degrades
 * to the shipped behaviour rather than to a blank corner — mirrors the sides:
 * side 1 left, side 2 right.
 */
export function resolveAlign(setting, team) {
    const want = String(setting ?? 'auto');
    if (ALIGNMENTS.has(want)) return want;
    return Number(team) === 2 ? 'right' : 'left';
}

export function resolvePrefixPosition(setting) {
    const want = String(setting ?? 'above');
    return PREFIX_POSITIONS.has(want) ? want : 'above';
}

export function mountPlayerName({ host, sb = 1, team = 1 }) {
    injectCss();
    const SCOREBOARD = Number(sb) || 1;
    const TEAM = Number(team) === 2 ? 2 : 1;

    const NAME_KEY = `score.${SCOREBOARD}.player.${TEAM}.rioName`;
    // Address-book prefix (sponsor/tag) projects to score.player.{T}.team.
    const TAG_KEY = `score.${SCOREBOARD}.player.${TEAM}.team`;

    const root = document.createElement('div');
    root.className = 'pn-root';
    const stage = document.createElement('div');
    stage.className = 'pn-stage';
    const box = document.createElement('div');
    box.className = 'pn-box';
    const tagEl = document.createElement('span');
    tagEl.className = 'pn-tag';
    const nameEl = document.createElement('span');
    nameEl.className = 'pn-name';
    box.append(tagEl, nameEl);
    stage.appendChild(box);
    root.appendChild(stage);
    host.appendChild(root);
    root.dataset.team = TEAM;

    // Fit the native card to the box this mount was handed — its own host, not
    // the window, so a member centered in a container is not blown up to it.
    function autoScale() {
        if (OverlayBase.PREVIEW_MODE) { stage.style.transform = ''; return; }
        const w = root.clientWidth || window.innerWidth;
        const h = root.clientHeight || window.innerHeight;
        const scale = Math.min(w / REF_W, h / REF_H) || 1;
        stage.style.transform = Math.abs(scale - 1) > 0.002 ? `scale(${scale})` : '';
    }
    window.addEventListener('resize', autoScale);
    autoScale();

    // Slice26's palette (lime side 1 / teal side 2) isn't exposed as a
    // settings-driven color anywhere else, so it's hardcoded here to match
    // the package's other themed elements.
    const SLICE26_SIDE_COLOR = { 1: '#C5F707', 2: '#57E0E7' };

    function update(state, settings) {
        OverlayBase.applyDesignSettings('playername');
        const g = OverlayBase.deepGet;

        const designPackage = g(settings, 'overlays.global.designPackage', 'default');
        const tagColor = designPackage === 'slice26' ? SLICE26_SIDE_COLOR[TEAM] : null;
        if (tagColor) document.documentElement.style.setProperty('--tag-color', tagColor);
        else document.documentElement.style.removeProperty('--tag-color');

        const align = resolveAlign(g(settings, 'overlays.playername.align', 'auto'), TEAM);
        const prefix = resolvePrefixPosition(g(settings, 'overlays.playername.prefixPosition', 'above'));
        box.className = `pn-box pn-a-${align} pn-p-${prefix}`;

        nameEl.textContent = g(state, NAME_KEY, '');
        tagEl.textContent = g(state, TAG_KEY, '');
    }

    function dispose() {
        window.removeEventListener('resize', autoScale);
        root.remove();
    }

    return {
        update,
        dispose,
        shouldRender: (key) => key === NAME_KEY || key === TAG_KEY,
        shouldRenderSettings: (key) => key.startsWith('overlays.'),
    };
}
