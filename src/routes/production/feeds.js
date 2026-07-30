import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../context/store';
import { stageOrRun, usePending } from '../../context/staging';
import { useConsoleScenes } from './placements';
import { containerId, isPickableFeed } from './elements';
import { containerOfSource, useContainerOf, useSharedContainers } from './containers';
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
 * the broadcast, and no overlay renders `production.feed.last.*`.
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
export function useContainerPush(element, scoreboard = 1) {
    const { container, def } = useContainerOf(element);
    const { value: feed, staged, setFeed } = useFeedControl(container);
    // Flat primitives, so useShallow settles instead of firing on every tick.
    const intent = useStateStore(useShallow(s => resolveIntent(s, element, scoreboard) || NO_INTENT));

    const mine = !!feed && feed.element === element.id;
    const hasIntent = !!intent.element;
    const canPush = !!container && (mine || !isPickableFeed(element) || hasIntent);
    /*
     * A CONTAINER-SCOPED member has no content of its own — it draws whoever the
     * side it belongs to has on the field — so its frame of reference is the
     * container's scope, not the board picker's. That is the same pair the
     * automation engine feeds it (`_scope_of` in server/automations.py), so a
     * push and a rule put the identical thing on screen; without it a push into
     * a right-side container would quietly show the left side, because `team`
     * would simply be absent and default to 1.
     */
    const payload = element.containerScoped
        ? { element: element.id, scoreboard: def?.scoreboard ?? scoreboard, team: def?.team ?? 1 }
        : { element: element.id, scoreboard };
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
