import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Captions, Eye, EyeOff } from 'lucide-react';
import { useStateStore } from '../../../context/store';
import { stageOrRun, usePending } from '../../../context/staging';
import {
    setPlayerPlatesConfig, normalizeConfig as normalizePlatesConfig,
    PP_MODE_OPTIONS, PP_SOURCE_OPTIONS, PP_LOCATION_OPTIONS, PP_SUBFIELD_OPTIONS,
} from '../../../context/playerplates';
import { Group, Text } from '../../../components/ui/primitives';
import { cn } from '../../../lib/utils';
import { IconToggle, KIT_INPUT, ListRow, SegmentedRow, SelectRow } from '../kit';
import { StagedDot } from '../controls';
import { matchDisplayLabel, matchIds } from '../matches';
import { DirectStage } from './generic';

/*
 * Player Plates stage — a sibling of Commentary: the two-player name/sub-plate
 * band. The producer picks a MODE (both L/R, or one player at a togglable
 * location) and each plate's content (fed from a match, or typed manually);
 * the whole config stages+PUTs as ONE key ('playerplates'), and the server
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
    return { config, staged: !!pending, matches, patch, patchSide, resolvedName };
}

// One player's block: eye · name (typed, or resolved read-only when match-fed)
// · sub-plate field/value · sub toggle · (single-mode) location.
const PlayerPlateSide = memo(function PlayerPlateSide({ t, pp }) {
    const { config } = pp;
    const side = config.sides?.[t] || {};
    const isMatch = config.source === 'match';
    const visible = side.visible !== false;
    const subVisible = side.subVisible !== false;
    const hasSub = isMatch ? !!side.subField : !!(side.subValue || side.subLabel);

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
                // Match-fed plates resolve their name server-side, so the name
                // slot is read-only text there and an input when typed.
                name={isMatch ? (
                    <Text size="xs" truncate className="min-w-0 flex-1 text-foreground">
                        {pp.resolvedName(t) || <span className="text-muted-foreground">No name from match</span>}
                    </Text>
                ) : (
                    <input
                        value={side.name || ''}
                        onChange={(e) => pp.patchSide(t, { name: e.target.value })}
                        placeholder={`Player ${t} name…`}
                        aria-label={`Player ${t} name`}
                        className={cn(KIT_INPUT, 'min-w-0 flex-1')}
                    />
                )}
                controls={
                    <IconToggle
                        icon={Captions} on={subVisible} disabled={!hasSub}
                        label={subVisible ? 'Sub-plate shown' : 'Sub-plate hidden'}
                        onClick={() => pp.patchSide(t, { subVisible: !subVisible })}
                    />
                }
            />

            {isMatch ? (
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
            {config.mode !== 'both' && (
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

export default function PlayerPlatesStage({ element }) {
    const pp = usePlayerPlates();
    const { config } = pp;
    const ids = useMemo(() => matchIds(pp.matches), [pp.matches]);
    const showSide = (t) => config.mode === 'both'
        || (config.mode === 'p1' && t === 1) || (config.mode === 'p2' && t === 2);

    return (
        <>
            <DirectStage element={element} />
            {pp.staged && (
                <Group gap="xs" className="items-center">
                    <StagedDot show />
                    <Text size="xs" className="text-amber-400">Plate changes staged</Text>
                </Group>
            )}

            <SegmentedRow
                label="Show" value={config.mode} data={PP_MODE_OPTIONS}
                onChange={(v) => pp.patch({ mode: v })}
            />
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

            {showSide(1) && <PlayerPlateSide t={1} pp={pp} />}
            {showSide(2) && <PlayerPlateSide t={2} pp={pp} />}

        </>
    );
}
