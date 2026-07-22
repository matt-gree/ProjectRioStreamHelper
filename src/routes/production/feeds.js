import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore, useStateStore } from '../../context/store';
import { stageOrRun, usePending } from '../../context/staging';
import { useConsoleScenes } from './placements';
import { containerId, defaultContainerFor, isPickableFeed } from './elements';
import { resolveIntent } from './suggest';

export { containerId, defaultContainerFor };

// Stable empty intent — a fresh {} each render would defeat useShallow.
const NO_INTENT = Object.freeze({});

/*
 * Fed elements: containers + feeds. A fed element's content is pushed into a
 * named SHARED container (the target); the matching shared overlay renders
 * it. Moved verbatim out of production.jsx (console slice 4).
 */

// The named shared containers (public/layout/shared/*) an element can be fed
// into — Split-Screen, Stats, and any the user adds later. Sourced from the
// layout catalog, independent of OBS scene membership. `url`/`width`/`height`
// ride along so the source strip's Bind slot can add the container the producer
// actually re-pointed to, not just the element's canonical default.
export function useSharedContainers() {
    const [list, setList] = useState([]);
    useEffect(() => {
        let alive = true;
        fetch('/api/v1/layouts')
            .then(r => r.json())
            .then(all => {
                if (!alive) return;
                setList(all.filter(l => l.group === 'shared').map(l => ({
                    id: containerId(l.url), name: l.name,
                    url: l.url, width: l.width, height: l.height,
                })));
            })
            .catch(() => {});
        return () => { alive = false; };
    }, []);
    return list;
}

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
    const { container } = useContainerTarget(element.id, defaultContainerFor(element));
    const feedKey = `production.feed.container.${container}`;
    const lastKey = `production.feed.last.${element.id}`;
    const live = useStateStore(s => s?.production?.feed?.container?.[container]);
    const pending = usePending(`feed:${container}`);
    const mine = !!live && live.element === element.id
        && (live.scoreboard == null || live.scoreboard === scoreboard);

    // Arm this pick; air it too only when we already own the container.
    const select = (payload, label) => {
        useStateStore.getState().setItems([{ key: lastKey, value: payload }]);
        if (mine) {
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
    const clear = (label) => stageOrRun({
        key: `feed:${container}`,
        label: label || `Clear ${container} feed`,
        value: null,
        run: () => useStateStore.getState().deleteItems([feedKey]),
    });

    return { container, mine, staged: !!pending, select, clear };
}

// Which named container an element feeds, persisted per element at
// settings.production.containers.<elementId>. The target itself is config
// (immediate), but releasing the old container's feed is broadcast-visible, so
// that goes through the staging gateway.
export function useContainerTarget(elementId, defaultId) {
    const container = useSettingsStore(s => s?.production?.containers?.[elementId]) || defaultId;
    const setSetting = useSettingsStore(s => s.setItem);
    const setContainer = (id) => {
        if (id === container) return;
        const oldKey = `production.feed.container.${container}`;
        const oldFeed = useStateStore.getState()?.production?.feed?.container?.[container];
        if (oldFeed && oldFeed.element === elementId) {
            stageOrRun({
                key: `feed:${container}`,
                label: `Clear ${container} feed`,
                value: null,
                run: () => useStateStore.getState().deleteItems([oldKey]),
            });
        }
        const cur = useSettingsStore.getState()?.production?.containers || {};
        setSetting('production.containers', { ...cur, [elementId]: id });
    };
    return { container, setContainer };
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
 * is genuinely nothing to show yet, and the strip disables rather than lies.
 */
export function useContainerPush(element, scoreboard = 1) {
    const { container } = useContainerTarget(element.id, defaultContainerFor(element));
    const { value: feed, staged, setFeed } = useFeedControl(container);
    // Flat primitives, so useShallow settles instead of firing on every tick.
    const intent = useStateStore(useShallow(s => resolveIntent(s, element, scoreboard) || NO_INTENT));

    const mine = !!feed && feed.element === element.id;
    const hasIntent = !!intent.element;
    const canPush = mine || !isPickableFeed(element) || hasIntent;
    const toggle = () => setFeed(
        mine ? null : (hasIntent ? intent : { element: element.id, scoreboard }),
    );

    return { container, feed, mine, staged, canPush, toggle, setFeed, intent: hasIntent ? intent : null };
}

// The OBS source rendering a named container, in ANY scene the console can see
// — not just program and preview: a producer re-pointing a feed at a container
// that lives in their Break scene has aimed at something real, and saying "not
// in a scene" there would be a lie. Matched by the container id appearing in the
// source URL's filename.
export function useContainerBinding(container) {
    const scenes = useConsoleScenes();
    return useMemo(() => {
        const re = new RegExp(`/${container}\\.html`, 'i');
        for (const sc of scenes) {
            const item = sc.items.find(it => re.test(it.url || ''));
            if (item) return { item, scene: sc.scene, where: sc.where };
        }
        return null;
    }, [scenes, container]);
}
