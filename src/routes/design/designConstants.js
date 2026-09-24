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

// The re-themable stat card's element-only settings. Shared verbatim by the two
// stat elements — the wide Stat Bar and the 2x2 Stat Card — which each read them
// under their own namespace (overlays.statsbar.* vs overlays.statscard.*) so the
// two cards are configured independently. BOTH now own a dedicated ?team=
// source; the card is additionally a container member, and its two paths share
// one namespace, so it is one element wherever it is drawn.
const STAT_CARD_SETTINGS = [
    { key: 'transitionType', type: 'select', label: 'Batter Transition', description: 'Animation when switching to a new batter', options: [{ value: 'fade', label: 'Fade' }, { value: 'none', label: 'None' }], defaultValue: 'fade' },
    { key: 'subLine', type: 'select', label: 'Bottom Line', description: 'What the bottom row shows: the live game line, your own text, or nothing (the card shrinks)', options: [{ value: 'gameLine', label: 'Game Line', railLabel: 'Game' }, { value: 'custom', label: 'Custom Text', railLabel: 'Custom' }, { value: 'off', label: 'Off' }], defaultValue: 'gameLine' },
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
// header is a band in `statscard.svg`, and the Stat Bar renders the wide
// `statsbar.svg`, which has no room for one. Offering the knob there would put a
// control on the stage that cannot change anything. The Stat Card takes it
// below, and declares the pair in its own layout's `<meta>` — which is the half
// that was unreachable while the card had no layout file of its own.
const TOP_LINE_SETTINGS = [
    { key: 'topLine', type: 'select', label: 'Top Line', description: 'A caption above the stats: your own text, the game mode ("Stars On Showdown XXI Stats"), or nothing (the card shrinks)', options: [{ value: 'off', label: 'Off' }, { value: 'custom', label: 'Custom Text' }, { value: 'auto', label: 'Game Mode' }], defaultValue: 'off' },
    { key: 'topLineText', type: 'text', showWhen: { key: 'topLine', is: 'custom' }, label: 'Custom Top Text', description: 'Shown when Top Line is set to Custom Text', placeholder: 'e.g. Tournament Stats' },
];

export const LAYOUT_SETTINGS = {
    // A switch's label names the PART, not the verb: a row of "Show …" repeats
    // the control's own affordance once per line and pushes the word that
    // distinguishes it rightwards, which is most of why a settings column reads
    // as a wall. The description still carries the sentence.
    /*
     * PER-SIZE, and in each size's OWN order. The scoreboard's sizes are one
     * HTML file with one `<meta>` whitelist but genuinely different cards, so
     * the switch list is not shared — it is filtered by `sizes`
     * (settingReachesSize below), and what is left reads top-of-card to
     * bottom-of-card for whichever size the source is on:
     *
     *   s   Team Logos · Inning · Live Cluster · Game Mode
     *       A horizontal meld: the core pill extends to reveal the inning
     *       segment and then the live cluster, with the mode band under it.
     *   l   Team Logos · Live Cluster · Rosters · Box Score
     *       A row stack: header, live cluster, both nines, the linescore.
     *
     * They flow as a row, so registry order IS reading order — a producer
     * hunting for the band they can see at the bottom of the overlay should
     * find its switch at the end of the list, not in the middle. One array
     * ordered s-first-then-l-only satisfies both filters at once.
     *
     * A switch a size cannot honour is never offered: Small has no roster or
     * linescore band, and Large draws its inning inside row-top and its game
     * mode inline in the linescore's meta pane, where neither costs height and
     * so neither has anything to toggle. An option that silently does nothing
     * costs more than a missing one.
     */
    scoreboard: [
        { key: 'showTeamLogos', type: 'switch', label: 'Team Logos', description: 'Display MSB team logos' },
        // INNING BEFORE THE LIVE CLUSTER, and the order is the card's: on the
        // melded Small board the live segment sits OUTBOARD of the inning, so a
        // list that ran live-then-inning read right-to-left against the thing it
        // described.
        {
            key: 'showInning', type: 'switch', label: 'Inning', sizes: ['s'],
            description: 'The inning number segment during a live game. The live cluster needs it, so turning that on shows the inning too.',
            forcedBy: { key: 'showLive', note: 'Held on by the Live Cluster — the count reads as a count within an inning, and on a melded theme the live segment sits outboard of this one. Turn the Live Cluster off to get this switch back.' },
            defaultValue: true,
        },
        // forcedBy on Inning above names this one as its master: the mount ORs
        // the two (scoreboard-mount showInningSeg), so with this on the Inning
        // switch cannot say no — and a control that keeps offering a choice it
        // doesn't have is the producer's next bug report. The console shows it
        // held on instead.
        // `railLabel` (on a def, or on a select's option): the name a rail card
        // uses where the full one would wrap at ~216px (the `compact` shape in
        // stage/overlay-settings); the full label stays on the stage, and on a
        // chip it stays the accessible name.
        { key: 'showLive', type: 'switch', label: 'Live Cluster', railLabel: 'Live', description: 'The live count + base diamond. Off keeps it hidden even during a live game (the card stays compact).', defaultValue: true },
        /*
         * The Large board's own three, in the order they sit on the card: the
         * stats inside the live row, then the two BANDS below it. Between them
         * they are what lets one board be two graphics — everything off is a
         * header strip you can leave up over live play, everything on is the
         * full between-innings card. That range is why there is no middle size
         * any more.
         */
        {
            key: 'showStats', type: 'switch', label: 'Stats', sizes: ['l'],
            description: 'Four headline stats beside each portrait in the live row — AB / AVG / SLG / SO% for the batter, IP / ERA / K% / AVG for the pitcher. Off blanks them; the portraits and the count stay where they are.',
            defaultValue: true,
        },
        {
            key: 'showRoster', type: 'switch', label: 'Rosters', sizes: ['l'],
            description: 'Both nines under the header. Off drops ~88 units of card height.',
            defaultValue: true,
        },
        {
            key: 'showBox', type: 'switch', label: 'Box Score', railLabel: 'Box', sizes: ['l'],
            description: 'The per-inning linescore, and the pane beside it carrying the game mode, stadium and date. Off drops ~112 units.',
            defaultValue: true,
        },
        // Small's mode BAND (row-mode), a vertical meld that grows the card —
        // which is what there is to switch off. Large's mode is a line inside
        // the linescore's meta pane and costs nothing, so it has no switch and
        // this default is what it reads.
        {
            key: 'showGameMode', type: 'switch', label: 'Game Mode', sizes: ['s'],
            description: 'The game-mode band under the card, during a game and after it. Self-hides when the mode is unknown.',
            defaultValue: true,
        },
    ],
    roster: [
        { key: 'showSuperstars', type: 'switch', label: 'Superstar Icons', description: 'Display superstar badge on starred characters' },
        { key: 'showRoleIcon', type: 'switch', label: 'Batting / Fielding Icon', description: 'Display the bat or glove icon indicating the team role' },
        { key: 'showTeamLogo', type: 'switch', label: 'Team Logo', description: 'Display the team logo next to the roster' },
        /*
         * The character art is a 52×60 sprite drawn at up to twice that (the
         * captain is 104 wide), so HOW it is upscaled is visible. Pixel is what
         * every theme SVG already does to its portraits (`image-rendering:
         * pixelated` on the scoreboard's nines, the stat cards, the lower third,
         * the ticker); off (smooth) is what the roster has always drawn, and
         * stays the default so a roster already on air does not change.
         * Portraits only — the bat/glove and team logo are high-resolution art
         * scaled DOWN, where nearest-neighbour just adds jaggies (roster-mount.js).
         *
         * A SWITCH, not a Smooth/Pixel select: with two states and one of them
         * the default, the select drew a labelled segmented row alone among the
         * roster's chips, so the one panel read two idioms. It rides last in the
         * strip, after the three parts it does not add to.
         */
        {
            key: 'pixelPortraits', type: 'switch', label: 'Pixel',
            description: 'Scale the character art up crisp and blocky, matching the scoreboard and stat cards. Off blends it smooth.',
            defaultValue: false,
        },
    ],
    // Stat Bar — the wide per-side stat card as its OWN source
    // (?scoreboard=N&team=T), drawing whoever that side has on the field. One
    // namespace for both sides, same as the roster's.
    statsbar: [...STAT_CARD_SETTINGS],
    // Stat Card — the compact 2x2 card, with its own ?team= source AND a place
    // on any container's roster. Same knobs as the Stat Bar under its own
    // namespace, so the two cards are configured independently; the Production
    // stage reaches these from the card's own rack row or from its row nested
    // under a container, which are the same panel writing the same keys.
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
        /*
         * THE TYPE SIZE, in px, and an absolute one — not a fraction of the OBS
         * source. Because this namespace is global, one number here is the size
         * of every Player Name in the show; the source's own dimensions only
         * ever clamp it down when a name will not fit (playername-mount.js).
         *
         * That is what makes it worth a field at all. The size used to be the
         * source's HEIGHT, which meant a producer set type by dragging a corner
         * in a unit nobody can do in their head (48px wanted an 88px-tall
         * source), and two names matched only while their boxes did.
         */
        { key: 'nameSize', type: 'number-override', label: 'Name Size', description: 'Type size of the player name, in pixels. The same on every Player Name source — resizing one in OBS gives the name more room to run, not a different size.', defaultValue: 48, min: 12, max: 200, step: 1, suffix: 'px' },
        /*
          * THE PREFIX'S OWN SIZE, and not a fraction of the name's — the two
          * runs carry different information and how loud a sponsor tag should
          * be is a producer's call. It was hard-locked at half the name, which
          * was a fair default and never a decision.
          *
          * 24 is exactly half of the name's 48, so an untouched pair draws what
          * shipped. It has no effect while the prefix position is Off, and the
          * height a source needs follows it — a bigger prefix is a taller stack
          * (playername-mount.js `stackHeight`).
          */
        { key: 'prefixSize', type: 'number-override', label: 'Prefix Size', description: 'Type size of the Address Book prefix (sponsor / tag), in pixels — independent of the name. The source has to be tall enough for both runs together.', defaultValue: 24, min: 8, max: 200, step: 1, suffix: 'px' },
        { key: 'align', type: 'select', label: 'Alignment', description: 'Which edge the name sits on. Mirror Sides puts side 1 left and side 2 right — the pair that frames a scoreboard.', options: [{ value: 'auto', label: 'Mirror Sides' }, { value: 'left', label: 'Left' }, { value: 'center', label: 'Middle' }, { value: 'right', label: 'Right' }], defaultValue: 'auto' },
        { key: 'prefixPosition', type: 'select', label: 'Prefix Position', description: 'Where the Address Book prefix (sponsor / tag) sits relative to the name. Off hides it without editing the Address Book.', options: [{ value: 'above', label: 'Above Name' }, { value: 'below', label: 'Below Name' }, { value: 'inline', label: 'Before Name' }, { value: 'off', label: 'Off' }], defaultValue: 'above' },
    ],
    teamlogo: [],
    /*
     * gc-overlay's three appearance settings.
     *
     * The only settings in the registry that do not reach a PRSH renderer at
     * all: the controller layout is an iframe around gc-overlay, a separate
     * program on its own port, so a value here becomes a query param on that
     * iframe's URL and nothing else (see DISPLAY_KEYS in lib/controller-mount.js,
     * the one table mapping these names onto gc-overlay's own).
     *
     * ONE LAYER, like every other element. These briefly had an app-wide copy on
     * the Connections tab with these as three-state pins over it, and the second
     * layer bought nothing: a pin beats the global, so the moment an element was
     * touched the global stopped reaching it — invisibly, from a tab that could
     * not show you why. `overlays.controller.*` is already shared by both sides
     * (the two ?team= sources are one element), so a single layer is app-wide
     * for every controller source anyway. Authored where every other element's
     * look is authored.
     *
     * Defaults are gc-overlay's own, so an untouched element draws exactly what
     * the reader draws standalone.
     */
    controller: [
        { key: 'labels', type: 'switch', label: 'Letters', description: 'The A/B/X/Y/Z/ST/L/R glyphs on the pad. Off for a shapes-only look.', defaultValue: true },
        { key: 'keyline', type: 'switch', label: 'Keyline', description: 'A black outline behind every stroke and glyph, which is what keeps the pad readable over bright gameplay.', defaultValue: true },
        /*
         * A SLIDER, not a number field, and that is a correctness fix. Asked for
         * a 0-1 opacity in a number box, a producer reads the label and types
         * `10` meaning ten percent — off the scale by a factor of a hundred, and
         * it drew as fully solid. A slider cannot express an out-of-range value
         * (the range IS the scale) and its percent readout removes the ambiguity
         * that invited one.
         */
        { key: 'idleFillOpacity', type: 'fraction-override', label: 'Idle Fill', description: 'Dark plate inside unpressed buttons. 0% leaves them hollow.', defaultValue: 0, step: 0.05 },
    ],
    bracket: [
        { key: 'connectorColor', type: 'color-override', label: 'Connector Line Color', description: 'Color of bracket connector lines' },
        { key: 'activeColor', type: 'color-override', label: 'Active Match Color', description: 'Highlight color for active/in-progress matches' },
        { key: 'maxScale', type: 'number-override', label: 'Max Upscale', description: '1.0 = never enlarge past designed pixel sizes (small brackets stay native, centered). 1.5+ lets small brackets grow to fill the OBS source.', defaultValue: 1.0, min: 0.5, max: 3.0, step: 0.1 },
    ],
    /*
     * Upcoming Schedule. Two settings, and both of them exist because
     * `schedule.queue` is the union of every running order and nothing ever
     * takes a fixture out of it (server/schedule.py) — so the list this board
     * draws from only ever grows, and an unbounded list on a fixed canvas is
     * the one thing a broadcast graphic may not be.
     *
     * The HEADING is not here: it is `schedule.title` in State, authored on
     * this element's stage beside each match's display time, because both are
     * facts about tonight rather than about how this overlay looks.
     */
    schedule: [
        { key: 'showDecided', type: 'switch', label: 'Decided Matches', description: 'Keep decided matches on the board, dimmed. Off by default — the running order never drops one, so an evening\u2019s board would grow all night.', defaultValue: false },
        // Ten is the canvas, not a taste: the default theme's card is
        // 124 + rows*82 tall and centres on 1080, so ten rows reach 944 (992
        // with the overflow line) and an eleventh would crowd the frame.
        // Anything over the cap becomes the "+N more" line, which is why the
        // number is safe to turn down as well as up.
        { key: 'maxRows', type: 'number-override', label: 'Rows Shown', description: 'How many matches the board draws before it folds the rest into a "+N more" line', defaultValue: 6, min: 1, max: 10, step: 1 },
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
    // Game Summary (`summary.html`, so `overlays.summary.*` — the console calls
    // the element `postgamevs`; see settingsTypeOf) — what stands for each team beside the data well: the
    // captain art with the team logo ghosted behind it (the default), or the
    // logo itself as the team's image (postgame-vs-mount.js `sideCrest`, sized
    // to the gutter between the cards so it can never overlap one).
    summary: [
        { key: 'sideArt', type: 'select', label: 'Team Art', description: 'What stands for each team beside the stats: the captain, or the team logo (a league logo when the game was a league game)', options: [{ value: 'captains', label: 'Captains' }, { value: 'logos', label: 'Team Logos' }], defaultValue: 'captains' },
    ],
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
    // switches; those are gone, because the parts of the block a producer cuts
    // between are WHOLE BLOCKS the theme draws, not parts they subtract from
    // one. Same def, so it is still the rail's quick-face row.
    //
    // ROSTERS is the block that switch pair was really reaching for, and the
    // reason it had to be a block: turning the diamond off inside the full one
    // takes the INNING with it (the marker lives at the head of that same
    // situation row), leaving a card that cannot say what inning it is. The
    // rosters block is the full block's rows with a strip at its foot carrying
    // the inning, or FINAL — see `el-rosters` in the theme SVGs. Reads down in
    // descending detail: full / rosters / condensed / off.
    scorecard: [
        { key: 'showHeader',   group: 'Top bars', type: 'switch', label: 'Header Bar',    description: 'Branding logo + title bar (element 0)', defaultValue: true },
        { key: 'titleText',    group: 'Top bars', type: 'text',   label: 'Header Title',   description: 'Centered next to the logo. Blank uses the branding logo alone.', placeholder: 'Project Rio' },
        { key: 'showPhase',    group: 'Top bars', type: 'switch', label: 'Bracket Phase',  description: 'Bracket-phase bar (element 1)', defaultValue: true },
        { key: 'phaseText',    group: 'Top bars', type: 'text',   label: 'Phase Text',     description: 'Overrides the bracket-phase bar. Leave blank to use the assigned match’s phase; the bar hides when neither is set.', placeholder: 'Winners Final' },
        { key: 'showGameMode', group: 'Top bars', type: 'switch', label: 'Game Mode',      description: 'Game-mode bar (element 2)', defaultValue: true },
        { key: 'mainMode',     type: 'select', label: 'Score Block',    description: 'Full block (3), rosters without the at-bat situation (3b), condensed bar (3a), or neither', options: [{ value: 'full', label: 'Full' }, { value: 'rosters', label: 'Rosters' }, { value: 'condensed', label: 'Condensed', railLabel: 'Bar' }, { value: 'off', label: 'Off' }], defaultValue: 'full' },
        { key: 'showAtBat',    group: 'Lower bars', type: 'switch', label: 'At-Bat Lines',   description: 'Current batter + pitcher game lines (element 4)', defaultValue: true },
        { key: 'showBoxScore', group: 'Lower bars', type: 'switch', label: 'Box Score',      description: 'Per-inning linescore (element 5)', defaultValue: true },
        /*
         * THE FOOTER IS TWO FACTS AND ONE LAYOUT QUESTION. Stadium and Date are
         * peers, so each gets its own eye like every other band here; what they
         * also have, and no other pair on this card does, is that both are one
         * short centred line — so WHERE they go is not a third question. A
         * `footerLayout` picker offering "one line / two bars" shipped for about
         * an hour and came straight back out: stacking them under six other
         * bands spends 88 units saying what fits in 44, which makes the second
         * arrangement the worse one in every state, so the control could only
         * ever be a way to make the card taller and no better.
         *
         * DATE IS OFF BY DEFAULT and Stadium stays on, so nothing already on air
         * moved. It reads `date_time_end`, falling back to the start, so it is
         * not a band that only turns up at the final out.
         */
        { key: 'showStadium',  group: 'Lower bars', type: 'switch', label: 'Stadium',        description: 'Stadium bar (element 6)', defaultValue: true },
        { key: 'showDate',     group: 'Lower bars', type: 'switch', label: 'Date',           description: "The game's date, on the stadium line. Blank until the feed reports one.", defaultValue: false },

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

        { key: 'showFooter',    group: 'Bottom band', type: 'switch', label: 'Footer Band',  description: 'The bottom row of fields', defaultValue: true },

        // The two offsets sit HERE rather than each under its own band's
        // switch. They are geometry, and the producer setting one is placing
        // both — a top strip and a bottom strip are framing the same canvas, so
        // the question being answered is how far in from each edge, which is
        // one question asked twice and wants the two answers side by side (and
        // beside the width, which is the third).

        // Last, and that is the ranking: these are set once for an event, where
        // the two band switches above are flipped during one.
        // A segment label is ONE word. A segmented control divides its row
        // between its options, so it has whatever a column's width leaves after
        // the label gutter divided by three — ~82px at two columns. "None
        // (transparent)" and "Soft Scrim" both wrapped to a second line there
        // and broke the panel's 28px rhythm. The adjectives were describing, and
        // `description` is where describing goes.
        { key: 'headerOffsetY', group: 'Both bands', type: 'number-override', label: 'Top Offset', description: 'Nudge the header band down from the top edge', defaultValue: 0, min: 0, max: 480, step: 1, suffix: 'px' },
        { key: 'footerOffsetY', group: 'Both bands', type: 'number-override', label: 'Bottom Offset', description: 'Nudge the footer band up from the bottom edge', defaultValue: 2, min: 0, max: 480, step: 1, suffix: 'px' },
        { key: 'bandWidth',     group: 'Both bands', type: 'number-override', label: 'Band Width', description: 'Centered content width for both rows', defaultValue: 1263, min: 600, max: 1920, step: 1, suffix: 'px' },
        // PX, NOT A PERCENTAGE. It was `fontScale`, 50–200% of a 34px base the
        // producer never sees — so the one thing this knob is reached for
        // ("make it about as tall as the scoreboard's names") could only be
        // found by trial, and two elements set to the same size said 100 and
        // 34. The band, the gap between fields and the bar's corner still
        // derive from it, so only the unit moved. Migrated by
        // _eventheader_font_px in server/settings.py against the same 34.
        // ONE PER BAND, because the two bands are not one thing said twice:
        // the top strip names the competition and the bottom carries round and
        // phase, and sizing the heading is no reason to resize the footnote.
        // Both moves live in _eventheader_font_px (server/settings.py), which
        // walks fontScale -> fontSize -> the pair against the same 34.
        { key: 'headerFontSize', group: 'Both bands', type: 'number-override', label: 'Top Font Size', description: 'Type size for the header row; its band grows with it', defaultValue: 34, min: 16, max: 72, step: 1, suffix: 'px' },
        { key: 'footerFontSize', group: 'Both bands', type: 'number-override', label: 'Bottom Font Size', description: 'Type size for the footer row; its band grows with it', defaultValue: 34, min: 16, max: 72, step: 1, suffix: 'px' },
        { key: 'bgStyle',       group: 'Both bands', type: 'select', label: 'Band Background', description: 'Optional readability plate behind each row: none (transparent), a soft scrim, or a solid bar', options: [{ value: 'none', label: 'None' }, { value: 'scrim', label: 'Scrim' }, { value: 'bar', label: 'Bar' }], defaultValue: 'none' },
        // `short`: the whole value is one glyph, so the field says so rather
        // than stretching the width of its column.
        { key: 'separator',     group: 'Both bands', type: 'text',   label: 'Field Separator', description: 'Character drawn between fields in a row', defaultValue: '◆', placeholder: '◆', short: true },
    ],
};

/**
 * A stored boolean setting, resolved the way BOTH runtimes must resolve it.
 *
 * Three rules were in use for four keys: `applyDesignSettings` read truthiness,
 * while the Design tab read `!== false` for the default-on switches and
 * `=== true` for the default-off one. That only diverges on a value that is not
 * a boolean — but settings.json is hand-editable and `PUT /api/v1/settings`
 * takes its value as a STRING, so `"true"` is a shape that really occurs, and
 * on it the Design tab drew its switch OFF while every overlay drew the shadow.
 * A producer looking at the control that is supposed to explain the broadcast
 * was told the opposite of what the broadcast was doing.
 *
 * The two string spellings are honoured rather than rejected, so the value a
 * hand edit or the REST API writes means what it says. Anything else is not an
 * answer, and the default stands.
 *
 * Mirrored in public/layout/lib/overlay-base.js — overlay-base is a classic
 * script and cannot import a module, so the two are pinned against one truth
 * table in designConstants.test.js.
 */
export function settingOn(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
}

// ── Which design-package file draws a layout type ──
// Layout type → the theme SVG's file stem, which is what a package's `elements`
// / `appVarElements` are named after. The map answers one question for two
// callers: is this element painted by the app's palette under the active
// package, or does the package bring its own (./designPackage.js).
//
// The two callers want DIFFERENT coverage, which is why this is no longer just
// the `appPalette` types:
//   - an element's own `appPalette` settings (statValueColor, subtextColor) —
//     needs an entry or the gate silently never fires;
//   - the per-element STYLE OVERRIDES of global keys, which every themed
//     element has, so every themed element needs a stem.
// A type ABSENT here is never drawn by a theme SVG at all — the Event Header
// and Player Name are the two, and they are exactly the elements whose mounts
// apply the palette unconditionally.
//
// `stats` was deliberately absent for as long as the type was shared by two
// renderers — the fed Stats bar was plain HTML and always honoured the app
// palette, while stats.html is the themed SVG — so there was no single answer
// and the safe one was not to gate. The fed bar is deleted and
// `overlays.statsbar.*` now has exactly one reader, so the answer exists.
export const THEME_ELEMENT = {
    statsbar: 'statsbar',
    schedule: 'schedule',
    statscard: 'statscard',
    commentary: 'commentary',
    lowerthird: 'lowerthird',
    matchup: 'matchup',
    playerplates: 'playerplates',
    scorecard: 'scorecard',
    ticker: 'ticker',
    // The scoreboard is THREE theme files, one per size, and a package may tier
    // them differently — so its stem is a function of the source's ?size=, not
    // a constant. `themeElementFor` is the only correct way to read this entry;
    // the value here is the default size's file, for a caller with no variant.
    scoreboard: 'scoreboard-l',
};

// Size codes the scoreboard ships (server/theme_contracts.py CONTRACTS is the
// source of truth; the mount resolves anything unknown to `l`, so this does
// too rather than inventing a stem no package can have shipped).
const SCOREBOARD_SIZES = new Set(['s', 'l']);

/**
 * The theme stem for `type`, given the source's size variant where that matters.
 *
 * @param type layout/settings type ('scoreboard', 'statsbar', …)
 * @param size the source's ?size= code, or null/undefined for the default
 */
export function themeElementFor(type, size) {
    if (type !== 'scoreboard') return THEME_ELEMENT[type];
    return `scoreboard-${sizeCodeFor(type, size)}`;
}

/**
 * The size code a source ACTUALLY renders at — the mount resolves anything
 * unknown or retired (and a bare URL with no ?size=) to `l`, so this does too.
 * Split out of `themeElementFor` because the theme stem is not the only thing
 * that turns on it: a per-size SETTING gate needs the same answer, and two
 * copies of the fallback is how the console offers a knob for a size the source
 * isn't on.
 *
 * @param type layout/settings type
 * @param size the source's ?size= code, or null/undefined for the default
 */
export function sizeCodeFor(type, size) {
    if (type !== 'scoreboard') return size ?? null;
    return SCOREBOARD_SIZES.has(size) ? size : 'l';
}

/**
 * Does `def` reach a source at this size?
 *
 * THE FOURTH GATE, and the one the `<meta>` whitelist structurally cannot draw:
 * a layout declares what it honours per TYPE, and the scoreboard's three size
 * variants are one HTML file with one `<meta>`. So a setting whose part only
 * exists at some sizes says so here, and the console stops offering it where
 * nothing would move — the same rule as `showWhen` and `appPalette`, which are
 * the other two ways a registered setting can be inert on the source in front
 * of you. A def with no `sizes` reaches every size.
 */
export function settingReachesSize(def, type, size) {
    if (!def?.sizes) return true;
    return def.sizes.includes(sizeCodeFor(type, size));
}

// ── Which layouts can honour a PER-ELEMENT override ──
// The settings types whose mount calls OverlayBase.applyDesignSettings, which is
// the only code that ever reads `overlays.{type}.{key}` on top of the global
// (its `perAccent` / `perFont` / `perBadge` / CARD_OVERRIDE_VARS reads). A mount
// outside this list may still honour the GLOBAL key perfectly well — it just has
// no path by which one element's pin could reach it.
//
// That is the distinction the `<meta name="overlay-settings">` whitelist cannot
// draw, and why this list exists beside it. Both post-game callouts declare
// `accentColor, bodyFont, monoFont` and mean them. The accent is still read
// straight off the global by postgame-callout-mount.js, so a per-element accent
// pin on a callout stores, broadcasts and is ignored; the two FONT roles are
// not, because those mounts now call `OverlayBase.applyTypeRoles(ns)` with their
// own namespace. The meta is honest; it is answering a different question.
//
// Pinned against the mounts themselves by designConstants.test.js. If you add a
// mount that applies the palette, add it here in the same change or its
// overrides are unreachable.
export const OVERRIDE_CAPABLE_TYPES = [
    // Conditional — applied only when the active theme opts in
    // (`engine.usesAppVars`), which is what THEME_ELEMENT above gates on.
    'scoreboard', 'scorecard', 'statsbar', 'statscard',
    'commentary', 'lowerthird', 'matchup', 'playerplates', 'schedule', 'ticker',
    // Unconditional — no theme SVG exists for these, so the palette is the only
    // thing that styles them under every package.
    'eventheader', 'playername',
];

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
    { key: 'borderWidth',    meta: ['borderWidth'],    type: 'number',        label: 'Border Thickness',   defaultValue: 1,  min: 0, max: 16, step: 1, suffix: 'px' },
    { key: 'cardShadowBlur', meta: ['cardShadow'],     type: 'number',        label: 'Card Shadow Blur',   defaultValue: 16, min: 0, max: 80, step: 2, suffix: 'px' },

    /*
     * A COLOUR AND THE SIZE OF WHAT IT PAINTS ARE ONE SETTING, so they are one
     * ROW: `colorKey` names the partner, and the partner carries `partner: true`
     * so it is never offered or drawn on its own. Adding the row pins both,
     * removing it unpins both, and the × belongs to the pair.
     *
     * They were separate entries, which put "Font Border" and "Font Border
     * Color" on two rows of a section that is an exception list — so a producer
     * adding an outline added half of one, and the panel said the colour of a
     * border was a different decision from whether there is a border. Nothing
     * reads either alone: at width 0 the colour paints nothing, and a colour
     * left at the global is not an opinion, it is the absence of one.
     */
    { key: 'textShadowBlur', meta: ['textShadow'], colorKey: 'textShadowColor', type: 'number', label: 'Text Shadow',   defaultValue: 4,  min: 0, max: 40, step: 1, suffix: 'px' },
    { key: 'textShadowColor', meta: ['textShadow'], partner: true, type: 'color-opacity', label: 'Text Shadow Color', defaultValue: 'rgba(0, 0, 0, 0.8)' },
    // Font border (text stroke). Two keys, one meta name, and no enable switch:
    // 0 is off, so the width IS the switch and nothing can disagree with it.
    // The global default is 0, which is what makes this override-shaped rather
    // than global-shaped — pinning a width on one element gives that element an
    // outline and leaves every other overlay exactly as it was.
    { key: 'textStrokeWidth', meta: ['textStroke'], colorKey: 'textStrokeColor', type: 'number', label: 'Font Border', defaultValue: 0,  min: 0, max: 12, step: 0.5, suffix: 'px' },
    { key: 'textStrokeColor', meta: ['textStroke'], partner: true, type: 'color-opacity', label: 'Font Border Color',  defaultValue: 'rgba(0, 0, 0, 1)' },
    { key: 'showCaptains',     meta: ['showCaptains'],     type: 'switch', label: 'Show Captains' },
    { key: 'showLogo',         meta: ['showLogo'],         type: 'switch', label: 'Show Overlay Logo' },
    { key: 'showShadow',       meta: ['showShadow'],       type: 'switch', label: 'Card Shadow' },
    // No global default: unset, the shipped badge is `fill:var(--accent)` and
    // follows the accent. `seedFrom` is what a freshly ADDED override starts
    // at — the value the element is already drawing, so adding the row changes
    // nothing on air. Without it this is the one key that resolves to null,
    // and picking it from the Add menu would write null, which means unpinned:
    // the row would not appear at all.
    { key: 'finalBadgeColor',  meta: ['finalBadgeColor'],  type: 'color',  label: 'Final Badge Color', seedFrom: 'accentColor' },
    /*
     * THREE TYPE ROLES, not one face.
     *
     * The token layer has always split broadcast type three ways and every
     * theme SVG paints from those vars; these are the producer's end of the
     * same three, so a knob here reaches the whole show rather than the four
     * DOM-rendered elements the single `fontFamily` could touch.
     *
     * They are per-element pinnable for the same reason the accent is: an
     * element that has to carry a sponsor's face is the exception the override
     * section exists for. Which of the three a given element OFFERS is its own
     * `<meta>` whitelist's answer — the post-game callouts declare only
     * `bodyFont, monoFont`, because their headline type draws at 800/900 and
     * has not been converted to the display role, and the Player Name and
     * Event Header declare only `displayFont`, because a name and a band of
     * titles are all they draw.
     *
     * For an element drawn by a THEME SVG the whitelist names all three (a
     * package may set text in any role), and the theme itself narrows it:
     * `role` is what the stage matches against the active theme's scanned
     * `typeRoles` (drawnTypeRoles, ./designPackage.js). A role is offered only
     * where something is set in it — default's Commentary draws no numerals.
     */
    { key: 'displayFont', meta: ['displayFont'], role: 'display', type: 'font', label: 'Display Font', defaultValue: 'Rajdhani',   description: 'Names, titles and status labels' },
    { key: 'bodyFont',    meta: ['bodyFont'],    role: 'body',    type: 'font', label: 'Body Font',    defaultValue: 'Inter',      description: 'Meta, captions and prose lines' },
    { key: 'monoFont',    meta: ['monoFont'],    role: 'mono',    type: 'font', label: 'Numeral Font', defaultValue: 'Chivo Mono', description: 'Scores, stats, linescores and clocks' },
];

/*
 * The shipped face for each type role, as the font pickers pin it above every
 * other font (FontCombobox `pinned`). Derived from the font rows above so the
 * pickers, the overrides and the Design tab cannot name different defaults.
 */
export const TYPE_ROLE_DEFAULTS = OVERRIDABLE_GLOBAL_KEYS
    .filter(d => d.type === 'font')
    .map(d => ({ value: d.defaultValue, role: d.role, detail: `${d.label.replace(/ Font$/, '')} default` }));

// ── Which types each override key actually REACHES ──
// `OVERRIDABLE_GLOBAL_KEYS` says a key CAN be pinned per element; this says on
// which elements the pin is read back. They are not the same list, because
// overlay-base.js reads a per-element override in three different ways and only
// one of them is universal:
//
//   every type   `perAccent` / the three type roles / `perBadge` / `perCardBlur` /
//                `perTextBlur` — read straight off `overrideNs` in
//                applyDesignSettings, so they work wherever it is called.
//   some types   LAYOUT_VAR_MAP — the card surface and the text colour are read
//                only for the types listed there. A `cardBg` pin on the
//                commentary or the ticker stores and broadcasts and is never
//                looked at.
//   the mount    `showCaptains` / `showLogo` never go through
//                applyDesignSettings at all — the ticker and the scoreboard
//                read them with `readSetting`, which does its own
//                per-layout-then-global resolution.
//   nowhere      `showShadow` is read as `overlays.global.showShadow` with no
//                per-element read anywhere, so it cannot be pinned at all.
//
// `null` = every type. `[]` = no type. Pinned against overlay-base.js by
// designConstants.test.js, because a key promoted to a row it cannot reach is
// exactly the silent no-op the override gating exists to prevent.
//
// THE STAT PAIR REACHES THE CARD SURFACE AGAIN as of 2026-09-12. It did not
// between the 2026-08-23 rename and then: LAYOUT_VAR_MAP was still keyed on
// `stats`, the name the element had before, so for `statsbar` / `statscard` the
// lookup missed and NONE of these vars were written — including the two the
// element's own panel advertises, Stat Value Color and Subtext Color. The
// decision the old note deferred is made: a pin that has never once applied is
// not a pin anyone is relying on, and two colour controls the UI offers and the
// overlay ignores cost more than the theoretical producer whose stored, inert
// cardBg starts painting.
//
// THERE IS NO CORNER RADIUS, anywhere. `rx` cannot take a CSS variable in SVG,
// so a themed card's corner is a literal in the artwork, and no shipped theme
// (nor the theme contract in public/design/README.md) reads `--border-radius`.
// It was a Design-tab control and a per-element pin that moved nothing on any
// package until 2026-09-16, when both came out. `[]` rather than deleting the
// entry, so the one thing this table says about it is "reaches nothing".
const OVERRIDE_READ_TYPES = {
    accentColor: null,
    displayFont: null,
    bodyFont: null,
    monoFont: null,
    finalBadgeColor: null,
    cardShadowBlur: null,
    textShadowBlur: null,
    // Read off `overrideNs` like the blurs, so the pin reaches wherever
    // applyDesignSettings runs. Which elements DRAW it is the layout's own
    // question, answered by its <meta> whitelist — a layout declares
    // `textStroke` / `textShadow` exactly when its CSS binds --text-stroke-* /
    // --text-shadow to something. Player Name and the Event Header do; an
    // element painted by a theme SVG gets its outline from the artwork.
    textStrokeWidth: null,
    textStrokeColor: null,
    textShadowColor: null,
    cardBg: ['scoreboard', 'eventheader', 'statsbar', 'statscard'],
    borderColor: ['scoreboard', 'statsbar', 'statscard'],
    borderRadius: [],
    borderWidth: ['scoreboard', 'statsbar', 'statscard'],
    textColor: ['scoreboard', 'playername'],
    showLogo: ['scoreboard'],
    // The two card elements, and only those — they are the only ones whose
    // themes draw a rail at all.
    showRail: ['scoreboard', 'scorecard'],
    showCaptains: ['ticker'],
    showShadow: [],
};

/** Is a per-element pin of `key` read back on `type`? */
export function overrideReaches(key, type) {
    const types = OVERRIDE_READ_TYPES[key];
    return types == null ? true : types.includes(type);
}

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
    'accentColor', 'cardBg', 'textColor', 'borderColor', 'borderWidth',
    'displayFont', 'bodyFont', 'monoFont',
    'showShadow', 'cardShadowBlur', 'cardShadowColor',
    'textShadowEnabled', 'textShadowBlur', 'textShadowColor',
    'textStrokeWidth', 'textStrokeColor',
    // Promoted from per-layout in v2:
    // THE OUTER RAIL IS PACKAGE CHROME, which is why it is up here with the
    // other two promoted booleans rather than on the two element panels that
    // draw it. It carries no data and marks no boundary — it is the theme's
    // opinion about its own edge — so the decision is one decision about the
    // LOOK, taken once on the Design tab, and a card panel is the wrong place
    // to take it: as a registry entry it landed ungrouped after the Lower bars
    // region on the Scorecard, an orphan row with no heading, and last in a
    // flat list on the Scoreboard. Same resolution as showLogo — global, with a
    // per-board pin over it for the case where one card wants it and the other
    // doesn't.
    'showCaptains', 'showLogo', 'showRail', 'finalBadgeColor',
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
    borderColor:       'rgba(255, 255, 255, 0.08)',
    borderWidth:       1,
    displayFont:       'Rajdhani',
    bodyFont:          'Inter',
    monoFont:          'Chivo Mono',
    showShadow:        true,
    cardShadowBlur:    16,
    cardShadowColor:   'rgba(0, 0, 0, 0.5)',
    textShadowEnabled: false,
    textShadowBlur:    4,
    textShadowColor:   'rgba(0, 0, 0, 0.8)',
    // 0 = no border anywhere until something pins one.
    textStrokeWidth:   0,
    textStrokeColor:   'rgba(0, 0, 0, 1)',
    showCaptains:      true,
    showLogo:          true,
    // Theme chrome that says nothing — off unless the producer asks. See the
    // note beside it in GLOBAL_DESIGN_KEYS.
    showRail:          false,
    finalBadgeColor:   null,
    // null = inherit (package, then DEFAULT_PORT_COLORS) — never a literal
    // colour here, or a preset would pin the app's palette over the package's.
    port0Color:        null,
    port1Color:        null,
    port2Color:        null,
    port3Color:        null,
    designPackage:     'default',
};
