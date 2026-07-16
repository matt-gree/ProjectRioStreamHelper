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
// Supported control types: 'switch', 'color-override', 'number-override', 'select', 'text'.

// The re-themable stat card's element-only settings. Shared verbatim by the
// standalone Stats source and the combined Roster + Stats element, which each
// read them under their own namespace (overlays.stats.* vs overlays.rosterstats.*)
// so the two cards are configured independently.
const STAT_CARD_SETTINGS = [
    { key: 'transitionType', type: 'select', label: 'Batter Transition', description: 'Animation when switching to a new batter', options: [{ value: 'fade', label: 'Fade' }, { value: 'none', label: 'None' }], defaultValue: 'fade' },
    { key: 'subLine', type: 'select', label: 'Bottom Line', description: 'What the bottom row shows: the live game line, your own text, or nothing (the card shrinks)', options: [{ value: 'gameLine', label: 'Game Line' }, { value: 'custom', label: 'Custom Text' }, { value: 'off', label: 'Off' }], defaultValue: 'gameLine' },
    { key: 'subLineText', type: 'text', label: 'Custom Bottom Text', description: 'Shown when Bottom Line is set to Custom Text', placeholder: 'e.g. Season Stats' },
    { key: 'statValueColor', type: 'color-override', label: 'Stat Value Color', description: 'Color of the main stat numbers (e.g. AVG, ERA)' },
    { key: 'subtextColor',   type: 'color-override', label: 'Subtext Color',    description: 'Color of stat labels and the game line text' },
];

export const LAYOUT_SETTINGS = {
    scoreboard: [
        { key: 'showElo', type: 'switch', label: 'Show ELO', description: 'Display ELO ratings on completed games' },
        { key: 'showTeamLogos', type: 'switch', label: 'Show Team Logos', description: 'Display MSB team logos' },
        // Segment toggles honoured by melded themes (e.g. Small Scoreboard); a
        // theme without those segments ignores them.
        { key: 'showLive', type: 'switch', label: 'Show Live Cluster', description: 'The live count + base diamond. Off keeps it hidden even during a live game (the card stays compact).', defaultValue: true },
        { key: 'showInning', type: 'switch', label: 'Show Inning', description: 'The inning number segment during a live game', defaultValue: true },
    ],
    roster: [
        { key: 'showSuperstars', type: 'switch', label: 'Show Superstar Icons', description: 'Display superstar badge on starred characters' },
        { key: 'showRoleIcon', type: 'switch', label: 'Show Batting/Fielding Icon', description: 'Display the bat or glove icon indicating the team role' },
        { key: 'showTeamLogo', type: 'switch', label: 'Show Team Logo', description: 'Display the team logo next to the roster' },
    ],
    stats: [...STAT_CARD_SETTINGS],
    teamlogo: [],
    // Simple 4-Cam Scorecard — self-contained, fixed slice26 look. Aim (left/
    // right) is a URL variant (?dir=), so there are no live element settings.
    fourcam: [],
    // Roster + Stats — the combined auto-cycling source. Roster look shares
    // overlays.roster.*, the stat card shares overlays.stats.* + the active
    // Design Package; the only element-only knob is how long the card stays up.
    rosterstats: [
        { key: 'showSuperstars', type: 'switch', label: 'Show Superstar Icons', description: 'Display superstar badge on starred characters' },
        { key: 'showRoleIcon', type: 'switch', label: 'Show Batting/Fielding Icon', description: 'Display the bat or glove icon indicating the team role' },
        { key: 'showTeamLogo', type: 'switch', label: 'Show Team Logo', description: 'Display the team logo next to the roster' },
        { key: 'dwellSeconds', type: 'number-override', label: 'Stat Card Dwell', description: 'Seconds the batter/pitcher stat card stays up before returning to the roster', defaultValue: 7, min: 2, max: 20, step: 1, suffix: 's' },
        ...STAT_CARD_SETTINGS,
    ],
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
    // convention. The backdrop SVG comes from the active Design Package
    // (callout.svg — overlays.global.designPackage picks the package).
    postgamecallout: [
        { key: 'port0Color', type: 'color-override', label: 'Port 1 Color', description: 'Accent for a player on controller port 1' },
        { key: 'port1Color', type: 'color-override', label: 'Port 2 Color', description: 'Accent for a player on controller port 2' },
        { key: 'port2Color', type: 'color-override', label: 'Port 3 Color', description: 'Accent for a player on controller port 3' },
        { key: 'port3Color', type: 'color-override', label: 'Port 4 Color', description: 'Accent for a player on controller port 4' },
    ],
    // Lower Third (Break) — a re-themable SVG band. The mount reads these under
    // overlays.lowerthird.*; the theme SVG comes from the active Design Package
    // (lowerthird.svg — overlays.global.designPackage picks the package),
    // accentColor pins a per-layout accent, and the port colours tint each
    // player's side.
    lowerthird: [
        { key: 'port0Color', type: 'color-override', label: 'Port 1 Color', description: 'Side colour for a player on controller port 1' },
        { key: 'port1Color', type: 'color-override', label: 'Port 2 Color', description: 'Side colour for a player on controller port 2' },
        { key: 'port2Color', type: 'color-override', label: 'Port 3 Color', description: 'Side colour for a player on controller port 3' },
        { key: 'port3Color', type: 'color-override', label: 'Port 4 Color', description: 'Side colour for a player on controller port 4' },
    ],
    // Vertical Scorecard — each numbered design element is an independent
    // switch the producer flips live (broadcast over the settings socket); the
    // mount (scorecard-mount.js) animates each group in/out. mainMode chooses
    // the full score block, the condensed bar, or neither. The theme SVG comes
    // from the active Design Package (scorecard.svg).
    scorecard: [
        { key: 'showHeader',   type: 'switch', label: 'Header Bar',    description: 'Branding logo + title bar (element 0)', defaultValue: true },
        { key: 'titleText',    type: 'text',   label: 'Header Title',   description: 'Centered next to the logo. Blank uses the branding logo alone.', placeholder: 'Project Rio' },
        { key: 'showPhase',    type: 'switch', label: 'Bracket Phase',  description: 'Bracket-phase bar (element 1)', defaultValue: true },
        { key: 'phaseText',    type: 'text',   label: 'Phase Text',     description: 'Overrides the bracket-phase bar. Leave blank to use the assigned match’s phase; the bar hides when neither is set.', placeholder: 'Winners Final' },
        { key: 'showGameMode', type: 'switch', label: 'Game Mode',      description: 'Game-mode bar (element 2)', defaultValue: true },
        { key: 'mainMode',     type: 'select', label: 'Score Block',    description: 'Full score block (3), condensed bar (3a), or neither', options: [{ value: 'full', label: 'Full' }, { value: 'condensed', label: 'Condensed' }, { value: 'off', label: 'Off' }], defaultValue: 'full' },
        { key: 'showRosters',  type: 'switch', label: 'Rosters',        description: 'Both teams’ 9-character rosters in the full block', defaultValue: true },
        { key: 'showBases',    type: 'switch', label: 'Bases / Diamond', description: 'The base diamond and on-base runners', defaultValue: true },
        { key: 'showAtBat',    type: 'switch', label: 'At-Bat Lines',   description: 'Current batter + pitcher game lines (element 4)', defaultValue: true },
        { key: 'showBoxScore', type: 'switch', label: 'Box Score',      description: 'Per-inning linescore (element 5)', defaultValue: true },
        { key: 'showStadium',  type: 'switch', label: 'Stadium',        description: 'Stadium bar (element 6)', defaultValue: true },
    ],
    eventheader: [
        // Bands — two single-row strips (baseline at y=45 top, y=1078 bottom).
        { key: 'showHeader',    type: 'switch', label: 'Show Header',  description: 'Top row: Event / Location / Dates', defaultValue: true },
        { key: 'headerOffsetY', type: 'number-override', label: 'Header Top Offset', description: 'Nudge the header band down from the top (baseline default y=45)', defaultValue: 0, min: 0, max: 480, step: 1, suffix: 'px' },
        { key: 'showFooter',    type: 'switch', label: 'Show Footer',  description: 'Bottom row: Message / Event / Phase / Round', defaultValue: true },
        { key: 'footerOffsetY', type: 'number-override', label: 'Footer Bottom Offset', description: 'Nudge the footer band up from the bottom (baseline default y=1078)', defaultValue: 2, min: 0, max: 480, step: 1, suffix: 'px' },
        // Per-field visibility (a field also drops out automatically when blank)
        { key: 'showEvent',     type: 'switch', label: 'Field: Event Name', description: 'Competition name (both rows)', defaultValue: true },
        { key: 'showLocation',  type: 'switch', label: 'Field: Location',    description: 'Header row only', defaultValue: true },
        { key: 'showDates',     type: 'switch', label: 'Field: Dates',       description: 'Header row only', defaultValue: true },
        { key: 'showMessage',   type: 'switch', label: 'Field: Message',     description: 'Free-text banner line (footer row)', defaultValue: true },
        { key: 'showPhase',     type: 'switch', label: 'Field: Phase',       description: 'Competition phase (footer row; match, else global)', defaultValue: true },
        { key: 'showRound',     type: 'switch', label: 'Field: Round',       description: 'Round name from the bound match (footer row)', defaultValue: true },
        // Look & layout
        { key: 'bandWidth',     type: 'number-override', label: 'Band Width', description: 'Centered content width for both rows', defaultValue: 1263, min: 600, max: 1920, step: 1, suffix: 'px' },
        { key: 'fontScale',     type: 'number-override', label: 'Font Scale', description: 'Scales all text up or down', defaultValue: 100, min: 50, max: 200, step: 5, suffix: '%' },
        { key: 'bgStyle',       type: 'select', label: 'Band Background', description: 'Optional readability plate behind each row', options: [{ value: 'none', label: 'None (transparent)' }, { value: 'scrim', label: 'Soft Scrim' }, { value: 'bar', label: 'Solid Bar' }], defaultValue: 'none' },
        { key: 'separator',     type: 'text',   label: 'Field Separator', description: 'Character drawn between fields in a row', placeholder: '◆' },
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
    { key: 'showShadow',       meta: ['showShadow'],       type: 'switch', label: 'Card Shadow' },
    { key: 'finalBadgeColor',  meta: ['finalBadgeColor'],  type: 'color',  label: 'Final Badge Color' },
    { key: 'fontFamily',       meta: ['fontFamily'],       type: 'font',   label: 'Font Family', defaultValue: 'Inter' },
];

export const GLOBAL_DESIGN_KEYS = [
    'accentColor', 'cardBg', 'textColor', 'borderRadius', 'borderColor', 'borderWidth', 'fontFamily',
    'showShadow', 'cardShadowBlur', 'cardShadowColor',
    'textShadowEnabled', 'textShadowBlur', 'textShadowColor',
    // Promoted from per-layout in v2:
    'showCaptains', 'showLogo', 'finalBadgeColor',
    // Design package selector — not a CSS knob, not per-layout overridable; read
    // directly by element mounts (e.g. commentary-mount.js) to pick a theme.
    'designPackage',
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
    finalBadgeColor:   null,
    designPackage:     'default',
};
