import { useShallow } from 'zustand/react/shallow';
import { useStateStore, useSettingsStore } from '../../../context/store';
import { useStagingStore, stageOrRun } from '../../../context/staging';
import { useBoardLifecycle } from './boards';
import { num } from './shared';

// The board desk's data: the hook every region reads (`useBoardDesk`), and the
// compact row facts the rack and rail draw from it.

/*
 * The board's TYPE in one word — the two axes above compressed to what fits a
 * rack row, and what is left of the sentence they used to be written out as. The two axes produce exactly three states, because HUD + rotate is not a
 * real one: board 1 under the HUD toggle is single by construction whatever its
 * stored mode says (./boards `useMatchBindableBoards` and `bind_scoreboard`
 * encode the same rule). So the pair collapses to three words with nothing lost.
 *
 * ROTATING, never "rotator". A **Rotator** is the standalone layout group
 * (`public/layout/rotator/*.html` — the results ticker); a board cycling its pool
 * is **rotating**. They are different things and the glossary keeps them apart,
 * which one shared word on the most-read surface in the app would undo.
 */
export function boardTypeTag({ transport, mode }) {
    if (transport === 'hud') return 'HUD';
    return mode === 'rotate' ? 'ROTATING' : 'API';
}

export const BOARD_TAG_TITLE = {
    HUD: 'Games come from the local Project Rio HUD file',
    API: 'Games come from the Project Rio API — one at a time',
    ROTATING: 'Games come from the Project Rio API — cycling this board’s pool',
};

/*
 * What a rack row draws for a board: its type, and whether it is sitting idle.
 * STATE ONLY for the live half — the rack redraws on every HUD frame and must
 * never fire a desk's own requests just to paint a row. The type is two settings
 * reads, which change when a producer changes them, not per frame.
 *
 * A BOARD ROW IS ITS NAME AND ITS TYPE. The row used to carry a one-line game
 * summary instead (`Alice 3–2 Bob`, `HUD · no game`, `rotating · 3`), and it did
 * not fit: name plus summary measured 218px against the 176px a 278px rack row
 * leaves once the chip, the pin and the trash are paid for, so the widest thing on
 * the rig — a live game between two real usernames — was the one that overran.
 * A type tag is the opposite shape: three fixed words, the widest ~50px, and it
 * says the thing that is TRUE OF THE BOARD rather than of the game passing
 * through it. The game is on the board's panel, at full length, one click away.
 *
 * The DIM is the other half, and costs no width: a board with players on it reads
 * at full strength, an empty one recedes.
 */
export function useBoardDeskRow(sb) {
    const hudEnabled = useSettingsStore(s => s?.project_rio?.hud_enabled);
    const mode = useSettingsStore(
        s => s?.scoreboards?.binding?.[sb]?.playback?.mode
            ?? s?.scoreboards?.binding?.[String(sb)]?.playback?.mode,
    );
    // A primitive, so no useShallow: the selector returns a boolean and zustand's
    // Object.is comparison is exactly right for it.
    const idle = useStateStore((s) => {
        const p = s?.score?.[sb]?.player;
        return !(p?.[1]?.rioName || p?.[2]?.rioName);
    });
    // Board 1 carries the local HUD iff the global toggle is on; the server
    // default for that toggle is on, so only an explicit false is off.
    const transport = (Number(sb) === 1 && hudEnabled !== false) ? 'hud' : 'api';
    return { tag: boardTypeTag({ transport, mode }), idle };
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
    /*
     * IS A FEED WRITING THIS BOARD RIGHT NOW.
     *
     * Every cell of the mirror below — the runs, the inning, the count, the
     * stadium — is in the per-frame `SetBatch` (`apply_parsed_game_to_state`), so
     * over a live game a typed correction survives until the next frame and no
     * longer. The panel offered eight editable numbers that could not be edited,
     * and a producer found out by watching one snap back.
     *
     * INERT, NOT GREYED (`FEED_OWNED`). The first cut let the disabled styling
     * through and it dulled the count dots, which are the one part of this panel
     * that carries meaning in colour — three coloured counts is how a producer
     * reads the at-bat at a glance, and fading them to say "the feed owns these"
     * spends the signal to make a footnote. Nothing announces the state at all:
     * the controls simply don't take input, which is the whole of what there is
     * to know.
     *
     * Overrides are the exception and stay live in both states — a name
     * (`rioName_override`), which side is home, and the swap all outrank the feed
     * by design.
     */
    const feedLive = useBoardLifecycle(sb) === 'live';
    const statsTag = useSettingsStore(
        s => s?.scoreboards?.binding?.[sb]?.stats_tag
            ?? s?.scoreboards?.binding?.[String(sb)]?.stats_tag
            ?? '',
    );
    /*
     * Did a PRODUCER pick that mode, or did the feed?
     *
     * `stats_tag` was one key doing two jobs, which made "the live mode never
     * took over" and "my pick got clobbered" the same bug from two ends. The flag
     * is the same shape as `player.{T}.rioName_override`: the pick wins and
     * sticks against the feed, and the panel calls it out instead of hiding it.
     */
    const statsTagManual = useSettingsStore(
        s => !!(s?.scoreboards?.binding?.[sb]?.stats_tag_manual
            ?? s?.scoreboards?.binding?.[String(sb)]?.stats_tag_manual),
    );
    // What the game on this board is actually being played in.
    const liveMode = useStateStore(s => s?.score?.[sb]?.game_mode || '');

    // The one thing the desk still asks of the playback binding: a PINNED game
    // is the one the server re-applies from the live feed on its own, which is
    // the condition the Games rule's refresh countdown runs under. The mode
    // belongs to the control that sets it (./games `usePlaybackMode`) and the
    // pool count to the rotator's own status line — both were read here only to
    // build a sentence the rule no longer prints.
    const pinnedGameId = useSettingsStore(
        s => (s?.scoreboards?.binding?.[sb]?.playback
            ?? s?.scoreboards?.binding?.[String(sb)]?.playback ?? {}).gameId ?? null,
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
            /*
             * Is a live API game on this board still being polled for?
             *
             * `game_completed === false` is not enough on its own: when a followed
             * game leaves the ongoing feed the server stops polling for it but
             * leaves that flag false, so the board holds a live game that will
             * never update again. `live_following` is the server saying which of
             * the two it is (server/rio/game_pool.py `_set_following`). Absent —
             * state written before the flag existed — falls back to "yes", since
             * the honest default is the one the board was already behaving as.
             */
            gameLive: b?.game_completed === false && b?.live_following !== false,
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
        if (!rec) return null;
        // The participants come along now: the fixture slot SHOWS the match, and
        // who is playing is the first thing a producer checks one for.
        return {
            label: rec.label,
            phase: rec.phase,
            series: rec.series,
            bestOf: num(rec?.format?.bestOf, 1),
            // `decided` is the FIXTURE's finished test, never `stage` — a Bo3 sits
            // at stage `post` between games and is still the current fixture. Both
            // travel, because the slot says something different about each.
            decided: num(rec.decided, 0),
            stage: rec.stage || '',
            name1: rec?.player?.[1]?.rioName || rec?.player?.['1']?.rioName || '',
            name2: rec?.player?.[2]?.rioName || rec?.player?.['2']?.rioName || '',
        };
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
     * Hand the sides back to the cascade — the "clear the override" half of the
     * swap, the same shape as `useLiveMode` under the game mode.
     *
     * `manual` is the top layer of the side cascade and was the only one with no
     * way out: the server cleared it on a NEW GAME, or mid-game if a second swap
     * happened to land on exactly what the pin already wanted. So a swap made to
     * fix one frame — or made before a fixture was bound — outranked that fixture
     * for the rest of the game, and the only control on offer was another swap,
     * which lands on the other wrong answer half the time.
     *
     * HUD-only, like the swap it reverses: the override is a server flag over the
     * HUD feed, and an API board's swap is a plain state write that never sets it.
     */
    const releaseSides = () => stageOrRun({
        key: `board:${sb}:sides_release`,
        label: `Board ${sb}: sides back to auto`,
        value: true,
        run: () => fetch('/api/v1/rio/swap/release', { method: 'POST' }).catch(() => {}),
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
    /*
     * `releaseMatch` takes the bound fixture OFF the board as part of the clear —
     * see the endpoint, and TurnoverBar, which is the one place that decides it.
     * The staging entry carries it, so a staged clear commits the same shape it
     * was previewed as.
     */
    const resetGame = (releaseMatch = false) => stageOrRun({
        // The staging KEY stays `reset` — it is an id, and the Match desk and the
        // quick face stage against it — but what a producer reads in the confirm
        // buffer is the verb printed on the button they pressed.
        key: `board:${sb}:reset`,
        label: releaseMatch
            ? `Board ${sb}: clear board (game + match)`
            : `Board ${sb}: clear game`,
        value: true,
        /*
         * ONE CALL, AND THE SERVER OWNS THE KEY LIST.
         *
         * This used to build ~120 resting values here and send them as plain state
         * writes. Two things were wrong with that, and only the second was
         * visible:
         *
         * The key list is the INVERSE of what a live frame writes, so its only
         * honest home is beside that writer (`clear_game_entries`,
         * server/rio/provider.py). Kept here it was a third copy — the browser's,
         * the one in test_state_completeness described as "mirroring" the browser's,
         * and the writer itself — and the copies had already drifted apart on
         * `player.{T}.name` while BOTH missed the six resurface fields
         * (`full_name`, `pronoun`, `country`, `state`, `twitter`, `youtube`), so a
         * clear left the previous player's pronouns and socials on air.
         *
         * And a clear has to RE-PROJECT the bound fixture, which no amount of state
         * writing from a browser can do: the Match projector jointly owns
         * `player.{T}.*` and runs only on a bind or a fixture mutation, so blanking
         * those keys from here left the fixture's names gone with nothing to bring
         * them back — the slot above still read `M2 · Alice vs Bob` while the
         * scoreboard drew nobody, and the workaround was knowing to clear BEFORE
         * binding and never after.
         *
         * The HUD release moved with it (the endpoint decides from the board's own
         * transport), so this is no longer two requests that could half-land.
         */
        run: () => fetch(
            `/api/v1/scoreboards/${sb}/clear-game?release_match=${releaseMatch ? 'true' : 'false'}`,
            { method: 'POST' },
        ).catch(() => {}),
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

    /*
     * Which mode's stats to fetch is configuration, not content — it selects a
     * data source rather than changing what is on screen, and the fetch it kicks
     * off can't be deferred as a unit. Immediate, like the intro toggle.
     *
     * Picking one is an OVERRIDE and says so: the flag is what stops every feed
     * path (HUD frame, game assign, rotation advance, match projection) from
     * overwriting it, and what the panel reads to call it out. Clearing hands the
     * board back to the feed — the mode goes to whatever is being played right
     * now rather than to blank, since blank would be a third state nobody asked
     * for.
     */
    const setStatsTag = (v) => {
        const picked = v ?? '';
        settingsSetItem(`scoreboards.binding.${sb}.stats_tag`, picked || liveMode || '');
        settingsSetItem(`scoreboards.binding.${sb}.stats_tag_manual`, !!picked);
    };

    // Hand the mode back to the feed without opening the picker — the "clear the
    // override" half of the name-override idiom, as one press.
    const useLiveMode = () => {
        settingsSetItem(`scoreboards.binding.${sb}.stats_tag`, liveMode || '');
        settingsSetItem(`scoreboards.binding.${sb}.stats_tag_manual`, false);
    };

    return {
        sb, base, transport, feedLive, statsTag, statsTagManual, liveMode, pinnedGameId,
        g, boundMatch, clearAtBatState,
        val, isStaged, setField, swapSides, releaseSides, resetGame, setNameOverride,
        setStatsTag, useLiveMode,
    };
}
