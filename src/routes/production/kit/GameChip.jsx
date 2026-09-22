import { memo } from 'react';
import { cn } from '../../../lib/utils';

/*
 * WHERE A GAME IS UP TO — a different axis from the AIR/PVW status chips in
 * ./chip, and deliberately not folded into them. Those describe what a SOURCE
 * contributes to the broadcast; this describes a game's own lifecycle. The two
 * are never drawn together, and nobody reads "LIVE" in front of a score as
 * "enabled in the program scene".
 *
 * IT LIVES IN THE KIT BECAUSE TWO SURFACES ASK IT. The board desk's game slot
 * had this palette to itself, so the same fact was a coloured badge on the desk
 * and dimmed grey prose in the panel subject beside it — the console answering
 * "is this still going" in two registers depending on which surface you were
 * looking at. One palette, both callers.
 *
 * THE STAGE IS THE BADGE, NEVER THE META. `FINAL`/`STALLED` used to REPLACE the
 * inning in a subject's qualifier, so the row answering "is this still going"
 * answered in the same dimmed type as "Top 5", and a finished game lost the
 * inning it finished in. Colour carries the lifecycle; the inning stays put.
 *
 * STALLED IS NOT A SYNONYM FOR FINAL, WHICH IS WHY IT IS NO LONGER `ENDED`.
 * Both amber and grey mean "this will not change again", so the only thing the
 * chip has to say once a game stops is WHICH of the two it is — and `ENDED` was
 * the one word for the amber case that most sounds like the grey one. A final
 * game has a result to capture; a stalled one has none, and its score and inning
 * are a frozen mid-game frame that goes on looking entirely plausible. The state
 * key underneath stays `stranded` (../board/boards): it is the better word for the
 * condition and the wrong one on a baseball scoreboard, where a stranded runner
 * is a different thing entirely.
 *
 * Amber on STALLED is the deliberate reuse — amber means "you'd want to know
 * before this is on air" everywhere in the console, and a feed that lost its
 * game is exactly that.
 *
 * OLD IS THE COLD START, AND IT IS THE ONLY STAGE THAT IS NOT ABOUT THE GAME.
 * The other three describe how a game ended; this one says the game on the board
 * came off disk when PRSH started and nothing has fed it since — which is the
 * state a producer opens the app to the morning after a night, with yesterday's
 * score, yesterday's fixture and yesterday's capture all still there and, until
 * this chip, nothing anywhere saying so.
 *
 * Amber, and it outranks FINAL: last night's board is both, and FINAL there reads
 * as "a game just finished here", which is the one thing it is not. Amber is what
 * the console spends on "you'd want to know before this is on air", and a board
 * quietly showing an 18-hour-old score is exactly that.
 *
 * It needs no dismissing — `restored` is cleared by the next real frame
 * (../board/boards), so the chip retires itself the moment tonight's game starts.
 */
export const GAME_STAGE = {
    restored: {
        label: 'OLD', title: 'This game was on the board when PRSH started, and nothing has fed it since',
        className: 'bg-amber-500/15 text-amber-300',
    },
    live: {
        label: 'LIVE', title: 'A feed is writing this board',
        className: 'bg-emerald-500/15 text-emerald-300',
    },
    final: {
        label: 'FINAL', title: 'The game reached its end — there is a real result to capture',
        className: 'bg-foreground/10 text-foreground',
    },
    stranded: {
        label: 'STALLED', title: 'The feed lost this game — it won’t update again, and what is on screen may be a mid-game frame',
        className: 'bg-amber-500/15 text-amber-300',
    },
};

// The flat label shape, not StateChip's bordered glowing pill — the two must
// stay distinguishable at a glance, because they mean different things.
export const GameChip = memo(function GameChip({ children, title, className }) {
    return (
        <span
            title={title || undefined}
            className={cn(
                'label-display shrink-0 rounded px-1 text-[10px] leading-[1.4] tracking-wider',
                className || 'bg-secondary text-muted-foreground',
            )}
        >
            {children}
        </span>
    );
});

/*
 * `lifecycle` is ../board/boards `boardLifecycle`. Renders nothing for a stage with no
 * badge (an empty board), so a caller can drop it in unguarded.
 *
 * `at` is an optional ISO timestamp (`score.{N}.restored_at`) folded into the
 * title rather than the label: the chip is a STATE and the date is a detail, so a
 * row keeps one word whatever it knows. Absent is a legal answer — the HUD file
 * may be unreadable — and the chip just says OLD without one.
 */
export const GameStageChip = memo(function GameStageChip({ lifecycle, at }) {
    const stage = GAME_STAGE[lifecycle];
    if (!stage) return null;
    const when = at ? `${stage.title} — ${formatGameDate(at)}` : stage.title;
    return <GameChip title={when} className={stage.className}>{stage.label}</GameChip>;
});

/*
 * A timestamp as a producer reads it: "Sep 12" for another day, a clock time for
 * today. Never a year — a board cannot hold a game from a different one and
 * survive to be read about it.
 *
 * Returns "" for anything unparseable rather than throwing or printing
 * "Invalid Date": the input is a file mtime or a feed's own field, and a console
 * that crashes on a malformed one would take the rack with it.
 */
export function formatGameDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date();
    const sameDay = d.getDate() === today.getDate()
        && d.getMonth() === today.getMonth()
        && d.getFullYear() === today.getFullYear();
    return sameDay
        ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
