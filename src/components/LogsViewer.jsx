import { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Stack, Text, Loader } from './ui/primitives';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { ScrollArea } from './ui/scroll-area';
import { SegmentedControl } from './ui/segmented-control';
import { SimpleTooltip } from './ui/simple-tooltip';
import { notifications } from '../lib/notify';

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
        <Dialog open={opened} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="max-w-[90vw] sm:max-w-[90vw]">
                <DialogHeader>
                    <DialogTitle className="label-display">Logs</DialogTitle>
                </DialogHeader>
                <Stack gap="xs">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <Button size="xs" variant="secondary" onClick={handleReveal}>
                                Open logs folder
                            </Button>
                            <SimpleTooltip label={dir || 'logs directory'}>
                                <Text size="xs" dimmed truncate className="max-w-[420px]">{dir}</Text>
                            </SimpleTooltip>
                        </div>
                        <div className="flex items-center gap-3">
                            <Label className="flex items-center gap-1.5 text-xs">
                                <Switch checked={wrap} onCheckedChange={setWrap} />
                                Wrap
                            </Label>
                            <Label className="flex items-center gap-1.5 text-xs">
                                <Switch checked={follow} onCheckedChange={setFollow} />
                                Follow
                            </Label>
                            <Button size="xs" variant="outline" onClick={() => fetchTail(selected)} disabled={loading}>
                                {loading && <Loader size={10} />}
                                Refresh
                            </Button>
                            <Button size="xs" variant="outline" onClick={handleCopy}>
                                Copy
                            </Button>
                        </div>
                    </div>

                    {options.length > 1 ? (
                        <SegmentedControl
                            size="xs"
                            value={selected}
                            onChange={setSelected}
                            data={options}
                        />
                    ) : options.length === 1 ? (
                        <Text size="xs" dimmed>{options[0].label}</Text>
                    ) : (
                        <Text size="xs" dimmed>No log files yet.</Text>
                    )}

                    <div className="flex items-center gap-2">
                        {currentMeta && (
                            <Badge variant="secondary">
                                {fmtSize(currentMeta.size)} · modified {fmtMtime(currentMeta.mtime)}
                            </Badge>
                        )}
                        {meta?.truncated && (
                            <Badge className="bg-[#f5bb00] text-black">
                                Showing last {fmtSize(meta.returned)} of {fmtSize(meta.size)}
                            </Badge>
                        )}
                        {loading && <Loader size={14} />}
                    </div>

                    <ScrollArea viewportRef={viewportRef} className="h-[65vh] rounded-md bg-night-950" type="auto">
                        <pre
                            className="min-h-full bg-transparent p-3 font-mono text-fog-300"
                            style={{
                                fontSize: 10,
                                lineHeight: 1.35,
                                whiteSpace: wrap ? 'pre-wrap' : 'pre',
                                wordBreak: wrap ? 'break-word' : 'normal',
                            }}
                        >
                            {text || (loading ? '' : '(empty)')}
                        </pre>
                    </ScrollArea>
                </Stack>
            </DialogContent>
        </Dialog>
    );
}
