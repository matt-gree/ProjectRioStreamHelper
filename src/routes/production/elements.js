/*
 * Production page — the dev-curated set of ELEMENTS (no authoring UI yet).
 *
 * Vocabulary (production-console-contract skill):
 *   - Element        : a pre-designed thing the producer puts on the broadcast,
 *                      listed on the Production page under the OBS scene its
 *                      source lives in.
 *   - Direct element : owns a DEDICATED source; fire = show/hide it.
 *   - Fed element    : has no source of its own — its content is pushed into a
 *                      CONTAINER, the one whose roster names it (./containers).
 *                      Membership lives on the container and is exclusive; an
 *                      element on no roster has nowhere to be pushed, which is a
 *                      real state every surface reports rather than defaulting
 *                      around. A `feed` kind additionally names a content picker
 *                      ('stats' = which roster character), and the pick is
 *                      written to `production.feed.container.{id}`.
 *
 * Binding is by URL: each element matches the streamer's OBS browser source(s)
 * whose URL is its PRSH layout, so there's no manual wiring in the common case.
 * Rows are derived SOURCE → ROW, per scene (./placements) — matching is not
 * scoped to the program scene, and nothing searches from an element to a source.
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
 *   - `scope`     : 'board' when the SOURCE carries ?scoreboard=N, so two of
 *                   them in one scene are two instances. Omitted = global.
 *
 * Two board mechanisms, and conflating them is how multiplicity ends up feeling
 * bolted on:
 *
 *   URL-scoped  — the board is fixed by the source (`?scoreboard=N`). These get
 *                 `scope: 'board'` and per-board settings, and two of them in
 *                 one scene are two instances (./instances). There is no board
 *                 picker inside a panel: switching board means selecting the
 *                 other rack row.
 *   Feed-scoped — the board is fixed by the pushed CONTENT ({ element,
 *                 scoreboard } in the feed payload). The shared container is
 *                 board-agnostic on purpose, so fed elements never take `scope`.
 */

export const ELEMENTS = [
    {
        id: 'scoreboard',
        name: 'Scoreboard',
        flavor: 'direct',
        // URL-scoped to a board: the source itself carries ?scoreboard=N, so two
        // of these in one scene are two different instances (see `scope` note
        // at the bottom of this file).
        scope: 'board',
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
        flavor: 'direct',
        scope: 'board',
        url: '/layout/scorecard/scorecard.html',
        width: 1920,
        height: 1080,
        // Deliberately narrow so 'scorecard' is not swallowed by the Scoreboard
        // matcher (which also answers to a bare *.html stem).
        match: (url) => /scorecard\/scorecard/i.test(url) || /scorecard\.html/i.test(url),
        // Two rows: is it on air, and which score block is showing — the pair a
        // producer reaches for mid-game. Everything else is stage work.
        quickFace: { rows: ['visibility', 'setting'] },
    },
    {
        id: 'stats',
        name: 'Stats',
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
        id: 'statscard',
        name: 'Stat Card',
        // The same stat line as Stats, wearing the design package's `statscard`
        // element — the compact 2x2 card, 380x240. It is a CONTAINER MEMBER and
        // nothing else: it has no standalone layout, which is why its canonical
        // url is the generic container shell.
        //
        // 380x240 rather than the original 380x220 since the card grew its two
        // optional caption bands (a header naming the stat set, a footer carrying
        // the live game line): both open is 236 units of card. A container has to
        // be at least this tall to hold it — the stock Roster + Stats containers
        // are 452x240, which is where the height comes from.
        //
        // Not pickable, deliberately. It resolves the side's current batter or
        // pitcher itself (RioData.getStatsLine, the same resolution the engine's
        // `statscard` resolver mirrors), so there is nothing to choose — the only
        // question is whose side, and that is the CONTAINER's scope.
        flavor: 'fed',
        feed: 'statscard',
        url: '/layout/shared/container.html',
        width: 380,
        height: 240,
        match: (url) => /shared\/container/i.test(url),
        // Its frame of reference is the container's, not a board picker's: a
        // manual Push takes scoreboard AND team from the container definition,
        // the same pair the automation engine feeds it. Without this a push into
        // a right-side container would silently show the left side.
        containerScoped: true,
    },
    {
        id: 'roster',
        name: 'Roster',
        // The captain-first 9-character roster for one side. A dedicated source
        // (?scoreboard=N&team=T) like any direct element, AND a container member
        // — a container RESTING on a roster and flashing a stat card over it is
        // the combined Roster + Stats source, rebuilt out of parts.
        //
        // No `scope: 'board'`: its settings are global (overlays.roster.*, which
        // is what roster.html reads), and its two sources differ by ?team=, which
        // the instance grammar reads off the URL as a variant. Same shape as
        // Controller.
        flavor: 'direct',
        url: '/layout/scoreboard1/roster.html',
        width: 452,
        height: 140,
        // Narrow on purpose: rosterstats.html sits in the same folder and must
        // not bind here while the two run in parallel.
        match: (url) => /\/layout\/scoreboard\d*\/roster\.html/i.test(url),
        containerHostable: true,
        containerScoped: true,
    },
    {
        id: 'commentary',
        name: 'Commentary',
        // Registry-bound caster desk.
        flavor: 'direct',
        // The condensed face is per-caster on-air toggles + sub-field quick switch
        // + sub-plate toggle; the in-depth roster authoring lives on the
        // Commentary tab. Span 4 to fit up to four caster rows.
        // Its own dedicated source: the caster strip. Slots are projected to
        // commentary.{i}.* server-side from the authored commentary.slots.
        // Native 1920×240 — full stream width (the row's spacing is measured
        // against the frame) but only as tall as the card, so the producer
        // decides how high up the scene it sits. Keep this in step with the
        // layout's `body { width/height }`, which is what addBrowserSource
        // sizes the OBS source from; it was 1920×1080 while the theme owned a
        // whole canvas, and 1280×200 before that, which sized the source wrong.
        url: '/layout/commentary/commentary.html',
        width: 1920,
        height: 240,
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
        // content, projected to playerplates.* server-side. Native 1920×240 —
        // the Commentary box, for the same reasons; keep it in step with the
        // layout's `body { width/height }`.
        flavor: 'direct',
        url: '/layout/playerplates/playerplates.html',
        width: 1920,
        height: 240,
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
        // A re-themable SVG band
        // of FIVE independently toggleable slots (lowerthird.slots.1..5), each
        // one content type: logo · match · scorebox · merch · clock · message ·
        // bracket. Direct element (own dedicated source); everything lives on
        // the face — each slot row is a type picker + on/off that expands in
        // place to that slot's content editor (no gear). Slot widths/looks
        // belong to the design package. Native 1920×1080.
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
        // sits in the gear.
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
        // singleton matchup.* state (POST /matchup/fetch). Direct element; SVG
        // themed via the active
        // design package (/design/{pkg}/matchup.svg). Native 1920×1080.
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
        // element wearing different filters — the desk decides WHICH start.gg
        // phase is on screen, this decides whether it's visible.
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
        // scroll speed and card spacing render in the stage's Style section
        // (phase 7), not on a quick face. Native 1920×80.
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
        // sits over the whole broadcast. Bands and per-field visibility are
        // live switches (overlays.eventheader.*); geometry renders in the
        // stage's Style section (phase 7). Native 1920×1080.
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
        flavor: 'direct',
        scope: 'board',
        // Compact: live actions (Replay / Spotlight / Split) on the face, the
        // spotlight scene + hold-ms + split config behind the gear.
        // Its own dedicated source: the 3D hit overlay. The provider pushes every
        // contact to score.{N}.hit.*; the producer reveals this to show one and can
        // re-fire it with Replay (writes score.{N}.hit.replay_nonce). Native 1280×720.
        url: '/layout/hitvisualizer/hitvisualizer.html',
        width: 1280,
        height: 720,
        match: (url) => /hitvisualizer/i.test(url),
        // Also a container MEMBER: its stage's "Split feed" pushes the hit into
        // a shared container, so it is one of the few elements that can be both
        // a dedicated source and an occupant. `flavor` answers "does it own a
        // source"; this answers "can a container stand it up" (see
        // containers.js CONTAINER_MEMBERS).
        containerHostable: true,
    },
    {
        id: 'controller',
        name: 'Controller',
        // The optional gc-overlay controller-input display — macOS-only (it reads
        // controller state over AF_UNIX MemoryWatcher sockets; see the
        // controller-overlay skill). The layouts API omits controller/ off-Darwin,
        // so the Add picker never offers it there, and off-Darwin no controller
        // source exists to derive a rack row from.
        //
        // Direct element: the rack row shows/hides the OBS source like any other.
        // The heavy part — starting/stopping the gc-overlay SUBPROCESS and handing
        // out the per-side-follow (?team=1|2) and per-port (1-4) source URLs —
        // lives on its stage body (lifted out of Setup).
        //
        // Its layout is `?team=`-scoped for per-side follow: controller.html iframes
        // gc-overlay at score.{N}.player.{T}.port, so a left/right source tracks
        // whoever sits on that side even when Rio reassigns away/home. That is a
        // team variant, not console board scope, so no `scope` here.
        flavor: 'direct',
        url: '/layout/controller/controller.html',
        width: 512,
        height: 256,
        match: (url) => /\/layout\/controller\//i.test(url),
    },
];

/*
 * There is deliberately no `phase` on an element any more, and no PHASES list.
 *
 * Phase (Draft / Live / Post-game / Break) was PRSH inventing a show structure
 * and then asking the producer to keep a selector in sync with it. It decided
 * which rack section an element appeared in, which desk was reachable, and what
 * hid behind "Other phases" — four jobs the OBS scene list does better, because
 * the producer already built their scenes around the same structure and already
 * cuts between them. Elements are now listed wherever their SOURCE is
 * (./placements); if an element belongs in your break, put it in your break
 * scene.
 */

// ── Console contract resolvers ─────────────────────────────────────────────
// Quick-face row vocabulary (interpreted by the rail when it renders a card):
//   'subject'    — what the element is currently DRAWING, read from live state
//                  (../subject). A readout, never a control.
//   'visibility' — toggle the element's source (direct default)
//   'content'    — pick what feeds the shared container (uses el.feed)
//   'push'       — push the picked content to the container
//   'setting'    — one of the element's own live overlay settings (a band
//                  switch, the scorecard's score block)
//
// The direct default leads with the subject because a card carrying only a
// visibility switch is a worse copy of the rack row it was pinned from — the
// same control, minus the scene. An element with no live content of its own
// renders no subject row and degrades to the toggle alone; two rows is the
// budget, not the quota.
const QUICK_FACE_DEFAULTS = {
    direct: { rows: ['subject', 'visibility'] },
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

// Fed elements whose content is CHOSEN rather than pushed wholesale — picking
// is what feeds the container, so their Push slot has nothing to push until a
// pick has happened. Single-sourced here because two modules key off it: the
// rail's FEED_OPTION_HOOKS (which picker to render) and the source strip's
// push slot (whether Push can do anything yet). elements.test.js pins them
// against each other.
export const PICKABLE_FEEDS = ['stats', 'postgamecallout'];

export const isPickableFeed = (el) => PICKABLE_FEEDS.includes(el?.feed);

/*
 * A shared container's stable id, from the URL of the source rendering it.
 *
 * Containers are producer-built definitions (settings.production.container_defs)
 * rendered by ONE generic shell, so the id is what `?container=` names. The
 * filename stem is the fallback, which is what keeps a browser source still
 * pointing at a pre-2.0 named shell ('/layout/shared/stats-feed.html' →
 * 'stats-feed') rowing and feeding exactly as it did. The overlay side derives
 * it the same way, in fed-container.js — the two must agree, or a producer's
 * Push writes a key the source isn't reading.
 */
export function containerId(url) {
    const q = (url || '').split('?')[1];
    if (q) {
        const named = new URLSearchParams(q).get('container');
        if (named) return named;
    }
    return (url || '').replace(/^.*\/([^/]+)\.html?(?:\?.*)?$/, '$1');
}

// Key of the element's stage panel (stage/<key>); defaults to the element id.
export const stageBodyFor = (el) => el.stageBody ?? el.id;
