import { memo, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
    Radio, Eye, EyeOff, Globe, PlugZap, MonitorPlay, ArrowLeftRight, ChevronDown,
} from 'lucide-react';
import { useObsStore } from '../../context/obs';
import { useSettingsStore, useStateStore } from '../../context/store';
import { Panel } from '../../components/ui/panel';
import { Stack, Group, Text } from '../../components/ui/primitives';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Switch } from '../../components/ui/switch';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Popover, PopoverTrigger, PopoverContent } from '../../components/ui/popover';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import { notifications } from '../../lib/notify';
import { cn } from '../../lib/utils';
import { PHASES, ELEMENTS, elementsForPhase } from './elements';

/*
 * Production page — the producer's broadcast control board.
 *
 * Top bar  : phase selector + scene control (program / studio + Take) + OBS pill.
 * Left rail: OBS reality (read) — program + studio-preview scenes and their PRSH
 *            overlay sources.
 * Main area: the ELEMENTS for the selected phase (producer intent). Direct
 *            elements show/hide their dedicated source; fed elements pick a
 *            target shared source, choose content for it (e.g. which player's
 *            stats), and show/hide it.
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

const FLAVOR_BADGE = {
    direct: 'bg-rio-500/15 text-rio-300',
    fed:    'bg-sky-500/15 text-sky-300',
};

// Which element "owns" an OBS source: a fed element pointed at it (override), or
// any element whose layout URL matches the source. Lets the rail surface the
// same option layer the chips do.
function elementForSource(item, overrides) {
    const url = item.url || '';
    for (const el of ELEMENTS) {
        if (el.flavor === 'fed' && overrides?.[el.id] && overrides[el.id] === item.sourceName) return el;
        if (el.match(url)) return el;
    }
    return null;
}

// Rail row — the eye toggles visibility directly; clicking the name opens the
// owning element's option layer (content picker, etc.). The rail is still OBS
// truth, but now it's a control surface too.
const SourceRow = memo(function SourceRow({ item, sceneName }) {
    const setSceneItemEnabled = useObsStore(s => s.setSceneItemEnabled);
    const overrides = useSettingsStore(s => s?.production?.overrides);
    const element = useMemo(() => elementForSource(item, overrides), [item, overrides]);
    const EyeIcon = item.enabled ? Eye : EyeOff;

    const nameText = <Text size="sm" className="min-w-0 flex-1 truncate text-left text-foreground">{item.sourceName}</Text>;

    return (
        <div className={cn('flex items-center gap-2 px-2 py-1.5', !item.enabled && 'opacity-50')}>
            <SimpleTooltip label={item.enabled ? 'Hide source' : 'Show source'}>
                <button
                    type="button"
                    onClick={() => runObs(() => setSceneItemEnabled(sceneName, item.id, !item.enabled))}
                    className={cn('shrink-0', item.enabled ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                    <EyeIcon size={14} />
                </button>
            </SimpleTooltip>
            <Globe size={13} className="shrink-0 text-rio-400" />
            {element ? (
                <Popover>
                    <PopoverTrigger asChild>
                        <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left hover:text-foreground">
                            {nameText}
                            <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-72">
                        <Stack gap="sm">
                            <Group gap="xs" className="items-center">
                                <Badge className={cn('text-[10px] uppercase tracking-wider', FLAVOR_BADGE[element.flavor])}>
                                    {element.flavor}
                                </Badge>
                                <Text size="sm" className="text-foreground">{element.name}</Text>
                            </Group>
                            <ElementOptions element={element} hideTarget hideVisibility />
                        </Stack>
                    </PopoverContent>
                </Popover>
            ) : nameText}
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
                        {prshItems.map(it => <SourceRow key={it.id} item={it} sceneName={sceneName} />)}
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

// Content picker for a 'stats' fed element: choose WHICH roster character's
// stats to put on the shared overlay. The pick is written to live State at
// `production.feed.stats`; public/layout/shared/stats-feed.html renders it.
// Scoreboard 1 for now (matches the default overlay binding); multi-scoreboard
// is a later concern.
function StatsFeedPicker({ scoreboard = 1 }) {
    const players = useStateStore(s => s?.score?.[scoreboard]?.player);
    const selection = useStateStore(s => s?.production?.feed?.stats);

    // Build per-team option groups from the live roster (9 slots each).
    const teams = useMemo(() => {
        const out = [];
        for (const team of [1, 2]) {
            const p = players?.[team];
            const chars = [];
            for (let i = 0; i < 9; i++) {
                const name = p?.character?.[i]?.name;
                if (name) chars.push({ charIndex: i, name });
            }
            if (chars.length) {
                out.push({ team, label: p?.msb_team || p?.rioName || `Team ${team}`, chars });
            }
        }
        return out;
    }, [players]);

    const isThisSb = selection && (selection.scoreboard == null || selection.scoreboard === scoreboard);
    const role = (isThisSb && selection.role) || 'batting';
    const selValue = isThisSb ? `${selection.team}:${selection.charIndex}` : '';

    // Write via the *batch* store actions: only set_batch / unset_batch have
    // server-side socket handlers (there's no v1.state.set handler), so a
    // single setItem/deleteItem would never reach the server or the overlay.
    const feed = (team, charIndex, r) =>
        useStateStore.getState().setItems([
            { key: 'production.feed.stats', value: { scoreboard, team, charIndex, role: r } },
        ]);
    const choose = (value) => {
        if (!value) { useStateStore.getState().deleteItems(['production.feed.stats']); return; }
        const [team, charIndex] = value.split(':').map(Number);
        feed(team, charIndex, role);
    };
    const setRole = (r) => {
        if (!selValue) return;
        const [team, charIndex] = selValue.split(':').map(Number);
        feed(team, charIndex, r);
    };

    if (teams.length === 0) {
        return (
            <Text size="sm" className="text-muted-foreground">
                No roster in live state yet — start or load a game on scoreboard {scoreboard}.
            </Text>
        );
    }

    return (
        <Stack gap="xs">
            <label className="flex flex-col gap-1">
                <Text size="xs" className="text-muted-foreground">Content — whose stats to show</Text>
                <select
                    value={selValue}
                    onChange={(e) => choose(e.target.value)}
                    className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
                >
                    <option value="">Nothing fed</option>
                    {teams.map(t => (
                        <optgroup key={t.team} label={t.label}>
                            {t.chars.map(c => (
                                <option key={c.charIndex} value={`${t.team}:${c.charIndex}`}>{c.name}</option>
                            ))}
                        </optgroup>
                    ))}
                </select>
            </label>
            {selValue && (
                <SegmentedControl
                    data={[{ label: 'Batting', value: 'batting' }, { label: 'Pitching', value: 'pitching' }]}
                    value={role}
                    onChange={setRole}
                />
            )}
        </Stack>
    );
}

// PRSH overlay sources in the current program scene.
function usePrshItems() {
    const programScene = useObsStore(s => s.programScene);
    const sceneItems = useObsStore(s => s.sceneItems);
    return useMemo(
        () => (programScene ? (sceneItems[programScene] || []).filter(i => i.isPrsh) : []),
        [programScene, sceneItems],
    );
}

// The OBS source an element currently drives, or null. Direct: the URL match.
// Fed: the override target, else the default URL match.
function boundSource(element, items, overrideName) {
    if (element.flavor === 'direct') return items.find(it => element.match(it.url || '')) || null;
    const defaultName = items.find(it => element.match(it.url || ''))?.sourceName;
    const targetName = overrideName || defaultName || '';
    return items.find(it => it.sourceName === targetName) || null;
}

// Show/hide an OBS source.
function VisibilityRow({ label, sub, item, sceneName }) {
    const setSceneItemEnabled = useObsStore(s => s.setSceneItemEnabled);
    return (
        <label className="flex items-center justify-between gap-3">
            <Stack gap="none">
                <Text size="sm" className="text-foreground">{label}</Text>
                {sub && <Text size="xs" className="text-muted-foreground">{sub}</Text>}
            </Stack>
            <Switch
                checked={item.enabled}
                onCheckedChange={(v) => runObs(() => setSceneItemEnabled(sceneName, item.id, v))}
            />
        </label>
    );
}

// The shared option layer for an element — rendered both in the chip's
// expanding panel (full) and in the rail source popover (content only, via
// hideTarget/hideVisibility since the eye already toggles visibility there).
// Newer, richer elements add their controls here and get both surfaces free.
function ElementOptions({ element, hideTarget = false, hideVisibility = false }) {
    const programScene = useObsStore(s => s.programScene);
    const overrideName = useSettingsStore(s => s?.production?.overrides?.[element.id]);
    const setSetting = useSettingsStore(s => s.setItem);
    const items = usePrshItems();

    if (element.flavor === 'direct') {
        const match = items.find(it => element.match(it.url || ''));
        if (!match) {
            return (
                <Text size="sm" className="text-muted-foreground">
                    No matching source in the current program scene ({programScene || 'none'}).
                </Text>
            );
        }
        if (hideVisibility) {
            return <Text size="xs" className="text-muted-foreground">On {match.sourceName}. No content options.</Text>;
        }
        return <VisibilityRow label="On the broadcast" sub={`${match.sourceName} · ${programScene}`} item={match} sceneName={programScene} />;
    }

    // Fed element.
    const defaultName = items.find(it => element.match(it.url || ''))?.sourceName;
    const targetName = overrideName || defaultName || '';
    const targetItem = items.find(it => it.sourceName === targetName);
    const setTarget = (name) => {
        const cur = useSettingsStore.getState()?.production?.overrides || {};
        setSetting('production.overrides', { ...cur, [element.id]: name });
    };

    return (
        <Stack gap="md">
            {!hideTarget && (
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
            )}

            {!hideVisibility && (targetItem ? (
                <VisibilityRow label="Feed to target" sub={`Shows ${targetItem.sourceName} · ${programScene}`} item={targetItem} sceneName={programScene} />
            ) : (
                <Text size="sm" className="text-muted-foreground">
                    {targetName
                        ? `“${targetName}” isn’t in the current program scene.`
                        : 'Pick a target shared source to feed.'}
                </Text>
            ))}

            {element.feed === 'stats' ? (
                <StatsFeedPicker />
            ) : (
                <Text size="xs" className="text-muted-foreground">No content options for this element yet.</Text>
            )}
        </Stack>
    );
}

// A compact element chip. Glows when its source is on air; dashed when no
// source is bound. Clicking toggles the inline options panel below the row.
function ElementChip({ element, open, onToggle }) {
    const overrideName = useSettingsStore(s => s?.production?.overrides?.[element.id]);
    const items = usePrshItems();
    const bound = boundSource(element, items, overrideName);
    const state = !bound ? 'unbound' : bound.enabled ? 'live' : 'idle';

    const tone = state === 'live'
        ? 'border-emerald-500/60 bg-emerald-500/10 text-foreground'
        : state === 'idle'
            ? 'border-border bg-card text-foreground hover:bg-accent'
            : 'border-dashed border-border bg-card text-muted-foreground';
    const dot = state === 'live'
        ? 'bg-emerald-400'
        : state === 'idle'
            ? 'bg-muted-foreground'
            : 'border border-muted-foreground';

    return (
        <button
            type="button"
            onClick={onToggle}
            className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
                tone,
                open && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
            )}
        >
            <span className={cn('size-2 shrink-0 rounded-full', dot)} />
            <span className="truncate">{element.name}</span>
            <Badge className={cn('text-[9px] uppercase tracking-wider', FLAVOR_BADGE[element.flavor])}>
                {element.flavor}
            </Badge>
            <ChevronDown size={13} className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
    );
}

function ElementsArea({ phase }) {
    const status = useObsStore(s => s.status);
    const els = elementsForPhase(phase);
    const phaseLabel = PHASES.find(p => p.value === phase)?.label ?? phase;
    const [openId, setOpenId] = useState(null);

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

    const openEl = els.find(e => e.id === openId) || null;

    return (
        <Stack gap="md">
            <Panel title="Elements">
                <div className="flex flex-wrap gap-2 p-4">
                    {els.map(el => (
                        <ElementChip
                            key={el.id}
                            element={el}
                            open={openId === el.id}
                            onToggle={() => setOpenId(id => (id === el.id ? null : el.id))}
                        />
                    ))}
                </div>
            </Panel>

            {openEl && (
                <Panel
                    title={openEl.name}
                    actions={
                        <Badge className={cn('text-[10px] uppercase tracking-wider', FLAVOR_BADGE[openEl.flavor])}>
                            {openEl.flavor}
                        </Badge>
                    }
                >
                    <div className="p-4">
                        <ElementOptions element={openEl} />
                    </div>
                </Panel>
            )}
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
