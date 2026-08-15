import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../context/store';
import { stageOrRun, usePending } from '../../context/staging';
import { useConsoleScenes } from './placements';
import { containerId, isPickableFeed } from './elements';
import {
    containerOfSource, useContainerDefs, useContainerOf, useSharedContainers,
} from './containers';
import { resolveIntent } from './suggest';

export { containerId };
export { useSharedContainers };

// Stable empty intent — a fresh {} each render would defeat useShallow.
const NO_INTENT = Object.freeze({});

/*
 * Fed elements: containers + feeds. A fed element's content is pushed into the
 * shared container whose ROSTER names it; that container's source renders it.
 *
 * Which container that is comes from ./containers — membership lives on the
 * container and nowhere else. It can be null (no roster names this element),
 * which every hook here treats as a real state: there is nowhere to push, and
 * the surfaces say so rather than falling back to a default nobody chose.
 */

// One container's feed, staged. `value` is what controls display (the pending
// pick if any, else the live feed — and a pending pick may legitimately be
// null, i.e. a staged clear). setFeed(null) clears.
export function useFeedControl(container) {
    const key = `feed:${container}`;
    const feedKey = `production.feed.container.${container}`;
    const live = useStateStore(s => s?.production?.feed?.container?.[container]);
    const pending = usePending(key);
    const setFeed = (feedObj, label) => stageOrRun({
        key,
        label: label || (feedObj ? `Feed ${container}` : `Clear ${container} feed`),
        value: feedObj,
        // Every feed ALSO records itself under the element that sent it. A
        // container holds one occupant, so without this the producer's pick is
        // destroyed the moment anything else takes the stage — and Push, which
        // could only replay the container's current value, had nothing to give
        // back. Clearing deliberately leaves the memory: Clear takes the
        // element off air, it doesn't un-pick the character. See suggest.js.
        run: () => (feedObj
            ? useStateStore.getState().setItems([
                { key: feedKey, value: feedObj },
                ...(feedObj.element
                    ? [{ key: `production.feed.last.${feedObj.element}`, value: feedObj }]
                    : []),
            ])
            : useStateStore.getState().deleteItems([feedKey])),
    });
    return { value: pending ? pending.value : live, staged: !!pending, setFeed };
}

/*
 * Picking content for a fed element, DECOUPLED from airing it.
 *
 * "Picking IS feeding" was wrong for a full-screen callout: choosing a
 * character to preview shouldn't slam it onto the broadcast. So a pick records
 * the element's standing INTENT (`production.feed.last.{id}` — what the preview
 * draws and what Push would air, see suggest.js) and stops there... UNLESS this
 * element already holds the container. Then the pick is a live edit of what's
 * on screen, so it updates the container too — through the staging gateway,
 * because that IS broadcast-visible. Selecting off-air arms; Push airs.
 *
 * The intent write is immediate and never staged: it drives the preview, not
 * the broadcast.
 *
 * ONE OVERLAY DOES READ IT NOW, and this is the deliberate edge: an element's
 * own dedicated source renders `production.feed.last.{id}` directly (see
 * public/layout/postgame/spotlight.html), so a pick made while that source is
 * on air changes the picture immediately, confirm mode or not. It stays
 * unstaged because arming is also what drives the stage preview, and holding
 * the pick would leave the producer picking blind — the same trade the hit
 * visualizer's Replay makes. The broadcast-visible act on that panel is the
 * eye, and the eye stages like everything else.
 */
export function useFeedSelect(element, scoreboard = 1) {
    const { container } = useContainerOf(element);
    const feedKey = `production.feed.container.${container}`;
    const lastKey = `production.feed.last.${element.id}`;
    const live = useStateStore(s => s?.production?.feed?.container?.[container]);
    const pending = usePending(`feed:${container}`);
    const mine = !!live && live.element === element.id
        && (live.scoreboard == null || live.scoreboard === scoreboard);

    /*
     * Arm this pick; air it too only when we already own the container.
     *
     * Arming works even with no container: the pick is the element's standing
     * intent, and choosing which character you want on screen is a decision a
     * producer can make before deciding where it lands. Only the AIRING half
     * needs somewhere to land.
     */
    const select = (payload, label) => {
        useStateStore.getState().setItems([{ key: lastKey, value: payload }]);
        if (mine && container) {
            stageOrRun({
                key: `feed:${container}`,
                label: label || `Feed ${container}`,
                value: payload,
                run: () => useStateStore.getState().setItems([
                    { key: feedKey, value: payload },
                    { key: lastKey, value: payload },
                ]),
            });
        }
    };

    // Take this element off the container. Leaves the intent — Clear takes it
    // off air, it does not un-pick the character.
    const clear = (label) => container && stageOrRun({
        key: `feed:${container}`,
        label: label || `Clear ${container} feed`,
        value: null,
        run: () => useStateStore.getState().deleteItems([feedKey]),
    });

    return { container, mine, staged: !!pending, select, clear };
}

/*
 * One fed element's push decision — "is MY content on the container, and can I
 * put it there". The single definition behind both surfaces that expose it:
 * the panel header's Push slot (sourcestrip.jsx) and the rail's push-only quick
 * face (quickface.jsx). They were separate copies of this logic; a producer
 * clicking Push on the rail and on the stage must mean exactly one thing.
 *
 * What Push sends is the element's standing INTENT (suggest.js): the pick it
 * last fed if that still names a real character, else a suggestion. One
 * definition, so the stage's dropdown and the rail's Push button can never
 * disagree about what is about to go on air.
 *
 * `canPush` is false only for a pickable element with no intent at all — there
 * is genuinely nothing to show yet, and the strip disables rather than lies —
 * or when NO container's roster names this element, where there is nowhere for
 * a push to land at all.
 */
export function useContainerPush(element, scoreboard = 1, onContainer = null) {
    const defs = useContainerDefs();
    const own = useContainerOf(element);
    /*
     * The container this push lands in: the ROW's when it has one, else the
     * roster that claims this element. A container-scoped member may sit on
     * several rosters — the exception that makes a mirrored pair buildable — so
     * the element→container lookup is a coin flip between the two sides, and
     * both of the pair's rows would have pushed into whichever came first.
     */
    const container = onContainer ?? own.container;
    const def = onContainer ? (defs[onContainer] ?? null) : own.def;
    const { value: feed, staged, setFeed } = useFeedControl(container);
    // Flat primitives, so useShallow settles instead of firing on every tick.
    const intent = useStateStore(useShallow(s => resolveIntent(s, element, scoreboard) || NO_INTENT));

    const mine = !!feed && feed.element === element.id;
    /*
     * A CONTAINER-SCOPED member has no intent to remember. It has no content of
     * its own — what it draws is entirely the container's frame of reference —
     * so the only honest payload is the one built from that scope below.
     *
     * `useFeedControl` records every feed at `production.feed.last.{element}`,
     * and `resolveIntent` replays a remembered payload verbatim for any feed
     * with no `FEED_INTENT` entry (which is every scoped member). Left alone,
     * the FIRST Stat Card push anywhere fixed its board and side forever: the
     * mirrored pair's right-hand container replayed the left one's `team`, and
     * re-pointing a container's Board picker changed nothing on the next push.
     * Scope wins, always.
     */
    const hasIntent = !!intent.element && !element.containerScoped;
    const canPush = !!container && (mine || !isPickableFeed(element) || hasIntent);
    /*
     * A CONTAINER-SCOPED member has no content of its own — it draws whoever the
     * side it belongs to has on the field — so its frame of reference is the
     * container's scope, not the board picker's. That is the same pair the
     * automation engine feeds it (`_scope_of` in server/automations.py), so a
     * push and a rule put the identical thing on screen; without it a push into
     * a right-side container would quietly show the left side, because `team`
     * would simply be absent and default to 1.
     *
     * The BOARD comes from that scope for every member, scoped or not: a
     * member's slot on a container has no board axis of its own (the container
     * is board-agnostic and the board rides in the payload), so the container's
     * own frame of reference is the only thing left that knows which board it
     * is looking at. Only `team` stays scoped-only — a content-bearing member
     * carries its own side in its pick.
     */
    const payload = element.containerScoped
        ? { element: element.id, scoreboard: def?.scoreboard ?? scoreboard, team: def?.team ?? 1 }
        : { element: element.id, scoreboard: def?.scoreboard ?? scoreboard };
    const toggle = () => container && setFeed(mine ? null : (hasIntent ? intent : payload));

    return { container, feed, mine, staged, canPush, toggle, setFeed, intent: hasIntent ? intent : null };
}

/*
 * The OBS source rendering a container, in ANY scene the console can see — not
 * just program and preview: a container that lives in the producer's Break
 * scene is something real, and saying "not in a scene" there would be a lie.
 *
 * Matched by resolving each source URL to a container id, which is the same
 * derivation the overlay itself uses — so a definition-backed source
 * (`container.html?container=x`) and a pre-2.0 named shell (`x.html`) both
 * answer to the container they render.
 */
export function useContainerBinding(container) {
    const scenes = useConsoleScenes();
    return useMemo(() => {
        if (!container) return null;
        for (const sc of scenes) {
            const item = sc.items.find(it => containerOfSource(it.url) === container);
            if (item) return { item, scene: sc.scene, where: sc.where };
        }
        return null;
    }, [scenes, container]);
}
