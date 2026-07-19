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
 * Console contract (production-console-contract skill) — the registry also
 * carries each element's console declaration:
 *   - `quickFace` : the rail card's rows (≤ 2), or explicit null (= not
 *                   pinnable). OMITTED on most elements — the default derives
 *                   from flavor via quickFaceFor(): direct → visibility
 *                   toggle; fed → content pick + push.
 *   - `stageBody` : key of the element's stage panel under stage/ — defaults
 *                   to the element id via stageBodyFor(); declare only to
 *                   deviate.
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
        id: 'scorecard',
        name: 'Scorecard',
        // The vertical scorecard — a stack of independently toggleable bands
        // (header, phase, game mode, score block, rosters, bases, at-bat, box
        // score, stadium) that the producer flips live; the mount animates each
        // group in/out. Config is per board (overlays.scorecard.{N}.*), so two
        // scorecard sources can be driven independently. Native 1920×1080; the
        // SVG scales to whatever the OBS source is.
        phase: 'live',
        flavor: 'direct',
        url: '/layout/scorecard/scorecard.html',
        width: 1920,
        height: 1080,
        // Deliberately narrow: fourcam.html shares the folder and must NOT bind
        // here, and 'scorecard' must not be swallowed by the Scoreboard matcher.
        match: (url) => /scorecard\/scorecard/i.test(url) || /scorecard\.html/i.test(url),
        // Two rows: is it on air, and which score block is showing — the pair a
        // producer reaches for mid-game. Everything else is stage work.
        quickFace: { rows: ['visibility', 'setting'] },
    },
    {
        id: 'stats',
        name: 'Stats',
        phase: 'live',
        flavor: 'fed',
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
        url: '/layout/playerplates/playerplates.html',
        width: 1920,
        height: 1080,
        match: (url) => /\/layout\/playerplates\//i.test(url) || /playerplates\.html/i.test(url),
    },
    {
        id: 'postgamecallout',
        name: 'Character Spotlight',
        // Post-game only: the full-screen per-character callout — identity column
        // (hero art, team-logo badge, H-AB premier stat, batting/pitching/defense
        // boxes) around an embedded hit-visualizer AB Theater that replays every
        // plate appearance and ends holding on the spray chart. Fed like Stats —
        // the producer picks which side + roster slot; the pick is written to the
        // chosen container's feed key (production.feed.container.<id> =
        // { element:'postgamecallout', … }). Reads postgame.{N}.* plus the
        // REST-only GET /postgame/abs walkthrough payload. Native 1920×1080.
        phase: 'post',
        flavor: 'fed',
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
        url: '/layout/matchup/matchup.html',
        width: 1920,
        height: 1080,
        match: (url) => /\/layout\/matchup\//i.test(url) || /matchup\.html/i.test(url),
    },
    {
        id: 'bracket',
        name: 'Bracket',
        // The tournament bracket, rendered from the bracket.* structure the
        // Bracket desk publishes. winners_only.html / losers_only.html are thin
        // redirects into index.html with a flag, so all three are the same
        // element wearing different filters — the desk decides WHICH phase is
        // on screen, this decides whether it's visible. Break filler and
        // draft-phase context both want it.
        phase: ['draft', 'break'],
        flavor: 'direct',
        url: '/layout/bracket/index.html',
        width: 1920,
        height: 1080,
        match: (url) => /\/layout\/bracket\/(index|winners_only|losers_only)/i.test(url),
    },
    {
        id: 'ticker',
        name: 'Results Ticker',
        // The scrolling results strip (rotator group) — completed games cycling
        // along the bottom. Nothing to decide live but whether it's up: its
        // scroll speed and card spacing are number settings with no kit row, so
        // they stay in Setup. Native 1920×80.
        phase: ['live', 'break'],
        flavor: 'direct',
        url: '/layout/rotator/ticker.html',
        width: 1920,
        height: 80,
        match: (url) => /\/layout\/rotator\/ticker/i.test(url),
    },
    {
        id: 'eventheader',
        name: 'Event Header',
        // The two persistent bands framing the canvas: top (competition ·
        // location · dates) and bottom (message · event · phase · round). It
        // sits over the whole broadcast, so it appears in every phase. Bands
        // and per-field visibility are live switches (overlays.eventheader.*);
        // geometry stays in Setup. Native 1920×1080.
        phase: ['draft', 'live', 'post', 'break'],
        flavor: 'direct',
        url: '/layout/eventheader/eventheader.html',
        width: 1920,
        height: 1080,
        match: (url) => /eventheader/i.test(url),
        // Its source visibility plus the two band switches would be three rows;
        // the bands are the pair that matters live, and the source toggle stays
        // one click away on the stage.
        quickFace: { rows: ['setting', 'setting'] },
    },
    {
        id: 'hitvisualizer',
        name: 'Hit Visualizer',
        phase: 'live',
        flavor: 'direct',
        // Compact: live actions (Replay / Spotlight / Split) on the face, the
        // spotlight scene + hold-ms + split config behind the gear.
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

// ── Console contract resolvers ─────────────────────────────────────────────
// Quick-face row vocabulary (interpreted by the rail when it renders a card):
//   'visibility' — toggle the element's source (direct default)
//   'content'    — pick what feeds the shared container (uses el.feed)
//   'push'       — push the picked content to the container
//   'setting'    — one of the element's own live overlay settings (a band
//                  switch, the scorecard's score block)
const QUICK_FACE_DEFAULTS = {
    direct: { rows: ['visibility'] },
    fed: { rows: ['content', 'push'] },
};

// The element's effective quick face: explicit null = not pinnable (an
// intentional, visible state — the pin affordance doesn't render); an omitted
// quickFace takes the flavor default.
export function quickFaceFor(el) {
    if (el.quickFace === null) return null;
    return el.quickFace ?? QUICK_FACE_DEFAULTS[el.flavor] ?? null;
}

export const isPinnable = (el) => quickFaceFor(el) !== null;

// Key of the element's stage panel (stage/<key>); defaults to the element id.
export const stageBodyFor = (el) => el.stageBody ?? el.id;
