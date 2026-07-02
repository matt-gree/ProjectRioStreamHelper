import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
    Radio, Eye, EyeOff, Globe, PlugZap, MonitorPlay, ArrowLeftRight, ChevronDown,
    RotateCcw, Sparkles, Columns2, Settings, Captions, GripVertical, Plus, X,
    Trophy, Trash2, CircleDot,
} from 'lucide-react';
import { useObsStore } from '../../context/obs';
import { useSettingsStore, useStateStore } from '../../context/store';
import {
    setCommentarySlots, SUBFIELD_OPTIONS, MAX_COMMENTATORS,
} from '../../context/commentary';
import {
    useStagingStore, stageOrRun, usePending, commitPending, eventMatchesHotkey,
} from '../../context/staging';
import ParticipantPicker from '../../components/ParticipantPicker';
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
import { PHASES, ELEMENTS, elementsForPhase, packRows } from './elements';

/*
 * Production page — the producer's broadcast control board.
 *
 * Top bar  : phase selector + scene control (program / studio + Take) + OBS pill.
 * Left rail: OBS reality (read) — program + studio-preview scenes and their PRSH
 *            overlay sources.
 * Main area: the ELEMENTS for the selected phase (producer intent), packed into
 *            rows that tile the full 12-column width (see packRows). Direct
 *            elements show/hide their dedicated source; fed elements pick a
 *            target shared source, choose content for it (e.g. which player's
 *            stats), and show/hide it.
 *
 * Confirm-to-live: when settings.production.confirm.enabled is on, element
 * mutations here (visibility, feeds, content) are STAGED via stageOrRun()
 * (src/context/staging.js) and only executed when the producer commits — the
 * configured hotkey or the Go Live button on the pending bar. Momentary
 * "fire now" actions (scene switches, Take, replay, spotlight, clock
 * start/pause, post-game capture) always run immediately.
 *
 * Elements bind to OBS sources by URL match in the PROGRAM scene first, then
 * the STUDIO PREVIEW scene — so an element staged in preview is still visible
 * and controllable here (sky status dot) before it is ever taken to air.
 *
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
// Always immediate — scene transport is the producer's manual "fire" surface,
// never staged.
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

// ── Staged mutation helpers ────────────────────────────────────────────────

// Toggle an OBS source's visibility through the confirm-to-live buffer. The
// pending key is the (scene, item) pair, so flipping the same switch twice
// cancels out (liveValue match drops the entry).
function setSourceVisibility(sceneName, item, enabled) {
    stageOrRun({
        key: `obs:${sceneName}:${item.id}`,
        label: `${enabled ? 'Show' : 'Hide'} ${item.sourceName}`,
        value: enabled,
        liveValue: item.enabled,
        run: () => useObsStore.getState().setSceneItemEnabled(sceneName, item.id, enabled),
    });
}

// What a visibility control should DISPLAY for a source: the staged value if
// one is pending, else OBS truth — plus the staged flag for amber styling.
function useDisplayedEnabled(sceneName, item) {
    const pending = usePending(item ? `obs:${sceneName}:${item.id}` : '∅');
    if (!item) return { enabled: false, staged: false };
    return { enabled: pending ? pending.value : item.enabled, staged: !!pending };
}

// Stage (or run) a single live-state write.
function stageStateSet(stateKey, value, label) {
    stageOrRun({
        key: `state:${stateKey}`,
        label: label || stateKey,
        value,
        run: () => useStateStore.getState().setItems([{ key: stateKey, value }]),
    });
}

// Amber "staged, not live yet" marker rendered next to pending controls.
function StagedDot({ show }) {
    if (!show) return null;
    return (
        <SimpleTooltip label="Staged — goes live on confirm">
            <span className="inline-block size-1.5 shrink-0 rounded-full bg-amber-400" />
        </SimpleTooltip>
    );
}

// Show/hide an OBS source (staging-aware).
function VisibilityRow({ label, sub, item, sceneName }) {
    const { enabled, staged } = useDisplayedEnabled(sceneName, item);
    return (
        <label className="flex items-center justify-between gap-3">
            <Stack gap="none">
                <Group gap="xs" className="items-center">
                    <Text size="sm" className="text-foreground">{label}</Text>
                    <StagedDot show={staged} />
                </Group>
                {sub && <Text size="xs" className="text-muted-foreground">{sub}</Text>}
            </Stack>
            <Switch
                checked={enabled}
                onCheckedChange={(v) => setSourceVisibility(sceneName, item, v)}
            />
        </label>
    );
}

// ── OBS binding (program + studio preview) ─────────────────────────────────

// The scenes an element may bind into, in priority order: program first, then
// the studio-preview scene (when Studio Mode is on). Items are pre-filtered to
// PRSH overlays.
function useBindingScenes() {
    const { studioMode, programScene, previewScene, sceneItems } = useObsStore(useShallow(s => ({
        studioMode: s.studioMode,
        programScene: s.programScene,
        previewScene: s.previewScene,
        sceneItems: s.sceneItems,
    })));
    return useMemo(() => {
        const out = [];
        if (programScene) {
            out.push({
                scene: programScene, where: 'program',
                items: (sceneItems[programScene] || []).filter(i => i.isPrsh),
            });
        }
        if (studioMode && previewScene && previewScene !== programScene) {
            out.push({
                scene: previewScene, where: 'preview',
                items: (sceneItems[previewScene] || []).filter(i => i.isPrsh),
            });
        }
        return out;
    }, [studioMode, programScene, previewScene, sceneItems]);
}

// The OBS source an element drives within one scene's items, or null.
// Direct: the URL match. Fed: the override target, else the default URL match.
function boundIn(element, items, overrideName) {
    if (element.flavor === 'direct') return items.find(it => element.match(it.url || '')) || null;
    const defaultName = items.find(it => element.match(it.url || ''))?.sourceName;
    const targetName = overrideName || defaultName || '';
    return items.find(it => it.sourceName === targetName) || null;
}

// Where an element's source lives across program + preview. `primary` is the
// binding its controls act on (program wins); program/preview expose per-scene
// presence for the status dot.
function useElementBindings(element) {
    const overrideName = useSettingsStore(s => s?.production?.overrides?.[element.id]);
    const scenes = useBindingScenes();
    return useMemo(() => {
        let program = null, preview = null;
        for (const sc of scenes) {
            const item = boundIn(element, sc.items, overrideName);
            if (!item) continue;
            const b = { item, scene: sc.scene, where: sc.where };
            if (sc.where === 'program') program = b; else preview = b;
        }
        return { program, preview, primary: program || preview };
    }, [scenes, element, overrideName]);
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

// Rail row — the eye toggles visibility (staged under confirm mode); clicking
// the name opens the owning element's option layer (content picker, etc.). The
// rail is still OBS truth, but now it's a control surface too.
const SourceRow = memo(function SourceRow({ item, sceneName }) {
    const overrides = useSettingsStore(s => s?.production?.overrides);
    const element = useMemo(() => elementForSource(item, overrides), [item, overrides]);
    const { enabled, staged } = useDisplayedEnabled(sceneName, item);
    const EyeIcon = enabled ? Eye : EyeOff;

    const nameText = <Text size="sm" className="min-w-0 flex-1 truncate text-left text-foreground">{item.sourceName}</Text>;

    return (
        <div className={cn('flex items-center gap-2 px-2 py-1.5', !enabled && 'opacity-50')}>
            <SimpleTooltip label={staged ? 'Staged — goes live on confirm' : enabled ? 'Hide source' : 'Show source'}>
                <button
                    type="button"
                    onClick={() => setSourceVisibility(sceneName, item, !enabled)}
                    className={cn(
                        'shrink-0',
                        staged ? 'text-amber-400' : enabled ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
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

// ── Fed elements: containers + feeds ───────────────────────────────────────

// A named shared container's stable id = its layout filename stem (e.g.
// '/layout/shared/split-screen.html' → 'split-screen'). The producer feeds an
// element into a container by writing production.feed.container.<id>; the
// matching shared overlay reads the same key.
function containerId(url) {
    return (url || '').replace(/^.*\/([^/]+)\.html?(?:\?.*)?$/, '$1');
}

// An element's default named container = the stem of its canonical layout URL
// (Stats → 'stats-feed', Stat Callout → 'callout-stage'). The producer can still
// re-point it to any other shared container in the gear.
function defaultContainerFor(element) {
    return containerId(element.url) || 'stats-feed';
}

// The named shared containers (public/layout/shared/*) an element can be fed
// into — Split-Screen, Stats, and any the user adds later. Sourced from the
// layout catalog, independent of OBS scene membership.
function useSharedContainers() {
    const [list, setList] = useState([]);
    useEffect(() => {
        let alive = true;
        fetch('/api/v1/layouts')
            .then(r => r.json())
            .then(all => { if (alive) setList(all.filter(l => l.group === 'shared').map(l => ({ id: containerId(l.url), name: l.name }))); })
            .catch(() => {});
        return () => { alive = false; };
    }, []);
    return list;
}

// One container's feed, staged. `value` is what controls display (the pending
// pick if any, else the live feed — and a pending pick may legitimately be
// null, i.e. a staged clear). setFeed(null) clears.
function useFeedControl(container) {
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
// settings.production.containers.<elementId>. The target itself is gear config
// (immediate), but releasing the old container's feed is broadcast-visible, so
// that goes through the staging gateway.
function useContainerTarget(elementId, defaultId) {
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

// The OBS source rendering a named container, if it's in program or preview.
// Matched by the container id appearing in the source URL's filename.
function useContainerBinding(container) {
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

// Content picker for the 'stats' fed element: choose WHICH roster character's
// stats to put on the chosen shared container. Picking IS feeding — the pick is
// written (through the staging gateway) to `production.feed.container.<id>` =
// { element:'stats', … }, which the container overlay renders. Scoreboard 1 for
// now; multi-scoreboard is later.
function StatsFeedPicker({ element, scoreboard = 1 }) {
    const { container } = useContainerTarget(element.id, defaultContainerFor(element));
    const { value: selection, staged, setFeed } = useFeedControl(container);
    const players = useStateStore(s => s?.score?.[scoreboard]?.player);

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

    const mine = selection && selection.element === 'stats'
        && (selection.scoreboard == null || selection.scoreboard === scoreboard);
    const role = (mine && selection.role) || 'batting';
    const selValue = mine ? `${selection.team}:${selection.charIndex}` : '';

    const nameOf = (team, charIndex) =>
        teams.find(t => t.team === team)?.chars.find(c => c.charIndex === charIndex)?.name || 'stats';
    const feed = (team, charIndex, r) =>
        setFeed({ element: 'stats', scoreboard, team, charIndex, role: r }, `Feed stats: ${nameOf(team, charIndex)}`);
    const choose = (value) => {
        if (!value) { setFeed(null); return; }
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
                <Group gap="xs" className="items-center">
                    <Text size="xs" className="text-muted-foreground">Content — whose stats to show</Text>
                    <StagedDot show={staged} />
                </Group>
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

// Content picker for the 'postgamecallout' fed element: choose WHICH finished-game
// roster character gets the full-screen stat callout. Reads the Phase-6 capture at
// postgame.{N}.player.{T}.characters[]; picking writes (through the staging
// gateway) production.feed.container.<id> = { element:'postgamecallout',
// scoreboard, team, charIndex }, which the callout-stage container renders.
function PostgameCalloutPicker({ element, scoreboard = 1 }) {
    const { container } = useContainerTarget(element.id, defaultContainerFor(element));
    const { value: selection, staged, setFeed } = useFeedControl(container);
    const present = useStateStore(s => s?.postgame?.[scoreboard]?.present);
    const players = useStateStore(useShallow(s => ({
        1: s?.postgame?.[scoreboard]?.player?.[1],
        2: s?.postgame?.[scoreboard]?.player?.[2],
    })));

    // Per-side option groups from the captured box score (9 roster slots each).
    const teams = useMemo(() => {
        const out = [];
        for (const team of [1, 2]) {
            const p = players?.[team];
            const chars = Array.isArray(p?.characters) ? p.characters : [];
            const opts = chars
                .map((c, i) => ({ charIndex: i, name: c?.name, isPitcher: c?.wasPitcher }))
                .filter(c => c.name);
            if (opts.length) out.push({ team, label: p?.rioName || `Side ${team}`, chars: opts });
        }
        return out;
    }, [players]);

    const mine = selection && selection.element === 'postgamecallout'
        && (selection.scoreboard == null || selection.scoreboard === scoreboard);
    const selValue = mine ? `${selection.team}:${selection.charIndex}` : '';

    const choose = (value) => {
        if (!value) { setFeed(null); return; }
        const [team, charIndex] = value.split(':').map(Number);
        const name = teams.find(t => t.team === team)?.chars.find(c => c.charIndex === charIndex)?.name || 'callout';
        setFeed({ element: 'postgamecallout', scoreboard, team, charIndex }, `Feed callout: ${name}`);
    };

    if (!present || teams.length === 0) {
        return (
            <Text size="sm" className="text-muted-foreground">
                No captured game on scoreboard {scoreboard} yet — capture a finished game first
                (the callout reads its box score).
            </Text>
        );
    }

    return (
        <Stack gap="xs">
            <label className="flex flex-col gap-1">
                <Group gap="xs" className="items-center">
                    <Text size="xs" className="text-muted-foreground">Content — whose callout to show</Text>
                    <StagedDot show={staged} />
                </Group>
                <select
                    value={selValue}
                    onChange={(e) => choose(e.target.value)}
                    className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
                >
                    <option value="">Nothing fed</option>
                    {teams.map(t => (
                        <optgroup key={t.team} label={t.label}>
                            {t.chars.map(c => (
                                <option key={c.charIndex} value={`${t.team}:${c.charIndex}`}>
                                    {c.name}{c.isPitcher ? ' (P)' : ''}
                                </option>
                            ))}
                        </optgroup>
                    ))}
                </select>
            </label>
            {selValue && (
                <Text size="xs" className="text-muted-foreground">
                    Show the callout-stage source on air; re-pick to swap the featured character.
                </Text>
            )}
        </Stack>
    );
}

// ── Hit Visualizer ─────────────────────────────────────────────────────────

// Lead time before the swing starts after we cut to the spotlight scene — lets
// OBS's active transition settle so the contact isn't hidden behind a fade.
const SPOTLIGHT_LEAD_MS = 350;
// Module-scoped so the return-to-previous-scene still fires even if the chip
// panel closes mid-spotlight. Also doubles as the single-flight guard.
let _spotlightTimer = null;

// Hit-visualizer behavior shared by its condensed face and its gear setup.
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

// Condensed face: the live actions only — Replay in place, Spotlight (cut to the
// configured scene), and Split (toggle the split-screen feed). Setup lives in the
// gear popover (HitVizSetup).
function HitVizFace({ scoreboard = 1 }) {
    const v = useHitViz(scoreboard);
    return (
        <Stack gap="xs">
            <Text size="xs" className="truncate text-muted-foreground">
                {v.hasHit
                    ? `Latest: ${v.hit.batter || '—'}${v.hit.result ? ` · ${v.hit.result}` : ''}${v.hit.distance != null ? ` · ${v.hit.distance}m` : ''}`
                    : 'No hit captured yet'}
            </Text>
            {v.hit && v.hit.valid === false && v.hit.warning && (
                <Text size="xs" className="truncate text-amber-500" title={v.hit.warning}>⚠ Sim diverges</Text>
            )}
            <Button size="xs" variant="secondary" disabled={!v.hasHit} onClick={v.replay} className="w-full">
                <RotateCcw size={13} className="mr-1" /> Replay
            </Button>
            <Group gap="xs" className="flex-nowrap">
                <SimpleTooltip label={v.canSpotlight ? 'Cut to the spotlight scene and play' : 'Enable + pick a scene in ⚙'}>
                    <Button size="xs" disabled={!v.canSpotlight || v.firing} onClick={v.fireSpotlight} className="min-w-0 flex-1">
                        <Sparkles size={13} className="mr-1 shrink-0" />
                        <span className="truncate">{v.firing ? 'On air…' : 'Spotlight'}</span>
                    </Button>
                </SimpleTooltip>
                <SimpleTooltip
                    label={v.feedStaged
                        ? 'Staged — goes live on confirm'
                        : v.fedHere ? 'Fed to a shared container — click to clear' : 'Feed to a shared container'}
                >
                    <Button
                        size="xs"
                        variant={v.fedHere ? 'default' : 'secondary'}
                        disabled={!v.hasHit && !v.fedHere}
                        onClick={v.fedHere ? v.clearContainer : v.feedContainer}
                        className={cn('shrink-0', v.feedStaged && 'ring-1 ring-amber-400')}
                    >
                        <Columns2 size={13} />
                    </Button>
                </SimpleTooltip>
            </Group>
        </Stack>
    );
}

// Gear setup — all the config, slim. Overlay visibility on air, the spotlight
// auto-cut (enable · scene · hold), and which container slot the Feed button uses.
function HitVizSetup({ scoreboard = 1 }) {
    const v = useHitViz(scoreboard);
    const containers = useSharedContainers();
    const element = ELEMENTS.find(e => e.id === 'hitvisualizer');
    const { primary } = useElementBindings(element);

    const fieldCls = 'h-7 rounded-md border border-border bg-card px-2 text-xs text-foreground';
    const labelCls = 'w-20 shrink-0 text-muted-foreground';

    return (
        <Stack gap="sm">
            {/* On-air visibility of the dedicated overlay. */}
            {primary ? (
                <VisibilityRow
                    label={primary.where === 'preview' ? 'In preview' : 'On air'}
                    item={primary.item} sceneName={primary.scene}
                />
            ) : (
                <Text size="xs" className="text-muted-foreground">Overlay not in program or preview scene.</Text>
            )}

            {/* Spotlight auto-cut. */}
            <div className="border-t border-border pt-2">
                <label className="flex items-center justify-between gap-2">
                    <Text size="xs" className="text-muted-foreground">Spotlight auto-cut</Text>
                    <Switch size="sm" checked={!!v.spotlight.enabled} onCheckedChange={(c) => v.setSpot({ enabled: c })} />
                </label>
                {v.spotlight.enabled && (
                    <Stack gap="xs" className="mt-2">
                        <div className="flex items-center gap-2">
                            <Text size="xs" className={labelCls}>Scene</Text>
                            <select
                                value={v.spotlight.scene || ''}
                                onChange={(e) => v.setSpot({ scene: e.target.value })}
                                className={cn(fieldCls, 'min-w-0 flex-1')}
                            >
                                <option value="" disabled>{v.obsConnected ? 'Choose…' : 'Connect OBS'}</option>
                                {v.scenes.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div className="flex items-center gap-2">
                            <Text size="xs" className={labelCls}>Hold (ms)</Text>
                            <input
                                type="number" min="0" step="250"
                                value={v.spotlight.holdMs ?? 1500}
                                onChange={(e) => v.setSpot({ holdMs: Number(e.target.value) })}
                                className={cn(fieldCls, 'w-20')}
                            />
                        </div>
                    </Stack>
                )}
            </div>

            {/* Named-container feed: which shared container the Feed button uses. */}
            <div className="border-t border-border pt-2">
                <div className="flex items-center gap-2">
                    <Text size="xs" className={labelCls}>Feed into</Text>
                    <select
                        value={v.container}
                        onChange={(e) => v.setContainer(e.target.value)}
                        className={cn(fieldCls, 'min-w-0 flex-1')}
                    >
                        {containers.length === 0 && <option value={v.container}>Split-Screen</option>}
                        {containers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                <Button size="xs" variant="ghost" disabled={!v.fedHere} onClick={v.clearContainer} className="mt-1 w-full">
                    Clear feed
                </Button>
            </div>
        </Stack>
    );
}

// ── Commentary ─────────────────────────────────────────────────────────────

const blankCasterSlot = () => ({ participantId: null, subField: '', visible: true, subVisible: true });

// The commentary desk as the Production page works with it: the staged draft
// slots array when one is pending, else the live authored slots. Every edit
// computes the whole next array and stages ONE entry (key 'commentary') whose
// commit is the whole-array PUT — matching the server API, and keeping
// add/remove/reorder/edit trivially stageable. `_name` is a client-only display
// tag for staged picks (the projector hasn't resolved them yet) and is stripped
// before the PUT.
function useCommentaryDesk() {
    const commentary = useStateStore(s => s.commentary);
    const liveSlots = useMemo(
        () => (Array.isArray(commentary?.slots) ? commentary.slots : []),
        [commentary],
    );
    const pending = usePending('commentary');
    const slots = pending ? pending.value : liveSlots;

    // participantId → resolved display name, from the server-side projection of
    // the LIVE slots (staged drafts may be reordered, so index lookups lie).
    const nameById = useMemo(() => {
        const out = {};
        liveSlots.forEach((s, i) => {
            const n = commentary?.[i]?.name ?? commentary?.[String(i)]?.name;
            if (s?.participantId && n) out[s.participantId] = n;
        });
        return out;
    }, [commentary, liveSlots]);
    const nameFor = (slot) => slot?._name || (slot?.participantId && nameById[slot.participantId]) || '';

    const setSlots = (next) => stageOrRun({
        key: 'commentary',
        label: 'Commentary desk',
        value: next,
        run: () => setCommentarySlots(next.map(({ _name, ...s }) => s)),
    });

    return {
        slots, staged: !!pending, nameFor,
        update: (i, patch) => setSlots(slots.map((s, j) => (j === i ? { ...s, ...patch } : s))),
        add: () => { if (slots.length < MAX_COMMENTATORS) setSlots([...slots, blankCasterSlot()]); },
        remove: (i) => setSlots(slots.filter((_, j) => j !== i)),
        reorder: (from, to) => {
            if (from === to || from < 0 || to < 0 || from >= slots.length || to >= slots.length) return;
            const next = slots.slice();
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            setSlots(next);
        },
    };
}

// Condensed Commentary face — ONE row per caster: grip (drag to reorder) ·
// on-air eye · person picker · sub-plate field · sub-plate toggle · remove.
// The in-depth roster authoring (contact fields, socials) lives on the
// Commentary tab; this face covers the live decisions. Native HTML5 drag,
// armed only by the grip handle so the selects/picker stay interactive.
function CommentaryFace() {
    const desk = useCommentaryDesk();
    const [dragIndex, setDragIndex] = useState(null);
    const [overIndex, setOverIndex] = useState(null);
    const [dragArmed, setDragArmed] = useState(false);

    const onDrop = (to) => {
        if (dragIndex != null && dragIndex !== to) desk.reorder(dragIndex, to);
        setDragIndex(null); setOverIndex(null); setDragArmed(false);
    };

    return (
        <Stack gap="xs">
            {desk.staged && (
                <Group gap="xs" className="items-center">
                    <StagedDot show />
                    <Text size="xs" className="text-amber-400">Desk changes staged</Text>
                </Group>
            )}
            {desk.slots.length === 0 && (
                <Text size="xs" className="text-muted-foreground">No commentators yet — add one below.</Text>
            )}

            {desk.slots.map((slot, i) => {
                const visible = slot.visible !== false;
                const subVisible = slot.subVisible !== false;
                return (
                    <div
                        key={i}
                        draggable={dragArmed}
                        onDragStart={() => setDragIndex(i)}
                        onDragOver={(e) => { e.preventDefault(); if (overIndex !== i) setOverIndex(i); }}
                        onDrop={() => onDrop(i)}
                        onDragEnd={() => { setDragIndex(null); setOverIndex(null); setDragArmed(false); }}
                        className={cn(
                            'flex items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-1.5 py-1',
                            dragIndex === i && 'opacity-50',
                            overIndex === i && dragIndex !== i && 'border-rio-400',
                        )}
                    >
                        <button
                            type="button"
                            onMouseDown={() => setDragArmed(true)}
                            onMouseUp={() => setDragArmed(false)}
                            className="shrink-0 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
                            title="Drag to reorder"
                        >
                            <GripVertical size={14} />
                        </button>
                        <SimpleTooltip label={visible ? 'On air — click to hide' : 'Hidden — click to show'}>
                            <button
                                type="button"
                                onClick={() => desk.update(i, { visible: !visible })}
                                className={cn('shrink-0', visible ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
                            >
                                {visible ? <Eye size={14} /> : <EyeOff size={14} />}
                            </button>
                        </SimpleTooltip>
                        <div className={cn('min-w-0 flex-1', !visible && 'opacity-50')}>
                            <ParticipantPicker
                                value={desk.nameFor(slot)}
                                selectedId={slot.participantId || null}
                                onResolve={(picked) => desk.update(i, {
                                    participantId: picked.id,
                                    _name: picked.display?.tag || picked.identities?.rioName || '',
                                })}
                                placeholder="Pick person…"
                            />
                        </div>
                        <select
                            value={slot.subField || ''}
                            onChange={(e) => desk.update(i, { subField: e.target.value })}
                            title="Sub-plate field"
                            className="h-6 w-[88px] shrink-0 rounded border border-border bg-card px-1 text-xs text-foreground"
                        >
                            <option value="">No sub</option>
                            {SUBFIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <SimpleTooltip label={subVisible ? 'Sub-plate shown' : 'Sub-plate hidden'}>
                            <button
                                type="button"
                                disabled={!slot.subField}
                                onClick={() => desk.update(i, { subVisible: !subVisible })}
                                className={cn(
                                    'shrink-0 disabled:opacity-30',
                                    subVisible && slot.subField ? 'text-rio-300' : 'text-muted-foreground hover:text-foreground',
                                )}
                            >
                                <Captions size={14} />
                            </button>
                        </SimpleTooltip>
                        <SimpleTooltip label="Remove commentator">
                            <button
                                type="button"
                                onClick={() => desk.remove(i)}
                                className="shrink-0 text-muted-foreground hover:text-destructive"
                            >
                                <X size={14} />
                            </button>
                        </SimpleTooltip>
                    </div>
                );
            })}

            <Button
                size="xs"
                variant="secondary"
                disabled={desk.slots.length >= MAX_COMMENTATORS}
                onClick={desk.add}
                className="w-full"
            >
                <Plus size={13} className="mr-1" /> Add commentator
            </Button>
        </Stack>
    );
}

// Gear setup for Commentary — show/hide the dedicated caster overlay. The
// roster itself is authored on the Commentary tab.
function CommentarySetup() {
    const element = ELEMENTS.find(e => e.id === 'commentary');
    const { primary } = useElementBindings(element);

    return (
        <Stack gap="sm">
            {primary ? (
                <VisibilityRow
                    label={primary.where === 'preview' ? 'In preview' : 'On air'}
                    item={primary.item} sceneName={primary.scene}
                />
            ) : (
                <Text size="xs" className="text-muted-foreground">Overlay not in program or preview scene.</Text>
            )}
            <Text size="xs" className="border-t border-border pt-2 text-muted-foreground">
                Assign commentators and edit details on the Commentary tab.
            </Text>
        </Stack>
    );
}

// ── Element option layer / faces / setups ──────────────────────────────────

// The shared option layer for an element — rendered both in the chip's
// expanding panel (full) and in the rail source popover (content only, via
// hideTarget/hideVisibility since the eye already toggles visibility there).
// Newer, richer elements add their controls here and get both surfaces free.
function ElementOptions({ element, hideTarget = false, hideVisibility = false }) {
    const { primary } = useElementBindings(element);

    if (element.flavor === 'direct') {
        const extra = element.id === 'hitvisualizer'
            ? <Stack gap="md"><HitVizFace /><HitVizSetup /></Stack>
            : element.id === 'commentary'
                ? <Stack gap="md"><CommentaryFace /><CommentarySetup /></Stack>
                : null;
        if (!primary) {
            return (
                <Stack gap="sm">
                    <Text size="sm" className="text-muted-foreground">
                        No matching source in the program or preview scene.
                    </Text>
                    {extra}
                </Stack>
            );
        }
        if (hideVisibility) {
            return (
                <Stack gap="sm">
                    <Text size="xs" className="text-muted-foreground">On {primary.item.sourceName}.</Text>
                    {extra}
                </Stack>
            );
        }
        return (
            <Stack gap="md">
                <VisibilityRow
                    label={primary.where === 'preview' ? 'In the preview scene' : 'On the broadcast'}
                    sub={`${primary.item.sourceName} · ${primary.scene}`}
                    item={primary.item} sceneName={primary.scene}
                />
                {extra}
            </Stack>
        );
    }

    // Fed element — content picker plus the named-container target (in the gear,
    // suppressed here when hideTarget so the rail popover stays content-only).
    return (
        <Stack gap="md">
            {!hideTarget && <FedSetup element={element} />}
            <FedFace element={element} />
        </Stack>
    );
}

// Does this element have overflow config worth a gear popover? Rich direct
// elements (hit visualizer) and every fed element (target picker) do; a plain
// direct element (scoreboard) is just a visibility toggle, no gear.
function elementHasSetup(element) {
    return element.id === 'hitvisualizer' || element.id === 'commentary'
        || element.id === 'lowerthird' || element.flavor === 'fed';
}

// The condensed FACE of an element window — its live actions only.
function ElementFace({ element }) {
    if (element.id === 'hitvisualizer') return <HitVizFace />;
    if (element.id === 'commentary') return <CommentaryFace />;
    if (element.id === 'lowerthird') return <LowerThirdFace element={element} />;
    if (element.flavor === 'fed') return <FedFace element={element} />;
    return <DirectFace element={element} />;
}

// The gear-popover SETUP for an element — its bulky config.
function ElementSetup({ element }) {
    if (element.id === 'hitvisualizer') return <HitVizSetup />;
    if (element.id === 'commentary') return <CommentarySetup />;
    if (element.id === 'lowerthird') return <LowerThirdSetup />;
    if (element.flavor === 'fed') return <FedSetup element={element} />;
    return null;
}

// Plain direct element (e.g. scoreboard): one live action — show/hide its
// dedicated source in the program (or studio-preview) scene.
function DirectFace({ element }) {
    const { primary } = useElementBindings(element);
    if (!primary) {
        return (
            <Text size="xs" className="text-muted-foreground">
                Not in the program or preview scene.
            </Text>
        );
    }
    return (
        <VisibilityRow
            label={primary.where === 'preview' ? 'Show in preview' : 'Show on air'}
            item={primary.item} sceneName={primary.scene}
        />
    );
}

// Fed element face: the content picker (the live decision — what to feed). The
// container it feeds is chosen in the gear; making that container's OBS source
// active is what puts it on the broadcast.
function FedFace({ element }) {
    if (element.feed === 'stats') return <StatsFeedPicker element={element} />;
    if (element.feed === 'postgamecallout') return <PostgameCalloutPicker element={element} />;
    return <Text size="xs" className="text-muted-foreground">No content options yet.</Text>;
}

// Fed element setup: which named shared container the content is fed into,
// plus that container source's own on-air toggle when it's in the program or
// preview scene — so a shared source can be revealed from here too.
function FedSetup({ element }) {
    const containers = useSharedContainers();
    const { container, setContainer } = useContainerTarget(element.id, defaultContainerFor(element));
    const binding = useContainerBinding(container);
    return (
        <Stack gap="sm">
            <label className="flex flex-col gap-1">
                <Text size="xs" className="text-muted-foreground">Feed into</Text>
                <select
                    value={container}
                    onChange={(e) => setContainer(e.target.value)}
                    className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
                >
                    {containers.length === 0 && <option value={container}>{container}</option>}
                    {containers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </label>
            {binding ? (
                <VisibilityRow
                    label={binding.where === 'preview' ? 'Container in preview' : 'Container on air'}
                    sub={`${binding.item.sourceName} · ${binding.scene}`}
                    item={binding.item} sceneName={binding.scene}
                />
            ) : (
                <Text size="xs" className="text-muted-foreground">
                    Container source not in the program or preview scene.
                </Text>
            )}
        </Stack>
    );
}

// ── Lower Third (Break) ───────────────────────────────────────────────────
// A direct element with rich authoring: the producer composes the band's match,
// title/subtitle and clock here; values are written (through the staging
// gateway) to lowerthird.* state, which the SVG overlay renders. Putting it on
// air is still the OBS source toggle. Clock START/PAUSE/RESET are transport —
// momentary, always immediate — while the clock's CONFIG (mode, duration,
// label) stages like other content.
const LT_INPUT = 'w-full rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground';

// Re-render once per ~500ms so the live clock readout ticks.
function useTick(ms = 500, on = true) {
    const [, force] = useState(0);
    useEffect(() => {
        if (!on) return;
        const id = setInterval(() => force(n => n + 1), ms);
        return () => clearInterval(id);
    }, [ms, on]);
}

// lowerthird.* with staged-value display: `val('title', live)` returns the
// pending value when one is staged; `setKey` routes through the staging
// gateway. One subscription to the pending map covers every field.
function useLowerThird() {
    const lt = useStateStore(useShallow(s => s?.lowerthird ?? {}));
    const matches = useStateStore(useShallow(s => s?.match ?? {}));
    const pendingMap = useStagingStore(s => s.pending);
    const val = (key, live) => {
        const p = pendingMap[`state:lowerthird.${key}`];
        return p ? p.value : live;
    };
    const isStaged = (key) => !!pendingMap[`state:lowerthird.${key}`];
    const setKey = (key, value, label) =>
        stageStateSet(`lowerthird.${key}`, value, label || `Lower third: ${key}`);
    return { lt, matches, val, isStaged, setKey };
}

function fmtRemaining(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}

function ClockControl() {
    const { lt } = useLowerThird();
    const c = lt.clock || {};
    // Transport acts on the LIVE clock — you can't run a countdown that isn't
    // live yet, so a staged mode change doesn't surface here until committed.
    const mode = c.mode || 'off';
    useTick(500, c.running || mode === 'clock');

    const set = (entries) => useStateStore.getState().setItems(entries);
    const now = Date.now();
    const remaining = c.running ? (c.endsAt || 0) - now : (c.remainingMs != null ? c.remainingMs : (c.durationSec || 300) * 1000);
    const elapsed = c.running ? now - (c.startedAt || now) : (c.elapsedMs || 0);

    const startCountdown = () => {
        const rem = c.remainingMs != null ? c.remainingMs : (c.durationSec || 300) * 1000;
        set([
            { key: 'lowerthird.clock.endsAt', value: now + rem },
            { key: 'lowerthird.clock.remainingMs', value: null },
            { key: 'lowerthird.clock.running', value: true },
        ]);
    };
    const pauseCountdown = () => set([
        { key: 'lowerthird.clock.remainingMs', value: Math.max(0, (c.endsAt || 0) - now) },
        { key: 'lowerthird.clock.running', value: false },
    ]);
    const resetCountdown = () => set([
        { key: 'lowerthird.clock.remainingMs', value: null },
        { key: 'lowerthird.clock.endsAt', value: null },
        { key: 'lowerthird.clock.running', value: false },
    ]);
    const startCountup = () => set([
        { key: 'lowerthird.clock.startedAt', value: now - (c.elapsedMs || 0) },
        { key: 'lowerthird.clock.running', value: true },
    ]);
    const pauseCountup = () => set([
        { key: 'lowerthird.clock.elapsedMs', value: Math.max(0, now - (c.startedAt || now)) },
        { key: 'lowerthird.clock.running', value: false },
    ]);
    const resetCountup = () => set([
        { key: 'lowerthird.clock.elapsedMs', value: 0 },
        { key: 'lowerthird.clock.startedAt', value: null },
        { key: 'lowerthird.clock.running', value: false },
    ]);

    if (mode === 'off') return null;
    if (mode === 'clock') {
        return <Text size="xs" className="text-muted-foreground">Showing time of day.</Text>;
    }
    const isDown = mode === 'countdown';
    return (
        <Group gap="xs" className="items-center">
            <Text size="sm" className="min-w-[64px] font-mono tabular-nums text-foreground">
                {fmtRemaining(isDown ? remaining : elapsed)}
            </Text>
            {c.running ? (
                <Button size="sm" variant="secondary" onClick={isDown ? pauseCountdown : pauseCountup}>Pause</Button>
            ) : (
                <Button size="sm" onClick={isDown ? startCountdown : startCountup}>Start</Button>
            )}
            <Button size="sm" variant="ghost" onClick={isDown ? resetCountdown : resetCountup}>
                <RotateCcw size={13} className="mr-1" /> Reset
            </Button>
        </Group>
    );
}

function LowerThirdFace({ element }) {
    const { lt, val, isStaged, setKey } = useLowerThird();
    const role = val('role', lt.role) === 'current' ? 'current' : 'upnext';
    return (
        <Stack gap="sm">
            <DirectFace element={element} />
            <Group gap="xs" className="items-center">
                <div className="min-w-0 flex-1">
                    <SegmentedControl
                        data={[{ label: 'Up Next', value: 'upnext' }, { label: 'Current', value: 'current' }]}
                        value={role}
                        onChange={(v) => setKey('role', v, 'Lower third: role')}
                    />
                </div>
                <StagedDot show={isStaged('role')} />
            </Group>
            <ClockControl />
        </Stack>
    );
}

function LowerThirdSetup() {
    const { lt, matches, val, isStaged, setKey } = useLowerThird();
    const ov = lt.override || {};
    const c = lt.clock || {};
    const matchIds = Object.keys(matches || {});
    const matchLabel = (id) => {
        const m = matches[id] || {};
        const names = [m?.player?.[1]?.rioName, m?.player?.[2]?.rioName].filter(Boolean).join(' vs ');
        return m.label ? `${m.label}${names ? ` — ${names}` : ''}` : (names || `Match ${id}`);
    };

    // Labelled field with the staged dot; keeps each control one-liner below.
    const FieldLabel = ({ k, children }) => (
        <Group gap="xs" className="items-center">
            <Text size="xs" className="text-muted-foreground">{children}</Text>
            <StagedDot show={isStaged(k)} />
        </Group>
    );

    const liveMatchId = val('matchId', lt.matchId);
    const clockMode = val('clock.mode', c.mode) || 'off';

    return (
        <Stack gap="sm">
            <label className="flex flex-col gap-1">
                <FieldLabel k="matchId">Match</FieldLabel>
                <select
                    className={LT_INPUT}
                    value={liveMatchId != null && liveMatchId !== '' ? String(liveMatchId) : ''}
                    onChange={(e) => setKey('matchId', e.target.value || null, 'Lower third: match')}
                >
                    <option value="">— None (manual) —</option>
                    {matchIds.map(id => <option key={id} value={id}>{matchLabel(id)}</option>)}
                </select>
            </label>

            <label className="flex flex-col gap-1">
                <FieldLabel k="title">Title</FieldLabel>
                <input
                    className={LT_INPUT} value={val('title', lt.title) || ''} placeholder="e.g. Winners Final"
                    onChange={(e) => setKey('title', e.target.value, 'Lower third: title')}
                />
            </label>
            <label className="flex flex-col gap-1">
                <FieldLabel k="subtitle">Subtitle</FieldLabel>
                <input
                    className={LT_INPUT} value={val('subtitle', lt.subtitle) || ''} placeholder="e.g. NNL Season 7"
                    onChange={(e) => setKey('subtitle', e.target.value, 'Lower third: subtitle')}
                />
            </label>

            <Text size="xs" className="font-medium text-muted-foreground">Manual override (used when no match is selected)</Text>
            <Group gap="xs" className="flex-nowrap">
                <input
                    className={LT_INPUT} value={val('override.side1', ov.side1) || ''} placeholder="Side 1 name"
                    onChange={(e) => setKey('override.side1', e.target.value, 'Lower third: side 1')}
                />
                <input
                    className={LT_INPUT} value={val('override.side2', ov.side2) || ''} placeholder="Side 2 name"
                    onChange={(e) => setKey('override.side2', e.target.value, 'Lower third: side 2')}
                />
            </Group>
            <input
                className={LT_INPUT} value={val('override.status', ov.status) || ''} placeholder="Status override (e.g. LIVE)"
                onChange={(e) => setKey('override.status', e.target.value, 'Lower third: status')}
            />

            <label className="flex flex-col gap-1">
                <FieldLabel k="clock.mode">Clock</FieldLabel>
                <select
                    className={LT_INPUT} value={clockMode}
                    onChange={(e) => setKey('clock.mode', e.target.value, 'Lower third: clock mode')}
                >
                    <option value="off">Off</option>
                    <option value="countdown">Countdown</option>
                    <option value="countup">Count up</option>
                    <option value="clock">Time of day</option>
                </select>
            </label>
            {clockMode === 'countdown' && (
                <Group gap="xs" className="flex-nowrap items-center">
                    <FieldLabel k="clock.durationSec">Minutes</FieldLabel>
                    <input
                        type="number" min={0} step={1} className={LT_INPUT}
                        value={Math.round(((val('clock.durationSec', c.durationSec)) || 300) / 60)}
                        onChange={(e) => setKey('clock.durationSec', Math.max(0, Number(e.target.value) || 0) * 60, 'Lower third: countdown length')}
                    />
                </Group>
            )}
            {(clockMode === 'countdown' || clockMode === 'clock') && (
                <input
                    className={LT_INPUT} value={val('clock.label', c.label) || ''} placeholder="Clock label (e.g. BACK IN)"
                    onChange={(e) => setKey('clock.label', e.target.value, 'Lower third: clock label')}
                />
            )}
        </Stack>
    );
}

// ── Element grid ───────────────────────────────────────────────────────────
// Row packing lives in elements.js (packRows) — pure and unit-tested.

// Literal class names per span so Tailwind keeps them.
const SPAN_CLASS = {
    1: 'md:col-span-1', 2: 'md:col-span-2', 3: 'md:col-span-3', 4: 'md:col-span-4',
    5: 'md:col-span-5', 6: 'md:col-span-6', 7: 'md:col-span-7', 8: 'md:col-span-8',
    9: 'md:col-span-9', 10: 'md:col-span-10', 11: 'md:col-span-11', 12: 'md:col-span-12',
};

const WINDOW_STATE = {
    live:    { dot: 'bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/70', border: 'border-emerald-500/50', label: 'On air' },
    preview: { dot: 'bg-sky-400 shadow-[0_0_6px] shadow-sky-400/70',         border: 'border-sky-500/50',     label: 'In studio preview' },
    idle:    { dot: 'bg-muted-foreground',                                    border: '',                      label: 'Bound, hidden' },
    unbound: { dot: 'border border-muted-foreground bg-transparent',          border: 'border-dashed',         label: 'No matching OBS source' },
};

// A self-contained element "window": header (status dot · name · gear) over the
// element's own controls. Emerald = its source is enabled in the program scene;
// sky = enabled in the studio-preview scene (staged in OBS, not yet taken);
// gray = bound but hidden; dashed = no source bound anywhere we can see.
const ElementWindow = memo(function ElementWindow({ element, span }) {
    const { program, preview } = useElementBindings(element);
    const state = program?.item.enabled ? 'live'
        : preview?.item.enabled ? 'preview'
            : (program || preview) ? 'idle' : 'unbound';
    const meta = WINDOW_STATE[state];

    return (
        <div
            className={cn(
                'col-span-2 flex flex-col overflow-hidden rounded-lg border bg-card',
                SPAN_CLASS[span || element.span] || 'md:col-span-3',
                meta.border,
            )}
        >
            <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-1.5">
                <SimpleTooltip label={meta.label}>
                    <span className={cn('size-2 shrink-0 rounded-full', meta.dot)} />
                </SimpleTooltip>
                <SimpleTooltip label={element.name}>
                    <Text size="sm" className="min-w-0 flex-1 truncate font-medium text-foreground">{element.name}</Text>
                </SimpleTooltip>
                {elementHasSetup(element) && (
                    <Popover>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                                aria-label={`${element.name} settings`}
                            >
                                <Settings size={14} />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-64">
                            <ElementSetup element={element} />
                        </PopoverContent>
                    </Popover>
                )}
            </div>
            <div className="min-h-0 flex-1 p-2.5">
                <ElementFace element={element} />
            </div>
        </div>
    );
});

function ElementsArea({ phase }) {
    const status = useObsStore(s => s.status);
    const els = elementsForPhase(phase);
    const rows = useMemo(() => packRows(els), [els]);
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

    // One CSS grid; packRows guarantees each visual row sums to 12 columns
    // (except possibly the last), and grid rows give same-height cards per row.
    return (
        <Panel title="Elements">
            <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-12">
                {rows.flatMap(row =>
                    row.map(({ element, span }) =>
                        <ElementWindow key={element.id} element={element} span={span} />))}
            </div>
        </Panel>
    );
}

// ── Post-game capture / pending bar / page ─────────────────────────────────

// Producer "Capture / Go to post-game" control. Shown in the Post-game phase; does
// not require OBS. Hits POST /postgame/capture for the chosen scoreboard, which
// matches the finished game's on-disk stat file (by game id + Loaded-from-HUD==0),
// projects the box score to postgame.{N}.* (what the Stat Callout reads), and
// advances a bound match to the post stage. Clear blanks it again. Momentary —
// never staged.
function PostGameBar() {
    const activeRaw = useSettingsStore(s => s?.scoreboards?.active ?? [1]);
    const aliases = useSettingsStore(s => s?.scoreboards?.aliases ?? {});
    const active = Array.isArray(activeRaw) && activeRaw.length ? activeRaw : [1];
    const [sb, setSb] = useState(active[0]);
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (!active.includes(sb)) setSb(active[0]); }, [active, sb]);

    const pg = useStateStore(useShallow(s => {
        const p = s?.postgame?.[sb];
        return {
            present: p?.present, sourceFile: p?.sourceFile, winnerSide: p?.meta?.winnerSide,
            n1: p?.player?.[1]?.rioName, s1: p?.player?.[1]?.score,
            n2: p?.player?.[2]?.rioName, s2: p?.player?.[2]?.score,
        };
    }));
    const gameId = useStateStore(s => s?.score?.[sb]?.game_id);
    const label = (n) => aliases?.[n] || aliases?.[String(n)] || `Scoreboard ${n}`;

    const capture = async () => {
        setBusy(true);
        try {
            const r = await fetch(`/api/v1/postgame/capture?scoreboard=${sb}`, { method: 'POST' });
            const data = await r.json().catch(() => ({}));
            if (data?.success) {
                notifications.show({ message: `Captured ${data.sourceFile} — match advanced to post-game.`, color: 'green' });
            } else {
                notifications.show({ message: `Capture failed: ${data?.reason || 'unknown error'}`, color: 'red' });
            }
        } catch (e) {
            notifications.show({ message: `Capture error: ${e?.message || e}`, color: 'red' });
        } finally { setBusy(false); }
    };
    const clear = async () => {
        setBusy(true);
        try { await fetch(`/api/v1/postgame/clear?scoreboard=${sb}`, { method: 'POST' }); }
        catch (e) { notifications.show({ message: `Clear error: ${e?.message || e}`, color: 'red' }); }
        finally { setBusy(false); }
    };

    return (
        <Panel title="Post-game capture">
            <Stack gap="sm" className="p-3">
                <Text size="xs" className="text-muted-foreground">
                    Reads the finished game's box score from Project Rio's on-disk stat file
                    (matched by game id), projects it to <code>postgame.{sb}.*</code> for the Stat
                    Callout, and advances a bound match to post-game. Capture once the game has ended.
                </Text>
                <Group gap="sm" className="flex-wrap items-center">
                    {active.length > 1 && (
                        <select
                            value={sb}
                            onChange={(e) => setSb(Number(e.target.value))}
                            className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
                        >
                            {active.map(n => <option key={n} value={n}>{label(n)}</option>)}
                        </select>
                    )}
                    <Button size="sm" disabled={busy} onClick={capture}>
                        <Trophy size={14} className="mr-1" /> {busy ? 'Capturing…' : 'Capture finished game'}
                    </Button>
                    {pg.present && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={clear}>
                            <Trash2 size={14} className="mr-1" /> Clear
                        </Button>
                    )}
                </Group>
                {pg.present ? (
                    <Group gap="xs" className="flex-wrap items-center">
                        <Badge className="bg-emerald-500/15 text-emerald-300 text-[10px]">Captured</Badge>
                        <Text size="sm" className="text-foreground">
                            <span className={cn(pg.winnerSide === 1 && 'font-bold')}>{pg.n1 || 'Side 1'}</span> {pg.s1 ?? 0}
                            <span className="mx-1 text-muted-foreground">–</span>
                            {pg.s2 ?? 0} <span className={cn(pg.winnerSide === 2 && 'font-bold')}>{pg.n2 || 'Side 2'}</span>
                        </Text>
                        {pg.sourceFile && (
                            <Text size="xs" className="max-w-[26ch] truncate text-muted-foreground" title={pg.sourceFile}>
                                {pg.sourceFile}
                            </Text>
                        )}
                    </Group>
                ) : (
                    <Text size="xs" className="text-muted-foreground">
                        {gameId ? `Nothing captured yet for game ${gameId}.` : 'No game id on this scoreboard yet — finish a game first.'}
                    </Text>
                )}
            </Stack>
        </Panel>
    );
}

// The confirm-to-live surface: a sticky bar listing every staged change, with
// Go Live (also bound to the configured hotkey while this page is mounted) and
// Discard all. Hidden entirely when confirm mode is off — unless changes are
// still pending from before it was turned off, so nothing staged can strand.
function PendingBar() {
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
                <Stack gap="md">
                    {phase === 'post' && <PostGameBar />}
                    <ElementsArea phase={phase} />
                </Stack>
            </div>

            <PendingBar />
        </Stack>
    );
}
