import { useSettingsStore } from '../../context/store';

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

// Producer-facing board name: the alias when one is set, else "Scoreboard N".
export function useBoardLabel() {
    const aliases = useSettingsStore(s => s?.scoreboards?.aliases);
    return (n) => aliases?.[n] || aliases?.[String(n)] || `Scoreboard ${n}`;
}
