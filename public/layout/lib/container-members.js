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
            // Inline positioning beats stats-card-mount's `.st-host { position:
            // fixed }`, which would pin the card to the viewport instead of the
            // centered box this member was given.
            const cardHost = document.createElement('div');
            cardHost.style.cssText = 'position:absolute; inset:0;';
            box.appendChild(cardHost);
            const card = mountStatsCard({
                host: cardHost,
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
};

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
    };
}
