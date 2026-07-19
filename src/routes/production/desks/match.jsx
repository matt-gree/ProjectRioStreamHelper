import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
    ChevronDown, ChevronRight, ChevronsUpDown, Check, Plus, X, Trash2, CircleDot,
} from 'lucide-react';
import { useStateStore } from '../../../context/store';
import {
    createMatch, updateMatch, deleteMatch, bindScoreboard, loadStartGGSet,
} from '../../../context/match';
import { useStagingStore, stageOrRun, usePending } from '../../../context/staging';
import ParticipantPicker from '../../../components/ParticipantPicker';
import StartggSetPicker from '../../../components/StartggSetPicker';
import {
    Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '../../../components/ui/command';
import { useAssetUrls } from '../../../lib/assets';
import { MSB_CAPTAINS } from '../../../data/msb';
import { Stack, Group, Text } from '../../../components/ui/primitives';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Switch } from '../../../components/ui/switch';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { notifications } from '../../../lib/notify';
import { cn } from '../../../lib/utils';
import { KIT_FIELD } from '../kit';
import { StagedDot } from '../controls';
import { useActiveBoards } from '../boards';

/*
 * Match desk — the console's fixture-authoring surface (the full authoring
 * panel still lives on the Match tab). A match projects onto its bound boards —
 * broadcast-visible — so every edit here routes through the staging gateway
 * (key `match:{m}:{path}`); the Match tab stays immediate like other full tabs.
 * Creating a match and lifecycle hops (Next game) are authoring/momentary and
 * run immediately.
 *
 * The accordion body is the contract's Custom block: dense fixture authoring
 * (captain grid, port swatches, series stepper) that the row kit deliberately
 * does not try to express.
 */

// 'player.1.captain' → { player: { 1: { captain: value } } } for the merge PUT.
function nestPath(path, value) {
    const out = {};
    let cur = out;
    const keys = path.split('.');
    for (let i = 0; i < keys.length - 1; i++) cur = (cur[keys[i]] = {});
    cur[keys[keys.length - 1]] = value;
    return out;
}

// match.{m} with staged-value display, mirroring useLowerThird: `val(path,
// live)` returns the pending value when one is staged; `setField` stages one
// field write whose commit is the merge PUT.
function useMatchDraft(m) {
    const match = useStateStore(s => s?.match?.[m]);
    const pendingMap = useStagingStore(s => s.pending);
    const val = (path, live) => {
        const p = pendingMap[`match:${m}:${path}`];
        return p ? p.value : live;
    };
    const isStaged = (path) => !!pendingMap[`match:${m}:${path}`];
    const setField = (path, value, label) => stageOrRun({
        key: `match:${m}:${path}`,
        label: label || `Match ${m}: ${path}`,
        value,
        run: () => updateMatch(m, nestPath(path, value)),
    });
    return { match, val, isStaged, setField };
}

const DB_FIELD = KIT_FIELD;

// Captain character icon, with a graceful fallback to initials when the image
// pack isn't installed (404). `size` in px for both the box and the image.
const CaptainIcon = memo(function CaptainIcon({ name, urls, size = 34 }) {
    const [broken, setBroken] = useState(false);
    if (broken) {
        const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2);
        return <span className="text-[10px] font-semibold leading-none text-muted-foreground">{initials}</span>;
    }
    return (
        <img
            src={urls.charIcon(name)} alt="" width={size} height={size}
            onError={() => setBroken(true)}
            className="object-contain"
            style={{ width: size, height: size }}
        />
    );
});

// The captain-picker grid — a 3×4 board of character icons, faster to scan and
// hit than a scroll list. Keyboard: type a captain's first letter to select it;
// repeating the same letter cycles through every captain that starts with it
// (B → Birdo → Bowser → Bowser Jr, D → Daisy → Diddy → DK). Lives inside the
// CaptainSelect dropdown; `autoFocus` grabs the keyboard when the popover opens.
const CaptainGrid = memo(function CaptainGrid({ value, onChange, autoFocus = false, className }) {
    const urls = useAssetUrls();
    const ref = useRef(null);
    useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

    const onKeyDown = (e) => {
        if (e.key.length !== 1 || !/[a-z]/i.test(e.key)) return;
        const letter = e.key.toUpperCase();
        const group = MSB_CAPTAINS.filter(c => c[0].toUpperCase() === letter);
        if (!group.length) return;
        e.preventDefault();
        const at = group.indexOf(value);
        onChange(at === -1 ? group[0] : group[(at + 1) % group.length]);
    };

    return (
        <div
            ref={ref}
            role="listbox"
            aria-label="Captain"
            tabIndex={0}
            onKeyDown={onKeyDown}
            className={cn('grid grid-cols-4 gap-1 outline-none', className)}
        >
            {MSB_CAPTAINS.map((c) => {
                const selected = value === c;
                return (
                    <SimpleTooltip key={c} label={c}>
                        <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() => onChange(selected ? '' : c)}
                            className={cn(
                                'flex aspect-square items-center justify-center rounded-md border transition-colors',
                                selected
                                    ? 'border-primary bg-primary/15 ring-1 ring-primary'
                                    : 'border-transparent hover:border-border hover:bg-muted/40',
                            )}
                        >
                            <CaptainIcon name={c} urls={urls} />
                        </button>
                    </SimpleTooltip>
                );
            })}
        </div>
    );
});

// Captain dropdown: a standard select-style trigger (chosen icon + name) that
// opens a popover containing the icon grid. Picking closes it.
const CaptainSelect = memo(function CaptainSelect({ value, onChange, className }) {
    const [open, setOpen] = useState(false);
    const urls = useAssetUrls();
    const pick = (c) => { onChange(c); setOpen(false); };
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(DB_FIELD, 'flex items-center justify-between gap-1.5',
                        !value && 'text-muted-foreground', className)}
                >
                    <span className="flex min-w-0 items-center gap-1.5">
                        {value && <CaptainIcon name={value} urls={urls} size={18} />}
                        <span className="truncate">{value || 'Captain…'}</span>
                    </span>
                    <ChevronDown className="size-3.5 shrink-0 opacity-50" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-2">
                <CaptainGrid value={value} onChange={pick} autoFocus className="w-[184px]" />
            </PopoverContent>
        </Popover>
    );
});

// Canonical Dolphin controller-port colours (P1 red, P2 blue, P3 yellow, P4
// green) — mirrors PORT_COLORS in the overlay mounts so the producer sees the
// same colour the broadcast will use.
const PORT_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];

// Controller-port dropdown for a side. Stored 0-indexed (matches the HUD's
// Away/Home Port and the projected score.{N}.player.{T}.port); shown as P1–P4
// with the port's broadcast colour. Native <option> can't render a swatch, so
// this is a small Popover.
const PortSelect = memo(function PortSelect({ value, onChange, className }) {
    const [open, setOpen] = useState(false);
    const idx = value === '' || value == null ? null : Number(value);
    const dot = (i) => (
        <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: PORT_COLORS[i] }} />
    );
    const choose = (v) => { onChange(v); setOpen(false); };
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label="Controller port"
                    className={cn(DB_FIELD, 'flex items-center gap-1.5', idx == null && 'text-muted-foreground', className)}
                >
                    {idx == null ? <span>Port</span> : <>{dot(idx)}<span>P{idx + 1}</span></>}
                    <ChevronDown className="size-3.5 shrink-0 opacity-50" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-28 p-1">
                <Stack gap="none">
                    <button
                        type="button"
                        onClick={() => choose(null)}
                        className={cn('flex items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted/50',
                            idx == null && 'text-foreground')}
                    >
                        <span className="size-2.5 shrink-0" />
                        <span className="text-muted-foreground">None</span>
                    </button>
                    {[0, 1, 2, 3].map(p => (
                        <button
                            key={p}
                            type="button"
                            onClick={() => choose(p)}
                            className={cn('flex items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted/50',
                                idx === p && 'bg-muted/40')}
                        >
                            {dot(p)}
                            <span>P{p + 1}</span>
                            {idx === p && <Check className="ml-auto size-3.5" />}
                        </button>
                    ))}
                </Stack>
            </PopoverContent>
        </Popover>
    );
});

// Searchable game-mode combobox (Popover + Command). Flex-fills the settings
// row; the value is the raw game-mode name (empty = unset).
const GameModeSelect = memo(function GameModeSelect({ value, modes, onChange, className }) {
    const [open, setOpen] = useState(false);
    const choose = (v) => { onChange(v); setOpen(false); };
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(DB_FIELD, 'flex items-center justify-between gap-1.5',
                        !value && 'text-muted-foreground', className)}
                >
                    <span className="truncate">{value || 'Game mode…'}</span>
                    <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-52 p-0">
                <Command>
                    <CommandInput placeholder="Search modes…" />
                    <CommandList>
                        <CommandEmpty>No mode.</CommandEmpty>
                        <CommandGroup>
                            <CommandItem value="__none__" onSelect={() => choose('')}>
                                <span className="text-muted-foreground">None</span>
                                <Check className={cn('ml-auto size-4', !value ? 'opacity-100' : 'opacity-0')} />
                            </CommandItem>
                            {modes.map(g => (
                                <CommandItem key={g} value={g} onSelect={() => choose(g)}>
                                    <span className="truncate">{g}</span>
                                    <Check className={cn('ml-auto size-4', value === g ? 'opacity-100' : 'opacity-0')} />
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
});

// One side of the draft: participant pick + captain, one row. A staged pick
// carries a client-only _name display tag (the projection hasn't resolved it
// yet), stripped by the commit PUT which only sends participantId + rioName.
const DraftSide = memo(function DraftSide({ m, side, draft }) {
    const live = draft.match?.player?.[side] ?? draft.match?.player?.[String(side)] ?? {};
    const pick = draft.val(`player.${side}.pick`, null);
    const name = pick ? (pick._name || pick.rioName) : (live.rioName || '');
    const selectedId = pick ? pick.participantId : (live.participantId || null);
    const captain = draft.val(`player.${side}.captain`, live.captain || '');
    const port = draft.val(`player.${side}.port`, live.port ?? null);

    const onPick = (row) => {
        const rioName = row.identities?.rioName || '';
        const display = row.display?.tag || rioName || 'participant';
        stageOrRun({
            key: `match:${m}:player.${side}.pick`,
            label: `Match ${m} side ${side}: ${display}`,
            value: { participantId: row.id, rioName, _name: display },
            run: () => updateMatch(m, { player: { [side]: { participantId: row.id, rioName } } }),
        });
    };

    return (
        <Stack gap="xs" className="min-w-0 flex-1">
            <Group gap="xs" className="min-w-0 flex-nowrap items-center">
                <StagedDot show={draft.isStaged(`player.${side}.pick`)} />
                <div className="min-w-0 flex-1">
                    <ParticipantPicker
                        value={name}
                        selectedId={selectedId}
                        onResolve={onPick}
                        placeholder="Pick participant…"
                    />
                </div>
            </Group>
            <Group gap="xs" className="flex-nowrap items-center">
                <StagedDot show={draft.isStaged(`player.${side}.captain`)} />
                <CaptainSelect
                    value={captain || ''}
                    onChange={(v) => draft.setField(`player.${side}.captain`, v,
                        `Match ${m} side ${side}: captain ${v || 'cleared'}`)}
                    className="min-w-0 flex-1"
                />
                <StagedDot show={draft.isStaged(`player.${side}.port`)} />
                <PortSelect
                    value={port}
                    onChange={(v) => draft.setField(`player.${side}.port`, v,
                        `Match ${m} side ${side}: ${v == null ? 'port cleared' : `port P${v + 1}`}`)}
                />
            </Group>
        </Stack>
    );
});

// Series wins as "n – n" with per-side steppers (staged). Post-game capture
// advances this automatically; the steppers are the producer's correction.
const SeriesControl = memo(function SeriesControl({ m, draft }) {
    const series = draft.match?.series || {};
    const bestOf = (draft.match?.format || {}).bestOf ?? 1;
    const winsFor = (side) => {
        const live = series[side] ?? series[String(side)] ?? 0;
        return Number(draft.val(`series.${side}`, live)) || 0;
    };
    const bump = (side, delta) => {
        const next = Math.max(0, winsFor(side) + delta);
        draft.setField(`series.${side}`, next, `Match ${m}: side ${side} series → ${next}`);
    };
    const staged = draft.isStaged('series.1') || draft.isStaged('series.2');

    const Step = ({ side, delta, children }) => (
        <button
            type="button"
            onClick={() => bump(side, delta)}
            className="px-1 text-muted-foreground hover:text-foreground"
            aria-label={`Side ${side} ${delta > 0 ? '+1' : '-1'} game`}
        >
            {children}
        </button>
    );

    return (
        <Group gap="none" className="items-center rounded-md border border-border bg-card px-1.5 py-1">
            <Text size="xs" className="mr-1 text-muted-foreground">Series</Text>
            <Step side={1} delta={-1}>–</Step>
            <Text size="sm" className="font-mono tabular-nums text-foreground">{winsFor(1)}</Text>
            <Step side={1} delta={1}>+</Step>
            <Text size="xs" className="mx-0.5 text-muted-foreground">:</Text>
            <Step side={2} delta={-1}>–</Step>
            <Text size="sm" className="font-mono tabular-nums text-foreground">{winsFor(2)}</Text>
            <Step side={2} delta={1}>+</Step>
            <StagedDot show={staged} />
        </Group>
    );
});

const DRAFT_STAGE_BADGE = {
    draft: 'bg-[#a855f7]/15 text-[#c084fc]',
    live:  'bg-emerald-500/15 text-emerald-300',
    post:  'bg-[#64748b]/15 text-[#94a3b8]',
};

// Human name for a side in the collapsed summary, falling back to a muted dash.
function sideName(match, side) {
    const p = match?.player?.[side] ?? match?.player?.[String(side)] ?? {};
    return p.rioName || '';
}

// The series-decided winner side (1|2) or null — the match's own `decided` flag
// when set (server arithmetic / producer force), else computed from the live
// series wins vs the Bo need. Drives the "Side N wins" badge in the header.
function clinchedSide(match) {
    const d = match?.decided;
    if (d === 1 || d === '1') return 1;
    if (d === 2 || d === '2') return 2;
    const bestOf = (match?.format || {}).bestOf ?? 1;
    const need = Math.floor(bestOf / 2) + 1;
    const w1 = Number(match?.series?.[1] ?? match?.series?.['1'] ?? 0);
    const w2 = Number(match?.series?.[2] ?? match?.series?.['2'] ?? 0);
    return w1 >= need ? 1 : w2 >= need ? 2 : null;
}

// One match, rendered as a collapsible accordion inside the Match card.
// Collapsed: a one-line summary — "A vs B · Bo3 · 1–0 · ‹stage›" (no side
// numbers; position is the identity). Expanded: the full condensed editor —
// start.gg + phase, the two sides (participant + captain grid), then mode / Bo /
// series / board binds. Every broadcast-visible edit routes through the staging
// gateway; New / Next game / Delete are momentary. Deletable via the header
// trash (a two-step Popover confirm, no blocking browser dialog).
const MatchAccordion = memo(function MatchAccordion({ m, open, onToggle, active, boundMap, gameModes }) {
    const draft = useMatchDraft(m);
    const stage = draft.match?.stage || 'draft';
    const [confirmDel, setConfirmDel] = useState(false);

    const onPickSet = (s) => stageOrRun({
        key: `match:${m}:startgg`,
        label: `Load set: ${s.p1_name || 'TBD'} vs ${s.p2_name || 'TBD'}`,
        value: s.id,
        run: () => loadStartGGSet(Number(m), s.id),
    });
    const onNextGame = () => {
        updateMatch(Number(m), { stage: 'draft' })
            .catch(e => notifications.show({ message: `Next game: ${e?.message || e}`, color: 'red' }));
    };
    const onDelete = () => {
        setConfirmDel(false);
        deleteMatch(Number(m))
            .catch(e => notifications.show({ message: `Delete match: ${e?.message || e}`, color: 'red' }));
    };
    // Board binding is radio-style: a match fills exactly one board. Selecting a
    // board unbinds any OTHER board this match currently holds (score.{N}.match
    // is single-valued, so binding here already steals the board from whatever
    // match had it); clicking the selected board again clears it.
    const unbind = (sb) => stageOrRun({
        key: `bind:${sb}`,
        label: `Unbind board ${sb}`,
        value: null,
        liveValue: boundMap[sb] != null ? Number(boundMap[sb]) : null,
        run: () => bindScoreboard(sb, null),
    });
    const selectBoard = (sb) => {
        if (String(boundMap[sb]) === String(m)) { unbind(sb); return; }
        for (const other of active) {
            if (other !== sb && String(boundMap[other]) === String(m)) unbind(other);
        }
        stageOrRun({
            key: `bind:${sb}`,
            label: `Bind board ${sb} → match ${m}`,
            value: Number(m),
            liveValue: boundMap[sb] != null ? Number(boundMap[sb]) : null,
            run: () => bindScoreboard(sb, Number(m)),
        });
    };

    const roundLabel = draft.val('label', draft.match?.label || '');
    const compPhase = draft.val('phase', draft.match?.phase || '');
    const gameMode = draft.val('gameMode', draft.match?.gameMode || '');
    const bestOf = draft.val('format.bestOf', (draft.match?.format || {}).bestOf ?? 1);
    const w1 = draft.match?.series?.[1] ?? draft.match?.series?.['1'] ?? 0;
    const w2 = draft.match?.series?.[2] ?? draft.match?.series?.['2'] ?? 0;
    const n1 = sideName(draft.match, 1);
    const n2 = sideName(draft.match, 2);
    const decided = clinchedSide(draft.match);

    return (
        <div className="overflow-hidden rounded-md border border-border">
            {/* Header row — summary is the toggle; stage badge + delete sit beside it. */}
            <div className="flex items-center gap-2 bg-muted/20 px-2 py-1.5">
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                    <ChevronRight
                        size={14}
                        className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
                    />
                    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm">
                        <span className="min-w-0 truncate text-foreground">
                            {n1 || <span className="text-muted-foreground">TBD</span>}
                            <span className="mx-1.5 text-muted-foreground">vs</span>
                            {n2 || <span className="text-muted-foreground">TBD</span>}
                        </span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">Bo{bestOf}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="font-mono text-xs tabular-nums text-foreground">{w1}–{w2}</span>
                    </span>
                </button>
                {decided && (
                    <Badge className="shrink-0 bg-emerald-500/15 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                        Side {decided} wins
                    </Badge>
                )}
                <Badge className={cn('shrink-0 text-[10px] font-semibold uppercase tracking-wider',
                    DRAFT_STAGE_BADGE[stage] || DRAFT_STAGE_BADGE.draft)}>
                    {stage}
                </Badge>
                {stage === 'post' && (
                    <Button size="xs" variant="secondary" onClick={onNextGame} className="shrink-0">
                        Next game
                    </Button>
                )}
                <Popover open={confirmDel} onOpenChange={setConfirmDel}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            aria-label={`Delete match ${m}`}
                            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                            <Trash2 size={14} />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-56">
                        <Stack gap="xs">
                            <Text size="sm" className="text-foreground">Delete this match?</Text>
                            <Text size="xs" className="text-muted-foreground">
                                Unbinds and blanks any boards it fills.
                            </Text>
                            <Group gap="xs" className="justify-end">
                                <Button size="xs" variant="ghost" onClick={() => setConfirmDel(false)}>Cancel</Button>
                                <Button size="xs" variant="destructive" onClick={onDelete}>Delete</Button>
                            </Group>
                        </Stack>
                    </PopoverContent>
                </Popover>
            </div>

            {open && (
                <div className="border-t border-border p-2.5">
                    <Stack gap="sm">
                        {/* start.gg load + round label. Round + competition phase
                            both project to the lower-third's auto metadata line;
                            a start.gg set fills both, and these let the producer
                            see/override what will load. */}
                        <Group gap="xs" className="flex-nowrap items-center">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button size="xs" variant="secondary" className="shrink-0">
                                        <Trophy size={13} className="mr-1" /> start.gg
                                        <StagedDot show={draft.isStaged('startgg')} />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-96">
                                    <StartggSetPicker onPick={onPickSet} pickLabel="Use" />
                                </PopoverContent>
                            </Popover>
                            <StagedDot show={draft.isStaged('label')} />
                            <input
                                type="text"
                                value={roundLabel}
                                onChange={(e) => draft.setField('label', e.target.value,
                                    `Match ${m}: round ${e.target.value || 'cleared'}`)}
                                placeholder="Round (e.g. Winners R2)…"
                                className={cn(DB_FIELD, 'min-w-0 flex-1')}
                            />
                        </Group>
                        <Group gap="xs" className="flex-nowrap items-center">
                            <StagedDot show={draft.isStaged('phase')} />
                            <input
                                type="text"
                                value={compPhase}
                                onChange={(e) => draft.setField('phase', e.target.value,
                                    `Match ${m}: phase ${e.target.value || 'cleared'}`)}
                                placeholder="Competition phase (e.g. Top Cut)…"
                                className={cn(DB_FIELD, 'min-w-0 flex-1')}
                            />
                        </Group>

                        {/* The two sides, side-by-side. Position is the identity — no numbers. */}
                        <Group gap="sm" className="flex-nowrap items-start">
                            <DraftSide m={m} side={1} draft={draft} />
                            <Text size="xs" className="mt-2 shrink-0 text-muted-foreground">vs</Text>
                            <DraftSide m={m} side={2} draft={draft} />
                        </Group>

                        {/* Game mode fills the width left by Best-of + Series. */}
                        <Group gap="sm" className="flex-nowrap items-center">
                            <StagedDot show={draft.isStaged('gameMode')} />
                            <GameModeSelect
                                value={gameMode || ''}
                                modes={gameModes}
                                onChange={(v) => draft.setField('gameMode', v,
                                    `Match ${m}: mode ${v || 'cleared'}`)}
                                className="min-w-0 flex-1"
                            />
                            <Group gap="xs" className="shrink-0 items-center">
                                <StagedDot show={draft.isStaged('format.bestOf')} />
                                <select
                                    value={String(bestOf)}
                                    onChange={(e) => draft.setField('format.bestOf', parseInt(e.target.value, 10),
                                        `Match ${m}: Bo${e.target.value}`)}
                                    className={cn(DB_FIELD, 'w-[76px]')}
                                >
                                    {[1, 3, 5, 7].map(n => <option key={n} value={n}>Bo{n}</option>)}
                                </select>
                            </Group>
                            <SeriesControl m={m} draft={draft} />
                        </Group>

                        <Group gap="xs" className="items-center">
                            <Text size="xs" className="text-muted-foreground">Board</Text>
                            {active.map(sb => (
                                <BindChip
                                    key={sb} sb={sb}
                                    bound={String(boundMap[sb]) === String(m)}
                                    elsewhere={boundMap[sb] != null && String(boundMap[sb]) !== String(m)}
                                    radio
                                    onClick={() => selectBoard(sb)}
                                />
                            ))}
                        </Group>
                    </Stack>
                </div>
            )}
        </div>
    );
});

// The Match card — the Draft-phase authoring surface, rendered as its own
// half-width element window. Holds a stack of match accordions (one per match)
// and a New-match button; a match binds to at most one board (score.{N}.match
// is a single value — rebinding a board moves it), so a board bound elsewhere
// shows on other matches as a muted "on board N" chip you can steal.
export default function MatchDesk() {
    const matches = useStateStore(useShallow(s => s?.match ?? {}));
    const active = useActiveBoards();
    const boundMap = useStateStore(useShallow(s => {
        const out = {};
        for (const sb of active) out[sb] = s?.score?.[sb]?.match ?? s?.score?.[String(sb)]?.match ?? null;
        return out;
    }));
    const [gameModes, setGameModes] = useState([]);
    const [creating, setCreating] = useState(false);
    // Single-open accordion. `null` means "default to newest"; '' means the user
    // explicitly collapsed everything; else the open match id.
    const [openId, setOpenId] = useState(null);

    useEffect(() => {
        fetch('/api/v1/rio/game-modes')
            .then(r => r.json())
            .then(data => setGameModes(Object.keys(data)))
            .catch(() => {});
    }, []);

    const ids = useMemo(
        () => Object.keys(matches).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b)),
        [matches],
    );
    const newestId = ids[ids.length - 1] || null;
    const effectiveOpen = openId === null ? newestId : (openId || null);

    const onNew = async () => {
        setCreating(true);
        try {
            const { id } = await createMatch();
            setOpenId(String(id));
        } catch (e) {
            notifications.show({ message: `New match: ${e?.message || e}`, color: 'red' });
        } finally { setCreating(false); }
    };

    // The panel frame (chip · title · meta) comes from PanelShell on the stage.
    return (
        <>
            {ids.length === 0 ? (
                <Stack gap="sm" className="items-start">
                    <Text size="sm" className="text-muted-foreground">
                        No matches yet. Create one to author the fixture — participants, captains,
                        bracket phase, mode and format — then bind it to a board to project it onto
                        the broadcast.
                    </Text>
                    <Button size="xs" variant="outline" disabled={creating} onClick={onNew}>
                        <Plus size={13} className="mr-1" /> New match
                    </Button>
                </Stack>
            ) : (
                <Stack gap="xs">
                    {ids.map(id => (
                        <MatchAccordion
                            key={id}
                            m={id}
                            open={effectiveOpen === id}
                            onToggle={() => setOpenId(effectiveOpen === id ? '' : id)}
                            active={active}
                            boundMap={boundMap}
                            gameModes={gameModes}
                        />
                    ))}
                    <Button size="xs" variant="outline" disabled={creating} onClick={onNew} className="self-start">
                        <Plus size={13} className="mr-1" /> New match
                    </Button>
                </Stack>
            )}
        </>
    );
}

// A board-bind chip, staged-aware (amber ring while the bind is pending). With
// `radio`, it carries a radio dot (filled when this match holds the board) to
// signal single-select — a match fills exactly one board. `elsewhere` = the
// board is currently bound to a DIFFERENT match; the chip reads as a dashed
// "steal it" affordance.
const BindChip = memo(function BindChip({ sb, bound, elsewhere = false, radio = false, onClick }) {
    const pending = usePending(`bind:${sb}`);
    const displayBound = pending ? pending.value != null : bound;
    return (
        <SimpleTooltip label={elsewhere && !displayBound ? `Bound to another match — click to move board ${sb} here` : undefined}>
            <Button
                size="xs"
                variant={displayBound ? 'default' : 'outline'}
                onClick={onClick}
                role={radio ? 'radio' : undefined}
                aria-checked={radio ? displayBound : undefined}
                className={cn(
                    'gap-1.5',
                    pending && 'ring-1 ring-amber-400',
                    !displayBound && elsewhere && 'border-dashed text-muted-foreground',
                )}
            >
                {radio && (
                    <span className={cn(
                        'inline-flex size-3 shrink-0 items-center justify-center rounded-full border',
                        displayBound ? 'border-current' : 'border-muted-foreground/60',
                    )}>
                        {displayBound && <span className="size-1.5 rounded-full bg-current" />}
                    </span>
                )}
                Board {sb}
            </Button>
        </SimpleTooltip>
    );
});
