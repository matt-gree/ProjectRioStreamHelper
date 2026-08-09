import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
    ArrowLeftRight, ChevronRight, ChevronsUpDown, Check, Plus, Trash2, Trophy,
} from 'lucide-react';
import { useStateStore } from '../../../context/store';
import {
    createMatch, updateMatch, deleteMatch, bindScoreboard, loadStartGGSet,
    flipMatch, decideMatch,
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
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { notifications } from '../../../lib/notify';
import { cn } from '../../../lib/utils';
import { KIT_FIELD, FieldRow, KitColumn, KitColumns } from '../kit';
import { StagedDot } from '../controls';
import { useActiveBoards, useMatchBindableBoards } from '../boards';

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

/*
 * The desk's quiet field weight. Everything here used to be DB_FIELD — one
 * bordered, filled box repeated ~15 times — so the panel had no entry point:
 * the participant names (what the desk is FOR) carried exactly as much weight
 * as the controller port. QUIET_FIELD keeps the geometry and drops the fill,
 * so the fixture metadata recedes a tier and the two names read as the
 * subject. Nothing here changes what a control does — only how loudly it says
 * it. (The side loadouts dropped the shape entirely: they're one-touch boards
 * now, not fields.)
 */
const QUIET_FIELD = cn(KIT_FIELD, 'bg-transparent');

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

/*
 * The captain picker — a board of character icons, faster to scan and hit than
 * a scroll list. Keyboard: type a captain's first letter to select it;
 * repeating the same letter cycles through every captain that starts with it
 * (B → Birdo → Bowser → Bowser Jr, D → Daisy → Diddy → DK).
 *
 * It renders inline on the desk rather than inside a dropdown. There are only
 * twelve captains and a producer sets one every game, so a popover was a click
 * and a mode spent hiding a control that fits — the stage shows what it has
 * room to show (production-console-contract). Inline it also gives the sides
 * the height that used to be a void above the board chips.
 */
const CaptainGrid = memo(function CaptainGrid({
    value, onChange, autoFocus = false, iconSize = 34, className,
}) {
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
                    /* No tooltip. Twelve of them on one board fire constantly
                       as the pointer crosses to a target, and the portraits are
                       the recognisable thing — the name adds nothing a producer
                       needs. aria-label carries the name instead, since the
                       cell's only content is an alt="" image and dropping the
                       tooltip would otherwise leave it with no accessible name. */
                    <button
                        key={c}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        aria-label={c}
                        onClick={() => onChange(selected ? '' : c)}
                        className={cn(
                            // Fixed cell, not aspect-square: it has to match the
                            // port board's 24px so the two loadout boards stand
                            // exactly the same height. The pair has to clear a
                            // ~224px side at standard window width — 6×24 plus
                            // gaps is 164 of it.
                            'flex size-6 items-center justify-center rounded-md border transition-colors',
                            selected
                                ? 'border-primary bg-primary/15 ring-1 ring-primary'
                                : 'border-transparent hover:border-border hover:bg-muted/40',
                        )}
                    >
                        <CaptainIcon name={c} urls={urls} size={iconSize} />
                    </button>
                );
            })}
        </div>
    );
});

// Canonical Dolphin controller-port colours (P1 red, P2 blue, P3 yellow, P4
// green) — mirrors PORT_COLORS in the overlay mounts so the producer sees the
// same colour the broadcast will use.
const PORT_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];

/*
 * Controller port for a side — a 2×2 board of the four ports, one touch like
 * the captain grid beside it. Stored 0-indexed (matches the HUD's Away/Home
 * Port and the projected score.{N}.player.{T}.port).
 *
 * Each cell carries its port's broadcast colour, so the producer picks against
 * the same colour the overlay will draw. Clicking the selected port clears it,
 * exactly as the captain grid clears a captain — no separate "None" row.
 *
 * 2×2 is also what makes the mirrored loadout fit: this is ~60px where the
 * dropdown it replaced was ~90, which is the width the two sides were fighting
 * over across the spine.
 */
const PortGrid = memo(function PortGrid({ value, onChange, className }) {
    const idx = value === '' || value == null ? null : Number(value);
    return (
        <div role="listbox" aria-label="Controller port" className={cn('grid w-fit grid-cols-2 gap-1', className)}>
            {[0, 1, 2, 3].map((p) => {
                const selected = idx === p;
                return (
                    /* No tooltip — the digit already says which port it is, so
                       one would only restate the cell's own content. */
                    <button
                        key={p}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        aria-label={`Port ${p + 1}`}
                        onClick={() => onChange(selected ? null : p)}
                        style={{ color: PORT_COLORS[p] }}
                        className={cn(
                            'flex size-6 items-center justify-center rounded-md border text-[10px] font-semibold tabular-nums transition-colors',
                            selected
                                ? 'border-current ring-1 ring-current'
                                : 'border-transparent opacity-45 hover:border-border hover:opacity-100',
                        )}
                    >
                        {p + 1}
                    </button>
                );
            })}
        </div>
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

/*
 * One side of the draft, as a card standing where that side stands on the
 * broadcast: side 1 is the left card and labels itself LEFT, side 2 is the
 * right card and labels itself RIGHT, its eyebrow pushed to the outer edge.
 * Position is the identity everywhere else in PRSH (glossary: Side), so the
 * authoring surface says so too rather than making the producer decode "1".
 *
 * A staged pick carries a client-only _name display tag (the projection hasn't
 * resolved it yet), stripped by the commit PUT which only sends participantId
 * + rioName.
 */
const DraftSide = memo(function DraftSide({ m, side, draft, className }) {
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
        <Stack gap="sm" className={cn('min-w-0 flex-1', className)}>
            {/* No box. A side is a group of fields, exactly like the Fixture
                column beside it — boxing one and not the other made the same
                thing look like two different things. The heading carries the
                grouping, and its own alignment carries the position: side 1
                reads from the left edge, side 2 from the right.
                min-h-6 so these sit on the same baseline as the Fixture
                column's header: this pair IS the left region's label line
                (there is no "Who's playing" eyebrow above them any more), so
                both regions open with exactly one line of label. */}
            <Text
                span
                className={cn(
                    'label-display flex min-h-6 items-center text-[10px] text-foreground/80',
                    side === 2 && 'justify-end',
                )}
            >
                Side {side} · {side === 1 ? 'left' : 'right'}
            </Text>
            {/* No per-field labels here. Each control's placeholder IS its
                label ("Pick participant…", "Captain…", "Port"), so a caps label
                above it would be the same word twice — and once a value is set,
                a person's name, a character portrait and a coloured port chip
                identify themselves. The Fixture column keeps its labels because
                its placeholders are examples, not names. */}
            {/* The name is the headline. It gets the panel's only raised
                surface and its largest type, because it is the one thing on
                this desk a producer reads from across the room — and because
                everything under it (captain, port) only makes sense as that
                person's loadout. */}
            <Group gap="xs" className="flex-nowrap items-center">
                <StagedDot show={draft.isStaged(`player.${side}.pick`)} />
                <div className="min-w-0 flex-1">
                    <ParticipantPicker
                        value={name}
                        selectedId={selectedId}
                        onResolve={onPick}
                        placeholder="Pick participant…"
                        className={cn('h-10 rounded-md border-border/70 bg-muted/40 px-2.5 text-base',
                            name && 'font-semibold')}
                    />
                </div>
            </Group>
            {/* Loadout — two one-touch boards on a matched 24px cell, so they
                stand the same height and read as one row, centred under the
                name they belong to.

                Both sides run the same order rather than mirroring across the
                spine. The producer's question here is "are these two set up
                right", which is a vertical scan, and identical rows compare at
                a glance where mirrored ones have to be read twice.

                flex-wrap is the safety rail, not decoration: both boards are
                intrinsically sized and neither can shrink, so a narrow panel
                would otherwise overrun the column and collide with the other
                side's controls over the spine. Wrapping degrades to stacked
                instead of overlapping.

                Both get labels. Neither a strip of faces nor a square of
                coloured digits says what it sets — label what the value can't
                say for itself. */}
            <div className="flex flex-wrap items-start justify-center gap-2">
                <FieldRow
                    stacked
                    label="Captain"
                    staged={draft.isStaged(`player.${side}.captain`)}
                    className="shrink-0"
                >
                    <CaptainGrid
                        value={captain || ''}
                        onChange={(v) => draft.setField(`player.${side}.captain`, v,
                            `Match ${m} side ${side}: captain ${v || 'cleared'}`)}
                        iconSize={22}
                        className="shrink-0 grid-cols-6"
                    />
                </FieldRow>
                <FieldRow
                    stacked
                    label="Port"
                    staged={draft.isStaged(`player.${side}.port`)}
                    className="shrink-0"
                >
                    <PortGrid
                        value={port}
                        onChange={(v) => draft.setField(`player.${side}.port`, v,
                            `Match ${m} side ${side}: ${v == null ? 'port cleared' : `port P${v + 1}`}`)}
                        className="shrink-0"
                    />
                </FieldRow>
            </div>
        </Stack>
    );
});

/*
 * Format and series as one compact field: the Bo selector next to the running
 * score with its per-side steppers.
 *
 * Deliberately quiet. In MSB a series score is a number the producer corrects
 * once a game at most — post-game capture advances it on its own — so it reads
 * as fixture metadata alongside round and phase, not as the panel's headline.
 */
const FormatField = memo(function FormatField({ m, draft, bestOf }) {
    const series = draft.match?.series || {};
    const winsFor = (side) => {
        const live = series[side] ?? series[String(side)] ?? 0;
        return Number(draft.val(`series.${side}`, live)) || 0;
    };
    const bump = (side, delta) => {
        const next = Math.max(0, winsFor(side) + delta);
        draft.setField(`series.${side}`, next, `Match ${m}: side ${side} series → ${next}`);
    };
    const staged = draft.isStaged('series.1') || draft.isStaged('series.2');

    // A plain render helper, not a nested component: a component defined in
    // render gets a fresh identity each pass and remounts its subtree.
    const step = (side, delta, glyph) => (
        <button
            type="button"
            onClick={() => bump(side, delta)}
            aria-label={`Side ${side} ${delta > 0 ? '+1' : '-1'} game`}
            className="px-1 text-muted-foreground hover:text-foreground"
        >
            {glyph}
        </button>
    );

    return (
        <Group gap="xs" className="flex-nowrap items-center">
            <StagedDot show={draft.isStaged('format.bestOf')} />
            <select
                aria-label="Best of"
                value={String(bestOf)}
                onChange={(e) => draft.setField('format.bestOf', parseInt(e.target.value, 10),
                    `Match ${m}: Bo${e.target.value}`)}
                className={cn(QUIET_FIELD, 'w-[72px] shrink-0')}
            >
                {[1, 3, 5, 7].map(n => <option key={n} value={n}>Bo{n}</option>)}
            </select>
            <Group gap="none" className="h-8 flex-nowrap items-center rounded-md border border-border bg-transparent px-1">
                {step(1, -1, '–')}
                <Text
                    size="sm"
                    className={cn('font-mono tabular-nums', staged ? 'text-amber-400' : 'text-foreground')}
                >
                    {winsFor(1)}
                </Text>
                {step(1, 1, '+')}
                <Text size="xs" span className="mx-0.5 text-muted-foreground/60">:</Text>
                {step(2, -1, '–')}
                <Text
                    size="sm"
                    className={cn('font-mono tabular-nums', staged ? 'text-amber-400' : 'text-foreground')}
                >
                    {winsFor(2)}
                </Text>
                {step(2, 1, '+')}
            </Group>
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

/*
 * TWO DIFFERENT FACTS, and the difference is what the Decide and Reopen verbs
 * act on.
 *
 * `decidedSide` is the match's own `decided` flag — a RECORD, written by the
 * server's award arithmetic when a side reaches the win count, or forced by the
 * producer. It is what auto-retire and the overlays read.
 *
 * `clinchedSide` is arithmetic on the live series against the Bo need — a
 * DERIVED "someone is at the number". Normally the two agree, because crediting
 * a game sets the flag. They come apart when the producer corrects the series by
 * hand with the steppers: the count says 2–0 of Bo3 and the flag says nothing.
 *
 * These used to be one function, so the header badged "Side N wins" off either —
 * claiming a series the server had not recorded, with no way to tell which state
 * you were in and therefore no way to offer the verb that fixes it.
 */
function decidedSide(match) {
    const d = match?.decided;
    if (d === 1 || d === '1') return 1;
    if (d === 2 || d === '2') return 2;
    return null;
}

function clinchedSide(match) {
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
const MatchAccordion = memo(function MatchAccordion({ m, open, onToggle, active, boundMap, gameModes, canBind }) {
    const draft = useMatchDraft(m);
    const stage = draft.match?.stage || 'draft';
    const [confirmDel, setConfirmDel] = useState(false);
    const decided = decidedSide(draft.match);
    // Only interesting where it DISAGREES with the record: someone is at the win
    // count and nothing has recorded it, which is the producer's cue to decide.
    const clinched = decided ? null : clinchedSide(draft.match);

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
    /*
     * Flip the AUTHORED sides — the fixture was written down the wrong way round.
     * Distinct from a board's Swap sides, which flips one live game's orientation:
     * this rewrites the record, and the series wins travel with the player
     * (server flip_match), so a 2–0 does not silently become an 0–2.
     *
     * Broadcast-visible (it re-projects onto the bound board), so it stages. No
     * `liveValue` pair to collapse against — a flip is its own inverse, and
     * staging it twice is the producer asking for two flips, which the pending bar
     * shows as one entry they can discard.
     */
    const onFlip = () => stageOrRun({
        key: `match:${m}:flip`,
        label: `Match ${m}: flip sides`,
        value: true,
        run: () => flipMatch(Number(m)),
    });
    /*
     * The series record. `side` forces decided, null reopens.
     *
     * `liveValue` is the current flag, so deciding a match that is already decided
     * for that side drops out of the buffer, and staging Reopen then Decide leaves
     * nothing pending — the same toggle-twice rule every other staged control
     * follows.
     */
    const onDecide = (side) => stageOrRun({
        key: `match:${m}:decide`,
        label: side ? `Match ${m}: Side ${side} wins the series` : `Match ${m}: reopen the series`,
        value: side,
        liveValue: decided,
        run: () => decideMatch(Number(m), side),
    });
    const onDelete = () => {
        setConfirmDel(false);
        deleteMatch(Number(m))
            .catch(e => notifications.show({ message: `Delete match: ${e?.message || e}`, color: 'red' }));
    };
    /*
     * Board binding is radio-style: a match fills exactly one board. Clicking the
     * board it already holds clears it; clicking any other board MOVES it there.
     *
     * The move is ONE call. This used to loop the active boards unbinding the
     * siblings first, which put a data invariant in a click handler: under confirm
     * mode each unbind was a separately discardable staged entry, so committing
     * the bind without one of them left a match on two boards. `bind_scoreboard`
     * vacates the old holder itself now (server/api/v1/match.py), which is also
     * how every other caller inherits the rule.
     */
    const selectBoard = (sb) => {
        if (!canBind(sb)) return;
        const held = String(boundMap[sb]) === String(m);
        stageOrRun({
            key: `bind:${sb}`,
            label: held ? `Unbind board ${sb}` : `Bind board ${sb} → match ${m}`,
            value: held ? null : Number(m),
            liveValue: boundMap[sb] != null ? Number(boundMap[sb]) : null,
            run: () => bindScoreboard(sb, held ? null : Number(m)),
        });
    };

    const roundLabel = draft.val('label', draft.match?.label || '');
    const compPhase = draft.val('phase', draft.match?.phase || '');
    const gameMode = draft.val('gameMode', draft.match?.gameMode || '');
    const bestOf = draft.val('format.bestOf', (draft.match?.format || {}).bestOf ?? 1);
    const n1 = sideName(draft.match, 1);
    const n2 = sideName(draft.match, 2);
    // The collapsed line's fixture tail — what tells two matches between the
    // same two players apart. Round/phase/mode are all optional, so only the
    // ones that are set appear and a bare fixture collapses to just the names
    // rather than to a row of orphaned separators.
    const fixtureBits = [roundLabel, compPhase, gameMode].filter(Boolean);

    return (
        /* Open vs collapsed used to look identical, so a stack of matches gave
           no answer to "which one am I editing". The open match is the desk's
           subject: it keeps the card surface and takes a red edge — the same
           rio red the rack uses to mark the desk tier, reused as a
           you-are-here marker rather than a new colour. Collapsed peers drop
           to a hairline and step back. */
        <div className={cn(
            'overflow-hidden rounded-md border transition-colors',
            open
                ? 'border-border border-l-2 border-l-rio-500/70 bg-card'
                : 'border-border/50 hover:border-border',
        )}>
            {/* The header changes job with the disclosure, because its content
                does. COLLAPSED it is the record's identity, and identity is
                who is playing plus which fixture this is — names, then round ·
                phase · mode. OPEN, the body restates all of that inches below
                at three times the size, so the bar becomes a title bar: the
                match id (the M in `score.{N}.match = M`, which the body never
                shows), the stage, and the record-level actions. Given a job of
                its own it can also afford a real surface.

                Neither state carries format or series score. Bo and the running
                score are settings a producer configures once in the body, not
                facts they scan a stack of records for, and `0–0` on every row
                paid nothing for the width. `decided` still badges — a clinched
                set is a state worth interrupting for, unlike a live 0–0. */}
            <div className={cn(
                'flex items-center gap-2 px-2 py-1.5',
                open && 'border-b border-border bg-night-700/50',
            )}>
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
                    {open ? (
                        <span className="label-display min-w-0 truncate text-sm text-foreground">
                            Match {m}
                        </span>
                    ) : (
                        <span className="flex min-w-0 items-center gap-x-1.5 text-sm">
                            {/* Same words as the open title bar, a tier down:
                                the row's identity shouldn't rename itself on
                                toggle just to save four characters. */}
                            <span className="label-display shrink-0 text-xs text-muted-foreground/70">Match {m}</span>
                            <span className="shrink-0 truncate text-foreground/80">
                                {n1 || <span className="text-muted-foreground">TBD</span>}
                                <span className="mx-1.5 text-muted-foreground">vs</span>
                                {n2 || <span className="text-muted-foreground">TBD</span>}
                            </span>
                            {fixtureBits.length > 0 && (
                                <>
                                    <span className="shrink-0 text-muted-foreground">·</span>
                                    {/* The tail truncates first: names identify
                                        the match, the fixture only qualifies it. */}
                                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                                        {fixtureBits.join(' · ')}
                                    </span>
                                </>
                            )}
                        </span>
                    )}
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
                {/* THE SERIES VERB, next to the badge that states the series. At
                    most one of the two ever shows, because they answer opposite
                    states of one fact: a decided match can be reopened, and a
                    match sitting on the win count with nothing recorded can be
                    decided. The second case only arises from the steppers, which
                    is exactly why the panel that has the steppers needs the verb.

                    Both stage — deciding re-projects the series onto the bound
                    board, and a producer correcting a miscredit mid-game should not
                    have it hit air before they confirm. */}
                {decided ? (
                    <Button
                        size="xs" variant="ghost" onClick={() => onDecide(null)}
                        className="shrink-0 text-muted-foreground"
                        title="Reopen the series — undo the decided winner"
                    >
                        Reopen
                        <StagedDot show={draft.isStaged('decide')} />
                    </Button>
                ) : clinched ? (
                    <Button
                        size="xs" variant="secondary" onClick={() => onDecide(clinched)}
                        className="shrink-0"
                        title={`Record Side ${clinched} as the series winner`}
                    >
                        Decide: Side {clinched}
                        <StagedDot show={draft.isStaged('decide')} />
                    </Button>
                ) : null}
                {stage === 'post' && (
                    <Button size="xs" variant="secondary" onClick={onNextGame} className="shrink-0">
                        Next game
                    </Button>
                )}
                {/* Flip is icon-only and lives with the record actions rather than
                    on the two side fields it swaps. The sides grid puts its spine
                    behind an @lg breakpoint, so a control mounted there would
                    vanish on a narrow panel — and the feedback for a flip is the
                    collapsed row's own "A vs B", which is right here. */}
                <SimpleTooltip label="Flip the fixture's sides — series wins follow the player">
                    <button
                        type="button"
                        onClick={onFlip}
                        aria-label={`Flip sides on match ${m}`}
                        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                        <ArrowLeftRight size={14} />
                        <StagedDot show={draft.isStaged('flip')} />
                    </button>
                </SimpleTooltip>
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
                /* Two labelled regions, so the panel answers "what does this
                   area do" before the producer reads a single control. Who is
                   playing (and the running score) on the left, where it gets
                   its width; what the match IS — round, phase, mode, board —
                   on the right. One column on a narrow panel. */
                <div className="@container border-t border-border p-2.5">
                    {/* 7/4 rather than 3/2: the sides hold two intrinsically
                        sized boards that cannot shrink, so they need the width
                        budgeted to them, where the Fixture column is all
                        flexible fields that absorb whatever is left. */}
                    <KitColumns template="minmax(0,7fr) minmax(0,4fr)">
                        {/* The sides need two rows; the fixture needs four. The
                            board bind fills what's left rather than spanning
                            under a hole, which bottom-aligns the two columns. */}
                        <div className="flex min-w-0 flex-col gap-3">
                            {/* No region eyebrow. "Who's playing" over two
                                40px names split by a vs spine names what the
                                layout already says out loud — and stacking it
                                above the two side headings gave this region
                                three label lines to Fixture's one, which is
                                most of what read as clutter at the top of the
                                panel. The side headings serve as the region's
                                label line instead. Fixture keeps its eyebrow:
                                its contents are heterogeneous and it hosts the
                                start.gg action on that same line. */}
                            <KitColumn>
                                {/* The two sides used to sit in a plain 2-up
                                    grid separated by whitespace, which read as
                                    six independent fields rather than one
                                    matchup. The spine is the axis they mirror
                                    across, not a divider between peers — it
                                    states the versus relationship the collapsed
                                    header states in words, so the eye lands on
                                    "A vs B" before it parses any control. It
                                    collapses away with the columns. */}
                                <div className="grid grid-cols-1 gap-x-3 gap-y-4 @lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                                    <DraftSide m={m} side={1} draft={draft} />
                                    {/* pt-6 clears the side headings exactly, so
                                        the spine spans only the controls. The
                                        `vs` is pinned near the top rather than
                                        centred in the column: it belongs beside
                                        the two names it joins, and centring it
                                        would drift down the taller the captain
                                        grids make the sides. */}
                                    <div className="hidden self-stretch flex-col items-center gap-1.5 pt-6 @lg:flex">
                                        <span className="h-5 w-px bg-border/60" />
                                        <Text span className="label-display text-[10px] text-muted-foreground/70">vs</Text>
                                        <span className="w-px flex-1 bg-border/60" />
                                    </div>
                                    <DraftSide m={m} side={2} draft={draft} />
                                </div>
                            </KitColumn>

                            {/* Binding is the action that puts this fixture on
                                air, so it reads as a labelled field like the
                                ones opposite rather than a floating cluster of
                                buttons — the chips each say "Board", but none
                                of them said what picking one DOES. The label
                                supplies the grouping the hairline was doing.

                                It no longer bottom-aligns (`mt-auto`): that was
                                buying a level bottom edge with a hole above it
                                once the sides got shorter, and a ragged bottom
                                in a two-column panel reads as normal where a
                                void reads as broken. */}
                            <FieldRow stacked label="On board">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {active.map(sb => (
                                        <BindChip
                                            key={sb} sb={sb}
                                            bound={String(boundMap[sb]) === String(m)}
                                            elsewhere={boundMap[sb] != null && String(boundMap[sb]) !== String(m)}
                                            rotating={!canBind(sb)}
                                            radio
                                            onClick={() => selectBoard(sb)}
                                        />
                                    ))}
                                </div>
                            </FieldRow>
                        </div>

                        {/* Round + competition phase both project to the
                            lower-third's auto metadata line; a start.gg set
                            fills both, and these let the producer see and
                            override what it loaded. Loading a set fills this
                            whole column rather than being one more field in it,
                            so it rides the column header. */}
                        <KitColumn
                            label="Fixture"
                            // The one rule in the body, marking the one real
                            // boundary: two regions, not two peer groups.
                            className="@2xl:border-l @2xl:border-border/60 @2xl:pl-6"
                            action={(
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button size="xs" variant="secondary">
                                            <Trophy size={13} className="mr-1" /> Load a set…
                                            <StagedDot show={draft.isStaged('startgg')} />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent align="end" className="w-96">
                                        <StartggSetPicker onPick={onPickSet} pickLabel="Use" />
                                    </PopoverContent>
                                </Popover>
                            )}
                        >
                            {/* Round and Phase hold a handful of characters
                                each — pairing them stops two short values
                                claiming a full panel width apiece. */}
                            <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 @lg:grid-cols-2">
                                <FieldRow stacked label="Round" staged={draft.isStaged('label')}>
                                    <input
                                        type="text"
                                        aria-label="Round"
                                        value={roundLabel}
                                        onChange={(e) => draft.setField('label', e.target.value,
                                            `Match ${m}: round ${e.target.value || 'cleared'}`)}
                                        placeholder="e.g. Winners R2"
                                        className={cn(QUIET_FIELD, 'min-w-0 flex-1')}
                                    />
                                </FieldRow>
                                <FieldRow stacked label="Phase" staged={draft.isStaged('phase')}>
                                    <input
                                        type="text"
                                        aria-label="Competition phase"
                                        value={compPhase}
                                        onChange={(e) => draft.setField('phase', e.target.value,
                                            `Match ${m}: phase ${e.target.value || 'cleared'}`)}
                                        placeholder="e.g. Top Cut"
                                        className={cn(QUIET_FIELD, 'min-w-0 flex-1')}
                                    />
                                </FieldRow>
                            </div>
                            {/* Mode names can run long (a full tournament tag),
                                so it takes the row rather than sharing it. */}
                            <FieldRow stacked label="Mode" staged={draft.isStaged('gameMode')}>
                                <GameModeSelect
                                    value={gameMode || ''}
                                    modes={gameModes}
                                    onChange={(v) => draft.setField('gameMode', v,
                                        `Match ${m}: mode ${v || 'cleared'}`)}
                                    className={cn(QUIET_FIELD, 'min-w-0 flex-1')}
                                />
                            </FieldRow>
                            <FieldRow stacked label="Format">
                                <FormatField m={m} draft={draft} bestOf={bestOf} />
                            </FieldRow>
                        </KitColumn>
                    </KitColumns>
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
    const canBind = useMatchBindableBoards();
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
                            canBind={canBind}
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

/*
 * A board-bind chip, staged-aware (amber ring while the bind is pending). With
 * `radio`, it carries a radio dot (filled when this match holds the board) to
 * signal single-select — a match fills exactly one board. `elsewhere` = the
 * board is currently bound to a DIFFERENT match; the chip reads as a dashed
 * "steal it" affordance.
 *
 * `rotating` = the board is cycling a pool, so it has no fixed sides for a
 * fixture to project onto and the server would reject the bind. The chip goes
 * inert and says why, rather than letting the producer click into a 409 —
 * an unavailable option should look unavailable.
 */
const BindChip = memo(function BindChip({
    sb, bound, elsewhere = false, rotating = false, radio = false, onClick,
}) {
    const pending = usePending(`bind:${sb}`);
    const displayBound = pending ? pending.value != null : bound;
    /*
     * The bound chip's tip is the RETIRE affordance. The Match tab's panel had a
     * separate Retire button, because it unbound every board bound to this match
     * and there could be several. A match holds exactly one board now, so
     * retiring is unbinding the one chip that is lit — and the only thing missing
     * was a chip that said so.
     */
    const tip = rotating
        ? `Board ${sb} is rotating a pool — a match needs a single-game board`
        : displayBound
            ? `On board ${sb} — click to take it off and hand the board back to its feed`
            : elsewhere
                ? `Bound to another match — click to move board ${sb} here`
                : undefined;
    return (
        <SimpleTooltip label={tip}>
            <Button
                size="xs"
                variant={displayBound ? 'default' : 'outline'}
                onClick={onClick}
                // aria-disabled, not disabled: a disabled button emits no
                // pointer events, so the tooltip saying WHY it can't be picked
                // would never open. The click is guarded in selectBoard.
                aria-disabled={rotating || undefined}
                role={radio ? 'radio' : undefined}
                aria-checked={radio ? displayBound : undefined}
                className={cn(
                    'gap-1.5',
                    pending && 'ring-1 ring-amber-400',
                    !displayBound && elsewhere && 'border-dashed text-muted-foreground',
                    rotating && 'cursor-not-allowed opacity-40',
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
