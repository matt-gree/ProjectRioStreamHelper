import { memo, useEffect, useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useObsStore } from '../../context/obs';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '../../components/ui/dialog';
import { Stack, Group, Text } from '../../components/ui/primitives';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ScrollArea } from '../../components/ui/scroll-area';
import { cn } from '../../lib/utils';
import { notifications } from '../../lib/notify';
import { ELEMENTS } from './elements';
import { useActiveBoards, useBoardLabel } from './boards';

/*
 * The Add picker — how a source comes into being now that the rack lists only
 * what is really in a scene.
 *
 *   layout → board (when the layout is board-scoped) → add to THIS scene
 *
 * The catalog stops being a place you browse and becomes a transaction. Setup's
 * Layouts tab is a gallery: pick a layout, look at it, copy its URL, maybe add
 * it to the program scene. This asks one question — "what goes in this scene?"
 * — and the scene is already answered, because the producer opened the picker
 * from that scene's + button.
 *
 * Variants (size / team / direction) are separate catalog rows, exactly as the
 * layouts API returns them, so choosing "Scoreboard — Small" is choosing a row
 * rather than filling in a form. That is also why the picker consumes the API
 * instead of the ELEMENTS registry: the registry knows the ~14 things the
 * console can CONTROL, and the catalog knows the ~25 things OBS can SHOW.
 *
 * Added HIDDEN, like every other Bind path in the console: adding a source is
 * setup, and setup must never be the thing that puts something on the
 * broadcast. The rack row's eye is the one deliberate act that does.
 */

/*
 * Which catalog rows take a `?scoreboard=N`, and therefore get a board step.
 *
 * Deliberately derived from the two places that already answer this rather than
 * a third hand-written list: the `scoreboard1` group (what Setup's board tabs
 * qualify — layouts.jsx sets the param for `mode === 'scoreboard'`) and the
 * `scope: 'board'` elements in the registry (what the console's own instance
 * identity is built on). Their union is scoreboard1/*, scorecard and
 * hitvisualizer. Everything else is added board-less, which is exactly what
 * Setup does today — so the picker makes no new claim about any layout.
 */
const BOARD_SCOPED_TYPES = new Set(
    ELEMENTS.filter(el => el.scope === 'board').map(el => el.id),
);

export function isBoardScoped(layout) {
    if (!layout) return false;
    return layout.group === 'scoreboard1' || BOARD_SCOPED_TYPES.has(layout.type);
}

// The URL to create, with the chosen board written in. Origin is left as the
// API returned it: the source may end up on a different machine than the one
// picking, and that URL is already host-qualified for exactly that reason.
export function addUrl(layout, board) {
    if (!layout) return '';
    if (!isBoardScoped(layout) || board == null) return layout.url;
    try {
        const u = new URL(layout.url);
        u.searchParams.set('scoreboard', String(board));
        return u.toString();
    } catch {
        const sep = layout.url.includes('?') ? '&' : '?';
        return `${layout.url}${sep}scoreboard=${board}`;
    }
}

// How a catalog row names itself: the layout, plus the variant that makes this
// row different from its siblings (size / team / direction).
export const rowLabel = (l) => {
    const variant = l.sizeLabel || (l.team ? `Team ${l.team}` : '') || l.dirLabel || '';
    const name = l.parentName || l.name;
    return variant ? `${name} — ${variant}` : name;
};

/*
 * The OBS input name — the SAME label the producer clicked.
 *
 * The catalog's raw `name` is the filename stem for variant rows ('scoreboard'),
 * so naming the input from it would hand back a source called "scoreboard 2"
 * for a row that read "Scoreboard — Large". A producer should be able to find
 * what they just added in OBS's source list by the name they picked.
 *
 * Board-suffixed only on a multi-board rig — otherwise the producer gets a "1"
 * that means nothing (same rule as the source strip's Bind).
 */
export function addName(layout, board, boards) {
    const base = layout ? rowLabel(layout) : 'PRSH Overlay';
    return isBoardScoped(layout) && board != null && boards.length > 1
        ? `${base} ${board}`
        : base;
}

// The layout catalog, fetched once per open. Rows are already one-per-variant.
function useLayoutCatalog(open) {
    const [layouts, setLayouts] = useState([]);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (!open) return undefined;
        let alive = true;
        fetch('/api/v1/layouts')
            .then(r => r.json())
            .then(all => { if (alive) setLayouts(Array.isArray(all) ? all : []); })
            .catch(() => { if (alive) setError('Could not read the layout catalog.'); });
        return () => { alive = false; };
    }, [open]);
    return { layouts, error };
}

const GROUP_LABELS = {
    scoreboard1: 'Scoreboard',
    scorecard: 'Scorecard',
    shared: 'Shared containers',
    commentary: 'Talent',
    playerplates: 'Talent',
    matchup: 'Talent',
    lowerthird: 'Break',
    rotator: 'Rotators',
    bracket: 'Bracket',
    scenes: 'Full scenes',
    hitvisualizer: 'Hit Visualizer',
    schedule: 'Schedule',
    eventheader: 'Event Header',
    controller: 'Controller',
    ungrouped: 'Other',
};

export const AddSourceDialog = memo(function AddSourceDialog({ scene, onClose }) {
    const open = !!scene;
    const { layouts, error } = useLayoutCatalog(open);
    const boards = useActiveBoards();
    const boardLabel = useBoardLabel();
    const [query, setQuery] = useState('');
    const [picked, setPicked] = useState(null);
    const [board, setBoard] = useState(boards[0] ?? 1);
    const [adding, setAdding] = useState(false);

    // Every open is a fresh transaction — a picker that remembers last time's
    // selection is one the producer has to check before clicking Add.
    useEffect(() => {
        if (!open) return;
        setQuery('');
        setPicked(null);
        setBoard(boards[0] ?? 1);
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const groups = useMemo(() => {
        const q = query.toLowerCase().trim();
        const out = new Map();
        for (const l of layouts) {
            if (q && !rowLabel(l).toLowerCase().includes(q)) continue;
            const key = GROUP_LABELS[l.group] ?? l.group;
            if (!out.has(key)) out.set(key, []);
            out.get(key).push(l);
        }
        return [...out.entries()];
    }, [layouts, query]);

    const add = async () => {
        if (!picked) return;
        setAdding(true);
        try {
            const res = await useObsStore.getState().addBrowserSource({
                inputName: addName(picked, board, boards),
                url: addUrl(picked, board),
                width: picked.width,
                height: picked.height,
                sceneName: scene,
                enabled: false,
            });
            notifications.show({
                message: `Added “${res.inputName}” to ${res.sceneName} — hidden. Flip it on when you're ready.`,
                color: 'green',
            });
            onClose();
        } catch (e) {
            notifications.show({ message: e?.message || 'Failed to add to OBS', color: 'red' });
        }
        setAdding(false);
    };

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden">
                <DialogHeader>
                    <DialogTitle className="label-display">Add to “{scene}”</DialogTitle>
                    <DialogDescription>
                        Goes in hidden — turn it on from the rack when you’re ready.
                    </DialogDescription>
                </DialogHeader>

                <Stack gap="sm">
                    <div className="relative">
                        <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search overlays…" className="pl-7"
                        />
                    </div>

                    <ScrollArea className="h-[46vh]">
                        <div className="flex flex-col gap-2 pr-2">
                            {error && <Text size="xs" className="text-destructive">{error}</Text>}
                            {!error && !groups.length && (
                                <Text size="xs" dimmed>
                                    {layouts.length ? 'Nothing matches that.' : 'Reading the layout catalog…'}
                                </Text>
                            )}
                            {groups.map(([label, rows]) => (
                                <div key={label} className="flex flex-col">
                                    <Text size="xs" span className="label-display px-1 pb-0.5 tracking-wider text-muted-foreground">
                                        {label}
                                    </Text>
                                    {rows.map(l => (
                                        <button
                                            key={l.url} type="button" onClick={() => setPicked(l)}
                                            className={cn(
                                                'flex h-8 items-center gap-2 rounded-md px-2 text-left transition-colors',
                                                picked?.url === l.url ? 'bg-secondary/70' : 'hover:bg-secondary/40',
                                            )}
                                        >
                                            <Text size="xs" span truncate className="min-w-0 flex-1 text-foreground">
                                                {rowLabel(l)}
                                            </Text>
                                            {l.width && l.height && (
                                                <Text size="xs" span dimmed>{l.width}×{l.height}</Text>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </ScrollArea>

                    <Group gap="sm" className="items-center justify-between border-t border-border/60 pt-2">
                        {/* The board step, only for layouts that read one. A rig
                            with one board has no choice to make, so it doesn't
                            get asked. */}
                        {picked && isBoardScoped(picked) && boards.length > 1 ? (
                            <label className="flex min-w-0 items-center gap-1.5">
                                <Text size="xs" className="text-muted-foreground">Board</Text>
                                <select
                                    value={board} onChange={(e) => setBoard(Number(e.target.value))}
                                    className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
                                >
                                    {boards.map(b => (
                                        <option key={b} value={b}>{boardLabel(b)}</option>
                                    ))}
                                </select>
                            </label>
                        ) : <span />}
                        <Button size="sm" disabled={!picked || adding} onClick={add}>
                            <Plus size={13} className="mr-1" />
                            {adding ? 'Adding…' : 'Add hidden'}
                        </Button>
                    </Group>
                </Stack>
            </DialogContent>
        </Dialog>
    );
});

export default AddSourceDialog;
