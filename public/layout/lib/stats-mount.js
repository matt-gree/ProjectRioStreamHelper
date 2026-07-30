// stats-mount.js — reusable mount for the fed Stats element.
//
// Renders the producer-picked character's stat line into a host element, so any
// shared container (Stats, Split-Screen, …) can host it. Mirrors the original
// stand-alone stats-feed overlay, but driven by an explicit selection object
// rather than reading production.feed.stats directly — the container owns the
// feed key and passes the selection in.
//
//   const m = mountStats({ host });
//   m.update(OverlayBase.state, { scoreboard, team, charIndex, role });
//   m.dispose();
//
// Requires overlay-base.js (OverlayBase) and rio-data.js (RioData) loaded first.

const REF_W = 325, REF_H = 120;
let _cssInjected = false;

// The card CSS travels with the module so it renders in any container, not just
// the original stats-feed.html. Scoped under .sm-root to avoid collisions.
const CSS = `
.sm-root { position: absolute; inset: 0; overflow: visible; }
.sm-wrap { transform-origin: top left; }
.sm-root .stats-bar {
  width: ${REF_W}px; box-sizing: border-box;
  background: var(--card-bg, rgba(20, 20, 30, 0.92));
  border: var(--border-width, 1px) solid var(--border-color, rgba(255, 255, 255, 0.08));
  border-radius: var(--border-radius, 12px);
  padding: 4px 6px; color: var(--text-primary, #fff);
  box-shadow: var(--card-box-shadow, none);
  opacity: 1; transition: opacity 0.3s ease;
  display: flex; flex-direction: column;
  font-family: var(--font-family, 'Inter', sans-serif);
  text-shadow: var(--text-shadow, none);
}
.sm-root .top-row { display: flex; flex-direction: row; align-items: flex-start; }
.sm-root .stats-inner { display: flex; flex-direction: column; }
.sm-root .stats-inner.content-out { opacity: 0; transition: opacity 0.2s ease; }
@keyframes sm-contentIn { from { opacity: 0; } to { opacity: 1; } }
.sm-root .stats-inner.content-in { animation: sm-contentIn 0.25s ease forwards; }
@keyframes sm-statValueFlash {
  0%   { color: var(--stat-value-color, var(--text-primary, #fff)); }
  35%  { color: var(--accent-color, #f59e0b); }
  100% { color: var(--stat-value-color, var(--text-primary, #fff)); }
}
.sm-root .stat-value.stat-changed { animation: sm-statValueFlash 0.6s ease forwards; }
.sm-root .hidden { display: none !important; }
.sm-root .char-icon-wrap { flex-shrink: 0; display: flex; align-items: flex-start; }
.sm-root .char-icon-wrap img { height: 40px; width: auto; object-fit: contain; border-radius: 4px; }
.sm-root .stats-content { flex: 1; min-width: 0; padding-left: 12px; padding-right: 8px; }
.sm-root .batting-line {
  font-size: 13px; font-weight: 600; color: var(--stat-subtext-color, rgb(155, 155, 155));
  white-space: nowrap; overflow: visible; text-align: center; padding-top: 4px;
  border-top: 2px solid var(--border-color, rgb(255, 255, 255)); margin-top: 4px;
}
.sm-root .batting-line span { color: var(--stat-subtext-color, rgb(155, 155, 155)); }
.sm-root .stats-row { display: flex; justify-content: space-between; width: 100%; }
.sm-root .stat { display: flex; flex-direction: column; align-items: left; }
.sm-root .stat-value {
  font-size: 20px; font-weight: 700; line-height: 1.2; white-space: nowrap;
  color: var(--stat-value-color, var(--text-primary, #fff));
}
.sm-root .stat-label {
  font-size: 12px; font-weight: 400; color: var(--stat-subtext-color, rgb(155, 155, 155));
  text-transform: uppercase; letter-spacing: 0.3px; line-height: 1.2;
}`;

function injectCss() {
  if (_cssInjected) return;
  const style = document.createElement('style');
  style.id = 'stats-mount-css';
  style.textContent = CSS;
  document.head.appendChild(style);
  _cssInjected = true;
}

export function mountStats({ host }) {
  injectCss();

  const root = document.createElement('div');
  root.className = 'sm-root';
  const wrap = document.createElement('div');
  wrap.className = 'sm-wrap';
  const bar = document.createElement('div');
  bar.className = 'stats-bar hidden';
  wrap.appendChild(bar);
  root.appendChild(wrap);
  host.appendChild(root);

  let prevCharName = '';
  let prevStats = null;

  /*
   * Scale the card to the box it was given (relative to its native ref), so a
   * bigger source enlarges it.
   *
   * MEASURES ITS OWN HOST, not the window. `.sm-root` is `inset: 0`, so in a
   * dedicated source the two are the same number — but inside a shared CONTAINER
   * this mount is handed a 325×120 box centered in a container that may be
   * 1920×1080, and scaling to the window there would blow the card up ~6× and
   * out of the box it is centered in. A member never scales to its container;
   * that is the whole reason centering is allowed where scaling is not.
   */
  function autoScale() {
    if (OverlayBase.PREVIEW_MODE) { wrap.style.transform = ''; return; }
    const w = root.clientWidth || window.innerWidth;
    const h = root.clientHeight || window.innerHeight;
    const scale = Math.min(w / REF_W, h / REF_H);
    wrap.style.transform = Math.abs(scale - 1) > 0.001 ? `scale(${scale})` : '';
  }
  window.addEventListener('resize', autoScale);
  autoScale();

  function getTextShadow() {
    const { deepGet: g, settings } = OverlayBase;
    if (!g(settings, 'overlays.global.textShadowEnabled', false)) return '';
    const blur = g(settings, 'overlays.stats.textShadowBlur', null) ?? g(settings, 'overlays.global.textShadowBlur', 4);
    const color = g(settings, 'overlays.global.textShadowColor', 'rgba(0,0,0,0.8)');
    return `0px 0px ${blur}px ${color}`;
  }
  function applyTextShadow() {
    const shadow = getTextShadow();
    bar.querySelectorAll('.stat-value, .stat-label, .batting-line').forEach(el => { el.style.textShadow = shadow; });
  }
  function getStatsMap() {
    const map = {};
    bar.querySelectorAll('.stat[data-label]').forEach(el => {
      const valEl = el.querySelector('.stat-value');
      if (valEl) map[el.dataset.label] = valEl.textContent;
    });
    return map;
  }
  function flashChangedStats(oldStats) {
    if (!oldStats) return;
    bar.querySelectorAll('.stat[data-label]').forEach(el => {
      const valEl = el.querySelector('.stat-value');
      if (!valEl) return;
      if (el.dataset.label in oldStats && oldStats[el.dataset.label] !== valEl.textContent) {
        valEl.classList.remove('stat-changed');
        void valEl.offsetWidth;
        valEl.classList.add('stat-changed');
      }
    });
  }
  function canUpdateInPlace(info) {
    if (bar.classList.contains('hidden')) return false;
    if (!bar.querySelector('.stats-inner')) return false;
    const labels = Array.from(bar.querySelectorAll('.stat[data-label]')).map(el => el.dataset.label);
    const newLabels = info.stats.map(s => s.label);
    if (labels.length !== newLabels.length) return false;
    for (let i = 0; i < labels.length; i++) if (labels[i] !== newLabels[i]) return false;
    const hasLine = !!bar.querySelector('.batting-line');
    const wantsLine = !!(info.gameLine || info.bottomLabel);
    return hasLine === wantsLine;
  }
  function updateStatsInPlace(info) {
    const img = bar.querySelector('.char-icon-wrap img');
    if (img && !img.src.endsWith(info.charIconUrl)) img.src = info.charIconUrl;
    bar.querySelectorAll('.stat[data-label]').forEach(el => {
      const next = info.stats.find(s => s.label === el.dataset.label);
      if (!next) return;
      const valEl = el.querySelector('.stat-value');
      const nextText = String(next.value);
      if (valEl && valEl.textContent !== nextText) valEl.textContent = nextText;
    });
    const line = bar.querySelector('.batting-line');
    if (line) {
      if (info.gameLine) {
        let span = line.querySelector('span');
        if (!span) { line.textContent = ''; span = document.createElement('span'); line.appendChild(span); }
        const labelText = info.bottomLabel + ': ';
        if (span.textContent !== labelText) span.textContent = labelText;
        while (line.childNodes.length > 1) line.removeChild(line.lastChild);
        line.appendChild(document.createTextNode(info.gameLine));
      } else if (info.bottomLabel) {
        if (line.textContent !== info.bottomLabel) line.textContent = info.bottomLabel;
      }
    }
  }
  function buildContent(info, animate = true) {
    const statsHtml = info.stats.map(st =>
      `<span class="stat" data-label="${st.label}"><span class="stat-value">${st.value}</span><span class="stat-label">${st.label}</span></span>`
    ).join('');
    let html = `<div class="stats-inner${animate ? ' content-in' : ''}">`;
    html += `<div class="top-row">`;
    html += `<div class="char-icon-wrap"><img src="${info.charIconUrl}" onerror="this.style.display='none'" /></div>`;
    html += `<div class="stats-content"><div class="stats-row">${statsHtml}</div></div>`;
    html += `</div>`;
    if (info.gameLine) html += `<div class="batting-line"><span>${info.bottomLabel}: </span>${info.gameLine}</div>`;
    else if (info.bottomLabel) html += `<div class="batting-line">${info.bottomLabel}</div>`;
    html += `</div>`;
    return html;
  }

  // sel = { scoreboard, team, charIndex, role }
  function update(state, sel) {
    OverlayBase.applyDesignSettings('stats');
    const sb = Number(sel?.scoreboard) || 1;
    const info = (sel && sel.charIndex != null)
      ? RioData.getStatsLineForChar(state, sb, Number(sel.team) || 1, Number(sel.charIndex), sel.role || 'batting')
      : null;
    if (!info) { bar.classList.add('hidden'); prevCharName = ''; return; }

    const { deepGet: g, settings } = OverlayBase;
    const useFade = (g(settings, 'overlays.stats.transitionType', 'fade') === 'fade');
    const changed = info.charName !== prevCharName;
    prevCharName = info.charName;

    if (changed && useFade && !bar.classList.contains('hidden')) {
      prevStats = null;
      const inner = bar.querySelector('.stats-inner');
      if (inner) {
        inner.classList.remove('content-in');
        inner.classList.add('content-out');
        setTimeout(() => { bar.innerHTML = buildContent(info); applyTextShadow(); prevStats = getStatsMap(); }, 200);
      } else {
        bar.innerHTML = buildContent(info); applyTextShadow(); prevStats = getStatsMap();
      }
    } else {
      const oldStats = changed ? null : prevStats;
      if (canUpdateInPlace(info)) {
        updateStatsInPlace(info);
        if (useFade) flashChangedStats(oldStats);
      } else {
        bar.innerHTML = buildContent(info, false);
        bar.classList.remove('hidden');
        applyTextShadow();
        if (useFade) flashChangedStats(oldStats);
      }
      prevStats = getStatsMap();
    }
  }

  function dispose() {
    window.removeEventListener('resize', autoScale);
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  // No-op so the container's activation-replay path is uniform across elements.
  function replay() {}

  return { update, dispose, replay };
}
