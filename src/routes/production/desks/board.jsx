import { memo, useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ArrowLeftRight, RotateCw, Trash2 } from 'lucide-react';
import { useStateStore, useSettingsStore } from '../../../context/store';
import { useSocketSubscribe } from '../../../context/socket';
import { useStagingStore, stageOrRun } from '../../../context/staging';
import ParticipantPicker from '../../../components/ParticipantPicker';
import { Text, Group } from '../../../components/ui/primitives';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover';
import { notifications } from '../../../lib/notify';
import { cn } from '../../../lib/utils';
import { HALF_INNINGS } from '../../../data/msb';
import { STADIUM_OPTIONS } from '../../../data/stadiums';
import {
    ActionRow, FieldRow, KitColumn, KitColumns, SegmentedRow, SelectRow, TextRow,
    KIT_INPUT,
} from '../kit';
import { StagedDot } from '../controls';
import { useActiveBoards, useBoardLabel } from '../boards';
import { BoardGameSubject } from '../subject';

/*
 * Board desk — the console's panel for one scoreboard.
 *
 * A board is a desk, not an element: it feeds the broadcast and is never on it
 * (see ../boards for why the id lives in the desk namespace). This panel is the
 * one place that answers, from the BOARD's side, the three questions the console
 * could not answer before it existed:
 *
 *   what is this board carrying   — the live game, and the match bound to it
 *   why does it look like that    — side_reason, which the server has always
 *                                   computed and nothing ever read
 *   how do I fix it               — corrections, at correction grade
 *
 * CORRECTION GRADE is the deliberate scope. The score, the inning, the count,
 * the stadium, which side is home, the two identities and the two escape
 * hatches (swap, reset) — the things a producer nudges when a HUD frame lands
 * wrong or a board is being driven by hand between games. What used to sit
 * beside them on the Match tab — a roster grid, per-character stat editing,
 * manual runner and fielder placement — was read-only under every real feed and
 * is deleted, not moved.
 *
 * Every broadcast-visible write routes through the staging gateway under
 * `board:{sb}:{field}`. The momentary ones (re-read the HUD file, refresh stats)
 * fire immediately, same rule as Take and capture. Rig admin — the alias, and
 * removing the board — is config rather than content, so it is immediate too.
 */

const halfInningOptions = HALF_INNINGS.map(h => ({ value: h, label: h }));

// Coerce state (which round-trips through the socket as strings sometimes).
const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

/*
 * WHY the sides are ordered the way they are.
 *
 * `_decide()` in server/rio/provider.py runs manual > match > pin > back_to_back
 * on every new game and mirrors the deciding layer to `score.{N}.side_reason`
 * "so a surface can say why". Until now the only reference to that key in the
 * whole frontend was the reset that CLEARS it — the answer was computed every
 * game and shown to nobody, which is most of why "how does this work" needed
 * explaining at all.
 */
const SIDE_REASON = {
    manual: 'set by hand for this game',
    match: 'from the bound match',
    pin: 'pinned in Settings',
    back_to_back: 'where they were last game',
};

export function sideReasonLine(reason, leftName) {
    const why = SIDE_REASON[reason];
    if (!why) return null;
    const who = leftName || 'Side 1';
    return `${who} on the left — ${why}`;
}

/*
 * What the board is carrying, from the board's side: the match id (the M in
 * `score.{N}.match = M`, which is otherwise invisible outside the Match desk),
 * its round label, and the series it belongs to.
 */
export function matchBindLine(m, match) {
    if (m == null || m === '') return null;
    const w1 = num(match?.series?.[1] ?? match?.series?.['1'], 0);
    const w2 = num(match?.series?.[2] ?? match?.series?.['2'], 0);
    const bits = [`Match ${m}`, match?.label, match?.phase, `${w1}–${w2}`].filter(Boolean);
    return bits.join(' · ');
}

/*
 * The board's one-line state for the rack row. STATE ONLY (plus the derived
 * transport, which is a settings read, not a fetch) — the rack redraws on every
 * HUD frame and must never fire a desk's own requests just to paint a row.
 */
export function useBoardDeskMeta(sb) {
    const hudEnabled = useSettingsStore(s => s?.project_rio?.hud_enabled);
    const mode = useSettingsStore(
        s => s?.scoreboards?.binding?.[sb]?.playback?.mode
            ?? s?.scoreboards?.binding?.[String(sb)]?.playback?.mode,
    );
    return useStateStore(useShallow(s => {
        const b = s?.score?.[sb];
        // Board 1 carries the local HUD iff the global toggle is on; the server
        // default for that toggle is on, so only an explicit false is off.
        const hud = Number(sb) === 1 && hudEnabled !== false;
        const transport = hud ? 'HUD' : 'API';
        const n1 = b?.player?.[1]?.rioName || '';
        const n2 = b?.player?.[2]?.rioName || '';
        if (n1 || n2) {
            const inning = b?.inning != null
                ? ` · ${(b?.half_inning || 'Top') === 'Top' ? 'Top' : 'Bot'} ${b.inning}`
                : '';
            return {
                meta: `${transport} · ${n1 || 'Side 1'} ${b?.score_left ?? 0}–${b?.score_right ?? 0} ${n2 || 'Side 2'}${inning}`,
                idle: false,
            };
        }
        // Nothing on the board: say what it is waiting for rather than "empty".
        if (!hud && mode === 'rotate') {
            const n = (s?.scoreboards?.rotation?.[sb]?.game_ids ?? []).length;
            return { meta: `${transport} · rotating, ${n} in pool`, idle: true };
        }
        return { meta: `${transport} · no game`, idle: true };
    }));
}

/*
 * One board's live facts plus its writers. Broadcast-visible writes go through
 * `stageOrRun` keyed `board:{sb}:{field}`, and `val()` shows the staged value so
 * a producer in confirm mode reads what they typed rather than what is on air.
 */
export function useBoardDesk(sb) {
    const setItem = useStateStore(s => s.setItem);
    const setItems = useStateStore(s => s.setItems);
    const settingsSetItem = useSettingsStore(s => s.setItem);
    const base = `score.${sb}`;

    const hudEnabled = useSettingsStore(s => s?.project_rio?.hud_enabled);
    const transport = (Number(sb) === 1 && hudEnabled !== false) ? 'hud' : 'api';
    const statsTag = useSettingsStore(
        s => s?.scoreboards?.binding?.[sb]?.stats_tag
            ?? s?.scoreboards?.binding?.[String(sb)]?.stats_tag
            ?? '',
    );

    const g = useStateStore(useShallow(s => {
        const b = s?.score?.[sb];
        return {
            scoreLeft: num(b?.score_left), scoreRight: num(b?.score_right),
            inning: num(b?.inning, 1), halfInning: b?.half_inning || 'Top',
            balls: num(b?.balls), strikes: num(b?.strikes), outs: num(b?.outs),
            stadium: b?.stadium || '',
            homeTeam: num(b?.home_team, 2),
            sideReason: b?.side_reason || '',
            conflict: !!b?.match_conflict,
            match: b?.match ?? null,
            name1: b?.player?.[1]?.rioName || '',
            name2: b?.player?.[2]?.rioName || '',
            override1: b?.player?.[1]?.rioName_override || '',
            override2: b?.player?.[2]?.rioName_override || '',
        };
    }));
    const boundMatch = useStateStore(useShallow(s => {
        const m = s?.score?.[sb]?.match;
        const rec = m != null ? s?.match?.[m] : null;
        return rec ? { label: rec.label, phase: rec.phase, series: rec.series } : null;
    }));

    const pendingMap = useStagingStore(s => s.pending);
    const val = (field, live) => {
        const p = pendingMap[`board:${sb}:${field}`];
        return p ? p.value : live;
    };
    const isStaged = (field) => !!pendingMap[`board:${sb}:${field}`];

    // One state field, staged. `liveValue` lets a control staged back to what is
    // already on air drop out of the buffer entirely.
    const setField = (field, value, label) => stageOrRun({
        key: `board:${sb}:${field}`,
        label: label || `Board ${sb}: ${field}`,
        value,
        liveValue: g[field],
        run: () => setItem(`${base}.${field}`, value),
    });

    /*
     * A HUD board's feed rewrites its sides every frame, so the swap is owned
     * entirely by the server: /rio/swap flips the orientation flag and re-applies
     * the whole player unit (address-book identity included), or swaps what is
     * already in State when no frame is live. One authoritative broadcast keeps
     * the UI and every overlay in step; a partial client-side swap is what let
     * them diverge.
     */
    const swapSides = () => stageOrRun({
        key: `board:${sb}:swap`,
        label: `Board ${sb}: swap sides`,
        value: true,
        run: async () => {
            if (transport === 'hud') {
                await fetch(`/api/v1/rio/swap?scoreboard_number=${sb}`, { method: 'POST' });
                return;
            }
            const st = useStateStore.getState();
            const b = st?.score?.[sb];
            setItems([
                { key: `${base}.player.1`, value: b?.player?.[2] ?? {} },
                { key: `${base}.player.2`, value: b?.player?.[1] ?? {} },
                { key: `${base}.score_left`, value: b?.score_right ?? 0 },
                { key: `${base}.score_right`, value: b?.score_left ?? 0 },
                { key: `${base}.home_team`, value: num(b?.home_team, 2) === 1 ? 2 : 1 },
                { key: `${base}.teamsSwapped`, value: !(b?.teamsSwapped ?? false) },
            ]);
        },
    });

    /*
     * Blank the board back to a resting game. The key list here is the contract
     * `tests/unit/rio/test_state_completeness.py` pins: every key a live game
     * writes has to appear, or a reset leaves stale data on air.
     */
    const resetGame = () => stageOrRun({
        key: `board:${sb}:reset`,
        label: `Board ${sb}: reset game state`,
        value: true,
        run: () => {
            const entries = [
                ['score_left', 0], ['score_right', 0], ['inning', 1], ['half_inning', 'Top'],
                ['outs', 0], ['strikes', 0], ['balls', 0],
                ['cbRioRunnerOn1', false], ['cbRioRunnerOn2', false], ['cbRioRunnerOn3', false],
                ['runner1Name', ''], ['runner2Name', ''], ['runner3Name', ''],
                ['batter', ''], ['pitcher', ''], ['batter_hand', 0], ['pitcher_hand', 0],
                ['batterSide', 'right'], ['batter_roster_index', -1], ['pitcher_roster_index', -1],
                ['star_chance', false], ['game_completed', false], ['game_id', null],
                ['home_team', 2], ['innings_selected', null], ['stadium', ''],
                ['tag_set', null],
                // The resolved name beside tag_set's raw id; both feeds write it,
                // so both have to be cleared or an overlay keeps naming the old mode.
                ['game_mode', ''],
                ['side_reason', ''], ['away_linescore', []], ['home_linescore', []],
            ];
            for (const pos of ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']) {
                entries.push([`field.${pos}`, '']);
            }
            for (const t of [1, 2]) {
                entries.push(
                    [`player.${t}.rioName`, ''], [`player.${t}.name`, ''],
                    [`player.${t}.msb_team`, ''], [`player.${t}.team`, ''],
                    [`player.${t}.rio_captainIndex`, -1], [`player.${t}.logo`, ''],
                    [`player.${t}.port`, null], [`player.${t}.team_stars`, 0],
                    [`player.${t}.batting_hands`, []], [`player.${t}.fielding_hands`, []],
                );
                for (let i = 0; i < 9; i++) {
                    entries.push(
                        [`player.${t}.character.${i}.name`, ''],
                        [`player.${t}.character.${i}.is_starred`, false],
                        [`player.${t}.character.${i}.position`, ''],
                    );
                }
            }
            setItems(entries.map(([k, v]) => ({ key: `${base}.${k}`, value: v })));
        },
    });

    /*
     * Pin (or, with an empty value, clear) one side's name override. The server
     * makes the override that slot's identity — it drives the overlay name, the
     * resurface, the match gate and a fresh stats fetch — and keeps it stuck
     * against feed updates until the next HUD game.
     */
    const setNameOverride = (team, value) => stageOrRun({
        key: `board:${sb}:override.${team}`,
        label: `Board ${sb}: side ${team} name`,
        value: value ?? '',
        run: () => fetch(
            `/api/v1/scoreboards/${sb}/player/${team}/name-override?name=${encodeURIComponent(value ?? '')}`,
            { method: 'PUT' },
        ),
    });

    // Which mode's stats to fetch is configuration, not content — it selects a
    // data source rather than changing what is on screen, and the fetch it kicks
    // off can't be deferred as a unit. Immediate, like the intro toggle.
    const setStatsTag = (v) => settingsSetItem(`scoreboards.binding.${sb}.stats_tag`, v ?? '');

    return {
        sb, base, transport, statsTag, g, boundMatch,
        val, isStaged, setField, swapSides, resetGame, setNameOverride, setStatsTag,
    };
}

// The count dots. Clicking the last filled dot clears it, so B/S/O never needs
// a separate decrement.
const CountDots = memo(function CountDots({ label, count, max, hex, onChange }) {
    return (
        <div className="flex items-center gap-1">
            <span className="w-3 text-center text-[11px] font-bold leading-none text-muted-foreground">{label}</span>
            {Array.from({ length: max }, (_, i) => {
                const filled = i < count;
                return (
                    <button
                        key={i}
                        type="button"
                        aria-label={`${label} ${i + 1}`}
                        onClick={() => onChange(filled && i === count - 1 ? count - 1 : i + 1)}
                        className="size-3 shrink-0 rounded-full transition-all"
                        style={{
                            backgroundColor: filled ? hex : 'transparent',
                            border: `2px solid ${hex}`,
                            opacity: filled ? 1 : 0.3,
                        }}
                    />
                );
            })}
        </div>
    );
});

// The live stats fetch for this board: pushed by the server on every
// loading→done transition, so there is no polling and no spinner lag.
function useStatsStatus(sb, statsTag) {
    const [diag, setDiag] = useState(null);
    const [busy, setBusy] = useState(false);

    const onStatus = useCallback((payload) => {
        if (payload?.scoreboard !== sb) return;
        setDiag(payload);
        setBusy(payload.status === 'loading');
    }, [sb]);
    useSocketSubscribe('v1.stats.fetch_status', onStatus);

    // One read on mount so a board whose fetch happened before this panel opened
    // still reports, instead of reading as "never fetched".
    useEffect(() => {
        let live = true;
        fetch(`/api/v1/rio/stats/diagnostics?scoreboard=${sb}`)
            .then(r => r.json())
            .then(d => { if (live) setDiag(d); })
            .catch(() => {});
        return () => { live = false; };
    }, [sb]);

    const refresh = useCallback(() => {
        setBusy(true);
        fetch(`/api/v1/rio/stats/refresh?scoreboard=${sb}`, { method: 'POST' })
            .catch(() => setBusy(false));
    }, [sb]);

    let line = statsTag ? 'No stats fetched yet.' : 'No game mode — no stats are being fetched.';
    let tone = null;
    if (busy) {
        line = 'Fetching…';
    } else if (diag?.error) {
        line = diag.error;
        tone = 'warn';
    } else if (diag?.fetched_at) {
        const players = Object.entries(diag.players ?? {});
        const counts = players.map(([n, i]) => `${n} ${i?.char_count ?? 0}`).join(' · ');
        const at = new Date(diag.fetched_at).toLocaleTimeString();
        line = counts ? `${counts} — ${at}` : `Fetched ${at}`;
        // A fetch that came back with nothing for anyone is the failure mode
        // worth interrupting for: the overlays will render blank stat lines.
        if (players.length && players.every(([, i]) => !i?.char_count)) tone = 'warn';
    }
    return { line, tone, busy, refresh };
}

export default function BoardDesk({ board }) {
    const sb = Number(board);
    const d = useBoardDesk(sb);
    const { g } = d;
    const active = useActiveBoards();
    const boardLabel = useBoardLabel();
    const stats = useStatsStatus(sb, d.statsTag);
    const [gameModes, setGameModes] = useState([]);
    const [refreshingHud, setRefreshingHud] = useState(false);
    const [confirmDel, setConfirmDel] = useState(false);
    const aliases = useSettingsStore(s => s?.scoreboards?.aliases);
    const storedAlias = aliases?.[sb] ?? aliases?.[String(sb)] ?? '';

    useEffect(() => {
        fetch('/api/v1/rio/game-modes')
            .then(r => r.json())
            .then(data => setGameModes(Object.keys(data).map(n => ({ value: n, label: n }))))
            .catch(() => {});
    }, []);

    // Force a re-read of the HUD file — the recovery path after a board has been
    // cleared or hand-edited, so it matches what Project Rio is showing again.
    const refreshHud = useCallback(() => {
        setRefreshingHud(true);
        fetch('/api/v1/rio/refresh', { method: 'POST' })
            .finally(() => setRefreshingHud(false));
    }, []);

    const commitAlias = useCallback((next) => {
        const v = (next ?? '').trim();
        if (v === storedAlias) return;
        fetch(`/api/v1/scoreboards/${sb}/alias?alias=${encodeURIComponent(v)}`, { method: 'PUT' })
            .catch(e => notifications.show({ message: `Rename: ${e?.message || e}`, color: 'red' }));
    }, [sb, storedAlias]);

    const removeBoard = useCallback(() => {
        setConfirmDel(false);
        fetch(`/api/v1/scoreboards/${sb}`, { method: 'DELETE' })
            .catch(e => notifications.show({ message: `Remove board: ${e?.message || e}`, color: 'red' }));
    }, [sb]);

    const bindLine = matchBindLine(g.match, d.boundMatch);
    const reasonLine = sideReasonLine(g.sideReason, g.name1);

    return (
        <>
            {/* WHAT this board is carrying, before what you can do to it. The
                live game is the subject; the bind and the side ordering are
                qualifiers on it, so they read a tier down rather than as three
                competing subjects. */}
            <BoardGameSubject board={sb} />
            {bindLine && (
                <Text size="xs" truncate className="text-muted-foreground">{bindLine}</Text>
            )}
            {g.conflict && (
                <Text size="xs" className="text-amber-500/90">
                    The live players don’t match the bound fixture — resolve it on the Match desk.
                </Text>
            )}
            {reasonLine && (
                <Text size="xs" truncate className="text-muted-foreground">{reasonLine}</Text>
            )}

            <KitColumns>
                <KitColumn label="Feed">
                    {/* Transport is DERIVED and there is deliberately no picker:
                        board 1 carries the local HUD iff the global toggle is on,
                        every other board is API. See server/bindings.py. */}
                    <FieldRow label="Transport">
                        <Badge className={cn(
                            'text-[10px] font-semibold uppercase tracking-wider',
                            d.transport === 'hud'
                                ? 'bg-[#22c55e]/15 text-[#4ade80]'
                                : 'bg-[#3b82f6]/15 text-[#60a5fa]',
                        )}>
                            {d.transport === 'hud' ? 'HUD' : 'API'}
                        </Badge>
                        <Text size="xs" truncate dimmed>
                            {d.transport === 'hud'
                                ? 'Local game — turn the HUD off in Settings to rebind.'
                                : 'Project Rio API.'}
                        </Text>
                    </FieldRow>
                    {d.transport === 'hud' ? (
                        <ActionRow actions={[{
                            label: refreshingHud ? 'Re-reading…' : 'Re-read HUD file',
                            icon: RotateCw, onClick: refreshHud, disabled: refreshingHud,
                            title: 'Re-read the HUD file and restore this board to match it',
                        }]} />
                    ) : (
                        <Text size="xs" className="text-muted-foreground">
                            Which games this board follows is set on the Match tab.
                        </Text>
                    )}
                    <SelectRow
                        label="Game mode" value={d.statsTag} onChange={d.setStatsTag}
                        options={gameModes} placeholder="No stats"
                    />
                    <Group gap="xs" className="min-w-0 flex-nowrap items-center">
                        <Text
                            size="xs" truncate
                            className={cn('min-w-0', stats.tone === 'warn' ? 'text-amber-500/90' : 'text-muted-foreground')}
                        >
                            {stats.line}
                        </Text>
                        <Button
                            size="xs" variant="ghost" className="h-6 shrink-0"
                            onClick={stats.refresh} disabled={stats.busy || !d.statsTag}
                        >
                            Refresh
                        </Button>
                    </Group>
                </KitColumn>

                <KitColumn label="Corrections">
                    <FieldRow label="Score" staged={d.isStaged('score_left') || d.isStaged('score_right')}>
                        <input
                            type="number" min={0} aria-label="Score, left side"
                            className={cn(KIT_INPUT, 'w-16 text-center tabular-nums')}
                            value={d.val('score_left', g.scoreLeft)}
                            onChange={e => d.setField('score_left', num(e.target.value))}
                        />
                        <Text size="xs" span dimmed>–</Text>
                        <input
                            type="number" min={0} aria-label="Score, right side"
                            className={cn(KIT_INPUT, 'w-16 text-center tabular-nums')}
                            value={d.val('score_right', g.scoreRight)}
                            onChange={e => d.setField('score_right', num(e.target.value))}
                        />
                        <StagedDot show={d.isStaged('score_left') || d.isStaged('score_right')} />
                    </FieldRow>
                    <FieldRow label="Inning" staged={d.isStaged('inning') || d.isStaged('half_inning')}>
                        <select
                            aria-label="Half inning"
                            className={cn(KIT_INPUT, 'min-w-0 flex-1')}
                            value={d.val('half_inning', g.halfInning)}
                            onChange={e => d.setField('half_inning', e.target.value)}
                        >
                            {halfInningOptions.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                        <input
                            type="number" min={1} max={99} aria-label="Inning"
                            className={cn(KIT_INPUT, 'w-16 text-center tabular-nums')}
                            value={d.val('inning', g.inning)}
                            onChange={e => d.setField('inning', num(e.target.value, 1))}
                        />
                    </FieldRow>
                    <FieldRow label="Count" staged={d.isStaged('balls') || d.isStaged('strikes') || d.isStaged('outs')}>
                        <CountDots
                            label="B" max={4} hex="#22c55e"
                            count={d.val('balls', g.balls)}
                            onChange={v => d.setField('balls', v)}
                        />
                        <CountDots
                            label="S" max={3} hex="#f5bb00"
                            count={d.val('strikes', g.strikes)}
                            onChange={v => d.setField('strikes', v)}
                        />
                        <CountDots
                            label="O" max={3} hex="#e60012"
                            count={d.val('outs', g.outs)}
                            onChange={v => d.setField('outs', v)}
                        />
                    </FieldRow>
                    <SelectRow
                        label="Stadium" placeholder="None"
                        staged={d.isStaged('stadium')}
                        value={d.val('stadium', g.stadium)}
                        onChange={v => d.setField('stadium', v)}
                        options={STADIUM_OPTIONS}
                    />
                    {/* Which side bats last. The HUD writes it every frame on a
                        HUD board; on a hand-driven one it decides which half of
                        the inning belongs to whom. */}
                    <SegmentedRow
                        label="Home" value={String(d.val('home_team', g.homeTeam))}
                        onChange={v => d.setField('home_team', Number(v))}
                        data={[{ label: 'Left', value: '1' }, { label: 'Right', value: '2' }]}
                    />
                    <ActionRow actions={[
                        { label: 'Swap sides', icon: ArrowLeftRight, onClick: d.swapSides },
                        { label: 'Reset game', onClick: d.resetGame, variant: 'ghost' },
                    ]} />
                </KitColumn>
            </KitColumns>

            <KitColumns>
                {/* An override is the only identity edit that survives a feed:
                    the raw name comes from Project Rio, and pinning one here is
                    how a producer corrects a mis-typed or alt online ID without
                    the next frame undoing it. */}
                <KitColumn label="Who's on each side">
                    <FieldRow label="Left" staged={d.isStaged('override.1')}>
                        <ParticipantPicker
                            value={d.val('override.1', g.override1) || g.name1}
                            placeholder="Online ID"
                            onResolve={row => d.setNameOverride(1, row?.identities?.rioName || row?.display?.tag || '')}
                            onRawValue={v => d.setNameOverride(1, v)}
                            className={g.override1 ? 'border-amber-400 ring-1 ring-amber-400/40' : undefined}
                        />
                    </FieldRow>
                    <FieldRow label="Right" staged={d.isStaged('override.2')}>
                        <ParticipantPicker
                            value={d.val('override.2', g.override2) || g.name2}
                            placeholder="Online ID"
                            onResolve={row => d.setNameOverride(2, row?.identities?.rioName || row?.display?.tag || '')}
                            onRawValue={v => d.setNameOverride(2, v)}
                            className={g.override2 ? 'border-amber-400 ring-1 ring-amber-400/40' : undefined}
                        />
                    </FieldRow>
                    {(g.override1 || g.override2) && (
                        <Text size="xs" className="text-amber-500/90">
                            Pinned over the feed until the next game. Clear the field to hand it back.
                        </Text>
                    )}
                </KitColumn>

                <KitColumn label="This board">
                    {/* TextRow echoes keystrokes locally and writes once you stop
                        or blur — a rename is a settings round-trip and every
                        overlay reading the alias would otherwise redraw per
                        letter. */}
                    <TextRow
                        label="Name" value={storedAlias} placeholder={`Scoreboard ${sb}`}
                        onChange={commitAlias}
                    />
                    <Popover open={confirmDel} onOpenChange={setConfirmDel}>
                        <PopoverTrigger asChild>
                            <Button
                                size="xs" variant="ghost" disabled={active.length < 2}
                                className="h-7 w-fit text-muted-foreground hover:text-destructive"
                                title={active.length < 2
                                    ? 'The rig always keeps one board'
                                    : `Remove ${boardLabel(sb)}`}
                            >
                                <Trash2 size={13} className="mr-1" /> Remove board
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-60">
                            <div className="flex flex-col gap-1.5">
                                <Text size="sm" className="text-foreground">Remove {boardLabel(sb)}?</Text>
                                <Text size="xs" className="text-muted-foreground">
                                    Its binding and pool go with it. Overlays pointed at
                                    ?scoreboard={sb} will have nothing to draw.
                                </Text>
                                <Group gap="xs" className="justify-end">
                                    <Button size="xs" variant="ghost" onClick={() => setConfirmDel(false)}>Cancel</Button>
                                    <Button size="xs" variant="destructive" onClick={removeBoard}>Remove</Button>
                                </Group>
                            </div>
                        </PopoverContent>
                    </Popover>
                </KitColumn>
            </KitColumns>
        </>
    );
}
