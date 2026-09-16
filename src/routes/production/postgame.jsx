import { memo, useCallback, useMemo, useState } from 'react';
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
     * WHAT THIS CAPTURE DID TO THE MATCH.
     *
     * A capture is the one thing on a board that reaches back out of
     * `score.{N}` and writes another model: `_promote_match` moves the fixture
     * to `post` and `award_game` credits the series, which is what DECIDES a
     * Bo1. The console never said so anywhere. A producer watched their board
     * change a fixture they were not looking at, and the only evidence was a
     * badge on a different row — so "scoreboards decide things in the match" was
     * a rule of the app nobody had been told.
     *
     * The evidence is `match.{m}.credited` (`{game id: side}`), which exists to
     * make crediting idempotent and answers this exactly: not "is the match
     * decided" but "did THIS box score do it". The two come apart in the case
     * worth reporting — a capture with no winner in it (a quit game reports
     * none) credits nothing and leaves a Bo1 sitting at 0-0, which is what a
     * producer is owed a sentence about.
     */
    const credit = useStateStore(useShallow(s => {
        const m = s?.score?.[sb]?.match;
        const rec = (m != null && m !== '') ? s?.match?.[m] : null;
        const gid = s?.postgame?.[sb]?.gameId;
        if (!rec || gid == null || gid === '') return null;
        const side = (rec.credited || {})[String(gid)] ?? null;
        const decided = Number(rec.decided) || 0;
        const series = rec.series || {};
        return {
            m,
            side,
            decided,
            bestOf: Number(rec?.format?.bestOf) || 1,
            w1: Number(series['1'] ?? series[1]) || 0,
            w2: Number(series['2'] ?? series[2]) || 0,
            name1: rec?.player?.['1']?.rioName || rec?.player?.[1]?.rioName || 'Side 1',
            name2: rec?.player?.['2']?.rioName || rec?.player?.[2]?.rioName || 'Side 2',
        };
    }));

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
    const creditLine = useMemo(() => {
        if (!credit) return null;
        const who = s => (s === 1 ? credit.name1 : credit.name2);
        if (credit.side == null) {
            return {
                text: `M${credit.m} not advanced by this capture`,
                title: 'The box score names no winner (a quit game reports none), or the winner isn\u2019t one of this match\u2019s two participants \u2014 PRSH declines to guess. Decide it by hand on the Match desk.',
                warn: true,
            };
        }
        if (credit.decided) {
            return {
                text: `M${credit.m} decided \u2014 ${who(credit.decided)}`,
                title: 'This capture credited the game and clinched the match.',
                warn: false,
            };
        }
        return {
            text: `M${credit.m} now ${credit.w1}\u2013${credit.w2} \u2014 game to ${who(credit.side)}`,
            title: `This capture credited one game of a best of ${credit.bestOf}.`,
            warn: false,
        };
    }, [credit]);

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

    return { busy, pg, gameId, stale, capture, clear, creditLine };
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

/*
 * THE THREE VERBS RIDE THE REGION'S RULE (the board desk hands this to
 * `KitColumn action`, the slot the sides' Swap uses one region up).
 *
 * They were a row of their own under the subject, and on a full-width desk that
 * put the region's LOUDEST thing — a filled `Capture finished game` — under a
 * readout, above a caption, on a board that usually has nothing to do here at
 * all. Every verb is recovery: the stat file fires the capture on its own, and
 * the press a producer actually makes at the end of a game is the turnover
 * bar's Capture, two regions up and beside the clear and the take it belongs
 * with. On the rule, a board with nothing captured is ONE ROW.
 *
 * SECONDARY, NEVER FILLED. Exactly one filled press belongs to a panel and it is
 * the forward move (see `TurnoverActions`) — which is the clear, or the take. A
 * filled capture here made two, and the turnover bar's own Capture is a ghost,
 * so the recovery path was drawn louder than the press it recovers.
 *
 * AND IT IS DISABLED WITH NO GAME TO READ. `find_file` matches the stat file by
 * `score.{N}.game_id` (server/postgame_files.py), so on an empty board this
 * button can only ever answer "No game id for this scoreboard yet" — which it
 * did, in the app's most prominent colour, on every freshly-cleared board. The
 * file picker beside it stays live: picking by hand captures WITHOUT the game-id
 * match, which is the entire reason that hatch exists.
 */
export const PostGameActions = memo(function PostGameActions({ desk }) {
    const d = desk;
    const nothingToRead = !d.gameId && !d.pg.present;
    return (
        <>
            <ActionRow fit actions={[
                {
                    label: d.busy
                        ? 'Capturing…'
                        : (d.pg.present ? 'Re-capture' : 'Capture finished game'),
                    icon: Trophy,
                    onClick: () => d.capture(),
                    disabled: d.busy || nothingToRead,
                    title: nothingToRead
                        ? 'No game on this board to read a stat file for — pick the file by hand if one is already written'
                        : 'Read the finished game’s box score from Project Rio’s stat file',
                },
                ...(d.pg.present
                    ? [{ label: 'Clear', icon: Trash2, onClick: d.clear, disabled: d.busy, variant: 'ghost' }]
                    : []),
            ]} />
            <StatFilePicker onPick={d.capture} disabled={d.busy} />
        </>
    );
});

/*
 * What is left is the CAPTIONS — provenance, then what the capture did to the
 * match — and they share one wrapping row rather than stacking. Two eyebrowed
 * half-sentences on a ~1100px panel are two rows each ~85% empty; side by side
 * they read as one line of footnotes under the readout they annotate, which is
 * what they are.
 */
export default function PostGameSection({ desk }) {
    const d = desk;
    return (
        <>
            {(d.pg.present || d.gameId || d.creditLine) && (
                <div className="flex min-w-0 flex-wrap items-center gap-x-5">
                    {/*
                      * THE FILE IS THE ONLY THING THAT VARIES, so it is the only
                      * thing printed. "Captured on its own when the game ended"
                      * was a clause in front of the filename saying exactly what
                      * the region's own AUTO badge already says — a producer who
                      * has read the badge is reading the sentence to find out
                      * where it stops.
                      *
                      * NOTHING IS SAID FOR A BOARD WITH NO GAME. That state had a
                      * line of its own ("No game id on this board yet — finish a
                      * game first") which was the region's THIRD statement of the
                      * same emptiness: the game-state chip above already reads NO
                      * GAME and the region's own subject already reads "Nothing
                      * captured". A WAIT is worth saying because it means PRSH is
                      * watching for the stat file and the producer needs to press
                      * nothing; an absence two other rows have reported is not.
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
                    {/* WHAT IT DID TO THE MATCH — a caption in the region that
                        did it, and only where a fixture is bound and a box score
                        has landed. A capture is the one thing on a board that
                        writes another model, and the console said so nowhere: the
                        fixture's own badge changes a row away, which shows the
                        RESULT and never the cause. */}
                    {d.creditLine && (
                        <StatusLine
                            label="MATCH"
                            title={d.creditLine.title}
                            tone={d.creditLine.warn ? 'warn' : undefined}
                            className="min-w-0"
                        >
                            {d.creditLine.text}
                        </StatusLine>
                    )}
                </div>
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
