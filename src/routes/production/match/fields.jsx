import { memo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useParticipantsStore } from '../../../context/participants';
import { updateMatch } from '../../../context/match';
import { stageOrRun } from '../../../context/staging';
import ParticipantPicker from '../../../components/ParticipantPicker';
import { Stack, Group, Text } from '../../../components/ui/primitives';
import { cn } from '../../../lib/utils';
import { FORMATS, formatLabel } from '../../../../public/layout/lib/match-format.js';
import { FieldRow } from '../kit';
import { StagedDot } from '../controls';
import { useSideLabels } from '../sides';
import { QUIET_FIELD } from './draft';
import { CaptainGrid, PortGrid } from './pickers';

// A fixture's authored fields: each side's participant, captain and port, and
// the format with its series steppers.

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
export const DraftSide = memo(function DraftSide({ m, side, draft, className }) {
    const sides = useSideLabels();
    const live = draft.match?.player?.[side] ?? draft.match?.player?.[String(side)] ?? {};
    const pick = draft.val(`player.${side}.pick`, null);
    const selectedId = pick ? pick.participantId : (live.participantId || null);
    /*
     * A PERSON WITH NO RIO ID IS STILL A PICK. The side stores `rioName: ''`
     * for them, and the picker showed `live.rioName` — so a committed pick
     * drew the "Pick participant…" placeholder and read as a selection that
     * had not taken. The row is resolved by id so the name shows, and the
     * missing Rio ID is SAID, because it is a real fault: the Rio ID is what
     * every live path joins on (sides, stats, the identity check), so this
     * person can be named on the fixture but never recognised in a game.
     */
    const loadPeople = useParticipantsStore(s => s.load);
    const person = useParticipantsStore(s => (selectedId
        ? s.participants.find(p => p.id === selectedId) ?? null
        : null));
    useEffect(() => { if (selectedId) loadPeople(); }, [selectedId, loadPeople]);
    const personName = person?.display?.tag || person?.identities?.rioName || '';
    const name = pick ? (pick._name || pick.rioName) : (live.rioName || personName);
    const noRioId = pick
        ? !pick.rioName
        : !!person && !person.identities?.rioName;
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
                            name && 'font-semibold', noRioId && 'border-amber-500/50')}
                    />
                </div>
            </Group>
            {noRioId && (
                <Text size="xs" className="text-amber-200/90" data-no-rio-id={side}>
                    No Rio ID — live games can’t recognise {name || 'this player'}.{' '}
                    <Link to="/player_list" className="underline underline-offset-2 hover:text-amber-100">
                        Add one in the Address Book
                    </Link>
                </Text>
            )}
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
export const FormatField = memo(function FormatField({ m, draft, bestOf }) {
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
