import { memo, useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Trash2, Trophy } from 'lucide-react';
import { useStateStore } from '../../context/store';
import { Text } from '../../components/ui/primitives';
import { Badge } from '../../components/ui/badge';
import { notifications } from '../../lib/notify';
import { cn } from '../../lib/utils';
import { ActionRow } from './kit';

/*
 * Post-game — the board's captured box score.
 *
 * A REGION ON THE BOARD, not a desk of its own. It was one, and the give-away
 * was its first control: a "Board" picker, on a console whose rack already asks
 * the producer which board they are looking at. Everything here is scoped to one
 * board (`postgame.{N}.*`, matched to that board's `score.{N}.game_id`), which
 * is the same thing that makes Games and the running order regions rather than
 * desks. See ./desks/board.
 *
 * It is also mostly a READOUT now. The stat file Project Rio writes at the final
 * out fires the capture on its own (server/postgame_watch.py), so the button
 * below is the recovery path — a file that landed late, a capture cleared and
 * wanted back, or a rig with auto-capture switched off — and the panel says
 * which of the two filled it.
 *
 * Momentary by contract: capture and clear never stage. They are recovery
 * actions, like the HUD re-read beside them.
 */

export function usePostGame(sb) {
    const [busy, setBusy] = useState(false);
    const pg = useStateStore(useShallow(s => {
        const p = s?.postgame?.[sb];
        return {
            present: p?.present,
            sourceFile: p?.sourceFile,
            capturedBy: p?.capturedBy,
            winnerSide: p?.meta?.winnerSide,
            n1: p?.player?.[1]?.rioName, s1: p?.player?.[1]?.score,
            n2: p?.player?.[2]?.rioName, s2: p?.player?.[2]?.score,
        };
    }));
    const gameId = useStateStore(s => s?.score?.[sb]?.game_id);

    const capture = useCallback(async () => {
        setBusy(true);
        try {
            const r = await fetch(`/api/v1/postgame/capture?scoreboard=${sb}`, { method: 'POST' });
            const data = await r.json().catch(() => ({}));
            if (data?.success) {
                notifications.show({ message: `Captured ${data.sourceFile} — match advanced to post-game.`, color: 'green' });
            } else {
                notifications.show({ message: `Capture failed: ${data?.reason || 'unknown error'}`, color: 'red' });
            }
        } catch (e) {
            notifications.show({ message: `Capture error: ${e?.message || e}`, color: 'red' });
        } finally { setBusy(false); }
    }, [sb]);

    const clear = useCallback(async () => {
        setBusy(true);
        try { await fetch(`/api/v1/postgame/clear?scoreboard=${sb}`, { method: 'POST' }); }
        catch (e) { notifications.show({ message: `Clear error: ${e?.message || e}`, color: 'red' }); }
        finally { setBusy(false); }
    }, [sb]);

    return { busy, pg, gameId, capture, clear };
}

/*
 * The header-rule subject: the captured line itself, because that is the fact a
 * producer glances for. Same treatment as the Games region's transport badge —
 * one line of state beside the eyebrow that names it.
 */
export const PostGameSubject = memo(function PostGameSubject({ pg }) {
    if (!pg.present) {
        return <Text size="xs" truncate dimmed className="min-w-0">Nothing captured</Text>;
    }
    return (
        <>
            <Badge className="shrink-0 bg-emerald-500/15 text-[10px] text-emerald-300">
                {pg.capturedBy === 'auto' ? 'AUTO' : 'CAPTURED'}
            </Badge>
            <Text size="xs" truncate className="min-w-0 text-foreground">
                <span className={cn(pg.winnerSide === 1 && 'font-bold')}>{pg.n1 || 'Side 1'}</span> {pg.s1 ?? 0}
                <span className="mx-1 text-muted-foreground">–</span>
                {pg.s2 ?? 0} <span className={cn(pg.winnerSide === 2 && 'font-bold')}>{pg.n2 || 'Side 2'}</span>
            </Text>
        </>
    );
});

export default function PostGameSection({ desk }) {
    const d = desk;
    return (
        <>
            <ActionRow actions={[
                {
                    label: d.busy
                        ? 'Capturing…'
                        : (d.pg.present ? 'Re-capture' : 'Capture finished game'),
                    icon: Trophy,
                    onClick: d.capture,
                    disabled: d.busy,
                    variant: d.pg.present ? 'ghost' : 'default',
                    title: 'Read the finished game’s box score from Project Rio’s stat file',
                },
                ...(d.pg.present
                    ? [{ label: 'Clear', icon: Trash2, onClick: d.clear, disabled: d.busy, variant: 'ghost' }]
                    : []),
            ]} />
            <Text size="xs" truncate className="text-muted-foreground" title={d.pg.sourceFile || undefined}>
                {d.pg.present
                    ? (d.pg.capturedBy === 'auto'
                        ? `Captured on its own when the game ended — ${d.pg.sourceFile}`
                        : d.pg.sourceFile)
                    : (d.gameId
                        ? `Waiting on the stat file for game ${d.gameId}.`
                        : 'No game id on this board yet — finish a game first.')}
            </Text>
        </>
    );
}
