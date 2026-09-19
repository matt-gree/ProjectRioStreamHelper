import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
    ArrowLeftRight, ChevronRight, ChevronsUpDown, Check, ListOrdered, ListPlus, Plus,
    Trash2, Trophy,
} from 'lucide-react';
import { useSettingsStore, useStateStore } from '../../../context/store';
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
import { usePortColors } from '../../layouts/designPackage';
import { MSB_CAPTAINS } from '../../../data/msb';
import { Stack, Group, Text } from '../../../components/ui/primitives';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { notifications } from '../../../lib/notify';
import { cn } from '../../../lib/utils';
import { FORMATS, formatLabel, gamesToWin, matchComplete } from '../../../../public/layout/lib/match-format.js';
import { GameStageChip, KIT_FIELD, FieldRow, KitColumn, KitColumns } from '../kit';
import { StagedDot, MoveButtons } from '../controls';
import { useActiveBoards, useBoardLifecycle, useMatchBindableBoards } from '../boards';
import { useSideLabels } from '../sides';
import { useNextInOrder, useQueueOrder, useQueues, useWaitingCount, useWaitingReason } from '../queue';
import { useGameModes } from '../gamemodes';
import {
    queueMatch, unqueueMatch, moveQueuedMatch,
    createQueue, renameQueue, deleteQueue, moveQueue,
} from '../../../context/schedule';

/*
 * Match desk — the console's fixture-authoring surface, and the ONLY one. The
 * Match tab (its stack of fully-expanded MatchPanel cards) is deleted, so there
 * is no second place these controls live. A match projects onto the board it is
 * bound to — broadcast-visible — so every edit here routes through the staging
 * gateway (key `match:{m}:{path}`). Creating a match and lifecycle hops (Next
 * game) are authoring/momentary and run immediately.
 *
 * The accordion body is the contract's Custom block: dense fixture authoring
 * (captain grid, port swatches, series stepper) that the row kit deliberately
 * does not try to express.
 */

/*
 * Every write on this desk is fire-and-forget, so each one needs a rejection
 * handler: a failed reorder or rename is otherwise an unhandled promise and a
 * control that looks like it did nothing. `.catch(failed('Running order'))`.
 */
const failed = (label) => (e) => notifications.show({
    message: `${label}: ${e?.message || e}`, color: 'red',
});

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

/*
 * Controller port for a side — a 2×2 board of the four ports, one touch like
 * the captain grid beside it. Stored 0-indexed (matches the HUD's Away/Home
 * Port and the projected score.{N}.player.{T}.port).
 *
 * Each cell carries its port's broadcast colour — the RESOLVED one (Design tab
 * → Controller Ports, under it the active package's own palette), not a copy of
 * the stock four, so the producer picks against the colour the overlay will
 * actually draw under whatever package is loaded. Clicking the selected port
 * clears it, exactly as the captain grid clears a captain — no separate "None"
 * row.
 *
 * 2×2 is also what makes the mirrored loadout fit: this is ~60px where the
 * dropdown it replaced was ~90, which is the width the two sides were fighting
 * over across the spine.
 */
const PortGrid = memo(function PortGrid({ value, onChange, className }) {
    const idx = value === '' || value == null ? null : Number(value);
    const ports = usePortColors();
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
                        style={{ color: ports[p].color }}
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

/*
 * Searchable game-mode combobox (Popover + Command). Flex-fills the settings
 * row; the value is the raw game-mode name (empty = unset).
 *
 * `modes` is the two-tier catalogue (../gamemodes): this season's modes first,
 * ended ones under their own heading. A fixture is often authored for a season
 * that has closed — and the mode it carries is projected onto the board it binds
 * to — so the active list alone could not name half of them.
 */
const GameModeSelect = memo(function GameModeSelect({ value, modes, onChange, className }) {
    const [open, setOpen] = useState(false);
    const choose = (v) => { onChange(v); setOpen(false); };
    // Group name -> items, in first-appearance order (an ungrouped list stays
    // one unheaded section).
    const sections = [];
    for (const m of modes) {
        const item = typeof m === 'string' ? { value: m, label: m, group: null } : m;
        const section = sections.find(s => s.name === (item.group ?? null));
        if (section) section.items.push(item);
        else sections.push({ name: item.group ?? null, items: [item] });
    }
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
                        </CommandGroup>
                        {sections.map(section => (
                            <CommandGroup key={section.name ?? '__all__'} heading={section.name ?? undefined}>
                                {section.items.map(item => (
                                    <CommandItem key={item.value} value={item.value} onSelect={() => choose(item.value)}>
                                        <span className="truncate">{item.label}</span>
                                        <Check className={cn('ml-auto size-4', value === item.value ? 'opacity-100' : 'opacity-0')} />
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
});

/*
 * One side of the draft, as a card standing where that side stands on the
 * broadcast: side 1 on one edge, side 2 on the other with its eyebrow pushed
 * outward, so the pair is read the way the scene is.
 *
 * The card's POSITION carries the arrangement; the eyebrow names the side in
 * whatever vocabulary the producer chose (../sides). It used to say "Side 1 ·
 * left" outright, which spelt one fact twice and made the second spelling wrong
 * for anyone whose sides aren't side by side.
 *
 * A staged pick carries a client-only _name display tag (the projection hasn't
 * resolved it yet), stripped by the commit PUT which only sends participantId
 * + rioName.
 */
const DraftSide = memo(function DraftSide({ m, side, draft, className }) {
    const sides = useSideLabels();
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
                {sides.label(side)}
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
    /*
     * A SERIES NEVER HOLDS MORE GAMES THAN ITS FORMAT ALLOWS, so the ceiling on
     * one side is whatever the other side has left of the format. The steppers
     * are the only surface that writes the series by hand — capture arithmetic
     * is the server's — and an uncapped pair let a doubleheader be typed to 2-1:
     * three games in a two-game fixture, on a count a bound board puts on air.
     * `PUT /match/{m}` refuses the same write (`_check_series_fits`), so the rule
     * is the record's; this is what stops the producer reaching a refusal.
     */
    const cap = (side) => Math.max(0, (Number(bestOf) || 1) - winsFor(side === 1 ? 2 : 1));
    const atCap = (side) => winsFor(side) >= cap(side);
    const bump = (side, delta) => {
        const cur = winsFor(side);
        // NEVER CLAMP DOWN. Lowering `bestOf` under a longer series leaves both
        // sides over the ceiling (a Bo3 at 2-1 set back to a Bo1), and there a
        // clamping `+` would answer a press meant to ADD a game by deleting two.
        // Out of room is a press that does nothing; the `–` still corrects.
        if (delta > 0 && cur + delta > cap(side)) return;
        const next = Math.max(0, cur + delta);
        if (next === cur) return;
        draft.setField(`series.${side}`, next, `Match ${m}: side ${side} series → ${next}`);
    };
    const staged = draft.isStaged('series.1') || draft.isStaged('series.2');

    // A plain render helper, not a nested component: a component defined in
    // render gets a fresh identity each pass and remounts its subtree.
    const step = (side, delta, glyph) => {
        const spent = delta > 0 ? atCap(side) : winsFor(side) <= 0;
        return (
            <button
                type="button"
                onClick={() => bump(side, delta)}
                disabled={spent}
                aria-label={`Side ${side} ${delta > 0 ? '+1' : '-1'} game`}
                title={delta > 0 && spent
                    ? `All ${Number(bestOf) || 1} games of this format are accounted for`
                    : undefined}
                className={cn(
                    'px-1 text-muted-foreground',
                    spent ? 'cursor-default opacity-30' : 'hover:text-foreground',
                )}
            >
                {glyph}
            </button>
        );
    };

    return (
        <Group gap="xs" className="flex-nowrap items-center">
            <StagedDot show={draft.isStaged('format.bestOf')} />
            {/* A DOUBLEHEADER IS A FORMAT, NOT A SECOND FIXTURE TYPE — `bestOf: 2`,
                which the clinch majority (`bestOf // 2 + 1`) already reads as
                "win both", so a sweep decides it and a 1-1 split correctly never
                does. Only the NAME is new: "Bo2" is the arithmetic's word for a
                thing that cannot exist, so no surface prints it (../format
                labels every one of them). It is offered second because a
                doubleheader is the common repeat — far more common here than a
                Bo3 — and a longer series is the rarity after it. */}
            <select
                aria-label="Format"
                value={String(bestOf)}
                onChange={(e) => draft.setField('format.bestOf', parseInt(e.target.value, 10),
                    `Match ${m}: ${formatLabel(e.target.value) || 'Bo1'}`)}
                className={cn(QUIET_FIELD, 'w-[72px] shrink-0')}
            >
                {FORMATS.map(n => (
                    <option key={n} value={n}>{formatLabel(n) || 'Bo1'}</option>
                ))}
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

/*
 * THE HEADER WEARS ITS BADGE'S COLOUR. A stack of fixtures is
 * scanned for state before it is read for names, and a 10px chip at the far end
 * of each row made that scan a hunt; the row itself carries the hue now, so a
 * night reads as a column of colours. Keyed by the ONE badge a row shows —
 * decided and split outrank the stage exactly as they replace its badge — so the
 * tint and the chip cannot disagree. The chip carries the same /15 over it, so it
 * still reads a step louder, as the thing to press.
 */
const HEADER_TINT = {
    draft:   'bg-[#a855f7]/15',
    live:    'bg-emerald-500/15',
    post:    'bg-[#64748b]/15',
    decided: 'bg-emerald-500/15',
    split:   'bg-secondary',
};

/*
 * What each stage MEANS, in the producer's terms rather than the key's.
 *
 * `stage` has no producer-facing writer on the server — `note_live` promotes
 * draft→live on the first feed event and the post-game paths set post — so this
 * badge was a read-only word for a flag that silently decides whether the fixture
 * is ever offered as a board's next one. Naming the consequence is half the fix;
 * the control below is the other half.
 */
/*
 * Each line describes what the STAGE does, never what this particular fixture is
 * about to do. "Offered to a board as its next fixture" read as a promise, and sat
 * directly above "Not up next — it is already on board 1" — two true sentences that
 * contradicted each other, because the stage is only one of the four conditions.
 * The verdict below is the only line that speaks for this fixture.
 */
const STAGE_MEANING = {
    draft: 'Not started — the only stage a match can be offered from.',
    live:  'A board has fed this match. Never offered while it sits here.',
    post:  'A game finished. Never offered while it sits here.',
};


/*
 * WHICH RUNNING ORDER this fixture is in — membership, which is a property of the
 * record rather than of its position.
 *
 * A toggle while there is one order (the common case: enrolled by default, so this
 * is normally the way OUT — a placeholder, or a fixture kept for reference, that
 * should not show on the schedule overlay or be offered to a board). A picker once
 * there are several, because membership is EXCLUSIVE: a fixture belongs to one
 * order, so choosing another MOVES it rather than listing it twice. Same shape as
 * a container's exclusive roster.
 */
const MembershipControl = memo(function MembershipControl({ m, queues, queueOf }) {
    const [open, setOpen] = useState(false);
    const inOrder = queueOf != null;
    // `null` means take it out; `undefined` means put it in whichever order the
    // server considers first.
    const choose = (qid) => {
        setOpen(false);
        (qid === null ? unqueueMatch(m) : queueMatch(m, qid))
            .catch(failed('Running order'));
    };

    const single = queues.length <= 1;
    const face = (
        <button
            type="button"
            /*
             * A VERB while this is a toggle, a STATE once it opens a picker. An
             * action label is the better one for a button, but "Take match 3 out of
             * the running order" would be a lie on a control whose click just opens
             * a list of orders to choose from.
             */
            aria-label={single
                ? (inOrder
                    ? `Take match ${m} out of the running order`
                    : `Add match ${m} to the running order`)
                : (inOrder
                    ? `Match ${m} is in the ${queueOf} running order`
                    : `Match ${m} is not in a running order`)}
            aria-pressed={inOrder}
            /*
             * The toggle sends NO queue id — the server resolves "the first order",
             * which is the same answer without the client having to name it. It
             * matters because `queues` may be the pre-migration fallback, whose id
             * this client invented: naming it would 404 the moment the real first
             * order is titled anything else.
             */
            onClick={single ? () => choose(inOrder ? null : undefined) : undefined}
            className={cn(
                'shrink-0 rounded p-1 transition-colors hover:bg-secondary',
                inOrder ? 'text-rio-400 hover:text-rio-300' : 'text-muted-foreground/60 hover:text-foreground',
            )}
        >
            <ListOrdered size={14} />
        </button>
    );

    if (single) {
        return (
            <SimpleTooltip label={inOrder
                ? 'In the running order — click to take it out of the schedule and out of Up next'
                : 'Not in the running order — click to add it to the end'}>
                {face}
            </SimpleTooltip>
        );
    }
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{face}</PopoverTrigger>
            <PopoverContent align="end" className="w-60">
                <Stack gap="xs">
                    <Text size="xs" className="label-display text-muted-foreground">Running order</Text>
                    {queues.map(q => (
                        <Button
                            key={q.id}
                            size="xs"
                            variant={q.id === queueOf ? 'default' : 'outline'}
                            onClick={() => choose(q.id)}
                            className="justify-start"
                        >
                            {q.title || q.id}
                        </Button>
                    ))}
                    <Button
                        size="xs"
                        variant={inOrder ? 'ghost' : 'secondary'}
                        onClick={() => choose(null)}
                        className="justify-start text-muted-foreground"
                    >
                        In none — off the schedule
                    </Button>
                </Stack>
            </PopoverContent>
        </Popover>
    );
});

/*
 * THE LIFECYCLE CONTROL — the badge, made pressable.
 *
 * Momentary, not staged, and deliberately: this file's rule is that authoring and
 * lifecycle hops run immediately (see the header comment and Next game), and a
 * stage change is a correction to what already happened rather than a composition
 * choice to preview. Its one broadcast effect is the LIVE pill on the schedule
 * ticker, which should track reality the moment the producer fixes it.
 *
 * `reason` is the console's mirror of `Schedule.not_waiting_reason` — the same
 * rule the server resolves Up next with, so the panel can name the condition
 * holding a fixture back instead of leaving a producer to watch Up next stay
 * silent. Setting a played fixture back to Draft is the way out, which is why the
 * two live in one popover.
 *
 * `first` is the separate question the reason cannot answer: `not_waiting_reason`
 * is per fixture, so on a night of eight fresh drafts all eight are waiting and
 * only one of them is next. See `useNextInOrder`.
 */
/*
 * THE STAGE BADGE IS A READOUT WITH ONE VERB, not a flag picker.
 *
 * It carried three buttons — draft | live | post — which made it the THIRD control
 * in this bar that moves a fixture backwards, and two of the three were the same
 * write: "Ready next game" is `stage → draft`, and so was this popover's `draft`.
 * A producer reading a bar with `Reopen`, `Ready next game` and a stage picker had
 * no way to tell which of them was the one they wanted, and the two that agreed did
 * not say so.
 *
 * What is genuinely valuable here is the DIAGNOSIS — "why is this not coming up?",
 * which nothing on the desk gave before it existed and which the four eligibility
 * conditions make invisible (server/schedule.py `not_waiting_reason`). That stays.
 * Where the blocker is the stage itself, the popover offers the SAME verb the bar
 * does rather than a second way to write the flag; `live` and `post` are never
 * offered at all, because no producer wants to claim a game has been fed or has
 * finished — those are the server's to say (`note_live`, the post-game paths).
 */
const StageControl = memo(function StageControl({ m, stage, reason, queued, first }) {
    const [open, setOpen] = useState(false);
    const toDraft = () => {
        setOpen(false);
        if (stage === 'draft') return;
        updateMatch(Number(m), { stage: 'draft' })
            .catch(failed('Stage'));
    };
    // Membership first: it outranks the four fixture conditions, because a match
    // taken out of the order is not offered no matter what state it is in.
    const blocked = !queued ? 'it is not in the running order' : reason;
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={`Match ${m} lifecycle: ${stage}`}
                    className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-opacity hover:opacity-80',
                        DRAFT_STAGE_BADGE[stage] || DRAFT_STAGE_BADGE.draft,
                    )}
                >
                    {stage}
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
                <Stack gap="xs">
                    <Text size="xs" className="label-display text-muted-foreground">Lifecycle</Text>
                    <Text size="xs" className="text-muted-foreground">{STAGE_MEANING[stage]}</Text>
                    {/* The answer to "why is this not coming up?", which nothing
                        on the desk used to give.

                        Three states, not two: waiting is not the same as next.
                        Every fresh draft passes the four conditions, so a night of
                        eight of them had eight popovers each calling itself "the
                        next fixture in line" — seven of them wrong, and wrong in
                        the one place a producer goes to find out what is next. */}
                    <div className="border-t border-border/60 pt-1.5">
                        {blocked ? (
                            <Stack gap="xs">
                                <Text size="xs" className="text-muted-foreground">
                                    <span className="text-foreground">Not up next</span> — {blocked}.
                                </Text>
                                {/* The one blocker a producer can clear from here,
                                    and the SAME verb the bar shows — never a second
                                    way to write the flag. The other three are
                                    cleared by acting on the thing they name (take
                                    it off its board, reopen the series, put it in an
                                    order), each of which has its own control. */}
                                {stage !== 'draft' && (
                                    <Button size="xs" variant="secondary" onClick={toDraft}>
                                        Ready next game
                                    </Button>
                                )}
                            </Stack>
                        ) : first ? (
                            <Text size="xs" className="text-emerald-300">
                                Waiting for a board — this is the next one in line.
                            </Text>
                        ) : (
                            <Text size="xs" className="text-muted-foreground">
                                <span className="text-foreground">Waiting for a board</span> — it
                                comes up once the matches ahead of it in the order have been taken.
                            </Text>
                        )}
                    </div>
                </Stack>
            </PopoverContent>
        </Popover>
    );
});

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

function clinchedSide(bestOf, w1, w2) {
    const need = gamesToWin(bestOf);
    return w1 >= need ? 1 : w2 >= need ? 2 : null;
}

// One match, rendered as a collapsible accordion inside the Match card.
// Collapsed: a one-line summary — "A vs B · Bo3 · 1–0 · ‹stage›" (no side
// numbers; position is the identity). Expanded: the full condensed editor —
// start.gg + phase, the two sides (participant + captain grid), then mode / Bo /
// series / board binds. Every broadcast-visible edit routes through the staging
// gateway; New / Next game / Delete are momentary. Deletable via the header
// trash (a two-step Popover confirm, no blocking browser dialog).
const MatchAccordion = memo(function MatchAccordion({
    m, open, onToggle, active, boundMap, gameModes, canBind, queuePos, queueLen,
    queues, queueOf,
}) {
    const draft = useMatchDraft(m);
    const stage = draft.match?.stage || 'draft';
    const waitReason = useWaitingReason(m);
    // Waiting is per fixture; NEXT is a property of the order it sits in, so the
    // stage popover cannot claim it from `waitReason` alone.
    const nextInOrder = useNextInOrder(queueOf);
    const [confirmDel, setConfirmDel] = useState(false);
    const sides = useSideLabels();

    /*
     * THE SERIES THIS ROW IS READING, STAGED VALUES INCLUDED. `draft.val` is how
     * every other control on the desk reads a field mid-edit, and the series
     * verbs were the ones that skipped it: the stepper in the body writes into
     * the staging buffer while the clinch arithmetic up here read live state, so
     * under confirm mode bumping a side to the win count turned the score amber
     * and offered no Decide at all until the bump was committed — two commits for
     * one intent, with the button invisible in between. Two halves of one row
     * must not disagree about which series they are looking at.
     */
    const bestOf = draft.val('format.bestOf', (draft.match?.format || {}).bestOf ?? 1);
    const w1 = Number(draft.val('series.1', draft.match?.series?.[1] ?? draft.match?.series?.['1'] ?? 0)) || 0;
    const w2 = Number(draft.val('series.2', draft.match?.series?.[2] ?? draft.match?.series?.['2'] ?? 0)) || 0;
    const decided = decidedSide(draft.match);
    // Only interesting where it DISAGREES with the record: someone is at the win
    // count and nothing has recorded it, which is the producer's cue to decide.
    const clinched = decided ? null : clinchedSide(bestOf, w1, w2);
    /*
     * OUT OF GAMES WITH NOBODY AT THE WIN COUNT — the doubleheader split, which is
     * a COMPLETE fixture rather than a stuck one. A DH is complete after two games
     * however they fall, so 1-1 is finished and simply has no winner, and the desk
     * offers NO VERB TO INVENT ONE: the badge states it, everything that moves a
     * fixture on stands down beside it, and there is nothing left to decide. The
     * only correction is to the series itself, on the steppers.
     */
    const split = !decided && !clinched && matchComplete(bestOf, w1, w2, null);

    const onPickSet = (s) => stageOrRun({
        key: `match:${m}:startgg`,
        label: `Load set: ${s.p1_name || 'TBD'} vs ${s.p2_name || 'TBD'}`,
        value: s.id,
        run: () => loadStartGGSet(Number(m), s.id),
    });
    const onNextGame = () => {
        updateMatch(Number(m), { stage: 'draft' })
            .catch(failed('Next game'));
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
            .catch(failed('Delete match'));
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
                HEADER_TINT[decided ? 'decided' : split ? 'split' : stage] || HEADER_TINT.draft,
                open && 'border-b border-border',
            )}>
                {/* THE POSITION IN THE RUNNING ORDER, and the two verbs that
                    change it — at the head of the row, because that is what the
                    number is: this row's place in the list it is sitting in. The
                    stack is ordered by the queue, so moving a match here moves it
                    on the schedule overlay and changes which fixture a board's Up
                    next offers, and all three are one fact rather than three
                    surfaces to keep in agreement.

                    Visible at rest, not hover-revealed. Reordering is a
                    scan-the-whole-list task — arrows that appear one row at a time
                    under the pointer cannot be scanned, and the last control this
                    console hid on hover (a board's Remove) is in the skill as the
                    mistake not to repeat. */}
                {queuePos != null && (
                    /* The group carries the name, because the digit on its own
                       has none — "1" beside two arrows tells a screen reader
                       nothing, and `role="group"` is what lets the number be read
                       as this row's place rather than as loose content. */
                    <div
                        role="group"
                        aria-label={`Match ${m}: position ${queuePos} of ${queueLen} in the running order`}
                        className="flex shrink-0 items-center gap-1"
                    >
                        <MoveButtons
                            label={`match ${m} in the running order`}
                            canUp={queuePos > 1} canDown={queuePos < queueLen}
                            onUp={() => moveQueuedMatch(m, -1).catch(failed('Running order'))}
                            onDown={() => moveQueuedMatch(m, 1).catch(failed('Running order'))}
                        />
                        <span aria-hidden="true" className="w-4 text-center text-[11px] tabular-nums text-muted-foreground">
                            {queuePos}
                        </span>
                    </div>
                )}
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
                        {sides.label(decided)} wins
                    </Badge>
                )}
                {/* THE SAME WORD THE BOARD USES, on the same fact. A split is
                    finished and unwon, so it gets neither the emerald fill (there
                    is no winner to celebrate) nor `DECIDED` (there is no winner to
                    name) — and without a badge of its own the row was a finished
                    fixture wearing a draft's face. */}
                {split && (
                    <SimpleTooltip label={`Both games played and the doubleheader is split ${w1}–${w2} — nobody took it`}>
                        <Badge className="shrink-0 bg-secondary text-[10px] font-semibold uppercase tracking-wider text-foreground">
                            Split
                        </Badge>
                    </SimpleTooltip>
                )}
                {/* A DECIDED FIXTURE HAS NO STAGE QUESTION, so it no longer
                    carries the badge that answers one. The control exists to say
                    why a fixture is not coming up; on a finished one the answer is
                    "because it is finished", which the emerald badge to its left
                    has just said in the producer's words rather than the state
                    key's. Worse, the popover's one verb is "Ready next game",
                    which on a decided match writes `stage = draft` and changes
                    nothing about whether it is offered — a button that looks like
                    the way out of a state it cannot leave. `POST` beside
                    `SIDE 1 WINS` was two chips for one fact, one of them in app
                    vocabulary. Reopen is the only move a finished fixture has, and
                    it is now the only one shown. */}
                {!decided && !split && (
                    <StageControl
                        m={m}
                        stage={stage}
                        reason={waitReason}
                        queued={queuePos != null}
                        first={nextInOrder === String(m)}
                    />
                )}
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
                        title="Correction: undo the recorded series winner. Not a lifecycle move — it does not start another game."
                    >
                        Reopen
                        <StagedDot show={draft.isStaged('decide')} />
                    </Button>
                ) : clinched ? (
                    <Button
                        size="xs" variant="secondary" onClick={() => onDecide(clinched)}
                        className="shrink-0"
                        title={`Record ${sides.label(clinched)} as the series winner`}
                    >
                        Decide: {sides.label(clinched)}
                        <StagedDot show={draft.isStaged('decide')} />
                    </Button>
                ) : null}
                {/* NEXT GAME IS PART OF THE PAIR RULE ABOVE, and was left out of
                    it. It showed at ANY `post`, decided included — so a finished
                    Bo1 offered "Reopen" and "Next game" side by side, two verbs
                    that move the fixture backwards in different ways, with nothing
                    saying which. A decided series has no next game; the only thing
                    to offer there is the correction.

                    It re-arms THIS fixture (stage → draft) rather than creating
                    anything, which is why the label says so: "Next game" alone read
                    as though a game would appear somewhere, and the honest answer
                    to "where does it go?" is nowhere — the same match goes back to
                    being offerable. */}
                {stage === 'post' && !decided && !split && (
                    <SimpleTooltip label="Put this match back in play for its next game — nothing is created, the series score is kept">
                        <Button size="xs" variant="secondary" onClick={onNextGame} className="shrink-0">
                            Ready next game
                        </Button>
                    </SimpleTooltip>
                )}
                {/* Flip is icon-only and lives with the record actions rather than
                    on the two side fields it swaps. The sides grid puts its spine
                    behind an @lg breakpoint, so a control mounted there would
                    vanish on a narrow panel — and the feedback for a flip is the
                    collapsed row's own "A vs B", which is right here. */}
                {/* MEMBERSHIP, beside the record's other actions — whether this
                    fixture is part of tonight at all, which is a property of the
                    record and not of its position. A new match arrives enrolled
                    (create_match appends it), so this is normally the way OUT: a
                    placeholder, or a fixture kept for reference, that should not
                    show on the schedule overlay or be offered to a board. */}
                <MembershipControl m={m} queues={queues} queueOf={queueOf} />
                <SimpleTooltip label="Flip the sides — series wins follow the player">
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
                {/* A VERB'S PROMINENCE TRACKS WHETHER IT IS THE EXPECTED NEXT
                    STEP. On a finished fixture, removing it is most of what is
                    left to do — and it was an anonymous 14px trash glyph, the
                    same weight as flip and membership, on a desk whose New match
                    and Clear played had just been made unmissable. So a decided
                    row gets the labelled button and every other row keeps the
                    icon, because deleting a fixture that has not been played is a
                    rare correction rather than the shape of the night.

                    `secondary`, never `default`: the night strip's bulk clear is
                    the panel's one filled press, and eight filled red rows under
                    it would be a wall of alarm that teaches a producer to stop
                    reading them.

                    IT DOES NOT MOVE. Position is stable across both faces — a
                    control that relocates when its record changes state is its
                    own confusion, and the far right is where this console already
                    puts destroy. */}
                <Popover open={confirmDel} onOpenChange={setConfirmDel}>
                    <PopoverTrigger asChild>
                        {decided ? (
                            <Button
                                size="xs" variant="secondary" className="h-7 shrink-0"
                                aria-label={`Clear match ${m}`}
                            >
                                <Trash2 size={13} className="mr-1" /> Clear
                            </Button>
                        ) : (
                            <button
                                type="button"
                                aria-label={`Clear match ${m}`}
                                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            >
                                <Trash2 size={14} />
                            </button>
                        )}
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-60">
                        <Stack gap="xs">
                            <Text size="sm" className="text-foreground">Clear this match?</Text>
                            {/* "Deletes" in the body keeps the permanence honest
                                while the VERB stays the one word this desk uses
                                for removing a fixture. */}
                            <Text size="xs" className="text-muted-foreground">
                                Deletes the fixture. Unbinds and blanks any board it fills.
                            </Text>
                            <Group gap="xs" className="justify-end">
                                <Button size="xs" variant="ghost" onClick={() => setConfirmDel(false)}>Cancel</Button>
                                <Button size="xs" variant="destructive" onClick={onDelete}>Clear</Button>
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
                            label="Match"
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

/*
 * Which boards draw from each running order — `{queueId: [sb]}`.
 *
 * An order's whole point is that a board takes fixtures from it, and that is the
 * one fact its heading cannot derive from itself. Resolved the same way the server
 * does (`Schedule.queue_for_board`): an unassigned board counts toward the FIRST
 * order, so a rig nobody has configured still shows where its fixtures go.
 */
function useBoardsByQueue(active) {
    const assigned = useSettingsStore(useShallow(s => s?.scoreboards?.match_queue ?? {}));
    const ids = useStateStore(useShallow((s) => {
        const qs = s?.schedule?.queues;
        return Array.isArray(qs) ? qs.map((q, i) => String(q?.id ?? `queue-${i + 1}`)) : [];
    }));
    return useMemo(() => {
        const out = {};
        for (const sb of active) {
            const want = assigned[sb] ?? assigned[String(sb)];
            const qid = (want && ids.includes(String(want))) ? String(want) : ids[0];
            if (!qid) continue;
            (out[qid] ||= []).push(sb);
        }
        return out;
    }, [active, assigned, ids]);
}

/*
 * One running order's heading: its title, who draws from it, and the verbs that
 * act on the ORDER rather than on a fixture in it.
 *
 * The title is editable in place. A queue's id is minted once from its title and
 * never changes (`queue_id_for`), so renaming is safe — a board's assignment points
 * at the id and survives.
 */
/*
 * PLAYED FIXTURES FOLD. A night's card accumulates, and by the end of it — or on
 * the morning after one — tonight's work is buried under eight decided matches
 * that nothing is ever going to do anything with again.
 *
 * A DISPLAY ANSWER TO A DISPLAY PROBLEM. The alternative was a verb that unqueued
 * decided fixtures (the "End session" this replaced), which mutates stored state to
 * fix a list being long and throws away the order the night actually ran in. The
 * schedule overlay already hides decided matches by default, so the on-air half was
 * never a problem — only the desk's.
 *
 * IT FOLDS THE LEADING RUN, NOT EVERY DECIDED FIXTURE. A night runs top to bottom,
 * so played ones are a prefix in the ordinary case, and folding only the prefix can
 * never REORDER what is left — a decided match in the middle of an order stays
 * visible, which is right: out of sequence is exactly when it is worth seeing.
 */
/*
 * THE DESK'S "WHAT NOW" STRIP — the same shape as the board desk's turnover bar,
 * deliberately: one sentence naming the state, one FILLED press ending it. The
 * console should have exactly one thing that looks like this, and a producer who
 * has learnt it on a board should not have to learn it again here.
 *
 * It appears only where the desk genuinely owes a press — every fixture played,
 * or none authored. Both are the cold start: the app opens on a night that is
 * over, and the previous answer was a collapsed "1 played" fold above a finished
 * card, with a small outline New match at the bottom of the panel. Nothing on
 * screen was the next thing to do, so nothing looked like it.
 *
 * The sentence it replaced explained what a match IS ("participants, captains,
 * bracket phase, mode and format — then bind it to a board…"), which is a
 * paragraph of helper text where a button belongs. What a match is, is learnt by
 * making one.
 *
 * With SEVERAL running orders there is no unambiguous button — "New match" cannot
 * say which order — so the strip points at the `+` that can and carries no press
 * of its own. That is the same trap `QueueHeading` exists to avoid, not a
 * different rule.
 */
/*
 * CLEARING WHAT HAS BEEN PLAYED — the question the desk was not asking.
 *
 * A match is removed by exactly two things today: the trash on its own card, one
 * at a time, and Reset State, which also resets every board's binding and
 * playback mode and so is never used for tidying. Between them there was nothing,
 * so the end of a night was eight presses of a trash icon or a hatch nobody
 * reaches for — and the desk's own prominent verb, after a match ended, was ADD
 * ANOTHER. That is a forward press stepping straight over the obvious question,
 * and it is how the desk fills up with fixtures nobody will look at again.
 *
 * THE SCOPE IS ALWAYS WHAT THE TEXT BESIDE IT IS ABOUT. On the fold that is one
 * order's leading decided run, which is the exact set the fold is collapsing and
 * counting; on the night strip it is every match, because that strip only appears
 * when every match is decided. One verb, one name, and the popover states the
 * count and the real consequence each time, so the blast radius is never a guess.
 *
 * IT NAMES THE BOARD IT WILL BLANK. A decided fixture STAYS BOUND — that is the
 * whole reason the board desk's fixture slot has a `done` branch — so clearing a
 * played run can unbind and blank a board that is on air. Excluding bound matches
 * instead was the other option and is worse: the last match of a night is almost
 * always still on its board, so "clear played" would leave exactly the one the
 * producer most wanted gone, with nothing saying why. Name the consequence and
 * let them decide.
 *
 * Sequential deletes by EXPLICIT id, not a re-derived list: every delete
 * re-projects the running orders, so re-deriving between calls would be walking a
 * moving target. `delete_match` is the one removal path and already unbinds,
 * blanks and prunes from the order — this is N of it, never a second
 * implementation.
 */
const ClearPlayed = memo(function ClearPlayed({ ids, boards }) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const run = async () => {
        setOpen(false);
        setBusy(true);
        try {
            for (const id of ids) await deleteMatch(Number(id));
        } catch (e) {
            failed('Clear played')(e);
        } finally {
            setBusy(false);
        }
    };
    if (!ids.length) return null;
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button size="xs" className="h-7 shrink-0" disabled={busy}>
                    <Trash2 size={13} className="mr-1" /> Clear played
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
                <Stack gap="xs">
                    <Text size="sm" className="text-foreground">
                        Clear {ids.length} played {ids.length === 1 ? 'match' : 'matches'}?
                    </Text>
                    {/* The real consequence, or the absence of one — said either
                        way, because a control that goes quiet when it has nothing
                        to warn about is quietest in the cases you cannot tell
                        apart. */}
                    <Text size="xs" className="text-muted-foreground">
                        {boards.length
                            ? `${boards.map(b => `Board ${b}`).join(' and ')} still ${boards.length > 1 ? 'hold' : 'holds'} one — it will be unbound and blanked.`
                            : 'No board is holding any of them.'}
                    </Text>
                    <Group gap="xs" className="justify-end">
                        <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button size="xs" variant="destructive" onClick={run}>Clear</Button>
                    </Group>
                </Stack>
            </PopoverContent>
        </Popover>
    );
});

const NightLead = memo(function NightLead({ empty, single, creating, onNew, ids, boards }) {
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/60 bg-secondary/20 px-2 py-1.5">
            <Text size="xs" dimmed className="min-w-0 flex-1">
                {empty ? 'No matches yet.' : 'Every match has been played.'}
                {!single && !empty && ' Add tonight’s with the + on a running order.'}
                {!single && empty && ' Add one with the + on the running order it belongs to.'}
            </Text>
            {/* CLEARING COMES FIRST WHEN THERE IS SOMETHING TO CLEAR. A finished
                night's loud button was New match, which is a forward press over an
                unasked question — and the state it leads to is a desk with tonight's
                fixture buried under last night's. Clearing lands on the EMPTY
                state, where New match is the primary and the only thing on the
                strip, so the two steps chain and each has exactly one obvious
                press. */}
            {!empty && <ClearPlayed ids={ids} boards={boards} />}
            {single && (
                <Button
                    size="xs" className="h-7 shrink-0" variant={empty ? 'default' : 'ghost'}
                    disabled={creating} onClick={() => onNew()}
                >
                    <Plus size={13} className="mr-1" /> New match
                </Button>
            )}
        </div>
    );
});


const QueueHeading = memo(function QueueHeading({ queue, boards, first, last, onNew, creating }) {
    const [title, setTitle] = useState(queue.title);
    const [confirmDel, setConfirmDel] = useState(false);
    // Follow the server when it changes underneath us, but never while the producer
    // is mid-edit in this field.
    const focused = useRef(false);
    useEffect(() => { if (!focused.current) setTitle(queue.title); }, [queue.title]);

    const commit = () => {
        if (title === queue.title) return;
        renameQueue(queue.id, title)
            .catch(failed('Rename order'));
    };
    const onDelete = () => {
        setConfirmDel(false);
        deleteQueue(queue.id)
            .catch(failed('Remove order'));
    };

    return (
        <div className="flex items-center gap-2 pt-2">
            <MoveButtons
                label={`the ${queue.title || queue.id} order`}
                canUp={!first} canDown={!last}
                onUp={() => moveQueue(queue.id, -1).catch(failed('Move order'))}
                onDown={() => moveQueue(queue.id, 1).catch(failed('Move order'))}
            />
            <input
                type="text"
                aria-label={`Title of the ${queue.id} running order`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onFocus={() => { focused.current = true; }}
                onBlur={() => { focused.current = false; commit(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                placeholder="Untitled order"
                className="label-display min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-foreground/80 hover:border-border focus:border-border focus:outline-none"
            />
            {/* The consequence of the order, which nothing else on the desk says. */}
            <Text size="xs" span className="shrink-0 text-muted-foreground/70">
                {boards?.length
                    ? `board ${boards.join(', ')}`
                    : 'no board takes from this'}
            </Text>
            {/* CREATING INTO THIS ORDER, the rack's section-header idiom (its `+`
                adds into the scene it heads). A desk-level New match can only mean
                the first order, so on a winners/losers rig every fixture arrived in
                Winners and had to be moved — a second verb, on the membership icon
                inside the fixture's own body, which is not where a producer looks
                for "put this one in Losers". The heading is the order, so its `+`
                is where a fixture enters it. */}
            <SimpleTooltip label={`New match in “${queue.title || queue.id}”`}>
                <button
                    type="button"
                    aria-label={`New match in the ${queue.title || queue.id} running order`}
                    disabled={creating}
                    onClick={() => onNew?.(queue.id)}
                    className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                >
                    <Plus size={13} />
                </button>
            </SimpleTooltip>
            <Popover open={confirmDel} onOpenChange={setConfirmDel}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        aria-label={`Remove the ${queue.id} running order`}
                        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                        <Trash2 size={13} />
                    </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-60">
                    <Stack gap="xs">
                        <Text size="sm" className="text-foreground">Remove this running order?</Text>
                        <Text size="xs" className="text-muted-foreground">
                            Its {queue.matches.length} match{queue.matches.length === 1 ? '' : 'es'} stay,
                            unenrolled. Boards taking from it fall back to the first order.
                        </Text>
                        <Group gap="xs" className="justify-end">
                            <Button size="xs" variant="ghost" onClick={() => setConfirmDel(false)}>Cancel</Button>
                            <Button size="xs" variant="destructive" onClick={onDelete}>Remove</Button>
                        </Group>
                    </Stack>
                </PopoverContent>
            </Popover>
        </div>
    );
});

// Add a running order. The title is asked for up front because it mints the id.
const NewQueueButton = memo(function NewQueueButton() {
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');
    const add = () => {
        setOpen(false);
        const t = title.trim();
        setTitle('');
        createQueue(t)
            .catch(failed('New order'));
    };
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button size="xs" variant="ghost" className="text-muted-foreground">
                    <ListPlus size={13} className="mr-1" /> New running order
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72">
                <Stack gap="xs">
                    <Text size="xs" className="label-display text-muted-foreground">New running order</Text>
                    <Text size="xs" className="text-muted-foreground">
                        A second ordered list of fixtures — a losers bracket alongside a winners
                        bracket, say. Assign a board to it on that board’s panel.
                    </Text>
                    <input
                        type="text"
                        autoFocus
                        aria-label="Title of the new running order"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) add(); }}
                        placeholder="e.g. Losers"
                        className={cn(QUIET_FIELD, 'w-full')}
                    />
                    <Group gap="xs" className="justify-end">
                        <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button size="xs" disabled={!title.trim()} onClick={add}>Add</Button>
                    </Group>
                </Stack>
            </PopoverContent>
        </Popover>
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
    const { options: gameModes } = useGameModes();
    const [creating, setCreating] = useState(false);
    // Single-open accordion. `null` means "default to newest"; '' means the user
    // explicitly collapsed everything; else the open match id.
    const [openId, setOpenId] = useState(null);

    const ids = useMemo(
        () => Object.keys(matches).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b)),
        [matches],
    );
    /*
     * THE STACK IS THE RUNNING ORDER. Queued matches first, in `schedule.queue`
     * order, then anything not enrolled, by id.
     *
     * The order used to be authored inside the Upcoming Schedule element's stage
     * panel — a ticker's settings — so tonight's running order was edited in a
     * different place from the fixtures it orders, in a second list that could
     * disagree with this one. One list, and it is this one: what a producer sees
     * top-to-bottom here is what the schedule overlay draws and the sequence a
     * board's Up next walks.
     *
     * `newestId` deliberately stays the highest ID, not the last row: "default to
     * the newest match" means the one just created, wherever it sits in the order.
     */
    const queueOrder = useQueueOrder();
    const queues = useQueues();
    /*
     * SEVERAL ORDERS, one section each, then the unenrolled group.
     *
     * `queuePos` is a match's place WITHIN ITS OWN order, and `queueLen` the length
     * of that order — the arrows bound at its ends, because position and membership
     * are different verbs and walking the last fixture of Winners "down" must not
     * spill it into Losers. `groupAt` maps a row index to the section heading that
     * opens there, so the stack labels itself without a second pass.
     */
    const { groups, unenrolled } = useMemo(() => {
        /*
         * `queues` absent but `queue` populated is the one-frame window before the
         * boot migration lands (or a client that connected mid-migration). Treat the
         * projected union as a single untitled order rather than drawing an empty
         * desk over a night's worth of fixtures.
         */
        const gs = queues.length
            ? queues
            : (queueOrder.length ? [{ id: 'main', title: '', matches: queueOrder }] : []);
        const of = {};
        for (const q of gs) for (const id of q.matches) of[id] = q.id;
        /*
         * A PLAYED MATCH IS AN ORDINARY ROW. Its leading decided run used to be
         * counted here and collapsed behind a `2 played ›` disclosure, which made
         * the thing a producer most often wants to act on at the end of a night
         * the one thing they had to open a fold to reach — and gave the desk two
         * row shapes for one kind of record. The result badge already says a
         * fixture is finished; the row does not also need to be a different
         * object. Every match in an order renders the same way, in order.
         */
        return { groups: gs, unenrolled: ids.filter(id => of[id] == null) };
    }, [queues, queueOrder, ids]);
    // Which boards draw their next fixture from each order — the consequence of an
    // order that the desk would otherwise never mention.
    const boardsByQueue = useBoardsByQueue(active);

    /*
     * IS THERE ANYTHING TO RUN? The rack answers this in two words
     * (`useMatchDeskMeta`) and the desk it opens answered it nowhere — so a night
     * whose fixtures were all played showed a collapsed "1 played" fold, a
     * finished card, and a small outline New match at the very bottom, none of
     * which is a producer being told what to do. `idle` is the state where the
     * desk owes them a press: no fixture is waiting for a board AND none is
     * coming (every one decided, or none authored). `none waiting` is deliberately
     * NOT idle — those fixtures are on boards or held back per fixture, which the
     * stage control explains where the fixture is.
     */
    const waiting = useWaitingCount();
    const allDecided = ids.length > 0
        && ids.every(id => decidedSide(matches[id]) != null);
    const idle = waiting === 0 && (ids.length === 0 || allDecided);

    // Which boards a delete of `list` would unbind and blank — the consequence
    // ClearPlayed names before it runs. Read off the same `boundMap` the bind
    // chips use, so the warning and the chips cannot disagree about who holds
    // what.
    const boardsHolding = useCallback((list) => {
        const want = new Set(list.map(String));
        return active.filter(sb => want.has(String(boundMap[sb] ?? '')));
    }, [active, boundMap]);

    const newestId = ids[ids.length - 1] || null;
    const effectiveOpen = openId === null ? newestId : (openId || null);

    /*
     * One row, called from two places — the folded played run and the tail below
     * it — so the props cannot drift between them. `i` is the index in the FULL
     * order, never in the slice: `queuePos` is the fixture's real place, and the
     * move arrows bound at the order's ends.
     */
    const row = (id, i, q) => (
        <MatchAccordion
            key={id}
            m={id}
            open={effectiveOpen === id}
            onToggle={() => setOpenId(effectiveOpen === id ? '' : id)}
            active={active}
            boundMap={boundMap}
            gameModes={gameModes}
            canBind={canBind}
            queuePos={i + 1}
            queueLen={q.matches.length}
            queues={groups}
            queueOf={q.id}
        />
    );

    // `qid` is which running order the fixture is created INTO — the heading's
    // `+` names its own, the desk-level button names none and takes the first.
    const onNew = async (qid) => {
        setCreating(true);
        try {
            const { id } = await createMatch(qid);
            setOpenId(String(id));
        } catch (e) {
            notifications.show({ message: `New match: ${e?.message || e}`, color: 'red' });
        } finally { setCreating(false); }
    };

    /*
     * The panel frame (chip · title · meta) comes from PanelShell on the stage.
     *
     * ONE STACK, EMPTY OR NOT. "No matches yet" used to be an early branch that
     * returned a sentence and a button INSTEAD of the desk, so an empty rig lost
     * the running orders themselves: two orders a producer had built and titled
     * collapsed to a single New match, with no heading to create into, nothing to
     * rename or reorder, no way to add a second one — and nothing saying the
     * orders still existed. Emptiness belongs to the list of fixtures; the orders
     * are the desk's own structure and outlive every fixture in them. The empty
     * state is a LINE, not a branch.
     */
    return (
        <Stack gap="xs">
            {idle && (
                <NightLead
                    empty={ids.length === 0}
                    single={groups.length <= 1}
                    creating={creating}
                    onNew={onNew}
                    ids={ids}
                    boards={boardsHolding(ids)}
                />
            )}
            {/* Iterated per ORDER rather than over a flat list with
                index-keyed headings: an order that exists but is empty still
                gets its heading (an order you cannot see is one you cannot
                delete), and two empty ones in a row cannot collide. */}
            {groups.map((q, qi) => (
                <Fragment key={q.id}>
                    {/* Only once there is more than one. A single order is
                        the whole desk, and a title over every fixture there
                        is would be furniture. */}
                    {groups.length > 1 && (
                        <QueueHeading
                            queue={q}
                            boards={boardsByQueue[q.id]}
                            first={qi === 0}
                            last={qi === groups.length - 1}
                            onNew={onNew}
                            creating={creating}
                        />
                    )}
                    {q.matches.map((id, i) => row(id, i, q))}
                </Fragment>
            ))}
            {unenrolled.length > 0 && (
                <Text size="xs" className="pt-1.5 text-muted-foreground/70">
                    Not in a running order — no schedule slot, never offered as a board’s next fixture.
                </Text>
            )}
            {unenrolled.map(id => (
                <MatchAccordion
                    key={id}
                    m={id}
                    open={effectiveOpen === id}
                    onToggle={() => setOpenId(effectiveOpen === id ? '' : id)}
                    active={active}
                    boundMap={boundMap}
                    gameModes={gameModes}
                    canBind={canBind}
                    queuePos={null}
                    queueLen={0}
                    queues={groups}
                    queueOf={null}
                />
            ))}
            <Group gap="xs" className="pt-0.5">
                {/* One order is the whole desk, so a plain New match is
                    unambiguous and the headings aren't drawn at all. With
                    several, "New match" cannot say WHICH — each heading's
                    `+` is the answer, and a button that always meant the
                    first order would be the trap it replaced. */}
                {groups.length <= 1 && !idle && (
                    <Button size="xs" variant="outline" disabled={creating} onClick={() => onNew()}>
                        <Plus size={13} className="mr-1" /> New match
                    </Button>
                )}
                <NewQueueButton />
            </Group>
        </Stack>
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
    const lifecycle = useBoardLifecycle(sb);
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
                {/* WHERE THAT BOARD'S GAME IS UP TO, on the chip that says the
                    fixture is on it. The desk could say a match was on board 1 and
                    nothing about whether board 1's game was live, finished or gone
                    — so "is this match done with the board?" meant leaving the desk
                    to find out. Only on the LIT chip: the other boards' games are
                    not this fixture's business, and a row of lifecycles would be
                    the rack's job done badly. */}
                {displayBound && <GameStageChip lifecycle={lifecycle} />}
            </Button>
        </SimpleTooltip>
    );
});
