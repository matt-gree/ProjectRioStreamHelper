/*
 * Production page — the dev-curated set of ELEMENTS (no authoring UI yet).
 *
 * Vocabulary (production-console-contract skill):
 *   - Element        : a pre-designed thing the producer puts on the broadcast,
 *                      listed on the Production page under the OBS scene its
 *                      source lives in.
 *   - Direct element : owns a DEDICATED source; fire = show/hide it.
 *   - Fed element    : has no source of its own AT ALL — the Stat Card and the
 *                      fed Stats bar are container members and nothing else, so
 *                      a container is the only place their content can go. An
 *                      element on no roster has nowhere to be pushed, which is a
 *                      real state every surface reports rather than defaulting
 *                      around. A `feed` kind additionally names a content picker
 *                      ('stats' = which roster character), and the pick is
 *                      written to `production.feed.container.{id}`.
 *
 * FLAVOR IS THE FLOOR, AND THE PLACEMENT IS THE ANSWER. Being fed is a property
 * of WHERE a source is, not of what an element is: a member sitting on a
 * container's roster rows under that container and pushes into it, and the same
 * element's own dedicated source rows on its own and just shows and hides. Both
 * are real at once — that is what `containerHostable` has always meant for the
 * hit visualizer, and what the two post-game callouts now mean too. So `flavor`
 * answers only "does it own a source of its own"; ./placements decides which
 * kind of row you are looking at, and every surface branches on the placement
 * (see placementFlavor there). An element that is `fed` has one possible answer,
 * which is why the floor still earns a name.
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
        /*
         * The ?size= variants, so the console can OFFER them.
         *
         * Online the rack derives its rows from real OBS sources and reads the
         * size off each URL, so the sizes only ever "existed" once a source did
         * — which left the catalog tier (OBS closed) able to hand over the Large
         * board and nothing else. Declaring them here is what lets the catalog
         * list one row per size, exactly as the layouts API does for the Add
         * picker, and lets Copy URL and the preview quote the right canvas.
         *
         * Dimensions must match `SIZE_DIMS` in scoreboard-mount.js and
         * `CONTRACTS` in server/theme_contracts.py — pinned by
         * tests/unit/test_size_dims_parity.py, which reads this array.
         *
         * `default: true` marks the size a URL with NO ?size= resolves to — the
         * mount's fallback, and therefore the element's own `url`/`width`/
         * `height` above. It gets the BARE row (no variant tag), which is what
         * keeps `scoreboard:1` naming a real thing: a source carrying no ?size=
         * rows as `scoreboard:1` online, so the catalog has to spell the same
         * instance the same way, or a pin made in one state opens nothing in the
         * other.
         */
        sizes: [
            { value: 's', label: 'Small',  width: 388, height: 156 },
            { value: 'm', label: 'Medium', width: 600, height: 200 },
            { value: 'l', label: 'Large',  width: 800, height: 460, default: true },
        ],
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
        // roster character's stats to show. The pick is written to the feed key
        // of the container whose ROSTER names this element
        // (production.feed.container.<id> = { element: 'stats', … }); the
        // container overlay renders it. There is no default container — an
        // element no roster claims has nowhere to be pushed, which every surface
        // reports rather than falling back to one nobody chose.
        feed: 'stats',
        // `url` is the pre-2.0 named shell, kept as the canonical source so a
        // browser source still pointing at it keeps rowing and feeding.
        url: '/layout/shared/stats-feed.html',
        width: 325,
        height: 120,
        // ANCHORED TO THE LAYOUT. The old fallback was a bare /stats/i, which
        // answers to any URL with "stats" anywhere in it — including the shipped
        // `container.html?container=roster-stats-2`, i.e. a CONTAINER claiming to
        // be one of its own occupants. Harmless only because ./placements matches
        // direct elements alone; a matcher that can be wrong is a matcher that
        // will be.
        match: (url) => /\/layout\/shared\/stats-feed/i.test(url),
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
        // be at least this tall to hold it — the seeded "Roster + Stats" pair is
        // 452x240, which is where the height comes from.
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
        // — a container RESTING on a roster and flashing a stat card over it IS
        // the combined Roster + Stats element, which is why that element no
        // longer exists: it was one mount hard-coding one rule, and the parts
        // compose into the same thing plus every arrangement it couldn't reach.
        //
        // No `scope: 'board'`: its settings are global (overlays.roster.*, which
        // is what roster.html reads), and its two sources differ by ?team=, which
        // the instance grammar reads off the URL as a variant. Same shape as
        // Controller.
        flavor: 'direct',
        url: '/layout/scoreboard1/roster.html',
        width: 452,
        height: 140,
        // Anchored to the full path so a sibling in the same folder whose stem
        // merely STARTS with "roster" can't bind here.
        match: (url) => /\/layout\/scoreboard\d*\/roster\.html/i.test(url),
        containerHostable: true,
        containerScoped: true,
    },
    {
        id: 'commentary',
        name: 'Commentary',
        // Registry-bound caster desk.
        flavor: 'direct',
        // The whole desk is on the STAGE — per-caster on-air toggles, sub-field
        // switch and sub-plate toggle (there is no Commentary tab; it duplicated
        // the stage and was removed), and the casters' identity fields live on
        // Address Book. No quick face of its own: it takes the direct default
        // (subject + visibility), because six per-caster controls cannot fit the
        // rail's two-row cap.
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
        // plate appearance and ends holding on the spray chart. Reads
        // postgame.{N}.* plus the REST-only GET /postgame/abs walkthrough
        // payload. Native 1920×1080.
        //
        // DIRECT, AND ALSO A CONTAINER MEMBER — the same shape as the hit
        // visualizer. It was fed-only, on the reasoning that it shares the
        // Callout Stage with the Game Summary; but sharing is what a container
        // is FOR, not what an element is, and an element no roster claimed had
        // nowhere to go at all: its panel offered a Push into nothing. Its own
        // source is the ordinary case now, and a producer who wants the two
        // callouts mutually exclusive puts both on one container's roster,
        // which is the sentence that arrangement is supposed to mean.
        //
        // `feed` still names the content picker ('postgamecallout' = which side
        // + roster slot). The pick is the element's standing INTENT
        // (production.feed.last.postgamecallout) either way — on its own source
        // that intent IS what the overlay draws, and on a container it is what
        // Push sends. One pick, one answer, wherever it ends up.
        flavor: 'direct',
        feed: 'postgamecallout',
        url: '/layout/postgame/spotlight.html',
        width: 1920,
        height: 1080,
        // Anchored to the layout, not the word "callout": the old matcher also
        // answered to the shared callout-stage shell, which is a CONTAINER —
        // and a container that identified as one of its own occupants would row
        // twice and drive the wrong source.
        match: (url) => /\/layout\/postgame\/spotlight/i.test(url),
        containerHostable: true,
    },
    {
        id: 'postgamevs',
        name: 'Game Summary',
        // Post-game only: the full-screen player-vs-player end-of-game callout —
        // both captains with team logos, the match context (tournament · round ·
        // series) top-center, and the side totals (runs / hits / homeruns /
        // stars won / strikeouts pitched) unfolding from the center line. Reads
        // postgame.{N}.player.{T}.totals (Phase 6 capture). 1920×1080.
        //
        // Direct + container member, for the same reasons as the Character
        // Spotlight above. Nothing to pick — a summary is the whole game — so
        // its content is the board's capture and `?scoreboard=` is all that
        // scopes it.
        flavor: 'direct',
        feed: 'postgamevs',
        url: '/layout/postgame/summary.html',
        width: 1920,
        height: 1080,
        match: (url) => /\/layout\/postgame\/summary/i.test(url),
        containerHostable: true,
    },
    {
        id: 'lowerthird',
        name: 'Lower Third',
        // A re-themable SVG band
        // of FIVE independently toggleable slots (lowerthird.slots.1..5), each
        // one content type: logo · match · scorebox · merch · clock · message ·
        // bracket. Direct element (own dedicated source); the five slots are
        // authored on its STAGE panel as five always-open columns in the order
        // they render on air — each a type picker + on/off over that slot's
        // content editor. Slot widths/looks
        // belong to the design package. Native 1920×320 — the band's own box,
        // not the stream canvas: vertical placement is a scene decision, and
        // the mount bottom-anchors a full-canvas theme inside it.
        flavor: 'direct',
        url: '/layout/lowerthird/lowerthird.html',
        width: 1920,
        height: 320,
        match: (url) => /lowerthird/i.test(url),
    },
    {
        id: 'schedule',
        name: 'Upcoming Schedule',
        // The producer's running order (schedule.queue, ids into match.{M})
        // rendered by the schedule overlay. THE ORDER IS NOT AUTHORED HERE:
        // membership and position live on the Match desk, where the fixtures
        // are, so a ticker's settings can't hold a second copy of tonight's
        // running order free to disagree with the stack. This element's stage
        // keeps what is genuinely its own — the overlay's heading, and each
        // match's display time (per-match, so it follows a reorder).
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
        // design package (/design/{pkg}/matchup.svg). Native 1920×480 — the
        // band's own box, not the stream canvas: vertical placement is a scene
        // decision, and the mount bottom-anchors a full-canvas theme inside it.
        flavor: 'direct',
        url: '/layout/matchup/matchup.html',
        width: 1920,
        height: 480,
        match: (url) => /\/layout\/matchup\//i.test(url) || /matchup\.html/i.test(url),
    },
    {
        id: 'bracket',
        name: 'Bracket',
        // The tournament bracket, rendered from the app-wide bracket.* structure.
        // winners_only.html / losers_only.html are thin redirects into index.html
        // with a flag, so all three are the same element wearing different
        // filters. WHICH start.gg phase is drawn is chosen on this element's own
        // stage (../bracket's shared useBracketDesk) and on the lower third's
        // bracket slot — there is no Bracket desk; it was a third copy of a
        // picker both consumers already carried.
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
        // sits over the whole broadcast. Bands, per-field visibility and the
        // message copy are all overlays.eventheader.* and render on its stage
        // panel, grouped by the band each one changes. Native 1920×1080.
        //
        // NO `scope: 'board'`, deliberately, even though the mount reads
        // `?scoreboard=` for its Round field. This is full-canvas chrome: there
        // is one of it per broadcast, and declaring the scope would also make
        // every band setting per-board (ElementStyleSettings keys off it), so a
        // producer would be styling the same two strips twice. The board only
        // decides which fixture Round comes from, and the documented default —
        // no param means board 1 — is the right answer for a single canvas.
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
        // Its own dedicated source: the 3D hit overlay. The provider pushes every
        // contact to score.{N}.hit.*; the producer reveals this to show one and can
        // re-fire it with Replay (writes score.{N}.hit.replay_nonce). Native 1280×720.
        url: '/layout/hitvisualizer/hitvisualizer.html',
        width: 1280,
        height: 720,
        match: (url) => /hitvisualizer/i.test(url),
        // Also a container MEMBER, so it is one of the elements that is both a
        // dedicated source and an occupant — two rows, and the Push lives on the
        // slot row's source strip. (Its stage used to carry a bespoke "Split
        // feed" button, which is exactly what the strip exists to end.) `flavor`
        // answers "does it own a source"; this answers "can a container stand it
        // up" (see containers.js CONTAINER_MEMBERS).
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

/*
 * The `sizes` entry a variant tag names ('zs' → the Small row), or null.
 *
 * Takes the tag rather than the raw value because that is what a placement
 * carries — read off a source's URL when one exists, written by the catalog
 * tier when one doesn't. Callers wanting dimensions should use
 * `placementDims` (./bindings) rather than reaching in here.
 */
export function sizeOptionFor(element, variant) {
    if (!element?.sizes || !variant) return null;
    for (const part of String(variant).split('.')) {
        if (!part.startsWith('z')) continue;
        const value = part.slice(1);
        const hit = element.sizes.find(s => s.value === value);
        if (hit) return hit;
    }
    return null;
}
