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

  // ── Bundled Inter ──
  // Load the locally-packaged Inter face as early as possible (before render),
  // so every overlay has Inter available offline — both as the app's baseline
  // typeface and as the guaranteed fallback for any user-chosen font that fails
  // to load. Injected once; idempotent across overlays that also link it
  // statically. See /layout/lib/fonts/inter.css.
  if (!document.getElementById('bundled-inter-font')) {
    const interLink = document.createElement('link');
    interLink.id = 'bundled-inter-font';
    interLink.rel = 'stylesheet';
    interLink.href = '/layout/lib/fonts/inter.css';
    (document.head || document.documentElement).appendChild(interLink);
  }

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

  // ── Character/team asset ids ──
  // Character (and captain) art is keyed by the canonical HUD character id
  // (0-53), not by name — mirrors pyrio's LookupDicts.CHAR_NAME. Team logos
  // have no HUD-native id, so they're keyed by their own 0-47 enumeration —
  // mirrors pyrio's in_game_team_names_list index order. See
  // server/rio/pyrio/assets.py for the canonical source.
  const CHAR_IDS = {
    "Mario": 0, "Luigi": 1, "DK": 2, "Diddy": 3, "Peach": 4, "Daisy": 5,
    "Yoshi": 6, "Baby Mario": 7, "Baby Luigi": 8, "Bowser": 9, "Wario": 10,
    "Waluigi": 11, "Koopa(G)": 12, "Toad(R)": 13, "Boo": 14, "Toadette": 15,
    "Shy Guy(R)": 16, "Birdo": 17, "Monty": 18, "Bowser Jr": 19,
    "Paratroopa(R)": 20, "Pianta(B)": 21, "Pianta(R)": 22, "Pianta(Y)": 23,
    "Noki(B)": 24, "Noki(R)": 25, "Noki(G)": 26, "Bro(H)": 27,
    "Toadsworth": 28, "Toad(B)": 29, "Toad(Y)": 30, "Toad(G)": 31,
    "Toad(P)": 32, "Magikoopa(B)": 33, "Magikoopa(R)": 34, "Magikoopa(G)": 35,
    "Magikoopa(Y)": 36, "King Boo": 37, "Petey": 38, "Dixie": 39,
    "Goomba": 40, "Paragoomba": 41, "Koopa(R)": 42, "Paratroopa(G)": 43,
    "Shy Guy(B)": 44, "Shy Guy(Y)": 45, "Shy Guy(G)": 46, "Shy Guy(Bk)": 47,
    "Dry Bones(Gy)": 48, "Dry Bones(G)": 49, "Dry Bones(R)": 50,
    "Dry Bones(B)": 51, "Bro(F)": 52, "Bro(B)": 53,
  };

  const TEAM_IDS = {
    "Mario Heroes": 0, "Mario Fireballs": 1, "Mario Sunshines": 2, "Mario All Stars": 3,
    "Luigi Gentlemen": 4, "Luigi Vacuums": 5, "Luigi Mansioneers": 6, "Luigi Leapers": 7,
    "Peach Roses": 8, "Peach Dynasties": 9, "Peach Monarchs": 10, "Peach Princesses": 11,
    "Daisy Lillies": 12, "Daisy Cupids": 13, "Daisy Queen Bees": 14, "Daisy Petals": 15,
    "Yoshi Eggs": 16, "Yoshi Speed Stars": 17, "Yoshi Islanders": 18, "Yoshi Flutters": 19,
    "Birdo Beauties": 20, "Birdo Models": 21, "Birdo Bows": 22, "Birdo Fans": 23,
    "Wario Garlics": 24, "Wario Steakheads": 25, "Wario Greats": 26, "Wario Beasts": 27,
    "Waluigi Mystiques": 28, "Waluigi Smart Alecks": 29, "Waluigi Flankers": 30, "Waluigi Mashers": 31,
    "DK Explorers": 32, "DK Wild Ones": 33, "DK Kongs": 34, "DK Animals": 35,
    "Diddy Survivors": 36, "Diddy Ninjas": 37, "Diddy Tails": 38, "Diddy Red Caps": 39,
    "Bowser Flames": 40, "Bowser Blue Shells": 41, "Bowser Monsters": 42, "Bowser Black Stars": 43,
    "Jr Fangs": 44, "Jr Bombers": 45, "Jr Pixies": 46, "Jr Rookies": 47,
  };

  function charId(name) { return CHAR_IDS[name]; }
  function teamId(teamName) { return TEAM_IDS[teamName]; }

  // ── Image helpers ──
  function charImg(name, cls, size) {
    const id = charId(name);
    if (id === undefined) return '';
    const s = size ? `width:${size}px;height:${size}px;` : '';
    return `<img class="${cls}" src="${BASE_URL}/game_assets/msb/characterIcons/${id}.png" style="${s}" onerror="this.style.display='none'" />`;
  }

  function logoImg(teamName, cls) {
    const id = teamId(teamName);
    if (id === undefined) return '';
    return `<img class="${cls}" src="${BASE_URL}/game_assets/msb/teamLogos/${id}.png" onerror="this.style.display='none'" />`;
  }

  // ── State & settings stores ──
  const state = {};
  const settings = {};

  // ── Preview-mode flags (read from URL params) ──
  // ?preview=1               — running in the Layouts-tab preview iframe
  // ?preview_globals_only=1  — ignore per-layout style overrides; show what
  //                            the Design tab globals look like in isolation
  const previewParams = new URLSearchParams(window.location.search);
  const PREVIEW_MODE = previewParams.get('preview') === '1';
  const PREVIEW_GLOBALS_ONLY = previewParams.get('preview_globals_only') === '1';

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
      render: renderCb,
      shouldRender = () => true,
      shouldRenderSettings = () => false,
      fetchSettings = false,
      // When true, skip all state fetches and state socket events. Used by
      // preview-mode overlays that prime `state` themselves from a static
      // sample JSON and don't want server state racing in over the top.
      skipState = false,
    } = opts;

    // Serialize renders. Load alone fires render() up to three times in quick
    // succession (REST fetch, socket state.get, socket settings.get), and most
    // mounts' update() is async (theme SVG fetch, GSAP load) — letting those
    // interleave double-injects themes and double-plays reveal animations (the
    // on-load appear/vanish/reappear stutter). One render runs at a time; calls
    // that arrive mid-render coalesce into a single follow-up pass (state is
    // already mutated by the time render is called, so one pass catches up).
    let rendering = false, renderAgain = false;
    async function render() {
      if (rendering) { renderAgain = true; return; }
      rendering = true;
      try {
        do { renderAgain = false; await renderCb(); } while (renderAgain);
      } catch (e) {
        console.warn('[OverlayBase] render failed:', e);
      } finally {
        rendering = false;
      }
    }

    // Initial REST fetch
    try {
      const fetches = [];
      if (!skipState) fetches.push(fetch(`${BASE_URL}/api/v1/state`));
      if (fetchSettings) fetches.push(fetch(`${BASE_URL}/api/v1/settings`));

      const responses = await Promise.all(fetches);
      let i = 0;
      if (!skipState) {
        if (responses[i]?.ok) Object.assign(state, await responses[i].json());
        i++;
      }
      if (fetchSettings && responses[i]?.ok) Object.assign(settings, await responses[i].json());
      render();
    } catch (e) {
      console.warn('[OverlayBase] Initial fetch failed:', e.message);
    }

    // SocketIO connection
    const socket = io(BASE_URL, { transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      console.log('[OverlayBase] SocketIO connected');

      if (!skipState) {
        socket.emit('v1.state.get', {}, (fullState) => {
          if (fullState && !fullState.error) {
            // Clear and repopulate (preserves object reference)
            for (const k of Object.keys(state)) delete state[k];
            Object.assign(state, fullState);
            render();
          }
        });
      }

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

    // State events (suppressed in skipState mode)
    if (!skipState) {
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

      // Batched unset — the mirror of set_batch. The store's deleteItems() emits
      // this; without handling it, clears (e.g. clearing production.feed.split)
      // never reach overlays and the old value lingers.
      socket.on('v1.state.unset_batch', (msg) => {
        if (msg.sid === socket.id) return;
        let needs = false;
        for (const item of msg.items) {
          deepUnset(state, item.key);
          if (shouldRender(item.key)) needs = true;
        }
        if (needs) render();
      });
    }

    // Universal action bus — ephemeral one-shot cues, never stored in state.
    // overlay.conceal: the app is about to disable this browser source in OBS.
    // Snap transparent NOW, while OBS is still compositing our frames, so the
    // texture it retains for the hidden source holds a transparent frame (see
    // onObsShown). Re-broadcast as a window event so consumers wired before
    // this socket existed still hear it.
    socket.on('v1.action', (msg) => {
      if (!msg || !msg.action) return;
      if (msg.action === 'overlay.conceal' && urlAddressesSelf(msg.payload && msg.payload.url)) {
        window.dispatchEvent(new CustomEvent('prshConceal'));
      }
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
  // `nsKey` optionally overrides the settings sub-namespace the per-layout
  // override reads use (defaults to layoutType). The Scorecard passes
  // `scorecard.{N}` so each scoreboard's card keeps an independent set of
  // style-override pins; the type-specific branches below still key on the
  // plain layoutType (none of them is the scorecard).
  function applyDesignSettings(layoutType, nsKey) {
    const root = document.documentElement.style;
    // In globals-only preview mode, suppress per-layout reads so the iframe
    // shows what the Design tab settings produce in isolation.
    const effectiveLayoutType = PREVIEW_GLOBALS_ONLY ? null : layoutType;
    const overrideNs = PREVIEW_GLOBALS_ONLY ? null : (nsKey || layoutType);
    const g = (key, def) => deepGet(settings, key, def);

    // ── Global defaults ──
    const globalAccent = g('overlays.global.accentColor', '#f59e0b');
    const globalCardBg = g('overlays.global.cardBg', 'rgba(15, 15, 25, 0.88)');
    const globalText = g('overlays.global.textColor', '#ffffff');
    const globalRadius = g('overlays.global.borderRadius', 16);
    const globalBorder = g('overlays.global.borderColor', 'rgba(255, 255, 255, 0.08)');
    const globalFont = g('overlays.global.fontFamily', 'Inter');

    // ── Per-layout accent override (kept for advanced "Add override" feature) ──
    const perAccent = overrideNs ? g(`overlays.${overrideNs}.accentColor`, null) : null;
    const accent = perAccent || globalAccent;

    root.setProperty('--accent', accent);
    root.setProperty('--accent-rgb', hexToRgb(accent));
    const globalBorderWidth = g('overlays.global.borderWidth', 1);
    root.setProperty('--card-bg', globalCardBg);
    root.setProperty('--text-primary', globalText);
    root.setProperty('--border-radius', globalRadius + 'px');
    root.setProperty('--border-width', globalBorderWidth + 'px');
    root.setProperty('--border-color', globalBorder);
    // Per-layout font override (e.g. Event Header pinning a system font) wins
    // over the global Design-tab choice.
    const perFont = overrideNs ? g(`overlays.${overrideNs}.fontFamily`, null) : null;
    const effFont = perFont || globalFont;
    // Inter (bundled locally, injected above) is the guaranteed fallback when the
    // chosen font isn't available/loaded; system sans-serif is the last resort.
    root.setProperty('--font-family', `'${effFont}', 'Inter', sans-serif`);

    // ── Promoted-to-global "final badge" color, with optional per-layout override ──
    const globalBadge = g('overlays.global.finalBadgeColor', null);
    const perBadge = overrideNs ? g(`overlays.${overrideNs}.finalBadgeColor`, null) : null;
    const effBadge = perBadge || globalBadge;
    if (effBadge) root.setProperty('--final-badge-color', effBadge);
    else root.removeProperty('--final-badge-color');

    // Dynamically load the selected font from Google Fonts (Inter ships bundled
    // locally — injected at startup above — so it never needs a Google fetch).
    if (effFont && effFont !== 'Inter') {
      const href = `https://fonts.googleapis.com/css2?family=${effFont.replace(/ /g, '+')}:wght@400;700&display=swap`;
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

    const perCardBlur = overrideNs ? g(`overlays.${overrideNs}.cardShadowBlur`, null) : null;
    const perTextBlur = overrideNs ? g(`overlays.${overrideNs}.textShadowBlur`, null) : null;
    const effCardBlur = perCardBlur != null ? perCardBlur : cardShadowBlur;
    const effTextBlur = perTextBlur != null ? perTextBlur : textShadowBlur;

    root.setProperty('--card-shadow-filter',
      showShadow ? `drop-shadow(0 4px ${effCardBlur}px ${cardShadowColor})` : 'none');
    root.setProperty('--card-box-shadow',
      showShadow ? `0 4px ${effCardBlur}px ${cardShadowColor}` : 'none');
    root.setProperty('--text-shadow',
      textShadowEnabled ? `0px 0px ${effTextBlur}px ${textShadowColor}` : 'none');

    // ── Per-overlay specific vars ──
    // All per-layout reads gated by effectiveLayoutType so globals-only
    // preview mode shows the design system in isolation.
    if (effectiveLayoutType === 'scoreboard') {
      const cardBg       = g('overlays.scoreboard.cardBg',       null);
      const borderColor  = g('overlays.scoreboard.borderColor',  null);
      const borderRadius = g('overlays.scoreboard.borderRadius', null);
      const borderWidth  = g('overlays.scoreboard.borderWidth',  null);
      const textColor    = g('overlays.scoreboard.textColor',    null);
      if (cardBg)             root.setProperty('--card-bg',        cardBg);
      if (borderColor)        root.setProperty('--border-color',   borderColor);
      if (borderRadius != null) root.setProperty('--border-radius', borderRadius + 'px');
      if (borderWidth  != null) root.setProperty('--border-width',  borderWidth  + 'px');
      if (textColor)          root.setProperty('--text-primary',   textColor);
    }
    // The combined Roster + Stats element hosts the same stat card under its own
    // 'rosterstats' namespace, so it resolves the same app-var overrides here.
    if (effectiveLayoutType === 'stats' || effectiveLayoutType === 'rosterstats') {
      const t = effectiveLayoutType;
      const cardBg        = g(`overlays.${t}.cardBg`,        null);
      const borderColor   = g(`overlays.${t}.borderColor`,   null);
      const borderRadius  = g(`overlays.${t}.borderRadius`,  null);
      const borderWidth   = g(`overlays.${t}.borderWidth`,   null);
      const statValueColor = g(`overlays.${t}.statValueColor`, null);
      const subtextColor   = g(`overlays.${t}.subtextColor`,   null);
      if (cardBg)             root.setProperty('--card-bg',       cardBg);
      if (borderColor)        root.setProperty('--border-color',  borderColor);
      if (borderRadius != null) root.setProperty('--border-radius', borderRadius + 'px');
      if (borderWidth  != null) root.setProperty('--border-width',  borderWidth  + 'px');
      if (statValueColor) root.setProperty('--stat-value-color',  statValueColor);
      else root.removeProperty('--stat-value-color');
      if (subtextColor)   root.setProperty('--stat-subtext-color', subtextColor);
      else root.removeProperty('--stat-subtext-color');
    }
    if (effectiveLayoutType === 'bracket') {
      const connColor = g('overlays.bracket.connectorColor', null);
      const activeColor = g('overlays.bracket.activeColor', null);
      if (connColor) root.setProperty('--connector-color', connColor);
      else root.removeProperty('--connector-color');
      if (activeColor) root.setProperty('--active-color', activeColor);
      else root.removeProperty('--active-color');
    }
    if (effectiveLayoutType === 'playername') {
      const textColor = g('overlays.playername.textColor', null);
      if (textColor) root.setProperty('--text-primary', textColor);
    }
  }

  // Every inline :root property applyDesignSettings may set. Kept adjacent so
  // the two stay in sync.
  const DESIGN_SETTING_PROPS = [
    '--accent', '--accent-rgb', '--card-bg', '--text-primary', '--border-radius',
    '--border-width', '--border-color', '--font-family', '--final-badge-color',
    '--card-shadow-filter', '--card-box-shadow', '--text-shadow',
    '--stat-value-color', '--stat-subtext-color', '--connector-color', '--active-color',
  ];

  /**
   * Remove everything applyDesignSettings set on :root. Design-package themes
   * that bring a fixed palette (no data-design-vars="app" on their root <svg>)
   * call this via their mount so a leftover app-design accent from a previously
   * active theme can never repaint them — stylesheet values (e.g. the Rio
   * tokens.css brand vars) resolve again.
   */
  function clearDesignSettings() {
    const root = document.documentElement.style;
    for (const p of DESIGN_SETTING_PROPS) root.removeProperty(p);
  }

  // ── Backward-compatible alias ──
  function applyAccentColor(layoutType, fallback) {
    applyDesignSettings(layoutType);
  }

  /**
   * Read an overlay setting with the standard per-layout-override-then-global
   * fallback chain. Honors the ?preview_globals_only=1 flag: when set, the
   * per-layout override is suppressed so the iframe shows the design system
   * in isolation. Use this for any setting promoted to global in v2.
   */
  function readSetting(layoutType, key, def) {
    if (!PREVIEW_GLOBALS_ONLY && layoutType) {
      const perLayout = deepGet(settings, `overlays.${layoutType}.${key}`, null);
      if (perLayout !== null) return perLayout;
    }
    return deepGet(settings, `overlays.global.${key}`, def);
  }

  /**
   * Returns the URL for the uploaded overlay logo.
   * Overlays can call this in render() to conditionally display the logo.
   */
  function brandingLogoUrl() {
    return `${BASE_URL}/branding/tournament_logo.png`;
  }

  /**
   * Does `url` address THIS page? Host-agnostic (OBS may load us via
   * localhost while the app knows us as 127.0.0.1 or a LAN address): compares
   * path plus query, params order-insensitively.
   */
  function urlAddressesSelf(url) {
    if (!url) return false;
    try {
      const u = new URL(url, window.location.href);
      if (u.pathname !== window.location.pathname) return false;
      const norm = (sp) => [...sp.entries()].sort().map(([k, v]) => `${k}=${v}`).join('&');
      return norm(u.searchParams) === norm(new URLSearchParams(window.location.search));
    } catch {
      return false;
    }
  }

  /**
   * Combined OBS on-screen signal. Two independent OBS events decide whether a
   * browser source is actually on screen: a scene cut fires
   * `obsSourceActiveChanged`, toggling the source's own eye icon fires
   * `obsSourceVisibleChanged`. Overlays that animate on show must honour BOTH —
   * listening only to `active` is how an eye-toggle-off left stale full-alpha
   * frames to flash on the next show. Each signal is tri-state (undefined until
   * OBS first dispatches it); the source counts as shown unless a signal says
   * otherwise, so a plain browser (no OBS, no events) stays shown.
   *
   * A third input is PRSH's own `overlay.conceal` cue (init's v1.action
   * handler → the `prshConceal` window event): the app fires it right before
   * disabling this browser source, because OBS stops the source's frame
   * production the instant the eye goes off — a hide that waits for
   * obsSourceVisibleChanged(false) never gets its dark frame painted, and the
   * retained full-alpha texture flashes on the next show. Concealing counts as
   * not-shown; the handshake ends at the next real visibleChanged dispatch,
   * with a failsafe re-emit so a failed OBS call can't strand the overlay
   * dark on air.
   *
   * cb(shown) fires on every dispatch, including redundant ones — consumers
   * (reveal-gate.js, commentary's setActive) dedupe themselves.
   */
  function onObsShown(cb) {
    let active, visible, concealed = false, concealTimer = null;
    const emit = () => cb(!concealed && active !== false && visible !== false);
    window.addEventListener('obsSourceActiveChanged', (e) => {
      active = !!(e.detail && e.detail.active); emit();
    });
    window.addEventListener('obsSourceVisibleChanged', (e) => {
      visible = !!(e.detail && e.detail.visible);
      // The eye actually toggled — the conceal handshake (if any) is done.
      concealed = false;
      if (concealTimer) { clearTimeout(concealTimer); concealTimer = null; }
      emit();
    });
    window.addEventListener('prshConceal', () => {
      concealed = true;
      emit();
      if (concealTimer) clearTimeout(concealTimer);
      concealTimer = setTimeout(() => {
        concealTimer = null;
        if (concealed) { concealed = false; emit(); }
      }, 2000);
    });
  }

  // ── Export ──
  window.OverlayBase = {
    BASE_URL,
    state,
    settings,
    deepGet,
    deepSet,
    deepUnset,
    charId,
    teamId,
    charImg,
    logoImg,
    applyAccentColor,
    applyDesignSettings,
    clearDesignSettings,
    brandingLogoUrl,
    onObsShown,
    readSetting,
    PREVIEW_MODE,
    PREVIEW_GLOBALS_ONLY,
    init,
  };
})();
