import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Info, RotateCw, SkipForward } from 'lucide-react';
import { useStateStore, useSettingsStore } from '../../../context/store';
import { useSocketSubscribe } from '../../../context/socket';
import { useStagingStore, stageOrRun } from '../../../context/staging';
import ParticipantPicker from '../../../components/ParticipantPicker';
import { Stack, Text, Divider, Loader } from '../../../components/ui/primitives';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Combobox } from '../../../components/ui/combobox';
import { NumberInput } from '../../../components/ui/number-input';
import { SimpleSelect } from '../../../components/ui/simple-select';
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover';
import { notifications } from '../../../lib/notify';
import { cn } from '../../../lib/utils';
import { useAssetUrls } from '../../../lib/assets';
import { HALF_INNINGS, ROSTER_SIZE } from '../../../data/msb';
import { STADIUM_OPTIONS } from '../../../data/stadiums';
import { ActionRow, FieldRow, KitColumn, KitColumns, TextRow, ToggleChip } from '../kit';
import { BoardGameSubject } from '../subject';
import { GamesSection } from '../games';
import { useNextUp } from '../queue';
import { takeNextMatch } from '../../../context/match';

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
 * THE LAYOUT IS A SCOREBOARD, not a form. One line per side — the name, whether
 * that side is home, and the runs it has scored — because every one of those is a
 * fact about a person and the panel should say whose. Two earlier attempts got
 * this wrong in opposite directions: label-gutter kit rows made a familiar
 * instrument read as a settings list, and the Match tab's own panel, ported
 * verbatim, put two big boxes labelled P1 and P2 in a 420px column with the
 * names in a separate group below and 700px of dead stage beside it. The side
 * grid is a sanctioned Custom block under the console contract — the same
 * allowance the Match desk's captain grid takes, for the same reason: the kit
 * does not try to express a scoreboard. It sits in the kit's own KitColumns
 * grouping, and everything around it is kit rows.
 *
 * The two tiers are the app's real seam. Above the divider is `score.{N}.*` —
 * what is on air this game, all of it correctable. Below it is how the board is
 * WIRED — settings, which outlive the game: its **Games** (../games, the mode
 * and the mode's own surface, which is what let the Match tab go) beside the two
 * properties that are genuinely one-liners, its stats tag and its name.
 *
 * Every broadcast-visible write routes through the staging gateway under
 * `board:{sb}:{field}`. The momentary ones (re-read the HUD file, refresh stats)
 * fire immediately, same rule as Take and capture. The alias is config rather
 * than content, so it is immediate too.
 *
 * WHETHER THIS BOARD EXISTS is not on this panel. Adding and removing a board are
 * rig membership, and they live together in the rack's BOARDS section — the +
 * that creates a row and the trash that ends it, side by side. Remove used to be
 * here, at the bottom of the right-hand column, and could not be found.
 */

const halfInningOptions = HALF_INNINGS.map(h => ({ value: h, label: h }));

/*
 * THE BOARD IS MIRRORED, because the thing it controls is: side 1 down the left,
 * the shared frame (runs, count, inning) in the middle, side 2 down the right,
 * with the right side's contents reversed and right-aligned so each column runs
 * outward from the score the way a scoreboard does. A producer checking a wrong
 * board is comparing the panel against a screen — if left isn't on the left, the
 * check is a translation step, which is exactly the bug they're hunting.
 */
const BOARD_GRID = 'grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-x-3';
const EYEBROW = 'label-display text-[10px] text-muted-foreground';

// Coerce state (which round-trips through the socket as strings sometimes).
const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

/*
 * How many games are in a board's pool. `Array.isArray` rather than `?? []`
 * because `.length` answers for a STRING too — a game_ids that arrived as
 * "[11,12,13]" reads as a 10-game pool, which is a wrong number stated with
 * confidence. The server writes a list; this is about what the readout does when
 * something upstream doesn't.
 */
const poolSize = (ids) => (Array.isArray(ids) ? ids.length : 0);

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
 * HOW this board presents its games — the second axis, and the one the desk was
 * silent about.
 *
 * Transport (HUD vs API) and playback (single vs rotate) are independent:
 * transport is where games come from and is DERIVED, playback is how the board
 * shows them and is CHOSEN. Flattening them into one "HUD / single / rotator"
 * list is what the Match tab did, and it makes "HUD + rotate" expressible when
 * it is not a real state — board 1 under the HUD toggle is single by
 * construction whatever its stored mode says (see ../boards
 * useMatchBindableBoards, and bind_scoreboard on the server, which encode the
 * same rule). So they are stated as two things, never picked as one.
 *
 * This is the sentence; ../games holds the controls that set it.
 */
export function playbackLine({ transport, mode, running, poolCount, gameId }) {
    if (transport === 'hud') return 'One game — the local HUD feed.';
    if (mode === 'rotate') {
        // Rotation on with an empty pool is a real state (nothing matched the
        // filters yet), and "0 in pool" reads like a count that failed.
        if (!poolCount) return 'Rotating — nothing in its pool yet.';
        return running
            ? `Rotating — ${poolCount} in pool.`
            : `Rotating (paused) — ${poolCount} in pool.`;
    }
    if (gameId) return 'One game, pinned.';
    return poolCount
        ? `One game — following the newest of ${poolCount} in pool.`
        : 'One game — nothing in its pool yet.';
}

/*
 * UP NEXT — the board takes the next queued fixture.
 *
 * The verb lives on the BOARD, beside the line that says which match it is
 * carrying, because that line is what it changes. Assignment from the match's
 * side (the Match desk's bind chips) is right for drafting the night's fixtures;
 * this is the live direction — "board 2 just finished, put the next one up" — and
 * it is one press rather than finding the right match in a stack.
 *
 * It names the fixture it will put up. A bare "Next" would be the one control on
 * the panel that changes what is on air without saying what to.
 *
 * The take is momentary, like the rotation transport and Take: a producer pressing
 * this at the end of a game means now. The label previews the client's read of the
 * queue (../queue), but the SERVER re-resolves and binds under a lock — the button
 * never sends an id, so two boards pressed together can't land on one fixture.
 */
const UpNextButton = memo(function UpNextButton({ sb }) {
    const next = useNextUp();
    const [taking, setTaking] = useState(false);
    if (!next) return null;
    const take = () => {
        setTaking(true);
        takeNextMatch(sb)
            .catch(e => notifications.show({ message: `Up next: ${e?.message || e}`, color: 'red' }))
            .finally(() => setTaking(false));
    };
    return (
        <Button
            size="xs" variant="secondary" className="h-7 shrink-0 max-w-[60%]"
            onClick={take} disabled={taking}
            title={`Put ${next.label} on this board — the next fixture in the queue`}
        >
            <SkipForward size={12} className="mr-1 shrink-0" />
            <span className="truncate">Up next · {next.label}</span>
        </Button>
    );
});

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
 *
 * ONE FACT PER ROW, at the rack's house length. A rack row is ~278px and already
 * spends it on a chip, the board's name and a pin, so `HUD · Alice 3–2 Bob · Bot
 * 5` truncated mid-sentence — four facts where the other desks say `no match`,
 * `captured`, `M1 · 0–0`. The transport and the inning both live on the panel
 * (the badge, and BoardGameSubject), so the row keeps only the thing that is not
 * anywhere else at a glance: WHICH game is on this board. When there is no game
 * there is no matchup to name, and the transport becomes the informative thing.
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
        const n1 = b?.player?.[1]?.rioName || '';
        const n2 = b?.player?.[2]?.rioName || '';
        if (n1 || n2) {
            return {
                meta: `${n1 || 'Side 1'} ${b?.score_left ?? 0}–${b?.score_right ?? 0} ${n2 || 'Side 2'}`,
                idle: false,
            };
        }
        // Nothing on the board: say what it is waiting for rather than "empty".
        if (!hud && mode === 'rotate') {
            // Same rule as playbackLine: an empty pool prints no count, because
            // "0" reads as a count that failed rather than as nothing yet.
            const n = poolSize(s?.scoreboards?.rotation?.[sb]?.game_ids);
            return { meta: n ? `rotating · ${n}` : 'rotating', idle: true };
        }
        return { meta: hud ? 'HUD · no game' : 'no game', idle: true };
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

    // The playback axis, for the readout only — this desk does not author it yet.
    const playback = useSettingsStore(useShallow(s => {
        const p = s?.scoreboards?.binding?.[sb]?.playback
            ?? s?.scoreboards?.binding?.[String(sb)]?.playback ?? {};
        return {
            mode: p.mode || 'single',
            running: !!p.running,
            gameId: p.gameId ?? null,
        };
    }));
    // Mirrored into State by the server, so a rotating board's pool size is a
    // read rather than a fetch (the rack draws this on every frame too).
    const poolCount = useStateStore(
        s => poolSize(s?.scoreboards?.rotation?.[sb]?.game_ids),
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
     * Runners, batter, pitcher and the fielders belong to the half-inning that
     * just ended, so moving the inning by hand clears them rather than leaving
     * the last at-bat on screen under a new frame. Carried over from the Match
     * tab, where the same two controls (half-inning, swap) did this.
     */
    const clearAtBatState = () => {
        const entries = [
            ['cbRioRunnerOn1', false], ['cbRioRunnerOn2', false], ['cbRioRunnerOn3', false],
            ['runner1Name', ''], ['runner2Name', ''], ['runner3Name', ''],
            ['batter', ''], ['pitcher', ''],
        ];
        for (const pos of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']) {
            entries.push([`field.${pos}`, '']);
        }
        setItems(entries.map(([k, v]) => ({ key: `${base}.${k}`, value: v })));
    };

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
        label: `Board ${sb}: swap teams`,
        value: true,
        run: async () => {
            clearAtBatState();
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
     *
     * On a HUD board it also RELEASES the feed. The server keeps the last frame
     * Project Rio wrote (the re-read needs it), but a manual swap re-orients that
     * frame and re-applies it — so resetting and then swapping brought the whole
     * game back. Reset clears, Re-read HUD restores; nothing in between puts the
     * feed back on the board on its own.
     */
    const resetGame = () => stageOrRun({
        key: `board:${sb}:reset`,
        label: `Board ${sb}: reset game state`,
        value: true,
        run: () => {
            if (transport === 'hud') {
                fetch('/api/v1/rio/release', { method: 'POST' }).catch(() => {});
            }
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
        sb, base, transport, statsTag, playback, poolCount, g, boundMatch, clearAtBatState,
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
function useStatsDiagnostics(sb) {
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

/*
 * ONE SIDE'S TEAM — its MSB team and its nine characters.
 *
 * Returned FLAT, all primitives, on purpose. `useShallow` compares element by
 * element, so an object (or an array of objects) would be a fresh identity on
 * every read and this panel would re-render on every unrelated state write. A
 * live HUD board writes 30–100 keys a frame and this desk is open while it does,
 * so a nested shape here is a per-frame cost, not a style question.
 */
export function useSideTeam(sb, team) {
    const flat = useStateStore(useShallow(s => {
        const p = s?.score?.[sb]?.player?.[team];
        const chars = p?.character;
        const out = [p?.msb_team || '', String(num(p?.rio_captainIndex, -1))];
        for (let i = 0; i < ROSTER_SIZE; i++) {
            out.push(chars?.[i]?.name || '', chars?.[i]?.is_starred ? '1' : '');
        }
        return out;
    }));
    return useMemo(() => ({
        msbTeam: flat[0],
        captain: Number(flat[1]),
        roster: Array.from({ length: ROSTER_SIZE }, (_, i) => ({
            name: flat[2 + i * 2],
            starred: flat[3 + i * 2] === '1',
        })),
    }), [flat]);
}

/*
 * The per-character superstar mark. ALWAYS DRAWN on a filled slot, hollow when
 * off — which is the whole point of it: nine hollow stars say "star skills are on
 * and nobody is starred yet", where a cell with no mark at all says nothing. The
 * on state is the game's own superstar art with the amber glow it has always had
 * (`superstar.png` is a required file in the MSB asset pack, so a pack missing it
 * is already reported in Settings rather than silently blank here).
 */
const STAR_POINTS = '10,1 12.9,7 19.5,7.6 14.5,12 16.2,18.5 10,15 3.8,18.5 5.5,12 0.5,7.6 7.1,7';

const StarMark = memo(function StarMark({ on, url }) {
    /*
     * PRSH ships no MSB images (Nintendo IP), so every icon here is a file the
     * user supplied and any of them can be absent. An image tag pointed at a
     * file that isn't there is a torn-page box at whatever size the browser
     * picks — it breaks the grid's rhythm AND reads as a bug rather than as a
     * missing asset. So the art is an enhancement over a vector that already
     * says the same thing: amber and filled for on, hairline for off.
     */
    const [artMissing, setArtMissing] = useState(false);
    if (on && url && !artMissing) {
        return (
            <img
                src={url} alt="Superstar" width={12} height={12} data-star="on"
                onError={() => setArtMissing(true)}
                className="shrink-0 object-contain"
                style={{ filter: 'drop-shadow(0 0 3px rgba(245,159,0,0.8))' }}
            />
        );
    }
    return (
        <svg
            viewBox="0 0 20 20" width={11} height={11} data-star={on ? 'on' : 'off'}
            role={on ? 'img' : undefined} aria-label={on ? 'Superstar' : undefined}
            aria-hidden={on ? undefined : 'true'}
            className={cn('shrink-0', on ? 'text-[#f59f00]' : 'text-muted-foreground/50')}
            style={on ? { filter: 'drop-shadow(0 0 3px rgba(245,159,0,0.6))' } : undefined}
        >
            <polygon
                points={STAR_POINTS}
                fill={on ? 'currentColor' : 'none'}
                stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round"
            />
        </svg>
    );
});

/*
 * The nine characters, as a READOUT.
 *
 * The roster grid that used to live on the Match tab was an editor — a character
 * combobox, a superstar toggle and a captain button per slot — and under every
 * real feed it was read-only anyway, so it was deleted with the rest of the
 * hand-driving controls. What was lost with it is the thing a producer actually
 * used it for: SEEING the lineup, to check the board against the game. That is a
 * subject, not a control, so it comes back as one — captain ringed, superstars
 * starred, nothing clickable.
 *
 * It renders only when the feed has given the side characters. Nine "Slot n"
 * placeholders on an idle board is nine rows of nothing.
 */
const RosterGrid = memo(function RosterGrid({ roster, captain, mirror }) {
    const urls = useAssetUrls();
    const superstar = urls.gameIcon('superstar.png');
    if (!roster.some(r => r.name)) return null;
    return (
        <div className="grid w-full grid-cols-3 gap-1">
            {roster.map((r, i) => {
                const isCaptain = captain === i;
                const icon = r.name ? urls.charIcon(r.name) : undefined;
                return (
                    <div
                        key={i}
                        title={[r.name || `Slot ${i + 1}`, isCaptain && 'captain', r.starred && 'superstar']
                            .filter(Boolean).join(' · ')}
                        className={cn(
                            'flex min-w-0 items-center gap-1 rounded border px-1 py-0.5',
                            mirror && 'flex-row-reverse',
                            isCaptain ? 'border-[#f5bb00]/70' : 'border-border/60',
                        )}
                    >
                        {icon && (
                            <img src={icon} alt="" width={14} height={14} className="shrink-0 object-contain pixelated" />
                        )}
                        <Text
                            size="xs" span truncate
                            className={cn('min-w-0 text-[11px]', isCaptain ? 'text-[#f5bb00]' : 'text-muted-foreground')}
                        >
                            {r.name || '—'}
                        </Text>
                        {/* An empty slot gets no mark — a star on nothing is
                            noise, where a star on a character is a fact. */}
                        {r.name && <StarMark on={r.starred} url={superstar} />}
                    </div>
                );
            })}
        </div>
    );
});

/*
 * ONE SIDE, as a column: who is there · do they bat last · what they're playing
 * as · who's in the lineup. Side 2's column is reversed and right-aligned, so
 * the two read outward from the score between them.
 *
 * The name field IS the identity override — the only identity edit that survives
 * a feed. The raw name comes from Project Rio; the picker shows it, and pinning
 * one here is how a producer corrects a mis-typed or alt online ID without the
 * next frame undoing it. It used to be a separate "Who's on each side" group
 * below the scores, which asked the producer to hold "P1 = the left name" in
 * their head while a mislabelled game was on air.
 *
 * Home is a chip on the side that HAS it, not a Left/Right picker: which side
 * bats last is a fact about a player, and "MattGree bats last" is the sentence a
 * producer is checking against the game. Clicking the other side moves it;
 * clicking the side that already has it does nothing, because this is a choice
 * between two sides and not a toggle that can be off.
 */
const SidePanel = memo(function SidePanel({ side, label, d }) {
    const { g } = d;
    const team = useSideTeam(d.sb, side);
    const urls = useAssetUrls();
    const mirror = side === 2;
    const feedName = side === 1 ? g.name1 : g.name2;
    const override = side === 1 ? g.override1 : g.override2;
    const isHome = num(d.val('home_team', g.homeTeam), 2) === side;
    const shown = d.val(`override.${side}`, override) || feedName;
    const logo = team.msbTeam ? urls.teamIcon(team.msbTeam) : null;
    return (
        <div className={cn('flex min-w-0 flex-col gap-1.5', mirror && 'items-end')}>
            <span className={cn(EYEBROW, d.isStaged(`override.${side}`) && 'text-amber-400')}>
                {label}
            </span>
            <div className={cn('flex w-full min-w-0 items-center gap-1.5', mirror && 'flex-row-reverse')}>
                <div className="min-w-0 flex-1">
                    <ParticipantPicker
                        value={shown}
                        placeholder="Online ID"
                        onResolve={row => d.setNameOverride(side, row?.identities?.rioName || row?.display?.tag || '')}
                        onRawValue={v => d.setNameOverride(side, v)}
                        className={cn('h-7 text-xs', override && 'border-amber-400 ring-1 ring-amber-400/40')}
                    />
                </div>
                <ToggleChip
                    label="Home"
                    ariaLabel={`${label} side bats last`}
                    title={isHome
                        ? `${shown || label} bats last`
                        : `Make the ${label.toLowerCase()} side home`}
                    checked={isHome}
                    staged={d.isStaged('home_team')}
                    onChange={() => { if (!isHome) d.setField('home_team', side); }}
                />
            </div>
            {team.msbTeam && (
                <div className={cn('flex min-w-0 items-center gap-1.5', mirror && 'flex-row-reverse')}>
                    {logo && (
                        <img src={logo} alt="" width={16} height={16} className="shrink-0 object-contain pixelated" />
                    )}
                    <Text size="xs" span truncate dimmed className="min-w-0">{team.msbTeam}</Text>
                </div>
            )}
            <RosterGrid roster={team.roster} captain={team.captain} mirror={mirror} />
        </div>
    );
});

// One side's runs, in the centre block beside the other side's — the pair is how
// a score is read, so they sit together rather than one per side column.
const ScoreBox = memo(function ScoreBox({ side, label, d }) {
    const field = side === 1 ? 'score_left' : 'score_right';
    const live = side === 1 ? d.g.scoreLeft : d.g.scoreRight;
    return (
        <NumberInput
            aria-label={`Score, ${label.toLowerCase()} side`}
            value={d.val(field, live)}
            onChange={v => d.setField(field, v === '' ? 0 : Number(v))}
            min={0}
            className={cn(
                'h-9 w-14 px-1 text-center text-xl font-bold tabular-nums',
                d.isStaged(field) && 'border-amber-400/60 text-amber-400',
            )}
        />
    );
});

export default function BoardDesk({ board }) {
    const sb = Number(board);
    const d = useBoardDesk(sb);
    const { g } = d;
    const stats = useStatsDiagnostics(sb);
    const [gameModes, setGameModes] = useState([]);
    const [refreshingHud, setRefreshingHud] = useState(false);
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

    const bindLine = matchBindLine(g.match, d.boundMatch);
    const reasonLine = sideReasonLine(g.sideReason, g.name1);

    return (
        <>
            {/* WHAT this board is carrying, before what you can do to it. The
                live game is the subject; the bind and the side ordering are
                qualifiers on it, so they read a tier down rather than as three
                competing subjects. */}
            <BoardGameSubject board={sb} />
            <div className="flex min-w-0 items-center gap-2">
                <Text size="xs" truncate className="min-w-0 flex-1 text-muted-foreground">
                    {bindLine || 'No match on this board'}
                </Text>
                <UpNextButton sb={sb} />
            </div>
            {g.conflict && (
                <Text size="xs" className="text-amber-500/90">
                    The live players don’t match the bound fixture — resolve it on the Match desk.
                </Text>
            )}
            {reasonLine && (
                <Text size="xs" truncate className="text-muted-foreground">{reasonLine}</Text>
            )}

            {/* THE MIRROR TAKES THE WHOLE PANEL. Beside a wiring column it was
                two thirds of the width, and a lineup does not compress: nine
                character names in a third of a stage truncate to "Dry Bon…",
                which is the one thing a roster readout exists to avoid. The
                wiring is four one-line settings and reads fine below. */}
            <div className="flex flex-col gap-1.5 pt-1">
                {/* score.{N}.*: what is on air this game. */}
                <KitColumn label="Game state">
                    <div className={BOARD_GRID}>
                        <SidePanel side={1} d={d} label="Left" />

                        {/* The shared frame, between the two sides that share it:
                            the runs as a pair, then the inning, then the count.
                            `pt` clears the sides' eyebrow line so the scores land
                            level with the two name fields. */}
                        <div className="flex shrink-0 flex-col items-center gap-1.5 pt-[1.1rem]">
                            <div className="flex items-center gap-1">
                                <ScoreBox side={1} label="Left" d={d} />
                                <Text size="sm" span dimmed>–</Text>
                                <ScoreBox side={2} label="Right" d={d} />
                            </div>
                            <div className="flex items-center gap-1.5">
                                <SimpleSelect
                                    aria-label="Half inning"
                                    data={halfInningOptions}
                                    value={d.val('half_inning', g.halfInning)}
                                    onChange={v => {
                                        d.setField('half_inning', v ?? 'Top');
                                        d.clearAtBatState();
                                    }}
                                    triggerClassName={cn(
                                        '!h-7 w-[4.75rem] text-xs',
                                        d.isStaged('half_inning') && 'border-amber-400/60 text-amber-400',
                                    )}
                                />
                                <NumberInput
                                    aria-label="Inning"
                                    value={d.val('inning', g.inning)}
                                    onChange={v => d.setField('inning', v === '' ? 1 : Number(v))}
                                    min={1} max={99}
                                    className={cn(
                                        'h-7 w-11 px-1 text-center tabular-nums',
                                        d.isStaged('inning') && 'border-amber-400/60 text-amber-400',
                                    )}
                                />
                            </div>
                            <div className="flex flex-col gap-1 pt-0.5">
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
                            </div>
                        </div>

                        <SidePanel side={2} d={d} label="Right" />
                    </div>

                    {/* Belongs to the game, not to either side, so it sits under
                        the mirror rather than in one of its halves. */}
                    <FieldRow label="Stadium" staged={d.isStaged('stadium')} className="pt-1">
                        <Combobox
                            placeholder="Select stadium"
                            data={STADIUM_OPTIONS}
                            value={d.val('stadium', g.stadium) || null}
                            onChange={v => d.setField('stadium', v ?? '')}
                            clearable
                            className={cn(
                                'h-7 min-w-0 flex-1 text-xs',
                                d.isStaged('stadium') && 'border-amber-400/60 text-amber-400',
                            )}
                        />
                    </FieldRow>

                    {(g.override1 || g.override2) && (
                        <Text size="xs" className="text-amber-500/90">
                            A name is pinned over the feed until the next game. Clear the
                            field to hand it back.
                        </Text>
                    )}

                    {/* The two escape hatches, at the bottom of the thing they
                        escape from. Reset is destructive, so it reads that way. */}
                    <ActionRow
                        className="pt-0.5"
                        actions={[
                            { label: 'Swap sides', onClick: d.swapSides, variant: 'outline' },
                            {
                                label: 'Reset game state', onClick: d.resetGame, variant: 'outline',
                                className: 'border-destructive/40 text-destructive hover:bg-destructive/10',
                            },
                        ]}
                    />
                </KitColumn>

                <Divider className="my-1.5" />

                {/* How the board is WIRED — settings, which outlive this game, so
                    they read below what is on air rather than beside it.
                    PROPERTIES ONLY: whether this board exists at all is rig
                    membership, and that belongs to the rack's BOARDS section
                    beside the + that adds one (see RowRemove in ../rack).

                    GAMES IS ITS OWN REGION, not a field inside "This board".
                    Choosing between one game and a rotating pool is the biggest
                    decision made about an API board, and each half of it brings a
                    real surface — a live game table, or a filter with a running
                    transport. Squeezed into a shared column beside the name it
                    became a label-gutter row, which is how a demoted control gets
                    read as a minor setting. The remaining properties are two
                    one-line fields and read fine beside it. */}
                <KitColumns template="minmax(0,7fr) minmax(0,5fr)">
                  <KitColumn label="Games">
                    {/* Where this board's games come from and how it plays them.
                        Two axes, stated as two things: the badge is the DERIVED
                        transport (board 1 carries the local HUD iff the global
                        toggle is on, every other board is API — no picker, ever),
                        the sentence is the CHOSEN playback. ../games holds the
                        mode surfaces. */}
                    <GamesSection
                        sb={sb}
                        transport={d.transport}
                        gameModes={gameModes}
                        readout={`${playbackLine({
                            transport: d.transport,
                            mode: d.playback.mode,
                            running: d.playback.running,
                            gameId: d.playback.gameId,
                            poolCount: d.poolCount,
                        })}${d.transport === 'hud' ? ' Disable HUD in Settings to rebind.' : ''}`}
                        badge={(
                            <>
                                <Badge className={cn(
                                    'shrink-0 text-[11px] font-semibold uppercase tracking-wider',
                                    d.transport === 'hud'
                                        ? 'bg-[#22c55e]/15 text-[#4ade80]'
                                        : 'bg-[#3b82f6]/15 text-[#60a5fa]',
                                )}>
                                    {d.transport === 'hud' ? 'HUD' : 'API'}
                                </Badge>
                                {d.transport === 'hud' && (
                                    <Button
                                        variant="ghost" size="icon-sm" className="shrink-0"
                                        onClick={refreshHud} disabled={refreshingHud}
                                        aria-label="Re-read HUD file"
                                        title="Re-read HUD file and restore scoreboard to match it"
                                    >
                                        {refreshingHud ? <Loader size={12} /> : <RotateCw size={14} />}
                                    </Button>
                                )}
                            </>
                        )}
                    />
                  </KitColumn>

                  <KitColumn label="This board">
                    {/* Which mode's stats to fetch, with the pipeline's own
                        diagnostics one click away beside it. */}
                    <FieldRow label="Game mode">
                        <Combobox
                            placeholder="Select game mode"
                            data={gameModes}
                            value={d.statsTag || null}
                            onChange={d.setStatsTag}
                            clearable
                            className="h-7 min-w-0 flex-1 text-xs"
                        />
                        <StatsDiagnostics stats={stats} />
                    </FieldRow>

                    {/* TextRow echoes keystrokes locally and writes once you stop
                        or blur — a rename is a settings round-trip and every
                        overlay reading the alias would otherwise redraw per
                        letter. */}
                    <TextRow
                        label="Name" value={storedAlias} placeholder={`Scoreboard ${sb}`}
                        onChange={commitAlias}
                    />
                  </KitColumn>
                </KitColumns>
            </div>
        </>
    );
}
