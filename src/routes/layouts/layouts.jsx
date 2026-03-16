import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    Stack, Paper, Text, Group, Grid, UnstyledButton,
    CopyButton, ActionIcon, Button, Tooltip, Box, Loader, Alert, Tabs, Badge,
} from '@mantine/core';
import { useSettingsStore } from '../../context/store';

const PREVIEW_HEIGHT = 500;

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

    // Recalc when native size changes
    useEffect(() => {
        if (nativeSize) recalc(nativeSize.w, nativeSize.h);
    }, [nativeSize, recalc]);

    // Recalc on container resize
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
                // Use explicit CSS body dimensions if set, otherwise fall back to scroll size
                const w = cssW > 0 ? cssW : doc.body.scrollWidth;
                const h = cssH > 0 ? cssH : doc.body.scrollHeight;
                if (w > 0 && h > 0) {
                    setNativeSize({ w, h });
                }
            } catch (e) {
                // cross-origin — keep defaults
            }
        };
        // Defer to ensure styles and layout are fully applied
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

function LayoutList({ layouts, selected, onSelect }) {
    // Group by the subfolder name (last part of group path, e.g. "hud" from "scoreboard1/hud")
    const groups = useMemo(() => {
        const g = {};
        for (const l of layouts) {
            const parts = l.group.split('/');
            const label = parts[parts.length - 1] || 'other';
            if (!g[label]) g[label] = [];
            g[label].push(l);
        }
        return g;
    }, [layouts]);

    if (layouts.length === 0) {
        return (
            <Text size="sm" c="dimmed">
                No layouts found for this scoreboard.
            </Text>
        );
    }

    return Object.entries(groups).map(([label, items]) => (
        <Paper key={label} withBorder p="xs">
            <Text size="sm" fw={600} mb={4} tt="uppercase">{label}</Text>
            <Stack gap={4}>
                {items.map((item) => (
                    <UnstyledButton
                        key={item.url}
                        onClick={() => onSelect(item.url)}
                        p="xs"
                        style={(theme) => ({
                            borderRadius: theme.radius.sm,
                            backgroundColor: selected === item.url
                                ? theme.colors.blue[0]
                                : 'transparent',
                            border: selected === item.url
                                ? `1px solid ${theme.colors.blue[3]}`
                                : '1px solid transparent',
                        })}
                    >
                        <Group justify="space-between" wrap="nowrap" gap={4}>
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <Text size="sm" truncate>{item.name}</Text>
                                {item.width && item.height && (
                                    <Text size="xs" c="dimmed">{item.width} x {item.height}</Text>
                                )}
                            </div>
                            <CopyButton value={item.url}>
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
                ))}
            </Stack>
        </Paper>
    ));
}

export default function LayoutBrowser() {
    const active = useSettingsStore(s => s?.scoreboards?.active ?? [1]);
    const sources = useSettingsStore(s => s?.scoreboards?.sources ?? {});
    const aliases = useSettingsStore(s => s?.scoreboards?.aliases ?? {});

    const [allLayouts, setAllLayouts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selected, setSelected] = useState(null);
    const [activeTab, setActiveTab] = useState(String(active[0] ?? 1));

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

    // Filter layouts for the active tab's scoreboard and source type
    const filteredLayouts = useMemo(() => {
        const sbId = activeTab;
        const src = sources[sbId] ?? sources[String(sbId)];
        const srcType = src?.type ?? 'manual';

        // Match layouts whose group starts with "scoreboard{N}/"
        // For hud/api types, also match the subfolder
        // For manual, show all layouts for that scoreboard
        return allLayouts.filter(l => {
            const prefix = `scoreboard${sbId}/`;
            if (!l.group.startsWith(prefix)) return false;
            if (srcType === 'manual') return true;
            const subfolder = l.group.slice(prefix.length).split('/')[0];
            return subfolder === srcType;
        });
    }, [allLayouts, activeTab, sources]);

    // Auto-select first layout when tab changes
    useEffect(() => {
        if (filteredLayouts.length > 0) {
            setSelected(prev => {
                // Keep selection if it's still in the filtered list
                if (prev && filteredLayouts.some(l => l.url === prev)) return prev;
                return filteredLayouts[0].url;
            });
        } else {
            setSelected(null);
        }
    }, [filteredLayouts]);

    return (
        <Stack gap="md">
            <Tabs value={activeTab} onChange={setActiveTab} variant="outline">
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

            <Grid gutter="md">
                {/* Left panel: layout list */}
                <Grid.Col span={4}>
                    <Stack gap="xs" style={{ maxHeight: PREVIEW_HEIGHT + 40, overflow: 'auto' }}>
                        <Text size="xs" c="dimmed">
                            Select a layout to preview. Copy the URL into an OBS Browser Source.
                        </Text>

                        {loading && <Loader size="sm" />}
                        {error && <Alert color="red" title="Error">{error}</Alert>}

                        <LayoutList
                            layouts={filteredLayouts}
                            selected={selected}
                            onSelect={setSelected}
                        />
                    </Stack>
                </Grid.Col>

                {/* Right panel: iframe preview */}
                <Grid.Col span={8}>
                    <Paper withBorder style={{ overflow: 'hidden' }}>
                        {selected ? (
                            <>
                                <Group p="xs" justify="space-between" wrap="nowrap" gap={4} style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
                                    <Text size="xs" c="dimmed" truncate style={{ flex: 1, minWidth: 0 }}>{selected}</Text>
                                    <CopyButton value={selected}>
                                        {({ copied, copy }) => (
                                            <Tooltip label={copied ? 'Copied!' : 'Copy URL'}>
                                                <Button variant="subtle" size="compact-xs" color={copied ? 'teal' : 'gray'} onClick={copy}>
                                                    {copied ? 'Copied' : 'Copy'}
                                                </Button>
                                            </Tooltip>
                                        )}
                                    </CopyButton>
                                </Group>
                                <ScaledIframe key={selected} src={selected} />
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
                                <Text c="dimmed">Select a layout to preview</Text>
                            </Box>
                        )}
                    </Paper>
                </Grid.Col>
            </Grid>
        </Stack>
    );
}
