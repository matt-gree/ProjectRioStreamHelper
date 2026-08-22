/*
 * teamlogo-mount.js — one side's MSB team logo, as its own OBS source.
 *
 * Draws the banner the producer set for a side (`score.{N}.player.{T}.logo`),
 * falling back to the team the roster implies (`…player.{T}.msb_team`) when no
 * banner is set. The image comes from the user's own asset pack — PRSH ships no
 * MSB art — so a missing file hides the element rather than showing a broken
 * image.
 *
 * Styles are injected and class-scoped (`.tl-*`) rather than left in the page,
 * because this mount also runs inside a container shell that has no stylesheet
 * of its own.
 *
 *   const tl = mountTeamLogo({ host, sb, team });
 *   tl.update(OverlayBase.state);
 *
 * Requires overlay-base.js (OverlayBase).
 */

const REF = 360;

const CSS = `
.tl-root { position: absolute; inset: 0; overflow: hidden; }
.tl-stage {
  position: absolute; left: 0; top: 0;
  width: ${REF}px; height: ${REF}px;
  transform-origin: top left;
  display: flex; align-items: center; justify-content: center;
}
.tl-img { width: ${REF}px; height: ${REF}px; object-fit: contain; }
`;

let cssInjected = false;
function injectCss() {
    if (cssInjected) return;
    const style = document.createElement('style');
    style.id = 'teamlogo-mount-css';
    style.textContent = CSS;
    document.head.appendChild(style);
    cssInjected = true;
}

export function mountTeamLogo({ host, sb = 1, team = 1 }) {
    injectCss();
    const SCOREBOARD = Number(sb) || 1;
    const TEAM = Number(team) === 2 ? 2 : 1;

    // Prefer the explicit in-game banner (player.T.logo); fall back to the
    // roster-derived team name (msb_team) when no banner is set.
    const LOGO_KEY = `score.${SCOREBOARD}.player.${TEAM}.logo`;
    const TEAM_KEY = `score.${SCOREBOARD}.player.${TEAM}.msb_team`;

    const root = document.createElement('div');
    root.className = 'tl-root';
    const stage = document.createElement('div');
    stage.className = 'tl-stage';
    root.appendChild(stage);
    host.appendChild(root);

    function autoScale() {
        if (OverlayBase.PREVIEW_MODE) { stage.style.transform = ''; return; }
        const w = root.clientWidth || window.innerWidth;
        const h = root.clientHeight || window.innerHeight;
        const scale = Math.min(w / REF, h / REF) || 1;
        stage.style.transform = Math.abs(scale - 1) > 0.002 ? `scale(${scale})` : '';
    }
    window.addEventListener('resize', autoScale);
    autoScale();

    function update(state) {
        const { deepGet: g, teamId, BASE_URL } = OverlayBase;
        stage.innerHTML = '';
        const teamName = g(state, LOGO_KEY) || g(state, TEAM_KEY);
        const id = teamId(teamName);
        if (id === undefined) return;
        const img = document.createElement('img');
        img.src = `${BASE_URL}/game_assets/msb/teamLogos/${id}.png`;
        img.className = 'tl-img';
        img.onerror = () => { img.style.display = 'none'; };
        stage.appendChild(img);
    }

    function dispose() {
        window.removeEventListener('resize', autoScale);
        root.remove();
    }

    return {
        update,
        dispose,
        shouldRender: (key) => key === LOGO_KEY || key === TEAM_KEY,
    };
}
