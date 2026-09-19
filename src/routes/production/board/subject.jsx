import { memo, useState } from 'react';
import { SkipForward, Unlink } from 'lucide-react';
import { stageOrRun, usePending } from '../../../context/staging';
import { Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { notifications } from '../../../lib/notify';
import { cn } from '../../../lib/utils';
import { Eyebrow, GAME_STAGE } from '../kit';
import { useNextUp } from '../match/queue';
import { isStaleBoard, useMatchBindableBoards } from './boards';
import { useSideLabels } from '../sides';
import { bindScoreboard, takeNextMatch } from '../../../context/match';
import { formatLabel, isSplit, matchComplete, seriesContinues } from '../../../../public/layout/lib/match-format.js';
import { num } from './shared';

// The board's subject row: the game, the bound fixture, and the turnover
// presses (capture · clear · take next) that end one and start the next.

/*
 * HOW this board presents its games — the second axis, and the one the desk was
 * silent about.
 *
 * Transport (HUD vs API) and playback (single vs rotate) are independent:
 * transport is where games come from and is DERIVED, playback is how the board
 * shows them and is CHOSEN. Flattening them into one "HUD / single / rotator"
 * list is what the Match tab did, and it makes "HUD + rotate" expressible when
 * it is not a real state — board 1 under the HUD toggle is single by
 * construction whatever its stored mode says (see ./boards
 * useMatchBindableBoards, and bind_scoreboard on the server, which encode the
 * same rule). So they are stated as two things, never picked as one.
 *
 * THE REGION'S RULE CARRIES THE CONTROL, NOT A SENTENCE ABOUT IT. `playbackLine`
 * lived here and wrote the Games rule's subject — "Rotating — nothing in its
 * pool yet", "One game, pinned — following it live" — and every clause of it was
 * already drawn somewhere the producer was looking anyway. The MODE is the
 * segmented that sat directly beneath it, and is now on the rule itself
 * (./games `PlaybackModeControl`); the POOL COUNT is the rotator's own status
 * line, the only surface that can also say WHY a pool is empty; RUNNING is the
 * Start/Stop button that "(paused)" was describing; and "following it live" is
 * the refresh countdown beside it — a caption on a clock, telling you what the
 * clock is doing. Three statements of one fact, the middle one in prose.
 *
 * `boardTypeTag` below is the same two axes compressed to what a rack row holds,
 * and is all that is left of the sentence.
 */

/*
 * UP NEXT — the board takes the next queued fixture.
 *
 * The verb lives on the BOARD, beside the line that says which match it is
 * carrying, because that line is what it changes. Assignment from the match's
 * side (the Match desk's bind chips) is right for drafting the night's fixtures;
 * this is the live direction — "board 2 just finished, put the next one up" — and
 * it is one press rather than finding the right match in a stack.
 *
 * It names the fixture it will put up. A bare "Next" would be the one control on
 * the panel that changes what is on air without saying what to.
 *
 * The take is momentary, like the rotation transport and Take: a producer pressing
 * this at the end of a game means now. The label previews the client's read of the
 * queue (../match/queue), but the SERVER re-resolves and binds under a lock — the button
 * never sends an id, so two boards pressed together can't land on one fixture.
 */
const TakeNextButton = memo(function TakeNextButton({ sb, label, primary = false }) {
    const [taking, setTaking] = useState(false);
    const take = () => {
        setTaking(true);
        takeNextMatch(sb)
            .catch(e => notifications.show({ message: `Up next: ${e?.message || e}`, color: 'red' }))
            .finally(() => setTaking(false));
    };
    return (
        <Button
            size="xs" variant={primary ? 'default' : 'secondary'} className="h-7 shrink-0"
            onClick={take} disabled={taking}
            title={`Put ${label} on this board — whatever game is on it now is cleared as this goes up`}
        >
            <SkipForward size={12} className="mr-1 shrink-0" />
            Put on board
        </Button>
    );
});

/*
 * THE BOARD'S FIRST CLOCK. The pair's history is on BoardSubject below, which is
 * where the two of them now live on one row.
 *
 * WHERE THE GAME IS UP TO MOVES TO THE CHIP, and the meta goes back to being the
 * inning. It used to be the other way round — `Final` and `Ended` were printed
 * IN the meta slot, replacing the inning — so the one row that answers "is this
 * still going" answered it in the same dimmed type as "Top 5", and a finished
 * game lost the inning it finished in. LIVE is not on the console's status
 * palette (emerald AIR · sky PVW · rio DESK · amber staged, see ../kit/chip):
 * this is a neutral pill, the same one the fixture slot spends on `M2`, because
 * a sixth meaning in a spoken-for hue costs more than it buys.
 */
/*
 * THE CHIP CARRIES THE STATE IN COLOUR, and this is the one place on the console
 * that is allowed to. The status palette (emerald AIR · sky PVW · rio DESK ·
 * amber staged, ../kit/chip) describes what a SOURCE contributes to the
 * broadcast; a game's lifecycle is a different axis entirely, it is never drawn
 * beside a `StateChip`, and the words do not overlap — nobody reads "LIVE" in
 * front of a score as "enabled in the program scene". It keeps the flat label
 * shape rather than borrowing `StateChip`'s bordered, glowing, fixed-width pill,
 * so the two are still told apart at a glance.
 *
 * Amber on ENDED is deliberate reuse, not a collision: amber means "you'd want
 * to know before this is on air" everywhere else in the console, and a feed that
 * lost its game is exactly that. FINAL is the calm one — a game ending is the
 * expected outcome, not an alert — but it reads at full strength, because it is
 * the state the producer acts on.
 */
// The palette moved to ../kit (GameChip): the panel subject in this very
// panel's header draws the same verdict, and two copies is how one surface
// ends up amber while the other is grey about one fact.
export const SlotChip = ({ children, title, className }) => (
    <span
        title={title || undefined}
        className={cn(
            'label-display shrink-0 rounded px-1 text-[10px] tracking-wider',
            className || 'bg-secondary text-muted-foreground',
        )}
    >
        {children}
    </span>
);

/*
 * THE GAME LINE — chip · side · score · side · where it is up to.
 *
 * A fragment, not a box: it is half of one row (see BoardSubject), and the
 * flex-1 name cells are what make the two clocks share their width.
 */
const GameLine = memo(function GameLine({ d, lifecycle }) {
    const { label } = useSideLabels();
    const { g } = d;

    if (!g.name1 && !g.name2) {
        return (
            <>
                <SlotChip title="Nothing has loaded onto this board">NO GAME</SlotChip>
                <Text size="xs" dimmed className="min-w-0 flex-1 truncate">
                    {d.transport === 'hud'
                        ? 'Waiting for Project Rio to write a game.'
                        : 'Waiting for a game from this board’s pool.'}
                </Text>
            </>
        );
    }

    /*
     * NO CHIP, NO INNING. `lifecycle` is `empty` exactly when the board carries
     * no `game_id`, and a fixture projected onto a board with no game populates
     * both names while `inning` defaults to 1 — so an unstarted match would have
     * read "Top 1", which is a frame that has not happened.
     */
    const stage = GAME_STAGE[lifecycle];
    const where = stage
        ? `${(g.halfInning || 'Top') === 'Top' ? 'Top' : 'Bot'} ${g.inning}`
        : null;
    return (
        <>
            {stage && (
                <SlotChip title={stage.title} className={stage.className}>{stage.label}</SlotChip>
            )}
            <span className="min-w-0 flex-1 truncate text-sm">{g.name1 || label(1)}</span>
            <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                {g.scoreLeft ?? 0}–{g.scoreRight ?? 0}
            </span>
            <span className="min-w-0 flex-1 truncate text-right text-sm">{g.name2 || label(2)}</span>
            {where && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{where}</span>}
        </>
    );
});

/*
 * THE BOARD'S SUBJECT — BOTH CLOCKS ON ONE ROW, BECAUSE THEY SHARE A SUBJECT.
 *
 * A board runs TWO clocks: the game (`score.{N}`: empty → live → final/stranded,
 * feed-owned, watched) and the match (`match.{M}`: draft → live → post +
 * `decided`, producer-owned, driven). They were drawn as different KINDS of
 * thing — the game a bare line of text, the match a bordered slot — so the pair
 * never read as two halves of one question, which is most of why the game state
 * was once described as "hidden". Giving them one shape fixed that and created
 * the next problem: two full-width bars, stacked, each spending its width on the
 * SAME TWO NAMES, with ~400px of dead air in the middle of both.
 *
 * THE NAMES ARE THE SHARED SUBJECT, so they are drawn ONCE and the two clocks
 * become the two ends of one row: the game on the left (its stage, the score,
 * the inning), the fixture on the right behind a rule (its id, the series, the
 * round, the unlink). Nothing was dropped — the fixture's copy of the names is
 * what went, and it was a copy: the Match projector WRITES `match.{M}`'s
 * participants into `score.{N}.player.{T}.rioName` (`_FEED_SHARED_KEYS`,
 * server/match.py), so on a bound board the two lines were the same two strings
 * from the same key, one projected into the other.
 *
 * EXCEPT WHEN THEY ARE NOT, WHICH IS THE WHOLE POINT OF SPLITTING THEM AGAIN.
 * A live feed can overwrite those names with different players — that is exactly
 * what `score.{N}.match_conflict` is raised for — and there the DIFFERENCE is
 * the content: a merged row could only show one pair, which is the one thing a
 * producer resolving a conflict must not be given. So the merge is conditional
 * on the two clocks agreeing, and the row splits back into the two bars the
 * moment they don't, with the fixture's own names under the game's and the
 * amber the conflict already spends.
 *
 * `agree` compares the names rather than trusting the flag alone: the flag is
 * the server's identity gate and answers a slightly different question (it also
 * auto-retires), while a fixture bound with NO participants yet is a real state
 * the gate says nothing about — and splitting there is right, because "Side 1 vs
 * Side 2" under a live game is how a producer sees they bound an empty draft.
 */
export const BoardSubject = memo(function BoardSubject({
    sb, d, lifecycle, matchId, match, conflict, postgame,
}) {
    const next = useNextUp(sb);
    const canBind = useMatchBindableBoards()(sb);
    /*
     * A TAKE IS THE PANEL'S LOUD PRESS ONLY DURING A TURNOVER. Over a LIVE game an
     * unbound board's take is an ordinary correction — the fixture was authored
     * after the first pitch — and a filled brand-red button beside a game in
     * progress reads as something that needs doing now. Once the game is over,
     * stalled, or left from a previous session, it IS the thing to do.
     */
    const stale = isStaleBoard(lifecycle);
    // One staging key for one fact. The Match desk's bind chips stage under
    // `bind:{sb}` too, so a producer in confirm mode cannot leave two entries
    // disagreeing about what board {sb} holds — and either surface shows the
    // other's staged change.
    const pending = usePending(`bind:${sb}`);
    const stagedOff = !!pending && pending.value == null;
    const bound = matchId != null && matchId !== '';

    const unbind = () => stageOrRun({
        key: `bind:${sb}`,
        label: `Unbind board ${sb}`,
        value: null,
        liveValue: bound ? Number(matchId) : null,
        run: () => bindScoreboard(sb, null),
    });

    const w1 = num(match?.series?.[1] ?? match?.series?.['1'], 0);
    const w2 = num(match?.series?.[2] ?? match?.series?.['2'], 0);
    /*
     * THE SERIES IS ONLY NEWS IN A SERIES. `default_match()` is `{"bestOf": 1}`
     * and a Bo1 night is what almost every night is, where this cell reads 0–0
     * for the whole match and then 1–0 once the capture lands — a number that
     * says nothing the game's own score does not. A Bo3 needs it and keeps it.
     */
    const series = num(match?.bestOf, 1) > 1;
    const round = [match?.label, match?.phase].filter(Boolean).join(' · ');
    /*
     * WHEN IS A FIXTURE DONE? `decided`, never `stage` — the server only ever
     * moves stage forward, and a Bo3 sits at `post` BETWEEN GAMES while still
     * being the current fixture (server/schedule.py states this rule once, for
     * `not_waiting_reason`; this is the same question asked on the panel).
     *
     * The two states say different things and the row says both, because "what
     * happens when a match goes to post" was invisible here: a finished fixture
     * and a mid-series one rendered identically, and a producer at the end of a
     * match had no way to tell that nothing was going to clear it for them. Only
     * ONE server path unbinds by itself (`_retire_match_from_board` — a decided
     * match plus a new game between different players), so on the ordinary end of
     * a night, clearing the board is the producer's move.
     */
    /*
     * IS THE FIXTURE OUT OF GAMES? — not "who won it". `decided` answered both
     * while every multi-game format was odd; a DOUBLEHEADER IS COMPLETE AFTER
     * TWO GAMES HOWEVER THEY FALL, so a 1-1 split is finished and unwon. Asking
     * `decided` here left a split bound to its board with no handover offered.
     */
    const done = bound && matchComplete(
        match?.bestOf, match?.series?.[1], match?.series?.[2], match?.decided,
    );
    const split = bound && isSplit(
        match?.bestOf, match?.series?.[1], match?.series?.[2], match?.decided,
    );
    /*
     * "BETWEEN GAMES" IS A THING ONLY A SERIES HAS. It was `stage === 'post'`
     * and not decided, which on a **Bo1** — `default_match()`, and what nearly
     * every night is — describes no state at all: there is no next game to be
     * between. It showed up anyway whenever a capture failed to credit a winner
     * (a quit game reports none), so the board answered "what happened to my
     * match?" with a Bo3 concept that could not apply to it. The format is what
     * decides whether another game can follow, so the format gates the phrase.
     */
    const between = bound && !done && match?.stage === 'post'
        && num(match?.bestOf, 1) > 1;
    const winner = (done && !split) ? (match.decided === 1 ? match?.name1 : match?.name2) : '';

    // Two copies of one pair of strings, or two different pairs? See the note
    // above — this is what decides whether the row is one or two.
    const same = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
    const agree = bound && !conflict
        && same(d.g.name1, match?.name1) && same(d.g.name2, match?.name2);

    const unlinkButton = (
        /*
         * UNBIND, from the board's side. It used to live only on the Match desk's
         * lit bind chip — correct, since a match fills one board so retiring IS
         * unbinding that chip, but it asked a producer looking at the wrong
         * fixture ON THIS BOARD to go find the match holding it. The verb belongs
         * wherever the fact is shown, and both routes are the same staged write.
         *
         * No confirm: it unbinds, it doesn't delete — the fixture keeps its series
         * and goes back to the running order, and Up next puts it straight back.
         */
        <SimpleTooltip
            label={stagedOff
                ? 'Staged: this board hands back to its own feed on the next confirm'
                : `Take Match ${matchId} off this board — it keeps its series`}
        >
            <button
                type="button"
                onClick={unbind}
                aria-label={`Take match ${matchId} off board ${sb}`}
                className={cn(
                    'shrink-0 transition-colors',
                    stagedOff ? 'text-amber-400' : 'text-muted-foreground/70 hover:text-foreground',
                )}
            >
                <Unlink size={13} />
            </button>
        </SimpleTooltip>
    );

    /*
     * The fixture, with or without its copy of the names. `compact` is the merged
     * row, where the names are the game's an inch to the left; the full form is
     * the split, where saying who the FIXTURE thinks is playing is the reason the
     * second bar exists at all.
     */
    const fixtureBody = (compact) => (
        <>
            <span className="label-display shrink-0 rounded bg-secondary px-1 text-[10px] tracking-wider text-muted-foreground">
                M{matchId}
            </span>
            {/* The winner reads at full strength and the loser drops a tier: the
                result is the thing you are checking at this point, and it needs no
                colour to say it. */}
            {!compact && (
                <span className={cn(
                    'min-w-0 flex-1 truncate text-sm',
                    done && !split && match.decided !== 1
                        ? 'text-muted-foreground' : 'text-foreground',
                )}>
                    {match?.name1 || 'Side 1'}
                </span>
            )}
            {series ? (
                <span
                    className="shrink-0 text-sm tabular-nums text-muted-foreground"
                    title={`Series — ${match?.name1 || 'Side 1'} ${w1}, ${match?.name2 || 'Side 2'} ${w2}, ${formatLabel(match?.bestOf, { long: true })}`}
                >
                    {w1}–{w2}
                </span>
            ) : (!compact && <span className="shrink-0 text-xs text-muted-foreground/60">vs</span>)}
            {!compact && (
                <span className={cn(
                    'min-w-0 flex-1 truncate text-right text-sm',
                    done && !split && match.decided !== 2
                        ? 'text-muted-foreground' : 'text-foreground',
                )}>
                    {match?.name2 || 'Side 2'}
                </span>
            )}
            {/*
              * DECIDED, NOT `FINAL` — because the game chip four inches to the
              * left says FINAL and means something else. A game is final when it
              * reached its last out; a fixture is decided when the SERIES is over,
              * and a Bo1 whose game has just been captured is both at once: two
              * identical badges on one row, a hand's width apart, for two facts
              * that differ in exactly the way a producer is checking. They were
              * on separate rows when this badge was written, which is the only
              * reason one word could serve both. `decided` is the state key's own
              * word and the one this file uses everywhere else; the winner is in
              * the title, where a name has room to be a name.
              */}
            {done && (
                <span
                    className="label-display shrink-0 rounded bg-secondary px-1 text-[10px] tracking-wider text-foreground"
                    title={split
                        ? 'Both games played and the doubleheader is split — nobody took it'
                        : (winner ? `${winner} took the series` : 'Series decided')}
                >
                    {/* SPLIT is the word for the one finished-and-unwon state
                        there is, and only an even format can reach it. Calling
                        it DECIDED would name a winner that does not exist. */}
                    {split ? 'SPLIT' : 'DECIDED'}
                </span>
            )}
            {round && <span className="min-w-0 shrink truncate text-xs text-muted-foreground">{round}</span>}
            {between && (
                // Why nothing cleared: the game is over, the FIXTURE isn't.
                <span className="shrink-0 truncate text-xs text-muted-foreground">between games</span>
            )}
            {unlinkButton}
        </>
    );

    /*
     * THE END-OF-MATCH MOVE, on the row the match is finishing on.
     *
     * A decided fixture stays bound — deliberately, since only a new game between
     * different players auto-retires one — so the board sat on a finished match
     * with the take hidden behind an unbind the producer had to know to press
     * first. Taking the next fixture needs no unbind: `bind_board` overwrites
     * `score.{N}.match`, so Put on board IS the handover.
     *
     * THERE IS EXACTLY ONE TAKE ON THE PANEL AT A TIME, and the rule used to
     * reconcile only TWO of the three places one can appear. This is the
     * FIXTURE's end of life; the UP NEXT tail is an UNBOUND board's; the turnover
     * bar's is the GAME's, for the Bo1 whose match is not decided yet because the
     * capture that decides it has not been made.
     *
     * It keeps its own line — a second row INSIDE the subject box — because it is
     * about the next fixture rather than this one, and because the take is a
     * button that must not compete with the row above for width.
     */
    const footer = done ? (
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/50 pt-1.5">
            {/* DONE with nothing beside it IS the statement. The line that used to
                fill the value slot ("clear the board when you're ready") pointed
                at the turnover bar's own Clear, which is on screen and lit at
                exactly this moment. */}
            <Eyebrow title={next
                ? 'The next fixture waiting in this board’s running order.'
                : 'This match is decided and nothing else is waiting in the running order.'}>
                {next ? 'UP NEXT' : 'DONE'}
            </Eyebrow>
            {next && <Text size="xs" dimmed className="min-w-0 flex-1 truncate">{next.label}</Text>}
            {next && canBind && <TakeNextButton sb={sb} label={next.label} primary={stale} />}
        </div>
    ) : null;

    /*
     * WHAT THE RIGHT-HAND END SAYS WHEN NO FIXTURE IS BOUND. All three of these
     * were full-width dashed BARS of their own — one of them ("NO MATCH") a bar
     * holding a single chip — under a game row that already ran the width of the
     * desk. They carry a chip's worth of content, so they ride the game's row.
     *
     * A ROTATING BOARD CANNOT HOLD A FIXTURE, and the tail says so instead of
     * offering a take the server would 409: a match encodes both sides of one
     * fixture, and a board cycling a pool has no fixed sides to project onto (the
     * same rule as `bind_scoreboard` / `take_next_match` on the server, and
     * ./boards `useMatchBindableBoards` is the one client statement of it). It
     * is tested AFTER `bound` on purpose — a board switched to rotate while
     * already holding a match still shows that match, because unbinding it is
     * exactly how a producer fixes that state.
     */
    let tail;
    if (bound) {
        tail = fixtureBody(true);
    } else if (!canBind) {
        // Two boards can say NO MATCH for different reasons, and the reason is the
        // whole content — so it is the eyebrow's own word, not a sentence after it.
        tail = (
            <Eyebrow title="A rotating board can’t hold a match: a match encodes both sides of one fixture, and a board cycling a pool has no fixed sides to project onto.">
                ROTATING
            </Eyebrow>
        );
    } else if (next) {
        tail = (
            <>
                <Eyebrow title="The next fixture waiting in this board’s running order.">UP NEXT</Eyebrow>
                {/* The ghost: dimmed because it is not on the board yet. */}
                <span className="min-w-0 shrink truncate text-xs text-muted-foreground">{next.label}</span>
                <TakeNextButton sb={sb} label={next.label} primary={stale} />
            </>
        );
    } else {
        tail = (
            <Eyebrow title="Nothing is waiting in this board’s running order. Author a fixture on the Match desk and it joins the order.">
                NO MATCH
            </Eyebrow>
        );
    }

    /*
     * THE TURNOVER PRESSES BELONG TO THE ROW THEY ACT ON. They were a bordered
     * strip of their own under the subject, which read as a button floating in
     * the panel with nothing attaching it to the board it clears — and the thing
     * it attaches to is right above it. Third group, third rule.
     */
    const actions = (
        <TurnoverActions
            sb={sb} lifecycle={lifecycle} matchId={matchId} match={match}
            onClear={d.resetGame} clearStaged={d.isStaged('reset')} postgame={postgame}
        />
    );

    // The box is the GAME's — it is the subject, and the fixture qualifies it.
    const box = cn(
        'min-w-0 rounded-md border px-2 py-1.5',
        d.g.name1 || d.g.name2
            ? 'border-border/60 bg-secondary/30'
            : 'border-dashed border-border/50',
    );

    if (bound && !agree) {
        return (
            <>
                <div className={cn(box, 'flex flex-wrap items-center gap-x-2 gap-y-1')}>
                    <div className="flex min-w-0 flex-1 basis-80 items-center gap-x-2">
                        <GameLine d={d} lifecycle={lifecycle} />
                    </div>
                    {actions}
                </div>
                <div
                    className={cn(
                        'min-w-0 rounded-md border px-2 py-1.5',
                        conflict
                            // Amber is what the console spends on "you would want
                            // to know before this is on air" — the same tone the
                            // conflict sentence below already uses, so the slot
                            // and its explanation match.
                            ? 'border-amber-500/50 bg-amber-500/5'
                            : 'border-border/60 bg-secondary/30',
                    )}
                >
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        {fixtureBody(false)}
                    </div>
                    {footer}
                </div>
            </>
        );
    }

    return (
        <div className={box}>
            {/* TWO GROUPS, NOT ONE RUN OF CELLS. The names are `flex-1` with
                `min-w-0`, so as bare siblings of the tail they would truncate to
                nothing rather than let the fixture wrap — the group's `basis`
                is what reserves the game a real width and sends the tail to its
                own line on a narrow panel, which is the old two-bar layout and
                the right thing to degrade to. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <div className="flex min-w-0 flex-1 basis-80 items-center gap-x-2">
                    <GameLine d={d} lifecycle={lifecycle} />
                </div>
                {/* The rule is the tail's own left border, so it travels with the
                    group when the row wraps instead of stranding a divider at the
                    end of the line above. */}
                <div className="flex min-w-0 shrink items-center gap-x-2 border-l border-border/60 pl-2">
                    {tail}
                </div>
                {actions}
            </div>
            {footer}
        </div>
    );
});

/*
 * THE TURNOVER BAR — the three presses at the end of a game, in press order.
 *
 * The state a producer is in every time they put the next fixture up, and the
 * one the console could not previously describe: a finished game keeps every key
 * a live one has, so the panel, the rack and the overlays all read as a game in
 * progress until something replaces it.
 *
 * IT FIRES AT EXACTLY THE RIGHT MOMENT AND USED TO CARRY ONE THIRD OF THE MOVE.
 * The real sequence is capture → clear → take next, and the panel had those three
 * in three places, in the wrong order: the take was buried inside the fixture slot
 * ABOVE, the capture was a region at the bottom, and only the clear was here. The
 * ordering was causally backwards too — capture is what advances the match to
 * `post` and credits the series (server/postgame.py), so the fixture slot printed
 * the consequence a screen above its cause.
 *
 * It never acts on its own. Clearing at the final out would strip the elements
 * drawing the game the instant it ends, which is the whole reason detection and
 * clearing are separate.
 *
 * The capture here is the ORDINARY one — the same call the post-game region makes
 * with no file. The file-picker hatch stays down there with the rest of the
 * recovery surface; this is the press a producer makes when nothing went wrong,
 * and it usually will not be needed at all, because the stat file fires the
 * capture on its own (postgame.auto_capture). When it has already happened this
 * says so and offers nothing — a receipt, not a second button.
 *
 * Clear is the panel's existing `resetGame`, not a second clear: it blanks the
 * live `score.{N}` keys AND the capture (`postgame.{N}`) — a capture is the
 * cleared game's receipt, and kept it went on driving the Game Summary beside a
 * board that no longer held the game (user call, 2026-09-18). The stat file is
 * still on disk; the post-game region's file picker brings it back.
 *
 * THE TAKE IS NOT GATED ON A DECIDED FIXTURE. It only ever lived in the fixture
 * slot behind `done`, which is the right gate for a Bo3 — you do not take the
 * next fixture between games of a series — and the wrong one for the Bo1 that
 * `default_match()` makes and almost every night is: the game ends, the match is
 * over in every sense that matters, and the producer's next press was hidden
 * behind a condition not yet met BECAUSE the capture that decides the series had
 * not been made. Here the gate is the game being over, which is the moment this
 * bar exists for.
 *
 * IT STANDS ITS TAKE DOWN FOR TWO DIFFERENT REASONS, and it only ever had one.
 *
 * A DECIDED fixture offers its own take, in the slot it is finishing in, and
 * holds it after the board is cleared — so a second one here would be two takes
 * on one panel.
 *
 * A fixture whose SERIES CAN STILL CONTINUE must not offer one at all. `decided`
 * alone was the gate, and a Bo3 between games is undecided — so the bar sat under
 * a live series offering to put the NEXT fixture on the board, one press away from
 * replacing a match that was 1–0 and still being played. The right question is
 * whether another game can follow under this same fixture, which is `bestOf` and
 * `decided` together.
 *
 * Keeping both halves ungated for the Bo1 is what the original note was about and
 * still holds: `default_match()` is `{bestOf: 1}`, the match is over in every
 * sense that matters the moment the game is, and gating on `decided` hid the
 * producer's next press behind the capture that sets it. A Bo1 therefore takes at
 * game end; a Bo3 waits for its series.
 */
/*
 * THE BAR SAYS NOTHING. IT IS THE PRESSES.
 *
 * It opened with a sentence, and the sentence went through two lives, each of
 * which was a duplicate of something already on screen a few pixels away.
 *
 * FIRST IT WAS THE CAPTURE — "Captured automatically." — a receipt for something
 * that had already happened, on the one strip a producer reads to find out what
 * to do NEXT, and the Post-game region below prints that receipt properly: the
 * AUTO badge, both names and the final score. Over a board carrying a game from
 * a previous session it was worse than redundant: the chip an inch above said
 * OLD, nothing had been captured this session at all, and the bar under it
 * talked about a stat file.
 *
 * SO IT BECAME THE CONDITION — "Left over from before PRSH started." — which is
 * the GameChip's own job, in the GameChip's own words, one row up (OLD, STALLED,
 * FINAL, each with the full sentence in its title). Three rows of this panel now
 * opened with the same two players and the third one opened with prose about
 * them, so the producer read the matchup three times to reach a button.
 *
 * Both lives had the same fault: this strip is the only place on the panel that
 * exists to be PRESSED, and everything it can say is said better by the surface
 * that owns the fact. What is left is the verbs, at their natural width — a
 * group of presses rather than a full-width banner — and the chip above carries
 * the condition it always did.
 */
const TurnoverActions = memo(function TurnoverActions({
    sb, lifecycle, matchId, match, onClear, clearStaged, postgame,
}) {
    const next = useNextUp(sb);
    const canBind = useMatchBindableBoards()(sb);
    /*
     * THE TURNOVER PRESSES ARE THE END OF A GAME'S; THE CLEAR IS EVERY BOARD'S.
     * This whole group used to return null off `isStaleBoard`, with a second
     * `Clear game` down in the game-state region covering the other times — so
     * there was always exactly one clear on the panel and it was in a DIFFERENT
     * PLACE depending on the board's lifecycle. What a producer saw was the
     * button moving: press Clear here, the board empties, and the clear they
     * just used is now at the bottom of the panel.
     *
     * One press, one place. Capture and the take stay gated — you do not hand a
     * board on or capture a stat file mid-game — but the clear is the verb a
     * board always owes, so it renders here always and the region's copy is gone.
     */
    const atTurnover = isStaleBoard(lifecycle);

    const decided = num(match?.decided, 0) === 1 || num(match?.decided, 0) === 2;
    /*
     * Can another game follow under this same fixture? `bestOf > 1 && !decided`
     * answered it while every multi-game format was ODD — somebody always
     * clinches, so `decided` is the end. A DOUBLEHEADER is the one format that
     * can be COMPLETE AND UNDECIDED (1-1 is a split and nobody takes it), which
     * left alone would stand the take down all night on a fixture with no games
     * left to play. Counting the games the format holds answers both, and lives
     * in ../../../../public/layout/lib/match-format.js because the overlay
     * runtime asks the same question of the same field.
     */
    const stillToPlay = seriesContinues(
        match?.bestOf, match?.series?.[1], match?.series?.[2], decided,
    );

    const { pg, stale, busy, capture } = postgame;
    // A capture from an EARLIER game is not this game's receipt (./postgame
    // reads the capture's own gameId to tell them apart), so the bar still
    // offers the press.
    const captured = pg.present && !stale;
    const bound = matchId != null && matchId !== '';

    /*
     * OUT OF GAMES, which is not the same as WON — a doubleheader is complete
     * after two games however they fall, so a 1-1 split is finished and unwon.
     * Every "is this fixture done with the board" question below asks this, not
     * `decided`, or a split would strand the panel: no handover offered, and a
     * clear that leaves the finished fixture bound for the projector to repaint.
     */
    const complete = bound && matchComplete(
        match?.bestOf, match?.series?.[1], match?.series?.[2], match?.decided,
    );

    /*
     * ONLY A GAME THAT REACHED ITS END HAS A RESULT TO CAPTURE, which is what the
     * chip above already says in its own words. A STALLED game has none — its
     * score is a frozen mid-game frame — and a RESTORED one's belongs to a
     * previous session, where the recovery is the file picker in the post-game
     * region and not a button in the middle of tonight's turnover. Offering it on
     * all three is how the cold-start bar ended up talking about stat files.
     */
    const offerCapture = lifecycle === 'final' && !captured;

    /*
     * THE ONE FILLED PRESS IS THE FORWARD MOVE, and which move that is depends on
     * whether there is a fixture to go up. Taking one CLEARS THE BOARD ON ITS WAY
     * (bind_board's `_clear_superseded_game`), so a producer with a match waiting
     * never has to tidy first — which is the reassurance the bar can only give by
     * putting the take in front and standing the clear down to a ghost beside it.
     * With nothing waiting, clearing IS the forward move and takes the fill.
     *
     * Everything else on the bar is ghost. A strip where three buttons are equally
     * loud is a strip that has not answered the question.
     */
    const takeable = atTurnover && Boolean(next) && canBind && bound && !complete && !stillToPlay;

    /*
     * Is a take on the panel AT ALL? The fixture slot above carries one for an
     * unbound board (the UP NEXT ghost) and for a decided fixture, and the clear
     * must stand down to a ghost beside either of those exactly as it does beside
     * this bar's own — or the cold start shows a filled Clear and a filled take
     * and asks the producer which is the next thing to do.
     */
    const slotTake = atTurnover && Boolean(next) && canBind && (!bound || complete);

    /*
     * DOES THE CLEAR TAKE THE FIXTURE WITH IT?
     *
     * Only when the fixture is DONE with this board. A decided fixture has no
     * further game to put here, so leaving it bound only means the projector
     * repaints its two names the instant the game keys are blanked — which is
     * exactly what happened, and is the console's most baffling outcome: press the
     * button that empties a board, watch the board refill with last night's
     * finished matchup at 0-0. The way out was two presses on two different rows,
     * with nothing saying so.
     *
     * A fixture that can still continue keeps its binding, which is the whole
     * reason this endpoint re-projects at all: a Bo3 between games, or a Bo1 whose
     * capture has not landed yet, must keep its match on the board.
     *
     * TWO NAMES, BECAUSE THEY ARE TWO DIFFERENT ACTS. One label that sometimes
     * unbinds is the worse trade — the producer cannot tell from the button what
     * their board will be holding afterwards, which is the only thing they are
     * asking it.
     */
    const releaseMatch = complete;

    return (
        // A GROUP ON THE SUBJECT'S ROW, not a strip of its own. Once the prose
        // came off it, a bordered full-width bar holding one button read as a
        // press floating under the panel with nothing to attach it to — and what
        // it attaches to is the row above, which is the board it acts on. Its
        // rule is on its left, the same idiom as the fixture tail beside it.
        <div className="flex min-w-0 shrink-0 items-center gap-x-2 border-l border-border/60 pl-2">
            {offerCapture && (
                <SimpleTooltip label="Read this game’s stat file — it advances the match to post-game and credits the series">
                    <Button
                        variant="ghost" size="xs" className="h-7 shrink-0"
                        onClick={() => capture()} disabled={busy}
                    >
                        Capture
                    </Button>
                </SimpleTooltip>
            )}
            <SimpleTooltip label={releaseMatch
                ? `Blank this board and take M${matchId} off it. The captured box score stays — the post-game region has its own Clear.`
                : 'Blank this board’s game. The match stays bound, and its next game projects onto it.'}
            >
                <Button
                    variant={takeable || slotTake ? 'ghost' : 'default'}
                    size="xs"
                    onClick={() => onClear(releaseMatch)}
                    className={cn(
                        'h-7 shrink-0',
                        clearStaged && (takeable || slotTake
                            ? 'text-amber-400' : 'ring-1 ring-amber-400'),
                    )}
                >
                    {clearStaged
                        ? 'Clear staged'
                        : (releaseMatch ? `Clear & unbind M${matchId}` : 'Clear game')}
                </Button>
            </SimpleTooltip>
            {/* WHY NOTHING IS BEING OFFERED, in the place the take would be — a
                bar that simply omits its third button leaves the producer looking
                for it. A badge, not the sentence it was ("… — same match stays
                up"), for the same reason the rest of this strip lost its prose:
                which game of the series this is IS the answer, and the fixture
                slot above already holds the series score it belongs to. */}
            {atTurnover && stillToPlay && (
                <SlotChip title="This match isn’t decided — its next game projects onto this board, so there is nothing to take yet">
                    GAME {num(match?.series?.[1], 0) + num(match?.series?.[2], 0) + 1}
                    {' '}OF {num(match?.bestOf, 1)}
                </SlotChip>
            )}
            {takeable && <TakeNextButton sb={sb} label={next.label} primary />}
        </div>
    );
});
