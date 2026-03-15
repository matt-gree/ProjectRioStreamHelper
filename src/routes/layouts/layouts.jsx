import { useState, useEffect, useCallback } from 'react';
import {
    Stack, Paper, Text, Group, Grid, UnstyledButton,
    CopyButton, ActionIcon, Tooltip, Box, Loader, Alert,
} from '@mantine/core';

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
            // Auto-select first layout
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

    // Group layouts by folder
    const groups = {};
    for (const l of layouts) {
        if (!groups[l.group]) groups[l.group] = [];
        groups[l.group].push(l);
    }

    return (
        <Grid gutter="md" style={{ height: 'calc(100vh - 120px)' }}>
            {/* Left panel: layout list */}
            <Grid.Col span={4}>
                <Stack gap="xs" style={{ height: '100%', overflow: 'auto' }}>
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
                                        <Group justify="space-between" wrap="nowrap">
                                            <Text size="sm" truncate>{item.name}</Text>
                                            <CopyButton value={item.url}>
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
                                                            <Text size="xs">{copied ? '\u2713' : '\u2398'}</Text>
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
                <Paper
                    withBorder
                    style={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                    }}
                >
                    {selected ? (
                        <>
                            <Group p="xs" justify="space-between" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
                                <Text size="xs" c="dimmed" truncate style={{ flex: 1 }}>{selected}</Text>
                                <CopyButton value={selected}>
                                    {({ copied, copy }) => (
                                        <Tooltip label={copied ? 'Copied!' : 'Copy URL'}>
                                            <ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'} size="sm" onClick={copy}>
                                                <Text size="xs">{copied ? '\u2713' : 'Copy'}</Text>
                                            </ActionIcon>
                                        </Tooltip>
                                    )}
                                </CopyButton>
                            </Group>
                            <Box style={{ flex: 1, position: 'relative', background: '#1a1a1a' }}>
                                <iframe
                                    key={selected}
                                    src={selected}
                                    style={{
                                        width: '1920px',
                                        height: '1080px',
                                        border: 'none',
                                        transform: 'scale(0.45)',
                                        transformOrigin: 'top left',
                                    }}
                                    title="Layout Preview"
                                />
                            </Box>
                        </>
                    ) : (
                        <Box
                            style={{
                                flex: 1,
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
