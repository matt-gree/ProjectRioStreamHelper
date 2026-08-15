import { memo, useState } from 'react';
import { Eye, EyeOff, ArrowUpDown } from 'lucide-react';
import { Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import { boardOfUrl } from '../../../lib/obs-binding';
import { LAYOUT_SETTINGS } from '../../layouts/designConstants';
import { IconToggle, TextRow } from '../kit';
import { MoveButtons, StagedDot } from '../controls';
import { BANDS, FIELDS, useBands, useFieldValues, fieldValue } from '../eventheader';
import { DirectStage } from './generic';
import { OverlaySettingChip, OverlaySettingRows, useOverlaySettings } from './overlay-settings';

/*
 * Event Header stage — the two bands, each an ORDERED LIST of fields.
 *
 * THE PANEL IS THE BAND. Each region is a ribbon carrying that band's fields
 * left→right in the order they draw, with ◀ ▶ to move the selected one and an
 * eye per segment; below both, the selected field's editor. That is the Lower
 * Third's master/detail, and for the same reason: an arrangement is read off a
 * picture of the thing, not off a list of settings sorted by control type.
 *
 * What it replaces: seven booleans in registry order, one per field, with the
 * ORDER itself hardcoded in the overlay's render call. A producer could hide the
 * location but never put the dates first, and the only field they could write
 * was the message. Now every field carries a `text` override — blank falls back
 * to its source — and a field can move along its band or across to the other,
 * which is the same edit either way (see ../eventheader).
 *
 * The band's own on/off and its offset ride the region's heading rule: the
 * eyebrow names the band, so a chip repeating that name in the rows below it was
 * the label said twice, and the offset belongs to the strip it nudges.
 */

const BOTH_KEYS = LAYOUT_SETTINGS.eventheader
    .filter(d => d.group === 'Both bands')
    .map(d => d.key);

export function useEventHeader() {
    return useOverlaySettings('eventheader', 'eventheader', 'Event header');
}

// The bands' on/off pair — also the rail quick face.
export const EventHeaderBandRows = memo(function EventHeaderBandRows({ os }) {
    return <OverlaySettingRows os={os} type="eventheader" keys={BANDS.map(b => b.master)} />;
});

/*
 * One band, as a ribbon of its fields.
 *
 * A segment is lit when it is on AND has something to draw, dimmed when it is on
 * but empty — which is a real and previously invisible state, since a field with
 * nothing behind it drops out of the band however its switch is set — and quiet
 * when it is switched off. Selecting a segment opens its editor below; the eye
 * shows and hides it, beside the result rather than in a panel across the page.
 *
 * Segments are content-width, not proportional. The Lower Third's ribbon weights
 * its slots because the band's segments are genuinely unequal and theme-owned;
 * these are text fields separated by a glyph, so their widths ARE their content,
 * and faking a proportion would be a promise the overlay doesn't keep.
 */
const BandRibbon = memo(function BandRibbon({ band, label, master, offset, os, values, selected, onSelect }) {
    const { bands, set, staged } = useBands();
    const entries = bands[band];

    const move = (from, to) => {
        if (to < 0 || to >= entries.length) return;
        const next = { ...bands, [band]: [...entries] };
        [next[band][from], next[band][to]] = [next[band][to], next[band][from]];
        set(next, `${FIELDS[entries[from].id].label} moved`);
        onSelect({ band, index: to });
    };
    const toggle = (i) => {
        const next = { ...bands, [band]: entries.map((e, n) => (n === i ? { ...e, on: !e.on } : e)) };
        set(next, `${FIELDS[entries[i].id].label} ${entries[i].on ? 'hidden' : 'shown'}`);
    };

    const sel = selected.band === band ? selected.index : -1;

    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex min-h-6 flex-wrap items-center gap-2">
                <Text size="xs" className="label-display shrink-0 text-muted-foreground">{label}</Text>
                <OverlaySettingChip os={os} def={LAYOUT_SETTINGS.eventheader.find(d => d.key === master)} />
                {/* One staged arrangement covers BOTH bands — they share a
                    settings key, because moving a field across is one edit to
                    two arrays and confirming half of it would leave the field
                    in both bands or in neither. */}
                <StagedDot show={staged} />
                <div className="ml-auto flex min-w-0 items-center">
                    <OverlaySettingRows os={os} type="eventheader" keys={[offset]} />
                </div>
            </div>

            <div className="flex min-w-0 items-center gap-2">
                <MoveButtons
                    axis="x" label={sel >= 0 ? FIELDS[entries[sel].id].label : 'field'}
                    canUp={sel > 0} canDown={sel >= 0 && sel < entries.length - 1}
                    onUp={() => move(sel, sel - 1)} onDown={() => move(sel, sel + 1)}
                />
                <div
                    role="tablist" aria-label={`${label} fields`}
                    className="flex min-w-0 flex-1 flex-wrap items-stretch gap-1 rounded-md border border-border bg-card/40 p-1"
                >
                    {entries.map((e, i) => {
                        const drawn = fieldValue(e, values);
                        const live = e.on && !!drawn;
                        const isSel = i === sel;
                        return (
                            <div
                                key={e.id}
                                className={cn(
                                    'flex min-w-0 items-center gap-1 rounded pr-1 transition-colors',
                                    live ? 'bg-rio-500/15' : 'bg-card',
                                    !e.on && 'opacity-60',
                                    isSel && 'ring-1 ring-rio-400',
                                )}
                            >
                                <button
                                    type="button" role="tab" aria-selected={isSel}
                                    /* The visible face is position · name ·
                                       value; the accessible name is the field
                                       and its place, because the value changes
                                       under the producer and a name that moves
                                       is not a name. */
                                    aria-label={`${FIELDS[e.id].label} — position ${i + 1} of ${entries.length}`}
                                    onClick={() => onSelect({ band, index: i })}
                                    className="flex min-h-10 min-w-0 flex-col justify-center gap-0.5 rounded py-1 pl-2 text-left"
                                >
                                    <div className="flex min-w-0 items-center gap-1.5">
                                        {/* The position, so a segment maps to the
                                            order the band actually draws in. */}
                                        <Text
                                            size="xs" span
                                            className="shrink-0 font-mono tabular-nums text-[10px] text-muted-foreground/70"
                                        >
                                            {i + 1}
                                        </Text>
                                        <Text
                                            size="xs" span truncate
                                            className={cn('min-w-0', live ? 'text-rio-300' : 'text-muted-foreground')}
                                        >
                                            {FIELDS[e.id].label}
                                        </Text>
                                    </div>
                                    {/* The VALUE, not the field name again — what a
                                        producer checks on a glance is whether the
                                        strip says the right thing, and a field with
                                        nothing behind it is absent from the band
                                        however its eye is set. */}
                                    <Text span truncate className="min-w-0 max-w-56 text-[10px] text-muted-foreground/80">
                                        {drawn || 'Nothing behind it'}
                                    </Text>
                                </button>
                                <IconToggle
                                    icon={Eye} offIcon={EyeOff} on={e.on}
                                    label={`${e.on ? 'Hide' : 'Show'} ${FIELDS[e.id].label}`}
                                    onClick={() => toggle(i)}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
});

/*
 * The selected field's editor.
 *
 * One control, and it is the one that was missing: every field can be WRITTEN
 * now. Blank falls back to the source, which the placeholder shows, so the field
 * states both what it will draw and where that comes from — the note under it is
 * what the old panel could only say about three fields at once, in a paragraph
 * at the foot, with no way to act on it.
 */
const FieldEditor = memo(function FieldEditor({ selected, onSelect, values }) {
    const { bands, set } = useBands();
    const { band, index } = selected;
    const e = bands[band]?.[index];
    if (!e) return null;

    const field = FIELDS[e.id];
    const source = values[e.id];
    const other = BANDS.find(b => b.band !== band);

    const write = (text) => {
        const next = { ...bands, [band]: bands[band].map((x, n) => (n === index ? { ...x, text } : x)) };
        set(next, `${field.label} text`);
    };
    const moveBand = () => {
        const next = {
            ...bands,
            [band]: bands[band].filter((_, n) => n !== index),
            [other.band]: [...bands[other.band], e],
        };
        set(next, `${field.label} → ${other.label.toLowerCase()}`);
        onSelect({ band: other.band, index: next[other.band].length - 1 });
    };

    return (
        // The accent ring the selected segment wears, repeated here: it is the
        // only thing that says THIS editor belongs to THAT segment.
        <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-rio-400/35 p-3">
            <div className="flex min-h-7 flex-wrap items-center gap-2">
                <Text size="xs" span className="label-display shrink-0 text-muted-foreground">
                    {field.label}
                </Text>
                {!e.on && (
                    <Text size="xs" span className="text-muted-foreground">Hidden — not in the band</Text>
                )}
                <Button
                    size="xs" variant="secondary" className="ml-auto h-7 shrink-0"
                    onClick={moveBand}
                >
                    <ArrowUpDown />
                    Move to {other.label.toLowerCase()}
                </Button>
            </div>

            <TextRow
                label="Text" value={e.text}
                placeholder={source || (field.where ? `Blank — nothing in ${field.where}` : 'Type the line to show')}
                onChange={write}
            />
            <Text size="xs" className="text-muted-foreground">
                {field.where
                    ? (source
                        ? `Blank uses ${field.where}.`
                        : `Nothing in ${field.where} yet — this field stays out of the band until something fills it.`)
                    : 'This field has no source: what you type here is all it draws.'}
            </Text>
        </div>
    );
});

export default function EventHeaderStage({ element, placement }) {
    const os = useEventHeader();
    // Which segment the editor below is showing. View state, never broadcast —
    // it goes nowhere near Settings or the staging gateway.
    const [selected, setSelected] = useState({ band: 'header', index: 0 });
    const values = useFieldValues(boardOfUrl(placement?.item?.url) ?? 1);

    return (
        <>
            <DirectStage element={element} placement={placement} />

            <div className="mt-1 flex flex-col gap-3 border-t border-border/60 pt-2">
                {BANDS.map(b => (
                    <BandRibbon
                        key={b.band} {...b} os={os} values={values}
                        selected={selected} onSelect={setSelected}
                    />
                ))}
                <FieldEditor selected={selected} onSelect={setSelected} values={values} />
            </div>

            <div className="mt-1 flex flex-col gap-1.5 border-t border-border/60 pt-2">
                <Text size="xs" className="label-display text-muted-foreground">Both bands</Text>
                {/* The shared look, in the same column budget SettingGroups uses
                    — a settings row is ~240px, so a stage panel fits three. */}
                <div className="grid gap-x-6 gap-y-1.5 @3xl:grid-cols-2 @6xl:grid-cols-3">
                    <OverlaySettingRows os={os} type="eventheader" keys={BOTH_KEYS} />
                </div>
            </div>
        </>
    );
}

// Everything, so the Style section renders nothing. A catch-all is for settings
// a body chose not to lead with; this body's regions ARE the whole panel, and a
// "Style" heading under it would be a region the overlay does not have.
EventHeaderStage.surfacedKeys = LAYOUT_SETTINGS.eventheader.map(d => d.key);
