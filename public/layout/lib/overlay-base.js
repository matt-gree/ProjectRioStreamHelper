/**
 * OverlayBase — Shared infrastructure for OBS overlay HTML files.
 *
 * Loaded via <script src="/layout/lib/overlay-base.js"></script>
 * Provides deep dict helpers, SocketIO bootstrap, state/settings management,
 * and common image helpers. Each overlay calls OverlayBase.init() with its
 * render callback and optional key filters.
 */
(function () {
  'use strict';

  // ── Resolve server URL ──
  const BASE_URL = (window.location.protocol === 'file:')
    ? 'http://localhost:5260'
    : window.location.origin;

  // ── Deep dict helpers ──
  function deepGet(obj, path, def) {
    const keys = path.split('.');
    let cur = obj;
    for (const k of keys) {
      if (cur == null || typeof cur !== 'object') return def;
      cur = cur[k];
    }
    return (cur !== undefined && cur !== null) ? cur : def;
  }

  function deepSet(obj, path, value) {
    const keys = path.split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in cur) || typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null)
        cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
  }

  function deepUnset(obj, path) {
    const keys = path.split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (cur == null || typeof cur !== 'object') return;
      cur = cur[keys[i]];
    }
    if (cur != null && typeof cur === 'object') delete cur[keys[keys.length - 1]];
  }

  // ── Image helpers ──
  function charImg(name, cls, size) {
    if (!name) return '';
    const s = size ? `width:${size}px;height:${size}px;` : '';
    return `<img class="${cls}" src="${BASE_URL}/game_assets/rio_characterIcons/${encodeURIComponent(name)}.png" style="${s}" onerror="this.style.display='none'" />`;
  }

  function logoImg(teamName, cls) {
    if (!teamName) return '';
    return `<img class="${cls}" src="${BASE_URL}/game_assets/rio_teamLogos/${encodeURIComponent(teamName)}.png" onerror="this.style.display='none'" />`;
  }

  // ── State & settings stores ──
  const state = {};
  const settings = {};

  // ── Bootstrap ──
  /**
   * Initialize the overlay connection.
   * @param {Object} opts
   * @param {Function} opts.render           - Called when relevant state/settings change
   * @param {Function} [opts.shouldRender]   - (key) => bool — filter state keys (default: always true)
   * @param {Function} [opts.shouldRenderSettings] - (key) => bool — filter settings keys
   * @param {boolean}  [opts.fetchSettings]  - Whether to fetch & subscribe to settings (default: false)
   */
  async function init(opts) {
    const {
      render,
      shouldRender = () => true,
      shouldRenderSettings = () => false,
      fetchSettings = false,
    } = opts;

    // Initial REST fetch
    try {
      const fetches = [fetch(`${BASE_URL}/api/v1/state`)];
      if (fetchSettings) fetches.push(fetch(`${BASE_URL}/api/v1/settings`));

      const responses = await Promise.all(fetches);
      if (responses[0].ok) Object.assign(state, await responses[0].json());
      if (fetchSettings && responses[1]?.ok) Object.assign(settings, await responses[1].json());
      render();
    } catch (e) {
      console.warn('[OverlayBase] Initial fetch failed:', e.message);
    }

    // SocketIO connection
    const socket = io(BASE_URL, { transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      console.log('[OverlayBase] SocketIO connected');

      socket.emit('v1.state.get', {}, (fullState) => {
        if (fullState && !fullState.error) {
          // Clear and repopulate (preserves object reference)
          for (const k of Object.keys(state)) delete state[k];
          Object.assign(state, fullState);
          render();
        }
      });

      if (fetchSettings) {
        socket.emit('v1.settings.get', {}, (fullSettings) => {
          if (fullSettings && !fullSettings.error) {
            for (const k of Object.keys(settings)) delete settings[k];
            Object.assign(settings, fullSettings);
            render();
          }
        });
      }
    });

    socket.on('connect_error', (err) => {
      console.warn('[OverlayBase] SocketIO connect error:', err.message);
    });

    // State events
    socket.on('v1.state.set', (msg) => {
      if (msg.sid === socket.id) return;
      deepSet(state, msg.key, msg.value);
      if (shouldRender(msg.key)) render();
    });

    socket.on('v1.state.set_batch', (msg) => {
      if (msg.sid === socket.id) return;
      let needs = false;
      for (const item of msg.items) {
        deepSet(state, item.key, item.value);
        if (shouldRender(item.key)) needs = true;
      }
      if (needs) render();
    });

    socket.on('v1.state.unset', (msg) => {
      if (msg.sid === socket.id) return;
      deepUnset(state, msg.key);
      if (shouldRender(msg.key)) render();
    });

    // Settings events (opt-in)
    if (fetchSettings) {
      socket.on('v1.settings.set', (msg) => {
        if (msg.sid === socket.id) return;
        deepSet(settings, msg.key, msg.value);
        if (shouldRenderSettings(msg.key)) render();
      });

      socket.on('v1.settings.unset', (msg) => {
        if (msg.sid === socket.id) return;
        deepUnset(settings, msg.key);
        if (shouldRenderSettings(msg.key)) render();
      });
    }
  }

  // ── Hex → RGB helper ──
  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    return `${r}, ${g}, ${b}`;
  }

  // ── Design settings helper ──
  /**
   * Read all design settings and set CSS custom properties on the document root.
   * Call this inside render() so it stays in sync with live settings changes.
   *
   * Fallback chain for colors: per-layout → global → hardcoded default.
   *
   * Sets: --accent, --accent-rgb, --card-bg, --text-primary, --border-radius,
   *       --border-color, --font-family, and per-overlay specific vars.
   */
  function applyDesignSettings(layoutType) {
    const root = document.documentElement.style;
    const g = (key, def) => deepGet(settings, key, def);

    // ── Global defaults ──
    const globalAccent = g('overlays.global.accentColor', '#f59e0b');
    const globalCardBg = g('overlays.global.cardBg', 'rgba(15, 15, 25, 0.88)');
    const globalText = g('overlays.global.textColor', '#ffffff');
    const globalRadius = g('overlays.global.borderRadius', 16);
    const globalBorder = g('overlays.global.borderColor', 'rgba(255, 255, 255, 0.08)');
    const globalFont = g('overlays.global.fontFamily', 'Inter');

    // ── Per-layout accent override ──
    const perAccent = layoutType ? g(`overlays.${layoutType}.accentColor`, null) : null;
    const accent = perAccent || globalAccent;

    root.setProperty('--accent', accent);
    root.setProperty('--accent-rgb', hexToRgb(accent));
    const globalBorderWidth = g('overlays.global.borderWidth', 1);
    root.setProperty('--card-bg', globalCardBg);
    root.setProperty('--text-primary', globalText);
    root.setProperty('--border-radius', globalRadius + 'px');
    root.setProperty('--border-width', globalBorderWidth + 'px');
    root.setProperty('--border-color', globalBorder);
    root.setProperty('--font-family', `'${globalFont}', sans-serif`);

    // Dynamically load the selected font from Google Fonts (Inter is already in the static @import)
    if (globalFont && globalFont !== 'Inter') {
      const href = `https://fonts.googleapis.com/css2?family=${globalFont.replace(/ /g, '+')}:wght@400;700&display=swap`;
      let link = document.getElementById('dynamic-font-link');
      if (!link) {
        link = document.createElement('link');
        link.id = 'dynamic-font-link';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      if (link.href !== href) link.href = href;
    }

    // ── Shadow CSS vars (computed once, with per-layout blur override) ──
    const showShadow        = g('overlays.global.showShadow',        true);
    const cardShadowBlur    = g('overlays.global.cardShadowBlur',    16);
    const cardShadowColor   = g('overlays.global.cardShadowColor',   'rgba(0, 0, 0, 0.5)');
    const textShadowEnabled = g('overlays.global.textShadowEnabled', false);
    const textShadowBlur    = g('overlays.global.textShadowBlur',    4);
    const textShadowColor   = g('overlays.global.textShadowColor',   'rgba(0, 0, 0, 0.8)');

    const perCardBlur = layoutType ? g(`overlays.${layoutType}.cardShadowBlur`, null) : null;
    const perTextBlur = layoutType ? g(`overlays.${layoutType}.textShadowBlur`, null) : null;
    const effCardBlur = perCardBlur != null ? perCardBlur : cardShadowBlur;
    const effTextBlur = perTextBlur != null ? perTextBlur : textShadowBlur;

    root.setProperty('--card-shadow-filter',
      showShadow ? `drop-shadow(0 4px ${effCardBlur}px ${cardShadowColor})` : 'none');
    root.setProperty('--card-box-shadow',
      showShadow ? `0 4px ${effCardBlur}px ${cardShadowColor}` : 'none');
    root.setProperty('--text-shadow',
      textShadowEnabled ? `0px 0px ${effTextBlur}px ${textShadowColor}` : 'none');

    // ── Per-overlay specific vars ──
    if (layoutType === 'scoreboard') {
      const cardBg       = g('overlays.scoreboard.cardBg',       null);
      const borderColor  = g('overlays.scoreboard.borderColor',  null);
      const borderRadius = g('overlays.scoreboard.borderRadius', null);
      const borderWidth  = g('overlays.scoreboard.borderWidth',  null);
      const textColor    = g('overlays.scoreboard.textColor',    null);
      const badgeColor   = g('overlays.scoreboard.finalBadgeColor', null);
      if (cardBg)             root.setProperty('--card-bg',        cardBg);
      if (borderColor)        root.setProperty('--border-color',   borderColor);
      if (borderRadius != null) root.setProperty('--border-radius', borderRadius + 'px');
      if (borderWidth  != null) root.setProperty('--border-width',  borderWidth  + 'px');
      if (textColor)          root.setProperty('--text-primary',   textColor);
      if (badgeColor) root.setProperty('--final-badge-color', badgeColor);
      else root.removeProperty('--final-badge-color');
    }
    if (layoutType === 'stats') {
      const cardBg        = g('overlays.stats.cardBg',        null);
      const borderColor   = g('overlays.stats.borderColor',   null);
      const borderRadius  = g('overlays.stats.borderRadius',  null);
      const borderWidth   = g('overlays.stats.borderWidth',   null);
      const statValueColor = g('overlays.stats.statValueColor', null);
      const subtextColor   = g('overlays.stats.subtextColor',   null);
      if (cardBg)             root.setProperty('--card-bg',       cardBg);
      if (borderColor)        root.setProperty('--border-color',  borderColor);
      if (borderRadius != null) root.setProperty('--border-radius', borderRadius + 'px');
      if (borderWidth  != null) root.setProperty('--border-width',  borderWidth  + 'px');
      if (statValueColor) root.setProperty('--stat-value-color',  statValueColor);
      else root.removeProperty('--stat-value-color');
      if (subtextColor)   root.setProperty('--stat-subtext-color', subtextColor);
      else root.removeProperty('--stat-subtext-color');
    }
    if (layoutType === 'bracket') {
      const connColor = g('overlays.bracket.connectorColor', null);
      const activeColor = g('overlays.bracket.activeColor', null);
      if (connColor) root.setProperty('--connector-color', connColor);
      else root.removeProperty('--connector-color');
      if (activeColor) root.setProperty('--active-color', activeColor);
      else root.removeProperty('--active-color');
    }
  }

  // ── Backward-compatible alias ──
  function applyAccentColor(layoutType, fallback) {
    applyDesignSettings(layoutType);
  }

  /**
   * Returns the URL for the uploaded overlay logo.
   * Overlays can call this in render() to conditionally display the logo.
   */
  function brandingLogoUrl() {
    return `${BASE_URL}/branding/tournament_logo.png`;
  }

  // ── Export ──
  window.OverlayBase = {
    BASE_URL,
    state,
    settings,
    deepGet,
    deepSet,
    deepUnset,
    charImg,
    logoImg,
    applyAccentColor,
    applyDesignSettings,
    brandingLogoUrl,
    init,
  };
})();
