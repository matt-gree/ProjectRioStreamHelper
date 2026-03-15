import { useState, useEffect, useCallback, useRef } from 'react';
import {
    Stack, Paper, Text, Group, Grid, UnstyledButton,
    CopyButton, ActionIcon, Button, Tooltip, Box, Loader, Alert,
} from '@mantine/core';

const NATIVE_W = 1920;
const NATIVE_H = 1080;
const PREVIEW_HEIGHT = 500;

function ScaledIframe({ src }) {
    const containerRef = useRef(null);
    const [dims, setDims] = useState({ scale: 0.2, offsetX: 0, offsetY: 0 });

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            const scale = Math.min(width / NATIVE_W, height / NATIVE_H);
            const scaledW = NATIVE_W * scale;
            const scaledH = NATIVE_H * scale;
            setDims({
                scale,
                offsetX: (width - scaledW) / 2,
                offsetY: (height - scaledH) / 2,
            });
        });
        observer.observe(el);
        return () => observer.disconnect();
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
                src={src}
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: `${NATIVE_W}px`,
                    height: `${NATIVE_H}px`,
                    border: 'none',
                    transform: `translate(${dims.offsetX}px, ${dims.offsetY}px) scale(${dims.scale})`,
                    transformOrigin: 'top left',
                }}
                title="Layout Preview"
            />
        </Box>
    );
}

export default function LayoutBrowser() {
    const [layouts, setLayouts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selected, setSelected] = useState(null);

    const fetchLayouts = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const resp = await fetch('/api/v1/layouts');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            setLayouts(data);
            if (data.length > 0 && !selected) {
                setSelected(data[0].url);
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchLayouts();
    }, [fetchLayouts]);

    const groups = {};
    for (const l of layouts) {
        if (!groups[l.group]) groups[l.group] = [];
        groups[l.group].push(l);
    }

    return (
        <Grid gutter="md">
            {/* Left panel: layout list */}
            <Grid.Col span={4}>
                <Stack gap="xs" style={{ maxHeight: PREVIEW_HEIGHT + 40, overflow: 'auto' }}>
                    <Text size="lg" fw={700}>OBS Layouts</Text>
                    <Text size="xs" c="dimmed">
                        Select a layout to preview. Copy the URL into an OBS Browser Source.
                    </Text>

                    {loading && <Loader size="sm" />}
                    {error && <Alert color="red" title="Error">{error}</Alert>}

                    {Object.entries(groups).map(([groupName, items]) => (
                        <Paper key={groupName} withBorder p="xs">
                            <Text size="sm" fw={600} mb={4}>{groupName}</Text>
                            <Stack gap={4}>
                                {items.map((item) => (
                                    <UnstyledButton
                                        key={item.url}
                                        onClick={() => setSelected(item.url)}
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
                                            <Text size="sm" truncate style={{ minWidth: 0, flex: 1 }}>{item.name}</Text>
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
                    ))}

                    {!loading && layouts.length === 0 && (
                        <Text size="sm" c="dimmed">
                            No layouts found. Add HTML files to <code>public/layout/</code>.
                        </Text>
                    )}
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
    );
}
