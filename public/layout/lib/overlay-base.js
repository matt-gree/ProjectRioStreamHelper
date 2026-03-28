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
    return cur !== undefined ? cur : def;
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

  // ── Accent color helper ──
  /**
   * Read accentColor from settings for a given layout type and set CSS custom
   * properties on the document root. Call this inside render() so it stays
   * in sync with live settings changes.
   *
   * Sets: --accent (hex), --accent-rgb (r, g, b for rgba usage)
   */
  function applyAccentColor(layoutType, fallback) {
    const hex = deepGet(settings, `overlays.${layoutType}.accentColor`, fallback || '#f59e0b');
    document.documentElement.style.setProperty('--accent', hex);
    // Parse hex to RGB for rgba() usage
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    document.documentElement.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
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
    init,
  };
})();
