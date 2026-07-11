import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, Text, Loader } from '../../components/ui/primitives';
import { Panel } from '../../components/ui/panel';
import { TextField } from '../../components/ui/text-field';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
import { notifications } from '../../lib/notify';
import { RotateCw } from 'lucide-react';
import { useStateStore, useBracketStore } from '../../context/store';
import useTournament from '../../hooks/useTournament';

/*
 * TournamentLoader — the single tournament-load entry point for the whole
 * Competition tab (Phase 2 consolidation).
 *
 * Previously the URL could be entered in three places (the Competition Info
 * popover, the manual "Bracket Link" field, and the Bracket view's own loader).
 * This component is now the only one: it loads the event, fetches phases, and
 * background-prefetches every phase's sets + the entrants into the shared
 * `useBracketStore`. Both sub-views (Info & Entrants, Bracket) just read that
 * store, so loading here lights up the entire tab.
 */
export default function TournamentLoader() {
    const bracketLink = useStateStore(s => s?.tournamentInfo?.bracket_link ?? '');

    const {
        loading, error,
        setSource, loadEvent, fetchPhases, fetchSets, fetchEntrants, clearEvent,
    } = useTournament();

    const [prefetching, setPrefetching] = useState(false);
    const [statusText, setStatusText] = useState('');
    const prefetchInflightRef = useRef(false);
    // Tracks whether the URL field has been edited since the last successful load.
    // A loaded, unedited URL turns the button into a Refresh (re-pull) action.
    const [urlDirty, setUrlDirty] = useState(false);

    const bs = useBracketStore();
    const { tournament, update } = bs;
    const url = bs.url ?? '';

    // ── Background prefetch: cache sets for every phase + entrants ────
    const prefetchTournamentData = useCallback((phasesList, link) => {
        if (prefetchInflightRef.current) return;

        const phasesToFetch = (phasesList || []).filter(p => p?.id != null);
        const setJobs = phasesToFetch.flatMap(p => [
            { kind: 'sets', phase: p, finished: false },
            { kind: 'sets', phase: p, finished: true },
        ]);
        const entrantsAlreadyCached =
            link && useBracketStore.getState().entrantsLoadedFor === link;
        const jobs = entrantsAlreadyCached
            ? setJobs
            : [...setJobs, { kind: 'entrants' }];

        if (jobs.length === 0) return;

        prefetchInflightRef.current = true;
        setPrefetching(true);
        let done = 0;
        const total = jobs.length;
        setStatusText(`Caching tournament data (0/${total})…`);

        const fetchSetsJob = async ({ phase, finished }) => {
            const key = `${phase.id}|${null}|${finished}`;
            const existing = useBracketStore.getState().setsByKey?.[key];
            if (existing) return;
            const opts = { phaseId: Number(phase.id), includeFinished: finished };
            const first = await fetchSets(1, opts);
            if (!first) return;
            let collected = first.sets;
            const totalPages = first.pageInfo?.totalPages || 1;
            if (totalPages > 1) {
                const rest = await Promise.all(
                    Array.from({ length: totalPages - 1 }, (_, i) => fetchSets(i + 2, opts))
                );
                collected = collected.concat(...rest.filter(Boolean).map(r => r.sets));
            }
            update({
                setsByKey: { ...(useBracketStore.getState().setsByKey || {}), [key]: collected },
            });
        };

        const fetchEntrantsJob = async () => {
            const first = await fetchEntrants(1);
            if (!first) return;
            let collected = first.entrants;
            const totalPages = first.pageInfo?.totalPages || 1;
            if (totalPages > 1) {
                const rest = await Promise.all(
                    Array.from({ length: totalPages - 1 }, (_, i) => fetchEntrants(i + 2))
                );
                collected = collected.concat(...rest.filter(Boolean).map(r => r.entrants));
            }
            update({
                entrants: collected,
                entrantsPage: 1,
                entrantsTotalPages: 1,
                entrantsLoadedFor: link,
            });
        };

        Promise.all(jobs.map(j =>
            (j.kind === 'entrants' ? fetchEntrantsJob() : fetchSetsJob(j))
                .finally(() => {
                    done += 1;
                    setStatusText(`Caching tournament data (${done}/${total})…`);
                })
        )).finally(() => {
            prefetchInflightRef.current = false;
            setPrefetching(false);
            setStatusText('');
        });
    }, [fetchSets, fetchEntrants, update]);

    // ── Auto-restore a previously loaded tournament on first mount ────
    useEffect(() => {
        if (bs.suppressAutoLoad) {
            if (!bracketLink) update({ suppressAutoLoad: false });
            return;
        }
        if (tournament || !bracketLink) return;
        update({ url: bracketLink });
        setSource(bracketLink);
        (async () => {
            const result = await loadEvent(bracketLink);
            if (!result || result.error) return;
            const phaseUpdate = { tournament: result };
            const phasesResult = await fetchPhases();
            if (phasesResult) {
                phaseUpdate.phases = phasesResult;
                if (phasesResult.length === 1) {
                    phaseUpdate.selectedPhase = String(phasesResult[0].id);
                }
            }
            update(phaseUpdate);
            if (phasesResult) prefetchTournamentData(phasesResult, bracketLink);
        })();
    }, [bracketLink, tournament, bs.suppressAutoLoad, update, setSource, loadEvent, fetchPhases, prefetchTournamentData]);

    // ── Load event ───────────────────────────────────────────────────
    const handleLoadEvent = useCallback(async () => {
        if (!url.trim()) return;
        setStatusText('Loading tournament…');
        const result = await loadEvent(url.trim());
        if (!result || result.error) {
            setStatusText('');
            notifications.show({ message: result?.error || 'Failed to load tournament', color: 'red' });
            return;
        }

        notifications.show({ message: `Loaded: ${result.tournamentName}`, color: 'green' });
        setUrlDirty(false);

        update({
            tournament: result,
            sets: [],
            entrants: [],
            // Reset the cache marker too — otherwise a Refresh (same link) makes
            // the prefetch below treat entrants as already-cached and skip the
            // re-pull, leaving the list we just cleared empty ("No entrants found").
            entrantsLoadedFor: null,
            selectedPhase: null,
            selectedPool: null,
            loadedSets: {},
        });

        setStatusText('Fetching phases…');
        const phasesResult = await fetchPhases();
        if (phasesResult) {
            const phaseUpdate = { phases: phasesResult };
            if (phasesResult.length === 1) {
                phaseUpdate.selectedPhase = String(phasesResult[0].id);
            }
            update(phaseUpdate);
            prefetchTournamentData(phasesResult, url.trim());
        } else {
            setStatusText('');
        }
    }, [url, loadEvent, fetchPhases, update, prefetchTournamentData]);

    const handleClear = useCallback(async () => {
        update({ suppressAutoLoad: true });
        setStatusText('');
        await clearEvent();
        update({
            tournament: null,
            phases: [],
            selectedPhase: null,
            selectedPool: null,
            sets: [],
            setsPage: 1,
            setsTotalPages: 0,
            includeFinished: false,
            loadedSets: {},
            entrants: [],
            entrantsPage: 1,
            entrantsTotalPages: 0,
            entrantsLoadedFor: null,
            url: '',
            lastFetchedKey: null,
            lastFetchedAt: null,
            allSets: [],
            allSetsLoadedFor: null,
            setsByKey: {},
        });
        notifications.show({ message: 'Tournament cleared', color: 'gray' });
    }, [clearEvent, update]);

    return (
        <Stack gap="sm">
            <Panel title="Load Tournament">
                <Stack gap="xs" className="p-4">
                    <div className="flex items-end gap-2">
                        <TextField
                            label="Tournament URL"
                            placeholder="https://start.gg/tournament/.../event/... or https://challonge.com/..."
                            className="flex-1"
                            value={url}
                            onChange={e => { update({ url: e.currentTarget.value }); setUrlDirty(true); }}
                            onKeyDown={e => e.key === 'Enter' && handleLoadEvent()}
                        />
                        {(() => {
                            const busy = loading || prefetching;
                            // Loaded + URL untouched → the button re-pulls (Refresh).
                            const isRefresh = !!tournament && !urlDirty && !!url.trim();
                            return (
                                <Button
                                    size="sm"
                                    onClick={handleLoadEvent}
                                    disabled={busy}
                                    // Fixed width so swapping in the spinner doesn't resize the button.
                                    className="w-[104px] shrink-0 justify-center gap-1.5"
                                >
                                    {busy
                                        ? <Loader size={12} />
                                        : isRefresh && <RotateCw size={13} />}
                                    {isRefresh ? 'Refresh' : 'Load'}
                                </Button>
                            );
                        })()}
                        {tournament && (
                            <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" onClick={handleClear}>
                                Clear
                            </Button>
                        )}
                    </div>
                    <Text size="xs" dimmed>
                        Paste a start.gg event URL, or a Challonge tournament URL (deprecated — limited support)
                    </Text>
                    {statusText && (
                        <div className="mt-1 flex items-center gap-2">
                            <Loader size={12} />
                            <Text size="xs" dimmed>{statusText}</Text>
                        </div>
                    )}
                </Stack>
            </Panel>

            {error && (
                <Alert variant="destructive">
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {tournament && (
                <Panel glow={false} className="p-3">
                    <div className="flex flex-wrap items-center gap-6">
                        <Text fw={600}>{tournament.tournamentName}</Text>
                        {tournament.eventName && (
                            <Badge variant="secondary">{tournament.eventName}</Badge>
                        )}
                        <Text size="sm" dimmed>{tournament.numEntrants} entrants</Text>
                        {tournament.address && (
                            <Text size="sm" dimmed>{tournament.address}</Text>
                        )}
                        {tournament.isOnline && (
                            <Badge className="bg-[#22b8cf] text-black">Online</Badge>
                        )}
                    </div>
                </Panel>
            )}
        </Stack>
    );
}
