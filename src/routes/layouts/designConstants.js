// Layout/overlay design-system constants.
//
// Extracted from layouts.jsx so they can be imported without pulling in the
// whole (Mantine-heavy) LayoutBrowser component — used by the component and by
// designConstants.test.js. Pure data, no React.

// ── Per-layout-type element-only settings ──
// Settings unique to a specific overlay (not shared across the design system).
// Global design properties (accent, cardBg, shadow, etc.) live in
// overlays.global and are NOT duplicated here — users pin a per-layout override
// for any of those via the "+ Add style override" UI.
// Supported control types: 'switch', 'color-override', 'number-override', 'select'.
export const LAYOUT_SETTINGS = {
    scoreboard: [
        { key: 'showElo', type: 'switch', label: 'Show ELO', description: 'Display ELO ratings on completed games' },
        { key: 'showTeamLogos', type: 'switch', label: 'Show Team Logos', description: 'Display MSB team logos' },
    ],
    roster: [
        { key: 'showSuperstars', type: 'switch', label: 'Show Superstar Icons', description: 'Display superstar badge on starred characters' },
        { key: 'showRoleIcon', type: 'switch', label: 'Show Batting/Fielding Icon', description: 'Display the bat or glove icon indicating the team role' },
        { key: 'showTeamLogo', type: 'switch', label: 'Show Team Logo', description: 'Display the team logo next to the roster' },
    ],
    stats: [
        { key: 'transitionType', type: 'select', label: 'Batter Transition', description: 'Animation when switching to a new batter', options: [{ value: 'fade', label: 'Fade' }, { value: 'none', label: 'None' }], defaultValue: 'fade' },
        { key: 'statValueColor', type: 'color-override', label: 'Stat Value Color', description: 'Color of the main stat numbers (e.g. AVG, ERA)' },
        { key: 'subtextColor',   type: 'color-override', label: 'Subtext Color',    description: 'Color of stat labels and the game line text' },
    ],
    teamlogo: [],
    scene: [
        { key: 'team1ShowYouTube', type: 'switch', label: 'Player 1: Show YouTube', description: 'When on, shows the YouTube handle. When off, shows the Twitter/X handle.' },
        { key: 'team2ShowYouTube', type: 'switch', label: 'Player 2: Show YouTube', description: 'When on, shows the YouTube handle. When off, shows the Twitter/X handle.' },
    ],
    bracket: [
        { key: 'connectorColor', type: 'color-override', label: 'Connector Line Color', description: 'Color of bracket connector lines' },
        { key: 'activeColor', type: 'color-override', label: 'Active Match Color', description: 'Highlight color for active/in-progress matches' },
        { key: 'maxScale', type: 'number-override', label: 'Max Upscale', description: '1.0 = never enlarge past designed pixel sizes (small brackets stay native, centered). 1.5+ lets small brackets grow to fill the OBS source.', defaultValue: 1.0, min: 0.5, max: 3.0, step: 0.1 },
    ],
    ticker: [
        { key: 'tickerSpeed', type: 'number-override', label: 'Scroll Speed', description: 'Horizontal scroll rate of the ticker (pixels per second)', defaultValue: 60, min: 10, max: 300, step: 10, suffix: 'px/s' },
        { key: 'tickerGap', type: 'number-override', label: 'Card Spacing', description: 'Space between game cards (px)', defaultValue: 16, min: 0, max: 80, step: 2, suffix: 'px' },
    ],
    // Post-game full-screen Stat Callout (fed element). The mount reads these
    // under overlays.postgamecallout.*; port colours default to the Smash/MK
    // convention and `theme` swaps the backdrop SVG (built-in or a drop-in under
    // /layout/postgame/themes/<name>.svg).
    postgamecallout: [
        { key: 'theme', type: 'select', label: 'Backdrop Theme', description: 'Built-in callout backdrop, or a custom SVG dropped into /layout/postgame/themes/', options: [{ value: 'default', label: 'Built-in' }], defaultValue: 'default' },
        { key: 'port0Color', type: 'color-override', label: 'Port 1 Color', description: 'Accent for a player on controller port 1' },
        { key: 'port1Color', type: 'color-override', label: 'Port 2 Color', description: 'Accent for a player on controller port 2' },
        { key: 'port2Color', type: 'color-override', label: 'Port 3 Color', description: 'Accent for a player on controller port 3' },
        { key: 'port3Color', type: 'color-override', label: 'Port 4 Color', description: 'Accent for a player on controller port 4' },
    ],
};

// ── Global design keys eligible for per-layout override ──
// Each entry corresponds to a key in overlays.global.* that the user can pin a
// per-layout override on via the "+ Add style override" picker. The `meta`
// field links to the synthetic name(s) used in each overlay's
// <meta name="overlay-settings"> whitelist; an override is offered for a layout
// only if at least one of the meta names appears in that whitelist.
export const OVERRIDABLE_GLOBAL_KEYS = [
    { key: 'accentColor',    meta: ['accentColor'],    type: 'color',         label: 'Accent Color',       defaultValue: '#f59e0b' },
    { key: 'textColor',      meta: ['textColor'],      type: 'color',         label: 'Text Color',         defaultValue: '#ffffff' },
    { key: 'cardBg',         meta: ['cardBg'],         type: 'color-opacity', label: 'Card Background',    defaultValue: 'rgba(15, 15, 25, 0.88)' },
    { key: 'borderColor',    meta: ['borderColor'],    type: 'color-opacity', label: 'Border Color',       defaultValue: 'rgba(255, 255, 255, 0.08)' },
    { key: 'borderRadius',   meta: ['borderRadius'],   type: 'number',        label: 'Border Radius',      defaultValue: 16, min: 0, max: 48, step: 2, suffix: 'px' },
    { key: 'borderWidth',    meta: ['borderWidth'],    type: 'number',        label: 'Border Thickness',   defaultValue: 1,  min: 0, max: 16, step: 1, suffix: 'px' },
    { key: 'cardShadowBlur', meta: ['cardShadow'],     type: 'number',        label: 'Card Shadow Blur',   defaultValue: 16, min: 0, max: 80, step: 2, suffix: 'px' },
    { key: 'textShadowBlur', meta: ['textShadow'],     type: 'number',        label: 'Text Shadow Blur',   defaultValue: 4,  min: 0, max: 40, step: 1, suffix: 'px' },
    { key: 'showCaptains',     meta: ['showCaptains'],     type: 'switch', label: 'Show Captains' },
    { key: 'showLogo',         meta: ['showLogo'],         type: 'switch', label: 'Show Overlay Logo' },
    { key: 'showBackdropBlur', meta: ['showBackdropBlur'], type: 'switch', label: 'Backdrop Blur' },
    { key: 'showShadow',       meta: ['showShadow'],       type: 'switch', label: 'Card Shadow' },
    { key: 'finalBadgeColor',  meta: ['finalBadgeColor'],  type: 'color',  label: 'Final Badge Color' },
];

export const GLOBAL_DESIGN_KEYS = [
    'accentColor', 'cardBg', 'textColor', 'borderRadius', 'borderColor', 'borderWidth', 'fontFamily',
    'showShadow', 'cardShadowBlur', 'cardShadowColor',
    'textShadowEnabled', 'textShadowBlur', 'textShadowColor',
    // Promoted from per-layout in v2:
    'showCaptains', 'showLogo', 'showBackdropBlur', 'finalBadgeColor',
];

export const GLOBAL_DESIGN_DEFAULTS = {
    accentColor:       '#f59e0b',
    cardBg:            'rgba(15, 15, 25, 0.88)',
    textColor:         '#ffffff',
    borderRadius:      16,
    borderColor:       'rgba(255, 255, 255, 0.08)',
    borderWidth:       1,
    fontFamily:        'Inter',
    showShadow:        true,
    cardShadowBlur:    16,
    cardShadowColor:   'rgba(0, 0, 0, 0.5)',
    textShadowEnabled: false,
    textShadowBlur:    4,
    textShadowColor:   'rgba(0, 0, 0, 0.8)',
    showCaptains:      true,
    showLogo:          true,
    showBackdropBlur:  true,
    finalBadgeColor:   null,
};
