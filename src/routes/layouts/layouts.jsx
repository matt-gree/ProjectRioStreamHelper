import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    Stack, Paper, Text, Group, Grid, UnstyledButton,
    CopyButton, ActionIcon, Button, Tooltip, Box, Loader, Alert, Tabs, Badge, Switch,
    Collapse, ColorInput, FileButton, Image, TextInput, Autocomplete, Select, NumberInput, Divider,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useShallow } from 'zustand/react/shallow';
import useTournament from '../../hooks/useTournament';

const PREVIEW_HEIGHT = 500;

// ── Per-layout-type settings definitions ──
// Each entry: { key, type, label, description? }
// Supported control types: 'switch', 'color-override', 'color-opacity-override', 'number-override'
// color-opacity-override extras: globalKey, globalFallback
// number-override extras: globalKey, globalFallback, min, max, step, suffix
const LAYOUT_SETTINGS = {
    scoreboard: [
        { key: 'showCaptains', type: 'switch', label: 'Show Captains', description: 'Display captain character icons' },
        { key: 'showElo', type: 'switch', label: 'Show ELO', description: 'Display ELO ratings on completed games' },
        { key: 'showTeamLogos', type: 'switch', label: 'Show Team Logos', description: 'Display MSB team logos' },
        { key: 'showLogo', type: 'switch', label: 'Show Overlay Logo', description: 'Display the uploaded logo on scoreboard' },
        { key: 'showBackdropBlur', type: 'switch', label: 'Backdrop Blur', description: 'Enable glass blur effect on card background' },
        { key: 'showShadow', type: 'switch', label: 'Card Shadow', description: 'Show drop shadow behind the overlay card' },
        { key: 'accentColor', type: 'color-override', label: 'Accent Color', description: 'Override the global accent color for this overlay' },
        { key: 'textColor', type: 'color-override', label: 'Text Color', description: 'Override the global text color for this overlay' },
        { key: 'finalBadgeColor', type: 'color-override', label: 'Final Badge Color', description: 'Override the color of the "Final" badge on completed games' },
        { key: 'cardBg', type: 'color-opacity-override', label: 'Card Background', description: 'Background color for this overlay card', globalKey: 'cardBg', globalFallback: 'rgba(15, 15, 25, 0.88)' },
        { key: 'borderColor', type: 'color-opacity-override', label: 'Border Color', description: 'Border color for this overlay card', globalKey: 'borderColor', globalFallback: 'rgba(255, 255, 255, 0.08)' },
        { key: 'borderRadius', type: 'number-override', label: 'Border Radius', description: 'Corner rounding for this overlay card (px)', globalKey: 'borderRadius', globalFallback: 16, min: 0, max: 48, step: 2, suffix: 'px' },
        { key: 'borderWidth', type: 'number-override', label: 'Border Thickness', description: 'Border width for this overlay card (px)', globalKey: 'borderWidth', globalFallback: 1, min: 0, max: 16, step: 1, suffix: 'px' },
        { key: 'cardShadowBlur', type: 'number-override', label: 'Card Shadow Blur', description: 'Override the card shadow blur for this overlay (px)', globalKey: 'cardShadowBlur', globalFallback: 16, min: 0, max: 80, step: 2, suffix: 'px' },
        { key: 'textShadowBlur', type: 'number-override', label: 'Text Shadow Blur', description: 'Override the text shadow blur for this overlay (px)', globalKey: 'textShadowBlur', globalFallback: 4, min: 0, max: 20, step: 1, suffix: 'px' },
    ],
    roster: [
        { key: 'showSuperstars', type: 'switch', label: 'Show Superstar Icons', description: 'Display superstar badge on starred characters' },
        { key: 'accentColor', type: 'color-override', label: 'Accent Color Override', description: 'Override the global accent color for this overlay' },
    ],
    stats: [
        { key: 'accentColor',    type: 'color-override', label: 'Accent Color',  description: 'Override the global accent color for this overlay' },
        { key: 'statValueColor', type: 'color-override', label: 'Stat Value Color', description: 'Color of the main stat numbers (e.g. AVG, ERA)' },
        { key: 'subtextColor',   type: 'color-override', label: 'Subtext Color',    description: 'Color of stat labels and the game line text' },
        { key: 'cardBg', type: 'color-opacity-override', label: 'Card Background', description: 'Background color for this overlay card', globalKey: 'cardBg', globalFallback: 'rgba(15, 15, 25, 0.88)' },
        { key: 'borderColor', type: 'color-opacity-override', label: 'Border Color', description: 'Border color for this overlay card', globalKey: 'borderColor', globalFallback: 'rgba(255, 255, 255, 0.08)' },
        { key: 'borderRadius', type: 'number-override', label: 'Border Radius', description: 'Corner rounding for this overlay card (px)', globalKey: 'borderRadius', globalFallback: 16, min: 0, max: 48, step: 2, suffix: 'px' },
        { key: 'borderWidth', type: 'number-override', label: 'Border Thickness', description: 'Border width for this overlay card (px)', globalKey: 'borderWidth', globalFallback: 1, min: 0, max: 16, step: 1, suffix: 'px' },
        { key: 'cardShadowBlur', type: 'number-override', label: 'Card Shadow Blur', description: 'Override the card shadow blur for this overlay (px)', globalKey: 'cardShadowBlur', globalFallback: 16, min: 0, max: 80, step: 2, suffix: 'px' },
        { key: 'textShadowBlur', type: 'number-override', label: 'Text Glow Blur', description: 'Override text glow blur for this overlay (px)', globalKey: 'textShadowBlur', globalFallback: 4, min: 0, max: 40, step: 1, suffix: 'px' },
    ],
    teamlogo: [],
    scene: [
        { key: 'team1ShowYouTube', type: 'switch', label: 'Player 1: Show YouTube', description: 'When on, shows the YouTube handle. When off, shows the Twitter/X handle.' },
        { key: 'team2ShowYouTube', type: 'switch', label: 'Player 2: Show YouTube', description: 'When on, shows the YouTube handle. When off, shows the Twitter/X handle.' },
    ],
    bracket: [
        { key: 'accentColor', type: 'color-override', label: 'Accent Color Override', description: 'Override the global accent color for this overlay' },
        { key: 'connectorColor', type: 'color-override', label: 'Connector Line Color', description: 'Override the color of bracket connector lines' },
        { key: 'activeColor', type: 'color-override', label: 'Active Match Color', description: 'Override the highlight color for active/in-progress matches' },
    ],
};

const COLOR_SWATCHES = [
    '#f59e0b', '#ef4444', '#22c55e', '#3b82f6',
    '#a855f7', '#ec4899', '#14b8a6', '#f97316',
    '#6366f1', '#64748b',
];

function ScaledIframe({ src, fallbackWidth, fallbackHeight }) {
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
                    // cross-origin: contentDocument is null
                    if (fallbackWidth && fallbackHeight) {
                        setNativeSize({ w: fallbackWidth, h: fallbackHeight });
                    }
                    return;
                }
                // Prefer data-ref-w/h attributes (set by overlay auto-scale JS)
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
                // cross-origin fallback
                if (fallbackWidth && fallbackHeight) {
                    setNativeSize({ w: fallbackWidth, h: fallbackHeight });
                }
            }
        };
        requestAnimationFrame(readSize);
    }, [fallbackWidth, fallbackHeight]);

    return (
        <Box
            ref={containerRef}
            style={{
                position: 'relative',
                height: PREVIEW_HEIGHT,
                background: '#1a1a1a',
                overflow: 'hidden',
            }}
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
                    opacity: nativeSize ? 1 : 0,
                    transform: nativeSize
                        ? `translate(${layout.offsetX}px, ${layout.offsetY}px) scale(${layout.scale})`
                        : 'none',
                    transformOrigin: 'top left',
                }}
                title="Layout Preview"
            />
        </Box>
    );
}

const SOURCE_COLORS = { hud: 'green', api: 'blue', manual: 'gray' };

function LayoutItem({ item, selected, onSelect, activeTab }) {
    const copyUrl = useMemo(() => {
        try {
            const u = new URL(item.url);
            u.searchParams.set('scoreboard', activeTab);
            return u.toString();
        } catch { return item.url; }
    }, [item.url, activeTab]);

    return (
        <UnstyledButton
            onClick={() => onSelect(item)}
            p="xs"
            style={(theme) => ({
                borderRadius: theme.radius.sm,
                backgroundColor: selected?.url === item.url
                    ? theme.colors.blue[0]
                    : 'transparent',
                border: selected?.url === item.url
                    ? `1px solid ${theme.colors.blue[3]}`
                    : '1px solid transparent',
            })}
        >
            <Group justify="space-between" wrap="nowrap" gap={4}>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <Text size="sm" truncate>
                        {item.sizeVariant
                            ? `${item.sizeLabel} (${item.sizeVariant.toUpperCase()})`
                            : item.name}
                    </Text>
                    {item.width && item.height && (
                        <Text size="xs" c="dimmed">{item.width} x {item.height}</Text>
                    )}
                </div>
                <CopyButton value={copyUrl}>
                    {({ copied, copy }) => (
                        <Tooltip label={copied ? 'Copied!' : 'Copy URL'}>
                            <ActionIcon
                                variant="subtle"
                                color={copied ? 'teal' : 'gray'}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    copy();
                                }}
                            >
                                {copied ? '\u2713' : '\u2398'}
                            </ActionIcon>
                        </Tooltip>
                    )}
                </CopyButton>
            </Group>
        </UnstyledButton>
    );
}

// Order in which team layouts appear in the two-column section
const TEAM_LAYOUT_ORDER = ['roster', 'stats', 'teamlogo'];

function LayoutList({ layouts, selected, onSelect, activeTab }) {
    const [expandedGroups, setExpandedGroups] = useState({});

    if (layouts.length === 0) {
        return (
            <Text size="sm" c="dimmed">
                No layouts found for this scoreboard.
            </Text>
        );
    }

    // Separate size-variant layouts (scoreboard) from team-based layouts
    const sizeVariantLayouts = layouts.filter(l => l.sizeVariant);
    const teamLayouts = layouts.filter(l => l.team != null);

    // Group size-variant layouts by parentName
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

    // Split team layouts into team 1 and team 2, sorted by TEAM_LAYOUT_ORDER
    const team1 = TEAM_LAYOUT_ORDER.map(t => teamLayouts.find(l => l.type === t && l.team === 1)).filter(Boolean);
    const team2 = TEAM_LAYOUT_ORDER.map(t => teamLayouts.find(l => l.type === t && l.team === 2)).filter(Boolean);

    return (
        <Stack gap={4}>
            {/* Scoreboard size-variant groups */}
            {Object.entries(groups).map(([key, { parentName, items }]) => {
                const open = expandedGroups[key] || isGroupActive(items);
                return (
                    <div key={key}>
                        <UnstyledButton
                            onClick={() => toggleGroup(key)}
                            p="xs"
                            style={(theme) => ({
                                borderRadius: theme.radius.sm,
                                width: '100%',
                                backgroundColor: isGroupActive(items)
                                    ? theme.colors.blue[0]
                                    : 'transparent',
                            })}
                        >
                            <Group justify="space-between" wrap="nowrap">
                                <Text size="sm" fw={600}>{parentName}</Text>
                                <Text size="xs" c="dimmed">
                                    {open ? '\u25B4' : '\u25BE'} {items.length} sizes
                                </Text>
                            </Group>
                        </UnstyledButton>
                        <Collapse in={open}>
                            <Stack gap={2} pl="sm">
                                {items.map((item) => (
                                    <LayoutItem
                                        key={item.url}
                                        item={item}
                                        selected={selected}
                                        onSelect={onSelect}
                                        activeTab={activeTab}
                                    />
                                ))}
                            </Stack>
                        </Collapse>
                    </div>
                );
            })}

            {/* Two-column Team 1 / Team 2 section */}
            {(team1.length > 0 || team2.length > 0) && (
                <div style={{ borderTop: '1px solid var(--mantine-color-gray-3)', marginTop: 4, paddingTop: 8 }}>
                    <Grid columns={2} gutter={8}>
                        <Grid.Col span={1}>
                            <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: '0.5px' }}>
                                Team 1
                            </Text>
                            <Stack gap={2}>
                                {team1.map((item) => (
                                    <LayoutItem
                                        key={item.url}
                                        item={item}
                                        selected={selected}
                                        onSelect={onSelect}
                                        activeTab={activeTab}
                                    />
                                ))}
                            </Stack>
                        </Grid.Col>
                        <Grid.Col span={1}>
                            <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: '0.5px' }}>
                                Team 2
                            </Text>
                            <Stack gap={2}>
                                {team2.map((item) => (
                                    <LayoutItem
                                        key={item.url}
                                        item={item}
                                        selected={selected}
                                        onSelect={onSelect}
                                        activeTab={activeTab}
                                    />
                                ))}
                            </Stack>
                        </Grid.Col>
                    </Grid>
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

    // Auto-select round-robin (pool) phase groups when phases load
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

    // When loaded, checked state lives in playerSchedule.visiblePgIds (state);
    // before load, it lives in local selectedPgIds.
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

    const isStartGG = bracketLink && /start\.gg/i.test(bracketLink);

    // Build flat list of phase groups across all phases
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
            const baseApi = isStartGG ? '/api/v1/startgg' : '/api/v1/challonge';
            // Load ALL phase groups upfront so visibility can be toggled without reloading
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
            // visiblePgIds initialised from the pre-load checkbox selection
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
    }, [allPgs, selectedPgIds, isStartGG, setStateItem]);

    const scheduleUrl = `${baseUrl}/layout/bracket/player_schedule.html`;
    const variants = [
        { key: 'all', label: 'All Games', url: scheduleUrl },
        { key: 'upcoming', label: 'Upcoming Only', url: `${scheduleUrl}?pool_only=true` },
        { key: 'noresults', label: 'Hide Results', url: `${scheduleUrl}?show_results=false` },
        { key: 'progressive', label: 'Progressive Reveal', url: `${scheduleUrl}?progressive=true` },
    ];

    // Autocomplete options from loaded schedule players
    const playerNames = useMemo(() =>
        Object.values(playerScheduleData?.players ?? {})
            .map(p => p.name).filter(Boolean).sort(),
    [playerScheduleData]);

    // After loading + player name entered, filter phases to only those the player appears in
    const visiblePgs = useMemo(() => {
        if (!playerScheduleData || !draftPlayer) return allPgs;
        const { sets = [], players = {} } = playerScheduleData;
        let targetId = null;
        for (const [id, p] of Object.entries(players)) {
            if ((p.name || '').toLowerCase() === draftPlayer.toLowerCase()) { targetId = id; break; }
        }
        if (!targetId) return allPgs;
        // Which phase groups were actually loaded into playerSchedule
        const loadedPgIds = new Set(sets.map(s => s.phaseGroupId).filter(Boolean));
        // Which loaded phase groups contain this player's sets
        const playerPgIds = new Set(
            sets.filter(s => s.entrant1Id === targetId || s.entrant2Id === targetId)
                .map(s => s.phaseGroupId).filter(Boolean)
        );
        if (playerPgIds.size === 0 && loadedPgIds.size === 0) return allPgs;
        // Show: phases the player is in, plus phases not yet loaded (unknown)
        return allPgs.filter(pg => playerPgIds.has(pg.id) || !loadedPgIds.has(pg.id));
    }, [allPgs, playerScheduleData, draftPlayer]);

    return (
        <Stack gap="xs">
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.5px' }}>
                Player Schedule
            </Text>
            <Autocomplete
                placeholder="Player name..."
                size="xs"
                value={draftPlayer}
                onChange={setDraftPlayer}
                onOptionSubmit={(val) => { setDraftPlayer(val); setActivePlayer(val); }}
                onBlur={() => setActivePlayer(draftPlayer)}
                onKeyDown={(e) => { if (e.key === 'Enter') setActivePlayer(draftPlayer); }}
                data={playerNames}
                limit={10}
                description="Shown in the schedule overlay"
            />

            {phasesLoaded && visiblePgs.length > 0 && (
                <>
                    <Text size="xs" c="dimmed">Phases to include:</Text>
                    <Stack gap={2}>
                        {visiblePgs.map(pg => {
                            const sel = checkedPgIds.has(pg.id) || checkedPgIds.has(String(pg.id));
                            const typeLabel = pg.bracketType === 'ROUND_ROBIN' ? 'Pool' : pg.bracketType === 'DOUBLE_ELIMINATION' ? 'DE' : 'SE';
                            return (
                                <UnstyledButton key={pg.id} onClick={() => togglePg(pg.id)} p="xs"
                                    style={(theme) => ({
                                        borderRadius: theme.radius.sm,
                                        backgroundColor: sel ? theme.colors.blue[0] : 'transparent',
                                        border: `1px solid ${sel ? theme.colors.blue[3] : theme.colors.gray[3]}`,
                                    })}
                                >
                                    <Group gap={6} wrap="nowrap">
                                        <Box style={{ width: 11, height: 11, borderRadius: 2, border: '1.5px solid var(--mantine-color-blue-6)', background: sel ? 'var(--mantine-color-blue-6)' : 'transparent', flexShrink: 0 }} />
                                        <Text size="xs" style={{ flex: 1, minWidth: 0 }} truncate>{pg.label}</Text>
                                        <Badge size="xs" variant="outline" color="gray">{typeLabel}</Badge>
                                    </Group>
                                </UnstyledButton>
                            );
                        })}
                    </Stack>
                    <Button size="compact-xs" variant="light" loading={loading} disabled={allPgs.length === 0} onClick={handleLoad}>
                        {loadedCount !== null ? `Reload All (${loadedCount} games)` : 'Load All Phases'}
                    </Button>
                </>
            )}

            {loadedCount !== null && (
                <Stack gap={2} mt={2}>
                    {variants.map(v => {
                        const isActive = selected?.url === v.url;
                        return (
                            <UnstyledButton key={v.key}
                                onClick={() => onSelect({ group: 'bracket', name: v.label, type: 'bracket', url: v.url, width: 440, height: 600 })}
                                p="xs"
                                style={(theme) => ({
                                    borderRadius: theme.radius.sm,
                                    backgroundColor: isActive ? theme.colors.blue[0] : 'transparent',
                                    border: isActive ? `1px solid ${theme.colors.blue[3]}` : '1px solid transparent',
                                })}
                            >
                                <Group justify="space-between" wrap="nowrap" gap={4}>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <Text size="sm">{v.label}</Text>
                                        <Text size="xs" c="dimmed">440 x 600</Text>
                                    </div>
                                    <CopyButton value={v.url}>
                                        {({ copied, copy }) => (
                                            <Tooltip label={copied ? 'Copied!' : 'Copy URL'}>
                                                <ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'} size="sm"
                                                    onClick={(e) => { e.stopPropagation(); copy(); }}>
                                                    {copied ? '✓' : '⎘'}
                                                </ActionIcon>
                                            </Tooltip>
                                        )}
                                    </CopyButton>
                                </Group>
                            </UnstyledButton>
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
    const { loading: sggLoading, setSource, fetchPhases, loadBracket } = useTournament();

    const [phases, setPhases] = useState([]);
    const [loadedPgId, setLoadedPgId] = useState(null);
    const [phasesLoaded, setPhasesLoaded] = useState(false);

    // Fetch phases when bracket_link exists
    useEffect(() => {
        if (bracketLink && !phasesLoaded) {
            setSource(bracketLink);
            fetchPhases().then(result => {
                if (result) {
                    setPhases(result);
                    setPhasesLoaded(true);
                }
            });
        }
    }, [bracketLink, phasesLoaded, fetchPhases]);

    // Reset if bracket_link changes
    useEffect(() => {
        setPhasesLoaded(false);
        setPhases([]);
        setLoadedPgId(null);
    }, [bracketLink]);

    if (!bracketLink) {
        return (
            <Text size="xs" c="dimmed" fs="italic">
                Load a tournament in the Bracket tab to see bracket layouts.
            </Text>
        );
    }

    if (!phasesLoaded) {
        return <Loader size="xs" />;
    }

    // Build phase groups from phases
    const phaseGroups = [];
    for (const phase of phases) {
        for (const pg of (phase.phaseGroups || [])) {
            const label = phases.length > 1 || (phase.phaseGroups?.length > 1)
                ? `${phase.name}${phase.phaseGroups.length > 1 ? ` - Pool ${pg.displayIdentifier}` : ''}`
                : phase.name;
            phaseGroups.push({
                id: pg.id,
                label,
                bracketType: pg.bracketType,
            });
        }
    }

    if (phaseGroups.length === 0) {
        return <Text size="xs" c="dimmed">No bracket phases found.</Text>;
    }

    const toggleGroup = (key) => {
        setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleSelect = async (pg, variant) => {
        // Build the item for the layout preview
        const url = `${baseUrl}${variant.path}`;
        const item = {
            group: 'bracket',
            name: `${pg.label} — ${variant.label}`,
            type: 'bracket',
            url,
            width: 1600,
            height: 900,
            _phaseGroupId: pg.id,
        };

        // Load bracket data into State if not already loaded for this phase group
        if (loadedPgId !== pg.id) {
            const result = await loadBracket(pg.id);
            if (result) {
                setLoadedPgId(pg.id);
            }
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
        <Stack gap={4}>
            {phaseGroups.map(pg => {
                const key = `bracket-${pg.id}`;
                const open = expandedGroups[key] || isGroupActive(pg.id);
                const variants = pg.bracketType === 'ROUND_ROBIN'
                    ? [BRACKET_VARIANTS[0]] // Round robin only has full view
                    : BRACKET_VARIANTS;

                return (
                    <div key={key}>
                        <UnstyledButton
                            onClick={() => toggleGroup(key)}
                            p="xs"
                            style={(theme) => ({
                                borderRadius: theme.radius.sm,
                                width: '100%',
                                backgroundColor: isGroupActive(pg.id)
                                    ? theme.colors.violet[0]
                                    : 'transparent',
                            })}
                        >
                            <Group justify="space-between" wrap="nowrap">
                                <Text size="sm" fw={600}>{pg.label}</Text>
                                <Group gap={4}>
                                    {loadedPgId === pg.id && (
                                        <Badge size="xs" variant="light" color="green">loaded</Badge>
                                    )}
                                    <Text size="xs" c="dimmed">
                                        {open ? '\u25B4' : '\u25BE'}
                                    </Text>
                                </Group>
                            </Group>
                        </UnstyledButton>
                        <Collapse in={open}>
                            <Stack gap={2} pl="sm">
                                {variants.map(variant => {
                                    const active = isVariantSelected(pg.id, variant.key);
                                    return (
                                        <UnstyledButton
                                            key={variant.key}
                                            onClick={() => handleSelect(pg, variant)}
                                            p="xs"
                                            style={(theme) => ({
                                                borderRadius: theme.radius.sm,
                                                backgroundColor: active
                                                    ? theme.colors.blue[0]
                                                    : 'transparent',
                                                border: active
                                                    ? `1px solid ${theme.colors.blue[3]}`
                                                    : '1px solid transparent',
                                            })}
                                        >
                                            <Group justify="space-between" wrap="nowrap" gap={4}>
                                                <div style={{ minWidth: 0, flex: 1 }}>
                                                    <Text size="sm">{variant.label}</Text>
                                                    <Text size="xs" c="dimmed">1600 x 900</Text>
                                                </div>
                                                <CopyButton value={`${baseUrl}${variant.path}`}>
                                                    {({ copied, copy }) => (
                                                        <Tooltip label={copied ? 'Copied!' : 'Copy URL'}>
                                                            <ActionIcon
                                                                variant="subtle"
                                                                color={copied ? 'teal' : 'gray'}
                                                                size="sm"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    copy();
                                                                }}
                                                            >
                                                                {copied ? '\u2713' : '\u2398'}
                                                            </ActionIcon>
                                                        </Tooltip>
                                                    )}
                                                </CopyButton>
                                            </Group>
                                        </UnstyledButton>
                                    );
                                })}
                            </Stack>
                        </Collapse>
                    </div>
                );
            })}

            {/* Player Schedule */}
            <div style={{ borderTop: '1px solid var(--mantine-color-gray-3)', paddingTop: 8, marginTop: 4 }}>
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
    const [logoInfo, setLogoInfo] = useState(null); // { exists, url }
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
            {description && <Text size="xs" c="dimmed" mb={4}>{description}</Text>}
            <Group gap="sm" align="center">
                {logoInfo?.exists && logoInfo.url && (
                    <Image
                        src={logoInfo.url + '?t=' + Date.now()}
                        alt="Tournament logo"
                        w={48}
                        h={48}
                        fit="contain"
                        radius="sm"
                        style={{ border: '1px solid var(--mantine-color-gray-3)' }}
                    />
                )}
                <FileButton onChange={handleUpload} accept="image/png,image/jpeg,image/svg+xml,image/webp">
                    {(props) => (
                        <Button
                            {...props}
                            variant="light"
                            size="compact-xs"
                            loading={uploading}
                        >
                            {logoInfo?.exists ? 'Replace' : 'Upload'}
                        </Button>
                    )}
                </FileButton>
                {logoInfo?.exists && (
                    <Button
                        variant="subtle"
                        size="compact-xs"
                        color="red"
                        onClick={handleRemove}
                    >
                        Remove
                    </Button>
                )}
            </Group>
        </div>
    );
}

const FONT_OPTIONS = [
    { value: 'Inter', label: 'Inter' },
    { value: 'Roboto', label: 'Roboto' },
    { value: 'Open Sans', label: 'Open Sans' },
    { value: 'Montserrat', label: 'Montserrat' },
    { value: 'Poppins', label: 'Poppins' },
    { value: 'Lato', label: 'Lato' },
    { value: 'Oswald', label: 'Oswald' },
    { value: 'Rajdhani', label: 'Rajdhani' },
    { value: 'Bebas Neue', label: 'Bebas Neue' },
    { value: 'Lalezar', label: 'Lalezar' },
];

const GLOBAL_DESIGN_KEYS = [
    'accentColor', 'cardBg', 'textColor', 'borderRadius', 'borderColor', 'borderWidth', 'fontFamily',
    'showShadow', 'cardShadowBlur', 'cardShadowColor',
    'textShadowEnabled', 'textShadowBlur', 'textShadowColor',
];

const GLOBAL_DESIGN_DEFAULTS = {
    accentColor:       '#f59e0b',
    cardBg:            'rgba(15, 15, 25, 0.88)',
    textColor:         '#ffffff',
    borderRadius:      16,
    borderColor:       'rgba(255, 255, 255, 0.08)',
    borderWidth:       1,
    fontFamily:        'Inter',
    showShadow:        true,
    cardShadowBlur:    16,
    cardShadowColor:   'rgba(0, 0, 0, 0.5)',
    textShadowEnabled: false,
    textShadowBlur:    4,
    textShadowColor:   'rgba(0, 0, 0, 0.8)',
};

// Parse "rgba(r, g, b, a)" or "rgb(r, g, b)" into { hex, opacity }
function parseRgba(val) {
    const m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (m) {
        const hex = '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
        return { hex, opacity: m[4] != null ? parseFloat(m[4]) : 1 };
    }
    // Fallback: treat as hex
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

    // Sync when external value changes (preset load, etc.)
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
        <div>
            {label && <Text size="sm" fw={500}>{label}</Text>}
            {description && <Text size="xs" c="dimmed" mb={4}>{description}</Text>}
            <Group gap="xs" align="flex-end" wrap="nowrap">
                <ColorInput
                    size="sm"
                    value={localHex}
                    onChange={(color) => { setLocalHex(color); scheduleChange(color, localOpacity); }}
                    format="hex"
                    swatches={COLOR_SWATCHES}
                    style={{ flex: 1 }}
                />
                <NumberInput
                    size="sm"
                    value={Math.round(localOpacity * 100)}
                    onChange={(val) => { const o = (val ?? 100) / 100; setLocalOpacity(o); scheduleChange(localHex, o); }}
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                    w={80}
                />
            </Group>
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
        const preset = { global, layouts: allLayoutSettings };
        setItem(`overlays.presets.${name}`, preset);
        setPresetName('');
        setSavingPreset(false);
        notifications.show({ message: `Saved preset "${name}"`, color: 'green' });
    }, [presetName, globalDesign, allLayoutSettings, setItem]);

    const handleLoadPreset = useCallback((name) => {
        const preset = presets[name];
        if (!preset) return;
        const globalData = preset.global ?? preset;
        for (const key of GLOBAL_DESIGN_KEYS) {
            if (globalData[key] != null) setItem(`overlays.global.${key}`, globalData[key]);
        }
        if (preset.layouts) {
            for (const [layoutType, layoutValues] of Object.entries(preset.layouts)) {
                if (!LAYOUT_SETTINGS[layoutType]) continue;
                for (const [key, value] of Object.entries(layoutValues)) {
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
        for (const [layoutType, defs] of Object.entries(LAYOUT_SETTINGS)) {
            for (const def of defs) {
                if (def.type !== 'switch') {
                    setItem(`overlays.${layoutType}.${def.key}`, null);
                }
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
                setItem(`overlays.presets.${name}`, { global, layouts });
                notifications.show({ message: `Imported preset "${name}"`, color: 'green' });
            } catch {
                notifications.show({ message: 'Invalid preset file', color: 'red' });
            }
        };
        reader.readAsText(file);
    }, [setItem]);

    const presetNames = Object.keys(presets).filter(k => presets[k] != null);

    return (
        <Stack gap="md" maw={500}>
            <LogoUpload
                label="Overlay Logo"
                description="Upload a logo to display on overlays (channel logo, league logo, etc.)"
            />

            <div>
                <Text size="sm" fw={500} mb={4}>Presets</Text>
                <Text size="xs" c="dimmed" mb="xs">Save and load full design configurations including global settings and per-layout overrides.</Text>
                <Stack gap="xs">
                    {presetNames.map(name => (
                        <Group key={name} gap="xs" justify="space-between" wrap="nowrap">
                            <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                                {name}
                            </Text>
                            <Group gap={4} wrap="nowrap">
                                <Button variant="light" size="compact-xs" onClick={() => handleLoadPreset(name)}>
                                    Load
                                </Button>
                                <Button variant="subtle" size="compact-xs" color="gray" onClick={() => handleExportPreset(name)}>
                                    Export
                                </Button>
                                <Button variant="subtle" size="compact-xs" color="red" onClick={() => handleDeletePreset(name)}>
                                    Delete
                                </Button>
                            </Group>
                        </Group>
                    ))}

                    {savingPreset ? (
                        <Group gap="xs" wrap="nowrap">
                            <TextInput
                                size="xs"
                                placeholder="Preset name"
                                value={presetName}
                                onChange={(e) => setPresetName(e.currentTarget.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(); }}
                                style={{ flex: 1 }}
                                autoFocus
                            />
                            <Button size="compact-xs" onClick={handleSavePreset} disabled={!presetName.trim()}>
                                Save
                            </Button>
                            <Button size="compact-xs" variant="subtle" color="gray" onClick={() => { setSavingPreset(false); setPresetName(''); }}>
                                Cancel
                            </Button>
                        </Group>
                    ) : (
                        <Group gap="xs" wrap="nowrap">
                            <Button variant="light" size="compact-xs" onClick={() => setSavingPreset(true)}>
                                Save current as preset
                            </Button>
                            <FileButton onChange={handleImportPreset} accept=".json">
                                {(props) => (
                                    <Button {...props} variant="light" size="compact-xs" color="gray">
                                        Import preset
                                    </Button>
                                )}
                            </FileButton>
                        </Group>
                    )}
                </Stack>
            </div>

            <Group gap="xs">
                <Button variant="light" size="compact-sm" color="gray" onClick={resetGlobalDesign}>
                    Reset global design
                </Button>
                <Button variant="light" size="compact-sm" color="gray" onClick={resetOverrides}>
                    Reset all overrides
                </Button>
            </Group>
        </Stack>
    );
}

// ── Global Design Section (rendered inline on layout tabs) ──
// supportedSettings: array of keys from the overlay's <meta name="overlay-settings">.
// When provided, only matching controls are shown. When null/undefined, all are shown.
function GlobalDesignSection({ supportedSettings }) {
    const globalDesign = useSettingsStore(useShallow(s => s?.overlays?.global ?? {}));
    const setItem = useSettingsStore(s => s.setItem);

    const has = useCallback((key) =>
        !supportedSettings || supportedSettings.includes(key),
    [supportedSettings]);

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

    return (
        <Stack gap="xs">
            {has('accentColor') && (
                <DebouncedColorInput
                    label="Accent Color"
                    description="Primary highlight color across all overlays"
                    size="sm"
                    value={accentColor}
                    onChange={(color) => setItem('overlays.global.accentColor', color)}
                    format="hex"
                    swatches={COLOR_SWATCHES}
                />
            )}

            {has('cardBg') && (
                <ColorWithOpacity
                    label="Card Background"
                    description="Background color for overlay cards"
                    value={cardBg}
                    onChange={(val) => setItem('overlays.global.cardBg', val)}
                />
            )}

            {has('textColor') && (
                <DebouncedColorInput
                    label="Text Color"
                    description="Primary text color on overlays"
                    size="sm"
                    value={textColor}
                    onChange={(color) => setItem('overlays.global.textColor', color)}
                    format="hex"
                    swatches={['#ffffff', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#1e293b', '#0f172a']}
                />
            )}

            {has('borderRadius') && (
                <NumberInput
                    label="Border Radius"
                    description="Corner rounding for overlay cards (px)"
                    size="sm"
                    value={borderRadius}
                    onChange={(val) => setItem('overlays.global.borderRadius', val)}
                    min={0}
                    max={48}
                    step={2}
                />
            )}

            {has('borderWidth') && (
                <NumberInput
                    label="Border Thickness"
                    description="Border width for overlay cards (px)"
                    size="sm"
                    value={borderWidth}
                    onChange={(val) => setItem('overlays.global.borderWidth', val)}
                    min={0}
                    max={16}
                    step={1}
                />
            )}

            {has('borderColor') && (
                <ColorWithOpacity
                    label="Border Color"
                    description="Border color for overlay cards"
                    value={borderColor}
                    onChange={(val) => setItem('overlays.global.borderColor', val)}
                />
            )}

            {has('fontFamily') && (
                <Select
                    label="Font Family"
                    description="Font used across all overlays"
                    size="sm"
                    value={fontFamily}
                    onChange={(val) => setItem('overlays.global.fontFamily', val)}
                    data={FONT_OPTIONS}
                    searchable
                />
            )}

            {has('cardShadow') && (
                <div>
                    <Switch
                        label="Card Shadow"
                        description="Show drop shadow behind overlay cards"
                        size="sm"
                        checked={showShadow}
                        onChange={(e) => setItem('overlays.global.showShadow', e.currentTarget.checked)}
                    />
                    <Collapse in={showShadow}>
                        <Stack gap="xs" mt="xs" pl="sm">
                            <NumberInput
                                label="Shadow Blur"
                                description="Blur radius of the card drop shadow (px)"
                                size="sm"
                                value={cardShadowBlur}
                                onChange={(val) => setItem('overlays.global.cardShadowBlur', val ?? 16)}
                                min={0}
                                max={80}
                                step={2}
                                suffix="px"
                            />
                            <ColorWithOpacity
                                label="Shadow Color"
                                value={cardShadowColor}
                                onChange={(val) => setItem('overlays.global.cardShadowColor', val)}
                            />
                        </Stack>
                    </Collapse>
                </div>
            )}

            {has('textShadow') && (
                <div>
                    <Switch
                        label="Text Shadow"
                        description="Show drop shadow on text across overlays"
                        size="sm"
                        checked={textShadowEnabled}
                        onChange={(e) => setItem('overlays.global.textShadowEnabled', e.currentTarget.checked)}
                    />
                    <Collapse in={textShadowEnabled}>
                        <Stack gap="xs" mt="xs" pl="sm">
                            <NumberInput
                                label="Blur"
                                size="sm"
                                value={textShadowBlur}
                                onChange={(val) => setItem('overlays.global.textShadowBlur', val ?? 4)}
                                min={0}
                                max={40}
                                step={1}
                                suffix="px"
                            />
                            <ColorWithOpacity
                                label="Shadow Color"
                                value={textShadowColor}
                                onChange={(val) => setItem('overlays.global.textShadowColor', val)}
                            />
                        </Stack>
                    </Collapse>
                </div>
            )}
        </Stack>
    );
}

// ── Debounced color input — updates local display immediately, saves after 1s idle ──
function DebouncedColorInput({ value, onChange, ...props }) {
    const [local, setLocal] = useState(value ?? '');
    const timerRef = useRef(null);

    // Sync external value changes (e.g. preset load) into local state
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

    // Flush on unmount so nothing is lost
    useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current);
    }, []);

    return <ColorInput {...props} value={local} onChange={handleChange} />;
}

// ── Per-layout settings panel ──
// supportedSettings: when provided, only show settings whose key is in the list.
function LayoutSettingsPanel({ layoutType, supportedSettings }) {
    const allDefs = LAYOUT_SETTINGS[layoutType];
    const settingsDefs = supportedSettings
        ? allDefs?.filter(def => supportedSettings.includes(def.key))
        : allDefs;
    const overlaySettings = useSettingsStore(useShallow(s => s?.overlays?.[layoutType]));
    const globalSettings = useSettingsStore(useShallow(s => s?.overlays?.global ?? {}));
    const setItem = useSettingsStore(s => s.setItem);

    if (!settingsDefs || settingsDefs.length === 0) return null;

    return (
        <Stack gap="xs">
            {settingsDefs.map((def) => {
                const settingsKey = `overlays.${layoutType}.${def.key}`;

                if (def.type === 'switch') {
                    const checked = overlaySettings?.[def.key] !== false;
                    return (
                        <Switch
                            key={def.key}
                            label={def.label}
                            description={def.description}
                            size="sm"
                            checked={checked}
                            onChange={(e) => setItem(settingsKey, e.currentTarget.checked)}
                        />
                    );
                }

                if (def.type === 'color-override') {
                    const overrideValue = overlaySettings?.[def.key] ?? null;
                    return (
                        <div key={def.key}>
                            <Text size="sm" fw={500}>{def.label}</Text>
                            {def.description && <Text size="xs" c="dimmed" mb={4}>{def.description}</Text>}
                            <Group gap="xs" align="flex-end" wrap="nowrap">
                                <DebouncedColorInput
                                    size="sm"
                                    value={overrideValue ?? ''}
                                    placeholder="Default (not overridden)"
                                    onChange={(color) => setItem(settingsKey, color || null)}
                                    format="hex"
                                    swatches={COLOR_SWATCHES}
                                    style={{ flex: 1 }}
                                />
                                {overrideValue != null && (
                                    <Button
                                        variant="subtle"
                                        size="compact-sm"
                                        color="gray"
                                        onClick={() => setItem(settingsKey, null)}
                                    >
                                        Reset
                                    </Button>
                                )}
                            </Group>
                        </div>
                    );
                }

                if (def.type === 'color-opacity-override') {
                    const overrideValue = overlaySettings?.[def.key] ?? null;
                    const globalVal = globalSettings[def.globalKey] ?? def.globalFallback;
                    const isOverridden = overrideValue != null;
                    return (
                        <div key={def.key}>
                            <Group gap="xs" justify="space-between" align="center" mb={2}>
                                <div>
                                    <Text size="sm" fw={500}>{def.label}</Text>
                                    <Text size="xs" c="dimmed">{isOverridden ? def.description : `${def.description} — using global`}</Text>
                                </div>
                                {isOverridden && (
                                    <Button variant="subtle" size="compact-xs" color="gray"
                                        onClick={() => setItem(settingsKey, null)}>
                                        Reset
                                    </Button>
                                )}
                            </Group>
                            <ColorWithOpacity
                                value={isOverridden ? overrideValue : globalVal}
                                onChange={(val) => setItem(settingsKey, val)}
                            />
                        </div>
                    );
                }

                if (def.type === 'number-override') {
                    const overrideValue = overlaySettings?.[def.key] ?? null;
                    const globalVal = globalSettings[def.globalKey] ?? def.globalFallback;
                    const isOverridden = overrideValue != null;
                    return (
                        <div key={def.key}>
                            <Group gap="xs" align="flex-end" wrap="nowrap">
                                <NumberInput
                                    label={def.label}
                                    description={isOverridden ? def.description : `${def.description} — using global (${globalVal})`}
                                    size="sm"
                                    value={isOverridden ? overrideValue : globalVal}
                                    onChange={(val) => setItem(settingsKey, val ?? null)}
                                    min={def.min}
                                    max={def.max}
                                    step={def.step}
                                    suffix={def.suffix}
                                    style={{ flex: 1 }}
                                />
                                {isOverridden && (
                                    <Button variant="subtle" size="compact-sm" color="gray"
                                        onClick={() => setItem(settingsKey, null)}
                                        style={{ marginBottom: 2 }}>
                                        Reset
                                    </Button>
                                )}
                            </Group>
                        </div>
                    );
                }

                return null;
            })}
        </Stack>
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

    // Poll status while running
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
                            <Group gap="xs">
                                <Button size="xs" onClick={async () => {
                                    notifications.hide(notifId);
                                    await fetch(`/api/v1/controller/port?port=${suggested}`, { method: 'PUT' });
                                    // Re-invoke start
                                    const r2 = await fetch('/api/v1/controller/start', { method: 'POST' });
                                    const d2 = await r2.json();
                                    if (d2.success) {
                                        notifications.show({ message: `Started on port ${suggested}`, color: 'green' });
                                        await fetchStatus();
                                    } else {
                                        notifications.show({ message: d2.error || 'Failed to start', color: 'red' });
                                    }
                                }}>Use port {suggested}</Button>
                            </Group>
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

    if (!status) return <Loader size="xs" />;

    if (!status.available) {
        return (
            <Stack gap="xs">
                <Text size="sm" c="dimmed">
                    Controller overlay (gc-overlay) not found.
                </Text>
                <Text size="xs" c="dimmed">
                    Place the gc-overlay repository next to this project, or set the path in Settings.
                </Text>
            </Stack>
        );
    }

    return (
        <Stack gap="sm">
            <Group justify="space-between">
                <Group gap="xs">
                    <Box
                        style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: status.running ? '#22c55e' : '#6b7280',
                        }}
                    />
                    <Text size="sm" fw={600}>
                        {status.running ? 'Running' : 'Stopped'}
                    </Text>
                </Group>
                <Button
                    size="compact-xs"
                    variant={status.running ? 'light' : 'filled'}
                    color={status.running ? 'red' : 'green'}
                    onClick={status.running ? handleStop : handleStart}
                    loading={loading}
                >
                    {status.running ? 'Stop' : 'Start'}
                </Button>
            </Group>

            {status.running && (
                <Text size="xs" c="dimmed">OBS Browser Source: 512 x 256</Text>
            )}

            {/* Port entries */}
            <Stack gap={4}>
                {[1, 2, 3, 4].map(portNum => {
                    const isActive = selected?._controllerPort === portNum;
                    const portUrl = `http://localhost:${status.port}/?port=${portNum}&bg=transparent`;
                    return (
                        <UnstyledButton
                            key={portNum}
                            onClick={() => handleSelectPort(portNum)}
                            p="xs"
                            style={(theme) => ({
                                borderRadius: theme.radius.sm,
                                backgroundColor: isActive ? theme.colors.blue[0] : 'transparent',
                                border: isActive
                                    ? `1px solid ${theme.colors.blue[3]}`
                                    : '1px solid transparent',
                                opacity: status.running ? 1 : 0.5,
                            })}
                            disabled={!status.running}
                        >
                            <Group justify="space-between" wrap="nowrap" gap={4}>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <Text size="sm">Player {portNum}</Text>
                                </div>
                                {status.running && (
                                    <CopyButton value={portUrl}>
                                        {({ copied, copy }) => (
                                            <Tooltip label={copied ? 'Copied!' : 'Copy OBS URL'}>
                                                <ActionIcon
                                                    variant="subtle"
                                                    color={copied ? 'teal' : 'gray'}
                                                    onClick={(e) => { e.stopPropagation(); copy(); }}
                                                >
                                                    {copied ? '\u2713' : '\u2398'}
                                                </ActionIcon>
                                            </Tooltip>
                                        )}
                                    </CopyButton>
                                )}
                            </Group>
                        </UnstyledButton>
                    );
                })}
            </Stack>

            {!status.running && (
                <Text size="xs" c="dimmed" fs="italic">
                    Start the overlay to preview and copy OBS URLs.
                </Text>
            )}
        </Stack>
    );
}

export default function LayoutBrowser() {
    const active = useSettingsStore(s => s?.scoreboards?.active ?? [1]);
    const sources = useSettingsStore(s => s?.scoreboards?.sources ?? {});
    const aliases = useSettingsStore(s => s?.scoreboards?.aliases ?? {});

    const [allLayouts, setAllLayouts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selected, setSelected] = useState(null);
    const [activeScoreboardTab, setActiveScoreboardTab] = useState(String(active[0] ?? 1));
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [previewRevision, setPreviewRevision] = useState(0);

    // Top-level mode: 'scoreboard', 'scenes', 'bracket', 'controller', or 'design'
    const [mode, setMode] = useState('scoreboard');

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

    // Filter layouts — show all scoreboard layouts for every tab (files live in
    // scoreboard1/ but work for any scoreboard via URL params). Apply search.
    const filteredLayouts = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return allLayouts.filter(l => {
            // Bracket layouts are handled by BracketLayoutList
            if (l.group === 'bracket') return false;
            if (!l.group.startsWith('scoreboard')) return false;
            if (q && !l.name.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [allLayouts, searchQuery]);

    // Scene layouts (full 1920×1080 compositions)
    const sceneLayouts = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return allLayouts.filter(l => {
            if (l.group !== 'scenes') return false;
            if (q && !l.name.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [allLayouts, searchQuery]);

    // Auto-select first layout when mode/layouts change
    useEffect(() => {
        const activeLayouts = mode === 'scenes' ? sceneLayouts : filteredLayouts;
        if (mode !== 'scoreboard' && mode !== 'scenes') return;
        if (activeLayouts.length > 0) {
            setSelected(prev => {
                if (prev && activeLayouts.some(l => l.url === prev.url)) return prev;
                return activeLayouts[0];
            });
        } else {
            setSelected(null);
        }
    }, [filteredLayouts, sceneLayouts, mode]);

    // Clear search and selection on mode switch
    useEffect(() => {
        setSearchQuery('');
        setSelected(null);
        setSettingsOpen(false);
        setPreviewRevision(0);
    }, [mode]);

    // Clear search on scoreboard tab switch
    useEffect(() => {
        setSearchQuery('');
    }, [activeScoreboardTab]);

    // Close settings panel when layout selection changes
    useEffect(() => {
        setSettingsOpen(false);
    }, [selected?.url]);

    const selectedType = selected?.type;
    // supportedSettings from the HTML overlay's <meta name="overlay-settings">.
    // Items constructed by BracketLayoutList/ControllerOverlayPanel won't have it,
    // so fall back to the first matching layout from allLayouts by type.
    const supportedSettings = useMemo(() => {
        if (selected?.supportedSettings) return selected.supportedSettings;
        if (!selectedType) return null;
        const match = allLayouts.find(l => l.type === selectedType && l.supportedSettings);
        return match?.supportedSettings ?? null;
    }, [selected?.supportedSettings, selectedType, allLayouts]);
    const hasAnySupportedSettings = supportedSettings === null || supportedSettings.length > 0;
    const hasLayoutSettings = selectedType && supportedSettings
        ? LAYOUT_SETTINGS[selectedType]?.some(def => supportedSettings.includes(def.key))
        : selectedType && LAYOUT_SETTINGS[selectedType]?.length > 0;
    const showGlobalDesign = hasAnySupportedSettings && mode !== 'design';
    const showSettingsPanel = showGlobalDesign || hasLayoutSettings;

    // Build the URL — inject scoreboard param for scoreboard-type layouts only
    const selectedUrl = useMemo(() => {
        if (!selected?.url) return null;
        try {
            const u = new URL(selected.url);
            if (mode === 'scoreboard') {
                u.searchParams.set('scoreboard', activeScoreboardTab);
            }
            // scenes and other modes use the URL as-is
            return u.toString();
        } catch {
            return selected.url;
        }
    }, [selected?.url, activeScoreboardTab, mode]);

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
            <Tabs value={mode} onChange={setMode} variant="pills">
                <Tabs.List>
                    <Tabs.Tab value="design">Design Presets</Tabs.Tab>
                    <Tabs.Tab value="scoreboard">Scoreboards</Tabs.Tab>
                    <Tabs.Tab value="scenes">Scenes</Tabs.Tab>
                    <Tabs.Tab value="bracket">Bracket</Tabs.Tab>
                    {/* Controller overlay hidden until Project Rio adds needed support. Code preserved. */}
                    {/* <Tabs.Tab value="controller">Controller</Tabs.Tab> */}
                </Tabs.List>
            </Tabs>

            {/* Scoreboard sub-tabs (only in scoreboard mode) */}
            {mode === 'scoreboard' && (
                <Tabs value={activeScoreboardTab} onChange={setActiveScoreboardTab} variant="outline">
                    <Tabs.List>
                        {active.map(sbId => {
                            const src = sources[sbId] ?? sources[String(sbId)];
                            const srcType = src?.type ?? 'manual';
                            const alias = aliases[sbId] ?? aliases[String(sbId)] ?? '';
                            const label = alias || `Scoreboard ${sbId}`;
                            return (
                                <Tabs.Tab key={sbId} value={String(sbId)} rightSection={
                                    <Badge size="xs" variant="light" color={SOURCE_COLORS[srcType]}>
                                        {srcType}
                                    </Badge>
                                }>
                                    {label}
                                </Tabs.Tab>
                            );
                        })}
                    </Tabs.List>
                </Tabs>
            )}

            {mode === 'design' ? (
                <PresetsPanel />
            ) : (
                <Grid gutter="md">
                    {/* Left panel: layout list */}
                    <Grid.Col span={4}>
                        <Stack gap="xs">
                            <Text size="xs" c="dimmed">
                                Select a layout to preview. Copy the URL into an OBS Browser Source.
                            </Text>

                            {mode === 'scoreboard' && (
                                <>
                                    <TextInput
                                        placeholder="Search layouts..."
                                        size="xs"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.currentTarget.value)}
                                    />

                                    {loading && <Loader size="sm" />}
                                    {error && <Alert color="red" title="Error">{error}</Alert>}

                                    <LayoutList
                                        layouts={filteredLayouts}
                                        selected={selected}
                                        onSelect={setSelected}
                                        activeTab={activeScoreboardTab}
                                    />
                                </>
                            )}

                            {mode === 'scenes' && (
                                <>
                                    <TextInput
                                        placeholder="Search scenes..."
                                        size="xs"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.currentTarget.value)}
                                    />
                                    {loading && <Loader size="sm" />}
                                    {error && <Alert color="red" title="Error">{error}</Alert>}
                                    {sceneLayouts.length === 0 && !loading && (
                                        <Text size="sm" c="dimmed">No scene layouts found.</Text>
                                    )}
                                    <Stack gap={4}>
                                        {sceneLayouts.map(item => (
                                            <LayoutItem
                                                key={item.url}
                                                item={item}
                                                selected={selected}
                                                onSelect={setSelected}
                                                activeTab={activeScoreboardTab}
                                            />
                                        ))}
                                    </Stack>
                                </>
                            )}

                            {mode === 'bracket' && (
                                <BracketLayoutList
                                    selected={selected}
                                    onSelect={setSelected}
                                    baseUrl={baseUrl}
                                />
                            )}

                            {mode === 'controller' && (
                                <ControllerOverlayPanel
                                    selected={selected}
                                    onSelect={setSelected}
                                />
                            )}
                        </Stack>
                    </Grid.Col>

                    {/* Right panel: iframe preview + settings */}
                    <Grid.Col span={8}>
                        <Paper withBorder style={{ overflow: 'hidden' }}>
                            {selected && selectedUrl ? (
                                <>
                                    <Group p="xs" justify="space-between" wrap="nowrap" gap={4} style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
                                        <Text size="xs" c="dimmed" truncate style={{ flex: 1, minWidth: 0 }}>{selectedUrl}</Text>
                                        <Group gap={4} wrap="nowrap">
                                            <Tooltip label="Reload preview">
                                                <ActionIcon
                                                    variant="subtle"
                                                    color="gray"
                                                    size="sm"
                                                    onClick={() => setPreviewRevision(r => r + 1)}
                                                >
                                                    {'\u21BB'}
                                                </ActionIcon>
                                            </Tooltip>
                                            {showSettingsPanel && (
                                                <Tooltip label={settingsOpen ? 'Close settings' : 'Layout settings'}>
                                                    <ActionIcon
                                                        variant={settingsOpen ? 'filled' : 'subtle'}
                                                        color={settingsOpen ? 'blue' : 'gray'}
                                                        size="sm"
                                                        onClick={() => setSettingsOpen(o => !o)}
                                                    >
                                                        {'\u2699'}
                                                    </ActionIcon>
                                                </Tooltip>
                                            )}
                                            <CopyButton value={selectedUrl}>
                                                {({ copied, copy }) => (
                                                    <Tooltip label={copied ? 'Copied!' : 'Copy URL'}>
                                                        <Button variant="subtle" size="compact-xs" color={copied ? 'teal' : 'gray'} onClick={copy}>
                                                            {copied ? 'Copied' : 'Copy'}
                                                        </Button>
                                                    </Tooltip>
                                                )}
                                            </CopyButton>
                                        </Group>
                                    </Group>
                                    <ScaledIframe key={`${selectedUrl}-${previewRevision}`} src={selectedUrl} fallbackWidth={selected?.width} fallbackHeight={selected?.height} />
                                </>
                            ) : (
                                <Box
                                    style={{
                                        height: PREVIEW_HEIGHT,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <Text c="dimmed">
                                        {mode === 'bracket'
                                            ? 'Select a bracket phase to preview'
                                            : mode === 'controller'
                                            ? 'Start the controller overlay to preview'
                                            : 'Select a layout to preview'}
                                    </Text>
                                </Box>
                            )}
                        </Paper>

                        {/* Settings panel: global design + per-layout overrides */}
                        {showSettingsPanel && (
                            <Collapse in={settingsOpen}>
                                <Paper withBorder p="sm" mt="xs">
                                    {showGlobalDesign && (
                                        <>
                                            <Text size="sm" fw={600} mb="xs">Global Design</Text>
                                            <GlobalDesignSection supportedSettings={supportedSettings} />
                                        </>
                                    )}
                                    {showGlobalDesign && hasLayoutSettings && (
                                        <Divider my="sm" label="Layout Overrides" labelPosition="center" />
                                    )}
                                    {hasLayoutSettings && (
                                        <>
                                            <Text size="sm" fw={600} mb="xs" tt="capitalize">
                                                {selectedType} Settings
                                            </Text>
                                            <LayoutSettingsPanel layoutType={selectedType} supportedSettings={supportedSettings} />
                                        </>
                                    )}
                                </Paper>
                            </Collapse>
                        )}
                    </Grid.Col>
                </Grid>
            )}
        </Stack>
    );
}
