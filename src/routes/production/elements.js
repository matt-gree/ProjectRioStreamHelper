/*
 * Production page — the dev-curated set of ELEMENTS (no authoring UI yet).
 *
 * Vocabulary (memory: production-elements-glossary):
 *   - Element        : a pre-designed thing the producer puts on the broadcast,
 *                      shown on the Production page and organized by phase.
 *   - Direct element : owns a DEDICATED source; fire = show/hide it.
 *   - Fed element    : its content is fed to a SHARED source (the TARGET);
 *                      default target + streamer override. Fed elements with a
 *                      `feed` kind also render a content picker (e.g. 'stats' =
 *                      choose which roster character), writing the pick to
 *                      `production.feed.<id>` in live State for the shared
 *                      overlay to render. Without a `feed` kind, the card just
 *                      shows/hides the target.
 *
 * Binding is by URL: each element matches the streamer's OBS browser source(s)
 * whose URL is its PRSH layout ("set the layout with them"), so there's no
 * manual wiring in the common case. Matching is scoped to the current PROGRAM
 * scene, which is also where firing happens.
 *
 * Layout: each element renders as a self-contained "window" in a 12-column grid
 * on the Production page. `span` is how many of the 12 columns it occupies — the
 * face holds the live actions, with bulky setup tucked behind a gear popover so
 * a small element (e.g. Hit Visualizer at span 2) stays compact.
 */

export const PHASES = [
    { label: 'Draft', value: 'draft' },
    { label: 'Live', value: 'live' },
    { label: 'Post-game', value: 'post' },
    { label: 'Break', value: 'break' },
];

export const ELEMENTS = [
    {
        id: 'scoreboard',
        name: 'Scoreboard',
        phase: 'live',
        flavor: 'direct',
        // Grid width on the Production page (out of 12 columns).
        span: 3,
        // Its own dedicated source: the scoreboard layout. `url` is the canonical
        // overlay this element expects (the default when adding it to OBS or
        // checking whether the streamer's source points at the right thing);
        // `width`/`height` size the OBS browser source.
        url: '/layout/scoreboard1/scoreboard.html',
        width: 800,
        height: 460,
        match: (url) => /\/layout\/scoreboard\d*\/scoreboard/i.test(url) || /scoreboard\.html/i.test(url),
    },
    {
        id: 'stats',
        name: 'Stats',
        phase: 'live',
        flavor: 'fed',
        span: 4,
        // `feed` names the content picker the card renders: 'stats' = pick which
        // roster character's stats to show. The pick is written to the chosen
        // named container's feed key (production.feed.container.<id> = { element:
        // 'stats', … }); the container overlay renders it.
        feed: 'stats',
        // Default container = the Stats shared overlay (small bar). `url` is its
        // canonical source; the producer can feed any other named container too.
        url: '/layout/shared/stats-feed.html',
        width: 325,
        height: 120,
        match: (url) => /shared\/stats-feed/i.test(url) || /stats/i.test(url),
    },
    {
        id: 'commentary',
        name: 'Commentary',
        // Registry-bound caster desk — relevant across the broadcast lifecycle,
        // so it shows in every soft phase. `phase` may be a single value or an
        // array (see elementsForPhase).
        phase: ['draft', 'live', 'post'],
        flavor: 'direct',
        // The condensed face is per-caster on-air toggles + sub-field quick switch
        // + sub-plate toggle; the in-depth roster authoring lives on the
        // Commentary tab. Span 4 to fit up to four caster rows.
        span: 4,
        // Its own dedicated source: the caster strip. Slots are projected to
        // commentary.{i}.* server-side from the authored commentary.slots.
        url: '/layout/commentary/commentary.html',
        width: 1280,
        height: 200,
        match: (url) => /\/layout\/commentary\//i.test(url) || /commentary\.html/i.test(url),
    },
    {
        id: 'postgamecallout',
        name: 'Stat Callout',
        // Post-game only: a full-screen, port-coloured reveal of one finished-game
        // roster character's box-score line. Fed like Stats — the producer picks
        // which side + roster slot; the pick is written to the chosen container's
        // feed key (production.feed.container.<id> = { element:'postgamecallout',
        // … }) and the callout-stage container renders it. Reads postgame.{N}.*
        // (Phase 6 capture). Native full-canvas 1920×1080.
        phase: 'post',
        flavor: 'fed',
        span: 4,
        feed: 'postgamecallout',
        url: '/layout/shared/callout-stage.html',
        width: 1920,
        height: 1080,
        match: (url) => /callout-stage/i.test(url) || /callout/i.test(url),
    },
    {
        id: 'hitvisualizer',
        name: 'Hit Visualizer',
        phase: 'live',
        flavor: 'direct',
        // Compact: live actions (Replay / Spotlight / Split) on the face, the
        // spotlight scene + hold-ms + split config behind the gear.
        span: 2,
        // Its own dedicated source: the 3D hit overlay. The provider pushes every
        // contact to score.{N}.hit.*; the producer reveals this to show one and can
        // re-fire it with Replay (writes score.{N}.hit.replay_nonce). Native 1280×720.
        url: '/layout/hitvisualizer/hitvisualizer.html',
        width: 1280,
        height: 720,
        match: (url) => /hitvisualizer/i.test(url),
    },
];

// An element's `phase` is a single value or an array of phases it appears in.
export const elementsForPhase = (phase) => ELEMENTS.filter((el) =>
    Array.isArray(el.phase) ? el.phase.includes(phase) : el.phase === phase);
