import { memo, useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { FolderSearch, Trash2, Trophy } from 'lucide-react';
import { useStateStore } from '../../context/store';
import { Text, Loader } from '../../components/ui/primitives';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '../../components/ui/popover';
import { notifications } from '../../lib/notify';
import { cn } from '../../lib/utils';
import { ActionRow, StatusLine } from './kit';

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
            gameId: p?.gameId,
            sourceFile: p?.sourceFile,
            capturedBy: p?.capturedBy,
            winnerSide: p?.meta?.winnerSide,
            n1: p?.player?.[1]?.rioName, s1: p?.player?.[1]?.score,
            n2: p?.player?.[2]?.rioName, s2: p?.player?.[2]?.score,
        };
    }));
    const gameId = useStateStore(s => s?.score?.[sb]?.game_id);

    /*
     * IS THIS CAPTURE ABOUT THE GAME ON THE BOARD?
     *
     * Nothing clears `postgame.{N}` when a new game starts — only the Clear
     * route, board removal and /scoreboards/reset do — so after game 1 of a Bo3
     * the region kept reporting game 1's box score while game 2 played, and it
     * could not have known better: it never read the capture's own gameId, so
     * it had nothing to compare. Which is the same disease as a board showing a
     * finished game, one surface over.
     *
     * Stale, not wrong: the capture IS that game's, and the Game Summary may
     * still be legitimately on air showing it. So this is said, never acted on.
     */
    const stale = !!(pg.present && pg.gameId && gameId
        && String(pg.gameId) !== String(gameId));

    /*
     * `file` is the producer's override — a name from GET /postgame/files,
     * captured WITHOUT the game-id match. That match is precisely what fails in
     * the cases this exists for (a crash, a game whose id never reached the
     * board, a file under an id nobody expected), so the hatch cannot re-apply
     * it. The server resolves the name inside the stat folder.
     */
    const capture = useCallback(async (file = null) => {
        setBusy(true);
        try {
            const url = `/api/v1/postgame/capture?scoreboard=${sb}`
                + (file ? `&file=${encodeURIComponent(file)}` : '');
            const r = await fetch(url, { method: 'POST' });
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

    return { busy, pg, gameId, stale, capture, clear };
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
            {/* The badge STATES the provenance; its title is where the
                sentence that used to sit under the filename now lives. One
                statement of "how did this box score get here", not two. */}
            <Badge
                className="shrink-0 cursor-help bg-emerald-500/15 text-[10px] text-emerald-300"
                title={pg.capturedBy === 'auto'
                    ? 'Captured on its own the moment Project Rio wrote this game’s stat file.'
                    : 'Captured by hand, from a stat file you picked.'}
            >
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

/*
 * PICK THE FILE BY HAND.
 *
 * The automatic capture matches the stat file whose GameID is the board's. That
 * is right almost always and useless exactly when something went wrong — a
 * crash, a game whose id never reached the board, a file that landed under an
 * id nobody expected. This is the way out, and it captures WITHOUT the game-id
 * match, because re-applying it would lock the hatch from the inside.
 *
 * The list is fetched when the popover OPENS, not on mount: it stats and parses
 * a directory, and the overwhelmingly common case is a producer who never needs
 * it. Recovery paths should cost nothing until used.
 *
 * Each row says who played and what the score was, because a filename is a
 * GameID and no producer knows which game that is. Date last — it is the
 * tiebreak between two games between the same two people, not the identifier.
 */
const StatFilePicker = memo(function StatFilePicker({ onPick, disabled }) {
    const [open, setOpen] = useState(false);
    const [files, setFiles] = useState(null);   // null = not fetched yet

    const load = useCallback(async (next) => {
        setOpen(next);
        if (!next) return;
        setFiles(null);
        try {
            const r = await fetch('/api/v1/postgame/files?limit=25');
            const data = await r.json().catch(() => ({}));
            setFiles(Array.isArray(data?.files) ? data.files : []);
        } catch {
            setFiles([]);
        }
    }, []);

    return (
        <Popover open={open} onOpenChange={load}>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="xs" disabled={disabled}>
                    <FolderSearch size={13} className="mr-1" />
                    Pick a file
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[22rem] p-1" align="end">
                {files === null && (
                    <div className="flex items-center gap-2 px-2 py-3">
                        <Loader size="xs" />
                        <Text size="xs" dimmed>Reading Project Rio&rsquo;s stat folder&hellip;</Text>
                    </div>
                )}
                {files?.length === 0 && (
                    <Text size="xs" dimmed className="block px-2 py-3">
                        No stat files found. Project Rio writes one per finished game.
                    </Text>
                )}
                {files?.map(f => (
                    <button
                        key={f.file}
                        type="button"
                        onClick={() => { setOpen(false); onPick(f.file); }}
                        className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-secondary"
                    >
                        <span className="flex w-full min-w-0 items-center gap-1.5 text-xs text-foreground">
                            <span className="min-w-0 flex-1 truncate">{f.awayPlayer || 'Away'}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                                {f.awayScore ?? 0}&ndash;{f.homeScore ?? 0}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-right">{f.homePlayer || 'Home'}</span>
                        </span>
                        <span className="w-full truncate text-[10px] text-muted-foreground">
                            {f.endDate || f.file}
                        </span>
                    </button>
                ))}
            </PopoverContent>
        </Popover>
    );
});

export default function PostGameSection({ desk }) {
    const d = desk;
    /*
     * THE THREE CONTROLS ARE ONE ROW, AND THE FILE IS THE CAPTION UNDER IT.
     *
     * This was three stacked rows on a full-width desk: two `flex-1` buttons at
     * ~600px each, then a caption with the file picker stranded on the far right
     * edge, ~1000px from the two buttons that do the same kind of thing. Every
     * verb here is "get a box score onto this board" — the ordinary capture, the
     * hand-picked file, and the undo — so they belong beside each other at their
     * own size, and the sentence about WHICH file is a caption, not a row with a
     * button in it.
     */
    return (
        <>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <ActionRow fit actions={[
                    {
                        label: d.busy
                            ? 'Capturing…'
                            : (d.pg.present ? 'Re-capture' : 'Capture finished game'),
                        icon: Trophy,
                        onClick: () => d.capture(),
                        disabled: d.busy,
                        variant: d.pg.present ? 'ghost' : 'default',
                        title: 'Read the finished game’s box score from Project Rio’s stat file',
                    },
                    ...(d.pg.present
                        ? [{ label: 'Clear', icon: Trash2, onClick: d.clear, disabled: d.busy, variant: 'ghost' }]
                        : []),
                ]} />
                <StatFilePicker onPick={d.capture} disabled={d.busy} />
            </div>
            {/*
              * THE FILE IS THE ONLY THING THAT VARIES, so it is the only thing
              * printed. "Captured on its own when the game ended" was a clause
              * in front of the filename saying exactly what the region's own
              * AUTO badge, three rows up, already says — a producer who has read
              * the badge is reading the sentence to find out where it stops.
              */}
            {/*
              * NOTHING IS SAID FOR A BOARD WITH NO GAME. That state had a line
              * of its own ("No game id on this board yet — finish a game
              * first") which was the region's THIRD statement of the same
              * emptiness: the game-state chip above already reads NO GAME and
              * the region's own subject already reads "Nothing captured". A
              * WAIT is worth saying because it means PRSH is watching for the
              * stat file and the producer needs to press nothing; an absence
              * two other rows have already reported is not.
              */}
            {(d.pg.present || d.gameId) && (
                <StatusLine
                    label={d.pg.present ? 'FILE' : 'WAITING'}
                    title={d.pg.present
                        ? 'The Project Rio stat file this box score was read from.'
                        : 'Project Rio writes a stat file when the game finishes, and the capture happens on its own when it lands.'}
                    className="min-w-0"
                >
                    {d.pg.present
                        ? <span title={d.pg.sourceFile || undefined}>{d.pg.sourceFile}</span>
                        : `Game ${d.gameId}`}
                </StatusLine>
            )}
            {/* The capture is a different game from the one on the board — after
                game 1 of a Bo3, say. Stale, not wrong: it is genuinely that
                game's box score and the Game Summary may still be on air with
                it, so this is said and never acted on. */}
            {d.stale && (
                <Text size="xs" className="text-amber-500/90">
                    This box score is from game {d.pg.gameId}; the board is on {d.gameId}.
                </Text>
            )}
        </>
    );
}
