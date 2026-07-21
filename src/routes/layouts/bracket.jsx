import { memo, useState, useEffect, useMemo, useCallback } from 'react';
import { Stack, Text, Loader } from '../../components/ui/primitives';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Collapsible, CollapsibleContent } from '../../components/ui/collapsible';
import { useStateStore } from '../../context/store';
import useTournament from '../../hooks/useTournament';
import { itemClass } from './shared';
import { CopyIconButton } from './binding';

// ── Bracket Layout List (dynamic, based on loaded tournament phases) ──
const BRACKET_VARIANTS = [
    { key: 'full', label: 'Full Bracket', path: '/layout/bracket/index.html' },
    { key: 'winners', label: 'Winners Only', path: '/layout/bracket/index.html?winners_only=true' },
    { key: 'losers', label: 'Losers Only', path: '/layout/bracket/index.html?losers_only=true' },
];

const PlayerSchedulePanel = memo(function PlayerSchedulePanel({ selected, onSelect, baseUrl, phases, phasesLoaded }) {
    const activePlayer = useStateStore(s => s?.bracket?.activePlayer ?? '');
    const playerScheduleData = useStateStore(s => s?.playerSchedule);
    const setStateItem = useStateStore(s => s.setItem);
    const [draftPlayer, setDraftPlayer] = useState('');
    const [selectedPgIds, setSelectedPgIds] = useState(new Set());
    const [loading, setLoading] = useState(false);
    const [loadedCount, setLoadedCount] = useState(null);

    useEffect(() => { setDraftPlayer(activePlayer); }, [activePlayer]);

    useEffect(() => {
        if (!phasesLoaded || phases.length === 0) return;
        const poolIds = new Set();
        for (const phase of phases) {
            for (const pg of (phase.phaseGroups || [])) {
                if (pg.bracketType === 'ROUND_ROBIN') poolIds.add(pg.id);
            }
        }
        if (poolIds.size > 0) setSelectedPgIds(poolIds);
    }, [phases, phasesLoaded]);

    const isLoaded = loadedCount !== null;

    const checkedPgIds = useMemo(() =>
        isLoaded
            ? new Set((playerScheduleData?.visiblePgIds ?? []).map(String))
            : selectedPgIds,
    [isLoaded, playerScheduleData, selectedPgIds]);

    const setActivePlayer = useCallback((name) => {
        setStateItem('bracket.activePlayer', name);
    }, [setStateItem]);

    const togglePg = useCallback((pgId) => {
        if (isLoaded) {
            const current = new Set((playerScheduleData?.visiblePgIds ?? []).map(String));
            const strId = String(pgId);
            if (current.has(strId)) current.delete(strId); else current.add(strId);
            setStateItem('playerSchedule.visiblePgIds', Array.from(current));
        } else {
            setSelectedPgIds(prev => {
                const next = new Set(prev);
                if (next.has(pgId)) next.delete(pgId); else next.add(pgId);
                return next;
            });
        }
    }, [isLoaded, playerScheduleData, setStateItem]);

    const allPgs = useMemo(() => phases.flatMap(phase =>
        (phase.phaseGroups || []).map(pg => ({
            ...pg,
            label: phases.length > 1 || (phase.phaseGroups?.length ?? 0) > 1
                ? `${phase.name}${(phase.phaseGroups?.length ?? 0) > 1 ? ` – Pool ${pg.displayIdentifier}` : ''}`
                : phase.name,
        }))
    ), [phases]);

    const handleLoad = useCallback(async () => {
        if (allPgs.length === 0) return;
        setLoading(true);
        try {
            const baseApi = '/api/v1/startgg';
            const results = await Promise.all(
                allPgs.map((pg) =>
                    fetch(`${baseApi}/bracket-data?phase_group_id=${pg.id}`)
                        .then(r => r.json())
                        .then(r => ({ ...r, _pgId: pg.id }))
                )
            );
            const mergedPlayers = {};
            const mergedSets = [];
            for (const result of results) {
                if (result.error) continue;
                Object.assign(mergedPlayers, result.players || {});
                const bracketType = result.type || 'DOUBLE_ELIMINATION';
                const addRounds = (rounds) => {
                    for (const roundData of Object.values(rounds || {})) {
                        for (const set of (roundData.sets || [])) {
                            mergedSets.push({ ...set, phaseName: result.phaseName, phaseGroupId: result._pgId, bracketType });
                        }
                    }
                };
                addRounds(result.winnersRounds);
                addRounds(result.losersRounds);
                for (const set of (result.grandFinals || [])) {
                    mergedSets.push({ ...set, phaseName: result.phaseName, phaseGroupId: result._pgId, bracketType });
                }
            }
            setStateItem('playerSchedule', {
                players: mergedPlayers,
                sets: mergedSets,
                visiblePgIds: Array.from(selectedPgIds).map(String),
            });
            setLoadedCount(mergedSets.length);
        } catch (e) {
            console.error('[PlayerSchedule] load error', e);
        }
        setLoading(false);
    }, [allPgs, selectedPgIds, setStateItem]);

    const scheduleUrl = `${baseUrl}/layout/bracket/player_schedule.html`;
    const variants = [
        { key: 'all', label: 'All Games', url: scheduleUrl },
        { key: 'upcoming', label: 'Upcoming Only', url: `${scheduleUrl}?pool_only=true` },
        { key: 'noresults', label: 'Hide Results', url: `${scheduleUrl}?show_results=false` },
        { key: 'progressive', label: 'Progressive Reveal', url: `${scheduleUrl}?progressive=true` },
    ];

    const playerNames = useMemo(() =>
        Object.values(playerScheduleData?.players ?? {})
            .map(p => p.name).filter(Boolean).sort(),
    [playerScheduleData]);

    const visiblePgs = useMemo(() => {
        if (!playerScheduleData || !draftPlayer) return allPgs;
        const { sets = [], players = {} } = playerScheduleData;
        let targetId = null;
        for (const [id, p] of Object.entries(players)) {
            if ((p.name || '').toLowerCase() === draftPlayer.toLowerCase()) { targetId = id; break; }
        }
        if (!targetId) return allPgs;
        const loadedPgIds = new Set(sets.map(s => s.phaseGroupId).filter(Boolean));
        const playerPgIds = new Set(
            sets.filter(s => s.entrant1Id === targetId || s.entrant2Id === targetId)
                .map(s => s.phaseGroupId).filter(Boolean)
        );
        if (playerPgIds.size === 0 && loadedPgIds.size === 0) return allPgs;
        return allPgs.filter(pg => playerPgIds.has(pg.id) || !loadedPgIds.has(pg.id));
    }, [allPgs, playerScheduleData, draftPlayer]);

    const dlId = 'player-schedule-names';

    return (
        <Stack gap="xs">
            <Text size="xs" fw={600} dimmed className="uppercase tracking-wide">
                Player Schedule
            </Text>
            <div className="flex flex-col gap-1">
                <Input
                    placeholder="Player name..."
                    value={draftPlayer}
                    list={dlId}
                    onChange={(e) => setDraftPlayer(e.currentTarget.value)}
                    onBlur={() => setActivePlayer(draftPlayer)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setActivePlayer(draftPlayer); }}
                />
                <datalist id={dlId}>
                    {playerNames.slice(0, 10).map(n => <option key={n} value={n} />)}
                </datalist>
                <Text size="xs" dimmed>Shown in the schedule overlay</Text>
            </div>

            {phasesLoaded && visiblePgs.length > 0 && (
                <>
                    <Text size="xs" dimmed>Phases to include:</Text>
                    <Stack gap="xs">
                        {visiblePgs.map(pg => {
                            const sel = checkedPgIds.has(pg.id) || checkedPgIds.has(String(pg.id));
                            const typeLabel = pg.bracketType === 'ROUND_ROBIN' ? 'Pool' : pg.bracketType === 'DOUBLE_ELIMINATION' ? 'DE' : 'SE';
                            return (
                                <button type="button" key={pg.id} onClick={() => togglePg(pg.id)} className={itemClass(sel)}>
                                    <div className="flex flex-nowrap items-center gap-1.5">
                                        <span className="size-[11px] shrink-0 rounded-sm border-[1.5px] border-[#3b82f6]" style={{ background: sel ? '#3b82f6' : 'transparent' }} />
                                        <Text size="xs" truncate className="min-w-0 flex-1">{pg.label}</Text>
                                        <Badge variant="outline" className="text-[10px]">{typeLabel}</Badge>
                                    </div>
                                </button>
                            );
                        })}
                    </Stack>
                    <Button size="xs" variant="secondary" disabled={loading || allPgs.length === 0} onClick={handleLoad}>
                        {loading && <Loader size={10} />}
                        {loadedCount !== null ? `Reload All (${loadedCount} games)` : 'Load All Phases'}
                    </Button>
                </>
            )}

            {loadedCount !== null && (
                <Stack gap="xs" className="mt-0.5">
                    {variants.map(v => {
                        const isActive = selected?.url === v.url;
                        return (
                            <button type="button" key={v.key}
                                onClick={() => onSelect({ group: 'bracket', name: v.label, type: 'bracket', url: v.url, width: 440, height: 600 })}
                                className={itemClass(isActive)}>
                                <div className="flex flex-nowrap items-center justify-between gap-1">
                                    <div className="min-w-0 flex-1">
                                        <Text size="sm">{v.label}</Text>
                                        <Text size="xs" dimmed>440 x 600</Text>
                                    </div>
                                    <CopyIconButton value={v.url} />
                                </div>
                            </button>
                        );
                    })}
                </Stack>
            )}
        </Stack>
    );
});

const BracketLayoutList = memo(function BracketLayoutList({ selected, onSelect, baseUrl, onLoadBracket }) {
    const [expandedGroups, setExpandedGroups] = useState({});
    const bracketLink = useStateStore(s => s?.tournamentInfo?.bracket_link ?? '');
    const { fetchPhases, loadBracket } = useTournament();

    const [phases, setPhases] = useState([]);
    const [loadedPgId, setLoadedPgId] = useState(null);
    const [phasesLoaded, setPhasesLoaded] = useState(false);

    useEffect(() => {
        if (bracketLink && !phasesLoaded) {
            fetchPhases().then(result => {
                if (result) {
                    setPhases(result);
                    setPhasesLoaded(true);
                }
            });
        }
    }, [bracketLink, phasesLoaded, fetchPhases]);

    useEffect(() => {
        setPhasesLoaded(false);
        setPhases([]);
        setLoadedPgId(null);
    }, [bracketLink]);

    if (!bracketLink) {
        return (
            <Text size="xs" dimmed className="italic">
                Load a tournament in the Bracket tab to see bracket layouts.
            </Text>
        );
    }

    if (!phasesLoaded) {
        return <Loader size={18} />;
    }

    const phaseGroups = [];
    for (const phase of phases) {
        for (const pg of (phase.phaseGroups || [])) {
            const label = phases.length > 1 || (phase.phaseGroups?.length > 1)
                ? `${phase.name}${phase.phaseGroups.length > 1 ? ` - Pool ${pg.displayIdentifier}` : ''}`
                : phase.name;
            phaseGroups.push({ id: pg.id, label, bracketType: pg.bracketType });
        }
    }

    if (phaseGroups.length === 0) {
        return <Text size="xs" dimmed>No bracket phases found.</Text>;
    }

    const toggleGroup = (key) => {
        setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleSelect = async (pg, variant) => {
        const url = `${baseUrl}${variant.path}`;
        const item = {
            group: 'bracket',
            name: `${pg.label} — ${variant.label}`,
            type: 'bracket',
            url,
            width: 1920,
            height: 1080,
            _phaseGroupId: pg.id,
        };
        if (loadedPgId !== pg.id) {
            const result = await loadBracket(pg.id);
            if (result) setLoadedPgId(pg.id);
        }
        onSelect(item);
        if (onLoadBracket) onLoadBracket(pg.id);
    };

    const isVariantSelected = (pgId, variantKey) => {
        return selected?._phaseGroupId === pgId && selected?.url?.includes(
            variantKey === 'full' ? 'index.html' :
            variantKey === 'winners' ? 'winners_only=true' :
            'losers_only=true'
        ) && (variantKey === 'full' ? !selected?.url?.includes('_only=true') : true);
    };

    const isGroupActive = (pgId) => selected?._phaseGroupId === pgId;

    return (
        <Stack gap="xs">
            {phaseGroups.map(pg => {
                const key = `bracket-${pg.id}`;
                const open = expandedGroups[key] || isGroupActive(pg.id);
                const variants = pg.bracketType === 'ROUND_ROBIN'
                    ? [BRACKET_VARIANTS[0]]
                    : BRACKET_VARIANTS;

                return (
                    <div key={key}>
                        <button type="button" onClick={() => toggleGroup(key)} className={itemClass(isGroupActive(pg.id), 'violet')}>
                            <div className="flex flex-nowrap items-center justify-between">
                                <Text size="sm" fw={600}>{pg.label}</Text>
                                <div className="flex items-center gap-1">
                                    {loadedPgId === pg.id && (
                                        <Badge className="bg-[#22c55e] text-[10px] text-black">loaded</Badge>
                                    )}
                                    <Text size="xs" dimmed>{open ? '▴' : '▾'}</Text>
                                </div>
                            </div>
                        </button>
                        <Collapsible open={open}>
                            <CollapsibleContent>
                                <Stack gap="xs" className="pl-3 pt-1">
                                    {variants.map(variant => {
                                        const active = isVariantSelected(pg.id, variant.key);
                                        return (
                                            <button type="button" key={variant.key} onClick={() => handleSelect(pg, variant)} className={itemClass(active)}>
                                                <div className="flex flex-nowrap items-center justify-between gap-1">
                                                    <div className="min-w-0 flex-1">
                                                        <Text size="sm">{variant.label}</Text>
                                                        <Text size="xs" dimmed>1920 x 1080</Text>
                                                    </div>
                                                    <CopyIconButton value={`${baseUrl}${variant.path}`} />
                                                </div>
                                            </button>
                                        );
                                    })}
                                </Stack>
                            </CollapsibleContent>
                        </Collapsible>
                    </div>
                );
            })}

            <div className="mt-1 border-t border-border pt-2">
                <PlayerSchedulePanel
                    selected={selected}
                    onSelect={onSelect}
                    baseUrl={baseUrl}
                    phases={phases}
                    phasesLoaded={phasesLoaded}
                />
            </div>
        </Stack>
    );
});

export { BracketLayoutList };
