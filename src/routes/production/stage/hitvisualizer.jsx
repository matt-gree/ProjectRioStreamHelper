import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { RotateCcw, Sparkles } from 'lucide-react';
import { useObsStore } from '../../../context/obs';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { notifications } from '../../../lib/notify';
import { ActionRow, NumberRow, SelectRow, ToggleRow } from '../kit';
import { runObs } from '../controls';
import { BindingNote } from './generic';

/*
 * Hit Visualizer stage body — live actions (Replay / Spotlight) over the full
 * config (spotlight auto-cut and its scene/hold).
 *
 * NO SPLIT FEED HERE ANY MORE. This panel commands the visualizer's OWN
 * dedicated source, and a source of its own has nothing to push into; feeding
 * it to a container is what that container's roster is for, and the hit's row
 * UNDER that container carries the standard Push slot. A bespoke push button on
 * a direct source is the thing the source strip exists to end — it was this
 * body's own copy of a verb the header already owns.
 */

// Lead time before the swing starts after we cut to the spotlight scene — lets
// OBS's active transition settle so the contact isn't hidden behind a fade.
const SPOTLIGHT_LEAD_MS = 350;
// Module-scoped so the return-to-previous-scene still fires even if the panel
// closes mid-spotlight. Also doubles as the single-flight guard.
let _spotlightTimer = null;

// Hit-visualizer behavior shared by the action rows and the config below.
// Two things the producer can do with a captured hit from this panel:
//   - Replay it in place (bump score.{N}.hit.replay_nonce — momentary, never
//     staged).
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
        hit, hasHit, scenes, spotlight, obsConnected, firing,
        replay, setSpot, canSpotlight, fireSpotlight,
    };
}

/*
 * The latest-hit line this body used to render as its own `HitSummary` is now
 * the panel's SUBJECT (../subject), drawn above every body by the stage — which
 * is also what puts it on a pinned rail card, where "is there a hit to replay"
 * is the whole question. Four bodies had each invented that line separately;
 * this was one of them.
 */
export default function HitVisualizerStage({ board, placement, scoreboard = board ?? 1 }) {
    // One hook instance for the whole panel: the actions and the config below
    // are the same decision surface and must not drift apart.
    const v = useHitViz(scoreboard);

    return (
        <>
            <ActionRow actions={[
                { label: 'Replay', icon: RotateCcw, disabled: !v.hasHit, onClick: v.replay },
                {
                    label: v.firing ? 'On air…' : 'Spotlight', icon: Sparkles, variant: 'default',
                    disabled: !v.canSpotlight || v.firing, onClick: v.fireSpotlight,
                    title: v.canSpotlight ? 'Cut to the spotlight scene and play' : 'Enable + pick a scene below',
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

        </>
    );
}
