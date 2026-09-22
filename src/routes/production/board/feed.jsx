import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info, RotateCw } from 'lucide-react';
import { useSettingsStore } from '../../../context/store';
import { useSocketSubscribe } from '../../../context/socket';
import { stageOrRun } from '../../../context/staging';
import { Stack, Text, Divider, Loader } from '../../../components/ui/primitives';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Combobox } from '../../../components/ui/combobox';
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { cn } from '../../../lib/utils';
import { FieldRow, KIT_SECTION } from '../kit';
import { useBoardQueueId, useQueues } from '../match/queue';
import { withHeldModes } from './gamemodes';

// What feeds the board: the mode row on the game-state rule, the live refresh
// countdown, the stats diagnostics, and the board's running order.

/*
 * THE FEED — where this board's game comes from and what mode it is being
 * fetched as. Rides the Game-state header rule, beside the sides.
 *
 * IT WAS A REGION OF ITS OWN AND ON A HUD BOARD THAT REGION HAD NOTHING IN IT.
 * "Games" carried a transport badge, a sentence, a re-read button and a mode
 * picker across four lines, and ./games returns nothing for a HUD board — so a
 * board with exactly one possible game, from exactly one file, spent a labelled
 * region and a divider saying so. The pool surface (playback, filters, the game
 * table) is what earns a region; a transport with no choice in it does not.
 *
 * The mode moved with it because it is not a board property either. It is the
 * binding (`scoreboards.binding.{N}.stats_tag`) and it decides the tag every
 * stats fetch for this board goes out under, which qualifies the game the mirror
 * below is drawing — so it belongs on that region's rule, not floating above a
 * header of its own.
 *
 * GAME MODE, with the override called out.
 *
 * A picked mode is an OVERRIDE and behaves like `rioName_override`: it wins, it
 * sticks against every feed path, and it is MARKED — same amber ring the name
 * picker wears, because amber is what the console spends on "you would want to
 * know before this is on air". Without the mark the two states were
 * indistinguishable, which is how a mode chosen for one game silently outlived it
 * and sent every later stats fetch at the wrong tag.
 *
 * The disagreement is stated only when there IS one: the live game's mode beside
 * the pick, and one press to hand the board back to the feed. A board with no
 * override, or one whose override matches what is being played, says nothing —
 * agreement is not news. It is said in as few words as the console can spend:
 * the mode name is the long part and it is printed ONCE, because a season name
 * ("SLICE 2026 Superstars Off") is half the panel's width on its own and a
 * sentence built around two of them wrapped to three lines under the picker.
 *
 * THE ACTIVE LIST IS NOT THE VOCABULARY. It is the list to PICK from, but a
 * board's mode comes from the game it is carrying, and a rotating pool of
 * completed games is full of ended seasons that list no longer names. A Combobox
 * whose value isn't in `data` renders its placeholder, so those boards read
 * "Select game mode" while holding a perfectly good tag. The catalogue is
 * offered in two tiers (./gamemodes) — active first, ended below — and whatever
 * this board is set to or playing is folded in on top of that, so the selector
 * can always say what it holds even when neither list has caught up with the
 * feed.
 */
export const ModeRow = memo(function ModeRow({ d, gameModes, stats, refreshHud, refreshing }) {
    const diverged = d.statsTagManual && !!d.liveMode && d.liveMode !== d.statsTag;
    const options = useMemo(
        () => withHeldModes(gameModes, d.statsTag, d.liveMode),
        [gameModes, d.statsTag, d.liveMode],
    );
    return (
        <>
            {/* WHERE THE GAME COMES FROM, beside the game. The badge is the
                DERIVED transport — board 1 carries the local HUD iff the global
                toggle is on, every other board is API, no picker ever — and how
                to change that is a tooltip on it rather than a clause appended to
                a sentence, because it is wanted about once and read forever. */}
            <SimpleTooltip
                label={d.transport === 'hud'
                    ? 'One game, from Project Rio’s local HUD file. Board 1 carries it while Follow local HUD is on — turn that off on Connections to rebind this board.'
                    : 'Games come from the Project Rio API. Only board 1 can carry the local HUD.'}
            >
                <Badge className={cn(
                    'shrink-0 text-[11px] font-semibold uppercase tracking-wider',
                    d.transport === 'hud'
                        ? 'bg-[#22c55e]/15 text-[#4ade80]'
                        : 'bg-[#3b82f6]/15 text-[#60a5fa]',
                )}>
                    {d.transport === 'hud' ? 'HUD' : 'API'}
                </Badge>
            </SimpleTooltip>
            <Combobox
                aria-label="Game mode"
                placeholder="Select game mode"
                data={options}
                value={d.statsTag || null}
                onChange={d.setStatsTag}
                clearable
                className={cn(
                    // Wide enough for the longest season name PRSH has seen
                    // ("SLICE 2026 Superstars Off") and no wider.
                    'h-7 w-64 min-w-0 shrink text-xs',
                    d.statsTagManual && 'border-amber-400 ring-1 ring-amber-400/40',
                )}
            />
            <StatsDiagnostics stats={stats} />
            {/* THE OVERRIDE IS A RING AND ONE BUTTON, not a second line under the
                picker saying "Overriding X". The amber ring already says a hand is
                on it and the button says how to hand it back — the mode's name
                lives in that button's tooltip, which is the only place it was
                doing any work. Same shape as the sides' Use auto. */}
            {diverged && (
                <Button
                    size="xs" variant="ghost" className="h-6 shrink-0"
                    onClick={d.useLiveMode}
                    title={`Use ${d.liveMode} — the mode this game is being played in`}
                >
                    Use live
                </Button>
            )}
            {/* THE RECOVERY PATH AFTER A CLEAR OR A HAND EDIT — the only way to
                put Project Rio's game back on a board the producer has blanked, so
                it says what it does. It was a bare ↻ beside a badge, which reads
                as "refresh this readout". */}
            {d.transport === 'hud' && (
                <Button
                    variant="ghost" size="xs"
                    className="h-6 shrink-0 gap-1.5"
                    onClick={refreshHud} disabled={refreshing}
                    title="Read decoded.hud.json again and put what Project Rio is showing back on this board"
                >
                    {refreshing ? <Loader size={12} /> : <RotateCw size={13} />}
                    Re-read HUD
                </Button>
            )}
        </>
    );
});

/*
 * WHICH RUNNING ORDER this board draws its next fixture from.
 *
 * Renders nothing while there is one order — the answer is "the only one", and a
 * picker with a single option is a control that cannot do anything. It writes
 * `scoreboards.match_queue.{sb}` in Settings, deliberately NOT into
 * `scoreboards.binding.{sb}`: the binding is pool + playback + stats_tag, "which
 * GAMES fill this board", where this is which order of FIXTURES it takes from.
 *
 * Staged like the board's other broadcast-visible properties: changing it changes
 * which fixture the next press of Up next puts on air.
 */
export const BoardQueueRow = memo(function BoardQueueRow({ sb }) {
    const queues = useQueues();
    const current = useBoardQueueId(sb);
    const setItem = useSettingsStore(s => s.setItem);
    if (queues.length <= 1) return null;
    return (
        // IT OWNS ITS SECTION RULE, because it is the section's only member and
        // it self-hides. A divider drawn by the desk around it would be a rule
        // under the capture with nothing beneath it on every single-order rig,
        // which is almost every rig.
        <div className={KIT_SECTION}>
        <FieldRow label="Matches from">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {queues.map(q => (
                    <Button
                        key={q.id}
                        size="xs"
                        variant={q.id === current ? 'default' : 'outline'}
                        role="radio"
                        aria-checked={q.id === current}
                        onClick={() => stageOrRun({
                            key: `board:${sb}:match_queue`,
                            label: `Board ${sb}: take matches from ${q.title || q.id}`,
                            value: q.id,
                            liveValue: current,
                            run: () => setItem(`scoreboards.match_queue.${sb}`, q.id),
                        })}
                    >
                        {q.title || q.id}
                    </Button>
                ))}
            </div>
        </FieldRow>
        </div>
    );
});

/*
 * WHEN THIS BOARD NEXT PICKS UP ITS LIVE GAME.
 *
 * The countdown belongs HERE, on the board, beside the sentence that says the
 * board is following a live game — not down on the game list, which is a browser
 * of what else is on and now refreshes only when a producer presses Refresh.
 * That was the whole confusion: one countdown, sitting under the list, timing
 * something the list had nothing to do with.
 *
 * It is a READOUT OF THE SERVER'S CADENCE, and it fetches nothing. Every
 * successful ongoing poll emits `v1.game_pool.ongoing_update` (server
 * OngoingGamePool._fetch_games, right after `_reapply_single_live` has pushed the
 * fresh game onto this board), so the arrival of that event IS the refresh the
 * producer just watched land. Counting from it can't drift out of step with the
 * server the way a client-side interval of its own would.
 *
 * It renders only while the poll is actually going to fire: `_live_consumers_exist`
 * wants a single-mode board with a pinned game that is still being played, so a
 * completed game or an unpinned board gets no countdown rather than one that
 * silently never arrives.
 */
export function LiveRefreshCountdown({ active }) {
    const interval = useSettingsStore(s => Number(s?.ongoing_games?.poll_interval) || 10);
    const [remaining, setRemaining] = useState(interval);
    const nextRef = useRef(Date.now() + interval * 1000);

    const onPoll = useCallback(() => {
        nextRef.current = Date.now() + interval * 1000;
        setRemaining(interval);
    }, [interval]);
    useSocketSubscribe('v1.game_pool.ongoing_update', onPoll);

    useEffect(() => {
        if (!active) return undefined;
        nextRef.current = Date.now() + interval * 1000;
        setRemaining(interval);
        const id = setInterval(() => {
            setRemaining(Math.max(0, Math.round((nextRef.current - Date.now()) / 1000)));
        }, 250);
        return () => clearInterval(id);
    }, [active, interval]);

    if (!active) return null;
    return (
        <SimpleTooltip
            label={`This board follows its live game from the Project Rio API, which PRSH re-reads `
                + `every ${interval}s. The game list below never refreshes on its own.`}
        >
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
                <RotateCw size={11} />
                {/* Held at zero rather than going negative: the poll has fired and
                    we are waiting on the API, which is a real state and a short one. */}
                {remaining > 0 ? `Refreshing in ${remaining}s` : 'Refreshing…'}
            </span>
        </SimpleTooltip>
    );
}

/*
 * The stats fetch for this board. Push-based: the server emits
 * v1.stats.fetch_status on every loading→done transition, so there is no polling
 * and no spinner lag.
 *
 * It reports through the ⓘ popover beside the game mode, exactly as it did on
 * the Match tab — the per-player character counts, the URL pattern and the tag
 * are diagnostics, so they stay one click away rather than spending a line of
 * the panel on every board that is working fine.
 */
export function useStatsDiagnostics(sb) {
    const [diagnostics, setDiagnostics] = useState(null);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    const onStatus = useCallback((payload) => {
        if (payload?.scoreboard !== sb) return;
        setDiagnostics(payload);
        setBusy(payload.status === 'loading');
    }, [sb]);
    useSocketSubscribe('v1.stats.fetch_status', onStatus);

    // A one-shot read when the popover opens cold, for the case where the fetch
    // happened before this panel did — without it the board would read as
    // "nothing fetched yet" while its overlays are drawing real stats.
    const inspect = useCallback(() => {
        setOpen(true);
        if (diagnostics == null) {
            fetch(`/api/v1/rio/stats/diagnostics?scoreboard=${sb}`)
                .then(r => r.json())
                .then(setDiagnostics)
                .catch(() => {});
        }
    }, [sb, diagnostics]);

    const refresh = useCallback(() => {
        setBusy(true);
        fetch(`/api/v1/rio/stats/refresh?scoreboard=${sb}`, { method: 'POST' })
            .catch(() => setBusy(false));
    }, [sb]);

    return { diagnostics, open, setOpen, busy, inspect, refresh };
}

// The diagnostics popover — a verbatim keep of the Match tab's, because it is
// the one place the stats pipeline explains itself.
const StatsDiagnostics = memo(function StatsDiagnostics({ stats }) {
    const { diagnostics, open, setOpen, busy, inspect, refresh } = stats;
    return (
        <Popover open={open && diagnostics != null} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={inspect} title="Inspect stats fetch">
                    {busy ? <Loader size={12} /> : <Info size={14} />}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[320px]">
                <Stack gap="xs">
                    <Text size="xs" fw={600}>Stats Fetch Diagnostics</Text>
                    {diagnostics?.fetched_at ? (
                        <>
                            {diagnostics.error && (
                                <Text size="xs" c="#ff5a5f">{diagnostics.error}</Text>
                            )}
                            {diagnostics.url && (
                                <div>
                                    <Text size="xs" dimmed>URL Pattern</Text>
                                    <Text size="xs" className="break-all">{diagnostics.url}</Text>
                                </div>
                            )}
                            {diagnostics.tag && (
                                <div className="flex items-center gap-1">
                                    <Text size="xs" dimmed>Tag:</Text>
                                    <Badge variant="secondary" className="text-[10px]">{diagnostics.tag}</Badge>
                                </div>
                            )}
                            {Object.keys(diagnostics.players ?? {}).length > 0 && (
                                <>
                                    <Divider />
                                    {Object.entries(diagnostics.players).map(([name, info]) => (
                                        <div key={name} className="flex items-center justify-between">
                                            <Text size="xs">{name}</Text>
                                            {info.status === 'loading' ? (
                                                <div className="flex items-center gap-1">
                                                    <Loader size={10} />
                                                    <Text size="xs" dimmed>Loading...</Text>
                                                </div>
                                            ) : info.error ? (
                                                <Badge variant="destructive" className="text-[10px]">Error</Badge>
                                            ) : (
                                                <Badge
                                                    className={cn('text-[10px] text-white',
                                                        info.char_count > 0 ? 'bg-[#22c55e]' : 'bg-[#f5bb00] text-black')}
                                                >
                                                    {info.char_count} chars
                                                </Badge>
                                            )}
                                        </div>
                                    ))}
                                </>
                            )}
                            <Text size="xs" dimmed ta="right">
                                {new Date(diagnostics.fetched_at).toLocaleTimeString()}
                            </Text>
                        </>
                    ) : (
                        <Text size="xs" dimmed>No stats have been fetched yet.</Text>
                    )}
                    <Button
                        size="sm" variant="secondary" className="w-full"
                        onClick={refresh} disabled={busy}
                    >
                        {busy && <Loader size={12} />}
                        Refresh Stats
                    </Button>
                </Stack>
            </PopoverContent>
        </Popover>
    );
});
