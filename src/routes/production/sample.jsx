import { memo } from 'react';
import { FlaskConical } from 'lucide-react';
import { useStateStore } from '../../context/store';
import { Switch } from '../../components/ui/switch';
import { Button } from '../../components/ui/button';
import { Text } from '../../components/ui/primitives';

/*
 * Sample-data demo mode — the app-wide switch and the banner that guards it.
 *
 * Every Layout declares a sample bundle (see OverlayBase.init's `sample`
 * option). Flipping `production.sample` on makes all of them render that bundle
 * instead of live state, so a producer can build and align an OBS scene with no
 * game running — which is when scene-building actually happens.
 *
 * Three rules this file exists to enforce:
 *
 *  - It is GLOBAL, not per-element. The use case is laying out a whole scene;
 *    a per-source toggle would give you a canvas half fixture and half empty,
 *    which is worse than either.
 *  - It NEVER self-enables. Nothing in PRSH writes `true` here except the
 *    controls below. There is no "helpfully turn this on when no game is
 *    running" path, because the failure mode is a fixture going out on a live
 *    broadcast.
 *  - It survives a restart, because scene design spans sessions — and that is
 *    only acceptable because the banner is unmissable and carries the off
 *    switch. The two decisions are a pair; don't keep one without the other.
 *
 * Deliberately NOT routed through the staging gateway. Off is a panic button:
 * a producer who realises the stream is showing a fixture needs it live now,
 * not staged behind a confirm. On matches it so the switch means one thing.
 */

export const SAMPLE_KEY = 'production.sample';

// Read strictly, exactly as the overlays do: `PUT /api/v1/state` is str-typed,
// so a value written over REST arrives as a string and a plain truthiness check
// would read "false" as on. Anything not recognisably on is off.
export function isSampleOn(v) {
    return v === true || v === 'true' || v === 1 || v === '1';
}

export function useSampleMode() {
    const raw = useStateStore((s) => s?.production?.sample);
    const setItem = useStateStore((s) => s.setItem);
    return [isSampleOn(raw), (on) => setItem(SAMPLE_KEY, !!on)];
}

/** Top-bar switch. Lives with the other console-wide broadcast controls. */
export const SampleModeSwitch = memo(function SampleModeSwitch() {
    const [on, setOn] = useSampleMode();
    return (
        <label
            className="flex items-center gap-1.5"
            title="Show every overlay's sample data instead of the live game, for building and aligning OBS scenes"
        >
            <Text size="xs" className={on ? 'text-amber-300' : 'text-muted-foreground'}>Sample</Text>
            <Switch checked={on} onCheckedChange={setOn} />
        </label>
    );
});

/**
 * App-wide banner. Mounted at the root beside MatchConflictBanner, on the same
 * amber "this needs your attention" vocabulary — a producer must not be able to
 * change tabs away from knowing the overlays are showing a fixture.
 */
export default function SampleModeBanner() {
    const [on, setOn] = useSampleMode();
    if (!on) return null;

    return (
        <div className="border-b border-amber-500/30 bg-amber-950/40 backdrop-blur">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
                <FlaskConical size={16} className="shrink-0 text-amber-400" />
                <div className="min-w-0 text-sm">
                    <span className="font-semibold text-amber-200">Sample data is on air</span>
                    <span className="text-amber-100/80">
                        {' '}— every overlay is showing canned content, not the live game.
                    </span>
                </div>
                <div className="ml-auto">
                    <Button size="sm" variant="destructive" onClick={() => setOn(false)}>
                        Show live game
                    </Button>
                </div>
            </div>
        </div>
    );
}
