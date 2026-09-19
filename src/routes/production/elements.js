/*
 * Production page — the dev-curated set of ELEMENTS (no authoring UI yet).
 *
 * Vocabulary (production-console-contract skill):
 *   - Element        : a pre-designed thing the producer puts on the broadcast,
 *                      listed on the Production page under the OBS scene its
 *                      source lives in.
 *   - Direct element : owns a DEDICATED source; fire = show/hide it.
 *   - Fed element    : has no source of its own AT ALL, so a container is the
 *                      only place its content can go. An element on no roster
 *                      then has nowhere to be pushed, which is a real state
 *                      every surface reports rather than defaulting around. A
 *                      `feed` kind additionally names a content picker
 *                      ('postgamecallout' = which player's spotlight), and the
 *                      pick is written to `production.feed.container.{id}`.
 *                      THE REGISTRY HAS NONE TODAY — the Stat Card was the last
 *                      one and now owns a ?team= source like the Roster — and
 *                      the floor stays anyway, because being fed is a property
 *                      of the PLACEMENT (see below): every member's slot row is
 *                      fed whatever its element's flavor says.
 *
 * FLAVOR IS THE FLOOR, AND THE PLACEMENT IS THE ANSWER. Being fed is a property
 * of WHERE a source is, not of what an element is: a member sitting on a
 * container's roster rows under that container and pushes into it, and the same
 * element's own dedicated source rows on its own and just shows and hides. Both
 * are real at once, for every element that owns a source — which is now all of
 * them, since being hostable is read off the mount registry
 * (`container-members.js`) rather than declared by a flag here. So `flavor`
 * answers only "does it own a source of its own"; ./sources/placements decides which
 * kind of row you are looking at, and every surface branches on the placement
 * (see placementFlavor there). An element that is `fed` has one possible answer,
 * which is why the floor still earns a name.
 *
 * Binding is by URL: each element matches the streamer's OBS browser source(s)
 * whose URL is its PRSH layout, so there's no manual wiring in the common case.
 * Rows are derived SOURCE → ROW, per scene (./sources/placements) — matching is not
 * scoped to the program scene, and nothing searches from an element to a source.
 *
 * Console contract (production-console-contract skill) — the registry also
 * carries each element's console declaration:
 *   - `quickFace` : the rail card's rows (≤ 2), or explicit null (= not
 *                   pinnable). OMITTED on most elements — the default derives
 *                   from flavor via quickFaceFor(): direct → subject (the
 *                   eye is the card header's); fed → content pick + push.
 *   - `quickSettings`: the element's own settings (keys of
 *                   LAYOUT_SETTINGS[settingsType]) that its `setting` row
 *                   carries — the LOOK a producer changes to match the moment
 *                   (the scoreboard's box score between innings), never a
 *                   set-once preference. Required exactly when the face has a
 *                   `setting` row. Switches pack into one chip strip, so
 *                   several of them still spend one row.
 *   - `stageBody` : key of the element's stage panel under stage/ — defaults
 *                   to the element id via stageBodyFor(); declare only to
 *                   deviate.
 *   - `scope`     : 'board' when the SOURCE carries ?scoreboard=N, so two of
 *                   them in one scene are two instances. Omitted = global.
 *   - `settingsType`: the `overlays.{type}.*` namespace the element's MOUNT
 *                   reads, when it isn't the element id. Declare only to
 *                   deviate — `settingsTypeOf()` defaults it to the id.
 *                   Matchup History is the one that deviates: the console calls
 *                   it `matchuphistory` and matchup-mount.js reads
 *                   `overlays.matchup.*`, so a stage panel keyed on the id
 *                   would write every setting where nothing reads it. Pinned to
 *                   the layout file's own name by elements.test.js.
 *   - `perSide`   : the element has one source PER SIDE (?team=1|2). Online
 *                   the side is read off a source that already exists, so this
 *                   is only consulted by the catalog tier — which otherwise
 *                   offers a single row that resolves to side 1 and no way to
 *                   reach side 2 with OBS closed. Mirrors `_TEAM_VARIANTS` in
 *                   server/api/v1/layouts.py (the Add picker's half of the
 *                   same fact); pinned by tests/unit/test_per_side_parity.py.
 *   - `hidden`    : NOT OFFERED, still understood. The console stops proposing
 *                   the element — no catalog row with OBS closed, and the
 *                   server drops its layout group from the Add picker — but a
 *                   source already pointing at it still derives a row, still
 *                   resolves its stage panel and still reads its settings. An
 *                   entry deleted instead would file a producer's live source
 *                   as a generic layout and cost it all three. Shelving is
 *                   temporary by construction: remove the flag (and the
 *                   matching `_SHELVED_GROUPS` entry in
 *                   server/api/v1/layouts.py) to bring it back.
 *
 * Two board mechanisms, and conflating them is how multiplicity ends up feeling
 * bolted on:
 *
 *   URL-scoped  — the board is fixed by the source (`?scoreboard=N`). These get
 *                 `scope: 'board'` and per-board settings, and two of them in
 *                 one scene are two instances (./sources/instances). A source's board
 *                 is re-pointed from its panel's Board row (stage/boardswitch),
 *                 which rewrites the param on the OBS source in place.
 *   `boardParam` — the layout READS `?scoreboard=` but its settings are global,
 *                 so it takes no `scope`: the per-side elements (Stat Bar/Card,
 *                 Roster, Player Name, Team Logo, Controller), the post-game
 *                 callouts, the Event Header and the Results Ticker. `readsBoard`
 *                 is the one question "does this source name a board", asked by
 *                 the Add picker's board step and the stage's Board row.
 *   `showWide`   — a board reader that is still chrome for the whole show
 *                 (the Event Header): the Add picker files it on the Show-wide
 *                 shelf rather than under a board's tab. Picker-only.
 *   `rotatingOnly` — draws a board's rotation pool, so the Add picker lists
 *                 it only under a board that is rotating one. Picker-only.
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
            { value: 'l', label: 'Large',  width: 800, height: 460, default: true },
        ],
        match: (url) => /\/layout\/scoreboard\d*\/scoreboard/i.test(url) || /scoreboard\.html/i.test(url),
        /*
         * What the game is doing, then the parts of the card that follow it —
         * the box score up between innings, stats up for an at-bat, the live
         * cluster down once it's over. No source toggle: the scoreboard sits
         * resident on air (the Event Header's argument), and the chip in the
         * card header already says whether it is.
         *
         * One list for both sizes, filtered per source by `sizes`
         * (settingReachesSize), so a Small card offers Inning · Live · Mode and
         * a Large card Live · Stats · Rosters · Box. Team Logos is left out on
         * purpose: it is a set-once look, not a moment.
         */
        quickFace: { rows: ['subject', 'setting'] },
        quickSettings: ['showInning', 'showLive', 'showStats', 'showRoster', 'showBox', 'showGameMode'],
    },
    {
        id: 'scorecard',
        // "Vertical" is load-bearing in a picker that also lists the Scoreboard:
        // the two names differ by two letters otherwise, and the whole point of
        // this element is the axis. Every comment in the codebase already calls
        // it this, and so does the layout catalog — the registry was the one
        // place saying "Scorecard", so the rack row and the Add picker row a
        // producer clicked to create it disagreed.
        name: 'Vertical Scorecard',
        // The vertical scorecard — a stack of independently toggleable bands
        // (header, phase, game mode, score block, rosters, bases, at-bat, box
        // score, stadium) that the producer flips live; the mount animates each
        // group in/out. Config is per board (overlays.scorecard.{N}.*), so two
        // scorecard sources can be driven independently. Native 496×766 — the
        // size of the CARD, not the stream frame: where the column sits is a
        // scene decision made once in OBS, and a full-canvas source made the
        // producer make it inside a box whose other three quarters were empty.
        // 766 is the tallest the stack gets; the card top-anchors, so the
        // slack below it as bands come and go is transparent.
        flavor: 'direct',
        scope: 'board',
        url: '/layout/scorecard/scorecard.html',
        width: 496,
        height: 766,
        // Deliberately narrow so 'scorecard' is not swallowed by the Scoreboard
        // matcher (which also answers to a bare *.html stem).
        match: (url) => /scorecard\/scorecard/i.test(url) || /scorecard\.html/i.test(url),
        // What the game is doing, and which score block is showing — the pair a
        // producer reaches for mid-game. On/off is the card header's eye;
        // everything else is stage work.
        quickFace: { rows: ['subject', 'setting'] },
        quickSettings: ['mainMode'],
    },
    {
        id: 'statsbar',
        boardParam: true,
        // NAMED BY SHAPE, because the shape is the difference. This and the
        // Stat Card are the same data — whoever this side has on the field —
        // so "Stats" and "Stat Card" left the producer nothing to tell them
        // apart by, and one name was a prefix of the other. The art really is
        // a wide bar (452x118) and a 2x2 card (380x240). The id stays `stats`:
        // it is a settings namespace and a URL, and renaming those is a
        // migration for no gain.
        name: 'Stat Bar',
        /*
         * The per-side stat card, as its own source (?scoreboard=N&team=T):
         * whoever this side has on the field right now — the batter when it is
         * batting, the pitcher when it is not. The wide `statsbar.svg` from
         * the active design package; `overlays.statsbar.*` is its namespace.
         *
         * THIS ID USED TO NAME SOMETHING ELSE. It was a fed 325x120 DOM bar
         * hosted by a seeded "Stats Bar" container, with a content picker for
         * choosing a roster character by hand — while
         * /layout/scoreboard1/statsbar.html, the overlay a producer actually puts
         * on a stream, matched no element at all and rowed generically. So the
         * console's Stats was the one a broadcast doesn't use and the real one
         * had no panel, no preview and (with OBS closed) no row. The fed bar is
         * DELETED — mount and shell both — rather than shelved: shelving means
         * "not offered, still works", and its member entry was already gone
         * from container-members.js, so no surface could stand it up. What
         * survives of "a card inside a container" is `statscard`, which is the
         * same data in the themed 2x2 art and was always the better half of the
         * pair.
         *
         * No `scope: 'board'` — settings are global (`overlays.statsbar.*`) and
         * its two sources differ by ?team=, which the instance grammar reads
         * off the URL as a variant. Same shape as the Roster, Player Name and
         * Team Logo.
         */
        flavor: 'direct',
        url: '/layout/scoreboard1/statsbar.html',
        width: 452,
        height: 118,
        // Anchored to the full path, like the roster's. The pre-2.0 matcher here
        // was a bare /stats/i, which answers to any URL with "stats" in it —
        // including `container.html?container=roster-stats-2`, i.e. a CONTAINER
        // claiming to be one of its own occupants.
        match: (url) => /\/layout\/scoreboard\d*\/statsbar\.html/i.test(url),
        perSide: true,
        /*
         * Who it is drawing, then its bottom line — the live game line, a
         * caption of your own, or off so the bar shrinks. Shown or not (it
         * comes and goes with the at-bat) is the card header's eye. The caption's TEXT is stage work; the card only picks the
         * mode. Settings are one namespace for both sides, so this card sets
         * the pair — which is what a pair framing a scoreboard wants.
         */
        quickFace: { rows: ['subject', 'setting'] },
        quickSettings: ['subLine'],
    },
    {
        id: 'statscard',
        boardParam: true,
        name: 'Stat Card',
        /*
         * The same stat line as the Stat Bar, wearing the design package's
         * `statscard` element — the compact 2x2 card, 380x240, with the header
         * band the wide bar has no room for.
         *
         * A TOP-LEVEL ELEMENT WITH ITS OWN SOURCE, and a container member too —
         * the Roster's shape exactly. It was a member and NOTHING else, which
         * made the 2x2 art reachable only through a container: a producer who
         * wanted the card alone in a corner of the scene had to build a
         * container to hold one thing, and the card had no whitelist of its own
         * (its `<meta>` is where per-element style overrides are read back
         * from), so the one element with two caption bands was the one element
         * whose style could not be pinned. Both paths run stats-card-mount with
         * the same settingsType and svgElement, so it is one element configured
         * once wherever the producer puts it.
         *
         * 380x240 rather than the original 380x220 since the card grew its two
         * optional caption bands (a header naming the stat set, a footer carrying
         * the live game line): both open is 236 units of card. A container has to
         * be at least this tall to hold it — the seeded "Roster + Stats" pair is
         * 452x240, which is where the height comes from.
         *
         * No `scope: 'board'` — settings are global (`overlays.statscard.*`) and
         * its two sources differ by ?team=, which the instance grammar reads off
         * the URL as a variant. Same shape as the Stat Bar, Roster, Player Name
         * and Team Logo.
         *
         * No `feed` kind, and that is not an omission: a `feed` names a CONTENT
         * PICKER, and this card resolves the side's current batter or pitcher
         * itself (RioData.getStatsLine, the same resolution the automation
         * engine's `statscard` resolver mirrors). There is nothing to choose —
         * the only question is whose side, which its own source answers with
         * ?team= and a container answers with its scope.
         */
        flavor: 'direct',
        url: '/layout/scoreboard1/statscard.html',
        width: 380,
        height: 240,
        // Anchored to the full path, like the bar's and the roster's — a bare
        // /statscard/i would also answer to `container.html?container=statscard`,
        // i.e. a CONTAINER claiming to be one of its own occupants.
        match: (url) => /\/layout\/scoreboard\d*\/statscard\.html/i.test(url),
        // One source per side (?team=1|2) — see `perSide` in the header note.
        perSide: true,
        // The Stat Bar's card, for the same reason. The Top Line is a caption
        // set once per event, so it stays on the stage.
        quickFace: { rows: ['subject', 'setting'] },
        quickSettings: ['subLine'],
        // On a container's roster its frame of reference is the CONTAINER's, not
        // its own URL's: a manual Push takes scoreboard AND team from the
        // definition, the same pair the automation engine feeds it. Gated on the
        // row being a member's slot (see subject.jsx), so its own ?team= source
        // still draws the side that source names.
        containerScoped: true,
    },
    {
        id: 'roster',
        boardParam: true,
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
        // One source per side (?team=1|2) — see `perSide` in the header note.
        perSide: true,
        // Anchored to the full path so a sibling in the same folder whose stem
        // merely STARTS with "roster" can't bind here.
        match: (url) => /\/layout\/scoreboard\d*\/roster\.html/i.test(url),
        containerScoped: true,
    },
    {
        id: 'playername',
        boardParam: true,
        name: 'Player Name',
        // One side's name (?scoreboard=N&team=T) as its own source, with the
        // Address Book prefix beside it — for placing a name somewhere the
        // scoreboard isn't. Alignment and prefix position are its own settings
        // (overlays.playername.*), authored in the stage's Style section.
        //
        // No `scope: 'board'`, and its two sources differ by ?team=, which the
        // instance grammar reads off the URL as a variant. Same shape as the
        // Roster and the Controller.
        flavor: 'direct',
        url: '/layout/scoreboard1/playername.html',
        // 800x200, DELIBERATELY THE TOP OF THE RANGE rather than the middle.
        // Scaling a browser source DOWN in OBS is lossless — the page is
        // rendered at this resolution and the compositor shrinks it — while
        // dragging one UP stretches a finished texture and softens it. So the
        // starting size is as large as a name is ever plausibly shown, and a
        // producer who wants a smaller one drags the corner in the direction
        // that costs nothing.
        //
        // Free here in a way it would not be everywhere: this is 160k pixels
        // against 40k, on an element with no artwork to re-raster.
        //
        // And it is ONLY headroom. The type size is the `nameSize` setting
        // (lib/playername-mount.js), so this box says nothing about how big the
        // name is drawn — it is how much room the name has to run in, and a
        // ceiling that clamps a size too large to fit. That is what it should
        // have been all along: while the height set the type size, this number
        // was a covert instruction to draw a 110px name.
        //
        // THE COST, stated: this is also the member box and the picker's fit
        // test (one element, one size, three readers — containers.test.jsx), so
        // a Player Name no longer fits a container narrower than 800 or shorter
        // than 200 — the shipped 452x240 side pair among them. No shipped
        // roster carries one, so nothing breaks on boot; what is lost is the
        // option of adding one there.
        width: 800,
        height: 200,
        perSide: true,
        // Anchored to the full path, like the roster's — a sibling in the same
        // folder whose stem merely starts with "playername" must not bind here.
        match: (url) => /\/layout\/scoreboard\d*\/playername\.html/i.test(url),
        containerScoped: true,
    },
    {
        id: 'teamlogo',
        boardParam: true,
        name: 'Team Logo',
        // One side's MSB team banner (?scoreboard=N&team=T), from the user's own
        // asset pack. No settings of its own — the logo is the whole element —
        // which is why LAYOUT_SETTINGS.teamlogo is an empty list rather than
        // absent: the namespace exists, it just has nothing in it yet.
        flavor: 'direct',
        url: '/layout/scoreboard1/teamlogo.html',
        width: 360,
        height: 360,
        perSide: true,
        match: (url) => /\/layout\/scoreboard\d*\/teamlogo\.html/i.test(url),
        containerScoped: true,
    },
    {
        id: 'commentary',
        name: 'Commentary',
        // Registry-bound caster desk.
        flavor: 'direct',
        // The whole desk is on the STAGE — four fixed seats, each an on-air
        // switch, a person and a sub-plate picker whose "No sub-plate" turns it
        // off (there is no Commentary tab; it duplicated the stage and was
        // removed), and the casters' identity fields live on Address Book. No
        // quick face of its own: it takes the direct default (subject +
        // visibility), because four seats of controls cannot fit the rail's
        // two-row cap.
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
        // One chip per seated caster, show/hide on the strip — someone steps
        // away, someone joins. The chips name the casters, so a subject line
        // above them would say the same names twice.
        quickFace: { rows: ['strip'] },
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
        boardParam: true,
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
    },
    {
        id: 'postgamevs',
        boardParam: true,
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
        // Anchored to the layout, like the roster's and the callouts'. The
        // bare word answered to `container.html?container=lowerthird-box`,
        // i.e. to a producer's CONTAINER — and the source→row lookup asks
        // the direct elements first (./sources/placements), so the container lost
        // its roster, its feed and its stage to an element whose panel then
        // drove a source that doesn't read `overlays.lowerthird.*`.
        match: (url) => /\/layout\/lowerthird\/lowerthird\.html/i.test(url),
        // One chip per filled segment, lit while it is in the band — the
        // ribbon's eye, on the rail: the merch in for the break, the clock up
        // before the start. No subject: "4 of 5 segments on" is what the lit
        // chips already say, and five chips need the card's width twice over.
        // Content and order stay stage work.
        quickFace: { rows: ['strip'] },
    },
    {
        id: 'schedule',
        name: 'Upcoming Schedule',
        // The producer's running order (schedule.queue, ids into match.{M})
        // rendered by the schedule overlay, through the active design
        // package's schedule.svg. THE ORDER IS NOT AUTHORED HERE: membership
        // and position live on the Match desk, where the fixtures are, so a
        // ticker's settings can't hold a second copy of tonight's running
        // order free to disagree with the stack. This element's stage keeps
        // what is genuinely its own — the overlay's heading, each match's
        // display time (per-match, so it follows a reorder), and the two
        // settings that decide which of the order this board draws (see
        // `scheduleRows` in lib/schedule-mount.js).
        flavor: 'direct',
        url: '/layout/schedule/schedule.html',
        width: 1920,
        height: 1080,
        // Deliberately narrow: bracket/player_schedule.html must NOT bind here.
        match: (url) => /\/layout\/schedule\//i.test(url),
        // What's queued, then whether played matches stay on the card — the
        // end-of-night recap flip.
        quickFace: { rows: ['subject', 'setting'] },
        quickSettings: ['showDecided'],
    },
    {
        id: 'matchuphistory',
        name: 'Matchup History',
        // matchup-mount.js reads `overlays.matchup.*` (SETTINGS_TYPE), not the
        // console's id for it.
        settingsType: 'matchup',
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
        // What's on air, then the match and Fetch on one line — a new set's
        // head-to-head is one press from the rail.
        quickFace: { rows: ['subject', 'action'] },
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
        //
        // SHELVED (2026-08-22) while the bracket work is parked — see `hidden`
        // below and `_SHELVED_GROUPS` in server/api/v1/layouts.py, which drops
        // the same group from the Add picker. The two have to agree: the server
        // decides what OBS can be given, this decides what the console offers.
        flavor: 'direct',
        hidden: true,
        url: '/layout/bracket/index.html',
        width: 1920,
        height: 1080,
        match: (url) => /\/layout\/bracket\/(index|winners_only|losers_only)/i.test(url),
    },
    {
        id: 'ticker',
        boardParam: true,
        // Draws its board's rotation POOL and nothing else, so the Add picker
        // offers it only under a board that is actually rotating one.
        rotatingOnly: true,
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
        boardParam: true,
        // Reads a board for ONE field (Round) and is otherwise chrome for the
        // whole broadcast, so the Add picker shelves it Show-wide and adds it
        // with no board named (board 1 by the documented default). The stage's
        // Board row still re-points it — `readsBoard` is unchanged.
        showWide: true,
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
        // (Inside a container that board is the container's scope instead; the
        // settings stay app-wide either way. See container-members.js.)
        flavor: 'direct',
        url: '/layout/eventheader/eventheader.html',
        width: 1920,
        height: 1080,
        // Anchored — see the Lower Third's note. A container named
        // "Eventheader" slugs to an id this word matched.
        match: (url) => /\/layout\/eventheader\/eventheader\.html/i.test(url),
        // What the bands are carrying, then the two band switches (one chip
        // strip) — the header is resident, so which band is up is the live
        // decision. The source itself is the card header's eye.
        quickFace: { rows: ['subject', 'setting'] },
        quickSettings: ['showHeader', 'showFooter'],
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
        // Anchored — see the Lower Third's note. This one is the likeliest of
        // the three to bite: the hit visualizer is a container MEMBER, so a
        // producer naming the container after its occupant is the ordinary
        // case, not a corner one.
        match: (url) => /\/layout\/hitvisualizer\/hitvisualizer\.html/i.test(url),
        // The latest hit, then Replay (and Spotlight, once it is set up) — a
        // big swing replayed on demand, without opening the panel.
        quickFace: { rows: ['subject', 'action'] },
        // Also a container MEMBER, so it is one of the elements that is both a
        // dedicated source and an occupant — two rows, and the Push lives on the
        // slot row's source strip. (Its stage used to carry a bespoke "Split
        // feed" button, which is exactly what the strip exists to end.) `flavor`
        // answers "does it own a source"; this answers "can a container stand it
        // up" (see containers.js CONTAINER_MEMBERS).
    },
    {
        id: 'controller',
        boardParam: true,
        name: 'Controller',
        // The optional gc-overlay controller-input display. Offered on every
        // platform: gc-overlay 1.1.0 carries two peer Dolphin transports, so the
        // old off-Darwin catalog omission is gone (see the controller-overlay
        // skill). What decides whether it works is whether gc-overlay is
        // installed, which the element reports as its "no reader" blank.
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
        height: 180,
        perSide: true,
        match: (url) => /\/layout\/controller\//i.test(url),
        // Container-scoped for the same reason the roster is: it has no content
        // of its own, it draws whoever the container's scope has on that side.
        // So it is added to a roster rather than moved onto one, and a mirrored
        // pair can carry it on both.
        containerScoped: true,
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
 * (./sources/placements); if an element belongs in your break, put it in your break
 * scene.
 */

// ── Console contract resolvers ─────────────────────────────────────────────
// Quick-face row vocabulary (interpreted by the rail when it renders a card):
//   'subject'    — what the element is currently DRAWING, read from live state
//                  (../subject). A readout, never a control.
//   'content'    — pick what feeds the shared container (uses el.feed)
//   'push'       — push the picked content to the container
//   'setting'    — the element's own live overlay settings, named by its
//                  `quickSettings` (a band switch, the scorecard's score block)
//   'strip'      — show/hide chips over the element's own CONTENT, which is
//                  state rather than settings (lower-third segments, caster
//                  seats); a component in quickface.jsx's ELEMENT_QUICK_FACES
//   'action'     — the element's own one-shot verbs (Replay, Fetch), also an
//                  ELEMENT_QUICK_FACES component
//
// There is no visibility ROW: showing and hiding the source is the card
// header's eye, the rack row's own control (../rail). As a labelled switch row
// it made every card a worse copy of the rack row it was pinned from and cost
// the row the card was pinned for. An element with no live content renders no
// subject, so its card is the header alone; two rows is the budget, not the
// quota.
const QUICK_FACE_DEFAULTS = {
    direct: { rows: ['subject'] },
    fed: { rows: ['content', 'push'] },
};

// The element's effective quick face: explicit null = not pinnable (an
// intentional, visible state — the pin affordance doesn't render); an omitted
// quickFace takes the flavor default.
export function quickFaceFor(el) {
    if (el.quickFace === null) return null;
    return el.quickFace ?? QUICK_FACE_DEFAULTS[el.flavor] ?? null;
}

// Whether this element's source names a board (`?scoreboard=N`, absent = 1).
export const readsBoard = (el) => el?.scope === 'board' || el?.boardParam === true;

export const isPinnable = (el) => quickFaceFor(el) !== null;

// Fed elements whose content is CHOSEN rather than pushed wholesale — picking
// is what feeds the container, so their Push slot has nothing to push until a
// pick has happened. Single-sourced here because two modules key off it: the
// rail's FEED_OPTION_HOOKS (which picker to render) and the source strip's
// push slot (whether Push can do anything yet). elements.test.js pins them
// against each other.
export const PICKABLE_FEEDS = ['postgamecallout'];

export const isPickableFeed = (el) => PICKABLE_FEEDS.includes(el?.feed);

/*
 * A shared container's stable id, from the URL of the source rendering it.
 *
 * Containers are producer-built definitions (settings.production.container_defs)
 * rendered by ONE generic shell, so the id is what `?container=` names, and a
 * URL that names none is not a container (null). The overlay side reads the
 * same param, in container.html — the two must agree, or a producer's Push
 * writes a key the source isn't reading.
 */
export function containerId(url) {
    const q = (url || '').split('?')[1];
    return (q && new URLSearchParams(q).get('container')) || null;
}

// Key of the element's stage panel (stage/<key>); defaults to the element id.
export const stageBodyFor = (el) => el.stageBody ?? el.id;

/*
 * The `overlays.{type}.*` namespace an element's mount reads.
 *
 * Defaults to the id, which is right for every element but Matchup History —
 * and that one exception is why the console must never key settings off the id
 * directly. A write to `overlays.matchuphistory.accentColor` is not wrong in
 * any way a test or a console can see: the key stores, the socket broadcasts,
 * the panel reads its own value back. It simply never reaches an overlay.
 */
export const settingsTypeOf = (el) => el?.settingsType ?? el?.id;

/*
 * The `sizes` entry a variant tag names ('zs' → the Small row), or null.
 *
 * Takes the tag rather than the raw value because that is what a placement
 * carries — read off a source's URL when one exists, written by the catalog
 * tier when one doesn't. Callers wanting dimensions should use
 * `placementDims` (./board/bindings) rather than reaching in here.
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
