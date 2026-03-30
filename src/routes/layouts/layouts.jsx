import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    Stack, Paper, Text, Group, Grid, UnstyledButton,
    CopyButton, ActionIcon, Button, Tooltip, Box, Loader, Alert, Tabs, Badge, Switch,
    Collapse, ColorInput, FileButton, Image, TextInput,
} from '@mantine/core';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useShallow } from 'zustand/react/shallow';
import useTournament from '../../hooks/useTournament';

const PREVIEW_HEIGHT = 500;

// ── Per-layout-type settings definitions ──
// Each entry: { key, type, label, description? }
// Supported control types: 'switch', 'color', 'logo'
const LAYOUT_SETTINGS = {
    scoreboard: [
        { key: 'showCaptains', type: 'switch', label: 'Show Captains', description: 'Display captain character icons' },
        { key: 'showElo', type: 'switch', label: 'Show ELO', description: 'Display ELO ratings on completed games' },
        { key: 'showTeamLogos', type: 'switch', label: 'Show Team Logos', description: 'Display MSB team logos' },
        { key: 'accentColor', type: 'color', label: 'Accent Color', description: 'Primary highlight color' },
        { key: 'tournamentLogo', type: 'logo', label: 'Tournament Logo', description: 'Shown on the overlay' },
    ],
    roster: [
        { key: 'accentColor', type: 'color', label: 'Accent Color', description: 'Primary highlight color' },
    ],
    stats: [
        { key: 'accentColor', type: 'color', label: 'Accent Color', description: 'Primary highlight color' },
    ],
    teamlogo: [],
    bracket: [
        { key: 'accentColor', type: 'color', label: 'Accent Color', description: 'Primary highlight color' },
    ],
};

function ScaledIframe({ src }) {
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
                if (!doc) return;
                const style = doc.defaultView.getComputedStyle(doc.body);
                const cssW = parseFloat(style.width);
                const cssH = parseFloat(style.height);
                const w = cssW > 0 ? cssW : doc.body.scrollWidth;
                const h = cssH > 0 ? cssH : doc.body.scrollHeight;
                if (w > 0 && h > 0) {
                    setNativeSize({ w, h });
                }
            } catch (e) {
                // cross-origin — keep defaults
            }
        };
        requestAnimationFrame(readSize);
    }, []);

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

function LayoutList({ layouts, selected, onSelect, activeTab }) {
    const [expandedGroups, setExpandedGroups] = useState({});

    if (layouts.length === 0) {
        return (
            <Text size="sm" c="dimmed">
                No layouts found for this scoreboard.
            </Text>
        );
    }

    // Separate: grouped (size variants) vs ungrouped (standalone)
    const groups = {};    // parentName -> items[]
    const standalone = [];
    for (const item of layouts) {
        if (item.parentName && item.sizeVariant) {
            const key = `${item.group}/${item.parentName}`;
            if (!groups[key]) groups[key] = { parentName: item.parentName, items: [] };
            groups[key].items.push(item);
        } else {
            standalone.push(item);
        }
    }

    const toggleGroup = (key) => {
        setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // Check if any item in a group is selected
    const isGroupActive = (items) => items.some(i => i.url === selected?.url);

    return (
        <Stack gap={4}>
            {/* Collapsible size-variant groups */}
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

            {/* Standalone layouts (no size variants) */}
            {standalone.map((item) => (
                <LayoutItem
                    key={item.url}
                    item={item}
                    selected={selected}
                    onSelect={onSelect}
                    activeTab={activeTab}
                />
            ))}
        </Stack>
    );
}

// ── Bracket Layout List (dynamic, based on loaded tournament phases) ──
const BRACKET_VARIANTS = [
    { key: 'full', label: 'Full Bracket', path: '/layout/bracket/index.html' },
    { key: 'winners', label: 'Winners Only', path: '/layout/bracket/index.html?winners_only=true' },
    { key: 'losers', label: 'Losers Only', path: '/layout/bracket/index.html?losers_only=true' },
];

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

// ── Per-layout settings panel ──
function LayoutSettingsPanel({ layoutType }) {
    const settingsDefs = LAYOUT_SETTINGS[layoutType];
    const overlaySettings = useSettingsStore(useShallow(s => s?.overlays?.[layoutType]));
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

                if (def.type === 'color') {
                    const value = overlaySettings?.[def.key] ?? '#f59e0b';
                    return (
                        <div key={def.key}>
                            <ColorInput
                                label={def.label}
                                description={def.description}
                                size="sm"
                                value={value}
                                onChange={(color) => setItem(settingsKey, color)}
                                format="hex"
                                swatches={[
                                    '#f59e0b', '#ef4444', '#22c55e', '#3b82f6',
                                    '#a855f7', '#ec4899', '#14b8a6', '#f97316',
                                    '#6366f1', '#64748b',
                                ]}
                            />
                        </div>
                    );
                }

                if (def.type === 'logo') {
                    return (
                        <LogoUpload
                            key={def.key}
                            label={def.label}
                            description={def.description}
                        />
                    );
                }

                return null;
            })}
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

    // Top-level mode: 'scoreboard' or 'bracket'
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

    // Auto-select first layout when tab changes (scoreboard mode only)
    useEffect(() => {
        if (mode !== 'scoreboard') return;
        if (filteredLayouts.length > 0) {
            setSelected(prev => {
                if (prev && filteredLayouts.some(l => l.url === prev.url)) return prev;
                return filteredLayouts[0];
            });
        } else {
            setSelected(null);
        }
    }, [filteredLayouts, mode]);

    // Clear search and selection on mode switch
    useEffect(() => {
        setSearchQuery('');
        setSelected(null);
        setSettingsOpen(false);
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
    const hasSettings = selectedType && LAYOUT_SETTINGS[selectedType]?.length > 0;

    // Build the URL — inject scoreboard param only for scoreboard layouts
    const selectedUrl = useMemo(() => {
        if (!selected?.url) return null;
        try {
            const u = new URL(selected.url);
            if (mode === 'scoreboard') {
                u.searchParams.set('scoreboard', activeScoreboardTab);
            }
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
            {/* Top-level mode tabs: Scoreboards vs Bracket */}
            <Tabs value={mode} onChange={setMode} variant="pills">
                <Tabs.List>
                    <Tabs.Tab value="scoreboard">Scoreboards</Tabs.Tab>
                    <Tabs.Tab value="bracket">Bracket</Tabs.Tab>
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

            <Grid gutter="md">
                {/* Left panel: layout list */}
                <Grid.Col span={4}>
                    <Stack gap="xs" style={{ maxHeight: PREVIEW_HEIGHT + 40, overflow: 'auto' }}>
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

                        {mode === 'bracket' && (
                            <BracketLayoutList
                                selected={selected}
                                onSelect={setSelected}
                                baseUrl={baseUrl}
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
                                        {hasSettings && (
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
                                <ScaledIframe key={selectedUrl} src={selectedUrl} />
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
                                        : 'Select a layout to preview'}
                                </Text>
                            </Box>
                        )}
                    </Paper>

                    {/* Per-layout settings panel */}
                    {hasSettings && (
                        <Collapse in={settingsOpen}>
                            <Paper withBorder p="sm" mt="xs">
                                <Text size="sm" fw={600} mb="xs" tt="capitalize">
                                    {selectedType} Settings
                                </Text>
                                <LayoutSettingsPanel layoutType={selectedType} />
                            </Paper>
                        </Collapse>
                    )}
                </Grid.Col>
            </Grid>
        </Stack>
    );
}
