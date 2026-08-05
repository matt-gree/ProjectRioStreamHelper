import { memo, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Eye, EyeOff, RotateCcw } from 'lucide-react';
import { useStateStore } from '../../../context/store';
import { useStagingStore, confirmModeEnabled } from '../../../context/staging';
import { Stack, Group, Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { notifications } from '../../../lib/notify';
import { cn } from '../../../lib/utils';
import {
    ActionRow, FieldRow, IconToggle, KIT_INPUT, NumberRow, SegmentedRow, SelectRow, TextRow,
} from '../kit';
import { MoveButtons, StagedDot, stageStateSet } from '../controls';
import { matchDisplayLabel } from '../matches';
import { useActiveBoards, useBoardLabel } from '../boards';
import { BracketPhasePicker, useBracketDesk } from '../desks/bracket';
import { DirectStage } from './generic';

/*
 * DIRECTION CONTRACT
 *
 * THESIS: The break band is a rundown, and this panel is its sheet. It refuses
 * the card-grid arrangement — five bespoke cards reflowing 1→2→3→5 columns,
 * which lied about the band's unequal theme-owned widths and lost slot order
 * at every narrow width.
 * OWN-WORLD: The console's existing dark row kit, unchanged. One ruled sheet,
 * not five cards; strict column rails; mono position numerals and mono timing.
 * STORY: The producer reads the band's shape off the ribbon, picks the segment
 * they mean, and edits it in place beneath.
 * FIRST VIEWPORT: A proportional band ribbon carrying all five slots — lit on
 * air, dimmed when off, dashed when empty — flanked by ◀ ▶ that move the
 * selected slot; beneath it, that slot's editor.
 * FORM: Rundown sheet; candidate 4 of the grounded list; seed key 40048ccf.
 * The ribbon-as-selector and its ◀ ▶ are USER-PINNED (2026-07-31), which beats
 * the roll: the sheet of five open rows became this master/detail.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, and DESIGN.md.
 */

/*
 * Lower Third (Break) stage — a direct element with rich authoring: the band
 * is FIVE independently toggleable SLOTS (lowerthird.slots.1..5, left→right),
 * each carrying one content type — logo · match · scorebox · merch · clock ·
 * message · bracket, plus the structural `space`.
 *
 * Rows are the authoring surface and they never wrap: a row's fields live in
 * its own content cell, so a taller row shares the sheet's column rails
 * instead of ragging the row beside it. Every slot's editor is open at all
 * times — a producer mid-break should never have to remember which collapsed
 * row holds the countdown — which the full row width now affords honestly.
 *
 * Values are written (through the staging gateway) to lowerthird.* state,
 * which the SVG overlay renders; segment widths/looks belong to the active
 * design package's theme. Putting the band on air is still the OBS source
 * toggle. Clock START/PAUSE/RESET are transport — momentary, always immediate
 * — while slot content/config stages like other content.
 */

const LT_SLOT_COUNT = 5;
const LT_TYPE_OPTIONS = [
    { value: '', label: '— Empty —' },
    { value: 'logo', label: 'Logo + Title' },
    { value: 'match', label: 'Match' },
    { value: 'scorebox', label: 'Scorebox' },
    { value: 'merch', label: 'Merch / Ad' },
    { value: 'clock', label: 'Timer / Clock' },
    { value: 'message', label: 'Message' },
    { value: 'bracket', label: 'Bracket' },
    { value: 'space', label: 'Space (split)' },
];

const LT_TYPE_SHORT = {
    logo: 'Logo', match: 'Match', scorebox: 'Scorebox', merch: 'Merch',
    clock: 'Clock', message: 'Message', bracket: 'Bracket', space: 'Space',
};

/*
 * Ribbon proportions ONLY. Read off the segment templates in
 * lowerthird-mount.js (a match segment's names run to data-maxw 420 with
 * scores at x=500; a logo's title stops around 215), they put the five slots
 * in roughly the ratio the band gives them. The THEME owns the real widths —
 * so this is orientation, never a promise of pixels, and the caption under the
 * ribbon says so.
 */
const TYPE_WEIGHT = {
    logo: 1.4, match: 3.4, scorebox: 2.8, merch: 2.7,
    clock: 1.4, message: 3, bracket: 2.6,
};

// Curated time zones for the time-of-day clock. '' = the streaming machine's
// local zone (the default). IANA ids are passed straight to Intl; the overlay
// falls back to local time if a zone is somehow unsupported.
const CLOCK_TIMEZONES = [
    { value: '', label: 'System default' },
    { value: 'America/New_York', label: 'Eastern (New York)' },
    { value: 'America/Chicago', label: 'Central (Chicago)' },
    { value: 'America/Denver', label: 'Mountain (Denver)' },
    { value: 'America/Phoenix', label: 'Arizona (Phoenix)' },
    { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
    { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
    { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
    { value: 'UTC', label: 'UTC' },
    { value: 'Europe/London', label: 'London' },
    { value: 'Europe/Paris', label: 'Central Europe (Paris)' },
    { value: 'Asia/Tokyo', label: 'Tokyo' },
    { value: 'Australia/Sydney', label: 'Sydney' },
];

// Re-render once per ~500ms so the live clock readout ticks.
function useTick(ms = 500, on = true) {
    const [, force] = useState(0);
    useEffect(() => {
        if (!on) return;
        const id = setInterval(() => force(n => n + 1), ms);
        return () => clearInterval(id);
    }, [ms, on]);
}

// lowerthird.* with staged-value display: `val('slots.1.title', live)` returns
// the pending value when one is staged; `setKey` routes through the staging
// gateway. `slot(i)` reads one authored slot's object — a staged whole-slot
// value (a reorder swap) wins over live, so repeated moves compose before a
// commit. One subscription to the pending map covers every field. `swap`
// exchanges two positions wholesale (slot objects carry all their content, so
// a move keeps titles/clock/etc. with the slot).
function useLowerThird() {
    const lt = useStateStore(useShallow(s => s?.lowerthird ?? {}));
    const matches = useStateStore(useShallow(s => s?.match ?? {}));
    const pendingMap = useStagingStore(s => s.pending);
    const slot = (i) => {
        const p = pendingMap[`state:lowerthird.slots.${i}`];
        if (p) return p.value || {};
        return (lt.slots || {})[i] || (lt.slots || {})[String(i)] || {};
    };
    const val = (key, live) => {
        const p = pendingMap[`state:lowerthird.${key}`];
        return p ? p.value : live;
    };
    const isStaged = (key) => !!pendingMap[`state:lowerthird.${key}`];
    const setKey = (key, value, label) =>
        stageStateSet(`lowerthird.${key}`, value, label || `Lower third: ${key}`);
    const swap = (i, j) => {
        if (j < 1 || j > LT_SLOT_COUNT || i === j) return;
        const a = slot(i);
        const b = slot(j);
        // Live mode: one atomic batch — two sequential sets would flash a
        // duplicated slot on an on-air band for a frame. Confirm mode: two
        // staged whole-slot entries so both rows show/dot their pending value.
        if (!confirmModeEnabled()) {
            useStateStore.getState().setItems([
                { key: `lowerthird.slots.${i}`, value: b },
                { key: `lowerthird.slots.${j}`, value: a },
            ]);
            return;
        }
        setKey(`slots.${i}`, b, `Lower third: slot ${j} → ${i}`);
        setKey(`slots.${j}`, a, `Lower third: slot ${i} → ${j}`);
    };
    return { lt, matches, slot, val, isStaged, setKey, swap };
}

function fmtRemaining(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}

/*
 * One line saying what a segment is actually carrying — the thing that makes a
 * taller ribbon worth its height. A type name alone ("Merch", "Clock") is the
 * same on a band with four slots as on a band with one; the CONTENT is what a
 * producer is checking when they glance at the rundown mid-break.
 */
function slotSummary(slot, type, ctx) {
    const t = (v) => (v == null ? '' : String(v).trim());
    switch (type) {
        case 'logo': return t(slot.title) || 'No caption';
        case 'match': return slot.matchId != null && slot.matchId !== ''
            ? matchDisplayLabel(ctx.matches, String(slot.matchId)) : 'No match picked';
        case 'scorebox': return ctx.boardLabel(parseInt(slot.scoreboard) || ctx.firstBoard);
        case 'merch': return t(slot.title) || t(slot.image) || 'Nothing picked';
        case 'clock': return CLOCK_MODE_SHORT[(slot.clock || {}).mode || 'off'];
        case 'message': return t(slot.title) || 'No title';
        case 'bracket': return t(slot.title) || 'Loaded phase';
        case 'space': return slot.width ? `${slot.width}px gap` : 'Flexible';
        default: return 'Pick a type';
    }
}

const CLOCK_MODE_SHORT = {
    off: 'Off', countdown: 'Countdown', countup: 'Count up', clock: 'Time of day',
};

/*
 * The band ribbon — the panel's control surface, and a scale model of the band.
 *
 * Every one of the five slots has a segment here, because the ribbon is how a
 * slot is REACHED: an empty slot with no segment would be a slot the producer
 * could never fill. A segment is lit when it is typed AND on (the mount's own
 * gate, `slots.filter(s => s.enabled && s.type)`), dimmed when it is filled but
 * off, and dashed when it is empty. A Space segment renders as the flexible gap
 * it is, so the split into corner-pushed islands still reads at a glance.
 *
 * THE EYE LIVES HERE, not in the editor below. Two reasons it moved (user,
 * 2026-08-01): a switch in the panel put the STATE (lit/dim, on the ribbon) and
 * its CONTROL on opposite sides of the page; and calling it "on air" borrowed
 * the phrase that already means something else here — the band's OBS source is
 * what goes on air, and a slot only decides whether it is in the band. Show and
 * hide is the honest verb, and the ribbon is where you can see the result.
 *
 * Selecting a segment is what opens its editor below; the ◀ ▶ at the ribbon's
 * ends move the selected slot along the band, so reordering happens on the
 * picture of the band rather than in a list beside it.
 */
const BandRibbon = memo(function BandRibbon({ selected, onSelect }) {
    const { matches, slot, val, isStaged, setKey, swap } = useLowerThird();
    const active = useActiveBoards();
    const boardLabel = useBoardLabel();
    const ctx = { matches, boardLabel, firstBoard: active[0] };

    const segs = [];
    for (let i = 1; i <= LT_SLOT_COUNT; i++) {
        const s = slot(i);
        const type = val(`slots.${i}.type`, s.type) || '';
        const on = !!val(`slots.${i}.enabled`, s.enabled);
        segs.push({
            i,
            type,
            on,
            live: !!type && on,
            summary: slotSummary(s, type, ctx),
            staged: isStaged(`slots.${i}`) || isStaged(`slots.${i}.enabled`) || isStaged(`slots.${i}.type`),
        });
    }

    return (
        <Group gap="xs" className="flex-nowrap items-center">
            <MoveButtons
                axis="x" label={`slot ${selected}`}
                canUp={selected > 1} canDown={selected < LT_SLOT_COUNT}
                onUp={() => swap(selected, selected - 1)}
                onDown={() => swap(selected, selected + 1)}
            />
            <div
                role="tablist" aria-label="Band preview"
                className="flex min-w-0 flex-1 items-stretch gap-1 rounded-md border border-border bg-card/40 p-1"
            >
                {segs.map(({ i, type, on, live, summary, staged }) => {
                    const isSpace = type === 'space';
                    const isSel = i === selected;
                    return (
                        // A card, not a button: the eye is a control of its own
                        // and a button inside a button is invalid — so the tab
                        // takes the card's body and the eye sits beside it.
                        <div
                            key={i}
                            style={{ flex: isSpace ? 1.2 : (TYPE_WEIGHT[type] || 1.2) }}
                            className={cn(
                                'flex min-w-0 items-center gap-1 rounded pr-1 transition-colors',
                                isSpace && 'border border-dashed border-border/70',
                                !type && !isSpace && 'border border-dashed border-border/50',
                                type && !isSpace && (live ? 'bg-rio-500/15' : 'bg-card'),
                                isSel && 'ring-1 ring-rio-400',
                            )}
                        >
                            <button
                                type="button" role="tab" aria-selected={isSel}
                                aria-label={`Slot ${i}${type ? ` — ${LT_TYPE_SHORT[type]}` : ' — empty'}`}
                                onClick={() => onSelect(i)}
                                className="flex min-h-12 min-w-0 flex-1 flex-col justify-center gap-0.5 rounded py-1 pl-2 text-left"
                            >
                                <Group gap="none" className="min-w-0 flex-nowrap items-center gap-1.5">
                                    {/* The position, so a segment maps to the
                                        "Slot 3" the editor below names. */}
                                    <Text
                                        size="xs" span
                                        className="shrink-0 font-mono tabular-nums text-[10px] text-muted-foreground/70"
                                    >
                                        {i}
                                    </Text>
                                    <Text
                                        size="xs" span truncate
                                        className={cn(
                                            'min-w-0',
                                            !type && 'text-muted-foreground',
                                            type && (live ? 'text-rio-300' : 'text-muted-foreground'),
                                        )}
                                    >
                                        {type ? LT_TYPE_SHORT[type] : 'Empty'}
                                    </Text>
                                    <StagedDot show={staged} />
                                </Group>
                                <Text span truncate className="min-w-0 text-[10px] text-muted-foreground/80">
                                    {summary}
                                </Text>
                            </button>
                            <IconToggle
                                icon={Eye} offIcon={EyeOff} on={on} disabled={!type}
                                label={type ? `${on ? 'Hide' : 'Show'} slot ${i}` : `Slot ${i} is empty`}
                                onClick={() => setKey(`slots.${i}.enabled`, !on,
                                    `Lower third: slot ${i} ${!on ? 'shown' : 'hidden'}`)}
                            />
                        </div>
                    );
                })}
            </div>
        </Group>
    );
});

// Transport for slot i's clock (lowerthird.slots.{i}.clock.*). Transport acts
// on the LIVE clock — you can't run a countdown that isn't live yet, so a
// staged mode change doesn't surface here until committed.
const ClockControl = memo(function ClockControl({ i }) {
    const c = useStateStore(useShallow(s => s?.lowerthird?.slots?.[i]?.clock
        ?? s?.lowerthird?.slots?.[String(i)]?.clock ?? {}));
    const mode = c.mode || 'off';
    useTick(500, c.running || mode === 'clock');

    const base = `lowerthird.slots.${i}.clock`;
    const set = (entries) => useStateStore.getState().setItems(entries);
    const now = Date.now();
    const remaining = c.running ? (c.endsAt || 0) - now : (c.remainingMs != null ? c.remainingMs : (c.durationSec || 300) * 1000);
    const elapsed = c.running ? now - (c.startedAt || now) : (c.elapsedMs || 0);

    const startCountdown = () => {
        const rem = c.remainingMs != null ? c.remainingMs : (c.durationSec || 300) * 1000;
        set([
            { key: `${base}.endsAt`, value: now + rem },
            { key: `${base}.remainingMs`, value: null },
            { key: `${base}.running`, value: true },
        ]);
    };
    const pauseCountdown = () => set([
        { key: `${base}.remainingMs`, value: Math.max(0, (c.endsAt || 0) - now) },
        { key: `${base}.running`, value: false },
    ]);
    const resetCountdown = () => set([
        { key: `${base}.remainingMs`, value: null },
        { key: `${base}.endsAt`, value: null },
        { key: `${base}.running`, value: false },
    ]);
    const startCountup = () => set([
        { key: `${base}.startedAt`, value: now - (c.elapsedMs || 0) },
        { key: `${base}.running`, value: true },
    ]);
    const pauseCountup = () => set([
        { key: `${base}.elapsedMs`, value: Math.max(0, now - (c.startedAt || now)) },
        { key: `${base}.running`, value: false },
    ]);
    const resetCountup = () => set([
        { key: `${base}.elapsedMs`, value: 0 },
        { key: `${base}.startedAt`, value: null },
        { key: `${base}.running`, value: false },
    ]);

    if (mode === 'off') return null;
    if (mode === 'clock') {
        return <Text size="xs" className="text-muted-foreground">Time of day</Text>;
    }
    const isDown = mode === 'countdown';
    // Transport is momentary — clock control never stages (see staging.js).
    return (
        <Stack gap="none" className="min-w-0">
            <Text size="sm" className="font-mono tabular-nums text-foreground">
                {fmtRemaining(isDown ? remaining : elapsed)}
            </Text>
            <ActionRow className="min-w-0" actions={[
                c.running
                    ? { label: 'Pause', onClick: isDown ? pauseCountdown : pauseCountup }
                    : { label: 'Start', variant: 'default', onClick: isDown ? startCountdown : startCountup },
                {
                    label: 'Reset', icon: RotateCcw, variant: 'ghost',
                    onClick: isDown ? resetCountdown : resetCountup,
                },
            ]} />
        </Stack>
    );
});

/*
 * The selected slot's editor — the panel below the ribbon.
 *
 * One slot at a time, because the ribbon above is the selector: the editor is
 * the detail half of a master/detail, and it names the slot it is editing so
 * the pairing is never ambiguous. Type and the on-air switch head the panel
 * (they are what the ribbon segment shows), then that type's own fields.
 */
const SlotEditor = memo(function SlotEditor({ i }) {
    const { slot, val, isStaged, setKey } = useLowerThird();
    const s = slot(i);
    const type = val(`slots.${i}.type`, s.type) || '';
    const enabled = !!val(`slots.${i}.enabled`, s.enabled);
    const staged = isStaged(`slots.${i}`) || isStaged(`slots.${i}.enabled`);

    return (
        // The accent ring the selected ribbon segment wears, repeated on the
        // panel: it is the only thing that says THIS panel belongs to THAT
        // segment, and without it the pairing is left to the producer's memory
        // of which one they clicked.
        <div className="flex flex-col gap-2 rounded-md border border-rio-400/35 p-3">
            <Group gap="sm" className="min-h-7 flex-nowrap items-center">
                <Text size="xs" span className="label-display shrink-0 text-muted-foreground">
                    Slot {i}
                </Text>
                {/* Beside the position, not banished to the right margin: the
                    type IS what the segment is, so the two read as one phrase
                    ("Slot 1 · Logo + Title") rather than as unrelated controls
                    at opposite ends of a rule. Show/hide is NOT here — it lives
                    on the ribbon segment, where its result is visible. */}
                <select
                    className={cn(KIT_INPUT, 'w-44 min-w-0 shrink-0', !type && 'text-muted-foreground')}
                    value={type}
                    aria-label={`Slot ${i} content type`}
                    onChange={(e) => setKey(`slots.${i}.type`, e.target.value, `Lower third: slot ${i} type`)}
                >
                    {LT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <StagedDot show={staged} />
                {/* A slot can be filled and still not in the band. Saying so
                    beats leaving the producer to wonder why their edits aren't
                    on the picture. */}
                {type && !enabled && (
                    <Text size="xs" span className="text-muted-foreground">
                        Hidden — not in the band
                    </Text>
                )}
            </Group>

            {type
                ? <LowerThirdSlotFields i={i} />
                : (
                    <Text size="xs" className="flex min-h-7 items-center text-muted-foreground">
                        Empty — pick a content type to fill this position on the band.
                    </Text>
                )}
        </div>
    );
});

export default function LowerThirdStage({ element }) {
    // Which slot the editor below is showing. Transient view state, not a
    // broadcast value — it never goes near State or the staging gateway.
    const [selected, setSelected] = useState(1);

    return (
        <Stack gap="sm">
            <DirectStage element={element} />

            <Stack gap="none">
                <BandRibbon selected={selected} onSelect={setSelected} />
                <Text size="xs" className="pt-1 text-muted-foreground">
                    The band, left → right. Pick a segment to edit it below; ◀ ▶ move it.
                    Lit means on air, and widths are indicative — the design package owns
                    the real ones.
                </Text>
            </Stack>

            <SlotEditor i={selected} />
        </Stack>
    );
}

// Merch image picker: choose from /branding/merch uploads, or upload a new one
// (immediate — an upload is a library action, not a broadcast change; the pick
// itself stages through the caller's onChange).
const MerchImagePicker = memo(function MerchImagePicker({ value, onChange }) {
    const [images, setImages] = useState([]);
    const fileRef = useRef(null);
    useEffect(() => {
        fetch('/api/v1/branding/merch')
            .then(r => (r.ok ? r.json() : { images: [] }))
            .then(d => setImages(d.images || []))
            .catch(() => {});
    }, []);
    const upload = async (file) => {
        const fd = new FormData();
        fd.append('file', file);
        try {
            const r = await fetch('/api/v1/branding/merch', { method: 'POST', body: fd });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d?.detail || `HTTP ${r.status}`);
            setImages(d.images || []);
            onChange(d.name);
        } catch (e) {
            notifications.show({ message: `Merch upload failed: ${e?.message || e}`, color: 'red' });
        }
    };
    return (
        <Group gap="xs" className="flex-nowrap items-center">
            <select className={cn(KIT_INPUT, 'min-w-0 flex-1')} value={value || ''} onChange={(e) => onChange(e.target.value)}>
                <option value="">— No image —</option>
                {images.map(im => <option key={im.name} value={im.name}>{im.name}</option>)}
            </select>
            <input
                ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
            />
            <Button size="xs" variant="secondary" className="h-7 shrink-0" onClick={() => fileRef.current?.click()}>Upload</Button>
        </Group>
    );
});

// The Bracket slot renders the same phase picker the Bracket desk owns —
// loading a phase is one workflow, and a second copy here would let the two
// disagree about what's on screen.
const BracketSlotPicker = memo(function BracketSlotPicker() {
    const desk = useBracketDesk();
    // The picker's own select shows which phase is loaded, so the label stays
    // short — SelectRow's label column is a fixed w-16 that truncates.
    return <BracketPhasePicker desk={desk} label="Phase" />;
});

/*
 * One slot's content editor. Every field routes through the staging gateway
 * with the slot's key prefix.
 *
 * TWO RULES, both learned from the panel this replaces (user report,
 * 2026-08-01: "unclear what they're representing… super spaced out"):
 *
 * 1. EVERY FIELD IS LABELLED. The old fields were bare inputs carrying their
 *    only description in the placeholder — which the value erases. A producer
 *    coming back to a filled band saw an unlabelled box with "hjkhjknjk" in it
 *    and no way to know it was the logo caption. Placeholders are examples now;
 *    the label column is what names the field.
 *
 * 2. FIELDS DO NOT STRETCH. They were `flex-1`, so a slot with one field gave
 *    that field the whole ~1000px stage — a caption box wide enough for a
 *    paragraph, and three fields spread so far apart they stopped reading as a
 *    set. The track caps at 340px and the grid packs left, so a field is the
 *    size of its content whatever else is in the slot.
 */
const FIELD_GRID = 'grid min-w-0 items-start gap-x-4 gap-y-1 '
    + '[grid-template-columns:repeat(auto-fill,minmax(240px,340px))]';

const LowerThirdSlotFields = memo(function LowerThirdSlotFields({ i }) {
    const { matches, slot, val, isStaged, setKey } = useLowerThird();
    const active = useActiveBoards();
    const sbLabel = useBoardLabel();

    const s = slot(i);
    const p = (k) => `slots.${i}.${k}`;
    const type = val(p('type'), s.type) || '';
    const enabled = !!val(p('enabled'), s.enabled);
    const c = s.clock || {};
    const clockMode = val(p('clock.mode'), c.mode) || 'off';

    // Plain render helper (NOT a nested component): a component defined inside
    // render gets a new identity every pass, which remounts the <input> and
    // drops focus mid-keystroke. Function calls keep the element type stable.
    const textField = (k, label, placeholder, live) => (
        <TextRow
            label={label} placeholder={placeholder} staged={isStaged(p(k))}
            value={val(p(k), live) || ''}
            onChange={(v) => setKey(p(k), v, `Lower third: slot ${i} ${k}`)}
        />
    );

    return (
        <div className={FIELD_GRID}>
            {type === 'logo' && textField('title', 'Caption', 'Under the logo — optional', s.title)}

            {type === 'match' && (
                <>
                    <SelectRow
                        label="Match" staged={isStaged(p('matchId'))}
                        value={val(p('matchId'), s.matchId) != null && val(p('matchId'), s.matchId) !== '' ? String(val(p('matchId'), s.matchId)) : ''}
                        onChange={(v) => setKey(p('matchId'), v || null, `Lower third: slot ${i} match`)}
                        placeholder="— None —"
                        options={Object.keys(matches || {}).map(id => ({
                            value: id, label: matchDisplayLabel(matches, id),
                        }))}
                    />
                    <SegmentedRow
                        label="Shows"
                        data={[{ label: 'Up Next', value: 'upnext' }, { label: 'Current', value: 'current' }]}
                        value={val(p('role'), s.role) === 'current' ? 'current' : 'upnext'}
                        onChange={(v) => setKey(p('role'), v, `Lower third: slot ${i} role`)}
                    />
                    {textField('status', 'Status', 'Overrides UP NEXT', s.status)}
                </>
            )}

            {type === 'scorebox' && (
                <SelectRow
                    label="Board" staged={isStaged(p('scoreboard'))}
                    value={String(val(p('scoreboard'), s.scoreboard) || active[0])}
                    onChange={(v) => setKey(p('scoreboard'), parseInt(v) || 1, `Lower third: slot ${i} scoreboard`)}
                    options={active.map(n => ({ value: String(n), label: sbLabel(n) }))}
                />
            )}

            {type === 'merch' && (
                <>
                    <FieldRow label="Image" staged={isStaged(p('image'))}>
                        <MerchImagePicker
                            value={val(p('image'), s.image) || ''}
                            onChange={(name) => setKey(p('image'), name, `Lower third: slot ${i} merch image`)}
                        />
                    </FieldRow>
                    {textField('title', 'Title', 'New tees in the shop', s.title)}
                    {textField('subtitle', 'Subtitle', 'shop.example.com', s.subtitle)}
                </>
            )}

            {type === 'clock' && (
                <>
                    <SelectRow
                        label="Clock" value={clockMode} staged={isStaged(p('clock.mode'))}
                        onChange={(v) => setKey(p('clock.mode'), v, `Lower third: slot ${i} clock mode`)}
                        options={[
                            { value: 'off', label: 'Off' },
                            { value: 'countdown', label: 'Countdown' },
                            { value: 'countup', label: 'Count up' },
                            { value: 'clock', label: 'Time of day' },
                        ]}
                    />
                    {clockMode === 'countdown' && (
                        <NumberRow
                            label="Minutes" min={0} step={1} staged={isStaged(p('clock.durationSec'))}
                            value={Math.round(((val(p('clock.durationSec'), c.durationSec)) || 300) / 60)}
                            onChange={(n) => setKey(p('clock.durationSec'), Math.max(0, n || 0) * 60, `Lower third: slot ${i} countdown length`)}
                        />
                    )}
                    {clockMode === 'clock' && (
                        <>
                            <SelectRow
                                label="Zone" staged={isStaged(p('clock.timezone'))}
                                value={val(p('clock.timezone'), c.timezone) || ''}
                                onChange={(v) => setKey(p('clock.timezone'), v, `Lower third: slot ${i} clock time zone`)}
                                options={CLOCK_TIMEZONES}
                            />
                            {textField('clock.suffix', 'Suffix', 'ET', c.suffix)}
                        </>
                    )}
                    {(clockMode === 'countdown' || clockMode === 'clock')
                        && textField('clock.label', 'Label', 'BACK IN', c.label)}
                    {/* Transport rides with the clock's own fields — a running
                        countdown is this slot's content, not a separate rail. */}
                    {enabled && clockMode !== 'off' && <ClockControl i={i} />}
                </>
            )}

            {type === 'message' && (
                <>
                    {textField('title', 'Title', 'Winners Final', s.title)}
                    {textField('subtitle', 'Subtitle', 'NNL Season 7', s.subtitle)}
                </>
            )}

            {type === 'bracket' && (
                <>
                    <BracketSlotPicker />
                    {textField('title', 'Title', 'Defaults to the phase name', s.title)}
                    {textField('subtitle', 'Subtitle', 'Optional', s.subtitle)}
                </>
            )}

            {type === 'space' && (
                <>
                    <NumberRow
                        label="Gap" min={0} step={10} suffix="px" staged={isStaged(p('width'))}
                        value={val(p('width'), s.width) || null}
                        onChange={(n) => setKey(p('width'), n == null ? 0 : Math.max(0, n), `Lower third: slot ${i} gap width`)}
                    />
                    {/* The only slot type whose behaviour isn't visible in its
                        own fields, so it explains itself here rather than in a
                        standing caption every other slot type has to scroll past. */}
                    <Text size="xs" className="min-w-0 self-center text-muted-foreground">
                        Leave blank and it absorbs the leftover width, splitting the band
                        into two cards pushed to the corners.
                    </Text>
                </>
            )}
        </div>
    );
});
