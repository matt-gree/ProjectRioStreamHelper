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
// standalone Stats source and the Stat Card container member, which each read
// them under their own namespace (overlays.stats.* vs overlays.statscard.*) so
// the two cards are configured independently.
const STAT_CARD_SETTINGS = [
    { key: 'transitionType', type: 'select', label: 'Batter Transition', description: 'Animation when switching to a new batter', options: [{ value: 'fade', label: 'Fade' }, { value: 'none', label: 'None' }], defaultValue: 'fade' },
    { key: 'subLine', type: 'select', label: 'Bottom Line', description: 'What the bottom row shows: the live game line, your own text, or nothing (the card shrinks)', options: [{ value: 'gameLine', label: 'Game Line' }, { value: 'custom', label: 'Custom Text' }, { value: 'off', label: 'Off' }], defaultValue: 'gameLine' },
    // showWhen: the mode that gives this field a job. On any other mode nothing
    // it holds reaches the card, so it is INERT rather than merely inactive —
    // which is the bar for hiding a control instead of disabling it.
    { key: 'subLineText', type: 'text', showWhen: { key: 'subLine', is: 'custom' }, label: 'Custom Bottom Text', description: 'Shown when Bottom Line is set to Custom Text', placeholder: 'e.g. Season Stats' },
    // appPalette: reaches the card through --stat-value-color / --stat-subtext-color,
    // which a full-art theme's mount CLEARS along with the rest of the app palette
    // (clearDesignSettings in overlay-base.js). Dead under such a theme, so the UI
    // drops the row — see THEME_ELEMENT below and ./designPackage.js.
    { key: 'statValueColor', type: 'color-override', appPalette: true, label: 'Stat Value Color', description: 'Color of the main stat numbers (e.g. AVG, ERA)' },
    { key: 'subtextColor',   type: 'color-override', appPalette: true, label: 'Subtext Color',    description: 'Color of stat labels and the game line text' },
];

// The 2x2 Stat Card's HEADER band, above the grid — the caption that names what
// the four numbers are while the bottom line carries what just happened.
//
// Not part of STAT_CARD_SETTINGS, because it is not part of every card: the
// header is a band in `statscard.svg`, and the standalone Stats source renders
// the wide `stats.svg`, which has no room for one. Offering the knob there would
// put a control on the stage that cannot change anything. The Stat Card
// container member, which DOES render the 2x2 card, takes it below.
const TOP_LINE_SETTINGS = [
    { key: 'topLine', type: 'select', label: 'Top Line', description: 'A caption above the stats: your own text, the game mode ("Stars On Showdown XXI Stats"), or nothing (the card shrinks)', options: [{ value: 'off', label: 'Off' }, { value: 'custom', label: 'Custom Text' }, { value: 'auto', label: 'Game Mode' }], defaultValue: 'off' },
    { key: 'topLineText', type: 'text', showWhen: { key: 'topLine', is: 'custom' }, label: 'Custom Top Text', description: 'Shown when Top Line is set to Custom Text', placeholder: 'e.g. Tournament Stats' },
];

export const LAYOUT_SETTINGS = {
    // A switch's label names the PART, not the verb: a row of "Show …" repeats
    // the control's own affordance once per line and pushes the word that
    // distinguishes it rightwards, which is most of why a settings column reads
    // as a wall. The description still carries the sentence.
    scoreboard: [
        // Default OFF: a one-game rating swing is a season-play number, and at a
        // tournament or in a league it was taking the widest thirds of the
        // completed-game row to say something nobody in the room was watching.
        { key: 'showElo', type: 'switch', label: 'ELO', description: 'Rating change on completed games. Off unless you’re running ranked ladder play.', defaultValue: false },
        { key: 'showTeamLogos', type: 'switch', label: 'Team Logos', description: 'Display MSB team logos' },
        // Both feeds write score.{N}.game_mode now, so this is standing context
        // rather than a completed-game detail.
        { key: 'showGameMode', type: 'switch', label: 'Game Mode', description: 'The game mode / tag set, during a game and after it', defaultValue: true },
        // Segment toggles honoured by melded themes (e.g. Small Scoreboard); a
        // theme without those segments ignores them.
        { key: 'showLive', type: 'switch', label: 'Live Cluster', description: 'The live count + base diamond. Off keeps it hidden even during a live game (the card stays compact).', defaultValue: true },
        { key: 'showInning', type: 'switch', label: 'Inning', description: 'The inning number segment during a live game', defaultValue: true },
    ],
    roster: [
        { key: 'showSuperstars', type: 'switch', label: 'Superstar Icons', description: 'Display superstar badge on starred characters' },
        { key: 'showRoleIcon', type: 'switch', label: 'Batting / Fielding Icon', description: 'Display the bat or glove icon indicating the team role' },
        { key: 'showTeamLogo', type: 'switch', label: 'Team Logo', description: 'Display the team logo next to the roster' },
    ],
    // Stats — the per-side stat card as its OWN source (?scoreboard=N&team=T),
    // drawing whoever that side has on the field. One namespace for both sides,
    // same as the roster's.
    stats: [...STAT_CARD_SETTINGS],
    // Stat Card — the compact 2x2 card as a CONTAINER MEMBER (no standalone
    // layout of its own). Same knobs as the standalone Stats source under its
    // own namespace, so a container's card and a dedicated stats source are
    // configured independently; the Production stage reaches these from the Stat
    // Card row nested under its container.
    statscard: [...STAT_CARD_SETTINGS, ...TOP_LINE_SETTINGS],
    /*
     * Player Name — one side's name as its own source.
     *
     * These are GLOBAL (`overlays.playername.*`, one namespace for both sides,
     * same as the roster's), which is what makes `auto` a value rather than a
     * cop-out: the shipped behaviour is side-dependent — side 1 on the left,
     * side 2 on the right, so a pair of them frames a scoreboard — and one
     * setting cannot say that with three literal edges. It is also the default,
     * so a source already in a producer's scene does not move.
     */
    playername: [
        { key: 'align', type: 'select', label: 'Alignment', description: 'Which edge the name sits on. Mirror Sides puts side 1 left and side 2 right — the pair that frames a scoreboard.', options: [{ value: 'auto', label: 'Mirror Sides' }, { value: 'left', label: 'Left' }, { value: 'center', label: 'Middle' }, { value: 'right', label: 'Right' }], defaultValue: 'auto' },
        { key: 'prefixPosition', type: 'select', label: 'Prefix Position', description: 'Where the Address Book prefix (sponsor / tag) sits relative to the name. Off hides it without editing the Address Book.', options: [{ value: 'above', label: 'Above Name' }, { value: 'below', label: 'Below Name' }, { value: 'inline', label: 'Before Name' }, { value: 'off', label: 'Off' }], defaultValue: 'above' },
    ],
    teamlogo: [],
    bracket: [
        { key: 'connectorColor', type: 'color-override', label: 'Connector Line Color', description: 'Color of bracket connector lines' },
        { key: 'activeColor', type: 'color-override', label: 'Active Match Color', description: 'Highlight color for active/in-progress matches' },
        { key: 'maxScale', type: 'number-override', label: 'Max Upscale', description: '1.0 = never enlarge past designed pixel sizes (small brackets stay native, centered). 1.5+ lets small brackets grow to fill the OBS source.', defaultValue: 1.0, min: 0.5, max: 3.0, step: 0.1 },
    ],
    ticker: [
        { key: 'tickerSpeed', type: 'number-override', label: 'Scroll Speed', description: 'Horizontal scroll rate of the ticker (pixels per second)', defaultValue: 60, min: 10, max: 300, step: 10, suffix: 'px/s' },
        { key: 'tickerGap', type: 'number-override', label: 'Card Spacing', description: 'Space between game cards (px)', defaultValue: 16, min: 0, max: 80, step: 2, suffix: 'px' },
    ],
    // Post-game full-screen Stat Callout (fed element). Everything about its
    // look comes from the active Design Package (callout.svg —
    // overlays.global.designPackage picks it).
    //
    // The four controller-port colours used to live here, and they were the
    // only UI for a palette FIVE mounts read (scoreboard, scorecard, lower
    // third, both callouts). Recolouring port 1 on the spotlight and watching
    // the scoreboard keep the old red is the bug that shape guarantees, so
    // they are now one global set on the Design tab — PORT_COLOR_KEYS below,
    // under them whatever the active package declares. Don't bring a
    // per-element copy back.
    postgamecallout: [],
    // Lower Third (Break) — a re-themable SVG band. The mount reads these under
    // overlays.lowerthird.*; the theme SVG comes from the active Design Package
    // (lowerthird.svg — overlays.global.designPackage picks the package),
    // accentColor pins a per-layout accent, and the port colours tint each
    // player's side.
    // The break band carries no per-port controls: controller ports are a
    // live-game idea, and the lower third is a between-games surface. The
    // mount still tints match/scorebox sides from its own PORT_COLORS
    // defaults — only the four overrides are gone, so nothing on air changes.
    lowerthird: [],
    // Vertical Scorecard — each numbered design element is an independent
    // switch the producer flips live (broadcast over the settings socket); the
    // mount (scorecard-mount.js) animates each group in/out. mainMode chooses
    // the full score block, the condensed bar, or neither. The theme SVG comes
    // from the active Design Package (scorecard.svg).
    // Grouped down the card the way it stacks on screen (the descriptions'
    // "element N" is that order). `mainMode` carries no group ON PURPOSE: it is
    // the score block's whole control, so it sits ungrouped between Top bars and
    // Lower bars — the card's own order — rather than under a one-row "Score
    // block" eyebrow. It used to share that region with Rosters and Bases
    // switches; those are gone, because the parts of the block a producer
    // actually cuts between are the three the segmented control already names
    // (full / condensed / off), and a full block missing its rosters or its
    // diamond was a fourth state nobody asked for. Same def, so it is still the
    // rail's quick-face row.
    scorecard: [
        { key: 'showHeader',   group: 'Top bars', type: 'switch', label: 'Header Bar',    description: 'Branding logo + title bar (element 0)', defaultValue: true },
        { key: 'titleText',    group: 'Top bars', type: 'text',   label: 'Header Title',   description: 'Centered next to the logo. Blank uses the branding logo alone.', placeholder: 'Project Rio' },
        { key: 'showPhase',    group: 'Top bars', type: 'switch', label: 'Bracket Phase',  description: 'Bracket-phase bar (element 1)', defaultValue: true },
        { key: 'phaseText',    group: 'Top bars', type: 'text',   label: 'Phase Text',     description: 'Overrides the bracket-phase bar. Leave blank to use the assigned match’s phase; the bar hides when neither is set.', placeholder: 'Winners Final' },
        { key: 'showGameMode', group: 'Top bars', type: 'switch', label: 'Game Mode',      description: 'Game-mode bar (element 2)', defaultValue: true },
        { key: 'mainMode',     type: 'select', label: 'Score Block',    description: 'Full score block (3), condensed bar (3a), or neither', options: [{ value: 'full', label: 'Full' }, { value: 'condensed', label: 'Condensed' }, { value: 'off', label: 'Off' }], defaultValue: 'full' },
        { key: 'showAtBat',    group: 'Lower bars', type: 'switch', label: 'At-Bat Lines',   description: 'Current batter + pitcher game lines (element 4)', defaultValue: true },
        { key: 'showBoxScore', group: 'Lower bars', type: 'switch', label: 'Box Score',      description: 'Per-inning linescore (element 5)', defaultValue: true },
        { key: 'showStadium',  group: 'Lower bars', type: 'switch', label: 'Stadium',        description: 'Stadium bar (element 6)', defaultValue: true },
    ],
    // The event header is two single-row strips (baselines y=45 top, y=1078
    // bottom), and its settings are ORDERED AND GROUPED BY WHICH STRIP THEY
    // CHANGE — the panel is a scale model of the overlay, top band first. Sorted
    // by control kind instead (all the switches, then all the numbers), the
    // band's own offset sat five rows away from the switch that turns it on.
    eventheader: [
        // THE FIELDS INSIDE EACH BAND ARE NOT SETTINGS. They were seven
        // `show*` switches here — one per field, in registry order — while the
        // ORDER they drew in lived in the overlay's own render call, so a
        // producer could hide the location and never put the dates first, and
        // the only field with any text of its own was the message. A band is an
        // ordered list now (`overlays.eventheader.bands`, one entry per field
        // carrying its position, its eye and a text override), authored on the
        // band ribbons on this element's stage. See src/routes/production/
        // eventheader.js and EVENTHEADER_FIELDS in server/settings.py.
        //
        // What stays here is what is genuinely a setting: whether each BAND is
        // drawn at all, where it sits, and how both of them look.
        { key: 'showHeader',    group: 'Top band', type: 'switch', label: 'Header Band',  description: 'The top row of fields', defaultValue: true },
        { key: 'headerOffsetY', group: 'Top band', type: 'number-override', label: 'Top Offset', description: 'Nudge the header band down from the top (baseline default y=45)', defaultValue: 0, min: 0, max: 480, step: 1, suffix: 'px' },

        { key: 'showFooter',    group: 'Bottom band', type: 'switch', label: 'Footer Band',  description: 'The bottom row of fields', defaultValue: true },
        { key: 'footerOffsetY', group: 'Bottom band', type: 'number-override', label: 'Bottom Offset', description: 'Nudge the footer band up from the bottom (baseline default y=1078)', defaultValue: 2, min: 0, max: 480, step: 1, suffix: 'px' },

        // Last, and that is the ranking: these are set once for an event, where
        // everything above is flipped during one.
        // A segment label is ONE word. A segmented control divides its row
        // between its options, so it has whatever a column's width leaves after
        // the label gutter divided by three — ~82px at two columns. "None
        // (transparent)" and "Soft Scrim" both wrapped to a second line there
        // and broke the panel's 28px rhythm. The adjectives were describing, and
        // `description` is where describing goes.
        { key: 'bgStyle',       group: 'Both bands', type: 'select', label: 'Band Background', description: 'Optional readability plate behind each row: none (transparent), a soft scrim, or a solid bar', options: [{ value: 'none', label: 'None' }, { value: 'scrim', label: 'Scrim' }, { value: 'bar', label: 'Bar' }], defaultValue: 'none' },
        { key: 'bandWidth',     group: 'Both bands', type: 'number-override', label: 'Band Width', description: 'Centered content width for both rows', defaultValue: 1263, min: 600, max: 1920, step: 1, suffix: 'px' },
        { key: 'fontScale',     group: 'Both bands', type: 'number-override', label: 'Font Scale', description: 'Scales all text up or down', defaultValue: 100, min: 50, max: 200, step: 5, suffix: '%' },
        // `short`: the whole value is one glyph, so the field says so rather
        // than stretching the width of its column.
        { key: 'separator',     group: 'Both bands', type: 'text',   label: 'Field Separator', description: 'Character drawn between fields in a row', defaultValue: '◆', placeholder: '◆', short: true },
    ],
};

// ── Which design-package file draws a layout type ──
// Only types that carry an `appPalette: true` setting need an entry: the map's
// single job is to ask the active package whether that element is painted by the
// app's knobs or brings its own palette (see ./designPackage.js). Adding a type
// with no such setting would gate nothing.
//
// `stats` was deliberately ABSENT for as long as the type was shared by two
// renderers — the fed Stats bar (stats-mount.js) is plain HTML and always
// honours the app palette, while stats.html is the themed SVG — so there was no
// single answer and the safe one was not to gate. The fed bar is shelved and
// `overlays.stats.*` now has exactly one reader, so the answer exists: under a
// full-art theme the card brings its own palette and the two colour rows are
// dead, which is the state this map takes them off the panel for.
export const THEME_ELEMENT = {
    stats: 'stats',
    statscard: 'statscard',
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

// ── The controller-port palette ──
// Ports 1-4, in order. GLOBAL and not per-layout overridable: a controller port
// is a player's identity for the whole broadcast, and five mounts tint their
// sides from it (scoreboard, scorecard, lower third, Game Summary, Character
// Spotlight). Unset (null) is INHERIT, not "no colour" — the active design
// package's own `portColors` answers next, and DEFAULT_PORT_COLORS last.
// Resolution lives in one place per runtime: usePortColors() here on the app
// side, public/layout/lib/port-colors.js on the overlay side.
export const PORT_COLOR_KEYS = ['port0Color', 'port1Color', 'port2Color', 'port3Color'];

// The Smash/MK convention — and what Project Rio and gc-overlay show, so an
// unthemed install matches what the producer sees in game. Mirrored in
// public/layout/lib/port-colors.js (pinned by designConstants.test.js).
export const DEFAULT_PORT_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];

export const GLOBAL_DESIGN_KEYS = [
    'accentColor', 'cardBg', 'textColor', 'borderRadius', 'borderColor', 'borderWidth', 'fontFamily',
    'showShadow', 'cardShadowBlur', 'cardShadowColor',
    'textShadowEnabled', 'textShadowBlur', 'textShadowColor',
    // Promoted from per-layout in v2:
    'showCaptains', 'showLogo', 'finalBadgeColor',
    // Promoted from the Character Spotlight's own settings in v4 (see above):
    ...PORT_COLOR_KEYS,
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
    // null = inherit (package, then DEFAULT_PORT_COLORS) — never a literal
    // colour here, or a preset would pin the app's palette over the package's.
    port0Color:        null,
    port1Color:        null,
    port2Color:        null,
    port3Color:        null,
    designPackage:     'default',
};
