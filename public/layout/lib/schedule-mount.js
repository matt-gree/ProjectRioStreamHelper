/*
 * schedule-mount.js — Upcoming Schedule.
 *
 * Renders `schedule.queue` (an ordered list of match ids) with each match
 * resolved live from `match.{M}.*`, so a fixture edit re-renders with no
 * projector behind it. Queue authoring lives on the Production page.
 *
 * PLACEHOLDER VISUAL: a plain centred card list, deliberately unthemed — the
 * design-package treatment (a `schedule.svg` slot contract) is a follow-up. The
 * data flow is final: keep reading `schedule.*` + `match.*` when restyling.
 *
 * Styles are injected and class-scoped (`.sch-*`) rather than left in the page,
 * because this mount also runs inside a container shell that has no stylesheet
 * of its own.
 */

const CSS = `
.sch-host {
  position: fixed; inset: 0; display: none;
  flex-direction: column; align-items: center; justify-content: center;
  font-family: var(--font-display, 'Rajdhani', system-ui, sans-serif);
}
.sch-host.sch-on { display: flex; }
.sch-title {
  color: var(--ink, #fff); font-size: 52px; font-weight: 700;
  letter-spacing: 2px; margin-bottom: 28px; text-transform: uppercase;
}
.sch-list { display: flex; flex-direction: column; gap: 14px; width: 900px; }
.sch-row {
  display: flex; align-items: center; gap: 20px;
  background: var(--band, rgba(10,10,18,0.92));
  border: 1.5px solid var(--border, rgba(255,255,255,0.09));
  border-left: 8px solid var(--accent, #e60012);
  border-radius: 14px; padding: 18px 28px;
}
.sch-row.sch-done { opacity: 0.45; }
.sch-row.sch-live { border-left-color: #43a047; }
.sch-names { flex: 1; color: var(--ink, #fff); font-size: 34px; font-weight: 700; }
.sch-names .sch-vs { color: var(--ink-dim, #9aa); font-size: 24px; margin: 0 12px; }
.sch-label { color: var(--ink-dim, #9aa); font-size: 22px; font-weight: 600; }
.sch-time { color: var(--accent, #e60012); font-size: 26px; font-weight: 700; min-width: 120px; text-align: right; }
.sch-livetag { color: #43a047; font-size: 22px; font-weight: 700; letter-spacing: 2px; }
`;

let cssInjected = false;
function injectCss() {
    if (cssInjected) return;
    const style = document.createElement('style');
    style.id = 'schedule-mount-css';
    style.textContent = CSS;
    document.head.appendChild(style);
    cssInjected = true;
}

const esc = (s) => String(s ?? '').replace(
    /[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]),
);

export function mountSchedule({ host }) {
    injectCss();
    const root = document.createElement('div');
    root.className = 'sch-host';
    const titleEl = document.createElement('div');
    titleEl.className = 'sch-title';
    const listEl = document.createElement('div');
    listEl.className = 'sch-list';
    root.append(titleEl, listEl);
    host.appendChild(root);

    function update(state) {
        const g = OverlayBase.deepGet;
        const queue = g(state, 'schedule.queue', []) || [];
        const matches = g(state, 'match', {}) || {};
        // A queued id whose match is gone renders as nothing rather than as a
        // blank row — `schedule.queue` is a projection and can name a fixture
        // that has just been deleted.
        const rows = queue.map((id) => ({ id, m: matches[String(id)] })).filter((r) => r.m);
        root.classList.toggle('sch-on', rows.length > 0);
        if (!rows.length) { listEl.innerHTML = ''; return; }

        titleEl.textContent = g(state, 'schedule.title', '') || 'Upcoming Matches';
        listEl.innerHTML = rows.map(({ m }) => {
            const p1 = m?.player?.['1']?.rioName || m?.player?.[1]?.rioName || 'TBD';
            const p2 = m?.player?.['2']?.rioName || m?.player?.[2]?.rioName || 'TBD';
            const decided = m?.decided === 1 || m?.decided === 2
                || m?.decided === '1' || m?.decided === '2';
            const live = !decided && m?.stage === 'live';
            const cls = decided ? 'sch-row sch-done' : (live ? 'sch-row sch-live' : 'sch-row');
            const right = live ? '<span class="sch-livetag">LIVE</span>'
                : `<span class="sch-time">${esc(m?.scheduledAt || '')}</span>`;
            return `<div class="${cls}">
          <span class="sch-names">${esc(p1)}<span class="sch-vs">vs</span>${esc(p2)}</span>
          <span class="sch-label">${esc(m?.label || '')}</span>
          ${right}
        </div>`;
        }).join('');
    }

    function dispose() { root.remove(); }

    return {
        update,
        dispose,
        shouldRender: (key) => key.startsWith('schedule.') || key.startsWith('match.'),
    };
}
