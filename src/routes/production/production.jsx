import { memo, useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
    Radio, Eye, EyeOff, Globe, PlugZap, MonitorPlay, Tv,
} from 'lucide-react';
import { useObsStore } from '../../context/obs';
import { Panel } from '../../components/ui/panel';
import { Stack, Group, Text } from '../../components/ui/primitives';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { ScrollArea } from '../../components/ui/scroll-area';
import { cn } from '../../lib/utils';

/*
 * Production page — the producer's broadcast control board (v1, Live phase).
 *
 * v1 is read-only: the left rail mirrors OBS's scene/source reality (program +
 * studio preview) via the OBS WebSocket. The main area is a placeholder until
 * the control + element-authoring slices land. See memory:
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

const SourceRow = memo(function SourceRow({ item, selected, onSelect }) {
    const EyeIcon = item.enabled ? Eye : EyeOff;
    return (
        <button
            type="button"
            onClick={() => onSelect(item)}
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

const SceneGroup = memo(function SceneGroup({ icon: Icon, label, accent, sceneName, items, selectedId, onSelect }) {
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
                                selected={selectedId === it.id}
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

function LeftRail({ selected, onSelect }) {
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
                        selectedId={selected?.id} onSelect={onSelect}
                    />
                    {studioMode ? (
                        <SceneGroup
                            icon={MonitorPlay} label="Studio Preview" accent="text-sky-400"
                            sceneName={previewScene} items={previewItems}
                            selectedId={selected?.id} onSelect={onSelect}
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

function MainArea({ phase, selected }) {
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

    if (!selected) {
        return (
            <Panel title="Control" className="h-full">
                <Stack gap="xs" className="items-center justify-center p-12 text-center">
                    <Tv size={28} className="text-muted-foreground" />
                    <Text className="text-foreground">Select a source from the rail</Text>
                    <Text size="sm" className="max-w-[40ch] text-muted-foreground">
                        This area becomes the control surface for generic sources (which stats,
                        which replay) and element authoring in the next slices. For now it inspects
                        the selected OBS source.
                    </Text>
                </Stack>
            </Panel>
        );
    }

    return (
        <Panel title={`Control — ${selected.sourceName}`} className="h-full">
            <Stack gap="md" className="p-4">
                <Group gap="xl">
                    <Stack gap="none">
                        <Text size="xs" className="text-muted-foreground">Visible</Text>
                        <Text size="sm" className="text-foreground">{selected.enabled ? 'Yes' : 'No'}</Text>
                    </Stack>
                </Group>
                {selected.url && (
                    <Stack gap="none">
                        <Text size="xs" className="text-muted-foreground">Overlay URL</Text>
                        <Text size="sm" className="break-all text-foreground">{selected.url}</Text>
                    </Stack>
                )}
                <Text size="sm" className="text-muted-foreground">
                    Firing and content control land in the next slice — the OBS WebSocket layer
                    that powers this rail is what those build on.
                </Text>
            </Stack>
        </Panel>
    );
}

export default function Production() {
    const [phase, setPhase] = useState('live');
    const [selected, setSelected] = useState(null);
    const onSelect = useCallback((item) => setSelected(item), []);

    return (
        <Stack gap="md">
            <Group className="items-center justify-between">
                <Group gap="md" className="items-center">
                    <SegmentedControl data={PHASES} value={phase} onChange={setPhase} />
                </Group>
                <ConnectionPill />
            </Group>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr] items-start">
                <LeftRail selected={selected} onSelect={onSelect} />
                <MainArea phase={phase} selected={selected} />
            </div>
        </Stack>
    );
}
