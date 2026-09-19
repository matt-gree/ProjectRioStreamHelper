import { memo, useState } from 'react';
import { ArrowLeftRight, ChevronRight, Trash2, Trophy } from 'lucide-react';
import {
    updateMatch, deleteMatch, bindScoreboard, loadStartGGSet, flipMatch, decideMatch,
} from '../../../context/match';
import { stageOrRun, usePending } from '../../../context/staging';
import StartggSetPicker from '../../../components/StartggSetPicker';
import { Stack, Group, Text } from '../../../components/ui/primitives';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { cn } from '../../../lib/utils';
import { gamesToWin, matchComplete } from '../../../../public/layout/lib/match-format.js';
import { GameStageChip, FieldRow, KitColumn, KitColumns } from '../kit';
import { StagedDot, MoveButtons } from '../controls';
import { useBoardLifecycle } from '../board/boards';
import { useSideLabels } from '../sides';
import { useNextInOrder, useWaitingReason } from './queue';
import { moveQueuedMatch } from '../../../context/schedule';
import { QUIET_FIELD, failed, useMatchDraft } from './draft';
import { GameModeSelect } from './pickers';
import { DraftSide, FormatField } from './fields';
import { MembershipControl, StageControl } from './stage';

// One fixture's row on the desk: the header bar (sides, result, board) and the
// authoring body it opens onto.

/*
 * THE HEADER WEARS ITS BADGE'S COLOUR. A stack of fixtures is
 * scanned for state before it is read for names, and a 10px chip at the far end
 * of each row made that scan a hunt; the row itself carries the hue now, so a
 * night reads as a column of colours. Keyed by the ONE badge a row shows —
 * decided and split outrank the stage exactly as they replace its badge — so the
 * tint and the chip cannot disagree. The chip carries the same /15 over it, so it
 * still reads a step louder, as the thing to press.
 */
const HEADER_TINT = {
    draft:   'bg-[#a855f7]/15',
    live:    'bg-emerald-500/15',
    post:    'bg-[#64748b]/15',
    decided: 'bg-emerald-500/15',
    split:   'bg-secondary',
};

// Human name for a side in the collapsed summary, falling back to a muted dash.
function sideName(match, side) {
    const p = match?.player?.[side] ?? match?.player?.[String(side)] ?? {};
    return p.rioName || '';
}

/*
 * TWO DIFFERENT FACTS, and the difference is what the Decide and Reopen verbs
 * act on.
 *
 * `decidedSide` is the match's own `decided` flag — a RECORD, written by the
 * server's award arithmetic when a side reaches the win count, or forced by the
 * producer. It is what auto-retire and the overlays read.
 *
 * `clinchedSide` is arithmetic on the live series against the Bo need — a
 * DERIVED "someone is at the number". Normally the two agree, because crediting
 * a game sets the flag. They come apart when the producer corrects the series by
 * hand with the steppers: the count says 2–0 of Bo3 and the flag says nothing.
 *
 * These used to be one function, so the header badged "Side N wins" off either —
 * claiming a series the server had not recorded, with no way to tell which state
 * you were in and therefore no way to offer the verb that fixes it.
 */
export function decidedSide(match) {
    const d = match?.decided;
    if (d === 1 || d === '1') return 1;
    if (d === 2 || d === '2') return 2;
    return null;
}

function clinchedSide(bestOf, w1, w2) {
    const need = gamesToWin(bestOf);
    return w1 >= need ? 1 : w2 >= need ? 2 : null;
}

// One match, rendered as a collapsible accordion inside the Match card.
// Collapsed: a one-line summary — "A vs B · Bo3 · 1–0 · ‹stage›" (no side
// numbers; position is the identity). Expanded: the full condensed editor —
// start.gg + phase, the two sides (participant + captain grid), then mode / Bo /
// series / board binds. Every broadcast-visible edit routes through the staging
// gateway; New / Next game / Delete are momentary. Deletable via the header
// trash (a two-step Popover confirm, no blocking browser dialog).
export const MatchAccordion = memo(function MatchAccordion({
    m, open, onToggle, active, boundMap, gameModes, canBind, queuePos, queueLen,
    queues, queueOf,
}) {
    const draft = useMatchDraft(m);
    const stage = draft.match?.stage || 'draft';
    const waitReason = useWaitingReason(m);
    // Waiting is per fixture; NEXT is a property of the order it sits in, so the
    // stage popover cannot claim it from `waitReason` alone.
    const nextInOrder = useNextInOrder(queueOf);
    const [confirmDel, setConfirmDel] = useState(false);
    const sides = useSideLabels();

    /*
     * THE SERIES THIS ROW IS READING, STAGED VALUES INCLUDED. `draft.val` is how
     * every other control on the desk reads a field mid-edit, and the series
     * verbs were the ones that skipped it: the stepper in the body writes into
     * the staging buffer while the clinch arithmetic up here read live state, so
     * under confirm mode bumping a side to the win count turned the score amber
     * and offered no Decide at all until the bump was committed — two commits for
     * one intent, with the button invisible in between. Two halves of one row
     * must not disagree about which series they are looking at.
     */
    const bestOf = draft.val('format.bestOf', (draft.match?.format || {}).bestOf ?? 1);
    const w1 = Number(draft.val('series.1', draft.match?.series?.[1] ?? draft.match?.series?.['1'] ?? 0)) || 0;
    const w2 = Number(draft.val('series.2', draft.match?.series?.[2] ?? draft.match?.series?.['2'] ?? 0)) || 0;
    const decided = decidedSide(draft.match);
    // Only interesting where it DISAGREES with the record: someone is at the win
    // count and nothing has recorded it, which is the producer's cue to decide.
    const clinched = decided ? null : clinchedSide(bestOf, w1, w2);
    /*
     * OUT OF GAMES WITH NOBODY AT THE WIN COUNT — the doubleheader split, which is
     * a COMPLETE fixture rather than a stuck one. A DH is complete after two games
     * however they fall, so 1-1 is finished and simply has no winner, and the desk
     * offers NO VERB TO INVENT ONE: the badge states it, everything that moves a
     * fixture on stands down beside it, and there is nothing left to decide. The
     * only correction is to the series itself, on the steppers.
     */
    const split = !decided && !clinched && matchComplete(bestOf, w1, w2, null);

    const onPickSet = (s) => stageOrRun({
        key: `match:${m}:startgg`,
        label: `Load set: ${s.p1_name || 'TBD'} vs ${s.p2_name || 'TBD'}`,
        value: s.id,
        run: () => loadStartGGSet(Number(m), s.id),
    });
    const onNextGame = () => {
        updateMatch(Number(m), { stage: 'draft' })
            .catch(failed('Next game'));
    };
    /*
     * Flip the AUTHORED sides — the fixture was written down the wrong way round.
     * Distinct from a board's Swap sides, which flips one live game's orientation:
     * this rewrites the record, and the series wins travel with the player
     * (server flip_match), so a 2–0 does not silently become an 0–2.
     *
     * Broadcast-visible (it re-projects onto the bound board), so it stages. No
     * `liveValue` pair to collapse against — a flip is its own inverse, and
     * staging it twice is the producer asking for two flips, which the pending bar
     * shows as one entry they can discard.
     */
    const onFlip = () => stageOrRun({
        key: `match:${m}:flip`,
        label: `Match ${m}: flip sides`,
        value: true,
        run: () => flipMatch(Number(m)),
    });
    /*
     * The series record. `side` forces decided, null reopens.
     *
     * `liveValue` is the current flag, so deciding a match that is already decided
     * for that side drops out of the buffer, and staging Reopen then Decide leaves
     * nothing pending — the same toggle-twice rule every other staged control
     * follows.
     */
    const onDecide = (side) => stageOrRun({
        key: `match:${m}:decide`,
        label: side ? `Match ${m}: Side ${side} wins the series` : `Match ${m}: reopen the series`,
        value: side,
        liveValue: decided,
        run: () => decideMatch(Number(m), side),
    });
    const onDelete = () => {
        setConfirmDel(false);
        deleteMatch(Number(m))
            .catch(failed('Delete match'));
    };
    /*
     * Board binding is radio-style: a match fills exactly one board. Clicking the
     * board it already holds clears it; clicking any other board MOVES it there.
     *
     * The move is ONE call. This used to loop the active boards unbinding the
     * siblings first, which put a data invariant in a click handler: under confirm
     * mode each unbind was a separately discardable staged entry, so committing
     * the bind without one of them left a match on two boards. `bind_scoreboard`
     * vacates the old holder itself now (server/api/v1/match.py), which is also
     * how every other caller inherits the rule.
     */
    const selectBoard = (sb) => {
        if (!canBind(sb)) return;
        const held = String(boundMap[sb]) === String(m);
        stageOrRun({
            key: `bind:${sb}`,
            label: held ? `Unbind board ${sb}` : `Bind board ${sb} → match ${m}`,
            value: held ? null : Number(m),
            liveValue: boundMap[sb] != null ? Number(boundMap[sb]) : null,
            run: () => bindScoreboard(sb, held ? null : Number(m)),
        });
    };

    const roundLabel = draft.val('label', draft.match?.label || '');
    const compPhase = draft.val('phase', draft.match?.phase || '');
    const gameMode = draft.val('gameMode', draft.match?.gameMode || '');
    const n1 = sideName(draft.match, 1);
    const n2 = sideName(draft.match, 2);
    // The collapsed line's fixture tail — what tells two matches between the
    // same two players apart. Round/phase/mode are all optional, so only the
    // ones that are set appear and a bare fixture collapses to just the names
    // rather than to a row of orphaned separators.
    const fixtureBits = [roundLabel, compPhase, gameMode].filter(Boolean);

    return (
        /* Open vs collapsed used to look identical, so a stack of matches gave
           no answer to "which one am I editing". The open match is the desk's
           subject: it keeps the card surface and takes a red edge — the same
           rio red the rack uses to mark the desk tier, reused as a
           you-are-here marker rather than a new colour. Collapsed peers drop
           to a hairline and step back. */
        <div className={cn(
            'overflow-hidden rounded-md border transition-colors',
            open
                ? 'border-border border-l-2 border-l-rio-500/70 bg-card'
                : 'border-border/50 hover:border-border',
        )}>
            {/* The header changes job with the disclosure, because its content
                does. COLLAPSED it is the record's identity, and identity is
                who is playing plus which fixture this is — names, then round ·
                phase · mode. OPEN, the body restates all of that inches below
                at three times the size, so the bar becomes a title bar: the
                match id (the M in `score.{N}.match = M`, which the body never
                shows), the stage, and the record-level actions. Given a job of
                its own it can also afford a real surface.

                Neither state carries format or series score. Bo and the running
                score are settings a producer configures once in the body, not
                facts they scan a stack of records for, and `0–0` on every row
                paid nothing for the width. `decided` still badges — a clinched
                set is a state worth interrupting for, unlike a live 0–0. */}
            <div className={cn(
                'flex items-center gap-2 px-2 py-1.5',
                HEADER_TINT[decided ? 'decided' : split ? 'split' : stage] || HEADER_TINT.draft,
                open && 'border-b border-border',
            )}>
                {/* THE POSITION IN THE RUNNING ORDER, and the two verbs that
                    change it — at the head of the row, because that is what the
                    number is: this row's place in the list it is sitting in. The
                    stack is ordered by the queue, so moving a match here moves it
                    on the schedule overlay and changes which fixture a board's Up
                    next offers, and all three are one fact rather than three
                    surfaces to keep in agreement.

                    Visible at rest, not hover-revealed. Reordering is a
                    scan-the-whole-list task — arrows that appear one row at a time
                    under the pointer cannot be scanned, and the last control this
                    console hid on hover (a board's Remove) is in the skill as the
                    mistake not to repeat. */}
                {queuePos != null && (
                    /* The group carries the name, because the digit on its own
                       has none — "1" beside two arrows tells a screen reader
                       nothing, and `role="group"` is what lets the number be read
                       as this row's place rather than as loose content. */
                    <div
                        role="group"
                        aria-label={`Match ${m}: position ${queuePos} of ${queueLen} in the running order`}
                        className="flex shrink-0 items-center gap-1"
                    >
                        <MoveButtons
                            label={`match ${m} in the running order`}
                            canUp={queuePos > 1} canDown={queuePos < queueLen}
                            onUp={() => moveQueuedMatch(m, -1).catch(failed('Running order'))}
                            onDown={() => moveQueuedMatch(m, 1).catch(failed('Running order'))}
                        />
                        <span aria-hidden="true" className="w-4 text-center text-[11px] tabular-nums text-muted-foreground">
                            {queuePos}
                        </span>
                    </div>
                )}
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                    <ChevronRight
                        size={14}
                        className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
                    />
                    {open ? (
                        <span className="label-display min-w-0 truncate text-sm text-foreground">
                            Match {m}
                        </span>
                    ) : (
                        <span className="flex min-w-0 items-center gap-x-1.5 text-sm">
                            {/* Same words as the open title bar, a tier down:
                                the row's identity shouldn't rename itself on
                                toggle just to save four characters. */}
                            <span className="label-display shrink-0 text-xs text-muted-foreground/70">Match {m}</span>
                            <span className="shrink-0 truncate text-foreground/80">
                                {n1 || <span className="text-muted-foreground">TBD</span>}
                                <span className="mx-1.5 text-muted-foreground">vs</span>
                                {n2 || <span className="text-muted-foreground">TBD</span>}
                            </span>
                            {fixtureBits.length > 0 && (
                                <>
                                    <span className="shrink-0 text-muted-foreground">·</span>
                                    {/* The tail truncates first: names identify
                                        the match, the fixture only qualifies it. */}
                                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                                        {fixtureBits.join(' · ')}
                                    </span>
                                </>
                            )}
                        </span>
                    )}
                </button>
                {decided && (
                    <Badge className="shrink-0 bg-emerald-500/15 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                        {sides.label(decided)} wins
                    </Badge>
                )}
                {/* THE SAME WORD THE BOARD USES, on the same fact. A split is
                    finished and unwon, so it gets neither the emerald fill (there
                    is no winner to celebrate) nor `DECIDED` (there is no winner to
                    name) — and without a badge of its own the row was a finished
                    fixture wearing a draft's face. */}
                {split && (
                    <SimpleTooltip label={`Both games played and the doubleheader is split ${w1}–${w2} — nobody took it`}>
                        <Badge className="shrink-0 bg-secondary text-[10px] font-semibold uppercase tracking-wider text-foreground">
                            Split
                        </Badge>
                    </SimpleTooltip>
                )}
                {/* A DECIDED FIXTURE HAS NO STAGE QUESTION, so it no longer
                    carries the badge that answers one. The control exists to say
                    why a fixture is not coming up; on a finished one the answer is
                    "because it is finished", which the emerald badge to its left
                    has just said in the producer's words rather than the state
                    key's. Worse, the popover's one verb is "Ready next game",
                    which on a decided match writes `stage = draft` and changes
                    nothing about whether it is offered — a button that looks like
                    the way out of a state it cannot leave. `POST` beside
                    `SIDE 1 WINS` was two chips for one fact, one of them in app
                    vocabulary. Reopen is the only move a finished fixture has, and
                    it is now the only one shown. */}
                {!decided && !split && (
                    <StageControl
                        m={m}
                        stage={stage}
                        reason={waitReason}
                        queued={queuePos != null}
                        first={nextInOrder === String(m)}
                    />
                )}
                {/* THE SERIES VERB, next to the badge that states the series. At
                    most one of the two ever shows, because they answer opposite
                    states of one fact: a decided match can be reopened, and a
                    match sitting on the win count with nothing recorded can be
                    decided. The second case only arises from the steppers, which
                    is exactly why the panel that has the steppers needs the verb.

                    Both stage — deciding re-projects the series onto the bound
                    board, and a producer correcting a miscredit mid-game should not
                    have it hit air before they confirm. */}
                {decided ? (
                    <Button
                        size="xs" variant="ghost" onClick={() => onDecide(null)}
                        className="shrink-0 text-muted-foreground"
                        title="Correction: undo the recorded series winner. Not a lifecycle move — it does not start another game."
                    >
                        Reopen
                        <StagedDot show={draft.isStaged('decide')} />
                    </Button>
                ) : clinched ? (
                    <Button
                        size="xs" variant="secondary" onClick={() => onDecide(clinched)}
                        className="shrink-0"
                        title={`Record ${sides.label(clinched)} as the series winner`}
                    >
                        Decide: {sides.label(clinched)}
                        <StagedDot show={draft.isStaged('decide')} />
                    </Button>
                ) : null}
                {/* NEXT GAME IS PART OF THE PAIR RULE ABOVE, and was left out of
                    it. It showed at ANY `post`, decided included — so a finished
                    Bo1 offered "Reopen" and "Next game" side by side, two verbs
                    that move the fixture backwards in different ways, with nothing
                    saying which. A decided series has no next game; the only thing
                    to offer there is the correction.

                    It re-arms THIS fixture (stage → draft) rather than creating
                    anything, which is why the label says so: "Next game" alone read
                    as though a game would appear somewhere, and the honest answer
                    to "where does it go?" is nowhere — the same match goes back to
                    being offerable. */}
                {stage === 'post' && !decided && !split && (
                    <SimpleTooltip label="Put this match back in play for its next game — nothing is created, the series score is kept">
                        <Button size="xs" variant="secondary" onClick={onNextGame} className="shrink-0">
                            Ready next game
                        </Button>
                    </SimpleTooltip>
                )}
                {/* Flip is icon-only and lives with the record actions rather than
                    on the two side fields it swaps. The sides grid puts its spine
                    behind an @lg breakpoint, so a control mounted there would
                    vanish on a narrow panel — and the feedback for a flip is the
                    collapsed row's own "A vs B", which is right here. */}
                {/* MEMBERSHIP, beside the record's other actions — whether this
                    fixture is part of tonight at all, which is a property of the
                    record and not of its position. A new match arrives enrolled
                    (create_match appends it), so this is normally the way OUT: a
                    placeholder, or a fixture kept for reference, that should not
                    show on the schedule overlay or be offered to a board. */}
                <MembershipControl m={m} queues={queues} queueOf={queueOf} />
                <SimpleTooltip label="Flip the sides — series wins follow the player">
                    <button
                        type="button"
                        onClick={onFlip}
                        aria-label={`Flip sides on match ${m}`}
                        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                        <ArrowLeftRight size={14} />
                        <StagedDot show={draft.isStaged('flip')} />
                    </button>
                </SimpleTooltip>
                {/* A VERB'S PROMINENCE TRACKS WHETHER IT IS THE EXPECTED NEXT
                    STEP. On a finished fixture, removing it is most of what is
                    left to do — and it was an anonymous 14px trash glyph, the
                    same weight as flip and membership, on a desk whose New match
                    and Clear played had just been made unmissable. So a decided
                    row gets the labelled button and every other row keeps the
                    icon, because deleting a fixture that has not been played is a
                    rare correction rather than the shape of the night.

                    `secondary`, never `default`: the night strip's bulk clear is
                    the panel's one filled press, and eight filled red rows under
                    it would be a wall of alarm that teaches a producer to stop
                    reading them.

                    IT DOES NOT MOVE. Position is stable across both faces — a
                    control that relocates when its record changes state is its
                    own confusion, and the far right is where this console already
                    puts destroy. */}
                <Popover open={confirmDel} onOpenChange={setConfirmDel}>
                    <PopoverTrigger asChild>
                        {decided ? (
                            <Button
                                size="xs" variant="secondary" className="h-7 shrink-0"
                                aria-label={`Clear match ${m}`}
                            >
                                <Trash2 size={13} className="mr-1" /> Clear
                            </Button>
                        ) : (
                            <button
                                type="button"
                                aria-label={`Clear match ${m}`}
                                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            >
                                <Trash2 size={14} />
                            </button>
                        )}
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-60">
                        <Stack gap="xs">
                            <Text size="sm" className="text-foreground">Clear this match?</Text>
                            {/* "Deletes" in the body keeps the permanence honest
                                while the VERB stays the one word this desk uses
                                for removing a fixture. */}
                            <Text size="xs" className="text-muted-foreground">
                                Deletes the fixture. Unbinds and blanks any board it fills.
                            </Text>
                            <Group gap="xs" className="justify-end">
                                <Button size="xs" variant="ghost" onClick={() => setConfirmDel(false)}>Cancel</Button>
                                <Button size="xs" variant="destructive" onClick={onDelete}>Clear</Button>
                            </Group>
                        </Stack>
                    </PopoverContent>
                </Popover>
            </div>

            {open && (
                /* Two labelled regions, so the panel answers "what does this
                   area do" before the producer reads a single control. Who is
                   playing (and the running score) on the left, where it gets
                   its width; what the match IS — round, phase, mode, board —
                   on the right. One column on a narrow panel. */
                <div className="@container border-t border-border p-2.5">
                    {/* 7/4 rather than 3/2: the sides hold two intrinsically
                        sized boards that cannot shrink, so they need the width
                        budgeted to them, where the Fixture column is all
                        flexible fields that absorb whatever is left. */}
                    <KitColumns template="minmax(0,7fr) minmax(0,4fr)">
                        {/* The sides need two rows; the fixture needs four. The
                            board bind fills what's left rather than spanning
                            under a hole, which bottom-aligns the two columns. */}
                        <div className="flex min-w-0 flex-col gap-3">
                            {/* No region eyebrow. "Who's playing" over two
                                40px names split by a vs spine names what the
                                layout already says out loud — and stacking it
                                above the two side headings gave this region
                                three label lines to Fixture's one, which is
                                most of what read as clutter at the top of the
                                panel. The side headings serve as the region's
                                label line instead. Fixture keeps its eyebrow:
                                its contents are heterogeneous and it hosts the
                                start.gg action on that same line. */}
                            <KitColumn>
                                {/* The two sides used to sit in a plain 2-up
                                    grid separated by whitespace, which read as
                                    six independent fields rather than one
                                    matchup. The spine is the axis they mirror
                                    across, not a divider between peers — it
                                    states the versus relationship the collapsed
                                    header states in words, so the eye lands on
                                    "A vs B" before it parses any control. It
                                    collapses away with the columns. */}
                                <div className="grid grid-cols-1 gap-x-3 gap-y-4 @lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                                    <DraftSide m={m} side={1} draft={draft} />
                                    {/* pt-6 clears the side headings exactly, so
                                        the spine spans only the controls. The
                                        `vs` is pinned near the top rather than
                                        centred in the column: it belongs beside
                                        the two names it joins, and centring it
                                        would drift down the taller the captain
                                        grids make the sides. */}
                                    <div className="hidden self-stretch flex-col items-center gap-1.5 pt-6 @lg:flex">
                                        <span className="h-5 w-px bg-border/60" />
                                        <Text span className="label-display text-[10px] text-muted-foreground/70">vs</Text>
                                        <span className="w-px flex-1 bg-border/60" />
                                    </div>
                                    <DraftSide m={m} side={2} draft={draft} />
                                </div>
                            </KitColumn>

                            {/* Binding is the action that puts this fixture on
                                air, so it reads as a labelled field like the
                                ones opposite rather than a floating cluster of
                                buttons — the chips each say "Board", but none
                                of them said what picking one DOES. The label
                                supplies the grouping the hairline was doing.

                                It no longer bottom-aligns (`mt-auto`): that was
                                buying a level bottom edge with a hole above it
                                once the sides got shorter, and a ragged bottom
                                in a two-column panel reads as normal where a
                                void reads as broken. */}
                            <FieldRow stacked label="On board">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {active.map(sb => (
                                        <BindChip
                                            key={sb} sb={sb}
                                            bound={String(boundMap[sb]) === String(m)}
                                            elsewhere={boundMap[sb] != null && String(boundMap[sb]) !== String(m)}
                                            rotating={!canBind(sb)}
                                            radio
                                            onClick={() => selectBoard(sb)}
                                        />
                                    ))}
                                </div>
                            </FieldRow>
                        </div>

                        {/* Round + competition phase both project to the
                            lower-third's auto metadata line; a start.gg set
                            fills both, and these let the producer see and
                            override what it loaded. Loading a set fills this
                            whole column rather than being one more field in it,
                            so it rides the column header. */}
                        <KitColumn
                            label="Match"
                            // The one rule in the body, marking the one real
                            // boundary: two regions, not two peer groups.
                            className="@2xl:border-l @2xl:border-border/60 @2xl:pl-6"
                            action={(
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button size="xs" variant="secondary">
                                            <Trophy size={13} className="mr-1" /> Load a set…
                                            <StagedDot show={draft.isStaged('startgg')} />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent align="end" className="w-96">
                                        <StartggSetPicker onPick={onPickSet} pickLabel="Use" />
                                    </PopoverContent>
                                </Popover>
                            )}
                        >
                            {/* Round and Phase hold a handful of characters
                                each — pairing them stops two short values
                                claiming a full panel width apiece. */}
                            <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 @lg:grid-cols-2">
                                <FieldRow stacked label="Round" staged={draft.isStaged('label')}>
                                    <input
                                        type="text"
                                        aria-label="Round"
                                        value={roundLabel}
                                        onChange={(e) => draft.setField('label', e.target.value,
                                            `Match ${m}: round ${e.target.value || 'cleared'}`)}
                                        placeholder="e.g. Winners R2"
                                        className={cn(QUIET_FIELD, 'min-w-0 flex-1')}
                                    />
                                </FieldRow>
                                <FieldRow stacked label="Phase" staged={draft.isStaged('phase')}>
                                    <input
                                        type="text"
                                        aria-label="Competition phase"
                                        value={compPhase}
                                        onChange={(e) => draft.setField('phase', e.target.value,
                                            `Match ${m}: phase ${e.target.value || 'cleared'}`)}
                                        placeholder="e.g. Top Cut"
                                        className={cn(QUIET_FIELD, 'min-w-0 flex-1')}
                                    />
                                </FieldRow>
                            </div>
                            {/* Mode names can run long (a full tournament tag),
                                so it takes the row rather than sharing it. */}
                            <FieldRow stacked label="Mode" staged={draft.isStaged('gameMode')}>
                                <GameModeSelect
                                    value={gameMode || ''}
                                    modes={gameModes}
                                    onChange={(v) => draft.setField('gameMode', v,
                                        `Match ${m}: mode ${v || 'cleared'}`)}
                                    className={cn(QUIET_FIELD, 'min-w-0 flex-1')}
                                />
                            </FieldRow>
                            <FieldRow stacked label="Format">
                                <FormatField m={m} draft={draft} bestOf={bestOf} />
                            </FieldRow>
                        </KitColumn>
                    </KitColumns>
                </div>
            )}
        </div>
    );
});

/*
 * A board-bind chip, staged-aware (amber ring while the bind is pending). With
 * `radio`, it carries a radio dot (filled when this match holds the board) to
 * signal single-select — a match fills exactly one board. `elsewhere` = the
 * board is currently bound to a DIFFERENT match; the chip reads as a dashed
 * "steal it" affordance.
 *
 * `rotating` = the board is cycling a pool, so it has no fixed sides for a
 * fixture to project onto and the server would reject the bind. The chip goes
 * inert and says why, rather than letting the producer click into a 409 —
 * an unavailable option should look unavailable.
 */
const BindChip = memo(function BindChip({
    sb, bound, elsewhere = false, rotating = false, radio = false, onClick,
}) {
    const pending = usePending(`bind:${sb}`);
    const displayBound = pending ? pending.value != null : bound;
    const lifecycle = useBoardLifecycle(sb);
    /*
     * The bound chip's tip is the RETIRE affordance. The Match tab's panel had a
     * separate Retire button, because it unbound every board bound to this match
     * and there could be several. A match holds exactly one board now, so
     * retiring is unbinding the one chip that is lit — and the only thing missing
     * was a chip that said so.
     */
    const tip = rotating
        ? `Board ${sb} is rotating a pool — a match needs a single-game board`
        : displayBound
            ? `On board ${sb} — click to take it off and hand the board back to its feed`
            : elsewhere
                ? `Bound to another match — click to move board ${sb} here`
                : undefined;
    return (
        <SimpleTooltip label={tip}>
            <Button
                size="xs"
                variant={displayBound ? 'default' : 'outline'}
                onClick={onClick}
                // aria-disabled, not disabled: a disabled button emits no
                // pointer events, so the tooltip saying WHY it can't be picked
                // would never open. The click is guarded in selectBoard.
                aria-disabled={rotating || undefined}
                role={radio ? 'radio' : undefined}
                aria-checked={radio ? displayBound : undefined}
                className={cn(
                    'gap-1.5',
                    pending && 'ring-1 ring-amber-400',
                    !displayBound && elsewhere && 'border-dashed text-muted-foreground',
                    rotating && 'cursor-not-allowed opacity-40',
                )}
            >
                {radio && (
                    <span className={cn(
                        'inline-flex size-3 shrink-0 items-center justify-center rounded-full border',
                        displayBound ? 'border-current' : 'border-muted-foreground/60',
                    )}>
                        {displayBound && <span className="size-1.5 rounded-full bg-current" />}
                    </span>
                )}
                Board {sb}
                {/* WHERE THAT BOARD'S GAME IS UP TO, on the chip that says the
                    fixture is on it. The desk could say a match was on board 1 and
                    nothing about whether board 1's game was live, finished or gone
                    — so "is this match done with the board?" meant leaving the desk
                    to find out. Only on the LIT chip: the other boards' games are
                    not this fixture's business, and a row of lifecycles would be
                    the rack's job done badly. */}
                {displayBound && <GameStageChip lifecycle={lifecycle} />}
            </Button>
        </SimpleTooltip>
    );
});
