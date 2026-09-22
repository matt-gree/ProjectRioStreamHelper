import { memo, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../../context/store';
import { stageOrRun, usePending } from '../../../context/staging';
import { useParticipantsStore } from '../../../context/participants';
import {
    setCommentarySlots, isOnStrip, MAX_COMMENTATORS,
} from '../../../context/commentary';
import ParticipantPicker from '../../../components/ParticipantPicker';
import { Switch } from '../../../components/ui/switch';
import { Group, Text } from '../../../components/ui/primitives';
import { cn } from '../../../lib/utils';
import { StagedDot, MoveButtons } from '../controls';
import { ToggleChip, ToggleChips } from '../kit';
import { SubFieldPicker } from '../subfield-picker';
import { DirectStage } from './generic';

/*
 * Commentary desk stage — the caster strip's running order, as ONE RULED SHEET:
 * a row per caster, in the order their plates run across the strip.
 *
 *     #   │ On air │ Caster            │ Sub-plate
 *     1 ⇅ │  ●━    │ MattGree       ⇅  │ 𝕏 Twitter  @mattgree       ⇅
 *
 * This is the ONLY place the desk is authored: a standalone Commentary tab used
 * to carry the same controls in a taller form and was removed as duplication.
 * Each caster is a person in the address book, so their identity fields (real
 * name, socials, pronouns) are edited on Address Book, not here.
 *
 * It was built for a narrow panel and it showed on a wide one: a 28px row of
 * 14px icons with the person picker flexed across ~650px and the sub-plate
 * field squeezed into an 88px select, so "Pronouns" truncated while a six-letter
 * handle had a whole column to itself. The rebuild gives each column the width
 * its content needs — a NAME needs about fifteen characters, the sub-plate needs
 * a field AND the value it will draw — and spends the panel's height, which it
 * now has, on 32px controls instead of glyphs you had to hover to decode. The
 * sub-plate is ONE control — its picker's "No sub-plate" is the off switch.
 *
 * NOT A CARD GRID, deliberately, and for the reason the lower third's rundown
 * refused one: cards reflowing 1 → 2 → 4 across put caster 3 under caster 1 at
 * every width short of four columns, which reads as a second row of the strip
 * rather than the next plate along it. A sheet keeps the running order the one
 * axis of the panel, top to bottom, at every width. The columns are a SUBGRID,
 * so the header labels and every row share one set of rails; below `@2xl` the
 * sub-plate drops under the caster it belongs to instead of squeezing.
 *
 * FOUR SEATS, ALWAYS — the strip's whole capacity, never added or removed.
 * With an Add button and a remove × per row the desk had two ways to take a
 * caster off air (hide them, or delete the row) and only one of them kept their
 * sub-plate choice for the next segment. Now the on-air switch is the only way
 * off, and a seat with nobody in it is simply a seat that draws nothing. The
 * stored list may be shorter (a desk authored before this, or a fresh one); it
 * is PADDED to four for display, and the first write stores all four.
 *
 * The NUMERAL is the plate's position on the strip, not the row's index. The
 * strip compacts — a hidden or unnamed seat is not a hole, the plates either
 * side close up (commentary-mount.js) — so the second row is the FIRST plate
 * whenever the first is hidden, and a row number would say otherwise. A seat
 * with no plate shows a dash and says why on hover.
 *
 * Reorder is buttons, not drag, so it works from a phone at the venue (see
 * MoveButtons).
 */

const blankCasterSlot = () => ({ participantId: null, subField: '', visible: true, subVisible: true });

// Always exactly MAX_COMMENTATORS seats, the stored ones first. A blank seat is
// shown so it can be filled by picking a person — which is what adding a caster
// now IS — and it leaves `visible` on, so the pick puts them straight on air.
const seated = (slots) => Array.from(
    { length: MAX_COMMENTATORS },
    (_, i) => slots[i] || blankCasterSlot(),
);

// The desk as the console works with it: the staged draft slots array when one
// is pending, else the live authored slots. Every edit computes the whole next
// array and stages ONE entry (key 'commentary') whose commit is the whole-array
// PUT — matching the server API, and keeping reorder/edit trivially
// stageable. `_name` is a client-only display tag for staged picks (the
// projector hasn't resolved them yet) and is stripped before the PUT.
function useCommentaryDesk() {
    const commentary = useStateStore(s => s.commentary);
    const liveSlots = useMemo(
        () => (Array.isArray(commentary?.slots) ? commentary.slots : []),
        [commentary],
    );
    const pending = usePending('commentary');
    const slots = useMemo(
        () => seated(pending ? pending.value : liveSlots),
        [pending, liveSlots],
    );

    // The address book, for what each sub-plate field will SAY. It is REST, not
    // the socket store, so nothing loads it until something asks.
    const { participants, load } = useParticipantsStore(useShallow(s => ({
        participants: s.participants, load: s.load,
    })));
    useEffect(() => { load(); }, [load]);
    const rowById = useMemo(
        () => Object.fromEntries(participants.map(p => [p.id, p])),
        [participants],
    );

    // participantId → resolved display name, from the server-side projection of
    // the LIVE slots (staged drafts may be reordered, so index lookups lie).
    const nameById = useMemo(() => {
        const out = {};
        liveSlots.forEach((s, i) => {
            const n = commentary?.[i]?.name ?? commentary?.[String(i)]?.name;
            if (s?.participantId && n) out[s.participantId] = n;
        });
        return out;
    }, [commentary, liveSlots]);
    const rowFor = (slot) => (slot?.participantId && rowById[slot.participantId]) || null;
    const nameFor = (slot) => {
        const row = rowFor(slot);
        return slot?._name
            || (slot?.participantId && nameById[slot.participantId])
            || row?.display?.tag || row?.identities?.rioName || '';
    };

    // Each slot's plate on the strip, 1-based, or null for a seat that draws
    // none — the same `name && visible` gather the mount does.
    const plateOf = useMemo(() => {
        let n = 0;
        return slots.map(s => (isOnStrip(s) ? ++n : null));
    }, [slots]);

    const setSlots = (next) => stageOrRun({
        key: 'commentary',
        label: 'Commentary desk',
        value: next,
        run: () => setCommentarySlots(next.map(({ _name, ...s }) => s)),
    });

    return {
        slots, staged: !!pending, nameFor, rowFor, plateOf,
        update: (i, patch) => setSlots(slots.map((s, j) => (j === i ? { ...s, ...patch } : s))),
        reorder: (from, to) => {
            if (from === to || from < 0 || to < 0 || from >= slots.length || to >= slots.length) return;
            const next = slots.slice();
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            setSlots(next);
        },
    };
}

/*
 * The sheet's rails. Narrow: order · on air · caster, with the sub-plate on a
 * second line under the caster. Wide: all on one line, the
 * caster capped at a name's width and the sub-plate at a field-and-value's —
 * past that a wider box is only emptier.
 *
 * The leftover width goes to a SPACER track (the trailing `1fr`), never to
 * the controls, and it has to be named: a grid with no flexible track hands its
 * free space to every `auto` track, so the On-air column swelled to a third of
 * the panel with its switch stranded at the left of it.
 */
const SHEET = cn(
    'grid items-center gap-x-3',
    'grid-cols-[auto_auto_minmax(0,1fr)]',
    '@2xl:grid-cols-[auto_auto_minmax(0,15rem)_minmax(0,26rem)_minmax(0,1fr)]',
);
const ROW = 'col-span-full grid grid-cols-subgrid items-center gap-y-1.5';
const COL_LABEL = 'label-display text-[10px] tracking-wider text-muted-foreground/70';

// Where the plate lands, as a mono numeral — or a dash, with the reason.
const PlateNumeral = memo(function PlateNumeral({ plate, slot }) {
    const why = plate
        ? `Plate ${plate} on the strip, counting from the left`
        : !slot.participantId
            ? 'No caster picked — this seat draws nothing'
            : 'Hidden — not on the strip';
    return (
        <span
            title={why}
            className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-md border font-mono text-xs tabular-nums',
                plate
                    ? 'border-foreground/20 bg-foreground/5 text-foreground'
                    : 'border-dashed border-border text-muted-foreground',
            )}
        >
            {plate ?? '–'}
        </span>
    );
});

const CasterRow = memo(function CasterRow({ i, slot, desk }) {
    const visible = slot.visible !== false;
    /*
     * ONE control for the sub-plate: the field picker, whose "No sub-plate" is
     * how it goes away. There used to be a switch beside it as well, and the
     * pair could say three things (a field and on, a field and off, no field)
     * where a producer means two — so a slot still carrying the old `subVisible:
     * false` READS as no sub-plate, which is what the strip is drawing, and any
     * pick writes the flag back to true so the field it names is the one on air.
     */
    const subField = slot.subVisible !== false ? (slot.subField || '') : '';
    const who = desk.nameFor(slot);
    const seat = `Caster ${i + 1}`;
    return (
        <div className={cn(ROW, 'py-2')} role="group" aria-label={who || seat}>
            <div className="flex items-center gap-1.5">
                <PlateNumeral plate={desk.plateOf[i]} slot={slot} />
                <MoveButtons
                    label={`caster ${i + 1}`}
                    canUp={i > 0} canDown={i < desk.slots.length - 1}
                    onUp={() => desk.reorder(i, i - 1)}
                    onDown={() => desk.reorder(i, i + 1)}
                />
            </div>

            <Switch
                checked={visible}
                onCheckedChange={(v) => desk.update(i, { visible: v })}
                aria-label={`${seat} on air`}
                title={visible ? 'On the strip — switch off to hide' : 'Hidden — switch on to show'}
            />

            <div className={cn('min-w-0 transition-opacity', !visible && 'opacity-50')}>
                <ParticipantPicker
                    value={who}
                    selectedId={slot.participantId || null}
                    onResolve={(picked) => desk.update(i, {
                        participantId: picked.id,
                        _name: picked.display?.tag || picked.identities?.rioName || '',
                    })}
                    placeholder="Pick a caster…"
                    className="font-medium"
                />
            </div>

            {/* Narrow: the second line, under the caster (column 3). Wide: its
                own column on the first. */}
            <div
                className={cn(
                    'col-start-3 row-start-2 min-w-0 transition-opacity',
                    '@2xl:col-start-4 @2xl:row-start-1',
                    !visible && 'opacity-50',
                )}
            >
                <SubFieldPicker
                    value={subField}
                    onChange={(v) => desk.update(i, { subField: v, subVisible: true })}
                    participant={desk.rowFor(slot)}
                    who={who}
                    ariaLabel={`${seat} sub-plate`}
                />
            </div>
        </div>
    );
});

/*
 * The seats' show/hide, as the rail card's strip: one chip per SEATED caster,
 * named, lit while their plate is on the strip. The desk's own staged write, so
 * a flip here is the same whole-array stage as the switch on the stage panel.
 *
 * An empty desk says so rather than drawing nothing — the chips are the card's
 * only row, and a card with a header alone would read as a broken one.
 */
export const CommentarySeatChips = memo(function CommentarySeatChips() {
    const desk = useCommentaryDesk();
    const seats = desk.slots
        .map((slot, i) => ({ slot, i }))
        .filter(({ slot }) => slot?.participantId);
    if (seats.length === 0) {
        return <Text size="xs" className="text-muted-foreground">No casters seated</Text>;
    }
    return (
        <ToggleChips>
            {seats.map(({ slot, i }) => (
                <ToggleChip
                    key={i} label={desk.nameFor(slot) || `Seat ${i + 1}`}
                    checked={slot.visible !== false} staged={desk.staged}
                    onChange={(v) => desk.update(i, { visible: v })}
                />
            ))}
        </ToggleChips>
    );
});

export default function CommentaryStage({ element, placement }) {
    const desk = useCommentaryDesk();

    return (
        <>
            <DirectStage element={element} placement={placement} />
            {desk.staged && (
                <Group gap="xs" className="items-center">
                    <StagedDot show />
                    <Text size="xs" className="text-amber-400">Desk changes staged</Text>
                </Group>
            )}

            <div
                className={cn(
                    SHEET,
                    'rounded-md border bg-background/40 px-3 divide-y divide-border/60',
                    desk.staged ? 'border-amber-400/40' : 'border-border/60',
                )}
            >
                {/* Column labels only where the columns ARE columns. Narrow, the
                    sub-plate is a second line and a header row would label a
                    rail it no longer sits on. */}
                <div className={cn(ROW, 'hidden pb-1.5 pt-2 @2xl:grid')} aria-hidden>
                    <span className={COL_LABEL}>Plate</span>
                    <span className={COL_LABEL}>On air</span>
                    <span className={COL_LABEL}>Caster</span>
                    <span className={COL_LABEL}>Sub-plate</span>
                </div>

                {desk.slots.map((slot, i) => <CasterRow key={i} i={i} slot={slot} desk={desk} />)}
            </div>
        </>
    );
}
