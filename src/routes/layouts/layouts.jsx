import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    Stack, Paper, Text, Group, Grid, SimpleGrid, UnstyledButton,
    CopyButton, ActionIcon, Button, Tooltip, Box, Loader, Alert, Tabs, Badge, Switch,
    Collapse, ColorInput, FileButton, Image, Input, TextInput, Autocomplete, Select, NumberInput, Divider,
    Menu,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useShallow } from 'zustand/react/shallow';
import useTournament from '../../hooks/useTournament';

const PREVIEW_HEIGHT = 500;

// ── Per-layout-type element-only settings ──
// These are settings unique to a specific overlay (not shared across the
// design system). Global design properties (accent, cardBg, shadow, etc.) live
// in overlays.global and are NOT duplicated here — users can pin a per-layout
// override for any of those via the "+ Add style override" UI below the panel.
// Supported control types: 'switch', 'color-override', 'number-override', 'select'
const LAYOUT_SETTINGS = {
    scoreboard: [
        { key: 'showElo', type: 'switch', label: 'Show ELO', description: 'Display ELO ratings on completed games' },
        { key: 'showTeamLogos', type: 'switch', label: 'Show Team Logos', description: 'Display MSB team logos' },
    ],
    roster: [
        { key: 'showSuperstars', type: 'switch', label: 'Show Superstar Icons', description: 'Display superstar badge on starred characters' },
        { key: 'showRoleIcon', type: 'switch', label: 'Show Batting/Fielding Icon', description: 'Display the bat or glove icon indicating the team role' },
        { key: 'showTeamLogo', type: 'switch', label: 'Show Team Logo', description: 'Display the team logo next to the roster' },
    ],
    stats: [
        { key: 'transitionType', type: 'select', label: 'Batter Transition', description: 'Animation when switching to a new batter', options: [{ value: 'fade', label: 'Fade' }, { value: 'none', label: 'None' }], defaultValue: 'fade' },
        { key: 'statValueColor', type: 'color-override', label: 'Stat Value Color', description: 'Color of the main stat numbers (e.g. AVG, ERA)' },
        { key: 'subtextColor',   type: 'color-override', label: 'Subtext Color',    description: 'Color of stat labels and the game line text' },
    ],
    teamlogo: [],
    scene: [
        { key: 'team1ShowYouTube', type: 'switch', label: 'Player 1: Show YouTube', description: 'When on, shows the YouTube handle. When off, shows the Twitter/X handle.' },
        { key: 'team2ShowYouTube', type: 'switch', label: 'Player 2: Show YouTube', description: 'When on, shows the YouTube handle. When off, shows the Twitter/X handle.' },
    ],
    bracket: [
        { key: 'connectorColor', type: 'color-override', label: 'Connector Line Color', description: 'Color of bracket connector lines' },
        { key: 'activeColor', type: 'color-override', label: 'Active Match Color', description: 'Highlight color for active/in-progress matches' },
        { key: 'maxScale', type: 'number-override', label: 'Max Upscale', description: '1.0 = never enlarge past designed pixel sizes (small brackets stay native, centered). 1.5+ lets small brackets grow to fill the OBS source.', defaultValue: 1.0, min: 0.5, max: 3.0, step: 0.1 },
    ],
    ticker: [
        { key: 'tickerSpeed', type: 'number-override', label: 'Scroll Speed', description: 'Horizontal scroll rate of the ticker (pixels per second)', defaultValue: 60, min: 10, max: 300, step: 10, suffix: 'px/s' },
        { key: 'tickerGap', type: 'number-override', label: 'Card Spacing', description: 'Space between game cards (px)', defaultValue: 16, min: 0, max: 80, step: 2, suffix: 'px' },
    ],
};

// ── Global design keys eligible for per-layout override ──
// Each entry corresponds to a key in overlays.global.* that the user can pin
// a per-layout override on via the "+ Add style override" picker. The `meta`
// field links to the synthetic name(s) used in each overlay's
// <meta name="overlay-settings"> whitelist; an override is offered for a
// layout only if at least one of the meta names appears in that whitelist.
const OVERRIDABLE_GLOBAL_KEYS = [
    { key: 'accentColor',    meta: ['accentColor'],    type: 'color',         label: 'Accent Color',       defaultValue: '#f59e0b' },
    { key: 'textColor',      meta: ['textColor'],      type: 'color',         label: 'Text Color',         defaultValue: '#ffffff' },
    { key: 'cardBg',         meta: ['cardBg'],         type: 'color-opacity', label: 'Card Background',    defaultValue: 'rgba(15, 15, 25, 0.88)' },
    { key: 'borderColor',    meta: ['borderColor'],    type: 'color-opacity', label: 'Border Color',       defaultValue: 'rgba(255, 255, 255, 0.08)' },
    { key: 'borderRadius',   meta: ['borderRadius'],   type: 'number',        label: 'Border Radius',      defaultValue: 16, min: 0, max: 48, step: 2, suffix: 'px' },
    { key: 'borderWidth',    meta: ['borderWidth'],    type: 'number',        label: 'Border Thickness',   defaultValue: 1,  min: 0, max: 16, step: 1, suffix: 'px' },
    { key: 'cardShadowBlur', meta: ['cardShadow'],     type: 'number',        label: 'Card Shadow Blur',   defaultValue: 16, min: 0, max: 80, step: 2, suffix: 'px' },
    { key: 'textShadowBlur', meta: ['textShadow'],     type: 'number',        label: 'Text Shadow Blur',   defaultValue: 4,  min: 0, max: 40, step: 1, suffix: 'px' },
    { key: 'showCaptains',     meta: ['showCaptains'],     type: 'switch', label: 'Show Captains' },
    { key: 'showLogo',         meta: ['showLogo'],         type: 'switch', label: 'Show Overlay Logo' },
    { key: 'showBackdropBlur', meta: ['showBackdropBlur'], type: 'switch', label: 'Backdrop Blur' },
    { key: 'showShadow',       meta: ['showShadow'],       type: 'switch', label: 'Card Shadow' },
    { key: 'finalBadgeColor',  meta: ['finalBadgeColor'],  type: 'color',  label: 'Final Badge Color' },
];

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
                    // cross-origin: contentDocument is null
                    if (fallbackWidth && fallbackHeight) {
                        setNativeSize({ w: fallbackWidth, h: fallbackHeight });
                    }
                    return;
                }
                // Overlay HTML files don't set an html-element background,
                // so Chromium paints the iframe's default white canvas. In
                // the preview we want the container's scheme-aware grey to
                // show through instead of a stark white rectangle. Inject a
                // stylesheet + inline styles with !important so nothing the
                // overlay does can override it. color-scheme: normal keeps
                // the UA canvas neutral.
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
                height,
                width: '100%',
                // Neutral dark grey in dark mode, neutral light grey in
                // light mode, so the preview frame reads as a calm stage
                // rather than pure black. Mantine's default-hover var is
                // scheme-aware (gray-0 in light, dark-5 in dark).
                background: 'var(--mantine-color-default-hover)',
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
                    // Iframes default to white in Chromium; the explicit
                    // color-scheme keeps the UA canvas neutral and lets the
                    // container's scheme-aware grey show through.
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
                    ? 'var(--mantine-color-blue-light)'
                    : 'transparent',
                border: selected?.url === item.url
                    ? `1px solid var(--mantine-color-blue-filled)`
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

    // Separate size-variant layouts (scoreboard) from team-based layouts.
    // Anything without sizeVariant or team falls into the "other" bucket so
    // single-variant standalone overlays (e.g. rotator/ticker) still render
    // instead of being silently dropped.
    const sizeVariantLayouts = layouts.filter(l => l.sizeVariant);
    const teamLayouts = layouts.filter(l => l.team != null);
    const otherLayouts = layouts.filter(l => !l.sizeVariant && l.team == null);

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
                                    ? 'var(--mantine-color-blue-light)'
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

            {/* Other standalone layouts (e.g. rotator ticker) */}
            {otherLayouts.length > 0 && (
                <Stack gap={2}>
                    {otherLayouts.map((item) => (
                        <LayoutItem
                            key={item.url}
                            item={item}
                            selected={selected}
                            onSelect={onSelect}
                            activeTab={activeTab}
                        />
                    ))}
                </Stack>
            )}

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
                                        backgroundColor: sel ? 'var(--mantine-color-blue-light)' : 'transparent',
                                        border: `1px solid ${sel ? 'var(--mantine-color-blue-filled)' : 'var(--mantine-color-default-border)'}`,
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
                                    backgroundColor: isActive ? 'var(--mantine-color-blue-light)' : 'transparent',
                                    border: isActive ? `1px solid var(--mantine-color-blue-filled)` : '1px solid transparent',
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
            width: 1920,
            height: 1080,
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
                                // Use the theme-adaptive var, not theme.colors.violet[0].
                                // The palette-index-0 shade is near-white in both themes
                                // and glares against dark mode; -light variants are
                                // tinted-translucent and adapt automatically.
                                backgroundColor: isGroupActive(pg.id)
                                    ? 'var(--mantine-color-violet-light)'
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
                                                    ? 'var(--mantine-color-blue-light)'
                                                    : 'transparent',
                                                border: active
                                                    ? `1px solid var(--mantine-color-blue-filled)`
                                                    : '1px solid transparent',
                                            })}
                                        >
                                            <Group justify="space-between" wrap="nowrap" gap={4}>
                                                <div style={{ minWidth: 0, flex: 1 }}>
                                                    <Text size="sm">{variant.label}</Text>
                                                    <Text size="xs" c="dimmed">1920 x 1080</Text>
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
    // Promoted from per-layout in v2:
    'showCaptains', 'showLogo', 'showBackdropBlur', 'finalBadgeColor',
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
    showCaptains:      true,
    showLogo:          true,
    showBackdropBlur:  true,
    finalBadgeColor:   null,
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

    // Wrap in Input.Wrapper so the label uses Mantine's native label styling
    // (font size, weight, and label→input gap). A plain <Text> label here
    // doesn't match the spacing of sibling NumberInput/TextInput labels and
    // misaligns the input row when laid out side-by-side in a SimpleGrid.
    return (
        <Input.Wrapper label={label} description={description} size="sm">
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
        </Input.Wrapper>
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
        // v1 presets stored several keys (showCaptains, showLogo, etc.) under
        // each per-layout dict. Strip them on load so the global value wins.
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
        // Clear any per-layout pins of the globally-overridable keys (the
        // values surfaced as chips in each layout's "Style overrides" area).
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

// ── Live preview grid for the Design tab ──
// Each preview keeps its overlay's natural aspect ratio. Layout (row × col):
//   Row 1: Large Scoreboard | Player Stats   (50/50)
//   Row 2: Small Scoreboard | Bracket        (50/50)
//   Row 3: Ticker                            (full width)
//
// Sample data wired in each overlay's preview-mode boot:
//   - scoreboard, stats → scoreboard_sample.json (your scoreboard 1 snapshot)
//   - ticker            → ticker_sample.json (10 games from sb3 rotator)
//   - bracket           → bracket_sample.json (current Top Cut)
const PREVIEW_ROWS = [
    [
        { label: 'Large Scoreboard', path: '/layout/scoreboard1/scoreboard.html?scoreboard=1&size=l', w: 800,  h: 460 },
        // Match the Large Scoreboard tile aspect (800×460) so both tiles in
        // row 1 render at the same height. The stats body (325×120) is
        // centered with letterboxing inside the larger tile.
        { label: 'Player Stats',     path: '/layout/scoreboard1/stats.html?scoreboard=1',             w: 800,  h: 460 },
    ],
    [
        { label: 'Small Scoreboard', path: '/layout/scoreboard1/scoreboard.html?scoreboard=1&size=s', w: 500,  h: 80  },
        // Bracket is fluid — body fills any frame and content scales to fit
        // (capped by overlays.bracket.maxScale). 16:9 is just a reasonable
        // tile aspect; the bracket fills it without cropping.
        { label: 'Bracket',          path: '/layout/bracket/index.html',                              w: 960, h: 540 },
    ],
    [
        { label: 'Ticker',           path: '/layout/rotator/ticker.html',                             w: 1920, h: 80  },
    ],
];

function PreviewTile({ label, path, w, h, src, reloadKey }) {
    return (
        <div>
            <Text size="xs" fw={600} c="dimmed" mb={4}>{label}</Text>
            <Box style={{
                width: '100%',
                maxWidth: w,
                aspectRatio: `${w} / ${h}`,
                margin: '0 auto',
                overflow: 'hidden',
                borderRadius: 8,
                border: '1px solid var(--mantine-color-dark-4)',
                background: '#0b0b0f',
            }}>
                <ScaledIframe
                    key={reloadKey}
                    src={src}
                    fallbackWidth={w}
                    fallbackHeight={h}
                    height="100%"
                />
            </Box>
        </div>
    );
}

function DesignPreviews({ baseUrl, showOverrides, onToggleOverrides }) {
    // Build URL with preview flags. Re-keying the iframe on toggle reloads
    // it so applyDesignSettings re-reads with the new globals-only flag.
    const buildUrl = (path) => {
        const sep = path.includes('?') ? '&' : '?';
        const flags = `preview=1${showOverrides ? '' : '&preview_globals_only=1'}`;
        return `${baseUrl}${path}${sep}${flags}`;
    };
    const reloadSuffix = showOverrides ? 'ov' : 'g';

    return (
        <Stack gap="sm">
            <Group justify="space-between" align="center" wrap="nowrap">
                <Text size="xs" c="dimmed" style={{ flex: 1 }}>
                    Live previews — every control on the left updates these in real time.
                </Text>
                <Tooltip label={showOverrides
                    ? 'Showing per-layout overrides on top of the global design'
                    : 'Showing the global design only — per-layout overrides hidden'}>
                    <Switch
                        size="xs"
                        label="Apply overrides"
                        checked={showOverrides}
                        onChange={(e) => onToggleOverrides(e.currentTarget.checked)}
                    />
                </Tooltip>
            </Group>

            {PREVIEW_ROWS.map((row, rowIdx) => (
                <Grid key={rowIdx} gutter="sm">
                    {row.map(item => (
                        <Grid.Col key={item.path} span={12 / row.length}>
                            <PreviewTile
                                {...item}
                                src={buildUrl(item.path)}
                                reloadKey={`${item.path}-${reloadSuffix}`}
                            />
                        </Grid.Col>
                    ))}
                </Grid>
            ))}
        </Stack>
    );
}

// ── Design tab body (controls + previews + presets) ──
function DesignTabBody({ baseUrl }) {
    // Defaults to globals-only so the previews show what the Design tab
    // settings produce in isolation, regardless of any pinned per-layout
    // overrides. Users can flip the switch to see overrides applied.
    const [showOverrides, setShowOverrides] = useState(false);

    return (
        <Stack gap="lg">
            <Grid gutter="md">
                <Grid.Col span={{ base: 12, md: 4 }}>
                    <Paper withBorder p="md">
                        <Text size="sm" fw={700} mb="md">Global Design</Text>
                        <GlobalDesignSection />
                    </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 8 }}>
                    <Paper withBorder p="md">
                        <DesignPreviews
                            baseUrl={baseUrl}
                            showOverrides={showOverrides}
                            onToggleOverrides={setShowOverrides}
                        />
                    </Paper>
                </Grid.Col>
            </Grid>

            <Paper withBorder p="md">
                <Text size="sm" fw={700} mb="md">Presets & Branding</Text>
                <PresetsPanel />
            </Paper>
        </Stack>
    );
}

// ── Global Design Section (rendered inside the Design tab) ──
// Single source of truth for every overlay's visual identity. Promoted v2 keys
// (showCaptains/showLogo/showBackdropBlur/finalBadgeColor) live here too;
// per-layout overrides for any of these are pinned via the chip UI on each
// layout's panel.
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
            <div>
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="xs">Color & Typography</Text>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" verticalSpacing="xs">
                    <DebouncedColorInput
                        label="Accent Color"
                        size="sm"
                        value={accentColor}
                        onChange={(color) => setItem('overlays.global.accentColor', color)}
                        format="hex"
                        swatches={COLOR_SWATCHES}
                    />
                    <DebouncedColorInput
                        label="Text Color"
                        size="sm"
                        value={textColor}
                        onChange={(color) => setItem('overlays.global.textColor', color)}
                        format="hex"
                        swatches={['#ffffff', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#1e293b', '#0f172a']}
                    />
                    <ColorWithOpacity
                        label="Card Background"
                        value={cardBg}
                        onChange={(val) => setItem('overlays.global.cardBg', val)}
                    />
                    <ColorWithOpacity
                        label="Border Color"
                        value={borderColor}
                        onChange={(val) => setItem('overlays.global.borderColor', val)}
                    />
                    <Group gap="xs" align="flex-end" wrap="nowrap">
                        <DebouncedColorInput
                            label="Final Badge Color"
                            size="sm"
                            value={finalBadgeColor}
                            placeholder="Default"
                            onChange={(color) => setItem('overlays.global.finalBadgeColor', color || null)}
                            format="hex"
                            swatches={COLOR_SWATCHES}
                            style={{ flex: 1 }}
                        />
                        {finalBadgeColor && (
                            <Button
                                variant="subtle"
                                size="compact-sm"
                                color="gray"
                                onClick={() => setItem('overlays.global.finalBadgeColor', null)}
                            >
                                Reset
                            </Button>
                        )}
                    </Group>
                    <Select
                        label="Font Family"
                        size="sm"
                        value={fontFamily}
                        onChange={(val) => setItem('overlays.global.fontFamily', val)}
                        data={FONT_OPTIONS}
                        searchable
                    />
                </SimpleGrid>
            </div>

            <div>
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="xs">Card Chrome</Text>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" verticalSpacing="xs">
                    <NumberInput
                        label="Border Radius"
                        size="sm"
                        value={borderRadius}
                        onChange={(val) => setItem('overlays.global.borderRadius', val)}
                        min={0}
                        max={48}
                        step={2}
                        suffix="px"
                    />
                    <NumberInput
                        label="Border Thickness"
                        size="sm"
                        value={borderWidth}
                        onChange={(val) => setItem('overlays.global.borderWidth', val)}
                        min={0}
                        max={16}
                        step={1}
                        suffix="px"
                    />
                </SimpleGrid>
                <Stack gap="xs" mt="xs">
                    <div>
                        <Switch
                            label="Card Shadow"
                            description="Drop shadow behind overlay cards"
                            size="sm"
                            checked={showShadow}
                            onChange={(e) => setItem('overlays.global.showShadow', e.currentTarget.checked)}
                        />
                        <Collapse in={showShadow}>
                            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" verticalSpacing="xs" mt="xs">
                                <NumberInput
                                    label="Shadow Blur"
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
                            </SimpleGrid>
                        </Collapse>
                    </div>
                    <div>
                        <Switch
                            label="Text Shadow"
                            description="Drop shadow on text across overlays"
                            size="sm"
                            checked={textShadowEnabled}
                            onChange={(e) => setItem('overlays.global.textShadowEnabled', e.currentTarget.checked)}
                        />
                        <Collapse in={textShadowEnabled}>
                            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" verticalSpacing="xs" mt="xs">
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
                            </SimpleGrid>
                        </Collapse>
                    </div>
                </Stack>
            </div>

            <div>
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="xs">Display Toggles</Text>
                <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs" verticalSpacing="xs">
                    <Switch
                        label="Show Captains"
                        size="sm"
                        checked={showCaptains}
                        onChange={(e) => setItem('overlays.global.showCaptains', e.currentTarget.checked)}
                    />
                    <Switch
                        label="Show Overlay Logo"
                        size="sm"
                        checked={showLogo}
                        onChange={(e) => setItem('overlays.global.showLogo', e.currentTarget.checked)}
                    />
                    <Switch
                        label="Backdrop Blur"
                        size="sm"
                        checked={showBackdropBlur}
                        onChange={(e) => setItem('overlays.global.showBackdropBlur', e.currentTarget.checked)}
                    />
                </SimpleGrid>
            </div>
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
// Renders this layout's element-only settings on top, then a "Style overrides"
// section listing pinned global overrides as full editor rows. Users add a new
// override via the "+ Add style override" menu, which lists eligible global
// keys (filtered against the overlay's <meta name="overlay-settings"> list).
//
// Unlike the previous design, global controls are NOT duplicated here. Their
// single source of truth lives in the Design tab.
function LayoutSettingsPanel({ layoutType, supportedSettings }) {
    const allDefs = LAYOUT_SETTINGS[layoutType] ?? [];
    const settingsDefs = supportedSettings
        ? allDefs.filter(def => supportedSettings.includes(def.key))
        : allDefs;
    const overlaySettings = useSettingsStore(useShallow(s => s?.overlays?.[layoutType] ?? {}));
    const globalSettings = useSettingsStore(useShallow(s => s?.overlays?.global ?? {}));
    const setItem = useSettingsStore(s => s.setItem);

    // Which global keys is this overlay allowed to override? An override is
    // available when at least one of its meta names is in the overlay's
    // <meta name="overlay-settings"> whitelist (or the whitelist is unset).
    const overridable = useMemo(() => OVERRIDABLE_GLOBAL_KEYS.filter(def =>
        !supportedSettings || def.meta.some(m => supportedSettings.includes(m))
    ), [supportedSettings]);

    const pinned = overridable.filter(def => overlaySettings[def.key] != null);
    const available = overridable.filter(def => overlaySettings[def.key] == null);

    const setOverride = useCallback((key, value) =>
        setItem(`overlays.${layoutType}.${key}`, value), [layoutType, setItem]);

    return (
        <Stack gap="md">
            {settingsDefs.length > 0 && (
                <Stack gap="xs">
                    {settingsDefs.map(def => renderElementSetting(def, layoutType, overlaySettings, setItem))}
                </Stack>
            )}

            {(pinned.length > 0 || available.length > 0) && (
                <div>
                    {settingsDefs.length > 0 && <Divider mb="sm" />}
                    <Group justify="space-between" align="center" mb="xs">
                        <div>
                            <Text size="sm" fw={600}>Style Overrides</Text>
                            <Text size="xs" c="dimmed">
                                Pin per-overlay values that win over the global Design settings.
                            </Text>
                        </div>
                        {available.length > 0 && (
                            <Menu shadow="md" width={220} position="bottom-end">
                                <Menu.Target>
                                    <Button variant="light" size="compact-xs">+ Add override</Button>
                                </Menu.Target>
                                <Menu.Dropdown>
                                    <Menu.Label>Override a global setting</Menu.Label>
                                    {available.map(def => (
                                        <Menu.Item
                                            key={def.key}
                                            onClick={() => {
                                                const seed = globalSettings[def.key] ?? def.defaultValue ?? '';
                                                setOverride(def.key, seed === '' ? def.defaultValue ?? '#000000' : seed);
                                            }}
                                        >
                                            {def.label}
                                        </Menu.Item>
                                    ))}
                                </Menu.Dropdown>
                            </Menu>
                        )}
                    </Group>

                    {pinned.length === 0 ? (
                        <Text size="xs" c="dimmed">No overrides — using global values from the Design tab.</Text>
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
                <Text size="xs" c="dimmed">This overlay has no configurable settings.</Text>
            )}
        </Stack>
    );
}

function renderElementSetting(def, layoutType, overlaySettings, setItem) {
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
    if (def.type === 'select') {
        const value = overlaySettings?.[def.key] ?? def.defaultValue;
        return (
            <Select
                key={def.key}
                label={def.label}
                description={def.description}
                size="sm"
                value={value}
                onChange={(val) => setItem(settingsKey, val)}
                data={def.options}
            />
        );
    }
    if (def.type === 'color-override') {
        const value = overlaySettings?.[def.key] ?? null;
        return (
            <div key={def.key}>
                <Text size="sm" fw={500}>{def.label}</Text>
                {def.description && <Text size="xs" c="dimmed" mb={4}>{def.description}</Text>}
                <Group gap="xs" align="flex-end" wrap="nowrap">
                    <DebouncedColorInput
                        size="sm"
                        value={value ?? ''}
                        placeholder="Default"
                        onChange={(color) => setItem(settingsKey, color || null)}
                        format="hex"
                        swatches={COLOR_SWATCHES}
                        style={{ flex: 1 }}
                    />
                    {value != null && (
                        <Button variant="subtle" size="compact-sm" color="gray"
                            onClick={() => setItem(settingsKey, null)}>
                            Reset
                        </Button>
                    )}
                </Group>
            </div>
        );
    }
    if (def.type === 'number-override') {
        const value = overlaySettings?.[def.key] ?? def.defaultValue;
        return (
            <NumberInput
                key={def.key}
                label={def.label}
                description={def.description}
                size="sm"
                value={value}
                onChange={(val) => setItem(settingsKey, val ?? def.defaultValue)}
                min={def.min}
                max={def.max}
                step={def.step}
                suffix={def.suffix}
            />
        );
    }
    return null;
}

// One pinned override row (any type). The first column is the editor; the
// trailing X removes the pin so the global value takes back over.
function OverrideRow({ def, value, onChange, onRemove }) {
    const sharedRemove = (
        <Tooltip label="Remove override (use global value)">
            <ActionIcon variant="subtle" color="gray" onClick={onRemove} size="lg">×</ActionIcon>
        </Tooltip>
    );

    let editor = null;
    if (def.type === 'color') {
        editor = (
            <DebouncedColorInput
                label={def.label}
                size="sm"
                value={value ?? ''}
                onChange={(c) => onChange(c || null)}
                format="hex"
                swatches={COLOR_SWATCHES}
                style={{ flex: 1 }}
            />
        );
    } else if (def.type === 'color-opacity') {
        editor = <ColorWithOpacity label={def.label} value={value} onChange={onChange} />;
    } else if (def.type === 'number') {
        editor = (
            <NumberInput
                label={def.label}
                size="sm"
                value={value ?? def.defaultValue}
                onChange={(v) => onChange(v ?? def.defaultValue)}
                min={def.min}
                max={def.max}
                step={def.step}
                suffix={def.suffix}
                style={{ flex: 1 }}
            />
        );
    } else if (def.type === 'switch') {
        editor = (
            <Switch
                label={def.label}
                size="sm"
                checked={value !== false}
                onChange={(e) => onChange(e.currentTarget.checked)}
            />
        );
    }

    return (
        <Group gap="xs" align="flex-end" wrap="nowrap">
            <div style={{ flex: 1, minWidth: 0 }}>{editor}</div>
            {sharedRemove}
        </Group>
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
                                backgroundColor: isActive ? 'var(--mantine-color-blue-light)' : 'transparent',
                                border: isActive
                                    ? `1px solid var(--mantine-color-blue-filled)`
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
    // The rotator/ group hosts overlays that visualize a specific scoreboard's
    // rotation; they take ?scoreboard=N like the rest, so they belong here too.
    const filteredLayouts = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return allLayouts.filter(l => {
            // Bracket layouts are handled by BracketLayoutList
            if (l.group === 'bracket') return false;
            const isScoreboard = l.group.startsWith('scoreboard') || l.group === 'rotator';
            if (!isScoreboard) return false;
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
    // The per-layout settings panel is offered whenever an overlay declares
    // any supported settings — element-only entries from LAYOUT_SETTINGS or
    // any global key from OVERRIDABLE_GLOBAL_KEYS that the overlay's <meta>
    // whitelist allows. Empty <meta> (e.g. teamlogo.html) hides the panel.
    const hasAnySupportedSettings = supportedSettings === null || supportedSettings.length > 0;
    const showSettingsPanel = !!selectedType && hasAnySupportedSettings && mode !== 'design';

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
                <DesignTabBody baseUrl={baseUrl} />
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

                        {/* Per-layout settings: element-only controls + chip-style global overrides */}
                        {showSettingsPanel && (
                            <Collapse in={settingsOpen}>
                                <Paper withBorder p="sm" mt="xs">
                                    <Text size="sm" fw={600} mb="xs" tt="capitalize">
                                        {selectedType} Settings
                                    </Text>
                                    <LayoutSettingsPanel
                                        layoutType={selectedType}
                                        supportedSettings={supportedSettings}
                                    />
                                </Paper>
                            </Collapse>
                        )}
                    </Grid.Col>
                </Grid>
            )}
        </Stack>
    );
}
