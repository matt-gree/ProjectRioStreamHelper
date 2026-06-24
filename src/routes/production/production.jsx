import { memo, useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
    Radio, Eye, EyeOff, Globe, PlugZap, MonitorPlay, Tv, ArrowLeftRight,
} from 'lucide-react';
import { useObsStore } from '../../context/obs';
import { Panel } from '../../components/ui/panel';
import { Stack, Group, Text } from '../../components/ui/primitives';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Switch } from '../../components/ui/switch';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { ScrollArea } from '../../components/ui/scroll-area';
import { notifications } from '../../lib/notify';
import { cn } from '../../lib/utils';

// Run an OBS control action, surfacing failures as a toast (e.g. transition
// while one is mid-flight, or a scene removed under us).
async function runObs(fn) {
    try {
        await fn();
    } catch (e) {
        notifications.show({ message: `OBS: ${e?.message || e}`, color: 'red' });
    }
}

/*
 * Production page — the producer's broadcast control board (Live phase).
 *
 * Left rail = OBS reality (read): the program + studio-preview scenes and their
 * PRSH overlay sources. Main area = producer intent (write): switch program
 * scene, set studio preview + transition, and show/hide the selected overlay.
 * Element authoring + content firing land in later slices. See memory:
 * production-page-v1-locked.
 */

const PHASES = [
    { label: 'Draft', value: 'draft' },
    { label: 'Live', value: 'live' },
    { label: 'Post-game', value: 'post' },
    { label: 'Break', value: 'break' },
];

const STATUS_META = {
    connected:    { dot: 'bg-emerald-500',        label: 'OBS connected' },
    connecting:   { dot: 'bg-amber-400 animate-pulse', label: 'Connecting to OBS…' },
    error:        { dot: 'bg-destructive',         label: 'OBS connection error' },
    disconnected: { dot: 'bg-muted-foreground/50', label: 'OBS not connected' },
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

const SourceRow = memo(function SourceRow({ item, sceneName, selected, onSelect }) {
    const EyeIcon = item.enabled ? Eye : EyeOff;
    return (
        <button
            type="button"
            onClick={() => onSelect(item, sceneName)}
            className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                selected ? 'bg-rio-500/15 ring-1 ring-rio-500/40' : 'hover:bg-muted/50',
                !item.enabled && 'opacity-50',
            )}
        >
            <EyeIcon size={14} className={item.enabled ? 'text-foreground' : 'text-muted-foreground'} />
            <Globe size={13} className="text-rio-400 shrink-0" />
            <Text size="sm" className="flex-1 truncate text-foreground">{item.sourceName}</Text>
        </button>
    );
});

const SceneGroup = memo(function SceneGroup({ icon: Icon, label, accent, sceneName, items, selectedKey, onSelect }) {
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
                (prshItems.length > 0) ? (
                    <Stack gap="none">
                        {prshItems.map(it => (
                            <SourceRow
                                key={it.id}
                                item={it}
                                sceneName={sceneName}
                                selected={selectedKey === `${sceneName}:${it.id}`}
                                onSelect={onSelect}
                            />
                        ))}
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

function LeftRail({ selectedKey, onSelect }) {
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
                        selectedKey={selectedKey} onSelect={onSelect}
                    />
                    {studioMode ? (
                        <SceneGroup
                            icon={MonitorPlay} label="Studio Preview" accent="text-sky-400"
                            sceneName={previewScene} items={previewItems}
                            selectedKey={selectedKey} onSelect={onSelect}
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

// Control for the selected overlay source — live show/hide. Reads the item
// fresh from the store (not a snapshot) so the toggle reflects OBS reality.
function SourceControls({ selection }) {
    const item = useObsStore(s => (
        selection ? (s.sceneItems[selection.sceneName] || []).find(i => i.id === selection.id) : null
    ));
    const setSceneItemEnabled = useObsStore(s => s.setSceneItemEnabled);

    if (!selection) {
        return (
            <Panel title="Source">
                <Stack gap="xs" className="items-center justify-center p-8 text-center">
                    <Tv size={24} className="text-muted-foreground" />
                    <Text size="sm" className="text-muted-foreground">
                        Select an overlay from the rail to show or hide it on the broadcast.
                    </Text>
                </Stack>
            </Panel>
        );
    }
    if (!item) {
        return (
            <Panel title="Source">
                <Text size="sm" className="p-4 text-muted-foreground">
                    That source is no longer in this scene.
                </Text>
            </Panel>
        );
    }

    return (
        <Panel title={`Source — ${item.sourceName}`}>
            <Stack gap="md" className="p-4">
                <label className="flex items-center justify-between gap-3">
                    <Stack gap="none">
                        <Text size="sm" className="text-foreground">On the broadcast</Text>
                        <Text size="xs" className="text-muted-foreground">
                            Toggles this source in “{selection.sceneName}”.
                        </Text>
                    </Stack>
                    <Switch
                        checked={item.enabled}
                        onCheckedChange={(v) => runObs(() => setSceneItemEnabled(selection.sceneName, item.id, v))}
                    />
                </label>
                {item.url && (
                    <Stack gap="none">
                        <Text size="xs" className="text-muted-foreground">Overlay URL</Text>
                        <Text size="sm" className="break-all text-foreground">{item.url}</Text>
                    </Stack>
                )}
            </Stack>
        </Panel>
    );
}

// Scene switching + Studio Mode. In Studio Mode, clicking a scene stages it as
// Preview and the producer hits Take to transition; otherwise clicking cuts it
// straight to Program.
function SceneControls() {
    const { scenes, programScene, previewScene, studioMode } = useObsStore(useShallow(s => ({
        scenes: s.scenes,
        programScene: s.programScene,
        previewScene: s.previewScene,
        studioMode: s.studioMode,
    })));
    const setProgramScene = useObsStore(s => s.setProgramScene);
    const setPreviewScene = useObsStore(s => s.setPreviewScene);
    const setStudioMode = useObsStore(s => s.setStudioMode);
    const triggerTransition = useObsStore(s => s.triggerTransition);

    const onSceneClick = useCallback((name) => {
        if (studioMode) runObs(() => setPreviewScene(name));
        else runObs(() => setProgramScene(name));
    }, [studioMode, setPreviewScene, setProgramScene]);

    return (
        <Panel
            title="Scenes"
            actions={
                <label className="flex items-center gap-1.5">
                    <Text size="xs" className="text-muted-foreground">Studio Mode</Text>
                    <Switch
                        checked={studioMode}
                        onCheckedChange={(v) => runObs(() => setStudioMode(v))}
                    />
                </label>
            }
        >
            <Stack gap="md" className="p-3">
                {studioMode && (
                    <Button
                        className="w-full"
                        onClick={() => runObs(() => triggerTransition())}
                        disabled={!previewScene}
                    >
                        <ArrowLeftRight size={15} className="mr-1.5" />
                        Take {previewScene ? `“${previewScene}”` : 'Preview'} to Program
                    </Button>
                )}
                <Stack gap="none">
                    {scenes.length === 0 && (
                        <Text size="sm" className="px-2 text-muted-foreground">No scenes.</Text>
                    )}
                    {scenes.map((name) => {
                        const isProgram = name === programScene;
                        const isPreview = studioMode && name === previewScene;
                        return (
                            <button
                                key={name}
                                type="button"
                                onClick={() => onSceneClick(name)}
                                className={cn(
                                    'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors',
                                    isProgram ? 'bg-emerald-500/10' : isPreview ? 'bg-sky-500/10' : 'hover:bg-muted/50',
                                )}
                            >
                                <Text size="sm" className="flex-1 truncate text-foreground">{name}</Text>
                                {isProgram && (
                                    <Badge className="bg-emerald-500/15 text-emerald-300 text-[10px] uppercase tracking-wider">On Air</Badge>
                                )}
                                {isPreview && (
                                    <Badge className="bg-sky-500/15 text-sky-300 text-[10px] uppercase tracking-wider">Preview</Badge>
                                )}
                            </button>
                        );
                    })}
                </Stack>
                <Text size="xs" className="px-1 text-muted-foreground">
                    {studioMode
                        ? 'Click a scene to stage it in Preview, then Take it to Program.'
                        : 'Click a scene to cut it live to Program.'}
                </Text>
            </Stack>
        </Panel>
    );
}

function MainArea({ phase, selection }) {
    const status = useObsStore(s => s.status);

    if (phase !== 'live') {
        const label = PHASES.find(p => p.value === phase)?.label ?? phase;
        return (
            <Panel title="Control" className="h-full">
                <Stack gap="xs" className="items-center justify-center p-12 text-center">
                    <Text className="text-foreground">{label} phase</Text>
                    <Text size="sm" className="text-muted-foreground">
                        v1 ships the Live phase. {label} comes once its elements are built.
                    </Text>
                </Stack>
            </Panel>
        );
    }

    if (status !== 'connected') {
        return (
            <Panel title="Control" className="h-full">
                <Text size="sm" className="p-4 text-muted-foreground">
                    Connect to OBS to control scenes and sources.
                </Text>
            </Panel>
        );
    }

    return (
        <Stack gap="md">
            <SourceControls selection={selection} />
            <SceneControls />
        </Stack>
    );
}

export default function Production() {
    const [phase, setPhase] = useState('live');
    // Selection is a reference { sceneName, id } — the detail panel reads the
    // live item from the store so its toggle reflects OBS reality.
    const [selection, setSelection] = useState(null);
    const onSelect = useCallback((item, sceneName) => setSelection({ sceneName, id: item.id }), []);
    const selectedKey = selection ? `${selection.sceneName}:${selection.id}` : null;

    return (
        <Stack gap="md">
            <Group className="items-center justify-between">
                <Group gap="md" className="items-center">
                    <SegmentedControl data={PHASES} value={phase} onChange={setPhase} />
                </Group>
                <ConnectionPill />
            </Group>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr] items-start">
                <LeftRail selectedKey={selectedKey} onSelect={onSelect} />
                <MainArea phase={phase} selection={selection} />
            </div>
        </Stack>
    );
}
