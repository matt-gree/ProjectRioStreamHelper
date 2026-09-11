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
 * key underneath stays `stranded` (../boards): it is the better word for the
 * condition and the wrong one on a baseball scoreboard, where a stranded runner
 * is a different thing entirely.
 *
 * Amber on STALLED is the deliberate reuse — amber means "you'd want to know
 * before this is on air" everywhere in the console, and a feed that lost its
 * game is exactly that.
 */
export const GAME_STAGE = {
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

// `lifecycle` is ../boards `boardLifecycle`. Renders nothing for a stage with no
// badge (an empty board), so a caller can drop it in unguarded.
export const GameStageChip = memo(function GameStageChip({ lifecycle }) {
    const stage = GAME_STAGE[lifecycle];
    if (!stage) return null;
    return <GameChip title={stage.title} className={stage.className}>{stage.label}</GameChip>;
});
