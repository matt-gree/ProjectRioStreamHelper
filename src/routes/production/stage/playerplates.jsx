import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Captions, Eye, EyeOff } from 'lucide-react';
import { useStateStore } from '../../../context/store';
import { stageOrRun, usePending } from '../../../context/staging';
import {
    setPlayerPlatesConfig, normalizeConfig as normalizePlatesConfig,
    PP_SOURCE_OPTIONS, PP_LOCATION_OPTIONS, PP_SUBFIELD_OPTIONS, pairAnchor,
} from '../../../context/playerplates';
import ParticipantPicker from '../../../components/ParticipantPicker';
import { Group, Text } from '../../../components/ui/primitives';
import { cn } from '../../../lib/utils';
import { IconToggle, KIT_INPUT, ListRow, SegmentedRow, SelectRow } from '../kit';
import { StagedDot } from '../controls';
import { matchDisplayLabel, matchIds } from '../matches';
import { useSideLabels } from '../sides';
import { DirectStage } from './generic';

/*
 * Player Plates stage — a sibling of Commentary: the two-player name/sub-plate
 * band. Both plates are always authorable here and EACH PLATE'S EYE is the only
 * thing that puts it on air, exactly as a caster slot works. A band-wide "Show"
 * segment (Both / Player 1 / Player 2) used to sit above them saying the same
 * thing a second time — and worse, it hid the excluded side's whole block, so
 * an eye switched off under "Both" was invisible and unreachable under "Player
 * 2", where it silently kept the band dark. Whether a plate can choose WHERE it
 * sits is the one thing that genuinely follows from the pair: two plates are
 * pinned left/right (they would collide otherwise), a lone plate is placed.
 *
 * Either SOURCE names a person out of the address book — a bound fixture's side,
 * or (manual) the producer's own pick through the same ParticipantPicker a
 * caster slot uses. Manual used to be a bare text box, which bought a typed name
 * at the cost of everything the registry gives: no sub-plate field to resolve,
 * and no re-flow when a name or pronoun is fixed mid-broadcast. The picker's
 * "use without saving" keeps the typed name reachable for a guest who isn't in
 * the book — and that is the one plate with nothing to resolve, so it is the one
 * plate that still types its own sub label/value. THE SUB-PLATE OFFERS WHAT THE
 * NAME CAN RESOLVE.
 *
 * PLACEMENT is exactly one control, and which one depends on how many plates are
 * up: a PAIR gets a band-level Order (the two anchors are opposite by
 * construction, so one bit describes both plates and a mirrored control on each
 * block would be the same fact twice), a LONE plate gets its own Where with the
 * middle anchor a pair has no room for. Both write the same `location` — side 1's
 * choice is the order and side 2 follows — so there is no swap flag to drift.
 *
 * The whole config stages+PUTs as ONE key ('playerplates'), and the server
 * projector resolves it to playerplates.* for the overlay. Same plate +
 * sub-plate convention as the caster strip, reusing the shared address-book
 * sub-field vocabulary.
 */

function usePlayerPlates() {
    const cfgRaw = useStateStore(useShallow(s => s?.playerplates?.config));
    const live = useStateStore(useShallow(s => s?.playerplates ?? {}));
    const matches = useStateStore(useShallow(s => s?.match ?? {}));
    const pending = usePending('playerplates');
    const config = pending ? pending.value : normalizePlatesConfig(cfgRaw);

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
    // Server-resolved display name per side (used to preview the match-fed name).
    const resolvedName = (t) => live?.[t]?.name ?? live?.[String(t)]?.name ?? '';
    // What to SHOW in a manual side's picker. A pick carries `_name` (a
    // client-only display tag the server drops on the PUT) because a staged pick
    // hasn't been projected yet, so the resolved name still reads as the person
    // it is replacing. A raw typed name is its own display.
    const pickedName = (t) => {
        const side = config.sides?.[t] || {};
        if (side.participantId) return side._name || resolvedName(t) || '';
        return side.name || '';
    };
    return { config, staged: !!pending, matches, patch, patchSide, resolvedName, pickedName };
}

// One player's block: eye · name (picked from the address book, or resolved
// read-only when match-fed) · sub-plate field or typed label/value · sub toggle
// · (when it's the only plate up) location.
const PlayerPlateSide = memo(function PlayerPlateSide({ t, pp, alone }) {
    const { config } = pp;
    const side = config.sides?.[t] || {};
    const isMatch = config.source === 'match';
    // Bound to an address-book row (from the fixture, or picked here) — the one
    // state in which there is a field to resolve.
    const bound = isMatch || !!side.participantId;
    const visible = side.visible !== false;
    const subVisible = side.subVisible !== false;
    const hasSub = bound ? !!side.subField : !!(side.subValue || side.subLabel);

    return (
        <div className={cn('rounded-md border border-border/60 bg-background/40 px-2', !visible && 'opacity-60')}>
            <ListRow
                lead={
                    <>
                        <IconToggle
                            icon={Eye} offIcon={EyeOff} on={visible} tone="plain"
                            label={visible ? 'On air — click to hide' : 'Hidden — click to show'}
                            onClick={() => pp.patchSide(t, { visible: !visible })}
                        />
                        <Text size="xs" className="w-12 shrink-0 font-medium text-muted-foreground">
                            Player {t}
                        </Text>
                    </>
                }
                // A match-fed plate takes its person from the fixture, so the
                // name slot is read-only text there and a picker when manual.
                name={isMatch ? (
                    <Text size="xs" truncate className="min-w-0 flex-1 text-foreground">
                        {pp.resolvedName(t) || <span className="text-muted-foreground">No name from match</span>}
                    </Text>
                ) : (
                    <div className="min-w-0 flex-1">
                        <ParticipantPicker
                            value={pp.pickedName(t)}
                            selectedId={side.participantId || null}
                            onResolve={(picked) => pp.patchSide(t, {
                                participantId: picked.id,
                                name: '',
                                _name: picked.display?.tag || picked.identities?.rioName || '',
                            })}
                            // The guest who isn't in the book: keep the typed
                            // name, drop the pick, and the typed sub-plate below
                            // takes over — there is no row to read a field off.
                            onRawValue={(text) => pp.patchSide(t, { participantId: null, name: text, _name: '' })}
                            placeholder={`Pick player ${t}…`}
                        />
                    </div>
                )}
                controls={
                    <IconToggle
                        icon={Captions} on={subVisible} disabled={!hasSub}
                        label={subVisible ? 'Sub-plate shown' : 'Sub-plate hidden'}
                        onClick={() => pp.patchSide(t, { subVisible: !subVisible })}
                    />
                }
            />

            {bound ? (
                <SelectRow
                    label={null} value={side.subField || ''} placeholder="No sub-plate"
                    onChange={(v) => pp.patchSide(t, { subField: v })}
                    options={PP_SUBFIELD_OPTIONS}
                />
            ) : (
                <div className="flex min-h-7 items-center gap-2">
                    <input
                        value={side.subLabel || ''}
                        onChange={(e) => pp.patchSide(t, { subLabel: e.target.value })}
                        placeholder="Sub label" aria-label={`Player ${t} sub label`}
                        className={cn(KIT_INPUT, 'w-[38%]')}
                    />
                    <input
                        value={side.subValue || ''}
                        onChange={(e) => pp.patchSide(t, { subValue: e.target.value })}
                        placeholder="Sub value" aria-label={`Player ${t} sub value`}
                        className={cn(KIT_INPUT, 'min-w-0 flex-1')}
                    />
                </div>
            )}
            {/* Only a plate on air ALONE is placed from its own block: a pair's two
                anchors are opposite, and that one bit is the Order row above. */}
            {alone && (
                <SegmentedRow
                    label="Where"
                    value={side.location || (t === 1 ? 'left' : 'right')}
                    onChange={(v) => pp.patchSide(t, { location: v })}
                    data={PP_LOCATION_OPTIONS}
                />
            )}
        </div>
    );
});

// The pair's left-to-right order, as one choice. The options NAME the two sides,
// so they go through the producer's own side vocabulary (sides.js) rather than
// hard-coding "1"/"2" — but the anchors either side of the dot are geometry and
// keep their literal meaning: the left-hand name is the plate on the left.
function OrderRow({ pp }) {
    const { label: sideLabel } = useSideLabels();
    const loc1 = pp.config.sides?.[1]?.location;
    const data = useMemo(() => [
        { value: 'left', label: `${sideLabel(1)} · ${sideLabel(2)}` },
        { value: 'right', label: `${sideLabel(2)} · ${sideLabel(1)}` },
    ], [sideLabel]);
    return (
        <SegmentedRow
            label="Order"
            value={loc1 === 'right' ? 'right' : 'left'}
            data={data}
            // Write BOTH anchors even though the server derives side 2's from
            // side 1's — the panel must not show a stored location it is about
            // to ignore, or the next lone-plate Where opens on a stale value.
            onChange={(v) => {
                const anchors = pairAnchor(v);
                pp.patch({
                    sides: {
                        ...pp.config.sides,
                        1: { ...(pp.config.sides?.[1] || {}), location: anchors[1] },
                        2: { ...(pp.config.sides?.[2] || {}), location: anchors[2] },
                    },
                });
            }}
        />
    );
}

export default function PlayerPlatesStage({ element, placement }) {
    const pp = usePlayerPlates();
    const { config } = pp;
    const ids = useMemo(() => matchIds(pp.matches), [pp.matches]);
    const shown = [1, 2].filter(t => config.sides?.[t]?.visible !== false);
    const alone = (t) => shown.length === 1 && shown[0] === t;

    return (
        <>
            <DirectStage element={element} placement={placement} />
            {pp.staged && (
                <Group gap="xs" className="items-center">
                    <StagedDot show />
                    <Text size="xs" className="text-amber-400">Plate changes staged</Text>
                </Group>
            )}

            <SegmentedRow
                label="From" value={config.source} data={PP_SOURCE_OPTIONS}
                onChange={(v) => pp.patch({ source: v })}
            />
            {config.source === 'match' && (
                <SelectRow
                    label="Match"
                    value={config.matchId != null && pp.matches[String(config.matchId)] ? String(config.matchId) : ''}
                    onChange={(v) => pp.patch({ matchId: v ? Number(v) : null })}
                    placeholder={ids.length ? 'Pick match…' : 'No matches yet'}
                    options={ids.map(id => ({ label: matchDisplayLabel(pp.matches, id), value: id }))}
                />
            )}

            {shown.length === 2 && <OrderRow pp={pp} />}

            <PlayerPlateSide t={1} pp={pp} alone={alone(1)} />
            <PlayerPlateSide t={2} pp={pp} alone={alone(2)} />

        </>
    );
}
