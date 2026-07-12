import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Copy, Check, RotateCw, RotateCcw, Settings as SettingsIcon, X } from 'lucide-react';
import { Stack, Text, Loader, Divider } from '../../components/ui/primitives';
import { Panel } from '../../components/ui/panel';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { TextField } from '../../components/ui/text-field';
import { NumberInput } from '../../components/ui/number-input';
import { ColorInput } from '../../components/ui/color-input';
import { Combobox } from '../../components/ui/combobox';
import { FontCombobox } from '../../components/ui/font-combobox';
import { SimpleSelect } from '../../components/ui/simple-select';
import { Switch } from '../../components/ui/switch';
import { Collapsible, CollapsibleContent } from '../../components/ui/collapsible';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import { CopyButton } from '../../components/ui/copy-button';
import { FileButton } from '../../components/ui/file-button';
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
} from '../../components/ui/dropdown-menu';
import { cn } from '../../lib/utils';
import { notifications } from '../../lib/notify';
import { useSettingsStore, useStateStore, useConfigStore } from '../../context/store';
import { useObsStore } from '../../context/obs';
import { usePersistentState } from '../../hooks/usePersistentState';
import { bindingForUrl } from '../../lib/obs-binding';
import { useShallow } from 'zustand/react/shallow';
import useTournament from '../../hooks/useTournament';
import {
    LAYOUT_SETTINGS,
    OVERRIDABLE_GLOBAL_KEYS,
    GLOBAL_DESIGN_KEYS,
    GLOBAL_DESIGN_DEFAULTS,
} from './designConstants';

const PREVIEW_HEIGHT = 500;

// Selected-row tint helper (replaces the per-item Mantine theme callbacks).
const itemClass = (active, accent = 'primary') => cn(
    'block w-full rounded-md p-2 text-left transition-colors',
    active
        ? (accent === 'violet' ? 'border border-[#a78bfa] bg-[#a78bfa]/15' : 'border border-primary bg-primary/10')
        : 'border border-transparent hover:bg-accent'
);

// Includes the default values for every "color" / "color-opacity" field in
// GLOBAL_DESIGN_DEFAULTS so a user can always click the suggested swatch to
// restore a stock value: #f59e0b (accent), #0f0f19 (card bg), #ffffff (text /
// border), #000000 (shadows). Remaining entries are general-purpose accents.
const COLOR_SWATCHES = [
    '#f59e0b', '#ef4444', '#22c55e', '#3b82f6',
    '#a855f7', '#ec4899', '#14b8a6', '#f97316',
    '#6366f1', '#64748b',
    '#0f0f19', '#ffffff', '#000000',
];

function ScaledIframe({ src, fallbackWidth, fallbackHeight, height = PREVIEW_HEIGHT }) {
    const containerRef = useRef(null);
    const iframeRef = useRef(null);
    const [nativeSize, setNativeSize] = useState(null);
    const [layout, setLayout] = useState({ scale: 1, offsetX: 0, offsetY: 0 });

    const recalc = useCallback((nw, nh) => {
        const el = containerRef.current;
        if (!el) return;
        const { width, height } = el.getBoundingClientRect();
        const scale = Math.min(width / nw, height / nh);
        setLayout({
            scale,
            offsetX: (width - nw * scale) / 2,
            offsetY: (height - nh * scale) / 2,
        });
    }, []);

    useEffect(() => {
        if (nativeSize) recalc(nativeSize.w, nativeSize.h);
    }, [nativeSize, recalc]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || !nativeSize) return;
        const observer = new ResizeObserver(() => recalc(nativeSize.w, nativeSize.h));
        observer.observe(el);
        return () => observer.disconnect();
    }, [nativeSize, recalc]);

    const handleLoad = useCallback(() => {
        const readSize = () => {
            try {
                const doc = iframeRef.current?.contentDocument;
                if (!doc) {
                    if (fallbackWidth && fallbackHeight) {
                        setNativeSize({ w: fallbackWidth, h: fallbackHeight });
                    }
                    return;
                }
                try {
                    doc.documentElement.style.background = 'transparent';
                    doc.documentElement.style.colorScheme = 'normal';
                    doc.body.style.background = 'transparent';
                    let injected = doc.getElementById('__prsh_preview_bg');
                    if (!injected) {
                        injected = doc.createElement('style');
                        injected.id = '__prsh_preview_bg';
                        injected.textContent =
                            'html,body{background:transparent !important;color-scheme:normal !important;}';
                        doc.head.appendChild(injected);
                    }
                } catch { /* ignore */ }
                const refW = parseFloat(doc.body.dataset.refW);
                const refH = parseFloat(doc.body.dataset.refH);
                if (refW > 0 && refH > 0) {
                    setNativeSize({ w: refW, h: refH });
                    return;
                }
                const style = doc.defaultView.getComputedStyle(doc.body);
                const cssW = parseFloat(style.width);
                const cssH = parseFloat(style.height);
                const w = cssW > 0 ? cssW : doc.body.scrollWidth;
                const h = cssH > 0 ? cssH : doc.body.scrollHeight;
                if (w > 0 && h > 0) {
                    setNativeSize({ w, h });
                }
            } catch (e) {
                if (fallbackWidth && fallbackHeight) {
                    setNativeSize({ w: fallbackWidth, h: fallbackHeight });
                }
            }
        };
        requestAnimationFrame(readSize);
    }, [fallbackWidth, fallbackHeight]);

    return (
        <div
            ref={containerRef}
            className="relative w-full overflow-hidden bg-muted"
            style={{ height }}
        >
            <iframe
                ref={iframeRef}
                src={src}
                onLoad={handleLoad}
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: nativeSize ? `${nativeSize.w}px` : '1px',
                    height: nativeSize ? `${nativeSize.h}px` : '1px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    colorScheme: 'normal',
                    opacity: nativeSize ? 1 : 0,
                    transform: nativeSize
                        ? `translate(${layout.offsetX}px, ${layout.offsetY}px) scale(${layout.scale})`
                        : 'none',
                    transformOrigin: 'top left',
                }}
                title="Layout Preview"
            />
        </div>
    );
}

// Tinted-translucent source chips, matching the brand.
const SOURCE_COLORS = {
    hud: 'bg-[#22c55e]/15 text-[#4ade80]',
    api: 'bg-[#3b82f6]/15 text-[#60a5fa]',
    set: 'bg-[#a855f7]/15 text-[#c084fc]',
    manual: 'bg-muted text-muted-foreground',
};

// Friendly source labels (matches the Scoreboard tab's vocabulary).
const SOURCE_LABEL = { hud: 'HUD', api: 'API', set: 'Set', manual: 'Manual' };

// Derive the badge key from a scoreboard's transport + binding (mirrors the
// Scoreboard tab). Empty single boards read as "manual".
function bindingBadgeKey({ transport, mode, gameId }) {
    if (transport === 'hud') return 'hud';
    if (mode === 'rotate') return 'set';
    if (mode === 'single' && gameId != null) return 'api';
    return 'manual';
}

function CopyIconButton({ value }) {
    return (
        <CopyButton value={value}>
            {({ copied, copy }) => (
                <SimpleTooltip label={copied ? 'Copied!' : 'Copy URL'}>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        className={copied ? 'text-[#14b8a6]' : ''}
                        onClick={(e) => { e.stopPropagation(); copy(); }}
                    >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                    </Button>
                </SimpleTooltip>
            )}
        </CopyButton>
    );
}

// Live OBS binding for a layout URL — drives the status dot/badge and the
// Add-to-OBS button. Recomputes as OBS scene state changes.
function useLayoutBinding(url) {
    const status = useObsStore(s => s.status);
    const programScene = useObsStore(s => s.programScene);
    const previewScene = useObsStore(s => s.previewScene);
    const sceneItems = useObsStore(s => s.sceneItems);
    return useMemo(() => {
        if (status !== 'connected') return { state: 'offline', matches: [] };
        if (!url) return { state: 'absent', matches: [] };
        return bindingForUrl(url, { sceneItems, programScene, previewScene });
    }, [status, url, sceneItems, programScene, previewScene]);
}

const BINDING_TONE = {
    live: { dot: '#22c55e', badge: 'bg-[#22c55e]/15 text-[#4ade80]' },
    preview: { dot: '#f59e0b', badge: 'bg-[#f59e0b]/15 text-[#fbbf24]' },
    absent: { dot: '#3f3f46', badge: 'bg-muted text-muted-foreground' },
};

function bindingLabel(binding) {
    switch (binding.state) {
        case 'live': return `In OBS as “${binding.sourceName}” · program scene`;
        case 'preview': return `In OBS as “${binding.sourceName}” · preview scene`;
        case 'absent': return 'Not in OBS yet';
        default: return '';
    }
}

// Small glanceable dot for list rows. Hidden when OBS isn't connected.
function BindingDot({ binding }) {
    if (!binding || binding.state === 'offline') return null;
    const tone = BINDING_TONE[binding.state] || BINDING_TONE.absent;
    return (
        <SimpleTooltip label={bindingLabel(binding)}>
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tone.dot }} />
        </SimpleTooltip>
    );
}

// Binding status + one-click "Add to OBS" for the previewed layout.
function ObsBindingControls({ url, name, width, height }) {
    const binding = useLayoutBinding(url);
    const status = useObsStore(s => s.status);
    const programScene = useObsStore(s => s.programScene);
    const [adding, setAdding] = useState(false);

    if (status !== 'connected') {
        return (
            <SimpleTooltip label="Connect OBS in Settings to wire sources automatically">
                <Badge className="bg-muted text-[10px] text-muted-foreground">OBS offline</Badge>
            </SimpleTooltip>
        );
    }

    if (binding.state === 'live' || binding.state === 'preview') {
        const tone = BINDING_TONE[binding.state];
        return (
            <SimpleTooltip label={bindingLabel(binding)}>
                <Badge className={cn('text-[10px]', tone.badge)}>✓ {binding.sourceName}</Badge>
            </SimpleTooltip>
        );
    }

    const handleAdd = async () => {
        setAdding(true);
        try {
            const res = await useObsStore.getState().addBrowserSource({ inputName: name, url, width, height });
            notifications.show({ message: `Added “${res.inputName}” to ${res.sceneName}`, color: 'green' });
        } catch (e) {
            notifications.show({ message: e.message || 'Failed to add to OBS', color: 'red' });
        }
        setAdding(false);
    };

    return (
        <SimpleTooltip label={programScene ? `Add to program scene “${programScene}”` : 'No program scene in OBS'}>
            <Button variant="secondary" size="xs" onClick={handleAdd} disabled={adding || !programScene}>
                {adding && <Loader size={10} />} Add to OBS
            </Button>
        </SimpleTooltip>
    );
}

function LayoutItem({ item, selected, onSelect, activeTab }) {
    const copyUrl = useMemo(() => {
        try {
            const u = new URL(item.url);
            u.searchParams.set('scoreboard', activeTab);
            return u.toString();
        } catch { return item.url; }
    }, [item.url, activeTab]);

    const binding = useLayoutBinding(copyUrl);

    return (
        <button type="button" onClick={() => onSelect(item)} className={itemClass(selected?.url === item.url)}>
            <div className="flex flex-nowrap items-center justify-between gap-1">
                <div className="min-w-0 flex-1">
                    <Text size="sm" truncate>
                        {item.sizeVariant
                            ? `${item.sizeLabel} (${item.sizeVariant.toUpperCase()})`
                            : item.name}
                    </Text>
                    {item.width && item.height && (
                        <Text size="xs" dimmed>{item.width} x {item.height}</Text>
                    )}
                </div>
                <BindingDot binding={binding} />
                <CopyIconButton value={copyUrl} />
            </div>
        </button>
    );
}

// Order in which team layouts appear in the two-column section
const TEAM_LAYOUT_ORDER = ['roster', 'stats', 'rosterstats', 'teamlogo', 'playername'];

// Layout types that play a reveal animation when their OBS source is shown.
// Only these expose the "Intro animation" toggle (turning it off makes the
// source resident instead of reloading on show — see obs.jsx desiredShutdown).
const ANIMATED_TYPES = new Set([
    'scoreboard', 'scorecard', 'lowerthird', 'matchup', 'commentary', 'playerplates', 'hitvisualizer',
]);

function LayoutList({ layouts, selected, onSelect, activeTab }) {
    const [expandedGroups, setExpandedGroups] = useState({});

    if (layouts.length === 0) {
        return (
            <Text size="sm" dimmed>
                No layouts found for this scoreboard.
            </Text>
        );
    }

    const sizeVariantLayouts = layouts.filter(l => l.sizeVariant);
    const teamLayouts = layouts.filter(l => l.team != null);
    const otherLayouts = layouts.filter(l => !l.sizeVariant && l.team == null);

    const groups = {};
    for (const item of sizeVariantLayouts) {
        const key = `${item.group}/${item.parentName}`;
        if (!groups[key]) groups[key] = { parentName: item.parentName, items: [] };
        groups[key].items.push(item);
    }

    const toggleGroup = (key) => {
        setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const isGroupActive = (items) => items.some(i => i.url === selected?.url);

    const team1 = TEAM_LAYOUT_ORDER.map(t => teamLayouts.find(l => l.type === t && l.team === 1)).filter(Boolean);
    const team2 = TEAM_LAYOUT_ORDER.map(t => teamLayouts.find(l => l.type === t && l.team === 2)).filter(Boolean);

    return (
        <Stack gap="xs">
            {Object.entries(groups).map(([key, { parentName, items }]) => {
                const open = expandedGroups[key] || isGroupActive(items);
                return (
                    <div key={key}>
                        <button type="button" onClick={() => toggleGroup(key)} className={itemClass(isGroupActive(items))}>
                            <div className="flex flex-nowrap items-center justify-between">
                                <Text size="sm" fw={600}>{parentName}</Text>
                                <Text size="xs" dimmed>
                                    {open ? '▴' : '▾'} {items.length} sizes
                                </Text>
                            </div>
                        </button>
                        <Collapsible open={open}>
                            <CollapsibleContent>
                                <Stack gap="xs" className="pl-3 pt-1">
                                    {items.map((item) => (
                                        <LayoutItem key={item.url} item={item} selected={selected} onSelect={onSelect} activeTab={activeTab} />
                                    ))}
                                </Stack>
                            </CollapsibleContent>
                        </Collapsible>
                    </div>
                );
            })}

            {otherLayouts.length > 0 && (
                <Stack gap="xs">
                    {otherLayouts.map((item) => (
                        <LayoutItem key={item.url} item={item} selected={selected} onSelect={onSelect} activeTab={activeTab} />
                    ))}
                </Stack>
            )}

            {(team1.length > 0 || team2.length > 0) && (
                <div className="mt-1 border-t border-border pt-2">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <Text size="xs" fw={600} dimmed className="mb-1 uppercase tracking-wide">Team 1</Text>
                            <Stack gap="xs">
                                {team1.map((item) => (
                                    <LayoutItem key={item.url} item={item} selected={selected} onSelect={onSelect} activeTab={activeTab} />
                                ))}
                            </Stack>
                        </div>
                        <div>
                            <Text size="xs" fw={600} dimmed className="mb-1 uppercase tracking-wide">Team 2</Text>
                            <Stack gap="xs">
                                {team2.map((item) => (
                                    <LayoutItem key={item.url} item={item} selected={selected} onSelect={onSelect} activeTab={activeTab} />
                                ))}
                            </Stack>
                        </div>
                    </div>
                </div>
            )}
        </Stack>
    );
}

// ── Bracket Layout List (dynamic, based on loaded tournament phases) ──
const BRACKET_VARIANTS = [
    { key: 'full', label: 'Full Bracket', path: '/layout/bracket/index.html' },
    { key: 'winners', label: 'Winners Only', path: '/layout/bracket/index.html?winners_only=true' },
    { key: 'losers', label: 'Losers Only', path: '/layout/bracket/index.html?losers_only=true' },
];

function PlayerSchedulePanel({ selected, onSelect, baseUrl, phases, phasesLoaded, bracketLink }) {
    const activePlayer = useStateStore(s => s?.bracket?.activePlayer ?? '');
    const playerScheduleData = useStateStore(s => s?.playerSchedule);
    const setStateItem = useStateStore(s => s.setItem);
    const [draftPlayer, setDraftPlayer] = useState('');
    const [selectedPgIds, setSelectedPgIds] = useState(new Set());
    const [loading, setLoading] = useState(false);
    const [loadedCount, setLoadedCount] = useState(null);

    useEffect(() => { setDraftPlayer(activePlayer); }, [activePlayer]);

    useEffect(() => {
        if (!phasesLoaded || phases.length === 0) return;
        const poolIds = new Set();
        for (const phase of phases) {
            for (const pg of (phase.phaseGroups || [])) {
                if (pg.bracketType === 'ROUND_ROBIN') poolIds.add(pg.id);
            }
        }
        if (poolIds.size > 0) setSelectedPgIds(poolIds);
    }, [phases, phasesLoaded]);

    const isLoaded = loadedCount !== null;

    const checkedPgIds = useMemo(() =>
        isLoaded
            ? new Set((playerScheduleData?.visiblePgIds ?? []).map(String))
            : selectedPgIds,
    [isLoaded, playerScheduleData, selectedPgIds]);

    const setActivePlayer = useCallback((name) => {
        setStateItem('bracket.activePlayer', name);
    }, [setStateItem]);

    const togglePg = useCallback((pgId) => {
        if (isLoaded) {
            const current = new Set((playerScheduleData?.visiblePgIds ?? []).map(String));
            const strId = String(pgId);
            if (current.has(strId)) current.delete(strId); else current.add(strId);
            setStateItem('playerSchedule.visiblePgIds', Array.from(current));
        } else {
            setSelectedPgIds(prev => {
                const next = new Set(prev);
                if (next.has(pgId)) next.delete(pgId); else next.add(pgId);
                return next;
            });
        }
    }, [isLoaded, playerScheduleData, setStateItem]);

    const allPgs = useMemo(() => phases.flatMap(phase =>
        (phase.phaseGroups || []).map(pg => ({
            ...pg,
            label: phases.length > 1 || (phase.phaseGroups?.length ?? 0) > 1
                ? `${phase.name}${(phase.phaseGroups?.length ?? 0) > 1 ? ` – Pool ${pg.displayIdentifier}` : ''}`
                : phase.name,
        }))
    ), [phases]);

    const handleLoad = useCallback(async () => {
        if (allPgs.length === 0) return;
        setLoading(true);
        try {
            const baseApi = '/api/v1/startgg';
            const results = await Promise.all(
                allPgs.map((pg) =>
                    fetch(`${baseApi}/bracket-data?phase_group_id=${pg.id}`)
                        .then(r => r.json())
                        .then(r => ({ ...r, _pgId: pg.id }))
                )
            );
            const mergedPlayers = {};
            const mergedSets = [];
            for (const result of results) {
                if (result.error) continue;
                Object.assign(mergedPlayers, result.players || {});
                const bracketType = result.type || 'DOUBLE_ELIMINATION';
                const addRounds = (rounds) => {
                    for (const roundData of Object.values(rounds || {})) {
                        for (const set of (roundData.sets || [])) {
                            mergedSets.push({ ...set, phaseName: result.phaseName, phaseGroupId: result._pgId, bracketType });
                        }
                    }
                };
                addRounds(result.winnersRounds);
                addRounds(result.losersRounds);
                for (const set of (result.grandFinals || [])) {
                    mergedSets.push({ ...set, phaseName: result.phaseName, phaseGroupId: result._pgId, bracketType });
                }
            }
            setStateItem('playerSchedule', {
                players: mergedPlayers,
                sets: mergedSets,
                visiblePgIds: Array.from(selectedPgIds).map(String),
            });
            setLoadedCount(mergedSets.length);
        } catch (e) {
            console.error('[PlayerSchedule] load error', e);
        }
        setLoading(false);
    }, [allPgs, selectedPgIds, setStateItem]);

    const scheduleUrl = `${baseUrl}/layout/bracket/player_schedule.html`;
    const variants = [
        { key: 'all', label: 'All Games', url: scheduleUrl },
        { key: 'upcoming', label: 'Upcoming Only', url: `${scheduleUrl}?pool_only=true` },
        { key: 'noresults', label: 'Hide Results', url: `${scheduleUrl}?show_results=false` },
        { key: 'progressive', label: 'Progressive Reveal', url: `${scheduleUrl}?progressive=true` },
    ];

    const playerNames = useMemo(() =>
        Object.values(playerScheduleData?.players ?? {})
            .map(p => p.name).filter(Boolean).sort(),
    [playerScheduleData]);

    const visiblePgs = useMemo(() => {
        if (!playerScheduleData || !draftPlayer) return allPgs;
        const { sets = [], players = {} } = playerScheduleData;
        let targetId = null;
        for (const [id, p] of Object.entries(players)) {
            if ((p.name || '').toLowerCase() === draftPlayer.toLowerCase()) { targetId = id; break; }
        }
        if (!targetId) return allPgs;
        const loadedPgIds = new Set(sets.map(s => s.phaseGroupId).filter(Boolean));
        const playerPgIds = new Set(
            sets.filter(s => s.entrant1Id === targetId || s.entrant2Id === targetId)
                .map(s => s.phaseGroupId).filter(Boolean)
        );
        if (playerPgIds.size === 0 && loadedPgIds.size === 0) return allPgs;
        return allPgs.filter(pg => playerPgIds.has(pg.id) || !loadedPgIds.has(pg.id));
    }, [allPgs, playerScheduleData, draftPlayer]);

    const dlId = 'player-schedule-names';

    return (
        <Stack gap="xs">
            <Text size="xs" fw={600} dimmed className="uppercase tracking-wide">
                Player Schedule
            </Text>
            <div className="flex flex-col gap-1">
                <Input
                    placeholder="Player name..."
                    value={draftPlayer}
                    list={dlId}
                    onChange={(e) => setDraftPlayer(e.currentTarget.value)}
                    onBlur={() => setActivePlayer(draftPlayer)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setActivePlayer(draftPlayer); }}
                />
                <datalist id={dlId}>
                    {playerNames.slice(0, 10).map(n => <option key={n} value={n} />)}
                </datalist>
                <Text size="xs" dimmed>Shown in the schedule overlay</Text>
            </div>

            {phasesLoaded && visiblePgs.length > 0 && (
                <>
                    <Text size="xs" dimmed>Phases to include:</Text>
                    <Stack gap="xs">
                        {visiblePgs.map(pg => {
                            const sel = checkedPgIds.has(pg.id) || checkedPgIds.has(String(pg.id));
                            const typeLabel = pg.bracketType === 'ROUND_ROBIN' ? 'Pool' : pg.bracketType === 'DOUBLE_ELIMINATION' ? 'DE' : 'SE';
                            return (
                                <button type="button" key={pg.id} onClick={() => togglePg(pg.id)} className={itemClass(sel)}>
                                    <div className="flex flex-nowrap items-center gap-1.5">
                                        <span className="size-[11px] shrink-0 rounded-sm border-[1.5px] border-[#3b82f6]" style={{ background: sel ? '#3b82f6' : 'transparent' }} />
                                        <Text size="xs" truncate className="min-w-0 flex-1">{pg.label}</Text>
                                        <Badge variant="outline" className="text-[10px]">{typeLabel}</Badge>
                                    </div>
                                </button>
                            );
                        })}
                    </Stack>
                    <Button size="xs" variant="secondary" disabled={loading || allPgs.length === 0} onClick={handleLoad}>
                        {loading && <Loader size={10} />}
                        {loadedCount !== null ? `Reload All (${loadedCount} games)` : 'Load All Phases'}
                    </Button>
                </>
            )}

            {loadedCount !== null && (
                <Stack gap="xs" className="mt-0.5">
                    {variants.map(v => {
                        const isActive = selected?.url === v.url;
                        return (
                            <button type="button" key={v.key}
                                onClick={() => onSelect({ group: 'bracket', name: v.label, type: 'bracket', url: v.url, width: 440, height: 600 })}
                                className={itemClass(isActive)}>
                                <div className="flex flex-nowrap items-center justify-between gap-1">
                                    <div className="min-w-0 flex-1">
                                        <Text size="sm">{v.label}</Text>
                                        <Text size="xs" dimmed>440 x 600</Text>
                                    </div>
                                    <CopyIconButton value={v.url} />
                                </div>
                            </button>
                        );
                    })}
                </Stack>
            )}
        </Stack>
    );
}

function BracketLayoutList({ selected, onSelect, baseUrl, onLoadBracket }) {
    const [expandedGroups, setExpandedGroups] = useState({});
    const bracketLink = useStateStore(s => s?.tournamentInfo?.bracket_link ?? '');
    const { loading: sggLoading, fetchPhases, loadBracket } = useTournament();

    const [phases, setPhases] = useState([]);
    const [loadedPgId, setLoadedPgId] = useState(null);
    const [phasesLoaded, setPhasesLoaded] = useState(false);

    useEffect(() => {
        if (bracketLink && !phasesLoaded) {
            fetchPhases().then(result => {
                if (result) {
                    setPhases(result);
                    setPhasesLoaded(true);
                }
            });
        }
    }, [bracketLink, phasesLoaded, fetchPhases]);

    useEffect(() => {
        setPhasesLoaded(false);
        setPhases([]);
        setLoadedPgId(null);
    }, [bracketLink]);

    if (!bracketLink) {
        return (
            <Text size="xs" dimmed className="italic">
                Load a tournament in the Bracket tab to see bracket layouts.
            </Text>
        );
    }

    if (!phasesLoaded) {
        return <Loader size={18} />;
    }

    const phaseGroups = [];
    for (const phase of phases) {
        for (const pg of (phase.phaseGroups || [])) {
            const label = phases.length > 1 || (phase.phaseGroups?.length > 1)
                ? `${phase.name}${phase.phaseGroups.length > 1 ? ` - Pool ${pg.displayIdentifier}` : ''}`
                : phase.name;
            phaseGroups.push({ id: pg.id, label, bracketType: pg.bracketType });
        }
    }

    if (phaseGroups.length === 0) {
        return <Text size="xs" dimmed>No bracket phases found.</Text>;
    }

    const toggleGroup = (key) => {
        setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleSelect = async (pg, variant) => {
        const url = `${baseUrl}${variant.path}`;
        const item = {
            group: 'bracket',
            name: `${pg.label} — ${variant.label}`,
            type: 'bracket',
            url,
            width: 1920,
            height: 1080,
            _phaseGroupId: pg.id,
        };
        if (loadedPgId !== pg.id) {
            const result = await loadBracket(pg.id);
            if (result) setLoadedPgId(pg.id);
        }
        onSelect(item);
        if (onLoadBracket) onLoadBracket(pg.id);
    };

    const isVariantSelected = (pgId, variantKey) => {
        return selected?._phaseGroupId === pgId && selected?.url?.includes(
            variantKey === 'full' ? 'index.html' :
            variantKey === 'winners' ? 'winners_only=true' :
            'losers_only=true'
        ) && (variantKey === 'full' ? !selected?.url?.includes('_only=true') : true);
    };

    const isGroupActive = (pgId) => selected?._phaseGroupId === pgId;

    return (
        <Stack gap="xs">
            {phaseGroups.map(pg => {
                const key = `bracket-${pg.id}`;
                const open = expandedGroups[key] || isGroupActive(pg.id);
                const variants = pg.bracketType === 'ROUND_ROBIN'
                    ? [BRACKET_VARIANTS[0]]
                    : BRACKET_VARIANTS;

                return (
                    <div key={key}>
                        <button type="button" onClick={() => toggleGroup(key)} className={itemClass(isGroupActive(pg.id), 'violet')}>
                            <div className="flex flex-nowrap items-center justify-between">
                                <Text size="sm" fw={600}>{pg.label}</Text>
                                <div className="flex items-center gap-1">
                                    {loadedPgId === pg.id && (
                                        <Badge className="bg-[#22c55e] text-[10px] text-black">loaded</Badge>
                                    )}
                                    <Text size="xs" dimmed>{open ? '▴' : '▾'}</Text>
                                </div>
                            </div>
                        </button>
                        <Collapsible open={open}>
                            <CollapsibleContent>
                                <Stack gap="xs" className="pl-3 pt-1">
                                    {variants.map(variant => {
                                        const active = isVariantSelected(pg.id, variant.key);
                                        return (
                                            <button type="button" key={variant.key} onClick={() => handleSelect(pg, variant)} className={itemClass(active)}>
                                                <div className="flex flex-nowrap items-center justify-between gap-1">
                                                    <div className="min-w-0 flex-1">
                                                        <Text size="sm">{variant.label}</Text>
                                                        <Text size="xs" dimmed>1920 x 1080</Text>
                                                    </div>
                                                    <CopyIconButton value={`${baseUrl}${variant.path}`} />
                                                </div>
                                            </button>
                                        );
                                    })}
                                </Stack>
                            </CollapsibleContent>
                        </Collapsible>
                    </div>
                );
            })}

            <div className="mt-1 border-t border-border pt-2">
                <PlayerSchedulePanel
                    selected={selected}
                    onSelect={onSelect}
                    baseUrl={baseUrl}
                    phases={phases}
                    phasesLoaded={phasesLoaded}
                    bracketLink={bracketLink}
                />
            </div>
        </Stack>
    );
}

// ── Tournament Logo Upload ──
function LogoUpload({ label, description }) {
    const [logoInfo, setLogoInfo] = useState(null);
    const [uploading, setUploading] = useState(false);

    const fetchLogo = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/branding/logo');
            if (resp.ok) setLogoInfo(await resp.json());
        } catch (e) { /* ignore */ }
    }, []);

    useEffect(() => { fetchLogo(); }, [fetchLogo]);

    const handleUpload = useCallback(async (file) => {
        if (!file) return;
        setUploading(true);
        try {
            const form = new FormData();
            form.append('file', file);
            const resp = await fetch('/api/v1/branding/logo', { method: 'POST', body: form });
            if (resp.ok) setLogoInfo(await resp.json());
        } catch (e) { /* ignore */ }
        setUploading(false);
    }, []);

    const handleRemove = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/branding/logo', { method: 'DELETE' });
            if (resp.ok) setLogoInfo(await resp.json());
        } catch (e) { /* ignore */ }
    }, []);

    return (
        <div>
            <Text size="sm" fw={500}>{label}</Text>
            {description && <Text size="xs" dimmed className="mb-1">{description}</Text>}
            <div className="flex items-center gap-2">
                {logoInfo?.exists && logoInfo.url && (
                    <img
                        src={logoInfo.url + '?t=' + Date.now()}
                        alt="Tournament logo"
                        className="size-12 rounded-md border border-border object-contain"
                    />
                )}
                <FileButton onChange={handleUpload} accept="image/png,image/jpeg,image/svg+xml,image/webp">
                    {(props) => (
                        <Button {...props} variant="secondary" size="xs" disabled={uploading}>
                            {uploading && <Loader size={10} />}
                            {logoInfo?.exists ? 'Replace' : 'Upload'}
                        </Button>
                    )}
                </FileButton>
                {logoInfo?.exists && (
                    <Button variant="ghost" size="xs" className="text-destructive" onClick={handleRemove}>
                        Remove
                    </Button>
                )}
            </div>
        </div>
    );
}

function parseRgba(val) {
    const m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (m) {
        const hex = '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
        return { hex, opacity: m[4] != null ? parseFloat(m[4]) : 1 };
    }
    return { hex: val.startsWith('#') ? val : '#000000', opacity: 1 };
}

function toRgba(hex, opacity) {
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function ColorWithOpacity({ label, description, value, onChange }) {
    const { hex, opacity } = parseRgba(value);
    const [localHex, setLocalHex] = useState(hex);
    const [localOpacity, setLocalOpacity] = useState(opacity);
    const timerRef = useRef(null);

    useEffect(() => {
        const parsed = parseRgba(value);
        setLocalHex(parsed.hex);
        setLocalOpacity(parsed.opacity);
    }, [value]);

    const scheduleChange = useCallback((newHex, newOpacity) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            onChange(toRgba(newHex, newOpacity));
            timerRef.current = null;
        }, 200);
    }, [onChange]);

    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

    return (
        <div className="flex flex-col gap-1">
            {label && <Label className="field-label">{label}</Label>}
            {description && <Text size="xs" dimmed>{description}</Text>}
            <div className="flex items-end gap-2">
                <ColorInput
                    value={localHex}
                    onChange={(color) => { setLocalHex(color); scheduleChange(color, localOpacity); }}
                    swatches={COLOR_SWATCHES}
                    className="flex-1"
                />
                <NumberInput
                    value={Math.round(localOpacity * 100)}
                    onChange={(val) => { const o = (val ?? 100) / 100; setLocalOpacity(o); scheduleChange(localHex, o); }}
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                    className="w-20"
                />
            </div>
        </div>
    );
}

// ── Presets Panel (save/load/export hub for design configurations) ──
function PresetsPanel() {
    const globalDesign = useSettingsStore(useShallow(s => s?.overlays?.global ?? {}));
    const presets = useSettingsStore(s => s?.overlays?.presets ?? {});
    const allLayoutSettings = useSettingsStore(useShallow(s => {
        const result = {};
        for (const layoutType of Object.keys(LAYOUT_SETTINGS)) {
            if (LAYOUT_SETTINGS[layoutType].length === 0) continue;
            result[layoutType] = s?.overlays?.[layoutType] ?? null;
        }
        return result;
    }));
    const setItem = useSettingsStore(s => s.setItem);

    const [presetName, setPresetName] = useState('');
    const [savingPreset, setSavingPreset] = useState(false);

    const handleSavePreset = useCallback(() => {
        const name = presetName.trim();
        if (!name) return;
        const global = {};
        for (const key of GLOBAL_DESIGN_KEYS) {
            global[key] = globalDesign[key] ?? GLOBAL_DESIGN_DEFAULTS[key];
        }
        const preset = { version: 2, global, layouts: allLayoutSettings };
        setItem(`overlays.presets.${name}`, preset);
        setPresetName('');
        setSavingPreset(false);
        notifications.show({ message: `Saved preset "${name}"`, color: 'green' });
    }, [presetName, globalDesign, allLayoutSettings, setItem]);

    const handleLoadPreset = useCallback((name) => {
        const preset = presets[name];
        if (!preset) return;
        const isV1 = !preset.version;
        const globalData = preset.global ?? preset;
        for (const key of GLOBAL_DESIGN_KEYS) {
            if (globalData[key] != null) setItem(`overlays.global.${key}`, globalData[key]);
        }
        const promotedToGlobal = new Set([
            'showCaptains', 'showLogo', 'showShadow', 'showBackdropBlur', 'finalBadgeColor',
        ]);
        if (preset.layouts) {
            for (const [layoutType, layoutValues] of Object.entries(preset.layouts)) {
                if (!layoutValues) continue;
                for (const [key, value] of Object.entries(layoutValues)) {
                    if (isV1 && promotedToGlobal.has(key)) continue;
                    setItem(`overlays.${layoutType}.${key}`, value);
                }
            }
        }
        notifications.show({ message: `Loaded preset "${name}"`, color: 'blue' });
    }, [presets, setItem]);

    const handleDeletePreset = useCallback((name) => {
        setItem(`overlays.presets.${name}`, null);
        notifications.show({ message: `Deleted preset "${name}"`, color: 'gray' });
    }, [setItem]);

    const resetGlobalDesign = useCallback(() => {
        for (const [key, value] of Object.entries(GLOBAL_DESIGN_DEFAULTS)) {
            setItem(`overlays.global.${key}`, value);
        }
        notifications.show({ message: 'Global design reset to defaults', color: 'blue' });
    }, [setItem]);

    const resetOverrides = useCallback(() => {
        for (const layoutType of Object.keys(LAYOUT_SETTINGS)) {
            for (const def of OVERRIDABLE_GLOBAL_KEYS) {
                setItem(`overlays.${layoutType}.${def.key}`, null);
            }
        }
        notifications.show({ message: 'All layout overrides cleared', color: 'blue' });
    }, [setItem]);

    const handleExportPreset = useCallback((name) => {
        const preset = presets[name];
        if (!preset) return;
        const blob = new Blob([JSON.stringify({ name, ...preset }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, [presets]);

    const handleImportPreset = useCallback((file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                const name = data.name || file.name.replace(/\.json$/i, '');
                const global = data.global ?? {};
                const layouts = data.layouts ?? {};
                const version = data.version ?? 1;
                setItem(`overlays.presets.${name}`, { version, global, layouts });
                notifications.show({ message: `Imported preset "${name}"`, color: 'green' });
            } catch {
                notifications.show({ message: 'Invalid preset file', color: 'red' });
            }
        };
        reader.readAsText(file);
    }, [setItem]);

    const presetNames = Object.keys(presets).filter(k => presets[k] != null);

    return (
        <Stack gap="md" className="max-w-[500px]">
            <LogoUpload
                label="Overlay Logo"
                description="Upload a logo to display on overlays (channel logo, league logo, etc.)"
            />

            <div>
                <Text size="sm" fw={500} className="mb-1">Presets</Text>
                <Text size="xs" dimmed className="mb-2">Save and load full design configurations including global settings and per-layout overrides.</Text>
                <Stack gap="xs">
                    {presetNames.map(name => (
                        <div key={name} className="flex flex-nowrap items-center justify-between gap-2">
                            <Text size="sm" truncate className="min-w-0 flex-1">{name}</Text>
                            <div className="flex flex-nowrap gap-1">
                                <Button variant="secondary" size="xs" onClick={() => handleLoadPreset(name)}>Load</Button>
                                <Button variant="ghost" size="xs" onClick={() => handleExportPreset(name)}>Export</Button>
                                <Button variant="ghost" size="xs" className="text-destructive" onClick={() => handleDeletePreset(name)}>Delete</Button>
                            </div>
                        </div>
                    ))}

                    {savingPreset ? (
                        <div className="flex flex-nowrap items-center gap-2">
                            <Input
                                placeholder="Preset name"
                                value={presetName}
                                onChange={(e) => setPresetName(e.currentTarget.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(); }}
                                className="flex-1"
                                autoFocus
                            />
                            <Button size="xs" onClick={handleSavePreset} disabled={!presetName.trim()}>Save</Button>
                            <Button size="xs" variant="ghost" onClick={() => { setSavingPreset(false); setPresetName(''); }}>Cancel</Button>
                        </div>
                    ) : (
                        <div className="flex flex-nowrap items-center gap-2">
                            <Button variant="secondary" size="xs" onClick={() => setSavingPreset(true)}>
                                Save current as preset
                            </Button>
                            <FileButton onChange={handleImportPreset} accept=".json">
                                {(props) => (
                                    <Button {...props} variant="secondary" size="xs">Import preset</Button>
                                )}
                            </FileButton>
                        </div>
                    )}
                </Stack>
            </div>

            <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={resetGlobalDesign}>
                    Reset global design
                </Button>
                <Button variant="secondary" size="sm" onClick={resetOverrides}>
                    Reset all overrides
                </Button>
            </div>
        </Stack>
    );
}

// ── Live preview grid for the Design tab ──
const PREVIEW_ROWS = [
    [
        { label: 'Large Scoreboard', path: '/layout/scoreboard1/scoreboard.html?scoreboard=1&size=l', w: 800,  h: 460 },
        { label: 'Player Stats',     path: '/layout/scoreboard1/stats.html?scoreboard=1',             w: 800,  h: 460 },
    ],
    [
        { label: 'Small Scoreboard', path: '/layout/scoreboard1/scoreboard.html?scoreboard=1&size=s', w: 500,  h: 80  },
        { label: 'Bracket',          path: '/layout/bracket/index.html',                              w: 960, h: 540 },
    ],
    [
        { label: 'Ticker',           path: '/layout/rotator/ticker.html',                             w: 1920, h: 80  },
    ],
];

function PreviewTile({ label, path, w, h, src, reloadKey }) {
    return (
        <div>
            <Text size="xs" fw={600} dimmed className="mb-1">{label}</Text>
            <div
                className="mx-auto overflow-hidden rounded-lg border border-night-600"
                style={{ width: '100%', maxWidth: w, aspectRatio: `${w} / ${h}`, background: '#0b0b0f' }}
            >
                <ScaledIframe key={reloadKey} src={src} fallbackWidth={w} fallbackHeight={h} height="100%" />
            </div>
        </div>
    );
}

function DesignPreviews({ baseUrl, showOverrides, onToggleOverrides }) {
    const buildUrl = (path) => {
        const sep = path.includes('?') ? '&' : '?';
        const flags = `preview=1${showOverrides ? '' : '&preview_globals_only=1'}`;
        return `${baseUrl}${path}${sep}${flags}`;
    };
    const reloadSuffix = showOverrides ? 'ov' : 'g';

    return (
        <Stack gap="sm">
            <div className="flex flex-nowrap items-center justify-between">
                <Text size="xs" dimmed className="flex-1">
                    Live previews — every control on the left updates these in real time.
                </Text>
                <SimpleTooltip label={showOverrides
                    ? 'Showing per-layout overrides on top of the global design'
                    : 'Showing the global design only — per-layout overrides hidden'}>
                    <Label className="flex items-center gap-1.5 text-xs">
                        <Switch checked={showOverrides} onCheckedChange={onToggleOverrides} />
                        Apply overrides
                    </Label>
                </SimpleTooltip>
            </div>

            {PREVIEW_ROWS.map((row, rowIdx) => (
                <div key={rowIdx} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
                    {row.map(item => (
                        <PreviewTile key={item.path} {...item} src={buildUrl(item.path)} reloadKey={`${item.path}-${reloadSuffix}`} />
                    ))}
                </div>
            ))}
        </Stack>
    );
}

// ── Design tab body (controls + previews + presets) ──
function DesignTabBody({ baseUrl }) {
    const [showOverrides, setShowOverrides] = useState(false);

    return (
        <Stack gap="lg">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                <div className="md:col-span-4">
                    <Panel title="Global Design">
                        <div className="p-4">
                            <GlobalDesignSection />
                        </div>
                    </Panel>
                </div>
                <div className="md:col-span-8">
                    <Panel title="Previews">
                        <div className="p-4">
                            <DesignPreviews baseUrl={baseUrl} showOverrides={showOverrides} onToggleOverrides={setShowOverrides} />
                        </div>
                    </Panel>
                </div>
            </div>

            <Panel title="Presets & Branding">
                <div className="p-4">
                    <PresetsPanel />
                </div>
            </Panel>
        </Stack>
    );
}

// ── Design Package selector (rendered at the top of the Design tab) ──
// Packages are folders of per-element theme SVGs (see public/design/README.md):
// `default` + `classic` ship built-in; anything else is user-installed under
// user_data/design_packages/ via the zip upload here. The selection is the
// normal settings key overlays.global.designPackage, read by every SVG-element
// mount.
function DesignPackageSection() {
    const designPackage = useSettingsStore(s => s?.overlays?.global?.designPackage) ?? 'default';
    const setItem = useSettingsStore(s => s.setItem);
    const [packages, setPackages] = useState(null);   // null = loading
    const [busy, setBusy] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const r = await fetch('/api/v1/design/packages');
            setPackages(r.ok ? await r.json() : []);
        } catch {
            setPackages([]);
        }
    }, []);
    useEffect(() => { refresh(); }, [refresh]);

    const install = async (file) => {
        if (!file) return;
        setBusy(true);
        try {
            const form = new FormData();
            form.append('file', file);
            const r = await fetch('/api/v1/design/packages/install', { method: 'POST', body: form });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(data?.detail || `Install failed (${r.status})`);
            notifications.show({ message: `Installed design package "${data.name}"`, color: 'green' });
            await refresh();
        } catch (e) {
            notifications.show({ message: `Install failed: ${e?.message || e}`, color: 'red' });
        } finally {
            setBusy(false);
        }
    };

    const uninstall = async (pkg) => {
        setBusy(true);
        try {
            const r = await fetch(`/api/v1/design/packages/${encodeURIComponent(pkg.id)}`, { method: 'DELETE' });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(data?.detail || `Uninstall failed (${r.status})`);
            notifications.show({ message: `Removed "${pkg.name}"`, color: 'green' });
            if (designPackage === pkg.id) setItem('overlays.global.designPackage', 'default');
            await refresh();
        } catch (e) {
            notifications.show({ message: `Uninstall failed: ${e?.message || e}`, color: 'red' });
        } finally {
            setBusy(false);
        }
    };

    const list = packages ?? [];
    const selected = list.find(p => p.id === designPackage) || null;
    const selectData = list.map(p => ({ value: p.id, label: p.builtin ? p.name : `${p.name} (installed)` }));
    // Keep an orphaned selection (package deleted on disk) visible so the user
    // understands why overlays fell back to Default.
    if (packages && !selected && designPackage) {
        selectData.push({ value: designPackage, label: `${designPackage} (missing)` });
    }

    return (
        <div>
            <Text size="xs" fw={700} dimmed className="mb-2 uppercase tracking-wide">Design Package</Text>
            <div className="flex flex-col gap-1 sm:max-w-md">
                <div className="flex items-center gap-2">
                    <SimpleSelect
                        className="min-w-0 flex-1"
                        value={designPackage}
                        onChange={(val) => setItem('overlays.global.designPackage', val)}
                        data={selectData.length ? selectData : [{ value: 'default', label: 'Default' }]}
                    />
                    <FileButton accept=".zip" onChange={install}>
                        {(props) => (
                            <Button size="sm" variant="secondary" disabled={busy} {...props}>Install…</Button>
                        )}
                    </FileButton>
                    {selected && !selected.builtin && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => uninstall(selected)}>
                            <X size={14} className="mr-1" /> Remove
                        </Button>
                    )}
                </div>
                <Text size="xs" dimmed>
                    {selected
                        ? `${selected.description || 'No description.'}${selected.elements?.length ? ` Themes: ${selected.elements.join(', ')}.` : ''} Elements a package doesn't theme fall back to Default.`
                        : 'Themes every SVG element (commentary, lower third, stat callout). Install a package as a .zip, or drop a folder into user_data/design_packages/.'}
                </Text>
            </div>
        </div>
    );
}

// ── Global Design Section (rendered inside the Design tab) ──
function GlobalDesignSection() {
    const globalDesign = useSettingsStore(useShallow(s => s?.overlays?.global ?? {}));
    const setItem = useSettingsStore(s => s.setItem);

    const accentColor       = globalDesign.accentColor       ?? '#f59e0b';
    const cardBg            = globalDesign.cardBg            ?? 'rgba(15, 15, 25, 0.88)';
    const textColor         = globalDesign.textColor         ?? '#ffffff';
    const borderRadius      = globalDesign.borderRadius      ?? 16;
    const borderWidth       = globalDesign.borderWidth       ?? 1;
    const borderColor       = globalDesign.borderColor       ?? 'rgba(255, 255, 255, 0.08)';
    const fontFamily        = globalDesign.fontFamily        ?? 'Inter';
    const showShadow        = globalDesign.showShadow        !== false;
    const cardShadowBlur    = globalDesign.cardShadowBlur    ?? 16;
    const cardShadowColor   = globalDesign.cardShadowColor   ?? 'rgba(0, 0, 0, 0.5)';
    const textShadowEnabled = globalDesign.textShadowEnabled === true;
    const textShadowBlur    = globalDesign.textShadowBlur    ?? 4;
    const textShadowColor   = globalDesign.textShadowColor   ?? 'rgba(0, 0, 0, 0.8)';
    const showCaptains      = globalDesign.showCaptains      !== false;
    const showLogo          = globalDesign.showLogo          !== false;
    const showBackdropBlur  = globalDesign.showBackdropBlur  !== false;
    const finalBadgeColor   = globalDesign.finalBadgeColor   ?? '';

    return (
        <Stack gap="md">
            <DesignPackageSection />

            <div>
                <Text size="xs" fw={700} dimmed className="mb-2 uppercase tracking-wide">Color & Typography</Text>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <LabeledColor label="Accent Color" value={accentColor} onChange={(color) => setItem('overlays.global.accentColor', color)} swatches={COLOR_SWATCHES} />
                    <LabeledColor label="Text Color" value={textColor} onChange={(color) => setItem('overlays.global.textColor', color)} swatches={['#ffffff', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#1e293b', '#0f172a']} />
                    <ColorWithOpacity label="Card Background" value={cardBg} onChange={(val) => setItem('overlays.global.cardBg', val)} />
                    <ColorWithOpacity label="Border Color" value={borderColor} onChange={(val) => setItem('overlays.global.borderColor', val)} />
                    <div className="flex flex-col gap-1">
                        <Label className="field-label">Final Badge Color</Label>
                        <div className="flex items-end gap-2">
                            <DebouncedColorInput
                                value={finalBadgeColor}
                                placeholder="Default"
                                onChange={(color) => setItem('overlays.global.finalBadgeColor', color || null)}
                                swatches={COLOR_SWATCHES}
                                className="flex-1"
                            />
                            {finalBadgeColor && (
                                <Button variant="ghost" size="sm" onClick={() => setItem('overlays.global.finalBadgeColor', null)}>Reset</Button>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="field-label">Font Family</Label>
                        <FontCombobox
                            value={fontFamily}
                            onChange={(val) => setItem('overlays.global.fontFamily', val)}
                        />
                        <p className="text-xs text-muted-foreground">
                            Search fonts installed on this machine, pick a bundled web font, or type
                            any font name available on the machine running the OBS browser source.
                        </p>
                    </div>
                </div>
            </div>

            <div>
                <Text size="xs" fw={700} dimmed className="mb-2 uppercase tracking-wide">Card Chrome</Text>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                        <Label className="field-label">Border Radius</Label>
                        <NumberInput value={borderRadius} onChange={(val) => setItem('overlays.global.borderRadius', val)} min={0} max={48} step={2} suffix="px" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="field-label">Border Thickness</Label>
                        <NumberInput value={borderWidth} onChange={(val) => setItem('overlays.global.borderWidth', val)} min={0} max={16} step={1} suffix="px" />
                    </div>
                </div>
                <Stack gap="xs" className="mt-2">
                    <div>
                        <Label className="flex items-start gap-2">
                            <Switch checked={showShadow} onCheckedChange={(c) => setItem('overlays.global.showShadow', c)} className="mt-0.5" />
                            <span className="flex flex-col">
                                <Text size="sm">Card Shadow</Text>
                                <Text size="xs" dimmed>Drop shadow behind overlay cards</Text>
                            </span>
                        </Label>
                        <Collapsible open={showShadow}>
                            <CollapsibleContent>
                                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <div className="flex flex-col gap-1">
                                        <Label className="field-label">Shadow Blur</Label>
                                        <NumberInput value={cardShadowBlur} onChange={(val) => setItem('overlays.global.cardShadowBlur', val ?? 16)} min={0} max={80} step={2} suffix="px" />
                                    </div>
                                    <ColorWithOpacity label="Shadow Color" value={cardShadowColor} onChange={(val) => setItem('overlays.global.cardShadowColor', val)} />
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    </div>
                    <div>
                        <Label className="flex items-start gap-2">
                            <Switch checked={textShadowEnabled} onCheckedChange={(c) => setItem('overlays.global.textShadowEnabled', c)} className="mt-0.5" />
                            <span className="flex flex-col">
                                <Text size="sm">Text Shadow</Text>
                                <Text size="xs" dimmed>Drop shadow on text across overlays</Text>
                            </span>
                        </Label>
                        <Collapsible open={textShadowEnabled}>
                            <CollapsibleContent>
                                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <div className="flex flex-col gap-1">
                                        <Label className="field-label">Blur</Label>
                                        <NumberInput value={textShadowBlur} onChange={(val) => setItem('overlays.global.textShadowBlur', val ?? 4)} min={0} max={40} step={1} suffix="px" />
                                    </div>
                                    <ColorWithOpacity label="Shadow Color" value={textShadowColor} onChange={(val) => setItem('overlays.global.textShadowColor', val)} />
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    </div>
                </Stack>
            </div>

            <div>
                <Text size="xs" fw={700} dimmed className="mb-2 uppercase tracking-wide">Display Toggles</Text>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Label className="flex items-center gap-2 text-sm">
                        <Switch checked={showCaptains} onCheckedChange={(c) => setItem('overlays.global.showCaptains', c)} />
                        Show Captains
                    </Label>
                    <Label className="flex items-center gap-2 text-sm">
                        <Switch checked={showLogo} onCheckedChange={(c) => setItem('overlays.global.showLogo', c)} />
                        Show Overlay Logo
                    </Label>
                    <Label className="flex items-center gap-2 text-sm">
                        <Switch checked={showBackdropBlur} onCheckedChange={(c) => setItem('overlays.global.showBackdropBlur', c)} />
                        Backdrop Blur
                    </Label>
                </div>
            </div>
        </Stack>
    );
}

// Labeled color input (debounced) used in the global design grid.
function LabeledColor({ label, ...props }) {
    return (
        <div className="flex flex-col gap-1">
            <Label className="field-label">{label}</Label>
            <DebouncedColorInput {...props} />
        </div>
    );
}

// ── Debounced color input — updates local display immediately, saves after idle ──
function DebouncedColorInput({ value, onChange, ...props }) {
    const [local, setLocal] = useState(value ?? '');
    const timerRef = useRef(null);

    useEffect(() => {
        setLocal(value ?? '');
    }, [value]);

    const handleChange = useCallback((color) => {
        setLocal(color);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            onChange(color);
            timerRef.current = null;
        }, 200);
    }, [onChange]);

    useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current);
    }, []);

    return <ColorInput {...props} value={local} onChange={handleChange} />;
}

// ── Per-layout settings panel ──
// The Scorecard stores its config per scoreboard (overlays.scorecard.{N}.*) so
// two scorecard sources can be toggled independently; a plain overlays.scorecard.*
// leaf is the legacy global, merged underneath as a non-destructive fallback.
// All other layout types stay global (overlays.{type}.*).
function LayoutSettingsPanel({ layoutType, supportedSettings, scoreboardId }) {
    const allDefs = LAYOUT_SETTINGS[layoutType] ?? [];
    const settingsDefs = supportedSettings
        ? allDefs.filter(def => supportedSettings.includes(def.key))
        : allDefs;
    const perScoreboard = layoutType === 'scorecard' && scoreboardId != null;
    const writeNs = perScoreboard ? `${layoutType}.${scoreboardId}` : layoutType;

    const typeSettings = useSettingsStore(useShallow(s => s?.overlays?.[layoutType] ?? {}));
    const globalSettings = useSettingsStore(useShallow(s => s?.overlays?.global ?? {}));
    const setItem = useSettingsStore(s => s.setItem);
    const deleteItem = useSettingsStore(s => s.deleteItem);

    // Effective values: per-scoreboard overrides win over the legacy global leaves.
    const overlaySettings = useMemo(() => {
        if (!perScoreboard) return typeSettings;
        const perSb = typeSettings?.[scoreboardId] ?? typeSettings?.[String(scoreboardId)] ?? {};
        return { ...typeSettings, ...perSb };
    }, [perScoreboard, typeSettings, scoreboardId]);

    const overridable = useMemo(() => OVERRIDABLE_GLOBAL_KEYS.filter(def =>
        !supportedSettings || def.meta.some(m => supportedSettings.includes(m))
    ), [supportedSettings]);

    const pinned = overridable.filter(def => overlaySettings[def.key] != null);
    const available = overridable.filter(def => overlaySettings[def.key] == null);

    const setOverride = useCallback((key, value) =>
        setItem(`overlays.${writeNs}.${key}`, value), [writeNs, setItem]);

    // Reset every element setting + pinned override for this layout back to its
    // built-in default by removing the stored keys (overlays read the default
    // when the key is absent).
    const hasCustomized = useMemo(
        () => settingsDefs.some(def => overlaySettings[def.key] != null) || pinned.length > 0,
        [settingsDefs, overlaySettings, pinned],
    );
    const resetToDefaults = useCallback(() => {
        for (const def of settingsDefs) deleteItem(`overlays.${writeNs}.${def.key}`);
        for (const def of pinned) deleteItem(`overlays.${writeNs}.${def.key}`);
    }, [settingsDefs, pinned, writeNs, deleteItem]);

    return (
        <Stack gap="md">
            {perScoreboard && (
                <Text size="xs" dimmed>
                    These settings apply to <b>Scoreboard {scoreboardId}</b> only — each scoreboard's scorecard is configured independently.
                </Text>
            )}
            {(settingsDefs.length > 0 || pinned.length > 0) && (
                <div className="flex justify-end">
                    <Button variant="ghost" size="xs" onClick={resetToDefaults} disabled={!hasCustomized}>
                        <RotateCcw size={13} className="mr-1" /> Reset to defaults
                    </Button>
                </div>
            )}
            {settingsDefs.length > 0 && (
                <Stack gap="xs">
                    {settingsDefs.map(def => renderElementSetting(def, writeNs, overlaySettings, setItem))}
                </Stack>
            )}

            {(pinned.length > 0 || available.length > 0) && (
                <div>
                    {settingsDefs.length > 0 && <Divider className="mb-3" />}
                    <div className="mb-2 flex items-center justify-between">
                        <div>
                            <Text size="sm" fw={600}>Style Overrides</Text>
                            <Text size="xs" dimmed>
                                Pin per-overlay values that win over the global Design settings.
                            </Text>
                        </div>
                        {available.length > 0 && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="secondary" size="xs">+ Add override</Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-[220px]">
                                    <DropdownMenuLabel>Override a global setting</DropdownMenuLabel>
                                    {available.map(def => (
                                        <DropdownMenuItem
                                            key={def.key}
                                            onClick={() => {
                                                const seed = globalSettings[def.key] ?? def.defaultValue ?? '';
                                                setOverride(def.key, seed === '' ? def.defaultValue ?? '#000000' : seed);
                                            }}
                                        >
                                            {def.label}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                    </div>

                    {pinned.length === 0 ? (
                        <Text size="xs" dimmed>No overrides — using global values from the Design tab.</Text>
                    ) : (
                        <Stack gap="xs">
                            {pinned.map(def => (
                                <OverrideRow
                                    key={def.key}
                                    def={def}
                                    value={overlaySettings[def.key]}
                                    onChange={(v) => setOverride(def.key, v)}
                                    onRemove={() => setOverride(def.key, null)}
                                />
                            ))}
                        </Stack>
                    )}
                </div>
            )}

            {settingsDefs.length === 0 && pinned.length === 0 && available.length === 0 && (
                <Text size="xs" dimmed>This overlay has no configurable settings.</Text>
            )}
        </Stack>
    );
}

function renderElementSetting(def, writeNs, overlaySettings, setItem) {
    const settingsKey = `overlays.${writeNs}.${def.key}`;

    if (def.type === 'switch') {
        const checked = overlaySettings?.[def.key] !== false;
        return (
            <Label key={def.key} className="flex items-start gap-2">
                <Switch checked={checked} onCheckedChange={(c) => setItem(settingsKey, c)} className="mt-0.5" />
                <span className="flex flex-col">
                    <Text size="sm">{def.label}</Text>
                    {def.description && <Text size="xs" dimmed>{def.description}</Text>}
                </span>
            </Label>
        );
    }
    if (def.type === 'select') {
        const value = overlaySettings?.[def.key] ?? def.defaultValue;
        return (
            <div key={def.key} className="flex flex-col gap-1">
                <Label className="field-label">{def.label}</Label>
                {def.description && <Text size="xs" dimmed>{def.description}</Text>}
                <SimpleSelect value={value} onChange={(val) => setItem(settingsKey, val)} data={def.options} />
            </div>
        );
    }
    if (def.type === 'text') {
        const value = overlaySettings?.[def.key] ?? '';
        return (
            <div key={def.key} className="flex flex-col gap-1">
                <Label className="field-label">{def.label}</Label>
                {def.description && <Text size="xs" dimmed>{def.description}</Text>}
                <Input value={value} placeholder={def.placeholder || ''} onChange={(e) => setItem(settingsKey, e.currentTarget.value)} />
            </div>
        );
    }
    if (def.type === 'color-override') {
        const value = overlaySettings?.[def.key] ?? null;
        return (
            <div key={def.key}>
                <Text size="sm" fw={500}>{def.label}</Text>
                {def.description && <Text size="xs" dimmed className="mb-1">{def.description}</Text>}
                <div className="flex items-end gap-2">
                    <DebouncedColorInput
                        value={value ?? ''}
                        placeholder="Default"
                        onChange={(color) => setItem(settingsKey, color || null)}
                        swatches={COLOR_SWATCHES}
                        className="flex-1"
                    />
                    {value != null && (
                        <Button variant="ghost" size="sm" onClick={() => setItem(settingsKey, null)}>Reset</Button>
                    )}
                </div>
            </div>
        );
    }
    if (def.type === 'number-override') {
        const value = overlaySettings?.[def.key] ?? def.defaultValue;
        return (
            <div key={def.key} className="flex flex-col gap-1">
                <Label className="field-label">{def.label}</Label>
                {def.description && <Text size="xs" dimmed>{def.description}</Text>}
                <NumberInput value={value} onChange={(val) => setItem(settingsKey, val ?? def.defaultValue)} min={def.min} max={def.max} step={def.step} suffix={def.suffix} />
            </div>
        );
    }
    return null;
}

// One pinned override row (any type).
function OverrideRow({ def, value, onChange, onRemove }) {
    const sharedRemove = (
        <SimpleTooltip label="Remove override (use global value)">
            <Button variant="ghost" size="icon-sm" onClick={onRemove}><X size={14} /></Button>
        </SimpleTooltip>
    );

    let editor = null;
    if (def.type === 'color') {
        editor = (
            <div className="flex flex-col gap-1">
                <Label className="field-label">{def.label}</Label>
                <DebouncedColorInput value={value ?? ''} onChange={(c) => onChange(c || null)} swatches={COLOR_SWATCHES} className="flex-1" />
            </div>
        );
    } else if (def.type === 'color-opacity') {
        editor = <ColorWithOpacity label={def.label} value={value} onChange={onChange} />;
    } else if (def.type === 'number') {
        editor = (
            <div className="flex flex-col gap-1">
                <Label className="field-label">{def.label}</Label>
                <NumberInput value={value ?? def.defaultValue} onChange={(v) => onChange(v ?? def.defaultValue)} min={def.min} max={def.max} step={def.step} suffix={def.suffix} />
            </div>
        );
    } else if (def.type === 'switch') {
        editor = (
            <Label className="flex items-center gap-2 text-sm">
                <Switch checked={value !== false} onCheckedChange={onChange} />
                {def.label}
            </Label>
        );
    } else if (def.type === 'font') {
        editor = (
            <div className="flex flex-col gap-1">
                <Label className="field-label">{def.label}</Label>
                <FontCombobox
                    value={value ?? def.defaultValue}
                    onChange={(v) => onChange(v || def.defaultValue)}
                />
            </div>
        );
    }

    return (
        <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">{editor}</div>
            {sharedRemove}
        </div>
    );
}

// ── Controller Overlay Panel ──
function ControllerOverlayPanel({ selected, onSelect }) {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(false);

    const fetchStatus = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/controller/status');
            setStatus(await resp.json());
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { fetchStatus(); }, [fetchStatus]);

    useEffect(() => {
        if (!status?.running) return;
        const id = setInterval(fetchStatus, 5000);
        return () => clearInterval(id);
    }, [status?.running, fetchStatus]);

    const handleStart = useCallback(async () => {
        setLoading(true);
        try {
            const resp = await fetch('/api/v1/controller/start', { method: 'POST' });
            const data = await resp.json();
            if (data.success) {
                notifications.show({ message: 'Controller overlay started', color: 'green' });
                await fetchStatus();
            } else if (data.reason === 'port_in_use') {
                const suggested = data.suggested_port;
                const notifId = `ctrl-port-${data.port}`;
                notifications.show({
                    id: notifId,
                    title: `Port ${data.port} is in use`,
                    color: 'orange',
                    autoClose: false,
                    message: suggested ? (
                        <Stack gap="xs">
                            <Text size="sm">
                                Another process is using port {data.port}. Switch to port {suggested}?
                            </Text>
                            <div className="flex items-center gap-2">
                                <Button size="xs" onClick={async () => {
                                    notifications.hide(notifId);
                                    await fetch(`/api/v1/controller/port?port=${suggested}`, { method: 'PUT' });
                                    const r2 = await fetch('/api/v1/controller/start', { method: 'POST' });
                                    const d2 = await r2.json();
                                    if (d2.success) {
                                        notifications.show({ message: `Started on port ${suggested}`, color: 'green' });
                                        await fetchStatus();
                                    } else {
                                        notifications.show({ message: d2.error || 'Failed to start', color: 'red' });
                                    }
                                }}>Use port {suggested}</Button>
                            </div>
                        </Stack>
                    ) : 'No nearby free port found. Change the port manually in settings.',
                });
            } else {
                notifications.show({ message: data.error || 'Failed to start', color: 'red' });
            }
        } catch (e) {
            notifications.show({ message: 'Failed to start controller overlay', color: 'red' });
        }
        setLoading(false);
    }, [fetchStatus]);

    const handleStop = useCallback(async () => {
        setLoading(true);
        try {
            const resp = await fetch('/api/v1/controller/stop', { method: 'POST' });
            const data = await resp.json();
            if (data.success) {
                notifications.show({ message: 'Controller overlay stopped', color: 'blue' });
                await fetchStatus();
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, [fetchStatus]);

    const handleSelectPort = useCallback((portNum) => {
        const overlayUrl = `http://localhost:${status?.port ?? 8069}/?port=${portNum}&bg=transparent`;
        onSelect({
            group: 'controller',
            name: `Player ${portNum} Controller`,
            type: 'controller',
            url: overlayUrl,
            width: 512,
            height: 256,
            _controllerPort: portNum,
        });
    }, [status?.port, onSelect]);

    if (!status) return <Loader size={18} />;

    if (!status.available) {
        return (
            <Stack gap="xs">
                <Text size="sm" dimmed>Controller overlay (gc-overlay) not found.</Text>
                <Text size="xs" dimmed>Place the gc-overlay repository next to this project, or set the path in Settings.</Text>
            </Stack>
        );
    }

    return (
        <Stack gap="sm">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ backgroundColor: status.running ? '#22c55e' : '#6b7280' }} />
                    <Text size="sm" fw={600}>{status.running ? 'Running' : 'Stopped'}</Text>
                </div>
                <Button
                    size="xs"
                    variant={status.running ? 'outline' : 'default'}
                    className={status.running ? 'border-destructive/40 text-destructive' : ''}
                    onClick={status.running ? handleStop : handleStart}
                    disabled={loading}
                >
                    {loading && <Loader size={10} />}
                    {status.running ? 'Stop' : 'Start'}
                </Button>
            </div>

            {status.running && (
                <Text size="xs" dimmed>OBS Browser Source: 512 x 256</Text>
            )}

            <Stack gap="xs">
                {[1, 2, 3, 4].map(portNum => {
                    const isActive = selected?._controllerPort === portNum;
                    const portUrl = `http://localhost:${status.port}/?port=${portNum}&bg=transparent`;
                    return (
                        <button
                            key={portNum}
                            type="button"
                            onClick={() => handleSelectPort(portNum)}
                            className={cn(itemClass(isActive), !status.running && 'opacity-50')}
                            disabled={!status.running}
                        >
                            <div className="flex flex-nowrap items-center justify-between gap-1">
                                <div className="min-w-0 flex-1">
                                    <Text size="sm">Player {portNum}</Text>
                                </div>
                                {status.running && <CopyIconButton value={portUrl} />}
                            </div>
                        </button>
                    );
                })}
            </Stack>

            {!status.running && (
                <Text size="xs" dimmed className="italic">
                    Start the overlay to preview and copy OBS URLs.
                </Text>
            )}
        </Stack>
    );
}

export default function LayoutBrowser() {
    const active = useSettingsStore(s => s?.scoreboards?.active ?? [1]);
    const bindings = useSettingsStore(s => s?.scoreboards?.binding ?? {});
    const hudEnabled = useSettingsStore(s => s?.project_rio?.hud_enabled ?? true);
    const aliases = useSettingsStore(s => s?.scoreboards?.aliases ?? {});
    const controllerSupported = useConfigStore(s => s.controller_overlay_supported) !== false;

    const [allLayouts, setAllLayouts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selected, setSelected] = useState(null);
    const [activeScoreboardTab, setActiveScoreboardTab] = useState(String(active[0] ?? 1));
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [previewRevision, setPreviewRevision] = useState(0);

    // Remember the last Setup sub-tab across tab switches / restarts (local UI
    // pref). Drop a stored 'controller' when this build can't show it.
    const [mode, setMode] = usePersistentState(
        'prsh.ui.setup.mode', 'scoreboard',
        v => ['design', 'scoreboard', 'scenes', 'talent', 'break', 'shared', 'bracket', 'controller'].includes(v)
            && (v !== 'controller' || controllerSupported),
    );

    const fetchLayouts = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const resp = await fetch('/api/v1/layouts');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            setAllLayouts(await resp.json());
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchLayouts();
    }, [fetchLayouts]);

    const filteredLayouts = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return allLayouts.filter(l => {
            if (l.group === 'bracket') return false;
            const isScoreboard = l.group.startsWith('scoreboard') || l.group === 'scorecard' || l.group === 'rotator';
            if (!isScoreboard) return false;
            if (q && !l.name.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [allLayouts, searchQuery]);

    const sceneLayouts = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return allLayouts.filter(l => {
            // Full 1920×1080 scenes, plus the Event Header banner which lives with
            // the scene-level furniture in this grouping.
            if (l.group !== 'scenes' && l.group !== 'eventheader') return false;
            if (q && !l.name.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [allLayouts, searchQuery]);

    // Shared "fed" sources (e.g. the stats-feed the producer feeds content to
    // from the Production page). They live under public/layout/shared/.
    const sharedLayouts = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return allLayouts.filter(l => {
            if (l.group !== 'shared') return false;
            if (q && !l.name.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [allLayouts, searchQuery]);

    // Talent — registry-bound person and matchup overlays: the commentary
    // caster strip, the player-plates band, and the Matchup History card.
    // All three render content fed from the address book / match.
    const talentLayouts = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return allLayouts.filter(l => {
            if (l.group !== 'commentary' && l.group !== 'playerplates' && l.group !== 'matchup') return false;
            if (q && !l.name.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [allLayouts, searchQuery]);

    // Break — broadcast-furniture overlays for breaks / mid-game cuts. The
    // re-themable SVG lower-third now; more break graphics may join later.
    const breakLayouts = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return allLayouts.filter(l => {
            if (l.group !== 'lowerthird') return false;
            if (q && !l.name.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [allLayouts, searchQuery]);

    useEffect(() => {
        const activeLayouts = mode === 'scenes' ? sceneLayouts
            : mode === 'shared' ? sharedLayouts
            : mode === 'talent' ? talentLayouts
            : mode === 'break' ? breakLayouts
            : filteredLayouts;
        if (mode !== 'scoreboard' && mode !== 'scenes' && mode !== 'shared' && mode !== 'talent' && mode !== 'break') return;
        if (activeLayouts.length > 0) {
            setSelected(prev => {
                if (prev && activeLayouts.some(l => l.url === prev.url)) return prev;
                return activeLayouts[0];
            });
        } else {
            setSelected(null);
        }
    }, [filteredLayouts, sceneLayouts, sharedLayouts, talentLayouts, breakLayouts, mode]);

    useEffect(() => {
        setSearchQuery('');
        setSelected(null);
        setSettingsOpen(false);
        setPreviewRevision(0);
    }, [mode]);

    useEffect(() => {
        setSearchQuery('');
    }, [activeScoreboardTab]);

    useEffect(() => {
        setSettingsOpen(false);
    }, [selected?.url]);

    const selectedType = selected?.type;
    const supportedSettings = useMemo(() => {
        if (selected?.supportedSettings) return selected.supportedSettings;
        if (!selectedType) return null;
        const match = allLayouts.find(l => l.type === selectedType && l.supportedSettings);
        return match?.supportedSettings ?? null;
    }, [selected?.supportedSettings, selectedType, allLayouts]);
    const hasAnySupportedSettings = supportedSettings === null || supportedSettings.length > 0;
    const showSettingsPanel = !!selectedType && hasAnySupportedSettings && mode !== 'design';

    const setSetting = useSettingsStore(s => s.setItem);
    const isAnimatedType = !!selectedType && ANIMATED_TYPES.has(selectedType);
    const introDisabled = useSettingsStore(s => !!s?.overlays?.[selectedType]?.disableIntro);

    const selectedUrl = useMemo(() => {
        if (!selected?.url) return null;
        try {
            const u = new URL(selected.url);
            if (mode === 'scoreboard') {
                u.searchParams.set('scoreboard', activeScoreboardTab);
            }
            // Carry the intro opt-out into the copy/preview/Add-to-OBS URL so a
            // newly-added source starts in the right state.
            if (isAnimatedType && introDisabled) u.searchParams.set('intro', '0');
            return u.toString();
        } catch {
            return selected.url;
        }
    }, [selected?.url, activeScoreboardTab, mode, isAnimatedType, introDisabled]);

    // Turn the reveal animation on/off for this layout. Persists the preference
    // (drives the copy/preview URL above) AND rewrites any already-added OBS
    // sources of this layout in place, so bound sources update without re-copying.
    const setIntroEnabled = useCallback(async (animOn) => {
        if (!selectedType || !selected?.url) return;
        const disabled = !animOn;
        setSetting(`overlays.${selectedType}.disableIntro`, disabled);
        setPreviewRevision(r => r + 1);
        try {
            const path = new URL(selected.url).pathname;
            const n = await useObsStore.getState().setLayoutIntroDisabled(path, disabled);
            if (n) notifications.show({
                message: `Intro animation ${disabled ? 'off' : 'on'} — updated ${n} OBS source${n > 1 ? 's' : ''}`,
                color: 'green',
            });
        } catch { /* OBS offline or source gone — the setting still persists */ }
    }, [selectedType, selected?.url, setSetting]);

    const baseUrl = useMemo(() => {
        try {
            const first = allLayouts.find(l => l.group === 'bracket');
            if (first) return new URL(first.url).origin;
        } catch {}
        return `http://localhost:5260`;
    }, [allLayouts]);

    return (
        <Stack gap="md">
            {/* Top-level mode tabs */}
            <Tabs value={mode} onValueChange={setMode}>
                <TabsList>
                    <TabsTrigger value="design">Design</TabsTrigger>
                    <TabsTrigger value="scoreboard">Scoreboards</TabsTrigger>
                    <TabsTrigger value="scenes">Scenes</TabsTrigger>
                    <TabsTrigger value="talent">Talent</TabsTrigger>
                    <TabsTrigger value="break">Break</TabsTrigger>
                    <TabsTrigger value="shared">Shared</TabsTrigger>
                    <TabsTrigger value="bracket">Bracket</TabsTrigger>
                    {controllerSupported && <TabsTrigger value="controller">Controller</TabsTrigger>}
                </TabsList>
            </Tabs>

            {/* Scoreboard sub-tabs (only in scoreboard mode) */}
            {mode === 'scoreboard' && (
                <Tabs value={activeScoreboardTab} onValueChange={setActiveScoreboardTab}>
                    <TabsList>
                        {active.map(sbId => {
                            const bind = bindings[sbId] ?? bindings[String(sbId)] ?? {};
                            const transport = (sbId === 1 && hudEnabled) ? 'hud' : 'api';
                            const srcType = bindingBadgeKey({
                                transport,
                                mode: bind.playback?.mode ?? 'single',
                                gameId: bind.playback?.gameId ?? null,
                            });
                            const alias = aliases[sbId] ?? aliases[String(sbId)] ?? '';
                            const label = alias || `Scoreboard ${sbId}`;
                            return (
                                <TabsTrigger key={sbId} value={String(sbId)}>
                                    <span className="flex items-center gap-1.5">
                                        {label}
                                        <Badge className={cn('text-[10px] font-semibold uppercase tracking-wider', SOURCE_COLORS[srcType] || SOURCE_COLORS.manual)}>
                                            {SOURCE_LABEL[srcType] || srcType}
                                        </Badge>
                                    </span>
                                </TabsTrigger>
                            );
                        })}
                    </TabsList>
                </Tabs>
            )}

            {mode === 'design' ? (
                <DesignTabBody baseUrl={baseUrl} />
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                    {/* Left panel: layout list */}
                    <div className="md:col-span-4">
                        <Stack gap="xs">
                            <Text size="xs" dimmed>
                                Select a layout to preview. Copy the URL into an OBS Browser Source, or
                                — when OBS is connected — use Add to OBS. The dot shows whether each
                                layout is already a source in your program (green) or preview (amber) scene.
                            </Text>

                            {mode === 'scoreboard' && (
                                <>
                                    <Input placeholder="Search layouts..." value={searchQuery} onChange={(e) => setSearchQuery(e.currentTarget.value)} />
                                    {loading && <Loader size={18} />}
                                    {error && <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
                                    <LayoutList layouts={filteredLayouts} selected={selected} onSelect={setSelected} activeTab={activeScoreboardTab} />
                                </>
                            )}

                            {mode === 'scenes' && (
                                <>
                                    <Input placeholder="Search scenes..." value={searchQuery} onChange={(e) => setSearchQuery(e.currentTarget.value)} />
                                    {loading && <Loader size={18} />}
                                    {error && <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
                                    {sceneLayouts.length === 0 && !loading && (
                                        <Text size="sm" dimmed>No scene layouts found.</Text>
                                    )}
                                    <Stack gap="xs">
                                        {sceneLayouts.map(item => (
                                            <LayoutItem key={item.url} item={item} selected={selected} onSelect={setSelected} activeTab={activeScoreboardTab} />
                                        ))}
                                    </Stack>
                                </>
                            )}

                            {mode === 'talent' && (
                                <>
                                    <Text size="xs" dimmed>
                                        Talent and matchup overlays — the commentary caster strip, the
                                        player-plates band, and the Matchup History card. Author them on
                                        the Commentary / Match tabs; control them live from the
                                        Production page.
                                    </Text>
                                    <Input placeholder="Search talent overlays..." value={searchQuery} onChange={(e) => setSearchQuery(e.currentTarget.value)} />
                                    {loading && <Loader size={18} />}
                                    {error && <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
                                    {talentLayouts.length === 0 && !loading && (
                                        <Text size="sm" dimmed>No talent overlays found.</Text>
                                    )}
                                    <Stack gap="xs">
                                        {talentLayouts.map(item => (
                                            <LayoutItem key={item.url} item={item} selected={selected} onSelect={setSelected} activeTab={activeScoreboardTab} />
                                        ))}
                                    </Stack>
                                </>
                            )}

                            {mode === 'break' && (
                                <>
                                    <Text size="xs" dimmed>
                                        Break graphics — the re-themable lower-third (logo · match ·
                                        title · clock). Add it to OBS and author the match/title/countdown
                                        live from the Production page → Break. Its look follows the
                                        Design Package picked on the Design tab.
                                    </Text>
                                    <Input placeholder="Search break overlays..." value={searchQuery} onChange={(e) => setSearchQuery(e.currentTarget.value)} />
                                    {loading && <Loader size={18} />}
                                    {error && <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
                                    {breakLayouts.length === 0 && !loading && (
                                        <Text size="sm" dimmed>No break overlays found.</Text>
                                    )}
                                    <Stack gap="xs">
                                        {breakLayouts.map(item => (
                                            <LayoutItem key={item.url} item={item} selected={selected} onSelect={setSelected} activeTab={activeScoreboardTab} />
                                        ))}
                                    </Stack>
                                </>
                            )}

                            {mode === 'shared' && (
                                <>
                                    <Text size="xs" dimmed>
                                        Shared “fed” sources. Add one to OBS once, then choose what it
                                        shows from the Production page (e.g. which player’s stats).
                                    </Text>
                                    <Input placeholder="Search shared sources..." value={searchQuery} onChange={(e) => setSearchQuery(e.currentTarget.value)} />
                                    {loading && <Loader size={18} />}
                                    {error && <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
                                    {sharedLayouts.length === 0 && !loading && (
                                        <Text size="sm" dimmed>No shared sources found.</Text>
                                    )}
                                    <Stack gap="xs">
                                        {sharedLayouts.map(item => (
                                            <LayoutItem key={item.url} item={item} selected={selected} onSelect={setSelected} activeTab={activeScoreboardTab} />
                                        ))}
                                    </Stack>
                                </>
                            )}

                            {mode === 'bracket' && (
                                <BracketLayoutList selected={selected} onSelect={setSelected} baseUrl={baseUrl} />
                            )}

                            {mode === 'controller' && (
                                <ControllerOverlayPanel selected={selected} onSelect={setSelected} />
                            )}
                        </Stack>
                    </div>

                    {/* Right panel: iframe preview + settings */}
                    <div className="md:col-span-8">
                        <Panel className="overflow-hidden">
                            {selected && selectedUrl ? (
                                <>
                                    <div className="flex flex-nowrap items-center justify-between gap-1 border-b border-border p-2">
                                        <Text size="xs" dimmed truncate className="min-w-0 flex-1">{selectedUrl}</Text>
                                        <div className="flex flex-nowrap items-center gap-1">
                                            <ObsBindingControls
                                                url={selectedUrl}
                                                name={selected?.name || selectedType || 'PRSH Overlay'}
                                                width={selected?.width}
                                                height={selected?.height}
                                            />
                                            {isAnimatedType && (
                                                <SimpleTooltip label={introDisabled
                                                    ? 'Intro animation off — source stays resident (no reload on show)'
                                                    : 'Intro animation on — source reloads on show for a clean reveal'}>
                                                    <label className="flex items-center gap-1.5 whitespace-nowrap px-1">
                                                        <Text size="xs" dimmed>Intro</Text>
                                                        <Switch
                                                            checked={!introDisabled}
                                                            onCheckedChange={setIntroEnabled}
                                                        />
                                                    </label>
                                                </SimpleTooltip>
                                            )}
                                            <SimpleTooltip label="Reload preview">
                                                <Button variant="ghost" size="icon-sm" onClick={() => setPreviewRevision(r => r + 1)}>
                                                    <RotateCw size={14} />
                                                </Button>
                                            </SimpleTooltip>
                                            {showSettingsPanel && (
                                                <SimpleTooltip label={settingsOpen ? 'Close settings' : 'Layout settings'}>
                                                    <Button variant={settingsOpen ? 'default' : 'ghost'} size="icon-sm" onClick={() => setSettingsOpen(o => !o)}>
                                                        <SettingsIcon size={14} />
                                                    </Button>
                                                </SimpleTooltip>
                                            )}
                                            <CopyButton value={selectedUrl}>
                                                {({ copied, copy }) => (
                                                    <SimpleTooltip label={copied ? 'Copied!' : 'Copy URL'}>
                                                        <Button variant="ghost" size="xs" className={copied ? 'text-[#14b8a6]' : ''} onClick={copy}>
                                                            {copied ? 'Copied' : 'Copy'}
                                                        </Button>
                                                    </SimpleTooltip>
                                                )}
                                            </CopyButton>
                                        </div>
                                    </div>
                                    <ScaledIframe key={`${selectedUrl}-${previewRevision}`} src={selectedUrl} fallbackWidth={selected?.width} fallbackHeight={selected?.height} />
                                </>
                            ) : (
                                <div className="flex items-center justify-center" style={{ height: PREVIEW_HEIGHT }}>
                                    <Text dimmed>
                                        {mode === 'bracket'
                                            ? 'Select a bracket phase to preview'
                                            : mode === 'controller'
                                            ? 'Start the controller overlay to preview'
                                            : 'Select a layout to preview'}
                                    </Text>
                                </div>
                            )}
                        </Panel>

                        {showSettingsPanel && (
                            <Collapsible open={settingsOpen}>
                                <CollapsibleContent>
                                    <Panel className="mt-2 p-3">
                                        <Text size="sm" fw={600} className="mb-2 capitalize">
                                            {selectedType} Settings
                                        </Text>
                                        <LayoutSettingsPanel layoutType={selectedType} supportedSettings={supportedSettings} scoreboardId={mode === 'scoreboard' ? activeScoreboardTab : null} />
                                    </Panel>
                                </CollapsibleContent>
                            </Collapsible>
                        )}
                    </div>
                </div>
            )}
        </Stack>
    );
}
