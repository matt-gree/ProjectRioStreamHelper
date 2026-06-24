import { memo, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
    Radio, Eye, EyeOff, Globe, PlugZap, MonitorPlay, ArrowLeftRight,
} from 'lucide-react';
import { useObsStore } from '../../context/obs';
import { useSettingsStore } from '../../context/store';
import { Panel } from '../../components/ui/panel';
import { Stack, Group, Text } from '../../components/ui/primitives';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Switch } from '../../components/ui/switch';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { ScrollArea } from '../../components/ui/scroll-area';
import { notifications } from '../../lib/notify';
import { cn } from '../../lib/utils';
import { PHASES, elementsForPhase } from './elements';

/*
 * Production page — the producer's broadcast control board.
 *
 * Top bar  : phase selector + scene control (program / studio + Take) + OBS pill.
 * Left rail: OBS reality (read) — program + studio-preview scenes and their PRSH
 *            overlay sources.
 * Main area: the ELEMENTS for the selected phase (producer intent). Direct
 *            elements show/hide their dedicated source; fed elements pick a
 *            target shared source and feed it (v1 scaffolding = show/hide).
 * See memory: production-page-v1-locked, production-elements-glossary.
 */

// Run an OBS control action, surfacing failures as a toast (e.g. transition
// while one is mid-flight, or a scene removed under us).
async function runObs(fn) {
    try {
        await fn();
    } catch (e) {
        notifications.show({ message: `OBS: ${e?.message || e}`, color: 'red' });
    }
}

const STATUS_META = {
    connected:    { dot: 'bg-emerald-500',             label: 'OBS connected' },
    connecting:   { dot: 'bg-amber-400 animate-pulse', label: 'Connecting to OBS…' },
    error:        { dot: 'bg-destructive',             label: 'OBS connection error' },
    disconnected: { dot: 'bg-muted-foreground/50',     label: 'OBS not connected' },
};

function ConnectionPill() {
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
}

// Compact, labelled scene dropdown for the top bar.
function SceneSelect({ label, value, scenes, onChange }) {
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
}

// Scene switching + Studio Mode, in the top bar. Studio off: the Program
// dropdown cuts live. Studio on: stage in Preview, then Take to Program.
function TopBarSceneControls() {
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
}

// Rail row — display only (the rail is OBS truth; control happens via elements).
const SourceRow = memo(function SourceRow({ item }) {
    const EyeIcon = item.enabled ? Eye : EyeOff;
    return (
        <div className={cn('flex items-center gap-2 px-2 py-1.5', !item.enabled && 'opacity-50')}>
            <EyeIcon size={14} className={item.enabled ? 'text-foreground' : 'text-muted-foreground'} />
            <Globe size={13} className="shrink-0 text-rio-400" />
            <Text size="sm" className="flex-1 truncate text-foreground">{item.sourceName}</Text>
        </div>
    );
});

const SceneGroup = memo(function SceneGroup({ icon: Icon, label, accent, sceneName, items }) {
    // Only PRSH-fed overlay sources — not cams, capture, audio, etc.
    const prshItems = (items ?? []).filter(it => it.isPrsh);
    return (
        <Stack gap="xs">
            <Group gap="xs" className="items-center px-1">
                <Icon size={14} className={accent} />
                <Text size="xs" className="label-display text-muted-foreground">{label}</Text>
                {sceneName && <Text size="xs" className="truncate text-foreground">{sceneName}</Text>}
            </Group>
            {sceneName ? (
                prshItems.length > 0 ? (
                    <Stack gap="none">
                        {prshItems.map(it => <SourceRow key={it.id} item={it} />)}
                    </Stack>
                ) : (
                    <Text size="xs" className="px-2 text-muted-foreground">No PRSH overlays in this scene.</Text>
                )
            ) : (
                <Text size="xs" className="px-2 text-muted-foreground">—</Text>
            )}
        </Stack>
    );
});

function LeftRail() {
    const { status, studioMode, programScene, previewScene, sceneItems } = useObsStore(useShallow(s => ({
        status: s.status,
        studioMode: s.studioMode,
        programScene: s.programScene,
        previewScene: s.previewScene,
        sceneItems: s.sceneItems,
    })));

    if (status !== 'connected') {
        return (
            <Panel title="On Air / Preview" className="h-full">
                <Stack gap="sm" className="p-4">
                    <Text size="sm" className="text-muted-foreground">
                        {status === 'connecting'
                            ? 'Connecting to OBS…'
                            : 'Connect to OBS to mirror your live and preview sources here.'}
                    </Text>
                    <Text size="xs" className="text-muted-foreground">
                        In OBS: <span className="text-foreground">Tools → WebSocket Server Settings</span> →
                        enable the server (port 4455). Configure host / port / password in PRSH Settings → OBS.
                    </Text>
                </Stack>
            </Panel>
        );
    }

    const programItems = programScene ? sceneItems[programScene] : null;
    const previewItems = previewScene ? sceneItems[previewScene] : null;

    return (
        <Panel title="On Air / Preview" className="h-full">
            <ScrollArea className="h-[calc(100vh-13rem)]">
                <Stack gap="lg" className="p-3">
                    <SceneGroup
                        icon={Radio} label="Program" accent="text-emerald-400"
                        sceneName={programScene} items={programItems}
                    />
                    {studioMode ? (
                        <SceneGroup
                            icon={MonitorPlay} label="Studio Preview" accent="text-sky-400"
                            sceneName={previewScene} items={previewItems}
                        />
                    ) : (
                        <Group gap="xs" className="items-center px-1">
                            <MonitorPlay size={14} className="text-muted-foreground" />
                            <Text size="xs" className="text-muted-foreground">Studio Mode is off in OBS.</Text>
                        </Group>
                    )}
                </Stack>
            </ScrollArea>
        </Panel>
    );
}

const FLAVOR_BADGE = {
    direct: 'bg-rio-500/15 text-rio-300',
    fed:    'bg-sky-500/15 text-sky-300',
};

// One element card. Binds to the streamer's OBS source(s) by matching the
// element's layout against source URLs, scoped to the current program scene.
function ElementCard({ element }) {
    const programScene = useObsStore(s => s.programScene);
    const sceneItems = useObsStore(s => s.sceneItems);
    const setSceneItemEnabled = useObsStore(s => s.setSceneItemEnabled);
    const overrideName = useSettingsStore(s => s?.production?.overrides?.[element.id]);
    const setSetting = useSettingsStore(s => s.setItem);

    // PRSH overlay sources present in the current program scene.
    const items = useMemo(
        () => (programScene ? (sceneItems[programScene] || []).filter(i => i.isPrsh) : []),
        [programScene, sceneItems],
    );

    const header = (
        <Badge className={cn('text-[10px] uppercase tracking-wider', FLAVOR_BADGE[element.flavor])}>
            {element.flavor}
        </Badge>
    );

    if (element.flavor === 'direct') {
        const match = items.find(it => element.match(it.url || ''));
        return (
            <Panel title={element.name} actions={header}>
                <Stack gap="xs" className="p-4">
                    {match ? (
                        <label className="flex items-center justify-between gap-3">
                            <Stack gap="none">
                                <Text size="sm" className="text-foreground">On the broadcast</Text>
                                <Text size="xs" className="text-muted-foreground">{match.sourceName} · {programScene}</Text>
                            </Stack>
                            <Switch
                                checked={match.enabled}
                                onCheckedChange={(v) => runObs(() => setSceneItemEnabled(programScene, match.id, v))}
                            />
                        </label>
                    ) : (
                        <Text size="sm" className="text-muted-foreground">
                            No matching source in the current program scene ({programScene || 'none'}).
                        </Text>
                    )}
                </Stack>
            </Panel>
        );
    }

    // Fed element: target = override, else default match, else unset.
    const defaultName = items.find(it => element.match(it.url || ''))?.sourceName;
    const targetName = overrideName || defaultName || '';
    const targetItem = items.find(it => it.sourceName === targetName);

    const setTarget = (name) => {
        const cur = useSettingsStore.getState()?.production?.overrides || {};
        setSetting('production.overrides', { ...cur, [element.id]: name });
    };

    return (
        <Panel title={element.name} actions={header}>
            <Stack gap="md" className="p-4">
                <label className="flex flex-col gap-1">
                    <Text size="xs" className="text-muted-foreground">Target shared source</Text>
                    <select
                        value={targetName}
                        onChange={(e) => setTarget(e.target.value)}
                        className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
                    >
                        <option value="" disabled>Choose a source…</option>
                        {items.map(it => <option key={it.id} value={it.sourceName}>{it.sourceName}</option>)}
                    </select>
                </label>

                {targetItem ? (
                    <label className="flex items-center justify-between gap-3">
                        <Stack gap="none">
                            <Text size="sm" className="text-foreground">Feed to target</Text>
                            <Text size="xs" className="text-muted-foreground">Shows {targetItem.sourceName} · {programScene}</Text>
                        </Stack>
                        <Switch
                            checked={targetItem.enabled}
                            onCheckedChange={(v) => runObs(() => setSceneItemEnabled(programScene, targetItem.id, v))}
                        />
                    </label>
                ) : (
                    <Text size="sm" className="text-muted-foreground">
                        {targetName
                            ? `“${targetName}” isn’t in the current program scene.`
                            : 'Pick a target shared source to feed.'}
                    </Text>
                )}

                <Text size="xs" className="text-muted-foreground">
                    Content selection (which stats to show) arrives in the next increment.
                </Text>
            </Stack>
        </Panel>
    );
}

function ElementsArea({ phase }) {
    const status = useObsStore(s => s.status);
    const els = elementsForPhase(phase);
    const phaseLabel = PHASES.find(p => p.value === phase)?.label ?? phase;

    if (status !== 'connected') {
        return (
            <Panel title="Elements" className="h-full">
                <Text size="sm" className="p-4 text-muted-foreground">
                    Connect to OBS to control elements.
                </Text>
            </Panel>
        );
    }

    if (els.length === 0) {
        return (
            <Panel title="Elements" className="h-full">
                <Stack gap="xs" className="items-center justify-center p-12 text-center">
                    <Text className="text-foreground">No elements in {phaseLabel} yet</Text>
                    <Text size="sm" className="text-muted-foreground">
                        This phase fills in as its elements ship.
                    </Text>
                </Stack>
            </Panel>
        );
    }

    return (
        <Stack gap="md">
            {els.map(el => <ElementCard key={el.id} element={el} />)}
        </Stack>
    );
}

export default function Production() {
    const [phase, setPhase] = useState('live');

    return (
        <Stack gap="md">
            <Group className="flex-wrap items-center justify-between gap-4">
                <SegmentedControl data={PHASES} value={phase} onChange={setPhase} />
                <Group gap="md" className="flex-wrap items-center">
                    <TopBarSceneControls />
                    <ConnectionPill />
                </Group>
            </Group>

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[300px_1fr]">
                <LeftRail />
                <ElementsArea phase={phase} />
            </div>
        </Stack>
    );
}
