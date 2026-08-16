import { memo, useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Link2, X } from 'lucide-react';
import { Stack, Text } from '../../components/ui/primitives';
import { Panel } from '../../components/ui/panel';
import { TextField } from '../../components/ui/text-field';
import { Button } from '../../components/ui/button';
import { notifications } from '../../lib/notify';
import { useStateStore } from '../../context/store';
import { setOrganizers, MAX_ORGANIZERS } from '../../context/organizers';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import ParticipantPicker from '../../components/ParticipantPicker';

/*
 * ORGANIZERS ARE ADDRESS-BOOK REFERENCES, not nine text fields.
 *
 * They used to be three trios of free text — name, twitter, pronoun — which made
 * this the third place the same person's handle was typed (a commentary slot and
 * a player row being the others), with nothing keeping the copies in agreement.
 * Picking the registry row instead means one edit in Address Book reflows
 * everywhere, the same resolve-by-copy contract Match, Commentary and
 * PlayerPlates already run on.
 *
 * The projected keys are unchanged (`organizer_{i}_{name,twitter,pronoun}`), so
 * a producer with an OBS text source pointed at the stream_labels .txt mirror
 * keeps working.
 *
 * LEGACY TEXT IS LEFT ALONE until the producer picks someone. A projector owns
 * its key set and writes it whole, so projecting over hand-typed organizers
 * would erase them — `tournamentInfo.organizers` being ABSENT is what says "this
 * has never been authored" (server/organizers.py). The first pick authors the
 * list, and from then on the registry is the source. The note below is the one
 * warning a producer gets, and it only shows while there is text to lose.
 */
export const OrganizerRows = memo(function OrganizerRows() {
    /*
     * FLAT PRIMITIVES ONLY. `useShallow` compares one level, so a selector that
     * builds the three slots as an array of objects hands back a new reference
     * every call, never compares equal, and re-renders forever — React error
     * #185, which is exactly how this first ran. `organizers` is returned as the
     * state's own array so its reference IS stable; everything else is a string.
     */
    const org = useStateStore(useShallow(s => {
        const info = s?.tournamentInfo ?? {};
        return {
            authored: Array.isArray(info.organizers) ? info.organizers : null,
            n0: info.organizer_0_name || '', t0: info.organizer_0_twitter || '', p0: info.organizer_0_pronoun || '',
            n1: info.organizer_1_name || '', t1: info.organizer_1_twitter || '', p1: info.organizer_1_pronoun || '',
            n2: info.organizer_2_name || '', t2: info.organizer_2_twitter || '', p2: info.organizer_2_pronoun || '',
        };
    }));

    const slots = useMemo(() => Array.from({ length: MAX_ORGANIZERS }, (_, i) => ({
        name: org[`n${i}`], twitter: org[`t${i}`], pronoun: org[`p${i}`],
    })), [org]);

    const legacy = org.authored === null && slots.some(s => s.name || s.twitter || s.pronoun);

    const assign = useCallback(async (index, participantId) => {
        const next = Array.from({ length: MAX_ORGANIZERS }, (_, i) => ({
            participantId: (org.authored?.[i]?.participantId) ?? null,
        }));
        next[index] = { participantId };
        try {
            await setOrganizers(next);
        } catch (e) {
            notifications.show({ message: `Organizers: ${e?.message || e}`, color: 'red' });
        }
    }, [org.authored]);

    return (
        <Stack gap="xs">
            {slots.map((slot, i) => {
                const meta = [slot.twitter, slot.pronoun].filter(Boolean).join(' · ');
                const filled = slot.name || org.authored?.[i]?.participantId;
                return (
                    <div className="flex items-center gap-2" key={i}>
                        <div className="min-w-0 flex-1">
                            <ParticipantPicker
                                value={slot.name}
                                selectedId={org.authored?.[i]?.participantId ?? null}
                                onResolve={(row) => assign(i, row?.id ?? null)}
                                placeholder={`Organizer ${i + 1}`}
                            />
                        </div>
                        {/* Read-only: these come from the picked row, so the edit
                            belongs in Address Book. Showing them anyway is what
                            makes it obvious WHICH record got picked — which is
                            also why an EMPTY slot draws nothing here rather than
                            an em dash. Three "—" down the side of three empty
                            pickers is a column of punctuation saying only that
                            the rows above it are empty, which they already say. */}
                        {meta && (
                            <Text size="xs" dimmed truncate className="min-w-0 max-w-[14rem]">{meta}</Text>
                        )}
                        {/* Holds its place, so the pickers keep one right edge
                            instead of stepping in and out as slots are filled. */}
                        <div className="w-7 shrink-0">
                            {filled && (
                                <Button
                                    size="xs" variant="ghost" aria-label={`Clear organizer ${i + 1}`}
                                    onClick={() => assign(i, null)}
                                >
                                    <X size={13} />
                                </Button>
                            )}
                        </div>
                    </div>
                );
            })}
            {/*
             * The legacy warning ONLY. The standing note underneath ("socials and
             * pronouns come from the Address Book…") explained the mechanism to a
             * producer who had asked nothing: it was true of every row, so it was
             * never news, and it sat under three pickers whose whole visible
             * behaviour already is "pick a person, their details appear beside
             * them". A note that restates what the surface demonstrates is a line
             * every producer reads once and scrolls past forever.
             *
             * This one survives because it is CONDITIONAL and it warns about a
             * loss: hand-typed organizers from an older version are erased by the
             * first pick, and nothing else on the panel says so.
             */}
            {legacy && (
                <Text size="xs" dimmed>
                    Typed by hand on an older version. Picking anyone here replaces all three
                    with Address Book entries.
                </Text>
            )}
        </Stack>
    );
});

/*
 * WHICH FIELDS START.GG IS STILL DRIVING.
 *
 * Five of these are auto-filled by a tournament load and a sixth — the phase —
 * by every set load, but only while the producer hasn't typed over them: the
 * server records what it last filled in `tournamentInfo._auto` and stops
 * overwriting a field that differs from it (`auto_fill_entries`,
 * server/startgg/provider.py). That rule was invisible here, so a field could
 * silently change under a producer who thought they owned it, or stubbornly
 * refuse to update because of an edit they'd forgotten making.
 *
 * The marker states which case a field is in.
 */
function useTrackingStartGG(field) {
    return useStateStore(s => {
        const info = s?.tournamentInfo ?? {};
        const auto = info._auto ?? {};
        return field in auto && (info[field] ?? '') === (auto[field] ?? '');
    });
}

/*
 * THE MARKER RIDES THE INPUT, NOT THE LABEL.
 *
 * It was "from start.gg" appended to the label text — eleven characters of
 * suffix on labels as short as "Entrants", inside a 91px column. The label
 * wrapped onto a second line and collided with the one beside it: the panel
 * read "ENTRANTS from PRIZE / start.gg". A label has to fit its field's width,
 * and this one grew with a value that had nothing to do with the field's size.
 *
 * As an adornment inside the input it costs the label nothing at any width, it
 * lands in the same place on all six auto-filled fields, and it sits on the
 * thing it actually describes — where the VALUE came from, not what the field
 * is. The tooltip carries the sentence the suffix used to imply.
 */
const AutoMark = memo(function AutoMark({ field }) {
    const tracking = useTrackingStartGG(field);
    if (!tracking) return null;
    return (
        <SimpleTooltip label="Filled from start.gg — type here to take it over">
            <Link2 size={12} className="text-muted-foreground/70" />
        </SimpleTooltip>
    );
});

export default function TournamentInfo() {
    const setItem = useStateStore(s => s.setItem);

    // Subscribe to individual fields to avoid referential equality issues
    const name         = useStateStore(s => s?.tournamentInfo?.name ?? '');
    const event_name   = useStateStore(s => s?.tournamentInfo?.event_name ?? '');
    const phase        = useStateStore(s => s?.tournamentInfo?.phase ?? '');
    // No `message` here on purpose: the banner line is the Event Header's own
    // copy and nothing else reads it, so it is authored on that element's
    // Production stage panel (overlays.eventheader.message). This form is for
    // facts about the competition — the things several overlays read and
    // start.gg fills in.
    const abbreviation = useStateStore(s => s?.tournamentInfo?.abbreviation ?? '');
    const location     = useStateStore(s => s?.tournamentInfo?.location ?? '');
    const date         = useStateStore(s => s?.tournamentInfo?.date ?? '');
    const entrants     = useStateStore(s => s?.tournamentInfo?.entrants ?? '');
    const prize_pool   = useStateStore(s => s?.tournamentInfo?.prize_pool ?? '');

    const set = useCallback((field, value) => {
        setItem(`tournamentInfo.${field}`, value);
    }, [setItem]);

    return (
        /*
         * JUST THE FORM. It used to be a 12-column grid holding the entrants
         * table as its right-hand column, which made the FORM's width a function
         * of whether a tournament had been loaded: `col-span-4` with entrants,
         * `col-span-12` without, so the same nine fields were 437px or 1326px
         * wide and neither number was chosen for the form. Empty, it put "Top 8"
         * in a 1326px box.
         *
         * The page (../competition) owns the layout now and gives this a fixed
         * width; the entrants table is a peer of the bracket's sets table in the
         * one right-hand column, which is what they always were.
         */
        <Panel title="Competition Info">
            <Stack gap="sm" className="p-4">
                {/* One grid, and each field spans what its VALUE needs —
                    a date is ten characters and had a 437px box, an
                    entrant count is three and had the same. Short fields
                    share a row instead of each taking one. */}
                <div className="grid grid-cols-12 items-start gap-x-3 gap-y-2">
                    <div className="col-span-12 sm:col-span-8">
                        <TextField label="Competition Name" rightSection={<AutoMark field="name" />} placeholder="Enter competition name" value={name} onChange={e => set('name', e.currentTarget.value)} />
                    </div>
                    <div className="col-span-12 sm:col-span-4">
                        <TextField label="Abbreviation" placeholder="Short name" value={abbreviation} onChange={e => set('abbreviation', e.currentTarget.value)} />
                    </div>

                    <div className="col-span-12 sm:col-span-8">
                        <TextField label="Event Name" rightSection={<AutoMark field="event_name" />} placeholder="e.g. Stars Off" value={event_name} onChange={e => set('event_name', e.currentTarget.value)} />
                    </div>
                    {/* The phase is filled by every SET load, not by the
                        event load — the one field here a fixture can
                        change mid-broadcast. */}
                    <div className="col-span-12 sm:col-span-4">
                        <TextField label="Phase" rightSection={<AutoMark field="phase" />} placeholder="e.g. Top 8" value={phase} onChange={e => set('phase', e.currentTarget.value)} />
                    </div>

                    <div className="col-span-12 sm:col-span-5">
                        <TextField label="Location" rightSection={<AutoMark field="location" />} placeholder="City, State" value={location} onChange={e => set('location', e.currentTarget.value)} />
                    </div>
                    <div className="col-span-4 sm:col-span-3">
                        <TextField label="Date" rightSection={<AutoMark field="date" />} placeholder="YYYY-MM-DD" value={date} onChange={e => set('date', e.currentTarget.value)} />
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                        <TextField label="Entrants" rightSection={<AutoMark field="entrants" />} placeholder="0" value={String(entrants)} onChange={e => set('entrants', e.currentTarget.value)} />
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                        <TextField label="Prize" placeholder="$0" value={prize_pool} onChange={e => set('prize_pool', e.currentTarget.value)} />
                    </div>
                </div>

                {/* An eyebrow, not a captioned rule. The centred
                    `Divider label` drew two hairlines across the panel to
                    introduce three rows, which is more chrome than the
                    section it announces — and the unlabelled Divider
                    above it split the fields for no stated reason at all. */}
                <Text size="xs" className="label-display pt-1 text-muted-foreground">Organizers</Text>
                <OrganizerRows />
            </Stack>
        </Panel>
    );
}
