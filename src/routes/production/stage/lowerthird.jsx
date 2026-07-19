import { memo, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { RotateCcw } from 'lucide-react';
import { useStateStore } from '../../../context/store';
import { useStagingStore, confirmModeEnabled } from '../../../context/staging';
import { Stack, Group, Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { Switch } from '../../../components/ui/switch';
import { notifications } from '../../../lib/notify';
import { cn } from '../../../lib/utils';
import {
    ActionRow, KIT_INPUT, KIT_INPUT_FLOW, ListRow, NumberRow, SegmentedRow, SelectRow,
} from '../kit';
import { MoveButtons, StagedDot, stageStateSet } from '../controls';
import { matchDisplayLabel } from '../matches';
import { useActiveBoards, useBoardLabel } from '../boards';
import { BracketPhasePicker, useBracketDesk } from '../desks/bracket';
import { DirectStage } from './generic';

/*
 * Lower Third (Break) stage — a direct element with rich authoring: the band
 * is FIVE independently toggleable SLOTS (lowerthird.slots.1..5, left→right),
 * each carrying one content type — logo · match · scorebox · merch · clock ·
 * message · bracket. Everything lives on the stage: each slot row is a type
 * picker + on/off switch, and expands in place to that type's content editor —
 * picking a type auto-expands the row so authoring never hides behind a menu.
 * Values are written (through the staging gateway) to lowerthird.* state,
 * which the SVG overlay renders; segment widths/looks belong to the active
 * design package's theme. Putting the band on air is still the OBS source
 * toggle. Clock START/PAUSE/RESET are transport — momentary, always immediate
 * — while slot content/config stages like other content.
 */
const LT_INPUT = KIT_INPUT_FLOW;

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
        return <Text size="xs" className="text-muted-foreground">Showing time of day.</Text>;
    }
    const isDown = mode === 'countdown';
    // Transport is momentary — clock control never stages (see staging.js).
    return (
        <div className="flex min-h-7 items-center gap-2">
            <Text size="sm" className="min-w-[64px] font-mono tabular-nums text-foreground">
                {fmtRemaining(isDown ? remaining : elapsed)}
            </Text>
            <ActionRow className="min-w-0 flex-1" actions={[
                c.running
                    ? { label: 'Pause', onClick: isDown ? pauseCountdown : pauseCountup }
                    : { label: 'Start', variant: 'default', onClick: isDown ? startCountdown : startCountup },
                {
                    label: 'Reset', icon: RotateCcw, variant: 'ghost',
                    onClick: isDown ? resetCountdown : resetCountup,
                },
            ]} />
        </div>
    );
});

// One-line description of what a slot currently shows (for the face rows).
function ltSlotSummary(type, s, matches) {
    if (!type) return '';
    if (type === 'match') return s.matchId ? matchDisplayLabel(matches, s.matchId) : 'No match picked';
    if (type === 'scorebox') return `Scoreboard ${s.scoreboard || 1}`;
    if (type === 'clock') {
        const m = s.clock?.mode || 'off';
        return m === 'off' ? 'Clock off' : (m === 'clock' ? 'Time of day' : (m === 'countdown' ? 'Countdown' : 'Count up'));
    }
    if (type === 'bracket') return s.title || 'Loaded bracket phase';
    if (type === 'space') return Number(s.width) > 0 ? `Fixed gap ${Math.round(s.width)}px` : 'Split / fill';
    return s.title || '';
}

// One face row = one band slot: move ▲/▼ (reorder, phone-friendly buttons) ·
// chevron (expand editor) · type picker · staged dot · on/off. Collapsed rows
// show a one-line summary of their content; picking a type auto-expands the
// row's editor in place.
const LowerThirdSlotRow = memo(function LowerThirdSlotRow({ i, expanded, setExpanded }) {
    const { matches, slot, val, isStaged, setKey, swap } = useLowerThird();
    const s = slot(i);
    const type = val(`slots.${i}.type`, s.type) || '';
    const enabled = !!val(`slots.${i}.enabled`, s.enabled);
    const summary = ltSlotSummary(type, s, matches);
    const open = expanded && !!type;
    return (
        <div className="rounded-md border border-border/60 px-1.5">
            <ListRow
                lead={
                    <MoveButtons
                        label={`slot ${i}`}
                        canUp={i > 1} canDown={i < LT_SLOT_COUNT}
                        onUp={() => swap(i, i - 1)}
                        onDown={() => swap(i, i + 1)}
                    />
                }
                // The type picker IS the row's identity, so it takes the name
                // slot; the summary rides alongside only while collapsed, where
                // there's room for it.
                name={
                    <select
                        className={cn(KIT_INPUT, 'min-w-0 flex-1')} value={type}
                        aria-label={`Slot ${i} content type`}
                        onChange={(e) => {
                            setKey(`slots.${i}.type`, e.target.value, `Lower third: slot ${i} type`);
                            setExpanded(!!e.target.value);
                        }}
                    >
                        {LT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                }
                meta={!open ? summary : undefined}
                controls={
                    <>
                        <StagedDot show={isStaged(`slots.${i}`) || isStaged(`slots.${i}.enabled`) || isStaged(`slots.${i}.type`)} />
                        <Switch
                            size="sm" checked={enabled} disabled={!type}
                            onCheckedChange={(v) => setKey(`slots.${i}.enabled`, v, `Lower third: slot ${i} ${v ? 'on' : 'off'}`)}
                        />
                    </>
                }
                expanded={open}
                onExpandedChange={setExpanded}
                disabled={!type}
            >
                {/* Custom block (contract-sanctioned): per-slot content authoring
                    is typed text, uploads and clock transport — shapes no kit row
                    expresses. Kept on kit tokens and spacing. */}
                <LowerThirdSlotFields i={i} />
            </ListRow>
            {type === 'clock' && enabled && !open && (
                <div className="pb-1.5 pl-7"><ClockControl i={i} /></div>
            )}
        </div>
    );
});

export default function LowerThirdStage({ element }) {
    // Which slot editors are open. Rows auto-open on a type pick and can be
    // collapsed back to a summary line; empty slots have nothing to expand.
    const [open, setOpen] = useState({});
    return (
        <Stack gap="sm">
            <DirectStage element={element} />
            <Stack gap="xs">
                {Array.from({ length: LT_SLOT_COUNT }, (_, k) => k + 1).map((i) => (
                    <LowerThirdSlotRow
                        key={i} i={i} expanded={!!open[i]}
                        setExpanded={(v) => setOpen(o => ({ ...o, [i]: v }))}
                    />
                ))}
            </Stack>
            <Text size="xs" className="text-muted-foreground">
                Slots render left → right; widths come from the design package. A Space
                slot splits the band and pushes content to the corners.
            </Text>
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
            <select className={LT_INPUT} value={value || ''} onChange={(e) => onChange(e.target.value)}>
                <option value="">— No image —</option>
                {images.map(im => <option key={im.name} value={im.name}>{im.name}</option>)}
            </select>
            <input
                ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
            />
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>Upload</Button>
        </Group>
    );
});

// The Bracket slot renders the same phase picker the Bracket desk owns —
// loading a phase is one workflow, and a second copy here would let the two
// disagree about what's on screen.
const BracketSlotPicker = memo(function BracketSlotPicker() {
    const desk = useBracketDesk();
    return (
        <Stack gap="none">
            <Text size="xs" className="text-muted-foreground">
                Load phase{desk.phaseName ? ` (showing: ${desk.phaseName})` : ''}
            </Text>
            <BracketPhasePicker desk={desk} label={null} />
        </Stack>
    );
});

// One slot's content editor (expanded in place under the face row). Every
// field routes through the staging gateway with the slot's key prefix.
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

    // Plain render helpers (NOT nested components): a component defined inside
    // render gets a new identity every pass, which remounts the <input> and
    // drops focus mid-keystroke. Function calls keep the element type stable.
    const fieldLabel = (k, children) => (
        <Group gap="xs" className="items-center">
            <Text size="xs" className="text-muted-foreground">{children}</Text>
            <StagedDot show={isStaged(p(k))} />
        </Group>
    );
    const textField = (k, placeholder, live) => (
        <input
            className={LT_INPUT} value={val(p(k), live) || ''} placeholder={placeholder}
            onChange={(e) => setKey(p(k), e.target.value, `Lower third: slot ${i} ${k}`)}
        />
    );

    return (
        <Stack gap="xs">
            {type === 'logo' && (
                <label className="flex flex-col gap-1">
                    {fieldLabel('title', 'Caption (optional; logo comes from Branding)')}
                    {textField('title', 'e.g. NNL Season 7', s.title)}
                </label>
            )}

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
                    {textField('status', 'Status override (e.g. LIVE)', s.status)}
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
                    <Group gap="xs" className="items-center">
                        <div className="min-w-0 flex-1">
                            <MerchImagePicker
                                value={val(p('image'), s.image) || ''}
                                onChange={(name) => setKey(p('image'), name, `Lower third: slot ${i} merch image`)}
                            />
                        </div>
                        <StagedDot show={isStaged(p('image'))} />
                    </Group>
                    {textField('title', 'Title (e.g. New tees in the shop)', s.title)}
                    {textField('subtitle', 'Subtitle (e.g. shop.example.com)', s.subtitle)}
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
                            <label className="flex flex-col gap-1">
                                {fieldLabel('clock.suffix', 'Suffix (e.g. ET)')}
                                {textField('clock.suffix', 'e.g. ET', c.suffix)}
                            </label>
                        </>
                    )}
                    {(clockMode === 'countdown' || clockMode === 'clock')
                        && textField('clock.label', 'Clock label (e.g. BACK IN)', c.label)}
                    {enabled && clockMode !== 'off' && <ClockControl i={i} />}
                </>
            )}

            {type === 'message' && (
                <>
                    {textField('title', 'Title (e.g. Winners Final)', s.title)}
                    {textField('subtitle', 'Subtitle (e.g. NNL Season 7)', s.subtitle)}
                </>
            )}

            {type === 'bracket' && (
                <>
                    <BracketSlotPicker />
                    {textField('title', 'Title override (defaults to phase name)', s.title)}
                    {textField('subtitle', 'Subtitle (optional)', s.subtitle)}
                </>
            )}

            {type === 'space' && (
                <>
                    <NumberRow
                        label="Gap" min={0} step={10} suffix="px" staged={isStaged(p('width'))}
                        value={val(p('width'), s.width) || null}
                        onChange={(n) => setKey(p('width'), n == null ? 0 : Math.max(0, n), `Lower third: slot ${i} gap width`)}
                    />
                    <Text size="xs" className="text-muted-foreground">
                        Blank fills the space and splits the band into two cards — content
                        before and after this slot separates into its own corner.
                    </Text>
                </>
            )}
        </Stack>
    );
});

