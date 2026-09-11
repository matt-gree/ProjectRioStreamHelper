import { memo, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ArrowLeftRight, Link2 } from 'lucide-react';
import { useStateStore } from '../../../context/store';
import { stageOrRun, usePending } from '../../../context/staging';
import { useParticipantsStore } from '../../../context/participants';
import {
    setPlayerPlatesConfig, normalizeConfig as normalizePlatesConfig,
    PP_SOURCE_OPTIONS, PP_LOCATION_OPTIONS, PP_SUBFIELD_OPTIONS, pairAnchor,
} from '../../../context/playerplates';
import ParticipantPicker from '../../../components/ParticipantPicker';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { Switch } from '../../../components/ui/switch';
import { Group, Text } from '../../../components/ui/primitives';
import { cn } from '../../../lib/utils';
import { FieldRow, KIT_INPUT, TextRow } from '../kit';
import { StagedDot } from '../controls';
import { SubFieldPicker } from '../subfield-picker';
import { matchDisplayLabel, matchIds } from '../matches';
import { useSideLabels } from '../sides';
import { DirectStage } from './generic';

/*
 * Player Plates stage — a sibling of Commentary: the two-player name/sub-plate
 * band, drawn as THE BAND. Two plate cards sit side by side in the order the
 * plates sit on air, with a swap button between them:
 *
 *     Players from [Match | Manual]  [rjb vs MattGree ▾]
 *     ┌ SIDE 1 · Left ─── On air ●━ ┐       ┌ SIDE 2 · Right ── On air ●━ ┐
 *     │ PLAYER  [⛓ rjb            ] │  ⇄    │ PLAYER  [⛓ MattGree       ] │
 *     │ SUB-PLATE [𝕏 Twitter @rjb ⇅] │       │ SUB-PLATE [No sub-plate  ⇅] │
 *     └─────────────────────────────┘       └─────────────────────────────┘
 *
 * It replaces a stack of full-width strips — a From segment, a Match select and
 * an Order segment each spanning the whole panel, then two blocks with a 14px
 * eye, a 14px sub toggle and a bare field select — which read as five settings
 * of equal weight rather than two plates and the one relationship between them.
 *
 * WHERE THE CARDS SIT IS WHERE THE PLATES SIT. A pair takes opposite anchors,
 * side 1 at its own `location` and side 2 at the other (server/playerplates.py
 * `pair_anchor`), so the pair's order is one bit — and it used to be an "Order"
 * segment whose options had to spell "Side 2 · Side 1" to say "swapped". Here
 * the swap is the ⇄ between the cards and its effect is the cards trading
 * places, the same thing the plates do on air. A LONE plate has no partner to
 * be ordered against, so the swap stands down and that card grows its own
 * Position (left · center · right — the middle is only reachable alone).
 * Positions are geometry, so they keep their literal words; the card's HEADER
 * is a side of the game and goes through the producer's side vocabulary.
 *
 * EACH PLATE'S SWITCH is the only thing that puts it on air, exactly as a caster
 * seat works. A band-wide "Show both / 1 / 2" used to say the same thing twice
 * (see server/playerplates.py).
 *
 * THE SUB-PLATE IS ONE CONTROL, as on the Commentary desk: the field picker
 * (../subfield-picker), whose "No sub-plate" is the off switch, listing each
 * field with the value it resolves to for THIS player. A side still carrying a
 * `subVisible: false` from when the plate had a separate toggle reads as no
 * sub-plate — what the band is drawing — and any pick writes it back on.
 *
 * Either SOURCE names a person out of the address book — a bound fixture's
 * side, or (manual) the producer's own pick through the same ParticipantPicker
 * a caster seat uses. The picker's "use without saving" keeps a typed name
 * reachable for a guest who isn't in the book, and that is the one plate with
 * nothing to resolve, so it is the one plate that still TYPES its sub-plate
 * (label + value; clearing the value is how that one goes away).
 *
 * The whole config stages+PUTs as ONE key ('playerplates'), and the server
 * projector resolves it to playerplates.* for the overlay.
 */

const COL_LABEL = 'label-display text-[10px] tracking-wider text-muted-foreground/70';

// Same canonical form as `_rio_key` in server/participants.py, so a fixture
// that names its player only by rioName finds the row the projector will.
const rioKey = (name) => String(name ?? '').trim().toLowerCase();

function usePlayerPlates() {
    const cfgRaw = useStateStore(useShallow(s => s?.playerplates?.config));
    const live = useStateStore(useShallow(s => s?.playerplates ?? {}));
    const matches = useStateStore(useShallow(s => s?.match ?? {}));
    const pending = usePending('playerplates');
    const config = pending ? pending.value : normalizePlatesConfig(cfgRaw);

    // The address book, for what each sub-plate field will SAY. REST, not the
    // socket store, so nothing loads it until something asks.
    const { participants, load } = useParticipantsStore(useShallow(s => ({
        participants: s.participants, load: s.load,
    })));
    useEffect(() => { load(); }, [load]);
    const book = useMemo(() => {
        const byId = {};
        const byRio = {};
        for (const p of participants) {
            byId[p.id] = p;
            const k = rioKey(p.identities?.rioName);
            if (k && !(k in byRio)) byRio[k] = p;
        }
        return { byId, byRio };
    }, [participants]);

    const setConfig = (next) => stageOrRun({
        key: 'playerplates',
        label: 'Player plates',
        value: next,
        run: () => setPlayerPlatesConfig(next),
    });
    const patch = (partial) => setConfig({ ...config, ...partial });
    const patchSide = (t, sp) => setConfig({
        ...config,
        sides: { ...config.sides, [t]: { ...(config.sides?.[t] || {}), ...sp } },
    });

    // The fixture's side, when the band is match-fed.
    const fixtureSide = (t) => (config.source === 'match' && config.matchId != null
        ? matches?.[String(config.matchId)]?.player?.[t] || {}
        : null);

    // The address-book row a side resolves against — the same order the
    // projector tries (`_side_person`): the fixture's participant, else its
    // rioName; a manual plate's own pick.
    const rowFor = (t) => {
        const f = fixtureSide(t);
        if (f) return (f.participantId && book.byId[f.participantId]) || book.byRio[rioKey(f.rioName)] || null;
        if (config.source === 'match') return null;
        const pid = config.sides?.[t]?.participantId;
        return (pid && book.byId[pid]) || null;
    };

    // What the plate's name will read. Resolved HERE rather than read back off
    // the projection so a staged source or match change names the right person
    // before it is committed; the projection is the fallback for a row the
    // book hasn't loaded yet. A manual pick carries `_name`, a client-only
    // display tag the server drops on the PUT.
    const projected = (t) => live?.[t]?.name ?? live?.[String(t)]?.name ?? '';
    const nameFor = (t) => {
        const row = rowFor(t);
        const tag = row?.display?.tag || row?.identities?.rioName || '';
        const f = fixtureSide(t);
        if (config.source === 'match') return f ? (tag || f.rioName || projected(t)) : '';
        const side = config.sides?.[t] || {};
        if (side.participantId) return side._name || tag || projected(t);
        return side.name || '';
    };

    return { config, staged: !!pending, matches, patch, patchSide, rowFor, nameFor };
}

// Players from [Match | Manual] and, match-fed, which fixture. One line: the
// source is a single decision, and a segment stretched across the whole panel
// was the loudest control on it.
const SourceBar = memo(function SourceBar({ pp }) {
    const { config, matches } = pp;
    const ids = useMemo(() => matchIds(matches), [matches]);
    const current = config.matchId != null && matches[String(config.matchId)] ? String(config.matchId) : '';
    return (
        <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
            <span className={COL_LABEL}>Players from</span>
            <SegmentedControl
                size="xs" data={PP_SOURCE_OPTIONS} value={config.source}
                onChange={(v) => pp.patch({ source: v })}
                aria-label="Players from"
            />
            {config.source === 'match' ? (
                <select
                    aria-label="Match"
                    value={current}
                    onChange={(e) => pp.patch({ matchId: e.target.value ? Number(e.target.value) : null })}
                    className={cn(KIT_INPUT, 'h-8 w-72 max-w-full text-sm', !current && 'text-muted-foreground')}
                >
                    <option value="">{ids.length ? 'Pick match…' : 'No matches yet'}</option>
                    {ids.map(id => <option key={id} value={id}>{matchDisplayLabel(matches, id)}</option>)}
                </select>
            ) : (
                <Text size="xs" span dimmed>Each player picked from the Address Book</Text>
            )}
        </div>
    );
});

// Where a plate stands on air, beside its side label: its anchor, or why it
// draws nothing. A plate needs a NAME to draw (`active` in the projector), so a
// shown plate with none is the one state worth amber.
function plateStatus({ visible, name, anchor }) {
    if (!visible) return { text: 'Hidden', tone: 'text-muted-foreground' };
    if (!name) return { text: 'No name — nothing draws', tone: 'text-amber-500/90' };
    return { text: PP_LOCATION_OPTIONS.find(o => o.value === anchor)?.label || anchor, tone: 'text-muted-foreground' };
}

const PlateCard = memo(function PlateCard({ t, pp, paired, anchor }) {
    const { config } = pp;
    const { label: sideLabel } = useSideLabels();
    const side = config.sides?.[t] || {};
    const isMatch = config.source === 'match';
    const visible = side.visible !== false;
    const subShown = side.subVisible !== false;
    const name = pp.nameFor(t);
    const row = pp.rowFor(t);
    // Bound to an address-book row (from the fixture, or picked here) — the one
    // state in which there is a field to resolve.
    const bound = isMatch || !!side.participantId;
    const status = plateStatus({ visible, name, anchor });
    const who = sideLabel(t);

    return (
        <section
            aria-label={`${who} plate`}
            className={cn(
                'flex min-w-0 flex-col rounded-lg border bg-background/40',
                pp.staged ? 'border-amber-400/40' : 'border-border/60',
            )}
        >
            <header className="flex h-10 min-w-0 items-center gap-2 border-b border-border/60 px-3">
                <Text span className="label-display shrink-0 text-xs font-semibold text-foreground">{who}</Text>
                <Text span size="xs" truncate className={cn('min-w-0', status.tone)}>{status.text}</Text>
                <label className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    On air
                    <Switch
                        checked={visible}
                        onCheckedChange={(v) => pp.patchSide(t, { visible: v })}
                        aria-label={`${who} plate on air`}
                    />
                </label>
            </header>

            <div className={cn('flex flex-col gap-3 p-3 transition-opacity', !visible && 'opacity-50')}>
                <FieldRow stacked label="Player">
                    {isMatch ? (
                        // A match-fed plate takes its person from the fixture:
                        // read-only here, and dashed to say so.
                        <div
                            title="Named by the match — change who plays on the Match desk"
                            className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-dashed border-border/70 px-2.5 text-sm"
                        >
                            <Link2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                            {name
                                ? <span className="truncate font-medium text-foreground">{name}</span>
                                : (
                                    <span className="truncate text-muted-foreground">
                                        {config.matchId == null ? 'Pick a match above' : 'No name from match'}
                                    </span>
                                )}
                        </div>
                    ) : (
                        <ParticipantPicker
                            value={name}
                            selectedId={side.participantId || null}
                            onResolve={(picked) => pp.patchSide(t, {
                                participantId: picked.id,
                                name: '',
                                _name: picked.display?.tag || picked.identities?.rioName || '',
                            })}
                            // The guest who isn't in the book: keep the typed
                            // name, drop the pick, and the typed sub-plate
                            // below takes over — there is no row to read.
                            onRawValue={(text) => pp.patchSide(t, { participantId: null, name: text, _name: '' })}
                            placeholder={`Pick ${who.toLowerCase()} player…`}
                            className="font-medium"
                        />
                    )}
                </FieldRow>

                <FieldRow stacked label="Sub-plate">
                    {bound ? (
                        <SubFieldPicker
                            value={subShown ? (side.subField || '') : ''}
                            onChange={(v) => pp.patchSide(t, { subField: v, subVisible: true })}
                            participant={row}
                            who={name}
                            options={PP_SUBFIELD_OPTIONS}
                            ariaLabel={`${who} sub-plate`}
                        />
                    ) : (
                        <div className="flex w-full min-w-0 items-center gap-2">
                            <TextRow
                                label={null} ariaLabel={`${who} sub label`} placeholder="Label"
                                value={subShown ? side.subLabel || '' : ''}
                                onChange={(v) => pp.patchSide(t, { subLabel: v, subVisible: true })}
                                className="w-2/5 shrink-0" inputClassName="h-8 text-sm"
                            />
                            <TextRow
                                label={null} ariaLabel={`${who} sub value`} placeholder="Value — blank for none"
                                value={subShown ? side.subValue || '' : ''}
                                onChange={(v) => pp.patchSide(t, { subValue: v, subVisible: true })}
                                className="min-w-0 flex-1" inputClassName="h-8 text-sm"
                            />
                        </div>
                    )}
                </FieldRow>

                {/* Only a plate on air ALONE is placed from its own card: a
                    pair's two anchors are opposite, and that one bit is the
                    swap between the cards. */}
                {visible && !paired && (
                    <FieldRow stacked label="Position">
                        <SegmentedControl
                            size="xs" data={PP_LOCATION_OPTIONS}
                            value={side.location || (t === 1 ? 'left' : 'right')}
                            onChange={(v) => pp.patchSide(t, { location: v })}
                            aria-label={`${who} position`}
                        />
                    </FieldRow>
                )}
            </div>
        </section>
    );
});

export default function PlayerPlatesStage({ element, placement }) {
    const pp = usePlayerPlates();
    const { config } = pp;
    const paired = [1, 2].every(t => config.sides?.[t]?.visible !== false);
    const anchors = pairAnchor(config.sides?.[1]?.location);
    const anchorOf = (t) => (paired ? anchors[t] : (config.sides?.[t]?.location || (t === 1 ? 'left' : 'right')));
    // The cards in on-air order. Unpaired there is no order to show, so the
    // sides keep their numbers' order.
    const order = paired && anchors[1] === 'right' ? [2, 1] : [1, 2];

    // Write BOTH anchors even though the server derives side 2's from side 1's
    // — the panel must not hold a stored location it is about to ignore, or the
    // next lone-plate Position opens on a stale value.
    const swap = () => {
        const next = pairAnchor(anchors[1] === 'right' ? 'left' : 'right');
        pp.patch({
            sides: {
                ...config.sides,
                1: { ...(config.sides?.[1] || {}), location: next[1] },
                2: { ...(config.sides?.[2] || {}), location: next[2] },
            },
        });
    };

    return (
        <>
            <DirectStage element={element} placement={placement} />
            {pp.staged && (
                <Group gap="xs" className="items-center">
                    <StagedDot show />
                    <Text size="xs" className="text-amber-400">Plate changes staged</Text>
                </Group>
            )}

            <SourceBar pp={pp} />

            <div className="grid grid-cols-1 items-stretch gap-2 @2xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <PlateCard t={order[0]} pp={pp} paired={paired} anchor={anchorOf(order[0])} />
                {/* The swap lives BETWEEN the plates it swaps. Unpaired, it
                    keeps its column on a wide panel (so a plate switching off
                    doesn't resize its neighbour) and folds away when stacked. */}
                <div className={cn('flex items-center justify-center', !paired && 'invisible hidden @2xl:flex')}>
                    <button
                        type="button" onClick={swap} disabled={!paired}
                        aria-label="Swap plates" title="Swap which plate is on the left"
                        className="flex size-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                    >
                        <ArrowLeftRight size={14} className="rotate-90 @2xl:rotate-0" />
                    </button>
                </div>
                <PlateCard t={order[1]} pp={pp} paired={paired} anchor={anchorOf(order[1])} />
            </div>
        </>
    );
}
