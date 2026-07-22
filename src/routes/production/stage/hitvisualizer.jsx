import { memo, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { RotateCcw, Sparkles, Columns2 } from 'lucide-react';
import { useObsStore } from '../../../context/obs';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { Text } from '../../../components/ui/primitives';
import { notifications } from '../../../lib/notify';
import { ActionRow, NumberRow, SelectRow, ToggleRow } from '../kit';
import { runObs } from '../controls';
import { useContainerTarget, useFeedControl, useSharedContainers } from '../feeds';
import { BindingNote } from './generic';

/*
 * Hit Visualizer stage body — live actions (Replay / Spotlight / Split feed)
 * over the full config (overlay visibility, spotlight auto-cut, container
 * target). Moved out of production.jsx (console slice 4); the face/setup
 * split collapses into one stage panel.
 */

// Lead time before the swing starts after we cut to the spotlight scene — lets
// OBS's active transition settle so the contact isn't hidden behind a fade.
const SPOTLIGHT_LEAD_MS = 350;
// Module-scoped so the return-to-previous-scene still fires even if the panel
// closes mid-spotlight. Also doubles as the single-flight guard.
let _spotlightTimer = null;

// Hit-visualizer behavior shared by the action rows and the config below.
// Three things the producer can do with a captured hit:
//   - Replay it in place (bump score.{N}.hit.replay_nonce — momentary, never
//     staged).
//   - Feed it into a named shared container (production.feed.container.<id>) —
//     staged under confirm mode like every other feed.
//   - Spotlight it: cut to a chosen OBS scene, play the animation, cut back to
//     the previous program scene (settings.production.spotlight) — momentary.
// Scoreboard 1 for now (matches the default overlay binding); multi-scoreboard
// is a later concern.
function useHitViz(scoreboard = 1) {
    const hit = useStateStore(useShallow(s => s?.score?.[scoreboard]?.hit));
    const hasHit = hit && Array.isArray(hit.path) && hit.path.length > 0;

    const status = useObsStore(s => s.status);
    const scenes = useObsStore(s => s.scenes);
    const spotlight = useSettingsStore(s => s?.production?.spotlight) || {};
    const setSetting = useSettingsStore(s => s.setItem);
    const obsConnected = status === 'connected';

    const { container, setContainer } = useContainerTarget('hitvisualizer', 'split-screen');
    const { value: containerFeed, staged: feedStaged, setFeed } = useFeedControl(container);
    const fedHere = !!containerFeed && containerFeed.element === 'hitvisualizer'
        && (Number(containerFeed.scoreboard) || 1) === scoreboard;

    const mounted = useRef(true);
    // Set true in the body, not just at init: under StrictMode the effect runs
    // mount→unmount→remount, and a cleanup-only ref would stay false forever.
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const [firing, setFiring] = useState(false);

    const replay = () => useStateStore.getState().setItems([
        { key: `score.${scoreboard}.hit.replay_nonce`, value: Date.now() },
    ]);

    // Feed: assign this hit to the chosen named container. The matching shared
    // overlay renders it, and plays it when made active in OBS.
    const feedContainer = () => setFeed({ element: 'hitvisualizer', scoreboard }, 'Feed hit to container');
    const clearContainer = () => setFeed(null, 'Clear hit feed');

    const setSpot = (patch) => {
        const cur = useSettingsStore.getState()?.production?.spotlight || {};
        setSetting('production.spotlight', { ...cur, ...patch });
    };

    const canSpotlight = !!spotlight.enabled && !!spotlight.scene && hasHit && obsConnected;

    const fireSpotlight = () => {
        if (_spotlightTimer || !canSpotlight) return;
        const prev = useObsStore.getState().programScene;
        if (!prev) { notifications.show({ message: 'OBS: no current program scene', color: 'red' }); return; }
        const frames = hit.path.length;
        const animMs = (frames / 60) * 1000;
        const holdMs = Number(spotlight.holdMs) || 1500;
        setFiring(true);
        runObs(() => useObsStore.getState().setProgramScene(spotlight.scene));
        // Fire the swing once the cut-in has settled.
        setTimeout(() => useStateStore.getState().setItems([
            { key: `score.${scoreboard}.hit.replay_nonce`, value: Date.now() },
        ]), SPOTLIGHT_LEAD_MS);
        // Return to the previous program scene after the flight + a hold on the landing.
        _spotlightTimer = setTimeout(() => {
            _spotlightTimer = null;
            runObs(() => useObsStore.getState().setProgramScene(prev));
            if (mounted.current) setFiring(false);
        }, SPOTLIGHT_LEAD_MS + animMs + holdMs);
    };

    return {
        hit, hasHit, fedHere, feedStaged, scenes, spotlight, obsConnected, firing,
        replay, feedContainer, clearContainer, setSpot, canSpotlight, fireSpotlight,
        container, setContainer,
    };
}

// What the latest captured hit was, so the actions below have a subject.
const HitSummary = memo(function HitSummary({ v }) {
    return (
        <>
            <Text size="xs" truncate className="text-muted-foreground">
                {v.hasHit
                    ? `Latest: ${v.hit.batter || '—'}${v.hit.result ? ` · ${v.hit.result}` : ''}${v.hit.distance != null ? ` · ${v.hit.distance}m` : ''}`
                    : 'No hit captured yet'}
            </Text>
            {v.hit && v.hit.valid === false && v.hit.warning && (
                <Text size="xs" truncate className="text-amber-500" title={v.hit.warning}>
                    ⚠ Sim diverges
                </Text>
            )}
        </>
    );
});

export default function HitVisualizerStage({ board, placement, scoreboard = board ?? 1 }) {
    // One hook instance for the whole panel: the actions and the config below
    // are the same decision surface and must not drift apart.
    const v = useHitViz(scoreboard);
    const containers = useSharedContainers();

    return (
        <>
            <HitSummary v={v} />
            <ActionRow actions={[
                { label: 'Replay', icon: RotateCcw, disabled: !v.hasHit, onClick: v.replay },
                {
                    label: v.firing ? 'On air…' : 'Spotlight', icon: Sparkles, variant: 'default',
                    disabled: !v.canSpotlight || v.firing, onClick: v.fireSpotlight,
                    title: v.canSpotlight ? 'Cut to the spotlight scene and play' : 'Enable + pick a scene below',
                },
                {
                    label: v.fedHere ? 'Clear split' : 'Split', icon: Columns2,
                    variant: v.fedHere ? 'default' : 'secondary',
                    disabled: !v.hasHit && !v.fedHere,
                    onClick: v.fedHere ? v.clearContainer : v.feedContainer,
                    title: v.feedStaged
                        ? 'Staged — goes live on confirm'
                        : v.fedHere ? 'Fed to a shared container — click to clear' : 'Feed to a shared container',
                },
            ]} />

            <div className="mt-1 flex flex-col gap-1.5 border-t border-border/60 pt-2">
                <BindingNote binding={placement} />

                <ToggleRow
                    label="Spotlight auto-cut" checked={!!v.spotlight.enabled}
                    onChange={(c) => v.setSpot({ enabled: c })}
                />
                {v.spotlight.enabled && (
                    <>
                        <SelectRow
                            label="Scene" value={v.spotlight.scene || ''}
                            onChange={(s) => v.setSpot({ scene: s })}
                            placeholder={v.obsConnected ? 'Choose…' : 'Connect OBS'}
                            options={v.scenes}
                        />
                        <NumberRow
                            label="Hold" value={v.spotlight.holdMs ?? 1500} suffix="ms"
                            min={0} step={250}
                            onChange={(n) => v.setSpot({ holdMs: n ?? 0 })}
                        />
                    </>
                )}
            </div>

            <div className="mt-1 flex flex-col gap-1.5 border-t border-border/60 pt-2">
                <SelectRow
                    label="Feed into" value={v.container} onChange={v.setContainer}
                    options={containers.length
                        ? containers.map(c => ({ label: c.name, value: c.id }))
                        : [{ label: 'Split-Screen', value: v.container }]}
                />
            </div>
        </>
    );
}
