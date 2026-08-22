/*
 * container-members.js — WHAT a container can stand up, in one table.
 *
 * Every element a container can host: its native pixel size, the sample occupant
 * that lets a container preview itself with no game running, and how to mount
 * it. `fed-container.js` owns the WIRING around this (feed key, definition
 * fetch, OverlayBase init); `container-layers.js` owns the layer MECHANICS. This
 * file is the data between them.
 *
 * IT IMPORTS NOTHING, ON PURPOSE. Every mount is reached through a dynamic
 * `import()` inside the entry, so this module can be imported anywhere —
 * including a jsdom unit test and the console's own test suite, neither of which
 * can survive three.js and GSAP arriving at module scope. That is the whole
 * reason the table moved out of `fed-container.js`: the console's list of what
 * can occupy a container and this list are the same fact in two runtimes, and
 * until now they were pinned by REGEX-PARSING this table out of that file's
 * source text, which broke on a reformat and could never check a mount.
 *
 * The laziness is not only a testing trick — a container whose roster is a
 * roster and a stat card no longer downloads a GL renderer to find that out.
 *
 * ENTRY CONTRACT — see container-layers.js for the mechanics that read it:
 *
 *   size      [w, h] native pixel size. A member smaller than its container
 *             centers inside it and is NEVER scaled. Omit for a member that has
 *             no native size of its own and fills whatever it is given.
 *   sample    { file, content } — the captured game to preview against, plus the
 *             content fields that stand this member up inside a container.
 *   mount     (box, ctx, sel) => { update, dispose, replay? }, possibly async.
 *             `box` is the sized, centered element to render into.
 *   payload   (sel) => second argument to `mount.update`. Defaults to `sel`.
 *   identity  (sel) => layer key, when one member needs more than one layer.
 *             Defaults to the member id.
 *   watch     (key) => bool. State keys this member needs that the container
 *             shell does not already listen to (`fed-container.js` covers the
 *             feed key, `score.N.*`, `postgame.N.*` and `tournamentInfo.*`).
 *             Without it a member reading anything else — a queue, a fixture —
 *             renders once and then goes deaf inside a container while its own
 *             dedicated source updates fine.
 *
 * `OverlayBase` is a window global (overlay-base.js), not an import — the entries
 * below read it at mount time, which is always inside a real overlay page.
 */

/*
 * Load one mount module.
 *
 * The specifier is COMPUTED, not a literal, and marked `@vite-ignore`: these are
 * static files under `public/` that the browser fetches straight from
 * `/layout/lib/…`, and a bundler asked to resolve them at build time refuses
 * outright ("Cannot import non-asset file … which is inside /public"). Keeping
 * the path out of static analysis is what lets this module be imported by the
 * console's tests and still be a plain script to OBS.
 */
const load = (mod) => import(/* @vite-ignore */ `/layout/lib/${mod}.js`);

/*
 * The host to hand a mount, inside the box the layer centered for it.
 *
 * EVERY element mount styles its own host `position: fixed; inset: 0` — correct
 * when the mount owns the whole page, which is what it normally does. Inside a
 * container it pins the element to the VIEWPORT rather than to the centered box
 * it was given, so the member escapes its layer and lands in the corner. Setting
 * `position` INLINE here is what fixes it: the mounts declare theirs in a class
 * rule (`.sb-host`, `.st-host`, …) and an inline style outranks a class.
 *
 * The stat card carried this workaround alone, as a comment about itself. It was
 * never specific to the stat card — it is the cost of admission for any mount
 * written to be a page, which is all of them.
 */
const hostIn = (box) => {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute; inset:0;';
    box.appendChild(host);
    return host;
};

/*
 * The common member: a mount that takes the box, reads its own state, and has
 * the `update(state, settings)` signature every standalone layout's render call
 * uses. `container-layers` calls `update(state, payload)`, so settings are bound
 * here instead — the same wrapper the stat card has always needed.
 *
 * These mounts also expose `setShown`/`setActive` for the OBS reveal gate, and a
 * container deliberately leaves them alone: the gate defaults to shown
 * (`wantShown = true`), the CONTAINER is the OBS source whose visibility matters,
 * and the layer's own cross-fade is what hides a member that is not up. Wiring a
 * member's gate to the container's visibility would give one element two
 * independent things holding it dark.
 */
const simple = (mod, fn) => async (box) => {
    const inst = (await load(mod))[fn]({ host: hostIn(box) });
    return { ...inst, update: (state) => inst.update(state, OverlayBase.settings) };
};

// …and the same for a mount that binds a BOARD at mount time. Pair it with an
// `identity` keyed on the board, or the layer outlives the board it bound.
const boardScoped = (mod, fn, extra = {}) => async (box, ctx, sel) => {
    const inst = (await load(mod))[fn]({
        host: hostIn(box), sb: Number(sel?.scoreboard) || 1, ...extra,
    });
    return { ...inst, update: (state) => inst.update(state, OverlayBase.settings) };
};

const boardIdentity = (id) => (sel) => `${id}:${Number(sel.scoreboard) || 1}`;

export const MEMBERS = {
    hitvisualizer: {
        size: [1280, 720],
        // A GL renderer wants a viewport plus a non-scaling label plane over it,
        // so it builds its own two divs inside the box rather than taking it
        // directly.
        mount: async (box, { perf }) => {
            const { mountHit } = await load('hit-mount');
            const viewport = document.createElement('div');
            viewport.style.cssText = 'position:absolute;inset:0;';
            const labels = document.createElement('div');
            labels.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
            viewport.appendChild(labels);
            box.appendChild(viewport);
            return mountHit({ viewport, labels, perf });
        },
        // The hit reads a whole board's contact, not a content selection.
        payload: (sel) => Number(sel.scoreboard) || 1,
        // …and it caches stadium geometry and playback per board, so a board
        // change is a separate mount rather than an update.
        identity: (sel) => `hitvisualizer:${Number(sel.scoreboard) || 1}`,
        sample: { file: 'scoreboard', content: { scoreboard: 1 } },
    },
    stats: {
        size: [325, 120],
        mount: async (box) => {
            const { mountStats } = await load('stats-mount');
            return mountStats({ host: box });
        },
        sample: {
            file: 'scoreboard',
            content: { scoreboard: 1, team: 1, charIndex: 0, role: 'batting' },
        },
    },
    roster: {
        size: [452, 140],
        mount: async (box) => {
            const { mountRoster } = await load('roster-mount');
            return mountRoster({ host: box });
        },
        sample: { file: 'scoreboard', content: { scoreboard: 1, team: 1 } },
    },
    // The themed 2x2 stat card — the SAME data as `stats`, wearing the design
    // package's `statscard` element instead of the fed bar's DOM markup. Two
    // members rather than a mode on one because a container's roster is a list of
    // things that can be on screen, and these two are different pictures at
    // different sizes; a container holds whichever one its look calls for.
    statscard: {
        size: [380, 240],
        // Binds its side at MOUNT time (mountStatsCard closes over sb/team and
        // resolves the line itself), so it takes `sel` here and declares an
        // identity below — a scope change is a new layer, not an update.
        mount: async (box, ctx, sel) => {
            const { mountStatsCard } = await load('stats-card-mount');
            const card = mountStatsCard({
                host: hostIn(box),
                sb: Number(sel?.scoreboard) || 1,
                team: Number(sel?.team) === 2 ? 2 : 1,
                settingsType: 'statscard',
                svgElement: 'statscard',
            });
            return {
                update: (state) => card.update(state, OverlayBase.settings),
                dispose: () => card.dispose(),
                replay: () => {},
            };
        },
        identity: (sel) => `statscard:${Number(sel.scoreboard) || 1}:${Number(sel.team) === 2 ? 2 : 1}`,
        sample: { file: 'scoreboard', content: { scoreboard: 1, team: 1 } },
    },
    postgamecallout: {
        size: [1920, 1080],
        mount: async (box) => {
            const { mountPostgameCallout } = await load('postgame-callout-mount');
            return mountPostgameCallout({ host: box });
        },
        sample: { file: 'postgame', content: { scoreboard: 1, team: 1, charIndex: 0 } },
    },
    postgamevs: {
        size: [1920, 1080],
        mount: async (box) => {
            const { mountPostgameVs } = await load('postgame-vs-mount');
            return mountPostgameVs({ host: box });
        },
        sample: { file: 'postgame', content: { scoreboard: 1 } },
    },

    // ── the bands and boards ────────────────────────────────────────────────
    //
    // Elements that own a dedicated source AND can occupy a container. Nothing
    // about them is special: each already had a `lib/*-mount.js` that renders
    // into a host it is handed, which is the whole contract a member needs.
    // They were absent because being hostable was an opt-in nobody had finished,
    // not because a container could not stand them up.

    scoreboard: {
        size: [800, 460],
        // `size: 'l'` is the variant, not the pixels — the mount takes s|m|l and
        // resolves anything else to l. A container's scoreboard is the large one
        // because that is the size the element registry declares; a roster that
        // wanted the small board would be a different member, not a flag here.
        mount: boardScoped('scoreboard-mount', 'mountScoreboard', { size: 'l' }),
        identity: boardIdentity('scoreboard'),
        sample: { file: 'scoreboard', content: { scoreboard: 1 } },
    },
    scorecard: {
        size: [1920, 1080],
        mount: boardScoped('scorecard-mount', 'mountScorecard'),
        identity: boardIdentity('scorecard'),
        // Its standalone bundle seeds SETTINGS as well as state — the phase and
        // game-mode bars are producer text, and without them a sample render
        // collapses those rows. Carried through rather than dropped, or a
        // scorecard would preview worse in a container than on its own source.
        sample: {
            file: 'scoreboard',
            content: { scoreboard: 1 },
            settings: {
                'scoreboards.binding.{sb}.stats_tag': 'Superstar',
                'overlays.scorecard.{sb}.phaseText': 'Winners Final',
            },
        },
    },
    ticker: {
        size: [1920, 80],
        mount: boardScoped('ticker-mount', 'mountTicker'),
        identity: boardIdentity('ticker'),
        sample: { file: 'ticker', content: { scoreboard: 1 } },
    },
    commentary: {
        size: [1920, 240],
        mount: simple('commentary-mount', 'mountCommentary'),
        sample: { file: 'commentary', content: {} },
    },
    playerplates: {
        size: [1920, 240],
        mount: simple('playerplates-mount', 'mountPlayerPlates'),
        sample: { file: 'playerplates', content: {} },
    },
    lowerthird: {
        size: [1920, 320],
        mount: simple('lowerthird-mount', 'mountLowerThird'),
        sample: { file: 'lowerthird', content: {} },
    },
    matchuphistory: {
        size: [1920, 480],
        mount: simple('matchup-mount', 'mountMatchup'),
        sample: { file: 'matchup', content: {} },
    },
    schedule: {
        size: [1920, 1080],
        mount: async (box) => {
            const { mountSchedule } = await load('schedule-mount');
            return mountSchedule({ host: hostIn(box) });
        },
        watch: (key) => key.startsWith('schedule.') || key.startsWith('match.'),
        sample: { file: 'schedule', content: {} },
    },
    // Wraps gc-overlay, a SUBPROCESS on its own port — so unlike every other
    // member there is a second thing that has to be running for it to draw. It
    // reports that itself (the iframe stays hidden and the mount keeps asking),
    // which is the right answer for a container too.
    //
    // Side-scoped like the roster and the stat card: it binds `score.{N}
    // .player.{T}.port` at mount time, so a scope change is a new layer.
    controller: {
        size: [512, 256],
        mount: async (box, ctx, sel) => {
            const { mountController } = await load('controller-mount');
            return mountController({
                host: hostIn(box),
                sb: Number(sel?.scoreboard) || 1,
                team: Number(sel?.team) === 2 ? 2 : 1,
            });
        },
        identity: (sel) => `controller:${Number(sel.scoreboard) || 1}:${Number(sel.team) === 2 ? 2 : 1}`,
        sample: { file: 'scoreboard', content: { scoreboard: 1, team: 1 } },
    },
};

/*
 * Does ANY member need this state key?
 *
 * A container shell listens to the keys a container is about — its feed, the
 * boards, the post-game capture, the event — and a member that reads anything
 * else (the schedule's queue, the Event Header's fixture) would render once and
 * then go deaf inside a container while its own dedicated source updated fine.
 * Each such member declares a `watch`, and this is their union.
 *
 * The union, not the active member's: a container that has not been fed yet has
 * no active layer to ask, and a render only updates the layer that IS up — so
 * the extra wake-ups cost one feed lookup and the alternative costs a bug.
 */
const WATCHERS = Object.values(MEMBERS).map((m) => m.watch).filter(Boolean);
export const memberWatches = (key) => WATCHERS.some((w) => w(key));

/*
 * This container's sample bundle: the occupant's own captured game, plus the
 * feed key standing that occupant up inside this container.
 *
 * A container draws whatever is FED to it, and neither the picker preview nor
 * app-wide demo mode has a live feed to follow — so the bundle has to name an
 * occupant as well as the game behind it. `occupant` is whatever the caller
 * resolved (`?feed=` in a gallery preview, else the definition's first member),
 * so a producer's own container samples as the thing they built it for.
 *
 * With no occupant at all there is nothing to draw, so the bundle is just the
 * game — the container renders transparent, which is the honest sample for an
 * empty container.
 */
export function containerSample(id, occupant) {
    const spec = MEMBERS[occupant];
    if (!spec?.sample) return { file: 'scoreboard' };
    return {
        file: spec.sample.file,
        state: {
            [`production.feed.container.${id}`]: { element: occupant, ...spec.sample.content },
        },
        // Only a member whose own bundle seeds settings has these (the
        // scorecard's phase and game-mode text). Omitted entirely otherwise so
        // OverlayBase sees "no seeds" rather than an empty map.
        ...(spec.sample.settings ? { settings: spec.sample.settings } : {}),
    };
}
