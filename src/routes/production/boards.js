import { useSettingsStore } from '../../context/store';
import { DESK_PREFIX } from './instances';

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
export function useMatchBindableBoards() {
    const hudEnabled = useSettingsStore(s => s?.project_rio?.hud_enabled);
    const bindings = useSettingsStore(s => s?.scoreboards?.binding);
    return (sb) => {
        // Server default for the HUD toggle is on, so only an explicit false is off.
        if (Number(sb) === 1 && hudEnabled !== false) return true;
        const b = bindings?.[sb] ?? bindings?.[String(sb)];
        return b?.playback?.mode !== 'rotate';
    };
}

/*
 * There is deliberately no `useElementBoard` here any more.
 *
 * Which board a panel commands used to be a hidden per-element preference
 * (`prsh.ui.production.board.{id}`) that every surface resolved for itself, so
 * a rig running two boards had ONE rack row silently driving whichever board a
 * stored value named. The board is part of an element's identity when the
 * source is URL-scoped, so it lives in the instance id the surfaces already key
 * on — see ./instances. Boards come from the selection or the pin; nothing
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
 * `parseInstanceId` is explicitly guarded to leave alone (see ./instances).
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
