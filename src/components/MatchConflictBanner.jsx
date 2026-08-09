import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { AlertTriangle } from 'lucide-react';
import { useStateStore } from '../context/store';
import { bindScoreboard, dismissMatchConflict } from '../context/match';
import { Button } from './ui/button';
import { useRackSelection } from '../routes/production/rack';
import { boardDeskId } from '../routes/production/boards';

/*
 * MatchConflictBanner — app-wide notification for a per-game match identity
 * conflict (Phase B).
 *
 * When a HUD board bound to an *undecided* match starts a game whose players
 * don't match the fixture, the server writes score.{N}.match_conflict rather
 * than silently overriding. That needs the producer's attention no matter which
 * tab they're on, so this banner is mounted at the app root. It names the board,
 * shows expected-vs-actual players, opens the offending BOARD on the console, and
 * offers the two inline resolutions (unbind / keep + ignore this game).
 *
 * Producer-UI only — overlays never consume match_conflict.
 */

function ConflictRow({ sb }) {
    const conflict = useStateStore((s) => s.score?.[sb]?.match_conflict ?? s.score?.[String(sb)]?.match_conflict);
    const navigate = useNavigate();
    /*
     * "Go to board" used to mean the Match tab, which no longer exists. The board
     * IS a console panel now, so this selects its desk and lands on the console —
     * and because the selection hook broadcasts to every mounted copy of its key
     * (usePersistentState), it works whether the producer is on another tab or
     * already looking at the console with a different row selected.
     */
    const [, setSelection] = useRackSelection();

    if (!conflict?.active) return null;
    const expected = conflict.expected || {};
    const feed = conflict.feed || {};
    const exp1 = expected['1'] || expected[1] || '—';
    const exp2 = expected['2'] || expected[2] || '—';
    const feedL = feed.left || '—';
    const feedR = feed.right || '—';

    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
            <AlertTriangle size={16} className="shrink-0 text-amber-400" />
            <div className="min-w-0 text-sm">
                <span className="font-semibold text-amber-200">Board {sb}</span>
                <span className="text-amber-100/80">
                    {' '}— live game doesn't match bound Match {conflict.matchId}.
                </span>
                <span className="ml-2 text-xs text-amber-100/60">
                    expected <span className="font-mono">{exp1}</span> vs{' '}
                    <span className="font-mono">{exp2}</span>; on the field{' '}
                    <span className="font-mono">{feedL}</span> vs{' '}
                    <span className="font-mono">{feedR}</span>
                </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="ghost" className="text-amber-100 hover:text-white"
                    onClick={() => { setSelection(boardDeskId(sb)); navigate('/'); }}>
                    Go to board
                </Button>
                <Button size="sm" variant="secondary"
                    onClick={() => dismissMatchConflict(sb)}
                    title="Keep the match bound and ignore this game">
                    Ignore this game
                </Button>
                <Button size="sm" variant="destructive"
                    onClick={() => bindScoreboard(sb, null)}
                    title="Remove the match from this board">
                    Unbind
                </Button>
            </div>
        </div>
    );
}

export default function MatchConflictBanner() {
    // Boards with an active conflict. useShallow over a numeric array keeps this
    // subscription stable across the frequent HUD-tick state updates — it only
    // re-renders when the *set* of conflicted boards changes.
    const conflictBoards = useStateStore(useShallow((s) => {
        const score = s.score || {};
        const out = [];
        for (const k of Object.keys(score)) {
            const mc = score[k]?.match_conflict;
            if (mc && mc.active) out.push(Number(k));
        }
        return out.sort((a, b) => a - b);
    }));

    if (!conflictBoards.length) return null;

    return (
        <div className="border-b border-amber-500/30 bg-amber-950/40 backdrop-blur">
            {conflictBoards.map((sb) => <ConflictRow key={sb} sb={sb} />)}
        </div>
    );
}
