import { useMemo } from 'react';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { notifications } from '../../../lib/notify';
import { DESK_PREFIX } from '../sources/instances';

/*
 * Board (scoreboard) helpers for the console surfaces.
 *
 * The fallback array is module-level on purpose: a selector that writes
 * `?? [1]` inline returns a NEW array identity on every store read, so
 * zustand's Object.is comparison never matches and the component re-renders
 * forever — fatal when it feeds a setState effect (the Capture desk's
 * "selected board still active?" check). Keep the constant.
 */
const DEFAULT_ACTIVE = [1];

export function useActiveBoards() {
    const active = useSettingsStore(s => s?.scoreboards?.active);
    return Array.isArray(active) && active.length ? active : DEFAULT_ACTIVE;
}

/*
 * Whether a board can hold a match — the client half of the server's bind
 * rule, so the console can disable what the API would reject instead of
 * letting the producer click into a 409.
 *
 * Mirrors `bind_scoreboard` in server/api/v1/match.py: a match encodes both
 * sides of one fixture, so a board that is actually ROTATING a pool has no
 * fixed sides to project onto. "Actually rotating" = API transport + rotate
 * playback — board 1 under the HUD toggle is single by construction, and its
 * stored mode is ignored, so a stale "rotate" left from a HUD-off session must
 * not disable it here either. Keep the two in step; they encode one rule.
 */
export function isRotatingBoard(sb, { hudEnabled, bindings } = {}) {
    // Server default for the HUD toggle is on, so only an explicit false is off.
    if (Number(sb) === 1 && hudEnabled !== false) return false;
    const b = bindings?.[sb] ?? bindings?.[String(sb)];
    return b?.playback?.mode === 'rotate';
}

export function useMatchBindableBoards() {
    const hudEnabled = useSettingsStore(s => s?.project_rio?.hud_enabled);
    const bindings = useSettingsStore(s => s?.scoreboards?.binding);
    return (sb) => !isRotatingBoard(sb, { hudEnabled, bindings });
}

/*
 * The boards that are ACTUALLY rotating a pool, as a stable list — the same
 * rule as above, for a caller that needs it as data (the Add picker offers
 * the Results Ticker only on these, because the pool is all it draws).
 */
export function useRotatingBoards() {
    const hudEnabled = useSettingsStore(s => s?.project_rio?.hud_enabled);
    const bindings = useSettingsStore(s => s?.scoreboards?.binding);
    const active = useActiveBoards();
    return useMemo(
        () => active.filter(sb => isRotatingBoard(sb, { hudEnabled, bindings })),
        [active, hudEnabled, bindings],
    );
}

/*
 * There is deliberately no `useElementBoard` here any more.
 *
 * Which board a panel commands used to be a hidden per-element preference
 * (`prsh.ui.production.board.{id}`) that every surface resolved for itself, so
 * a rig running two boards had ONE rack row silently driving whichever board a
 * stored value named. The board is part of an element's identity when the
 * source is URL-scoped, so it lives in the instance id the surfaces already key
 * on — see ../sources/instances. Boards come from the selection or the pin; nothing
 * derives one on its own. Any leftover `prsh.ui.production.board.*` keys in a
 * producer's localStorage are inert.
 */

/*
 * A board's row id in the console.
 *
 * A board IS a desk: it feeds the broadcast and is never on it, it has no OBS
 * source of its own, and it persists for the whole event. What it is not is an
 * element — pool, playback, stats tag and transport belong to the board, not to
 * the Scoreboard overlay, and hanging them off an element row would give two
 * board-scoped elements on one board two copies of one pool (and a board that
 * feeds only a ticker no row at all, since rows derive from sources).
 *
 * The id therefore lives in the desk namespace and carries the board, which
 * `parseInstanceId` is explicitly guarded to leave alone (see ../sources/instances).
 */
export const boardDeskId = (sb) => `${DESK_PREFIX}board:${sb}`;

const BOARD_DESK_ID = /^desk:board:(\d+)$/;

// The board a desk id names, or null for the workflow desks (match/capture/bracket).
export function boardOfDeskId(id) {
    const m = BOARD_DESK_ID.exec(String(id ?? ''));
    return m ? Number(m[1]) : null;
}

// Producer-facing board name: the alias when one is set, else "Scoreboard N".
export function useBoardLabel() {
    const aliases = useSettingsStore(s => s?.scoreboards?.aliases);
    return (n) => aliases?.[n] || aliases?.[String(n)] || `Scoreboard ${n}`;
}

/*
 * Rename a board. Momentary by contract, like the HUD re-read and the capture:
 * an alias is a label on a work surface, not something that reaches air, so
 * staging it would mean a producer looking at a board whose panel disagrees with
 * the rack row naming it.
 *
 * A blank alias is how you go BACK to `Scoreboard {N}` — the server stores the
 * empty string and `useBoardLabel` falls through to the default, which is why
 * the panel's title field shows that default as a PLACEHOLDER rather than as a
 * value to delete.
 */
export function setBoardAlias(sb, alias) {
    const v = (alias ?? '').trim();
    return fetch(`/api/v1/scoreboards/${sb}/alias?alias=${encodeURIComponent(v)}`, { method: 'PUT' })
        .catch(e => notifications.show({ message: `Rename: ${e?.message || e}`, color: 'red' }));
}

/*
 * A board reduced to what tells it from its siblings — for a row that has
 * already said what it is.
 *
 * `useBoardLabel` is the board's NAME and belongs anywhere the board is the
 * subject (its desk row, its stage panel, a rail card's title). But an element
 * row's detail is a qualifier on a name already printed, and the default alias
 * is "Scoreboard {N}" — so a rig with two boards gave every scoreboard row
 * "Scoreboard · Scoreboard 1 · Medium": the word twice, in a ~278px row, with the
 * repeat carrying nothing the row hadn't said.
 *
 * An unnamed board therefore contributes its NUMBER (`B1`), which is the only
 * part that was ever doing work. A named one keeps its alias — the producer chose
 * it to mean something, and "Stream B · Medium" is what they wrote it for.
 */
export function useBoardTag() {
    const aliases = useSettingsStore(s => s?.scoreboards?.aliases);
    return (n) => aliases?.[n] || aliases?.[String(n)] || `B${n}`;
}

/*
 * WHAT STAGE IS THE GAME ON THIS BOARD AT — derived, never stored.
 *
 * The console had every input to this and read none of them as a lifecycle, so
 * a board showing a game that had already finished was indistinguishable from
 * one mid-inning. That is the state a producer is in every time they bind the
 * next fixture, and the app knowing it is what lets the bind say something
 * useful instead of nothing.
 *
 * Four inputs, because no single one covers both transports:
 *
 *   restored         the game came off DISK at boot, not from a feed in this
 *                    process (server/boards.py marks it; any real frame clears
 *                    it). PRSH has no idea a night ended — State.Load restores
 *                    yesterday's score and the provider then re-reads
 *                    decoded.hud.json, which still holds yesterday's last frame —
 *                    so the app opened the next day with a fully populated console
 *                    describing 18-hour-old data and nothing saying so. The flag
 *                    DECAYS rather than needing to be dismissed: the next game's
 *                    first frame retires it, so an app restart mid-broadcast shows
 *                    it for one frame and goes back to LIVE on its own.
 *   game_over        the HUD path, per frame, from pyrio's end-of-game rule.
 *                    Recomputed from the frame on disk, so it survives a restart
 *                    where the other two flags (both records of a CHANGE) do not —
 *                    which is what `restored` above is for: a boot has already
 *                    missed every change there was.
 *   game_completed   the API path: this slot holds a completed-game record.
 *   live_following   the API path again, and a different fact: the server
 *                    stopped polling a game that never finished cleanly, so the
 *                    board holds a game that will never update again.
 *
 * STRANDED is kept apart from FINAL because they are different things to say. A
 * final game ended; a stranded one was abandoned, crashed, or dropped out of the
 * feed. Both mean "what is on air is not going to change", which is why callers
 * asking about staleness get `isStaleBoard` rather than a comparison.
 *
 * Nothing here changes what is ON AIR. Marking a board final is a readout; the
 * clearing is the producer's, deliberately — a game ending must not strip the
 * elements drawing it the instant the last out lands.
 */
export function boardLifecycle({
    gameId, gameOver, gameCompleted, liveFollowing, captured, restored,
}) {
    if (!gameId) return 'empty';
    /*
     * RESTORED OUTRANKS EVERYTHING BELOW, because "this is not current" outranks
     * every detail of a game that is not current: last night's board is both
     * restored and final, and FINAL there reads as "a game just finished here",
     * which is the one thing it is not.
     *
     * Nothing about the CAPTURE hangs off this. The turnover bar decides whether
     * to offer one from whether a capture exists for the board's game, which is
     * the honest question and already what it asks — a restored board with nothing
     * captured still needs the button, since PRSH can be killed between the last
     * out and the capture.
     */
    if (restored) return 'restored';
    /*
     * A CAPTURE FOR THIS GAME MEANS THIS GAME IS OVER.
     *
     * The HUD feed has no final frame — Project Rio stops writing and the last
     * frame it wrote stands, so `game_over` never arrives and a finished local
     * game read `live` forever. The board sat on "8–8, Bot 6" with the real
     * result (9–8) captured directly underneath it, saying LIVE, and the turnover
     * bar that exists for exactly that moment never appeared.
     *
     * The server already knows: the stat file Project Rio writes IS the
     * end-of-game signal for a local board, which is why auto-capture is built on
     * it (server/postgame_watch.py). `captured` is that same signal read back —
     * a `postgame.{N}` whose `gameId` is this board's — so the two runtimes agree
     * about when a game ended instead of the console holding a weaker opinion.
     *
     * FIRST, above `gameOver`: it is the strongest evidence there is (a parsed
     * final box score), and on an API board it can only agree with the flags.
     */
    if (captured) return 'final';
    if (gameOver === true || gameCompleted === true) return 'final';
    // Absent reads as "yes, still following": state written before the flag
    // existed should behave the way the board already was.
    if (liveFollowing === false) return 'stranded';
    return 'live';
}

/* Whether what a board is showing has stopped being a game in progress. */
/*
 * `restored` is in here, and it has to be: the turnover bar renders on
 * `isStaleBoard`, so a board that boots holding last night's game would otherwise
 * lose Clear and Put-on-board at exactly the moment they are the only two presses
 * a producer wants.
 */
export const STALE_LIFECYCLES = ['final', 'stranded', 'restored'];
export const isStaleBoard = (lifecycle) => STALE_LIFECYCLES.includes(lifecycle);

export function useBoardLifecycle(sb) {
    // Returns a string, so no useShallow — zustand's Object.is comparison is
    // exactly right for a primitive (same reasoning as useBoardDeskRow's idle).
    return useStateStore((s) => {
        const b = s?.score?.[sb];
        const pg = s?.postgame?.[sb];
        return boardLifecycle({
            gameId: b?.game_id,
            gameOver: b?.game_over,
            gameCompleted: b?.game_completed,
            liveFollowing: b?.live_following,
            // The capture has to be THIS game's. Nothing clears `postgame.{N}`
            // when a new game starts, so a bare `present` would mark game 2 of a
            // Bo3 final the moment it kicked off, using game 1's box score as the
            // evidence (../postgame draws the same distinction for `stale`).
            captured: !!(pg?.present && pg?.gameId != null
                && String(pg.gameId) === String(b?.game_id)),
            restored: !!b?.restored,
        });
    });
}
