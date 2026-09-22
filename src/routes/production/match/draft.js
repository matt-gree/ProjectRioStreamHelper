import { useStateStore } from '../../../context/store';
import { updateMatch } from '../../../context/match';
import { useStagingStore, stageOrRun } from '../../../context/staging';
import { notifications } from '../../../lib/notify';
import { cn } from '../../../lib/utils';
import { KIT_FIELD } from '../kit';

// The Match desk's staging plumbing: every edit is staged per fixture path
// (`match:{m}:{path}`) and read back through `useMatchDraft`.

/*
 * Every write on this desk is fire-and-forget, so each one needs a rejection
 * handler: a failed reorder or rename is otherwise an unhandled promise and a
 * control that looks like it did nothing. `.catch(failed('Running order'))`.
 */
export const failed = (label) => (e) => notifications.show({
    message: `${label}: ${e?.message || e}`, color: 'red',
});

// 'player.1.captain' → { player: { 1: { captain: value } } } for the merge PUT.
function nestPath(path, value) {
    const out = {};
    let cur = out;
    const keys = path.split('.');
    for (let i = 0; i < keys.length - 1; i++) cur = (cur[keys[i]] = {});
    cur[keys[keys.length - 1]] = value;
    return out;
}

// match.{m} with staged-value display, mirroring useLowerThird: `val(path,
// live)` returns the pending value when one is staged; `setField` stages one
// field write whose commit is the merge PUT.
export function useMatchDraft(m) {
    const match = useStateStore(s => s?.match?.[m]);
    const pendingMap = useStagingStore(s => s.pending);
    const val = (path, live) => {
        const p = pendingMap[`match:${m}:${path}`];
        return p ? p.value : live;
    };
    const isStaged = (path) => !!pendingMap[`match:${m}:${path}`];
    const setField = (path, value, label) => stageOrRun({
        key: `match:${m}:${path}`,
        label: label || `Match ${m}: ${path}`,
        value,
        run: () => updateMatch(m, nestPath(path, value)),
    });
    return { match, val, isStaged, setField };
}

export const DB_FIELD = KIT_FIELD;

/*
 * The desk's quiet field weight. Everything here used to be DB_FIELD — one
 * bordered, filled box repeated ~15 times — so the panel had no entry point:
 * the participant names (what the desk is FOR) carried exactly as much weight
 * as the controller port. QUIET_FIELD keeps the geometry and drops the fill,
 * so the fixture metadata recedes a tier and the two names read as the
 * subject. Nothing here changes what a control does — only how loudly it says
 * it. (The side loadouts dropped the shape entirely: they're one-touch boards
 * now, not fields.)
 */
export const QUIET_FIELD = cn(KIT_FIELD, 'bg-transparent');
