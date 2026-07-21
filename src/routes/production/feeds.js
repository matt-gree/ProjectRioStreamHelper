import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore, useStateStore } from '../../context/store';
import { stageOrRun, usePending } from '../../context/staging';
import { useBindingScenes } from './bindings';
import { isPickableFeed } from './elements';

/*
 * Fed elements: containers + feeds. A fed element's content is pushed into a
 * named SHARED container (the target); the matching shared overlay renders
 * it. Moved verbatim out of production.jsx (console slice 4).
 */

// A named shared container's stable id = its layout filename stem (e.g.
// '/layout/shared/split-screen.html' → 'split-screen'). The producer feeds an
// element into a container by writing production.feed.container.<id>; the
// matching shared overlay reads the same key.
export function containerId(url) {
    return (url || '').replace(/^.*\/([^/]+)\.html?(?:\?.*)?$/, '$1');
}

// An element's default named container = the stem of its canonical layout URL
// (Stats → 'stats-feed', Stat Callout → 'callout-stage'). The producer can
// still re-point it to any other shared container.
export function defaultContainerFor(element) {
    return containerId(element.url) || 'stats-feed';
}

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
        run: () => (feedObj
            ? useStateStore.getState().setItems([{ key: feedKey, value: feedObj }])
            : useStateStore.getState().deleteItems([feedKey])),
    });
    return { value: pending ? pending.value : live, staged: !!pending, setFeed };
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
 * `canPush` is false for a pickable element that has never been picked — there
 * is genuinely nothing to push yet, and the strip disables rather than lies.
 * Otherwise pushing re-sends whatever this element last fed, so a rail card
 * (which has no picker) can hand content back after a Clear.
 */
export function useContainerPush(element, scoreboard = 1) {
    const { container } = useContainerTarget(element.id, defaultContainerFor(element));
    const { value: feed, staged, setFeed } = useFeedControl(container);
    const last = useStateStore(useShallow(s => s?.production?.feed?.container?.[container]));

    const mine = !!feed && feed.element === element.id;
    const repush = mine ? null : (last && last.element === element.id ? last : null);
    const canPush = mine || !isPickableFeed(element) || !!repush;
    const toggle = () => setFeed(mine ? null : (repush ?? { element: element.id, scoreboard }));

    return { container, feed, mine, staged, canPush, toggle, setFeed };
}

// The OBS source rendering a named container, if it's in program or preview.
// Matched by the container id appearing in the source URL's filename.
export function useContainerBinding(container) {
    const scenes = useBindingScenes();
    return useMemo(() => {
        const re = new RegExp(`/${container}\\.html`, 'i');
        for (const sc of scenes) {
            const item = sc.items.find(it => re.test(it.url || ''));
            if (item) return { item, scene: sc.scene, where: sc.where };
        }
        return null;
    }, [scenes, container]);
}
