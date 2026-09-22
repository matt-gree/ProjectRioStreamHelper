import { useState, useCallback, useEffect, memo } from 'react';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { notifications } from '../../../lib/notify';
import { useSocketSubscribe } from '../../../context/socket';
import { useSettingsStore } from '../../../context/store';
import { SingleGameFinder } from './single';
import { RotatingGames } from './rotating';

/*
 * Games — where a board's games come from, and how it plays them.
 *
 * THE MODE CHOICE IS THE SUBJECT OF THIS SURFACE, and the surface is an
 * INSTRUMENT, not a settings list: one full-width segmented picks how the board
 * plays (one game, or rotating), and everything below belongs to the mode that
 * is selected — a live/completed game table in one, a filter plus a running
 * transport in the other. That is the shape `PoolBrowser` had on the Match tab,
 * and it is the shape it keeps here.
 *
 * It is written down because an intermediate version got it wrong in a way worth
 * not repeating. Splitting the surface strictly by TEMPO — steady-state controls
 * as kit rows on the panel, everything browsable behind one dialog — demoted the
 * mode to `SegmentedRow label="Playback"` in a label gutter, put the live game
 * list two clicks away behind "Find a game…", and left the pool's status line
 * (the thing that says *why* nothing matched) inside the dialog where a producer
 * glancing at the panel could not see it. The tempo instinct was right about one
 * thing only — a date range is not a mid-game control — and the Live/Completed
 * tab already handles that, because the date fields only exist on the tab a
 * producer explicitly switched to.
 *
 * So the split is by JOB, not by tempo:
 *   • On the panel — the mode, its source scope, its filter, its timing, its
 *     transport, its status, and the game list you pick from.
 *   • Behind ONE dialog — the rotating pool's MEMBER LIST, for excluding games.
 *     Exactly the dialog `PoolBrowser` opened (`PoolGamesModal`), for exactly
 *     the same reason: it is a long table you visit to prune, not to watch.
 *
 * What genuinely changed in the move off the tab: a board's games are authored
 * on the BOARD (which is what let the Match tab go), and putting a game on a
 * board now routes through the staging gateway, because it is the one act here
 * that reaches air.
 *
 * THE TWO AXES STAY TWO THINGS (see ../boards): transport (HUD vs API) is
 * DERIVED and has no picker; playback (single vs rotating) is CHOSEN and is the
 * only thing this surface sets. Neither is drawn here: the board desk states both
 * on the region's header rule (`KitColumn subject`), so a one-line statement of
 * state costs no row. A HUD board has no pool at all — its game is whatever
 * Project Rio is playing — so that header is its entire Games region and this
 * module renders nothing.
 */



/*
 * Stable fallback references for the store selectors below. Zustand v5's
 * `useStore` uses the RAW `useSyncExternalStore` (no selector memoization), so a
 * selector that mints a fresh object each call makes getSnapshot return a new
 * reference every read and React loops ("The result of getSnapshot should be
 * cached…" → "Maximum update depth exceeded"). This bites right after a board is
 * added: `scoreboards.active` and `scoreboards.binding.{id}` broadcast as two
 * separate settings updates, so there is a render window where the board exists
 * and its binding has not arrived.
 */
const DEFAULT_POOL = { filters: [], scope: 'both', excluded: [], refresh_interval: 60 };

// ─── the section ────────────────────────────────────────────────────────────

const playbackOptions = [
    { value: 'single', label: 'One game' },
    { value: 'rotate', label: 'Rotating' },
];

// The rotation's own status (index, next advance) — REST on mount, then pushed.
function useRotationStatus(sb) {
    const [status, setStatus] = useState({ active: false });
    useEffect(() => {
        let live = true;
        fetch(`/api/v1/rotation/${sb}`).then(r => r.json())
            .then(s => { if (live) setStatus(s); })
            .catch(() => {});
        return () => { live = false; };
    }, [sb]);
    const onStatus = useCallback((payload) => {
        if (payload?.scoreboard === sb) setStatus(payload);
    }, [sb]);
    useSocketSubscribe('v1.rotation.status', onStatus);
    return [status, setStatus];
}

// Seconds until the next advance, ticked locally off the server's target time.
function useAdvanceCountdown(active, nextAdvanceAt) {
    const [secs, setSecs] = useState(null);
    useEffect(() => {
        if (!active || !nextAdvanceAt) { setSecs(null); return undefined; }
        const tick = () => setSecs(Math.max(0, Math.round(nextAdvanceAt - Date.now() / 1000)));
        tick();
        const id = setInterval(tick, 250);
        return () => clearInterval(id);
    }, [active, nextAdvanceAt]);
    return secs;
}

/*
 * THE MODE IS THE REGION'S SUBJECT, SO IT RIDES THE REGION'S RULE — and the
 * value has to be owned above both halves of it. The board desk puts
 * `PlaybackModeControl` on the Games rule (`KitColumn subject`, the same slot
 * the feed's badge and mode picker ride one region up) and the chosen half in
 * the body, so this hook is called ONCE, by the desk, and the value passed to
 * both. Two calls would be two local echoes free to disagree about which mode
 * the board is in — on the one control that decides where a board's games come
 * from.
 *
 * `mode` is server-backed (a settings round-trip), so a click has to wait for
 * the PUT to echo back before the control moves — which reads as a locked
 * segmented while the server is busy fetching. Echo the click locally and
 * reconcile once the persisted value catches up.
 *
 * AN ECHO THAT OUTLIVES A FAILED WRITE IS A LIE, and this one had no way to
 * end: the override cleared only when the server AGREED with it, so a PUT
 * that 4xx'd or never landed left the segmented showing a mode the board is
 * not in, for the rest of the session. On the one control that decides where
 * a board's games come from, that is the worst possible thing to be wrong
 * about. Drop back to the server's answer and say so — the same rule every
 * other fire-and-forget write on the console follows.
 */
export function usePlaybackMode(sb) {
    const serverMode = useSettingsStore(s => s?.scoreboards?.binding?.[sb]?.playback?.mode
        ?? s?.scoreboards?.binding?.[String(sb)]?.playback?.mode ?? 'single');
    const [modeOverride, setModeOverride] = useState(null);
    const mode = modeOverride ?? serverMode;
    useEffect(() => {
        if (modeOverride && serverMode === modeOverride) setModeOverride(null);
    }, [serverMode, modeOverride]);
    const setMode = useCallback((next) => {
        setModeOverride(next);
        const failed = (e) => {
            setModeOverride(null);
            notifications.show({ message: `Playback mode: ${e?.message || e}`, color: 'red' });
        };
        fetch(`/api/v1/scoreboards/${sb}/binding?kind=${next}`, { method: 'PUT' })
            .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
            .catch(failed);
    }, [sb]);
    return [mode, setMode];
}

/*
 * A SEGMENTED AT ITS OWN WIDTH, and it is what the region's rule says now.
 *
 * It was `fullWidth` at the top of the body — a two-option control drawn as a
 * ~1100px bar on a full-width desk, which is the same "nothing on a full-width
 * desk gets flex-1" the rest of this panel already follows. Above it the rule
 * carried a SENTENCE about the very choice this control makes ("Rotating —
 * nothing in its pool yet"), so the region opened by saying the same thing
 * twice, once in prose and once in a banner, with the pool's own status line
 * saying the third of it a few rows down. The control states it and changes it;
 * that is one statement, in the slot the console keeps for a region's subject.
 */
export const PlaybackModeControl = memo(function PlaybackModeControl({ mode, onChange }) {
    return (
        <SegmentedControl
            size="xs" className="shrink-0"
            data={playbackOptions} value={mode} onChange={onChange}
        />
    );
});

/*
 * GamesSection — the surface belonging to whichever mode is chosen: the live
 * game list you pick one from, or the pool filter with its timing and transport.
 *
 * The mode control and the transport badge are NOT here — they ride the
 * region's own header rule on the board desk, because a region's subject does
 * not need a row of its own on a surface that was already too tall.
 */
export const GamesSection = memo(function GamesSection({ sb, mode, transport, gameModes }) {
    const pool = useSettingsStore(s => s?.scoreboards?.binding?.[sb]?.pool
        ?? s?.scoreboards?.binding?.[String(sb)]?.pool ?? DEFAULT_POOL);
    const [status, setStatus] = useRotationStatus(sb);
    const countdown = useAdvanceCountdown(status.active, status.next_advance_at);

    // Transport is momentary — the same rule as Take and post-game capture. A
    // producer pressing Next means now, not on the next confirm.
    const transportCall = useCallback(async (verb) => {
        const data = await fetch(`/api/v1/rotation/${sb}/${verb}`, { method: 'POST' })
            .then(r => r.json()).catch(() => null);
        if (data) setStatus(verb === 'stop' ? { active: false } : data);
    }, [sb, setStatus]);

    /*
     * A HUD board has no pool and no playback choice — its game is whatever
     * Project Rio is playing locally, and the region's header sentence already
     * says so (server/bindings.py). Everything here would be a control with
     * nothing to act on, so the region is its header and nothing else.
     */
    if (transport === 'hud') return null;

    return mode === 'rotate' ? (
        <RotatingGames
            sb={sb} pool={pool} tagOptions={gameModes}
            status={status} transportCall={transportCall} countdown={countdown}
        />
    ) : (
        <SingleGameFinder sb={sb} tagOptions={gameModes} />
    );
});
