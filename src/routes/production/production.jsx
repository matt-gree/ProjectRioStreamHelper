import { memo, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Radio, PlugZap, ArrowLeftRight, CircleDot, X } from 'lucide-react';
import { useObsStore } from '../../context/obs';
import { useSettingsStore } from '../../context/store';
import {
    useStagingStore, commitPending, eventMatchesHotkey,
} from '../../context/staging';
import { Stack, Group, Text } from '../../components/ui/primitives';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Switch } from '../../components/ui/switch';
import { cn } from '../../lib/utils';
import { runObs } from './controls';
import { Rack, seededRail, useRackSelection, useRailPins } from './rack';
import {
    togglePin as togglePinIn, useConsolePlacements, useConsoleScenes,
} from './placements';
import { AddSourceDialog } from './addsource';
import { SampleModeSwitch } from './sample';
import { Stage } from './stage';
import { Rail } from './rail';
import MatchDesk from './desks/match';
import CaptureDesk from './desks/capture';
import BracketDesk from './desks/bracket';

/*
 * Production console — the producer's broadcast control board. Three surfaces
 * (design locked; see the production-console-contract skill):
 *
 * Top bar : scene control (program / studio + Take) + OBS pill.
 * Rack    : scene-grouped monitor + selector for every source and desk (./rack).
 * Stage   : the ONE selected item's full controls (./stage).
 * Rail    : the producer's pinned quick cards, in their own order (./rail).
 *
 * Confirm-to-live: when settings.production.confirm.enabled is on, element
 * mutations here (visibility, feeds, content) are STAGED via stageOrRun()
 * (src/context/staging.js) and only executed when the producer commits — the
 * configured hotkey or the Go Live button on the pending bar. Momentary
 * "fire now" actions (scene switches, Take, replay, spotlight, clock
 * start/pause, post-game capture) always run immediately.
 *
 * Rows come from the SCENES themselves (./placements): every PRSH source in
 * every scene the console can see, grouped under the scene it lives in. There
 * is no phase selector — OBS's scene list is the producer stating the shape of
 * their show, where "phase" was PRSH guessing at it.
 */

const STATUS_META = {
    connected:    { dot: 'bg-emerald-500',             label: 'OBS connected' },
    connecting:   { dot: 'bg-amber-400 animate-pulse', label: 'Connecting to OBS…' },
    error:        { dot: 'bg-destructive',             label: 'OBS connection error' },
    disconnected: { dot: 'bg-muted-foreground/50',     label: 'OBS not connected' },
};

const ConnectionPill = memo(function ConnectionPill() {
    const { status, error, obsVersion } = useObsStore(useShallow(s => ({
        status: s.status, error: s.error, obsVersion: s.obsVersion,
    })));
    const connect = useObsStore(s => s.connect);
    const meta = STATUS_META[status] ?? STATUS_META.disconnected;

    return (
        <Group gap="sm" className="items-center">
            <Group gap="xs" className="items-center rounded-full border border-border bg-card px-3 py-1.5">
                <span className={cn('size-2 rounded-full', meta.dot)} />
                <Text size="sm" className="text-foreground">{meta.label}</Text>
                {status === 'connected' && obsVersion && (
                    <Badge className="ml-1 bg-emerald-500/15 text-emerald-300 text-[10px]">v{obsVersion}</Badge>
                )}
            </Group>
            {(status === 'disconnected' || status === 'error') && (
                <Button size="sm" variant="secondary" onClick={() => connect()}>
                    <PlugZap size={14} className="mr-1" />
                    {status === 'error' ? 'Retry' : 'Connect'}
                </Button>
            )}
            {status === 'error' && error && (
                <Text size="xs" className="max-w-[28ch] truncate text-destructive" title={error}>
                    {error}
                </Text>
            )}
        </Group>
    );
});

// Compact, labelled scene dropdown for the top bar.
const SceneSelect = memo(function SceneSelect({ label, value, scenes, onChange }) {
    return (
        <label className="flex items-center gap-1.5">
            <Text size="xs" className="text-muted-foreground">{label}</Text>
            <select
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
                className="max-w-[180px] rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
            >
                {!value && <option value="" disabled>—</option>}
                {scenes.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
        </label>
    );
});

// Scene switching + Studio Mode, in the top bar. Studio off: the Program
// dropdown cuts live. Studio on: stage in Preview, then Take to Program.
// Always immediate — scene transport is the producer's manual "fire" surface,
// never staged.
const TopBarSceneControls = memo(function TopBarSceneControls() {
    const { status, scenes, programScene, previewScene, studioMode } = useObsStore(useShallow(s => ({
        status: s.status,
        scenes: s.scenes,
        programScene: s.programScene,
        previewScene: s.previewScene,
        studioMode: s.studioMode,
    })));
    const setProgramScene = useObsStore(s => s.setProgramScene);
    const setPreviewScene = useObsStore(s => s.setPreviewScene);
    const setStudioMode = useObsStore(s => s.setStudioMode);
    const triggerTransition = useObsStore(s => s.triggerTransition);

    if (status !== 'connected') return null;

    return (
        <Group gap="sm" className="items-center">
            <label className="flex items-center gap-1.5">
                <Text size="xs" className="text-muted-foreground">Studio</Text>
                <Switch checked={studioMode} onCheckedChange={(v) => runObs(() => setStudioMode(v))} />
            </label>
            {studioMode ? (
                <>
                    <SceneSelect
                        label="Preview" value={previewScene} scenes={scenes}
                        onChange={(name) => runObs(() => setPreviewScene(name))}
                    />
                    <Button size="sm" onClick={() => runObs(() => triggerTransition())} disabled={!previewScene}>
                        <ArrowLeftRight size={14} className="mr-1" />
                        Take
                    </Button>
                    <Text size="xs" className="text-muted-foreground">
                        On air: <span className="text-emerald-300">{programScene || '—'}</span>
                    </Text>
                </>
            ) : (
                <SceneSelect
                    label="Program" value={programScene} scenes={scenes}
                    onChange={(name) => runObs(() => setProgramScene(name))}
                />
            )}
        </Group>
    );
});

// The confirm-to-live surface: a sticky bar listing every staged change, with
// Go Live (also bound to the configured hotkey while this page is mounted) and
// Discard all. Hidden entirely when confirm mode is off — unless changes are
// still pending from before it was turned off, so nothing staged can strand.
export const PendingBar = memo(function PendingBar() {
    const enabled = useSettingsStore(s => s?.production?.confirm?.enabled) === true;
    const hotkey = useSettingsStore(s => s?.production?.confirm?.hotkey) || 'F9';
    const { pending, order } = useStagingStore(useShallow(s => ({ pending: s.pending, order: s.order })));
    const discard = useStagingStore(s => s.discard);
    const discardAll = useStagingStore(s => s.discardAll);
    const count = order.length;

    useEffect(() => {
        if (!enabled) return undefined;
        const onKey = (e) => {
            if (eventMatchesHotkey(e, hotkey)) {
                e.preventDefault();
                commitPending();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [enabled, hotkey]);

    if (!enabled && count === 0) return null;

    return (
        <div className={cn(
            'sticky bottom-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card/95 px-3 py-2 backdrop-blur',
            count > 0 ? 'border-amber-500/50' : 'border-border',
        )}>
            <CircleDot size={14} className={count > 0 ? 'text-amber-400' : 'text-muted-foreground'} />
            {count === 0 ? (
                <Text size="xs" className="text-muted-foreground">
                    Confirm mode on — element changes stage here until you go live ({hotkey}).
                </Text>
            ) : (
                <>
                    <Text size="sm" className="font-medium text-foreground">
                        {count} staged change{count === 1 ? '' : 's'}
                    </Text>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                        {order.map((key) => (
                            <span
                                key={key}
                                className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200"
                            >
                                <span className="max-w-[24ch] truncate">{pending[key]?.label || key}</span>
                                <button
                                    type="button"
                                    onClick={() => discard(key)}
                                    className="text-amber-300/70 hover:text-amber-100"
                                    aria-label={`Discard ${pending[key]?.label || key}`}
                                >
                                    <X size={11} />
                                </button>
                            </span>
                        ))}
                    </div>
                    <Button size="sm" variant="ghost" onClick={discardAll}>Discard all</Button>
                    <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => commitPending()}>
                        <Radio size={14} className="mr-1" /> Go Live · {hotkey}
                    </Button>
                </>
            )}
        </div>
    );
});

/*
 * Desk bodies, keyed by the ids the rack lists in DESKS. Module-level so the
 * three desk registries — rows (rack.jsx), bodies (here) and quick faces
 * (quickface.jsx) — can be checked against each other rather than drifting
 * apart silently.
 *
 * Match has no quick face that fits the rail's two-row cap (dense fixture
 * authoring), so it is deliberately not pinnable; Capture's and Bracket's fit.
 */
export const DESK_BODIES = {
    'desk:match': { title: 'Match', body: <MatchDesk />, pinnable: false },
    'desk:capture': { title: 'Capture', body: <CaptureDesk /> },
    'desk:bracket': { title: 'Bracket', body: <BracketDesk /> },
};

export default function Production() {
    // Selection + rail pins live here so the rack and the stage read one copy
    // (usePersistentState is per-hook, not a shared store).
    const [selection, setSelection] = useRackSelection();
    const [rail, setRail] = useRailPins();
    /*
     * The Add picker's target: `{ scene }` while open, null while closed.
     *
     * Wrapped rather than held as a bare scene string, because "open with no
     * scene" is a real state — the catalog tier's + (no OBS, so no scenes) opens
     * the picker for its Copy URL and its container builder, both of which need
     * nothing from OBS. A bare string can't tell that from closed.
     */
    const [add, setAdd] = useState(null);
    // A never-touched rail (null) seeds its first-run cards; an emptied one ([])
    // stays empty. Toggling always writes an explicit array, so the seed is
    // adopted the moment the producer edits it rather than resurrecting later.
    const pins = useMemo(() => seededRail(rail), [rail]);
    // Pins are matched by the placement they resolve to, not by stored string —
    // so unpinning removes the card the producer is looking at even when it is
    // stored in a pre-scene or pre-instance form, and pinning can't produce two
    // cards for one source. See ./placements.
    const scenes = useConsoleScenes();
    const placements = useConsolePlacements(scenes);
    const togglePin = (id) => setRail(prev => togglePinIn(seededRail(prev), id, placements));

    return (
        <Stack gap="md">
            <Group className="flex-wrap items-center justify-end gap-4">
                <Group gap="md" className="flex-wrap items-center">
                    <TopBarSceneControls />
                    <SampleModeSwitch />
                    <ConnectionPill />
                </Group>
            </Group>

            {/* The stage gets a floor and the two side columns yield to it.
                With plain `280px 1fr 252px` the fixed tracks are satisfied
                first, so on a window that is merely wide enough to earn three
                columns the WORK SURFACE ends up the narrowest of the three —
                measured at 990px of grid, the stage got 402px while the rack
                and rail took 532 between them, and the preview inside it
                rendered its 1920×1080 source at 21%. A min on the middle track
                inverts that: the rack and rail give up their last ~90px each
                before the thing the producer is actually looking at does. */}
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,280px)_minmax(560px,1fr)_minmax(0,252px)]">
                <Rack
                    selection={selection} onSelect={setSelection}
                    pins={pins} onPinToggle={togglePin}
                    onAdd={(scene) => setAdd({ scene: scene ?? null })}
                />
                <Stage
                    selection={selection} deskBodies={DESK_BODIES}
                    pins={pins} onPinToggle={togglePin}
                />
                <Rail
                    pins={pins} onReorder={setRail}
                    onUnpin={togglePin} onOpen={setSelection}
                />
            </div>

            <PendingBar />
            <AddSourceDialog
                open={!!add} scene={add?.scene ?? null} onClose={() => setAdd(null)}
            />
        </Stack>
    );
}
