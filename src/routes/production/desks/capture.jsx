import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Trash2, Trophy } from 'lucide-react';
import { useStateStore } from '../../../context/store';
import { Group, Text } from '../../../components/ui/primitives';
import { Badge } from '../../../components/ui/badge';
import { notifications } from '../../../lib/notify';
import { cn } from '../../../lib/utils';
import { ActionRow, SelectRow } from '../kit';
import { useActiveBoards, useBoardLabel } from '../boards';

/*
 * Capture desk — the producer's "this game is over, grab its box score"
 * control. A content workflow, not an OBS one: it never touches a source, so
 * it works with OBS disconnected.
 *
 * POST /postgame/capture matches the finished game's on-disk stat file (by
 * game id + Loaded-from-HUD == 0), projects the box score to postgame.{N}.*
 * (what the Stat Callout and Game Summary read), and advances a bound match to
 * the post stage. Clear blanks it again. Momentary — never staged.
 */

export function useCaptureDesk() {
    const active = useActiveBoards();
    const label = useBoardLabel();
    const [sb, setSb] = useState(active[0]);
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (!active.includes(sb)) setSb(active[0]); }, [active, sb]);

    const pg = useStateStore(useShallow(s => {
        const p = s?.postgame?.[sb];
        return {
            present: p?.present, sourceFile: p?.sourceFile, winnerSide: p?.meta?.winnerSide,
            n1: p?.player?.[1]?.rioName, s1: p?.player?.[1]?.score,
            n2: p?.player?.[2]?.rioName, s2: p?.player?.[2]?.score,
        };
    }));
    const gameId = useStateStore(s => s?.score?.[sb]?.game_id);

    const capture = async () => {
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
    };
    const clear = async () => {
        setBusy(true);
        try { await fetch(`/api/v1/postgame/clear?scoreboard=${sb}`, { method: 'POST' }); }
        catch (e) { notifications.show({ message: `Clear error: ${e?.message || e}`, color: 'red' }); }
        finally { setBusy(false); }
    };

    return { active, sb, setSb, busy, pg, gameId, label, capture, clear };
}

export default function CaptureDesk() {
    const d = useCaptureDesk();
    return (
        <>
            {d.active.length > 1 && (
                <SelectRow
                    label="Board" value={String(d.sb)} onChange={(v) => d.setSb(Number(v))}
                    options={d.active.map(n => ({ label: d.label(n), value: String(n) }))}
                />
            )}
            <ActionRow actions={[
                {
                    label: d.busy ? 'Capturing…' : 'Capture finished game',
                    icon: Trophy, onClick: d.capture, disabled: d.busy, variant: 'default',
                },
                ...(d.pg.present
                    ? [{ label: 'Clear', icon: Trash2, onClick: d.clear, disabled: d.busy, variant: 'ghost' }]
                    : []),
            ]} />
            {d.pg.present ? (
                <>
                    <Group gap="xs" className="flex-wrap items-center">
                        <Badge className="bg-emerald-500/15 text-emerald-300 text-[10px]">Captured</Badge>
                        <Text size="sm" className="text-foreground">
                            <span className={cn(d.pg.winnerSide === 1 && 'font-bold')}>{d.pg.n1 || 'Side 1'}</span> {d.pg.s1 ?? 0}
                            <span className="mx-1 text-muted-foreground">–</span>
                            {d.pg.s2 ?? 0} <span className={cn(d.pg.winnerSide === 2 && 'font-bold')}>{d.pg.n2 || 'Side 2'}</span>
                        </Text>
                    </Group>
                    {d.pg.sourceFile && (
                        <Text size="xs" truncate className="text-muted-foreground" title={d.pg.sourceFile}>
                            {d.pg.sourceFile}
                        </Text>
                    )}
                </>
            ) : (
                <Text size="xs" className="text-muted-foreground">
                    {d.gameId
                        ? `Nothing captured yet for game ${d.gameId}.`
                        : 'No game id on this board yet — finish a game first.'}
                </Text>
            )}
            <Text size="xs" className="border-t border-border/60 pt-2 text-muted-foreground">
                Reads the finished game’s box score from Project Rio’s on-disk stat file, projects
                it for the Stat Callout and Game Summary, and advances a bound match to post-game.
            </Text>
        </>
    );
}
