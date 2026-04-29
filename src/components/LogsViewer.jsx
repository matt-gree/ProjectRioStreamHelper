import { useState, useEffect, useCallback, useRef } from 'react';
import {
    Modal, Stack, Group, Button, SegmentedControl, Text, ScrollArea,
    Code, Loader, Badge, Tooltip, ActionIcon, Switch,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

// Tail the end of a log file as text. Polls on a timer when "Follow" is on.
const POLL_MS = 2000;
const DEFAULT_BYTES = 262144; // 256 KB — matches server default

function fmtSize(n) {
    if (n == null) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtMtime(epoch) {
    if (!epoch) return '';
    try {
        return new Date(epoch * 1000).toLocaleString();
    } catch {
        return '';
    }
}

export default function LogsViewer({ opened, onClose }) {
    const [files, setFiles] = useState([]);
    const [dir, setDir] = useState('');
    const [selected, setSelected] = useState('tsh_info.txt');
    const [text, setText] = useState('');
    const [meta, setMeta] = useState(null);
    const [loading, setLoading] = useState(false);
    const [follow, setFollow] = useState(true);
    const [wrap, setWrap] = useState(false);
    const viewportRef = useRef(null);

    const fetchList = useCallback(async () => {
        try {
            const r = await fetch('/api/v1/logs');
            const d = await r.json();
            setFiles(d.items || []);
            setDir(d.dir || '');
            // If the current selection doesn't exist, fall back to the first file.
            if (d.items && d.items.length && !d.items.find(i => i.name === selected)) {
                setSelected(d.items[0].name);
            }
        } catch {
            /* ignore */
        }
    }, [selected]);

    const fetchTail = useCallback(async (name) => {
        if (!name) return;
        setLoading(true);
        try {
            const r = await fetch(`/api/v1/logs/tail?name=${encodeURIComponent(name)}&bytes=${DEFAULT_BYTES}`);
            const d = await r.json();
            if (d.error) {
                setText(`[error] ${d.error}`);
                setMeta(null);
            } else {
                setText(d.text || '');
                setMeta({ size: d.size, returned: d.returned, truncated: d.truncated });
            }
        } catch (e) {
            setText(`[error] ${e?.message ?? e}`);
            setMeta(null);
        }
        setLoading(false);
    }, []);

    // Initial load when modal opens.
    useEffect(() => {
        if (!opened) return;
        fetchList();
    }, [opened, fetchList]);

    // Load file content whenever selection changes or modal (re)opens.
    useEffect(() => {
        if (!opened) return;
        fetchTail(selected);
    }, [opened, selected, fetchTail]);

    // Follow mode: re-poll the tail + scroll to bottom.
    useEffect(() => {
        if (!opened || !follow) return;
        const id = setInterval(() => fetchTail(selected), POLL_MS);
        return () => clearInterval(id);
    }, [opened, follow, selected, fetchTail]);

    // Scroll to bottom when text updates in follow mode.
    useEffect(() => {
        if (!follow || !viewportRef.current) return;
        const vp = viewportRef.current;
        // Scroll after paint so measurements are accurate.
        requestAnimationFrame(() => {
            vp.scrollTop = vp.scrollHeight;
        });
    }, [text, follow]);

    const handleReveal = useCallback(async () => {
        try {
            const r = await fetch('/api/v1/logs/reveal', { method: 'POST' });
            if (!r.ok) {
                const d = await r.json().catch(() => ({}));
                notifications.show({ message: d.error || 'Could not open folder', color: 'red' });
            }
        } catch (e) {
            notifications.show({ message: 'Could not open folder', color: 'red' });
        }
    }, []);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(text);
            notifications.show({ message: 'Copied to clipboard', color: 'green' });
        } catch {
            notifications.show({ message: 'Copy failed', color: 'red' });
        }
    }, [text]);

    const options = files.map(f => ({
        label: f.name.replace(/\.txt$/, ''),
        value: f.name,
    }));

    const currentMeta = files.find(f => f.name === selected);

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            title="Logs"
            size="90%"
            styles={{ body: { paddingTop: 8 } }}
        >
            <Stack gap="xs">
                <Group justify="space-between" align="flex-end" wrap="wrap">
                    <Group gap="xs">
                        <Button size="xs" variant="light" onClick={handleReveal}>
                            Open logs folder
                        </Button>
                        <Tooltip label={dir || 'logs directory'}>
                            <Text size="xs" c="dimmed" truncate maw={420}>{dir}</Text>
                        </Tooltip>
                    </Group>
                    <Group gap="xs">
                        <Switch
                            size="xs"
                            label="Wrap"
                            checked={wrap}
                            onChange={e => setWrap(e.currentTarget.checked)}
                        />
                        <Switch
                            size="xs"
                            label="Follow"
                            checked={follow}
                            onChange={e => setFollow(e.currentTarget.checked)}
                        />
                        <Button
                            size="xs"
                            variant="default"
                            onClick={() => fetchTail(selected)}
                            loading={loading}
                        >
                            Refresh
                        </Button>
                        <Button size="xs" variant="default" onClick={handleCopy}>
                            Copy
                        </Button>
                    </Group>
                </Group>

                {options.length > 1 ? (
                    <SegmentedControl
                        size="xs"
                        value={selected}
                        onChange={setSelected}
                        data={options}
                    />
                ) : options.length === 1 ? (
                    <Text size="xs" c="dimmed">{options[0].label}</Text>
                ) : (
                    <Text size="xs" c="dimmed">No log files yet.</Text>
                )}

                <Group gap="xs">
                    {currentMeta && (
                        <Badge size="sm" variant="light">
                            {fmtSize(currentMeta.size)} · modified {fmtMtime(currentMeta.mtime)}
                        </Badge>
                    )}
                    {meta?.truncated && (
                        <Badge size="sm" color="yellow" variant="light">
                            Showing last {fmtSize(meta.returned)} of {fmtSize(meta.size)}
                        </Badge>
                    )}
                    {loading && <Loader size="xs" />}
                </Group>

                <ScrollArea
                    h="65vh"
                    type="auto"
                    viewportRef={viewportRef}
                    styles={{ viewport: { backgroundColor: 'var(--mantine-color-dark-8)' } }}
                >
                    <Code
                        block
                        style={{
                            fontSize: 10,
                            lineHeight: 1.35,
                            whiteSpace: wrap ? 'pre-wrap' : 'pre',
                            wordBreak: wrap ? 'break-word' : 'normal',
                            backgroundColor: 'transparent',
                            color: 'var(--mantine-color-gray-1)',
                            minHeight: '100%',
                        }}
                    >
                        {text || (loading ? '' : '(empty)')}
                    </Code>
                </ScrollArea>
            </Stack>
        </Modal>
    );
}
