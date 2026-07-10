import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
    Radio, Eye, EyeOff, Globe, PlugZap, MonitorPlay, ArrowLeftRight, ChevronDown,
    ChevronRight, ChevronsUpDown, Check, RotateCcw, Sparkles, Columns2, Settings,
    Captions, Plus, X, Trophy, Trash2, CircleDot,
} from 'lucide-react';
import { useObsStore } from '../../context/obs';
import { useSettingsStore, useStateStore } from '../../context/store';
import {
    setCommentarySlots, SUBFIELD_OPTIONS, MAX_COMMENTATORS,
} from '../../context/commentary';
import {
    setPlayerPlatesConfig, normalizeConfig as normalizePlatesConfig,
    PP_MODE_OPTIONS, PP_SOURCE_OPTIONS, PP_LOCATION_OPTIONS, PP_SUBFIELD_OPTIONS,
} from '../../context/playerplates';
import {
    createMatch, updateMatch, deleteMatch, bindScoreboard, loadStartGGSet, fetchMatchup, clearMatchup,
} from '../../context/match';
import {
    useStagingStore, stageOrRun, usePending, commitPending, eventMatchesHotkey,
    confirmModeEnabled,
} from '../../context/staging';
import ParticipantPicker from '../../components/ParticipantPicker';
import StartggSetPicker from '../../components/StartggSetPicker';
import {
    Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '../../components/ui/command';
import { useAssetUrls } from '../../lib/assets';
import { MSB_CAPTAINS } from '../../data/msb';
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

// Stacked ▲/▼ — the reorder control shared by the list faces (commentary
// desk, lower-third slots, schedule queue). Deliberately buttons, not drag:
// native HTML5 drag needs a mouse pointer, and the Production page is also
// driven from phones/tablets at the venue.
function MoveButtons({ canUp, canDown, onUp, onDown, label }) {
    return (
        <Stack gap="none" className="shrink-0">
            <button
                type="button" disabled={!canUp} onClick={onUp} aria-label={`Move ${label} up`}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
                <ChevronRight size={12} className="-rotate-90" />
            </button>
            <button
                type="button" disabled={!canDown} onClick={onDown} aria-label={`Move ${label} down`}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
                <ChevronRight size={12} className="rotate-90" />
            </button>
        </Stack>
    );
}

// Amber "staged, not live yet" marker rendered next to pending controls.
function StagedDot({ show, className }) {
    if (!show) return null;
    return (
        <SimpleTooltip label="Staged — goes live on confirm">
            <span className={cn('inline-block size-1.5 shrink-0 rounded-full bg-amber-400', className)} />
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

// Content control for the 'postgamevs' fed element (Game Summary): push the
// whole captured game — both sides — onto the shared Callout Stage. There is
// nothing to pick beyond the scoreboard: pushing writes (through the staging
// gateway) production.feed.container.<id> = { element:'postgamevs', scoreboard }
// and the callout-stage container renders the player-vs-player summary from
// postgame.{N}.player.{T}.totals.
function PostgameVsPicker({ element, scoreboard = 1 }) {
    const { container } = useContainerTarget(element.id, defaultContainerFor(element));
    const { value: selection, staged, setFeed } = useFeedControl(container);
    const pg = useStateStore(useShallow(s => {
        const p = s?.postgame?.[scoreboard];
        return {
            present: p?.present, winnerSide: p?.meta?.winnerSide,
            n1: p?.player?.[1]?.rioName, s1: p?.player?.[1]?.score,
            n2: p?.player?.[2]?.rioName, s2: p?.player?.[2]?.score,
            hasTotals: !!p?.player?.[1]?.totals,
        };
    }));

    const mine = selection && selection.element === 'postgamevs'
        && (selection.scoreboard == null || selection.scoreboard === scoreboard);
    const occupiedByOther = selection && !mine;

    const push = () => setFeed(
        { element: 'postgamevs', scoreboard },
        `Feed game summary: ${pg.n1 || 'Side 1'} vs ${pg.n2 || 'Side 2'}`,
    );
    const clear = () => setFeed(null);

    if (!pg.present) {
        return (
            <Text size="sm" className="text-muted-foreground">
                No captured game on scoreboard {scoreboard} yet — capture a finished game first
                (the summary reads its box score).
            </Text>
        );
    }

    return (
        <Stack gap="xs">
            <Group gap="xs" className="items-center">
                <Text size="sm" className="text-foreground">
                    <span className={cn(pg.winnerSide === 1 && 'font-bold')}>{pg.n1 || 'Side 1'}</span> {pg.s1 ?? 0}
                    <span className="mx-1 text-muted-foreground">–</span>
                    {pg.s2 ?? 0} <span className={cn(pg.winnerSide === 2 && 'font-bold')}>{pg.n2 || 'Side 2'}</span>
                </Text>
                <StagedDot show={staged} />
            </Group>
            <Group gap="xs" className="items-center">
                {mine ? (
                    <Button size="sm" variant="ghost" onClick={clear}>Clear from stage</Button>
                ) : (
                    <Button size="sm" onClick={push}>Push game summary</Button>
                )}
                {occupiedByOther && (
                    <Text size="xs" className="text-muted-foreground">Replaces what the stage is showing.</Text>
                )}
            </Group>
            {!pg.hasTotals && (
                <Text size="xs" className="text-muted-foreground">
                    Older capture without side totals — re-capture to include Stars Won.
                </Text>
            )}
            {mine && (
                <Text size="xs" className="text-muted-foreground">
                    Show the callout-stage source on air; Clear hands the stage back.
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

// Condensed Commentary face — ONE row per caster: move ▲/▼ (reorder) ·
// on-air eye · person picker · sub-plate field · sub-plate toggle · remove.
// The in-depth roster authoring (contact fields, socials) lives on the
// Commentary tab; this face covers the live decisions. Reorder is buttons,
// not drag, so it works from a phone (see MoveButtons).
function CommentaryFace() {
    const desk = useCommentaryDesk();

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
                        className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-1.5 py-1"
                    >
                        <MoveButtons
                            label={`caster ${i + 1}`}
                            canUp={i > 0} canDown={i < desk.slots.length - 1}
                            onUp={() => desk.reorder(i, i - 1)}
                            onDown={() => desk.reorder(i, i + 1)}
                        />
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

// ── Player Plates ──────────────────────────────────────────────────────────
// A sibling of Commentary: the two-player name/sub-plate band. The producer
// picks a MODE (both L/R, or one player at a togglable location) and each
// plate's content (fed from a match, or typed manually); the whole config
// stages+PUTs as ONE key ('playerplates'), and the server projector resolves it
// to playerplates.* for the overlay. Same plate + sub-plate convention as the
// caster strip, reusing the shared address-book sub-field vocabulary.
const PP_INPUT = 'h-7 w-full rounded-md border border-border bg-card px-2 text-xs text-foreground';

function usePlayerPlates() {
    const cfgRaw = useStateStore(useShallow(s => s?.playerplates?.config));
    const live = useStateStore(useShallow(s => s?.playerplates ?? {}));
    const matches = useStateStore(useShallow(s => s?.match ?? {}));
    const pending = usePending('playerplates');
    const config = pending ? pending.value : normalizePlatesConfig(cfgRaw);

    const setConfig = (next) => stageOrRun({
        key: 'playerplates',
        label: 'Player plates',
        value: next,
        run: () => setPlayerPlatesConfig(next),
    });
    const patch = (partial) => setConfig({ ...config, ...partial });
    const patchSide = (t, sp) => setConfig({
        ...config,
        sides: { ...config.sides, [t]: { ...(config.sides?.[t] || {}), ...sp } },
    });
    // Server-resolved display name per side (used to preview the match-fed name).
    const resolvedName = (t) => live?.[t]?.name ?? live?.[String(t)]?.name ?? '';
    return { config, staged: !!pending, matches, patch, patchSide, resolvedName };
}

// One player's row: eye · name (typed, or resolved read-only when match-fed) ·
// sub-plate field/value · sub toggle · (single-mode) location.
function PlayerPlateSide({ t, pp }) {
    const { config } = pp;
    const side = config.sides?.[t] || {};
    const isMatch = config.source === 'match';
    const visible = side.visible !== false;
    const subVisible = side.subVisible !== false;
    const hasSub = isMatch ? !!side.subField : !!(side.subValue || side.subLabel);

    return (
        <div className={cn('rounded-md border border-border/60 bg-background/40 px-2 py-1.5', !visible && 'opacity-60')}>
            <Group gap="xs" className="flex-nowrap items-center">
                <SimpleTooltip label={visible ? 'On air — click to hide' : 'Hidden — click to show'}>
                    <button
                        type="button"
                        onClick={() => pp.patchSide(t, { visible: !visible })}
                        className={cn('shrink-0', visible ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
                    >
                        {visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                </SimpleTooltip>
                <Text size="xs" className="w-12 shrink-0 font-medium text-muted-foreground">Player {t}</Text>
                {isMatch ? (
                    <Text size="xs" className="min-w-0 flex-1 truncate text-foreground">
                        {pp.resolvedName(t) || <span className="text-muted-foreground">No name from match</span>}
                    </Text>
                ) : (
                    <input
                        value={side.name || ''}
                        onChange={(e) => pp.patchSide(t, { name: e.target.value })}
                        placeholder={`Player ${t} name…`}
                        className={cn(PP_INPUT, 'min-w-0 flex-1')}
                    />
                )}
                <SimpleTooltip label={subVisible ? 'Sub-plate shown' : 'Sub-plate hidden'}>
                    <button
                        type="button"
                        disabled={!hasSub}
                        onClick={() => pp.patchSide(t, { subVisible: !subVisible })}
                        className={cn('shrink-0 disabled:opacity-30', subVisible && hasSub ? 'text-rio-300' : 'text-muted-foreground hover:text-foreground')}
                    >
                        <Captions size={14} />
                    </button>
                </SimpleTooltip>
            </Group>

            <Group gap="xs" className="mt-1 flex-nowrap items-center">
                {isMatch ? (
                    <select
                        value={side.subField || ''}
                        onChange={(e) => pp.patchSide(t, { subField: e.target.value })}
                        title="Sub-plate field"
                        className={cn(PP_INPUT, 'flex-1')}
                    >
                        <option value="">No sub-plate</option>
                        {PP_SUBFIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                ) : (
                    <>
                        <input
                            value={side.subLabel || ''}
                            onChange={(e) => pp.patchSide(t, { subLabel: e.target.value })}
                            placeholder="Sub label"
                            className={cn(PP_INPUT, 'w-[38%]')}
                        />
                        <input
                            value={side.subValue || ''}
                            onChange={(e) => pp.patchSide(t, { subValue: e.target.value })}
                            placeholder="Sub value"
                            className={cn(PP_INPUT, 'flex-1')}
                        />
                    </>
                )}
                {config.mode !== 'both' && (
                    <SegmentedControl
                        size="xs"
                        value={side.location || (t === 1 ? 'left' : 'right')}
                        onChange={(v) => pp.patchSide(t, { location: v })}
                        data={PP_LOCATION_OPTIONS}
                        className="shrink-0"
                    />
                )}
            </Group>
        </div>
    );
}

// Condensed face: mode + source (+ match picker), then the editor(s) for the
// side(s) the mode shows.
function PlayerPlatesFace({ element }) {
    const pp = usePlayerPlates();
    const { config } = pp;
    const ids = useMemo(
        () => Object.keys(pp.matches).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b)),
        [pp.matches],
    );
    const showSide = (t) => config.mode === 'both'
        || (config.mode === 'p1' && t === 1) || (config.mode === 'p2' && t === 2);

    return (
        <Stack gap="xs">
            <DirectFace element={element} />
            {pp.staged && (
                <Group gap="xs" className="items-center">
                    <StagedDot show />
                    <Text size="xs" className="text-amber-400">Plate changes staged</Text>
                </Group>
            )}

            <Group gap="xs" className="flex-nowrap items-center">
                <Text size="xs" className="w-12 shrink-0 text-muted-foreground">Show</Text>
                <SegmentedControl
                    size="xs" value={config.mode}
                    onChange={(v) => pp.patch({ mode: v })}
                    data={PP_MODE_OPTIONS} className="flex-1"
                />
            </Group>
            <Group gap="xs" className="flex-nowrap items-center">
                <Text size="xs" className="w-12 shrink-0 text-muted-foreground">From</Text>
                <SegmentedControl
                    size="xs" value={config.source}
                    onChange={(v) => pp.patch({ source: v })}
                    data={PP_SOURCE_OPTIONS} className="shrink-0"
                />
                {config.source === 'match' && (
                    <select
                        value={config.matchId != null && pp.matches[String(config.matchId)] ? String(config.matchId) : ''}
                        onChange={(e) => pp.patch({ matchId: e.target.value ? Number(e.target.value) : null })}
                        className={cn(PP_INPUT, 'min-w-0 flex-1')}
                    >
                        <option value="">{ids.length ? 'Pick match…' : 'No matches yet'}</option>
                        {ids.map(id => <option key={id} value={id}>{matchDisplayLabel(pp.matches, id)}</option>)}
                    </select>
                )}
            </Group>

            {showSide(1) && <PlayerPlateSide t={1} pp={pp} />}
            {showSide(2) && <PlayerPlateSide t={2} pp={pp} />}
        </Stack>
    );
}

// Gear setup: the dedicated overlay's on-air state + a one-line explainer.
function PlayerPlatesSetup() {
    const element = ELEMENTS.find(e => e.id === 'playerplates');
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
                Match-fed plates resolve names + the chosen field from the match's
                participants; switch to Manual to type them. In Both mode the two
                plates pin to left/right; single modes place the plate at the
                chosen location.
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
        || element.id === 'matchuphistory'
        || element.id === 'schedule' || element.id === 'playerplates'
        || element.flavor === 'fed';
}

// The condensed FACE of an element window — its live actions only.
function ElementFace({ element }) {
    if (element.id === 'hitvisualizer') return <HitVizFace />;
    if (element.id === 'commentary') return <CommentaryFace />;
    if (element.id === 'playerplates') return <PlayerPlatesFace element={element} />;
    if (element.id === 'lowerthird') return <LowerThirdFace element={element} />;
    if (element.id === 'schedule') return <ScheduleFace element={element} />;
    if (element.id === 'matchuphistory') return <MatchupFace element={element} />;
    if (element.flavor === 'fed') return <FedFace element={element} />;
    return <DirectFace element={element} />;
}

// The gear-popover SETUP for an element — its bulky config.
function ElementSetup({ element }) {
    if (element.id === 'hitvisualizer') return <HitVizSetup />;
    if (element.id === 'commentary') return <CommentarySetup />;
    if (element.id === 'playerplates') return <PlayerPlatesSetup />;
    if (element.id === 'schedule') return <ScheduleSetup />;
    if (element.id === 'matchuphistory') return <MatchupSetup />;
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
    if (element.feed === 'postgamevs') return <PostgameVsPicker element={element} />;
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
// A direct element with rich authoring: the band is FIVE independently
// toggleable SLOTS (lowerthird.slots.1..5, left→right), each carrying one
// content type — logo · match · scorebox · merch · clock · message · bracket.
// EVERYTHING lives on the face (no gear): each slot row is a type picker +
// on/off switch, and expands in place to that type's content editor — picking
// a type auto-expands the row so authoring never hides behind a menu. Values
// are written (through the staging gateway) to lowerthird.* state, which the
// SVG overlay renders; segment widths/looks belong to the active design
// package's theme. Putting the band on air is still the OBS source toggle.
// Clock START/PAUSE/RESET are transport — momentary, always immediate —
// while slot content/config stages like other content.
const LT_INPUT = 'w-full rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground';

const LT_SLOT_COUNT = 5;
const LT_TYPE_OPTIONS = [
    { value: '', label: '— Empty —' },
    { value: 'logo', label: 'Logo + Title' },
    { value: 'match', label: 'Match' },
    { value: 'scorebox', label: 'Scorebox' },
    { value: 'merch', label: 'Merch / Ad' },
    { value: 'clock', label: 'Timer / Clock' },
    { value: 'message', label: 'Message' },
    { value: 'bracket', label: 'Bracket' },
    { value: 'space', label: 'Space (split)' },
];
const LT_TYPE_LABEL = Object.fromEntries(LT_TYPE_OPTIONS.map(o => [o.value, o.label]));

// Human label for a match id in a select: "Label — A vs B", falling back to
// names or "Match N". Shared by the lower third, the Draft bar and Matchup.
function matchDisplayLabel(matches, id) {
    const m = matches?.[id] || {};
    const names = [m?.player?.[1]?.rioName, m?.player?.[2]?.rioName].filter(Boolean).join(' vs ');
    return m.label ? `${m.label}${names ? ` — ${names}` : ''}` : (names || `Match ${id}`);
}

// Re-render once per ~500ms so the live clock readout ticks.
function useTick(ms = 500, on = true) {
    const [, force] = useState(0);
    useEffect(() => {
        if (!on) return;
        const id = setInterval(() => force(n => n + 1), ms);
        return () => clearInterval(id);
    }, [ms, on]);
}

// lowerthird.* with staged-value display: `val('slots.1.title', live)` returns
// the pending value when one is staged; `setKey` routes through the staging
// gateway. `slot(i)` reads one authored slot's object — a staged whole-slot
// value (a reorder swap) wins over live, so repeated moves compose before a
// commit. One subscription to the pending map covers every field. `swap`
// exchanges two positions wholesale (slot objects carry all their content, so
// a move keeps titles/clock/etc. with the slot).
function useLowerThird() {
    const lt = useStateStore(useShallow(s => s?.lowerthird ?? {}));
    const matches = useStateStore(useShallow(s => s?.match ?? {}));
    const pendingMap = useStagingStore(s => s.pending);
    const slot = (i) => {
        const p = pendingMap[`state:lowerthird.slots.${i}`];
        if (p) return p.value || {};
        return (lt.slots || {})[i] || (lt.slots || {})[String(i)] || {};
    };
    const val = (key, live) => {
        const p = pendingMap[`state:lowerthird.${key}`];
        return p ? p.value : live;
    };
    const isStaged = (key) => !!pendingMap[`state:lowerthird.${key}`];
    const setKey = (key, value, label) =>
        stageStateSet(`lowerthird.${key}`, value, label || `Lower third: ${key}`);
    const swap = (i, j) => {
        if (j < 1 || j > LT_SLOT_COUNT || i === j) return;
        const a = slot(i);
        const b = slot(j);
        // Live mode: one atomic batch — two sequential sets would flash a
        // duplicated slot on an on-air band for a frame. Confirm mode: two
        // staged whole-slot entries so both rows show/dot their pending value.
        if (!confirmModeEnabled()) {
            useStateStore.getState().setItems([
                { key: `lowerthird.slots.${i}`, value: b },
                { key: `lowerthird.slots.${j}`, value: a },
            ]);
            return;
        }
        setKey(`slots.${i}`, b, `Lower third: slot ${j} → ${i}`);
        setKey(`slots.${j}`, a, `Lower third: slot ${i} → ${j}`);
    };
    return { lt, matches, slot, val, isStaged, setKey, swap };
}

function fmtRemaining(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}

// Transport for slot i's clock (lowerthird.slots.{i}.clock.*). Transport acts
// on the LIVE clock — you can't run a countdown that isn't live yet, so a
// staged mode change doesn't surface here until committed.
function ClockControl({ i }) {
    const c = useStateStore(useShallow(s => s?.lowerthird?.slots?.[i]?.clock
        ?? s?.lowerthird?.slots?.[String(i)]?.clock ?? {}));
    const mode = c.mode || 'off';
    useTick(500, c.running || mode === 'clock');

    const base = `lowerthird.slots.${i}.clock`;
    const set = (entries) => useStateStore.getState().setItems(entries);
    const now = Date.now();
    const remaining = c.running ? (c.endsAt || 0) - now : (c.remainingMs != null ? c.remainingMs : (c.durationSec || 300) * 1000);
    const elapsed = c.running ? now - (c.startedAt || now) : (c.elapsedMs || 0);

    const startCountdown = () => {
        const rem = c.remainingMs != null ? c.remainingMs : (c.durationSec || 300) * 1000;
        set([
            { key: `${base}.endsAt`, value: now + rem },
            { key: `${base}.remainingMs`, value: null },
            { key: `${base}.running`, value: true },
        ]);
    };
    const pauseCountdown = () => set([
        { key: `${base}.remainingMs`, value: Math.max(0, (c.endsAt || 0) - now) },
        { key: `${base}.running`, value: false },
    ]);
    const resetCountdown = () => set([
        { key: `${base}.remainingMs`, value: null },
        { key: `${base}.endsAt`, value: null },
        { key: `${base}.running`, value: false },
    ]);
    const startCountup = () => set([
        { key: `${base}.startedAt`, value: now - (c.elapsedMs || 0) },
        { key: `${base}.running`, value: true },
    ]);
    const pauseCountup = () => set([
        { key: `${base}.elapsedMs`, value: Math.max(0, now - (c.startedAt || now)) },
        { key: `${base}.running`, value: false },
    ]);
    const resetCountup = () => set([
        { key: `${base}.elapsedMs`, value: 0 },
        { key: `${base}.startedAt`, value: null },
        { key: `${base}.running`, value: false },
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

// One-line description of what a slot currently shows (for the face rows).
function ltSlotSummary(type, s, matches) {
    if (!type) return '';
    if (type === 'match') return s.matchId ? matchDisplayLabel(matches, s.matchId) : 'No match picked';
    if (type === 'scorebox') return `Scoreboard ${s.scoreboard || 1}`;
    if (type === 'clock') {
        const m = s.clock?.mode || 'off';
        return m === 'off' ? 'Clock off' : (m === 'clock' ? 'Time of day' : (m === 'countdown' ? 'Countdown' : 'Count up'));
    }
    if (type === 'bracket') return s.title || 'Loaded bracket phase';
    if (type === 'space') return Number(s.width) > 0 ? `Fixed gap ${Math.round(s.width)}px` : 'Split / fill';
    return s.title || '';
}

// One face row = one band slot: move ▲/▼ (reorder, phone-friendly buttons) ·
// chevron (expand editor) · type picker · staged dot · on/off. Collapsed rows
// show a one-line summary of their content; picking a type auto-expands the
// row's editor in place.
function LowerThirdSlotRow({ i, expanded, setExpanded }) {
    const { matches, slot, val, isStaged, setKey, swap } = useLowerThird();
    const s = slot(i);
    const type = val(`slots.${i}.type`, s.type) || '';
    const enabled = !!val(`slots.${i}.enabled`, s.enabled);
    const summary = ltSlotSummary(type, s, matches);
    const open = expanded && !!type;
    return (
        <div className="rounded-md border border-border/60">
            <Group gap="xs" className="items-center px-1.5 py-1">
                <MoveButtons
                    label={`slot ${i}`}
                    canUp={i > 1} canDown={i < LT_SLOT_COUNT}
                    onUp={() => swap(i, i - 1)}
                    onDown={() => swap(i, i + 1)}
                />
                <button
                    type="button" disabled={!type}
                    onClick={() => setExpanded(!expanded)}
                    aria-label={`Slot ${i}: ${open ? 'collapse' : 'expand'} editor`}
                    className="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                >
                    <ChevronRight size={13} className={cn('transition-transform', open && 'rotate-90')} />
                </button>
                <select
                    className={cn(LT_INPUT, 'h-7 min-w-0 flex-1 py-0 text-xs')} value={type}
                    onChange={(e) => {
                        setKey(`slots.${i}.type`, e.target.value, `Lower third: slot ${i} type`);
                        setExpanded(!!e.target.value);
                    }}
                >
                    {LT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <StagedDot show={isStaged(`slots.${i}`) || isStaged(`slots.${i}.enabled`) || isStaged(`slots.${i}.type`)} />
                <Switch
                    checked={enabled} disabled={!type}
                    onCheckedChange={(v) => setKey(`slots.${i}.enabled`, v, `Lower third: slot ${i} ${v ? 'on' : 'off'}`)}
                />
            </Group>
            {!open && summary && (
                <Text size="xs" className="truncate px-1.5 pb-1 pl-7 text-muted-foreground">{summary}</Text>
            )}
            {open && (
                <div className="border-t border-border/60 p-2">
                    <LowerThirdSlotFields i={i} />
                </div>
            )}
            {type === 'clock' && enabled && !open && (
                <div className="px-1.5 pb-1.5 pl-7"><ClockControl i={i} /></div>
            )}
        </div>
    );
}

function LowerThirdFace({ element }) {
    // Which slot editors are open. Rows auto-open on a type pick and can be
    // collapsed back to a summary line; empty slots have nothing to expand.
    const [open, setOpen] = useState({});
    return (
        <Stack gap="sm">
            <DirectFace element={element} />
            <Stack gap="xs">
                {Array.from({ length: LT_SLOT_COUNT }, (_, k) => k + 1).map((i) => (
                    <LowerThirdSlotRow
                        key={i} i={i} expanded={!!open[i]}
                        setExpanded={(v) => setOpen(o => ({ ...o, [i]: v }))}
                    />
                ))}
            </Stack>
            <Text size="xs" className="text-muted-foreground">
                Slots render left → right; widths come from the design package. A Space
                slot splits the band and pushes content to the corners.
            </Text>
        </Stack>
    );
}

// Merch image picker: choose from /branding/merch uploads, or upload a new one
// (immediate — an upload is a library action, not a broadcast change; the pick
// itself stages through the caller's onChange).
function MerchImagePicker({ value, onChange }) {
    const [images, setImages] = useState([]);
    const fileRef = useRef(null);
    useEffect(() => {
        fetch('/api/v1/branding/merch')
            .then(r => (r.ok ? r.json() : { images: [] }))
            .then(d => setImages(d.images || []))
            .catch(() => {});
    }, []);
    const upload = async (file) => {
        const fd = new FormData();
        fd.append('file', file);
        try {
            const r = await fetch('/api/v1/branding/merch', { method: 'POST', body: fd });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d?.detail || `HTTP ${r.status}`);
            setImages(d.images || []);
            onChange(d.name);
        } catch (e) {
            notifications.show({ message: `Merch upload failed: ${e?.message || e}`, color: 'red' });
        }
    };
    return (
        <Group gap="xs" className="flex-nowrap items-center">
            <select className={LT_INPUT} value={value || ''} onChange={(e) => onChange(e.target.value)}>
                <option value="">— No image —</option>
                {images.map(im => <option key={im.name} value={im.name}>{im.name}</option>)}
            </select>
            <input
                ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
            />
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>Upload</Button>
        </Group>
    );
}

// Bracket phase-group picker for the Bracket slot: lists the loaded start.gg
// event's phases and loads one into the shared bracket.* state. Loading is
// momentary (like the Competition tab's own selector), not staged.
function BracketPhasePicker() {
    const [phases, setPhases] = useState(null);
    const [busy, setBusy] = useState(false);
    const phaseName = useStateStore(s => s?.bracket?.phaseName || '');
    useEffect(() => {
        fetch('/api/v1/startgg/phases')
            .then(r => (r.ok ? r.json() : []))
            .then(p => setPhases(Array.isArray(p) ? p : []))
            .catch(() => setPhases([]));
    }, []);
    const options = (phases || []).flatMap(p => (p.phaseGroups || []).map(g => ({
        value: String(g.id),
        label: (p.phaseGroups || []).length > 1
            ? `${p.name} — ${g.displayIdentifier || g.id}`
            : (p.name || String(g.id)),
    })));
    const load = async (id) => {
        if (!id) return;
        setBusy(true);
        try {
            const r = await fetch(`/api/v1/startgg/load-bracket?phase_group_id=${id}`, { method: 'POST' });
            if (!r.ok) {
                const d = await r.json().catch(() => ({}));
                throw new Error(d?.detail || `HTTP ${r.status}`);
            }
        } catch (e) {
            notifications.show({ message: `Bracket load failed: ${e?.message || e}`, color: 'red' });
        } finally { setBusy(false); }
    };
    if (phases !== null && options.length === 0) {
        return (
            <Text size="xs" className="text-muted-foreground">
                No start.gg event loaded — load one on the Competition tab. The slot shows the loaded phase{phaseName ? ` (${phaseName})` : ''}.
            </Text>
        );
    }
    return (
        <Stack gap="none">
            <Text size="xs" className="text-muted-foreground">Load phase{phaseName ? ` (showing: ${phaseName})` : ''}</Text>
            <select className={LT_INPUT} disabled={busy} value="" onChange={(e) => load(e.target.value)}>
                <option value="">— Pick a phase to load —</option>
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
        </Stack>
    );
}

// One slot's content editor (expanded in place under the face row). Every
// field routes through the staging gateway with the slot's key prefix.
function LowerThirdSlotFields({ i }) {
    const { matches, slot, val, isStaged, setKey } = useLowerThird();
    const activeRaw = useSettingsStore(s => s?.scoreboards?.active ?? [1]);
    const aliases = useSettingsStore(s => s?.scoreboards?.aliases ?? {});
    const active = Array.isArray(activeRaw) && activeRaw.length ? activeRaw : [1];
    const sbLabel = (n) => aliases?.[n] || aliases?.[String(n)] || `Scoreboard ${n}`;

    const s = slot(i);
    const p = (k) => `slots.${i}.${k}`;
    const type = val(p('type'), s.type) || '';
    const enabled = !!val(p('enabled'), s.enabled);
    const c = s.clock || {};
    const clockMode = val(p('clock.mode'), c.mode) || 'off';

    // Plain render helpers (NOT nested components): a component defined inside
    // render gets a new identity every pass, which remounts the <input> and
    // drops focus mid-keystroke. Function calls keep the element type stable.
    const fieldLabel = (k, children) => (
        <Group gap="xs" className="items-center">
            <Text size="xs" className="text-muted-foreground">{children}</Text>
            <StagedDot show={isStaged(p(k))} />
        </Group>
    );
    const textField = (k, placeholder, live) => (
        <input
            className={LT_INPUT} value={val(p(k), live) || ''} placeholder={placeholder}
            onChange={(e) => setKey(p(k), e.target.value, `Lower third: slot ${i} ${k}`)}
        />
    );

    return (
        <Stack gap="xs">
            {type === 'logo' && (
                <label className="flex flex-col gap-1">
                    {fieldLabel('title', 'Caption (optional; logo comes from Branding)')}
                    {textField('title', 'e.g. NNL Season 7', s.title)}
                </label>
            )}

            {type === 'match' && (
                <>
                    <label className="flex flex-col gap-1">
                        {fieldLabel('matchId', 'Match')}
                        <select
                            className={LT_INPUT}
                            value={val(p('matchId'), s.matchId) != null && val(p('matchId'), s.matchId) !== '' ? String(val(p('matchId'), s.matchId)) : ''}
                            onChange={(e) => setKey(p('matchId'), e.target.value || null, `Lower third: slot ${i} match`)}
                        >
                            <option value="">— None —</option>
                            {Object.keys(matches || {}).map(id => (
                                <option key={id} value={id}>{matchDisplayLabel(matches, id)}</option>
                            ))}
                        </select>
                    </label>
                    <Group gap="xs" className="items-center">
                        <div className="min-w-0 flex-1">
                            <SegmentedControl
                                data={[{ label: 'Up Next', value: 'upnext' }, { label: 'Current', value: 'current' }]}
                                value={val(p('role'), s.role) === 'current' ? 'current' : 'upnext'}
                                onChange={(v) => setKey(p('role'), v, `Lower third: slot ${i} role`)}
                            />
                        </div>
                        <StagedDot show={isStaged(p('role'))} />
                    </Group>
                    {textField('status', 'Status override (e.g. LIVE)', s.status)}
                </>
            )}

            {type === 'scorebox' && (
                <label className="flex flex-col gap-1">
                    {fieldLabel('scoreboard', 'Scoreboard')}
                    <select
                        className={LT_INPUT}
                        value={String(val(p('scoreboard'), s.scoreboard) || active[0])}
                        onChange={(e) => setKey(p('scoreboard'), parseInt(e.target.value) || 1, `Lower third: slot ${i} scoreboard`)}
                    >
                        {active.map(n => <option key={n} value={n}>{sbLabel(n)}</option>)}
                    </select>
                </label>
            )}

            {type === 'merch' && (
                <>
                    <Group gap="xs" className="items-center">
                        <div className="min-w-0 flex-1">
                            <MerchImagePicker
                                value={val(p('image'), s.image) || ''}
                                onChange={(name) => setKey(p('image'), name, `Lower third: slot ${i} merch image`)}
                            />
                        </div>
                        <StagedDot show={isStaged(p('image'))} />
                    </Group>
                    {textField('title', 'Title (e.g. New tees in the shop)', s.title)}
                    {textField('subtitle', 'Subtitle (e.g. shop.example.com)', s.subtitle)}
                </>
            )}

            {type === 'clock' && (
                <>
                    <label className="flex flex-col gap-1">
                        {fieldLabel('clock.mode', 'Clock')}
                        <select
                            className={LT_INPUT} value={clockMode}
                            onChange={(e) => setKey(p('clock.mode'), e.target.value, `Lower third: slot ${i} clock mode`)}
                        >
                            <option value="off">Off</option>
                            <option value="countdown">Countdown</option>
                            <option value="countup">Count up</option>
                            <option value="clock">Time of day</option>
                        </select>
                    </label>
                    {clockMode === 'countdown' && (
                        <Group gap="xs" className="flex-nowrap items-center">
                            {fieldLabel('clock.durationSec', 'Minutes')}
                            <input
                                type="number" min={0} step={1} className={LT_INPUT}
                                value={Math.round(((val(p('clock.durationSec'), c.durationSec)) || 300) / 60)}
                                onChange={(e) => setKey(p('clock.durationSec'), Math.max(0, Number(e.target.value) || 0) * 60, `Lower third: slot ${i} countdown length`)}
                            />
                        </Group>
                    )}
                    {(clockMode === 'countdown' || clockMode === 'clock')
                        && textField('clock.label', 'Clock label (e.g. BACK IN)', c.label)}
                    {enabled && clockMode !== 'off' && <ClockControl i={i} />}
                </>
            )}

            {type === 'message' && (
                <>
                    {textField('title', 'Title (e.g. Winners Final)', s.title)}
                    {textField('subtitle', 'Subtitle (e.g. NNL Season 7)', s.subtitle)}
                </>
            )}

            {type === 'bracket' && (
                <>
                    <BracketPhasePicker />
                    {textField('title', 'Title override (defaults to phase name)', s.title)}
                    {textField('subtitle', 'Subtitle (optional)', s.subtitle)}
                </>
            )}

            {type === 'space' && (
                <label className="flex flex-col gap-1">
                    {fieldLabel('width', 'Gap width in px (blank = fill / split to the corners)')}
                    <input
                        type="number" min={0} step={10} className={LT_INPUT} placeholder="Fill"
                        value={val(p('width'), s.width) || ''}
                        onChange={(e) => setKey(p('width'), e.target.value === '' ? 0 : Math.max(0, Number(e.target.value) || 0), `Lower third: slot ${i} gap width`)}
                    />
                    <Text size="xs" className="text-muted-foreground">
                        Breaks the band into two cards — content before and after this slot separates into its own corner.
                    </Text>
                </label>
            )}
        </Stack>
    );
}

// ── Upcoming Schedule ────────────────────────────────────────────────────────
// The producer's ordered match queue (schedule.queue → match.{M}), rendered by
// the schedule overlay. Authoring is immediate (like the Match tab): the queue
// is prep, and the overlay only shows once its OBS source is revealed — which
// is the staged/live decision. Reorders send the whole list back (PUT
// /schedule); per-match display time writes match.{m}.scheduledAt.

async function putSchedule(body) {
    try {
        const r = await fetch('/api/v1/schedule', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(d?.detail || `HTTP ${r.status}`);
        }
    } catch (e) {
        notifications.show({ message: `Schedule: ${e?.message || e}`, color: 'red' });
    }
}

// Per-match display time ("6:30 PM", "After break"). Uncontrolled + commit on
// blur/Enter so live state echoes don't fight the keystroke.
function ScheduleTimeField({ m, initial }) {
    const ref = useRef(null);
    useEffect(() => { if (ref.current && document.activeElement !== ref.current) ref.current.value = initial || ''; }, [initial]);
    const commit = () => {
        const v = ref.current?.value ?? '';
        if (v !== (initial || '')) updateMatch(m, { scheduledAt: v });
    };
    return (
        <input
            ref={ref} defaultValue={initial || ''} placeholder="Time"
            className="h-7 w-24 shrink-0 rounded-md border border-border bg-card px-2 text-xs text-foreground"
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
    );
}

function ScheduleFace({ element }) {
    const queueRaw = useStateStore(useShallow(s => s?.schedule?.queue ?? []));
    const matches = useStateStore(useShallow(s => s?.match ?? {}));
    const queue = (Array.isArray(queueRaw) ? queueRaw : []).filter(id => matches?.[String(id)]);

    const move = (idx, dir) => {
        const next = [...queue];
        const j = idx + dir;
        if (j < 0 || j >= next.length) return;
        [next[idx], next[j]] = [next[j], next[idx]];
        putSchedule({ queue: next });
    };
    const remove = (idx) => putSchedule({ queue: queue.filter((_, k) => k !== idx) });
    const add = (id) => { if (id) putSchedule({ queue: [...queue, parseInt(id)] }); };

    const available = Object.keys(matches || {}).filter(id => !queue.some(q => String(q) === id));

    return (
        <Stack gap="sm">
            <DirectFace element={element} />
            {queue.length === 0 && (
                <Text size="xs" className="text-muted-foreground">
                    No matches queued. Create matches in the Draft bar or Match tab, then add them here.
                </Text>
            )}
            <Stack gap="xs">
                {queue.map((id, idx) => {
                    const m = matches[String(id)] || {};
                    const decided = m?.decided === 1 || m?.decided === 2 || m?.decided === '1' || m?.decided === '2';
                    const live = !decided && m?.stage === 'live';
                    return (
                        <Group key={`${id}-${idx}`} gap="xs" className="flex-nowrap items-center">
                            <MoveButtons
                                label={`queued match ${idx + 1}`}
                                canUp={idx > 0} canDown={idx < queue.length - 1}
                                onUp={() => move(idx, -1)} onDown={() => move(idx, 1)}
                            />
                            <Text size="sm" className={cn('min-w-0 flex-1 truncate', decided ? 'text-muted-foreground line-through' : 'text-foreground')}>
                                {matchDisplayLabel(matches, String(id))}
                            </Text>
                            {live && <Badge variant="outline" className="shrink-0 border-emerald-500/50 text-emerald-500">LIVE</Badge>}
                            <ScheduleTimeField m={id} initial={m?.scheduledAt || ''} />
                            <Button size="icon-sm" variant="ghost" onClick={() => remove(idx)} aria-label="Remove">
                                <X size={13} />
                            </Button>
                        </Group>
                    );
                })}
            </Stack>
            {available.length > 0 && (
                <select
                    className={LT_INPUT} value=""
                    onChange={(e) => { add(e.target.value); }}
                >
                    <option value="">+ Add match to schedule…</option>
                    {available.map(id => <option key={id} value={id}>{matchDisplayLabel(matches, id)}</option>)}
                </select>
            )}
        </Stack>
    );
}

// Gear: the overlay heading. Uncontrolled + commit-on-blur like the time field.
function ScheduleSetup() {
    const title = useStateStore(s => s?.schedule?.title ?? '');
    const ref = useRef(null);
    useEffect(() => { if (ref.current && document.activeElement !== ref.current) ref.current.value = title || ''; }, [title]);
    return (
        <label className="flex flex-col gap-1">
            <Text size="xs" className="text-muted-foreground">Heading (overlay title)</Text>
            <input
                ref={ref} defaultValue={title || ''} placeholder="Upcoming Matches" className={LT_INPUT}
                onBlur={() => { const v = ref.current?.value ?? ''; if (v !== (title || '')) putSchedule({ title: v }); }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            />
        </label>
    );
}

// ── Draft bar (match authoring) ─────────────────────────────────────────────
// The condensed match-creation surface for the Draft phase (the full authoring
// panel lives on the Match tab). A match projects onto its bound boards —
// broadcast-visible — so every edit here routes through the staging gateway
// (key `match:{m}:{path}`); the Match tab stays immediate like other full tabs.
// Creating a match and lifecycle hops (Next game) are authoring/momentary and
// run immediately.

// 'player.1.captain' → { player: { 1: { captain: value } } } for the merge PUT.
function nestPath(path, value) {
    const out = {};
    let cur = out;
    const keys = path.split('.');
    for (let i = 0; i < keys.length - 1; i++) cur = (cur[keys[i]] = {});
    cur[keys[keys.length - 1]] = value;
    return out;
}

// match.{m} with staged-value display, mirroring useLowerThird: `val(path,
// live)` returns the pending value when one is staged; `setField` stages one
// field write whose commit is the merge PUT.
function useMatchDraft(m) {
    const match = useStateStore(s => s?.match?.[m]);
    const pendingMap = useStagingStore(s => s.pending);
    const val = (path, live) => {
        const p = pendingMap[`match:${m}:${path}`];
        return p ? p.value : live;
    };
    const isStaged = (path) => !!pendingMap[`match:${m}:${path}`];
    const setField = (path, value, label) => stageOrRun({
        key: `match:${m}:${path}`,
        label: label || `Match ${m}: ${path}`,
        value,
        run: () => updateMatch(m, nestPath(path, value)),
    });
    return { match, val, isStaged, setField };
}

const DB_FIELD = 'h-8 rounded-md border border-border bg-card px-2 text-sm text-foreground';

// Captain character icon, with a graceful fallback to initials when the image
// pack isn't installed (404). `size` in px for both the box and the image.
function CaptainIcon({ name, urls, size = 34 }) {
    const [broken, setBroken] = useState(false);
    if (broken) {
        const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2);
        return <span className="text-[10px] font-semibold leading-none text-muted-foreground">{initials}</span>;
    }
    return (
        <img
            src={urls.charIcon(name)} alt="" width={size} height={size}
            onError={() => setBroken(true)}
            className="object-contain"
            style={{ width: size, height: size }}
        />
    );
}

// The captain-picker grid — a 3×4 board of character icons, faster to scan and
// hit than a scroll list. Keyboard: type a captain's first letter to select it;
// repeating the same letter cycles through every captain that starts with it
// (B → Birdo → Bowser → Bowser Jr, D → Daisy → Diddy → DK). Lives inside the
// CaptainSelect dropdown; `autoFocus` grabs the keyboard when the popover opens.
function CaptainGrid({ value, onChange, autoFocus = false, className }) {
    const urls = useAssetUrls();
    const ref = useRef(null);
    useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

    const onKeyDown = (e) => {
        if (e.key.length !== 1 || !/[a-z]/i.test(e.key)) return;
        const letter = e.key.toUpperCase();
        const group = MSB_CAPTAINS.filter(c => c[0].toUpperCase() === letter);
        if (!group.length) return;
        e.preventDefault();
        const at = group.indexOf(value);
        onChange(at === -1 ? group[0] : group[(at + 1) % group.length]);
    };

    return (
        <div
            ref={ref}
            role="listbox"
            aria-label="Captain"
            tabIndex={0}
            onKeyDown={onKeyDown}
            className={cn('grid grid-cols-4 gap-1 outline-none', className)}
        >
            {MSB_CAPTAINS.map((c) => {
                const selected = value === c;
                return (
                    <SimpleTooltip key={c} label={c}>
                        <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() => onChange(selected ? '' : c)}
                            className={cn(
                                'flex aspect-square items-center justify-center rounded-md border transition-colors',
                                selected
                                    ? 'border-primary bg-primary/15 ring-1 ring-primary'
                                    : 'border-transparent hover:border-border hover:bg-muted/40',
                            )}
                        >
                            <CaptainIcon name={c} urls={urls} />
                        </button>
                    </SimpleTooltip>
                );
            })}
        </div>
    );
}

// Captain dropdown: a standard select-style trigger (chosen icon + name) that
// opens a popover containing the icon grid. Picking closes it.
function CaptainSelect({ value, onChange, className }) {
    const [open, setOpen] = useState(false);
    const urls = useAssetUrls();
    const pick = (c) => { onChange(c); setOpen(false); };
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(DB_FIELD, 'flex items-center justify-between gap-1.5',
                        !value && 'text-muted-foreground', className)}
                >
                    <span className="flex min-w-0 items-center gap-1.5">
                        {value && <CaptainIcon name={value} urls={urls} size={18} />}
                        <span className="truncate">{value || 'Captain…'}</span>
                    </span>
                    <ChevronDown className="size-3.5 shrink-0 opacity-50" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-2">
                <CaptainGrid value={value} onChange={pick} autoFocus className="w-[184px]" />
            </PopoverContent>
        </Popover>
    );
}

// Canonical Dolphin controller-port colours (P1 red, P2 blue, P3 yellow, P4
// green) — mirrors PORT_COLORS in the overlay mounts so the producer sees the
// same colour the broadcast will use.
const PORT_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];

// Controller-port dropdown for a side. Stored 0-indexed (matches the HUD's
// Away/Home Port and the projected score.{N}.player.{T}.port); shown as P1–P4
// with the port's broadcast colour. Native <option> can't render a swatch, so
// this is a small Popover.
function PortSelect({ value, onChange, className }) {
    const [open, setOpen] = useState(false);
    const idx = value === '' || value == null ? null : Number(value);
    const dot = (i) => (
        <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: PORT_COLORS[i] }} />
    );
    const choose = (v) => { onChange(v); setOpen(false); };
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label="Controller port"
                    className={cn(DB_FIELD, 'flex items-center gap-1.5', idx == null && 'text-muted-foreground', className)}
                >
                    {idx == null ? <span>Port</span> : <>{dot(idx)}<span>P{idx + 1}</span></>}
                    <ChevronDown className="size-3.5 shrink-0 opacity-50" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-28 p-1">
                <Stack gap="none">
                    <button
                        type="button"
                        onClick={() => choose(null)}
                        className={cn('flex items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted/50',
                            idx == null && 'text-foreground')}
                    >
                        <span className="size-2.5 shrink-0" />
                        <span className="text-muted-foreground">None</span>
                    </button>
                    {[0, 1, 2, 3].map(p => (
                        <button
                            key={p}
                            type="button"
                            onClick={() => choose(p)}
                            className={cn('flex items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted/50',
                                idx === p && 'bg-muted/40')}
                        >
                            {dot(p)}
                            <span>P{p + 1}</span>
                            {idx === p && <Check className="ml-auto size-3.5" />}
                        </button>
                    ))}
                </Stack>
            </PopoverContent>
        </Popover>
    );
}

// Searchable game-mode combobox (Popover + Command). Flex-fills the settings
// row; the value is the raw game-mode name (empty = unset).
function GameModeSelect({ value, modes, onChange, className }) {
    const [open, setOpen] = useState(false);
    const choose = (v) => { onChange(v); setOpen(false); };
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(DB_FIELD, 'flex items-center justify-between gap-1.5',
                        !value && 'text-muted-foreground', className)}
                >
                    <span className="truncate">{value || 'Game mode…'}</span>
                    <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-52 p-0">
                <Command>
                    <CommandInput placeholder="Search modes…" />
                    <CommandList>
                        <CommandEmpty>No mode.</CommandEmpty>
                        <CommandGroup>
                            <CommandItem value="__none__" onSelect={() => choose('')}>
                                <span className="text-muted-foreground">None</span>
                                <Check className={cn('ml-auto size-4', !value ? 'opacity-100' : 'opacity-0')} />
                            </CommandItem>
                            {modes.map(g => (
                                <CommandItem key={g} value={g} onSelect={() => choose(g)}>
                                    <span className="truncate">{g}</span>
                                    <Check className={cn('ml-auto size-4', value === g ? 'opacity-100' : 'opacity-0')} />
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

// One side of the draft: participant pick + captain, one row. A staged pick
// carries a client-only _name display tag (the projection hasn't resolved it
// yet), stripped by the commit PUT which only sends participantId + rioName.
function DraftSide({ m, side, draft }) {
    const live = draft.match?.player?.[side] ?? draft.match?.player?.[String(side)] ?? {};
    const pick = draft.val(`player.${side}.pick`, null);
    const name = pick ? (pick._name || pick.rioName) : (live.rioName || '');
    const selectedId = pick ? pick.participantId : (live.participantId || null);
    const captain = draft.val(`player.${side}.captain`, live.captain || '');
    const port = draft.val(`player.${side}.port`, live.port ?? null);

    const onPick = (row) => {
        const rioName = row.identities?.rioName || '';
        const display = row.display?.tag || rioName || 'participant';
        stageOrRun({
            key: `match:${m}:player.${side}.pick`,
            label: `Match ${m} side ${side}: ${display}`,
            value: { participantId: row.id, rioName, _name: display },
            run: () => updateMatch(m, { player: { [side]: { participantId: row.id, rioName } } }),
        });
    };

    return (
        <Stack gap="xs" className="min-w-0 flex-1">
            <Group gap="xs" className="min-w-0 flex-nowrap items-center">
                <StagedDot show={draft.isStaged(`player.${side}.pick`)} />
                <div className="min-w-0 flex-1">
                    <ParticipantPicker
                        value={name}
                        selectedId={selectedId}
                        onResolve={onPick}
                        placeholder="Pick participant…"
                    />
                </div>
            </Group>
            <Group gap="xs" className="flex-nowrap items-center">
                <StagedDot show={draft.isStaged(`player.${side}.captain`)} />
                <CaptainSelect
                    value={captain || ''}
                    onChange={(v) => draft.setField(`player.${side}.captain`, v,
                        `Match ${m} side ${side}: captain ${v || 'cleared'}`)}
                    className="min-w-0 flex-1"
                />
                <StagedDot show={draft.isStaged(`player.${side}.port`)} />
                <PortSelect
                    value={port}
                    onChange={(v) => draft.setField(`player.${side}.port`, v,
                        `Match ${m} side ${side}: ${v == null ? 'port cleared' : `port P${v + 1}`}`)}
                />
            </Group>
        </Stack>
    );
}

// Series wins as "n – n" with per-side steppers (staged). Post-game capture
// advances this automatically; the steppers are the producer's correction.
function SeriesControl({ m, draft }) {
    const series = draft.match?.series || {};
    const bestOf = (draft.match?.format || {}).bestOf ?? 1;
    const winsFor = (side) => {
        const live = series[side] ?? series[String(side)] ?? 0;
        return Number(draft.val(`series.${side}`, live)) || 0;
    };
    const bump = (side, delta) => {
        const next = Math.max(0, winsFor(side) + delta);
        draft.setField(`series.${side}`, next, `Match ${m}: side ${side} series → ${next}`);
    };
    const staged = draft.isStaged('series.1') || draft.isStaged('series.2');

    const Step = ({ side, delta, children }) => (
        <button
            type="button"
            onClick={() => bump(side, delta)}
            className="px-1 text-muted-foreground hover:text-foreground"
            aria-label={`Side ${side} ${delta > 0 ? '+1' : '-1'} game`}
        >
            {children}
        </button>
    );

    return (
        <Group gap="none" className="items-center rounded-md border border-border bg-card px-1.5 py-1">
            <Text size="xs" className="mr-1 text-muted-foreground">Series</Text>
            <Step side={1} delta={-1}>–</Step>
            <Text size="sm" className="font-mono tabular-nums text-foreground">{winsFor(1)}</Text>
            <Step side={1} delta={1}>+</Step>
            <Text size="xs" className="mx-0.5 text-muted-foreground">:</Text>
            <Step side={2} delta={-1}>–</Step>
            <Text size="sm" className="font-mono tabular-nums text-foreground">{winsFor(2)}</Text>
            <Step side={2} delta={1}>+</Step>
            <StagedDot show={staged} />
        </Group>
    );
}

const DRAFT_STAGE_BADGE = {
    draft: 'bg-[#a855f7]/15 text-[#c084fc]',
    live:  'bg-emerald-500/15 text-emerald-300',
    post:  'bg-[#64748b]/15 text-[#94a3b8]',
};

// Human name for a side in the collapsed summary, falling back to a muted dash.
function sideName(match, side) {
    const p = match?.player?.[side] ?? match?.player?.[String(side)] ?? {};
    return p.rioName || '';
}

// The series-decided winner side (1|2) or null — the match's own `decided` flag
// when set (server arithmetic / producer force), else computed from the live
// series wins vs the Bo need. Drives the "Side N wins" badge in the header.
function clinchedSide(match) {
    const d = match?.decided;
    if (d === 1 || d === '1') return 1;
    if (d === 2 || d === '2') return 2;
    const bestOf = (match?.format || {}).bestOf ?? 1;
    const need = Math.floor(bestOf / 2) + 1;
    const w1 = Number(match?.series?.[1] ?? match?.series?.['1'] ?? 0);
    const w2 = Number(match?.series?.[2] ?? match?.series?.['2'] ?? 0);
    return w1 >= need ? 1 : w2 >= need ? 2 : null;
}

// One match, rendered as a collapsible accordion inside the Match card.
// Collapsed: a one-line summary — "A vs B · Bo3 · 1–0 · ‹stage›" (no side
// numbers; position is the identity). Expanded: the full condensed editor —
// start.gg + phase, the two sides (participant + captain grid), then mode / Bo /
// series / board binds. Every broadcast-visible edit routes through the staging
// gateway; New / Next game / Delete are momentary. Deletable via the header
// trash (a two-step Popover confirm, no blocking browser dialog).
function MatchAccordion({ m, open, onToggle, active, boundMap, gameModes }) {
    const draft = useMatchDraft(m);
    const stage = draft.match?.stage || 'draft';
    const [confirmDel, setConfirmDel] = useState(false);

    const onPickSet = (s) => stageOrRun({
        key: `match:${m}:startgg`,
        label: `Load set: ${s.p1_name || 'TBD'} vs ${s.p2_name || 'TBD'}`,
        value: s.id,
        run: () => loadStartGGSet(Number(m), s.id),
    });
    const onNextGame = () => {
        updateMatch(Number(m), { stage: 'draft' })
            .catch(e => notifications.show({ message: `Next game: ${e?.message || e}`, color: 'red' }));
    };
    const onDelete = () => {
        setConfirmDel(false);
        deleteMatch(Number(m))
            .catch(e => notifications.show({ message: `Delete match: ${e?.message || e}`, color: 'red' }));
    };
    // Board binding is radio-style: a match fills exactly one board. Selecting a
    // board unbinds any OTHER board this match currently holds (score.{N}.match
    // is single-valued, so binding here already steals the board from whatever
    // match had it); clicking the selected board again clears it.
    const unbind = (sb) => stageOrRun({
        key: `bind:${sb}`,
        label: `Unbind board ${sb}`,
        value: null,
        liveValue: boundMap[sb] != null ? Number(boundMap[sb]) : null,
        run: () => bindScoreboard(sb, null),
    });
    const selectBoard = (sb) => {
        if (String(boundMap[sb]) === String(m)) { unbind(sb); return; }
        for (const other of active) {
            if (other !== sb && String(boundMap[other]) === String(m)) unbind(other);
        }
        stageOrRun({
            key: `bind:${sb}`,
            label: `Bind board ${sb} → match ${m}`,
            value: Number(m),
            liveValue: boundMap[sb] != null ? Number(boundMap[sb]) : null,
            run: () => bindScoreboard(sb, Number(m)),
        });
    };

    const phase = draft.val('label', draft.match?.label || '');
    const gameMode = draft.val('gameMode', draft.match?.gameMode || '');
    const bestOf = draft.val('format.bestOf', (draft.match?.format || {}).bestOf ?? 1);
    const w1 = draft.match?.series?.[1] ?? draft.match?.series?.['1'] ?? 0;
    const w2 = draft.match?.series?.[2] ?? draft.match?.series?.['2'] ?? 0;
    const n1 = sideName(draft.match, 1);
    const n2 = sideName(draft.match, 2);
    const decided = clinchedSide(draft.match);

    return (
        <div className="overflow-hidden rounded-md border border-border">
            {/* Header row — summary is the toggle; stage badge + delete sit beside it. */}
            <div className="flex items-center gap-2 bg-muted/20 px-2 py-1.5">
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                    <ChevronRight
                        size={14}
                        className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
                    />
                    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm">
                        <span className="min-w-0 truncate text-foreground">
                            {n1 || <span className="text-muted-foreground">TBD</span>}
                            <span className="mx-1.5 text-muted-foreground">vs</span>
                            {n2 || <span className="text-muted-foreground">TBD</span>}
                        </span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">Bo{bestOf}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="font-mono text-xs tabular-nums text-foreground">{w1}–{w2}</span>
                    </span>
                </button>
                {decided && (
                    <Badge className="shrink-0 bg-emerald-500/15 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                        Side {decided} wins
                    </Badge>
                )}
                <Badge className={cn('shrink-0 text-[10px] font-semibold uppercase tracking-wider',
                    DRAFT_STAGE_BADGE[stage] || DRAFT_STAGE_BADGE.draft)}>
                    {stage}
                </Badge>
                {stage === 'post' && (
                    <Button size="xs" variant="secondary" onClick={onNextGame} className="shrink-0">
                        Next game
                    </Button>
                )}
                <Popover open={confirmDel} onOpenChange={setConfirmDel}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            aria-label={`Delete match ${m}`}
                            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                            <Trash2 size={14} />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-56">
                        <Stack gap="xs">
                            <Text size="sm" className="text-foreground">Delete this match?</Text>
                            <Text size="xs" className="text-muted-foreground">
                                Unbinds and blanks any boards it fills.
                            </Text>
                            <Group gap="xs" className="justify-end">
                                <Button size="xs" variant="ghost" onClick={() => setConfirmDel(false)}>Cancel</Button>
                                <Button size="xs" variant="destructive" onClick={onDelete}>Delete</Button>
                            </Group>
                        </Stack>
                    </PopoverContent>
                </Popover>
            </div>

            {open && (
                <div className="border-t border-border p-2.5">
                    <Stack gap="sm">
                        {/* start.gg load + bracket phase (the round label, projected to the board). */}
                        <Group gap="xs" className="flex-nowrap items-center">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button size="xs" variant="secondary" className="shrink-0">
                                        <Trophy size={13} className="mr-1" /> start.gg
                                        <StagedDot show={draft.isStaged('startgg')} />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-96">
                                    <StartggSetPicker onPick={onPickSet} pickLabel="Use" />
                                </PopoverContent>
                            </Popover>
                            <StagedDot show={draft.isStaged('label')} />
                            <input
                                type="text"
                                value={phase}
                                onChange={(e) => draft.setField('label', e.target.value,
                                    `Match ${m}: phase ${e.target.value || 'cleared'}`)}
                                placeholder="Bracket phase (e.g. Winners R2)…"
                                className={cn(DB_FIELD, 'min-w-0 flex-1')}
                            />
                        </Group>

                        {/* The two sides, side-by-side. Position is the identity — no numbers. */}
                        <Group gap="sm" className="flex-nowrap items-start">
                            <DraftSide m={m} side={1} draft={draft} />
                            <Text size="xs" className="mt-2 shrink-0 text-muted-foreground">vs</Text>
                            <DraftSide m={m} side={2} draft={draft} />
                        </Group>

                        {/* Game mode fills the width left by Best-of + Series. */}
                        <Group gap="sm" className="flex-nowrap items-center">
                            <StagedDot show={draft.isStaged('gameMode')} />
                            <GameModeSelect
                                value={gameMode || ''}
                                modes={gameModes}
                                onChange={(v) => draft.setField('gameMode', v,
                                    `Match ${m}: mode ${v || 'cleared'}`)}
                                className="min-w-0 flex-1"
                            />
                            <Group gap="xs" className="shrink-0 items-center">
                                <StagedDot show={draft.isStaged('format.bestOf')} />
                                <select
                                    value={String(bestOf)}
                                    onChange={(e) => draft.setField('format.bestOf', parseInt(e.target.value, 10),
                                        `Match ${m}: Bo${e.target.value}`)}
                                    className={cn(DB_FIELD, 'w-[76px]')}
                                >
                                    {[1, 3, 5, 7].map(n => <option key={n} value={n}>Bo{n}</option>)}
                                </select>
                            </Group>
                            <SeriesControl m={m} draft={draft} />
                        </Group>

                        <Group gap="xs" className="items-center">
                            <Text size="xs" className="text-muted-foreground">Board</Text>
                            {active.map(sb => (
                                <BindChip
                                    key={sb} sb={sb}
                                    bound={String(boundMap[sb]) === String(m)}
                                    elsewhere={boundMap[sb] != null && String(boundMap[sb]) !== String(m)}
                                    radio
                                    onClick={() => selectBoard(sb)}
                                />
                            ))}
                        </Group>
                    </Stack>
                </div>
            )}
        </div>
    );
}

// The Match card — the Draft-phase authoring surface, rendered as its own
// half-width element window. Holds a stack of match accordions (one per match)
// and a New-match button; a match binds to at most one board (score.{N}.match
// is a single value — rebinding a board moves it), so a board bound elsewhere
// shows on other matches as a muted "on board N" chip you can steal.
function MatchCard() {
    const matches = useStateStore(useShallow(s => s?.match ?? {}));
    const activeRaw = useSettingsStore(s => s?.scoreboards?.active ?? [1]);
    const active = Array.isArray(activeRaw) && activeRaw.length ? activeRaw : [1];
    const boundMap = useStateStore(useShallow(s => {
        const out = {};
        for (const sb of active) out[sb] = s?.score?.[sb]?.match ?? s?.score?.[String(sb)]?.match ?? null;
        return out;
    }));
    const [gameModes, setGameModes] = useState([]);
    const [creating, setCreating] = useState(false);
    // Single-open accordion. `null` means "default to newest"; '' means the user
    // explicitly collapsed everything; else the open match id.
    const [openId, setOpenId] = useState(null);

    useEffect(() => {
        fetch('/api/v1/rio/game-modes')
            .then(r => r.json())
            .then(data => setGameModes(Object.keys(data)))
            .catch(() => {});
    }, []);

    const ids = useMemo(
        () => Object.keys(matches).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b)),
        [matches],
    );
    const newestId = ids[ids.length - 1] || null;
    const effectiveOpen = openId === null ? newestId : (openId || null);

    const onNew = async () => {
        setCreating(true);
        try {
            const { id } = await createMatch();
            setOpenId(String(id));
        } catch (e) {
            notifications.show({ message: `New match: ${e?.message || e}`, color: 'red' });
        } finally { setCreating(false); }
    };

    return (
        <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-1.5">
                <Text size="sm" className="min-w-0 flex-1 truncate font-medium text-foreground">Match</Text>
                {ids.length > 0 && (
                    <Text size="xs" className="shrink-0 text-muted-foreground">{ids.length}</Text>
                )}
            </div>
            <div className="min-h-0 flex-1 p-2.5">
                {ids.length === 0 ? (
                    <Stack gap="sm" className="items-start">
                        <Text size="sm" className="text-muted-foreground">
                            No matches yet. Create one to author the fixture — participants, captains,
                            bracket phase, mode and format — then bind it to a board to project it onto
                            the broadcast.
                        </Text>
                        <Button size="xs" variant="outline" disabled={creating} onClick={onNew}>
                            <Plus size={13} className="mr-1" /> New match
                        </Button>
                    </Stack>
                ) : (
                    <Stack gap="xs">
                        {ids.map(id => (
                            <MatchAccordion
                                key={id}
                                m={id}
                                open={effectiveOpen === id}
                                onToggle={() => setOpenId(effectiveOpen === id ? '' : id)}
                                active={active}
                                boundMap={boundMap}
                                gameModes={gameModes}
                            />
                        ))}
                        <Button size="xs" variant="outline" disabled={creating} onClick={onNew} className="self-start">
                            <Plus size={13} className="mr-1" /> New match
                        </Button>
                    </Stack>
                )}
            </div>
        </div>
    );
}

// A board-bind chip, staged-aware (amber ring while the bind is pending). With
// `radio`, it carries a radio dot (filled when this match holds the board) to
// signal single-select — a match fills exactly one board. `elsewhere` = the
// board is currently bound to a DIFFERENT match; the chip reads as a dashed
// "steal it" affordance.
function BindChip({ sb, bound, elsewhere = false, radio = false, onClick }) {
    const pending = usePending(`bind:${sb}`);
    const displayBound = pending ? pending.value != null : bound;
    return (
        <SimpleTooltip label={elsewhere && !displayBound ? `Bound to another match — click to move board ${sb} here` : undefined}>
            <Button
                size="xs"
                variant={displayBound ? 'default' : 'outline'}
                onClick={onClick}
                role={radio ? 'radio' : undefined}
                aria-checked={radio ? displayBound : undefined}
                className={cn(
                    'gap-1.5',
                    pending && 'ring-1 ring-amber-400',
                    !displayBound && elsewhere && 'border-dashed text-muted-foreground',
                )}
            >
                {radio && (
                    <span className={cn(
                        'inline-flex size-3 shrink-0 items-center justify-center rounded-full border',
                        displayBound ? 'border-current' : 'border-muted-foreground/60',
                    )}>
                        {displayBound && <span className="size-1.5 rounded-full bg-current" />}
                    </span>
                )}
                Board {sb}
            </Button>
        </SimpleTooltip>
    );
}

// ── Matchup History ──────────────────────────────────────────────────────────
// Direct element: the head-to-head band. The producer picks a match and hits
// Fetch — the server pulls every completed game between its two participants
// from the Project Rio API and projects the singleton matchup.* state that the
// overlay renders. Fetching REPLACES broadcast-visible content, so it routes
// through the staging gateway (one entry, key 'matchup:fetch').
function MatchupFace({ element }) {
    const mu = useStateStore(useShallow(s => s?.matchup ?? {}));
    const matches = useStateStore(useShallow(s => s?.match ?? {}));
    const pending = usePending('matchup:fetch');
    const [selRaw, setSelRaw] = useState('');

    const ids = useMemo(
        () => Object.keys(matches).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b)),
        [matches],
    );
    const sel = selRaw && matches[selRaw] ? selRaw
        : (mu.matchId != null && matches[String(mu.matchId)] ? String(mu.matchId) : (ids[0] || ''));

    const doFetch = () => stageOrRun({
        key: 'matchup:fetch',
        label: `Matchup: ${matchDisplayLabel(matches, sel)}`,
        value: sel,
        run: () => fetchMatchup(Number(sel)),
    });

    const fetchedFor = mu.matchId != null ? String(mu.matchId) : '';
    const stale = mu.present && sel && fetchedFor !== sel;

    return (
        <Stack gap="xs">
            <DirectFace element={element} />
            <Group gap="xs" className="flex-nowrap items-center">
                <select
                    value={sel}
                    onChange={(e) => setSelRaw(e.target.value)}
                    className={cn(DB_FIELD, 'h-7 min-w-0 flex-1 text-xs')}
                >
                    {ids.length === 0 && <option value="">No matches yet</option>}
                    {ids.map(id => <option key={id} value={id}>{matchDisplayLabel(matches, id)}</option>)}
                </select>
                <Button size="xs" disabled={!sel} onClick={doFetch} className={cn(pending && 'ring-1 ring-amber-400')}>
                    Fetch
                </Button>
                <StagedDot show={!!pending} />
            </Group>
            {mu.present ? (
                <Text size="xs" className={cn('truncate', stale ? 'text-amber-400' : 'text-muted-foreground')}>
                    {mu.side1?.rioName} {mu.side1?.wins}–{mu.side2?.wins} {mu.side2?.rioName}
                    {' · '}{mu.totalGames} game{mu.totalGames === 1 ? '' : 's'}
                    {stale ? ' (other match)' : ''}
                </Text>
            ) : (
                <Text size="xs" className="text-muted-foreground">
                    Nothing fetched yet — both sides need Rio names.
                </Text>
            )}
        </Stack>
    );
}

// Gear: clear the band (staged — clearing live content is broadcast-visible).
function MatchupSetup() {
    const present = useStateStore(s => s?.matchup?.present);
    const pending = usePending('matchup:fetch');
    const doClear = () => stageOrRun({
        key: 'matchup:fetch',
        label: 'Clear matchup',
        value: null,
        run: () => clearMatchup(),
    });
    return (
        <Stack gap="sm">
            <Text size="xs" className="text-muted-foreground">
                Head-to-head from the Project Rio API: all-time series + last five games
                between the match's two participants. Fetch again after new games finish.
            </Text>
            <Button size="xs" variant="ghost" disabled={!present && !pending} onClick={doClear} className="w-full">
                Clear matchup
            </Button>
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

    // Draft phase gets the Match authoring surface as its own half-width element
    // window (own box, like the other elements). It writes match state, not OBS,
    // so it renders regardless of the OBS connection — above the element body.
    const matchRow = phase === 'draft' ? (
        <div className="grid grid-cols-1 gap-3 p-4 pb-0 md:grid-cols-2">
            <MatchCard />
        </div>
    ) : null;

    let body;
    if (status !== 'connected') {
        body = (
            <Text size="sm" className="p-4 text-muted-foreground">
                Connect to OBS to control elements.
            </Text>
        );
    } else if (els.length === 0) {
        body = (
            <Stack gap="xs" className="items-center justify-center p-12 text-center">
                <Text className="text-foreground">No elements in {phaseLabel} yet</Text>
                <Text size="sm" className="text-muted-foreground">
                    This phase fills in as its elements ship.
                </Text>
            </Stack>
        );
    } else {
        // One CSS grid; packRows guarantees each visual row sums to 12 columns
        // (except possibly the last), and grid rows give same-height cards per row.
        body = (
            <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-12">
                {rows.flatMap(row =>
                    row.map(({ element, span }) =>
                        <ElementWindow key={element.id} element={element} span={span} />))}
            </div>
        );
    }

    return (
        <Panel title="Elements">
            {matchRow}
            {body}
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
