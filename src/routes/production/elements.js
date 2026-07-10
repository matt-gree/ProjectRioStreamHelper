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
 * on the Production page. `span` is the element's PREFERRED width out of 12
 * columns — the page packs elements into rows and stretches every full row to
 * exactly 12 (see packRows in production.jsx), so spans are a starting point,
 * not a guarantee. The face holds the live actions, with bulky setup tucked
 * behind a gear popover so a small element (e.g. Hit Visualizer) stays compact.
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
        span: 3,
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
        id: 'playerplates',
        name: 'Player Plates',
        // Two-player name/sub-plate band — a sibling of Commentary. Three MODES:
        // both (side 1 left / side 2 right), or a single player at a togglable
        // left/center/right location. Each plate is fed from a match (participant
        // → name + a chosen address-book field) or typed manually. Relevant
        // pre-game/intro (draft), on the desk (live), and over breaks. Direct
        // element (own dedicated source); the face is the mode + per-plate
        // content, projected to playerplates.* server-side. Native 1920×1080.
        phase: ['draft', 'live', 'break'],
        flavor: 'direct',
        span: 5,
        url: '/layout/playerplates/playerplates.html',
        width: 1920,
        height: 1080,
        match: (url) => /\/layout\/playerplates\//i.test(url) || /playerplates\.html/i.test(url),
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
        id: 'postgamevs',
        name: 'Game Summary',
        // Post-game only: the full-screen player-vs-player end-of-game callout —
        // both captains with team logos, the match context (tournament · round ·
        // series) top-center, and the side totals (runs / hits / homeruns /
        // stars won / strikeouts pitched) unfolding from the center line. Fed
        // into the same Callout Stage as the Stat Callout: pushing writes
        // production.feed.container.<id> = { element:'postgamevs', scoreboard }.
        // Reads postgame.{N}.player.{T}.totals (Phase 6 capture). 1920×1080.
        phase: 'post',
        flavor: 'fed',
        span: 4,
        feed: 'postgamevs',
        url: '/layout/shared/callout-stage.html',
        width: 1920,
        height: 1080,
        match: (url) => /callout-stage/i.test(url) || /callout/i.test(url),
    },
    {
        id: 'lowerthird',
        name: 'Lower Third',
        // Break phase (also freely placeable mid-game). A re-themable SVG band
        // of FIVE independently toggleable slots (lowerthird.slots.1..5), each
        // one content type: logo · match · scorebox · merch · clock · message ·
        // bracket. Direct element (own dedicated source); everything lives on
        // the face — each slot row is a type picker + on/off that expands in
        // place to that slot's content editor (no gear). Slot widths/looks
        // belong to the design package. Native 1920×1080.
        phase: 'break',
        flavor: 'direct',
        span: 6,
        url: '/layout/lowerthird/lowerthird.html',
        width: 1920,
        height: 1080,
        match: (url) => /lowerthird/i.test(url),
    },
    {
        id: 'schedule',
        name: 'Upcoming Schedule',
        // The producer's ordered match queue (schedule.queue, ids into
        // match.{M}) rendered by the schedule overlay. Queue authoring lives on
        // the face (add / reorder / remove, per-match display time); the title
        // sits in the gear. Draft-phase prep and break filler both want it.
        phase: ['draft', 'break'],
        flavor: 'direct',
        span: 4,
        url: '/layout/schedule/schedule.html',
        width: 1920,
        height: 1080,
        // Deliberately narrow: bracket/player_schedule.html must NOT bind here.
        match: (url) => /\/layout\/schedule\//i.test(url),
    },
    {
        id: 'matchuphistory',
        name: 'Matchup History',
        // Head-to-head band: all-time series summary + last-5 game cards for a
        // match's two participants, fetched from the Project Rio API into the
        // singleton matchup.* state (POST /matchup/fetch). Draft-phase hype and
        // break filler both want it. Direct element; SVG themed via the active
        // design package (/design/{pkg}/matchup.svg). Native 1920×1080.
        phase: ['draft', 'break'],
        flavor: 'direct',
        span: 5,
        url: '/layout/matchup/matchup.html',
        width: 1920,
        height: 1080,
        match: (url) => /\/layout\/matchup\//i.test(url) || /matchup\.html/i.test(url),
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

export const GRID_COLS = 12;

// Pack elements into rows of preferred spans, then stretch every row except
// the last to exactly GRID_COLS — the elements tile the full width, row by
// row, with only the final row allowed to run short. Extra columns are dealt
// round-robin so growth is spread across the row.
export function packRows(elements, cols = GRID_COLS) {
    const rows = [];
    let row = [];
    let used = 0;
    for (const el of elements) {
        const span = Math.min(el.span || 3, cols);
        if (used + span > cols && row.length) {
            rows.push(row);
            row = [];
            used = 0;
        }
        row.push({ element: el, span });
        used += span;
    }
    if (row.length) rows.push(row);

    rows.forEach((r, idx) => {
        if (idx === rows.length - 1) return; // the last row may run short
        let deficit = cols - r.reduce((sum, e) => sum + e.span, 0);
        for (let i = 0; deficit > 0; i = (i + 1) % r.length, deficit--) r[i].span += 1;
    });
    return rows;
}
