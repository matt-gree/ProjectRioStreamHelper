import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Info, RotateCw, SkipForward, Unlink } from 'lucide-react';
import { useStateStore, useSettingsStore } from '../../../context/store';
import { useSocketSubscribe } from '../../../context/socket';
import { useStagingStore, stageOrRun, usePending } from '../../../context/staging';
import ParticipantPicker from '../../../components/ParticipantPicker';
import { Stack, Text, Divider, Loader } from '../../../components/ui/primitives';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Combobox } from '../../../components/ui/combobox';
import { NumberInput } from '../../../components/ui/number-input';
import { SimpleSelect } from '../../../components/ui/simple-select';
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { notifications } from '../../../lib/notify';
import { cn } from '../../../lib/utils';
import { useAssetUrls } from '../../../lib/assets';
import { HALF_INNINGS, ROSTER_SIZE } from '../../../data/msb';
import { STADIUM_OPTIONS } from '../../../data/stadiums';
import { Eyebrow, FieldRow, GAME_STAGE, KIT_SECTION, KitColumn, ToggleChip } from '../kit';
import { GamesSection, PlaybackModeControl, usePlaybackMode } from '../games';
import PostGameSection, { PostGameActions, PostGameSubject, usePostGame } from '../postgame';
import { useBoardQueueId, useNextUp, useQueues } from '../queue';
import { useGameModes, withHeldModes } from '../gamemodes';
import { isStaleBoard, useBoardLifecycle, useMatchBindableBoards } from '../boards';
import { useSideLabels } from '../sides';
import { bindScoreboard, takeNextMatch } from '../../../context/match';
import {
    formatLabel, isSplit, matchComplete, seriesContinues,
} from '../../../../public/layout/lib/match-format.js';

/*
 * Board desk — the console's panel for one scoreboard.
 *
 * A board is a desk, not an element: it feeds the broadcast and is never on it
 * (see ../boards for why the id lives in the desk namespace). This panel is the
 * one place that answers, from the BOARD's side, the three questions the console
 * could not answer before it existed:
 *
 *   what is this board carrying   — the live game, and the match bound to it
 *   why does it look like that    — side_reason, which the server has always
 *                                   computed and nothing ever read
 *   how do I fix it               — corrections, at correction grade
 *
 * CORRECTION GRADE is the deliberate scope. The score, the inning, the count,
 * the stadium, which side is home, the two identities and the two escape
 * hatches (swap, reset) — the things a producer nudges when a HUD frame lands
 * wrong or a board is being driven by hand between games. What used to sit
 * beside them on the Match tab — a roster grid, per-character stat editing,
 * manual runner and fielder placement — was read-only under every real feed and
 * is deleted, not moved.
 *
 * THE LAYOUT IS A SCOREBOARD, not a form. One line per side — the name, whether
 * that side is home, and the runs it has scored — because every one of those is a
 * fact about a person and the panel should say whose. Two earlier attempts got
 * this wrong in opposite directions: label-gutter kit rows made a familiar
 * instrument read as a settings list, and the Match tab's own panel, ported
 * verbatim, put two big boxes labelled P1 and P2 in a 420px column with the
 * names in a separate group below and 700px of dead stage beside it. The side
 * grid is a sanctioned Custom block under the console contract — the same
 * allowance the Match desk's captain grid takes, for the same reason: the kit
 * does not try to express a scoreboard. It sits in the kit's own KitColumns
 * grouping, and everything around it is kit rows.
 *
 * The two tiers are the app's real seam. Above the divider is `score.{N}.*` —
 * what is on air this game, all of it correctable. Below it is how the board is
 * WIRED — settings, which outlive the game: its **Games** (../games, the mode
 * and the mode's own surface, which is what let the Match tab go) beside the two
 * properties that are genuinely one-liners, its stats tag and its name.
 *
 * Every broadcast-visible write routes through the staging gateway under
 * `board:{sb}:{field}`. The momentary ones (re-read the HUD file, refresh stats)
 * fire immediately, same rule as Take and capture. The alias is config rather
 * than content, so it is immediate too.
 *
 * WHETHER THIS BOARD EXISTS is not on this panel. Adding and removing a board are
 * rig membership, and they live together in the rack's BOARDS section — the +
 * that creates a row and the trash that ends it, side by side. Remove used to be
 * here, at the bottom of the right-hand column, and could not be found.
 */

const halfInningOptions = HALF_INNINGS.map(h => ({ value: h, label: h }));

/*
 * THE BOARD IS MIRRORED: side 1 down one column, the shared frame (runs, count,
 * inning) in the middle, side 2 down the other, with side 2's contents reversed
 * and outer-aligned so each column runs outward from the score the way a
 * scoreboard does.
 *
 * The MIRRORING is what makes a producer's check a glance instead of a
 * translation step. The WORDS "left" and "right" were doing that job too, and
 * they were the half that could be wrong: they describe one arrangement of one
 * scene, and a stacked canvas (or a producer who simply put side 2 on the left)
 * turns the panel into a lie about the exact thing it was opened to check. The
 * column position carries the geometry; the eyebrow now carries the side, in
 * whatever vocabulary the producer picked (../sides).
 */
const BOARD_GRID = 'grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-x-3';
const EYEBROW = 'label-display text-[10px] text-muted-foreground';

// Coerce state (which round-trips through the socket as strings sometimes).
const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

/*
 * How many games are in a board's pool. `Array.isArray` rather than `?? []`
 * because `.length` answers for a STRING too — a game_ids that arrived as
 * "[11,12,13]" reads as a 10-game pool, which is a wrong number stated with
 * confidence. The server writes a list; this is about what the readout does when
 * something upstream doesn't.
 */

/*
 * WHY the sides are ordered the way they are.
 *
 * `_decide()` in server/rio/provider.py runs manual > match > pin > back_to_back
 * on every new game and mirrors the deciding layer to `score.{N}.side_reason`
 * "so a surface can say why". Until now the only reference to that key in the
 * whole frontend was the reset that CLEARS it — the answer was computed every
 * game and shown to nobody, which is most of why "how does this work" needed
 * explaining at all.
 */
const SIDE_REASON = {
    manual: {
        label: 'BY HAND',
        title: 'Sides set by hand — your swap outranks the bound match, an Address Book pin and last game until you hand it back',
    },
    match: { label: 'FROM MATCH', title: 'Sides taken from the match bound to this board' },
    pin: { label: 'PINNED', title: 'Sides from a preferred side pinned on a player’s Address Book row' },
    back_to_back: { label: 'LAST GAME', title: 'Sides kept as they were last game' },
};

/*
 * WHICH LAYER SEATED THE SIDES — A STATUS, NOT A SENTENCE ABOUT ONE.
 *
 * It was a sentence one tier under the subject: "Alice on the left — pinned in
 * Settings", later "Alice on side 1 — pinned in the Address Book". Two of its
 * three parts were already drawn larger a few pixels below, in the mirror: which
 * player is on which side is the whole point of that graphic, and repeating it
 * in prose is how a panel gets read as wordy. So it came down to the layer alone,
 * on the region’s own eyebrow — "Sides from the bound match".
 *
 * That is still a sentence, and a sentence is what the eye stops to READ. Every
 * other fact on this rule is a badge (HUD, the mode, the game’s own stage an inch
 * above), so the one item that stays prose is the one that costs the most to scan
 * and says the least — four of its five words are the same on every board. The
 * layer is a state with four values, which is what a chip is for.
 *
 * ITS SUBJECT IS THE BUTTON BESIDE IT. `Swap sides` is the control this badge
 * qualifies and it sits immediately to its right, so a `SIDES` eyebrow in front
 * would put the word twice in four inches — and the rail card spends the same
 * words on the same press (../quickface), so the button keeps its full name
 * rather than the badge borrowing half of it. The full sentence lives in the
 * title, where a producer who has not met the cascade can still find it.
 */
export function sideReasonStatus(reason) {
    return SIDE_REASON[reason] || null;
}

/*
 * HOW this board presents its games — the second axis, and the one the desk was
 * silent about.
 *
 * Transport (HUD vs API) and playback (single vs rotate) are independent:
 * transport is where games come from and is DERIVED, playback is how the board
 * shows them and is CHOSEN. Flattening them into one "HUD / single / rotator"
 * list is what the Match tab did, and it makes "HUD + rotate" expressible when
 * it is not a real state — board 1 under the HUD toggle is single by
 * construction whatever its stored mode says (see ../boards
 * useMatchBindableBoards, and bind_scoreboard on the server, which encode the
 * same rule). So they are stated as two things, never picked as one.
 *
 * THE REGION'S RULE CARRIES THE CONTROL, NOT A SENTENCE ABOUT IT. `playbackLine`
 * lived here and wrote the Games rule's subject — "Rotating — nothing in its
 * pool yet", "One game, pinned — following it live" — and every clause of it was
 * already drawn somewhere the producer was looking anyway. The MODE is the
 * segmented that sat directly beneath it, and is now on the rule itself
 * (../games `PlaybackModeControl`); the POOL COUNT is the rotator's own status
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
 * queue (../queue), but the SERVER re-resolves and binds under a lock — the button
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
 * THE FEED — where this board's game comes from and what mode it is being
 * fetched as. Rides the Game-state header rule, beside the sides.
 *
 * IT WAS A REGION OF ITS OWN AND ON A HUD BOARD THAT REGION HAD NOTHING IN IT.
 * "Games" carried a transport badge, a sentence, a re-read button and a mode
 * picker across four lines, and ../games returns nothing for a HUD board — so a
 * board with exactly one possible game, from exactly one file, spent a labelled
 * region and a divider saying so. The pool surface (playback, filters, the game
 * table) is what earns a region; a transport with no choice in it does not.
 *
 * The mode moved with it because it is not a board property either. It is the
 * binding (`scoreboards.binding.{N}.stats_tag`) and it decides the tag every
 * stats fetch for this board goes out under, which qualifies the game the mirror
 * below is drawing — so it belongs on that region's rule, not floating above a
 * header of its own.
 *
 * GAME MODE, with the override called out.
 *
 * A picked mode is an OVERRIDE and behaves like `rioName_override`: it wins, it
 * sticks against every feed path, and it is MARKED — same amber ring the name
 * picker wears, because amber is what the console spends on "you would want to
 * know before this is on air". Without the mark the two states were
 * indistinguishable, which is how a mode chosen for one game silently outlived it
 * and sent every later stats fetch at the wrong tag.
 *
 * The disagreement is stated only when there IS one: the live game's mode beside
 * the pick, and one press to hand the board back to the feed. A board with no
 * override, or one whose override matches what is being played, says nothing —
 * agreement is not news. It is said in as few words as the console can spend:
 * the mode name is the long part and it is printed ONCE, because a season name
 * ("SLICE 2026 Superstars Off") is half the panel's width on its own and a
 * sentence built around two of them wrapped to three lines under the picker.
 *
 * THE ACTIVE LIST IS NOT THE VOCABULARY. It is the list to PICK from, but a
 * board's mode comes from the game it is carrying, and a rotating pool of
 * completed games is full of ended seasons that list no longer names. A Combobox
 * whose value isn't in `data` renders its placeholder, so those boards read
 * "Select game mode" while holding a perfectly good tag. The catalogue is
 * offered in two tiers (../gamemodes) — active first, ended below — and whatever
 * this board is set to or playing is folded in on top of that, so the selector
 * can always say what it holds even when neither list has caught up with the
 * feed.
 */
const ModeRow = memo(function ModeRow({ d, gameModes, stats, refreshHud, refreshing }) {
    const diverged = d.statsTagManual && !!d.liveMode && d.liveMode !== d.statsTag;
    const options = useMemo(
        () => withHeldModes(gameModes, d.statsTag, d.liveMode),
        [gameModes, d.statsTag, d.liveMode],
    );
    return (
        <>
            {/* WHERE THE GAME COMES FROM, beside the game. The badge is the
                DERIVED transport — board 1 carries the local HUD iff the global
                toggle is on, every other board is API, no picker ever — and how
                to change that is a tooltip on it rather than a clause appended to
                a sentence, because it is wanted about once and read forever. */}
            <SimpleTooltip
                label={d.transport === 'hud'
                    ? 'One game, from Project Rio’s local HUD file. Board 1 carries it while Follow local HUD is on — turn that off on Connections to rebind this board.'
                    : 'Games come from the Project Rio API. Only board 1 can carry the local HUD.'}
            >
                <Badge className={cn(
                    'shrink-0 text-[11px] font-semibold uppercase tracking-wider',
                    d.transport === 'hud'
                        ? 'bg-[#22c55e]/15 text-[#4ade80]'
                        : 'bg-[#3b82f6]/15 text-[#60a5fa]',
                )}>
                    {d.transport === 'hud' ? 'HUD' : 'API'}
                </Badge>
            </SimpleTooltip>
            <Combobox
                aria-label="Game mode"
                placeholder="Select game mode"
                data={options}
                value={d.statsTag || null}
                onChange={d.setStatsTag}
                clearable
                className={cn(
                    // Wide enough for the longest season name PRSH has seen
                    // ("SLICE 2026 Superstars Off") and no wider.
                    'h-7 w-64 min-w-0 shrink text-xs',
                    d.statsTagManual && 'border-amber-400 ring-1 ring-amber-400/40',
                )}
            />
            <StatsDiagnostics stats={stats} />
            {/* THE OVERRIDE IS A RING AND ONE BUTTON, not a second line under the
                picker saying "Overriding X". The amber ring already says a hand is
                on it and the button says how to hand it back — the mode's name
                lives in that button's tooltip, which is the only place it was
                doing any work. Same shape as the sides' Use auto. */}
            {diverged && (
                <Button
                    size="xs" variant="ghost" className="h-6 shrink-0"
                    onClick={d.useLiveMode}
                    title={`Use ${d.liveMode} — the mode this game is being played in`}
                >
                    Use live
                </Button>
            )}
            {/* THE RECOVERY PATH AFTER A CLEAR OR A HAND EDIT — the only way to
                put Project Rio's game back on a board the producer has blanked, so
                it says what it does. It was a bare ↻ beside a badge, which reads
                as "refresh this readout". */}
            {d.transport === 'hud' && (
                <Button
                    variant="ghost" size="xs"
                    className="h-6 shrink-0 gap-1.5"
                    onClick={refreshHud} disabled={refreshing}
                    title="Read decoded.hud.json again and put what Project Rio is showing back on this board"
                >
                    {refreshing ? <Loader size={12} /> : <RotateCw size={13} />}
                    Re-read HUD
                </Button>
            )}
        </>
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
const SlotChip = ({ children, title, className }) => (
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
const BoardSubject = memo(function BoardSubject({
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
     * ../boards `useMatchBindableBoards` is the one client statement of it). It
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
 * WHICH RUNNING ORDER this board draws its next fixture from.
 *
 * Renders nothing while there is one order — the answer is "the only one", and a
 * picker with a single option is a control that cannot do anything. It writes
 * `scoreboards.match_queue.{sb}` in Settings, deliberately NOT into
 * `scoreboards.binding.{sb}`: the binding is pool + playback + stats_tag, "which
 * GAMES fill this board", where this is which order of FIXTURES it takes from.
 *
 * Staged like the board's other broadcast-visible properties: changing it changes
 * which fixture the next press of Up next puts on air.
 */
const BoardQueueRow = memo(function BoardQueueRow({ sb }) {
    const queues = useQueues();
    const current = useBoardQueueId(sb);
    const setItem = useSettingsStore(s => s.setItem);
    if (queues.length <= 1) return null;
    return (
        // IT OWNS ITS SECTION RULE, because it is the section's only member and
        // it self-hides. A divider drawn by the desk around it would be a rule
        // under the capture with nothing beneath it on every single-order rig,
        // which is almost every rig.
        <div className={KIT_SECTION}>
        <FieldRow label="Matches from">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {queues.map(q => (
                    <Button
                        key={q.id}
                        size="xs"
                        variant={q.id === current ? 'default' : 'outline'}
                        role="radio"
                        aria-checked={q.id === current}
                        onClick={() => stageOrRun({
                            key: `board:${sb}:match_queue`,
                            label: `Board ${sb}: take matches from ${q.title || q.id}`,
                            value: q.id,
                            liveValue: current,
                            run: () => setItem(`scoreboards.match_queue.${sb}`, q.id),
                        })}
                    >
                        {q.title || q.id}
                    </Button>
                ))}
            </div>
        </FieldRow>
        </div>
    );
});

/*
 * WHEN THIS BOARD NEXT PICKS UP ITS LIVE GAME.
 *
 * The countdown belongs HERE, on the board, beside the sentence that says the
 * board is following a live game — not down on the game list, which is a browser
 * of what else is on and now refreshes only when a producer presses Refresh.
 * That was the whole confusion: one countdown, sitting under the list, timing
 * something the list had nothing to do with.
 *
 * It is a READOUT OF THE SERVER'S CADENCE, and it fetches nothing. Every
 * successful ongoing poll emits `v1.game_pool.ongoing_update` (server
 * OngoingGamePool._fetch_games, right after `_reapply_single_live` has pushed the
 * fresh game onto this board), so the arrival of that event IS the refresh the
 * producer just watched land. Counting from it can't drift out of step with the
 * server the way a client-side interval of its own would.
 *
 * It renders only while the poll is actually going to fire: `_live_consumers_exist`
 * wants a single-mode board with a pinned game that is still being played, so a
 * completed game or an unpinned board gets no countdown rather than one that
 * silently never arrives.
 */
function LiveRefreshCountdown({ active }) {
    const interval = useSettingsStore(s => Number(s?.ongoing_games?.poll_interval) || 10);
    const [remaining, setRemaining] = useState(interval);
    const nextRef = useRef(Date.now() + interval * 1000);

    const onPoll = useCallback(() => {
        nextRef.current = Date.now() + interval * 1000;
        setRemaining(interval);
    }, [interval]);
    useSocketSubscribe('v1.game_pool.ongoing_update', onPoll);

    useEffect(() => {
        if (!active) return undefined;
        nextRef.current = Date.now() + interval * 1000;
        setRemaining(interval);
        const id = setInterval(() => {
            setRemaining(Math.max(0, Math.round((nextRef.current - Date.now()) / 1000)));
        }, 250);
        return () => clearInterval(id);
    }, [active, interval]);

    if (!active) return null;
    return (
        <SimpleTooltip
            label={`This board follows its live game from the Project Rio API, which PRSH re-reads `
                + `every ${interval}s. The game list below never refreshes on its own.`}
        >
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
                <RotateCw size={11} />
                {/* Held at zero rather than going negative: the poll has fired and
                    we are waiting on the API, which is a real state and a short one. */}
                {remaining > 0 ? `Refreshing in ${remaining}s` : 'Refreshing…'}
            </span>
        </SimpleTooltip>
    );
}

/*
 * The board's TYPE in one word — the two axes above compressed to what fits a
 * rack row, and what is left of the sentence they used to be written out as. The two axes produce exactly three states, because HUD + rotate is not a
 * real one: board 1 under the HUD toggle is single by construction whatever its
 * stored mode says (../boards `useMatchBindableBoards` and `bind_scoreboard`
 * encode the same rule). So the pair collapses to three words with nothing lost.
 *
 * ROTATING, never "rotator". A **Rotator** is the standalone layout group
 * (`public/layout/rotator/*.html` — the results ticker); a board cycling its pool
 * is **rotating**. They are different things and the glossary keeps them apart,
 * which one shared word on the most-read surface in the app would undo.
 */
export function boardTypeTag({ transport, mode }) {
    if (transport === 'hud') return 'HUD';
    return mode === 'rotate' ? 'ROTATING' : 'API';
}

export const BOARD_TAG_TITLE = {
    HUD: 'Games come from the local Project Rio HUD file',
    API: 'Games come from the Project Rio API — one at a time',
    ROTATING: 'Games come from the Project Rio API — cycling this board’s pool',
};

/*
 * What a rack row draws for a board: its type, and whether it is sitting idle.
 * STATE ONLY for the live half — the rack redraws on every HUD frame and must
 * never fire a desk's own requests just to paint a row. The type is two settings
 * reads, which change when a producer changes them, not per frame.
 *
 * A BOARD ROW IS ITS NAME AND ITS TYPE. The row used to carry a one-line game
 * summary instead (`Alice 3–2 Bob`, `HUD · no game`, `rotating · 3`), and it did
 * not fit: name plus summary measured 218px against the 176px a 278px rack row
 * leaves once the chip, the pin and the trash are paid for, so the widest thing on
 * the rig — a live game between two real usernames — was the one that overran.
 * A type tag is the opposite shape: three fixed words, the widest ~50px, and it
 * says the thing that is TRUE OF THE BOARD rather than of the game passing
 * through it. The game is on the board's panel, at full length, one click away.
 *
 * The DIM is the other half, and costs no width: a board with players on it reads
 * at full strength, an empty one recedes.
 */
export function useBoardDeskRow(sb) {
    const hudEnabled = useSettingsStore(s => s?.project_rio?.hud_enabled);
    const mode = useSettingsStore(
        s => s?.scoreboards?.binding?.[sb]?.playback?.mode
            ?? s?.scoreboards?.binding?.[String(sb)]?.playback?.mode,
    );
    // A primitive, so no useShallow: the selector returns a boolean and zustand's
    // Object.is comparison is exactly right for it.
    const idle = useStateStore((s) => {
        const p = s?.score?.[sb]?.player;
        return !(p?.[1]?.rioName || p?.[2]?.rioName);
    });
    // Board 1 carries the local HUD iff the global toggle is on; the server
    // default for that toggle is on, so only an explicit false is off.
    const transport = (Number(sb) === 1 && hudEnabled !== false) ? 'hud' : 'api';
    return { tag: boardTypeTag({ transport, mode }), idle };
}

/*
 * One board's live facts plus its writers. Broadcast-visible writes go through
 * `stageOrRun` keyed `board:{sb}:{field}`, and `val()` shows the staged value so
 * a producer in confirm mode reads what they typed rather than what is on air.
 */
export function useBoardDesk(sb) {
    const setItem = useStateStore(s => s.setItem);
    const setItems = useStateStore(s => s.setItems);
    const settingsSetItem = useSettingsStore(s => s.setItem);
    const base = `score.${sb}`;

    const hudEnabled = useSettingsStore(s => s?.project_rio?.hud_enabled);
    const transport = (Number(sb) === 1 && hudEnabled !== false) ? 'hud' : 'api';
    /*
     * IS A FEED WRITING THIS BOARD RIGHT NOW.
     *
     * Every cell of the mirror below — the runs, the inning, the count, the
     * stadium — is in the per-frame `SetBatch` (`apply_parsed_game_to_state`), so
     * over a live game a typed correction survives until the next frame and no
     * longer. The panel offered eight editable numbers that could not be edited,
     * and a producer found out by watching one snap back.
     *
     * INERT, NOT GREYED (`FEED_OWNED`). The first cut let the disabled styling
     * through and it dulled the count dots, which are the one part of this panel
     * that carries meaning in colour — three coloured counts is how a producer
     * reads the at-bat at a glance, and fading them to say "the feed owns these"
     * spends the signal to make a footnote. Nothing announces the state at all:
     * the controls simply don't take input, which is the whole of what there is
     * to know.
     *
     * Overrides are the exception and stay live in both states — a name
     * (`rioName_override`), which side is home, and the swap all outrank the feed
     * by design.
     */
    const feedLive = useBoardLifecycle(sb) === 'live';
    const statsTag = useSettingsStore(
        s => s?.scoreboards?.binding?.[sb]?.stats_tag
            ?? s?.scoreboards?.binding?.[String(sb)]?.stats_tag
            ?? '',
    );
    /*
     * Did a PRODUCER pick that mode, or did the feed?
     *
     * `stats_tag` was one key doing two jobs, which made "the live mode never
     * took over" and "my pick got clobbered" the same bug from two ends. The flag
     * is the same shape as `player.{T}.rioName_override`: the pick wins and
     * sticks against the feed, and the panel calls it out instead of hiding it.
     */
    const statsTagManual = useSettingsStore(
        s => !!(s?.scoreboards?.binding?.[sb]?.stats_tag_manual
            ?? s?.scoreboards?.binding?.[String(sb)]?.stats_tag_manual),
    );
    // What the game on this board is actually being played in.
    const liveMode = useStateStore(s => s?.score?.[sb]?.game_mode || '');

    // The one thing the desk still asks of the playback binding: a PINNED game
    // is the one the server re-applies from the live feed on its own, which is
    // the condition the Games rule's refresh countdown runs under. The mode
    // belongs to the control that sets it (../games `usePlaybackMode`) and the
    // pool count to the rotator's own status line — both were read here only to
    // build a sentence the rule no longer prints.
    const pinnedGameId = useSettingsStore(
        s => (s?.scoreboards?.binding?.[sb]?.playback
            ?? s?.scoreboards?.binding?.[String(sb)]?.playback ?? {}).gameId ?? null,
    );

    const g = useStateStore(useShallow(s => {
        const b = s?.score?.[sb];
        return {
            scoreLeft: num(b?.score_left), scoreRight: num(b?.score_right),
            inning: num(b?.inning, 1), halfInning: b?.half_inning || 'Top',
            balls: num(b?.balls), strikes: num(b?.strikes), outs: num(b?.outs),
            stadium: b?.stadium || '',
            homeTeam: num(b?.home_team, 2),
            sideReason: b?.side_reason || '',
            /*
             * Is a live API game on this board still being polled for?
             *
             * `game_completed === false` is not enough on its own: when a followed
             * game leaves the ongoing feed the server stops polling for it but
             * leaves that flag false, so the board holds a live game that will
             * never update again. `live_following` is the server saying which of
             * the two it is (server/rio/game_pool.py `_set_following`). Absent —
             * state written before the flag existed — falls back to "yes", since
             * the honest default is the one the board was already behaving as.
             */
            gameLive: b?.game_completed === false && b?.live_following !== false,
            conflict: !!b?.match_conflict,
            match: b?.match ?? null,
            name1: b?.player?.[1]?.rioName || '',
            name2: b?.player?.[2]?.rioName || '',
            override1: b?.player?.[1]?.rioName_override || '',
            override2: b?.player?.[2]?.rioName_override || '',
        };
    }));
    const boundMatch = useStateStore(useShallow(s => {
        const m = s?.score?.[sb]?.match;
        const rec = m != null ? s?.match?.[m] : null;
        if (!rec) return null;
        // The participants come along now: the fixture slot SHOWS the match, and
        // who is playing is the first thing a producer checks one for.
        return {
            label: rec.label,
            phase: rec.phase,
            series: rec.series,
            bestOf: num(rec?.format?.bestOf, 1),
            // `decided` is the FIXTURE's finished test, never `stage` — a Bo3 sits
            // at stage `post` between games and is still the current fixture. Both
            // travel, because the slot says something different about each.
            decided: num(rec.decided, 0),
            stage: rec.stage || '',
            name1: rec?.player?.[1]?.rioName || rec?.player?.['1']?.rioName || '',
            name2: rec?.player?.[2]?.rioName || rec?.player?.['2']?.rioName || '',
        };
    }));

    const pendingMap = useStagingStore(s => s.pending);
    const val = (field, live) => {
        const p = pendingMap[`board:${sb}:${field}`];
        return p ? p.value : live;
    };
    const isStaged = (field) => !!pendingMap[`board:${sb}:${field}`];

    // One state field, staged. `liveValue` lets a control staged back to what is
    // already on air drop out of the buffer entirely.
    const setField = (field, value, label) => stageOrRun({
        key: `board:${sb}:${field}`,
        label: label || `Board ${sb}: ${field}`,
        value,
        liveValue: g[field],
        run: () => setItem(`${base}.${field}`, value),
    });

    /*
     * Runners, batter, pitcher and the fielders belong to the half-inning that
     * just ended, so moving the inning by hand clears them rather than leaving
     * the last at-bat on screen under a new frame. Carried over from the Match
     * tab, where the same two controls (half-inning, swap) did this.
     */
    const clearAtBatState = () => {
        const entries = [
            ['cbRioRunnerOn1', false], ['cbRioRunnerOn2', false], ['cbRioRunnerOn3', false],
            ['runner1Name', ''], ['runner2Name', ''], ['runner3Name', ''],
            ['batter', ''], ['pitcher', ''],
        ];
        for (const pos of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']) {
            entries.push([`field.${pos}`, '']);
        }
        setItems(entries.map(([k, v]) => ({ key: `${base}.${k}`, value: v })));
    };

    /*
     * A HUD board's feed rewrites its sides every frame, so the swap is owned
     * entirely by the server: /rio/swap flips the orientation flag and re-applies
     * the whole player unit (address-book identity included), or swaps what is
     * already in State when no frame is live. One authoritative broadcast keeps
     * the UI and every overlay in step; a partial client-side swap is what let
     * them diverge.
     */
    const swapSides = () => stageOrRun({
        key: `board:${sb}:swap`,
        label: `Board ${sb}: swap teams`,
        value: true,
        run: async () => {
            clearAtBatState();
            if (transport === 'hud') {
                await fetch(`/api/v1/rio/swap?scoreboard_number=${sb}`, { method: 'POST' });
                return;
            }
            const st = useStateStore.getState();
            const b = st?.score?.[sb];
            setItems([
                { key: `${base}.player.1`, value: b?.player?.[2] ?? {} },
                { key: `${base}.player.2`, value: b?.player?.[1] ?? {} },
                { key: `${base}.score_left`, value: b?.score_right ?? 0 },
                { key: `${base}.score_right`, value: b?.score_left ?? 0 },
                { key: `${base}.home_team`, value: num(b?.home_team, 2) === 1 ? 2 : 1 },
                { key: `${base}.teamsSwapped`, value: !(b?.teamsSwapped ?? false) },
            ]);
        },
    });

    /*
     * Hand the sides back to the cascade — the "clear the override" half of the
     * swap, the same shape as `useLiveMode` under the game mode.
     *
     * `manual` is the top layer of the side cascade and was the only one with no
     * way out: the server cleared it on a NEW GAME, or mid-game if a second swap
     * happened to land on exactly what the pin already wanted. So a swap made to
     * fix one frame — or made before a fixture was bound — outranked that fixture
     * for the rest of the game, and the only control on offer was another swap,
     * which lands on the other wrong answer half the time.
     *
     * HUD-only, like the swap it reverses: the override is a server flag over the
     * HUD feed, and an API board's swap is a plain state write that never sets it.
     */
    const releaseSides = () => stageOrRun({
        key: `board:${sb}:sides_release`,
        label: `Board ${sb}: sides back to auto`,
        value: true,
        run: () => fetch('/api/v1/rio/swap/release', { method: 'POST' }).catch(() => {}),
    });

    /*
     * Blank the board back to a resting game. The key list here is the contract
     * `tests/unit/rio/test_state_completeness.py` pins: every key a live game
     * writes has to appear, or a reset leaves stale data on air.
     *
     * On a HUD board it also RELEASES the feed. The server keeps the last frame
     * Project Rio wrote (the re-read needs it), but a manual swap re-orients that
     * frame and re-applies it — so resetting and then swapping brought the whole
     * game back. Reset clears, Re-read HUD restores; nothing in between puts the
     * feed back on the board on its own.
     */
    /*
     * `releaseMatch` takes the bound fixture OFF the board as part of the clear —
     * see the endpoint, and TurnoverBar, which is the one place that decides it.
     * The staging entry carries it, so a staged clear commits the same shape it
     * was previewed as.
     */
    const resetGame = (releaseMatch = false) => stageOrRun({
        // The staging KEY stays `reset` — it is an id, and the Match desk and the
        // quick face stage against it — but what a producer reads in the confirm
        // buffer is the verb printed on the button they pressed.
        key: `board:${sb}:reset`,
        label: releaseMatch
            ? `Board ${sb}: clear board (game + match)`
            : `Board ${sb}: clear game`,
        value: true,
        /*
         * ONE CALL, AND THE SERVER OWNS THE KEY LIST.
         *
         * This used to build ~120 resting values here and send them as plain state
         * writes. Two things were wrong with that, and only the second was
         * visible:
         *
         * The key list is the INVERSE of what a live frame writes, so its only
         * honest home is beside that writer (`clear_game_entries`,
         * server/rio/provider.py). Kept here it was a third copy — the browser's,
         * the one in test_state_completeness described as "mirroring" the browser's,
         * and the writer itself — and the copies had already drifted apart on
         * `player.{T}.name` while BOTH missed the six resurface fields
         * (`full_name`, `pronoun`, `country`, `state`, `twitter`, `youtube`), so a
         * clear left the previous player's pronouns and socials on air.
         *
         * And a clear has to RE-PROJECT the bound fixture, which no amount of state
         * writing from a browser can do: the Match projector jointly owns
         * `player.{T}.*` and runs only on a bind or a fixture mutation, so blanking
         * those keys from here left the fixture's names gone with nothing to bring
         * them back — the slot above still read `M2 · Alice vs Bob` while the
         * scoreboard drew nobody, and the workaround was knowing to clear BEFORE
         * binding and never after.
         *
         * The HUD release moved with it (the endpoint decides from the board's own
         * transport), so this is no longer two requests that could half-land.
         */
        run: () => fetch(
            `/api/v1/scoreboards/${sb}/clear-game?release_match=${releaseMatch ? 'true' : 'false'}`,
            { method: 'POST' },
        ).catch(() => {}),
    });

    /*
     * Pin (or, with an empty value, clear) one side's name override. The server
     * makes the override that slot's identity — it drives the overlay name, the
     * resurface, the match gate and a fresh stats fetch — and keeps it stuck
     * against feed updates until the next HUD game.
     */
    const setNameOverride = (team, value) => stageOrRun({
        key: `board:${sb}:override.${team}`,
        label: `Board ${sb}: side ${team} name`,
        value: value ?? '',
        run: () => fetch(
            `/api/v1/scoreboards/${sb}/player/${team}/name-override?name=${encodeURIComponent(value ?? '')}`,
            { method: 'PUT' },
        ),
    });

    /*
     * Which mode's stats to fetch is configuration, not content — it selects a
     * data source rather than changing what is on screen, and the fetch it kicks
     * off can't be deferred as a unit. Immediate, like the intro toggle.
     *
     * Picking one is an OVERRIDE and says so: the flag is what stops every feed
     * path (HUD frame, game assign, rotation advance, match projection) from
     * overwriting it, and what the panel reads to call it out. Clearing hands the
     * board back to the feed — the mode goes to whatever is being played right
     * now rather than to blank, since blank would be a third state nobody asked
     * for.
     */
    const setStatsTag = (v) => {
        const picked = v ?? '';
        settingsSetItem(`scoreboards.binding.${sb}.stats_tag`, picked || liveMode || '');
        settingsSetItem(`scoreboards.binding.${sb}.stats_tag_manual`, !!picked);
    };

    // Hand the mode back to the feed without opening the picker — the "clear the
    // override" half of the name-override idiom, as one press.
    const useLiveMode = () => {
        settingsSetItem(`scoreboards.binding.${sb}.stats_tag`, liveMode || '');
        settingsSetItem(`scoreboards.binding.${sb}.stats_tag_manual`, false);
    };

    return {
        sb, base, transport, feedLive, statsTag, statsTagManual, liveMode, pinnedGameId,
        g, boundMatch, clearAtBatState,
        val, isStaged, setField, swapSides, releaseSides, resetGame, setNameOverride,
        setStatsTag, useLiveMode,
    };
}

/*
 * THE SIDES, ON THE GAME-STATE EYEBROW — which layer seated them, and the two
 * controls that change it.
 *
 * Sides were spread across three places: a prose line above the mirror naming
 * the layer, a "Swap sides" button at the bottom of the region beside Reset, and
 * nothing at all for getting out of a manual swap. The layer, the flip and the
 * release are one subject, so they read as one row on the rule of the region
 * they govern — and the mirror underneath is what actually SHOWS the result, so
 * nothing here repeats a player name.
 *
 * The override pair is the same idiom as the game mode's (see ModeRow): amber
 * says a hand is on it, and one ghost button hands it back.
 */
const SidesControl = memo(function SidesControl({ d, reason, transport }) {
    const manual = reason === 'manual';
    const status = sideReasonStatus(reason);
    // Only the HUD feed carries the server-side override, so only a HUD board
    // can be handed back (see releaseSides).
    const releasable = manual && transport === 'hud';
    return (
        <>
            {status && (
                <SlotChip
                    title={status.title}
                    // SlotChip's default palette is an `||` fallback, so a
                    // className has to carry the neutral fill too or the chip
                    // arrives unpainted — twMerge lets the amber win after it.
                    className={cn(
                        'cursor-help bg-secondary text-muted-foreground',
                        // Amber is the console's "a hand is on this", the same
                        // tone the mode override's ring spends — and the one
                        // layer here a producer can be holding open.
                        manual && 'bg-amber-500/15 text-amber-300',
                    )}
                >
                    {status.label}
                </SlotChip>
            )}
            {releasable && (
                <Button
                    size="xs" variant="ghost"
                    className={cn('h-6 shrink-0', d.isStaged('sides_release') && 'text-amber-400')}
                    onClick={d.releaseSides}
                    title="Let the bound match, an Address Book pin or the last game decide"
                >
                    Use auto
                </Button>
            )}
            <Button
                size="xs" variant="outline"
                className={cn('h-6 shrink-0', d.isStaged('swap') && 'border-amber-400/60 text-amber-400')}
                onClick={d.swapSides}
            >
                Swap sides
            </Button>
        </>
    );
});

/*
 * A control the feed owns: it takes no input and looks no different. The shared
 * primitives all carry `disabled:opacity-50` (and a not-allowed cursor), which is
 * right for a control that is unavailable and wrong for one that is simply not
 * yours to type in — see `feedLive`.
 */
const FEED_OWNED = 'disabled:opacity-100 disabled:cursor-default';

// The count dots. Clicking the last filled dot clears it, so B/S/O never needs
// a separate decrement.
//
// THE TERMINAL VALUE OF A COUNT IS NEVER DRAWN — three balls, two strikes, two
// outs. A fourth ball is a walk, a third strike and a third out are the end of
// something: each resets the count rather than lighting a dot, so a dot for it
// is a state the board can never be in. The overlay has always been 3/2/2
// (`scoreboard-mount.js`, and the theme SVGs carry only `ball-0..2`,
// `strike-0..1`, `out-0..1`); the desk drew 4/3/3, so a producer correcting a
// count here was offered a value the card could not show.
const CountDots = memo(function CountDots({ label, count, max, hex, onChange, disabled }) {
    return (
        <div className="flex items-center gap-1">
            <span className="w-3 text-center text-[11px] font-bold leading-none text-muted-foreground">{label}</span>
            {Array.from({ length: max }, (_, i) => {
                const filled = i < count;
                return (
                    <button
                        key={i}
                        type="button"
                        disabled={disabled}
                        aria-label={`${label} ${i + 1}`}
                        onClick={() => onChange(filled && i === count - 1 ? count - 1 : i + 1)}
                        // The dots draw their own colour inline, so there is
                        // nothing to undo here — only the cursor.
                        className="size-3 shrink-0 rounded-full transition-all disabled:cursor-default"
                        style={{
                            backgroundColor: filled ? hex : 'transparent',
                            border: `2px solid ${hex}`,
                            opacity: filled ? 1 : 0.3,
                        }}
                    />
                );
            })}
        </div>
    );
});

/*
 * The stats fetch for this board. Push-based: the server emits
 * v1.stats.fetch_status on every loading→done transition, so there is no polling
 * and no spinner lag.
 *
 * It reports through the ⓘ popover beside the game mode, exactly as it did on
 * the Match tab — the per-player character counts, the URL pattern and the tag
 * are diagnostics, so they stay one click away rather than spending a line of
 * the panel on every board that is working fine.
 */
function useStatsDiagnostics(sb) {
    const [diagnostics, setDiagnostics] = useState(null);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    const onStatus = useCallback((payload) => {
        if (payload?.scoreboard !== sb) return;
        setDiagnostics(payload);
        setBusy(payload.status === 'loading');
    }, [sb]);
    useSocketSubscribe('v1.stats.fetch_status', onStatus);

    // A one-shot read when the popover opens cold, for the case where the fetch
    // happened before this panel did — without it the board would read as
    // "nothing fetched yet" while its overlays are drawing real stats.
    const inspect = useCallback(() => {
        setOpen(true);
        if (diagnostics == null) {
            fetch(`/api/v1/rio/stats/diagnostics?scoreboard=${sb}`)
                .then(r => r.json())
                .then(setDiagnostics)
                .catch(() => {});
        }
    }, [sb, diagnostics]);

    const refresh = useCallback(() => {
        setBusy(true);
        fetch(`/api/v1/rio/stats/refresh?scoreboard=${sb}`, { method: 'POST' })
            .catch(() => setBusy(false));
    }, [sb]);

    return { diagnostics, open, setOpen, busy, inspect, refresh };
}

// The diagnostics popover — a verbatim keep of the Match tab's, because it is
// the one place the stats pipeline explains itself.
const StatsDiagnostics = memo(function StatsDiagnostics({ stats }) {
    const { diagnostics, open, setOpen, busy, inspect, refresh } = stats;
    return (
        <Popover open={open && diagnostics != null} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={inspect} title="Inspect stats fetch">
                    {busy ? <Loader size={12} /> : <Info size={14} />}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[320px]">
                <Stack gap="xs">
                    <Text size="xs" fw={600}>Stats Fetch Diagnostics</Text>
                    {diagnostics?.fetched_at ? (
                        <>
                            {diagnostics.error && (
                                <Text size="xs" c="#ff5a5f">{diagnostics.error}</Text>
                            )}
                            {diagnostics.url && (
                                <div>
                                    <Text size="xs" dimmed>URL Pattern</Text>
                                    <Text size="xs" className="break-all">{diagnostics.url}</Text>
                                </div>
                            )}
                            {diagnostics.tag && (
                                <div className="flex items-center gap-1">
                                    <Text size="xs" dimmed>Tag:</Text>
                                    <Badge variant="secondary" className="text-[10px]">{diagnostics.tag}</Badge>
                                </div>
                            )}
                            {Object.keys(diagnostics.players ?? {}).length > 0 && (
                                <>
                                    <Divider />
                                    {Object.entries(diagnostics.players).map(([name, info]) => (
                                        <div key={name} className="flex items-center justify-between">
                                            <Text size="xs">{name}</Text>
                                            {info.status === 'loading' ? (
                                                <div className="flex items-center gap-1">
                                                    <Loader size={10} />
                                                    <Text size="xs" dimmed>Loading...</Text>
                                                </div>
                                            ) : info.error ? (
                                                <Badge variant="destructive" className="text-[10px]">Error</Badge>
                                            ) : (
                                                <Badge
                                                    className={cn('text-[10px] text-white',
                                                        info.char_count > 0 ? 'bg-[#22c55e]' : 'bg-[#f5bb00] text-black')}
                                                >
                                                    {info.char_count} chars
                                                </Badge>
                                            )}
                                        </div>
                                    ))}
                                </>
                            )}
                            <Text size="xs" dimmed ta="right">
                                {new Date(diagnostics.fetched_at).toLocaleTimeString()}
                            </Text>
                        </>
                    ) : (
                        <Text size="xs" dimmed>No stats have been fetched yet.</Text>
                    )}
                    <Button
                        size="sm" variant="secondary" className="w-full"
                        onClick={refresh} disabled={busy}
                    >
                        {busy && <Loader size={12} />}
                        Refresh Stats
                    </Button>
                </Stack>
            </PopoverContent>
        </Popover>
    );
});

/*
 * ONE SIDE'S TEAM — its MSB team and its nine characters.
 *
 * Returned FLAT, all primitives, on purpose. `useShallow` compares element by
 * element, so an object (or an array of objects) would be a fresh identity on
 * every read and this panel would re-render on every unrelated state write. A
 * live HUD board writes 30–100 keys a frame and this desk is open while it does,
 * so a nested shape here is a per-frame cost, not a style question.
 */
export function useSideTeam(sb, team) {
    const flat = useStateStore(useShallow(s => {
        const p = s?.score?.[sb]?.player?.[team];
        const chars = p?.character;
        const out = [p?.msb_team || '', String(num(p?.rio_captainIndex, -1))];
        for (let i = 0; i < ROSTER_SIZE; i++) {
            out.push(chars?.[i]?.name || '', chars?.[i]?.is_starred ? '1' : '');
        }
        return out;
    }));
    return useMemo(() => ({
        msbTeam: flat[0],
        captain: Number(flat[1]),
        roster: Array.from({ length: ROSTER_SIZE }, (_, i) => ({
            name: flat[2 + i * 2],
            starred: flat[3 + i * 2] === '1',
        })),
    }), [flat]);
}

/*
 * The per-character superstar mark. ALWAYS DRAWN on a filled slot, hollow when
 * off — which is the whole point of it: nine hollow stars say "star skills are on
 * and nobody is starred yet", where a cell with no mark at all says nothing. The
 * on state is the game's own superstar art with the amber glow it has always had
 * (`superstar.png` is a required file in the MSB asset pack, so a pack missing it
 * is already reported in Settings rather than silently blank here).
 */
const STAR_POINTS = '10,1 12.9,7 19.5,7.6 14.5,12 16.2,18.5 10,15 3.8,18.5 5.5,12 0.5,7.6 7.1,7';

const StarMark = memo(function StarMark({ on, url }) {
    /*
     * PRSH ships no MSB images (Nintendo IP), so every icon here is a file the
     * user supplied and any of them can be absent. An image tag pointed at a
     * file that isn't there is a torn-page box at whatever size the browser
     * picks — it breaks the grid's rhythm AND reads as a bug rather than as a
     * missing asset. So the art is an enhancement over a vector that already
     * says the same thing: amber and filled for on, hairline for off.
     */
    const [artMissing, setArtMissing] = useState(false);
    if (on && url && !artMissing) {
        return (
            <img
                src={url} alt="Superstar" width={12} height={12} data-star="on"
                onError={() => setArtMissing(true)}
                className="shrink-0 object-contain"
                style={{ filter: 'drop-shadow(0 0 3px rgba(245,159,0,0.8))' }}
            />
        );
    }
    return (
        <svg
            viewBox="0 0 20 20" width={11} height={11} data-star={on ? 'on' : 'off'}
            role={on ? 'img' : undefined} aria-label={on ? 'Superstar' : undefined}
            aria-hidden={on ? undefined : 'true'}
            className={cn('shrink-0', on ? 'text-[#f59f00]' : 'text-muted-foreground/50')}
            style={on ? { filter: 'drop-shadow(0 0 3px rgba(245,159,0,0.6))' } : undefined}
        >
            <polygon
                points={STAR_POINTS}
                fill={on ? 'currentColor' : 'none'}
                stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round"
            />
        </svg>
    );
});

/*
 * The nine characters, as a READOUT.
 *
 * The roster grid that used to live on the Match tab was an editor — a character
 * combobox, a superstar toggle and a captain button per slot — and under every
 * real feed it was read-only anyway, so it was deleted with the rest of the
 * hand-driving controls. What was lost with it is the thing a producer actually
 * used it for: SEEING the lineup, to check the board against the game. That is a
 * subject, not a control, so it comes back as one — captain ringed, superstars
 * starred, nothing clickable.
 *
 * It renders only when the feed has given the side characters. Nine "Slot n"
 * placeholders on an idle board is nine rows of nothing.
 */
const RosterGrid = memo(function RosterGrid({ roster, captain, mirror }) {
    const urls = useAssetUrls();
    const superstar = urls.gameIcon('superstar.png');
    if (!roster.some(r => r.name)) return null;
    return (
        <div className="grid w-full grid-cols-3 gap-1">
            {roster.map((r, i) => {
                const isCaptain = captain === i;
                const icon = r.name ? urls.charIcon(r.name) : undefined;
                return (
                    <div
                        key={i}
                        title={[r.name || `Slot ${i + 1}`, isCaptain && 'captain', r.starred && 'superstar']
                            .filter(Boolean).join(' · ')}
                        className={cn(
                            'flex min-w-0 items-center gap-1 rounded border px-1 py-0.5',
                            mirror && 'flex-row-reverse',
                            isCaptain ? 'border-[#f5bb00]/70' : 'border-border/60',
                        )}
                    >
                        {icon && (
                            <img src={icon} alt="" width={14} height={14} className="shrink-0 object-contain pixelated" />
                        )}
                        <Text
                            size="xs" span truncate
                            className={cn('min-w-0 text-[11px]', isCaptain ? 'text-[#f5bb00]' : 'text-muted-foreground')}
                        >
                            {r.name || '—'}
                        </Text>
                        {/* An empty slot gets no mark — a star on nothing is
                            noise, where a star on a character is a fact. */}
                        {r.name && <StarMark on={r.starred} url={superstar} />}
                    </div>
                );
            })}
        </div>
    );
});

/*
 * ONE SIDE, as a column: who is there · do they bat last · what they're playing
 * as · who's in the lineup. Side 2's column is reversed and right-aligned, so
 * the two read outward from the score between them.
 *
 * The name field IS the identity override — the only identity edit that survives
 * a feed. The raw name comes from Project Rio; the picker shows it, and pinning
 * one here is how a producer corrects a mis-typed or alt online ID without the
 * next frame undoing it. It used to be a separate "Who's on each side" group
 * below the scores, which asked the producer to hold "P1 = the left name" in
 * their head while a mislabelled game was on air.
 *
 * Home is a chip on the side that HAS it, not a Left/Right picker: which side
 * bats last is a fact about a player, and "MattGree bats last" is the sentence a
 * producer is checking against the game. Clicking the other side moves it;
 * clicking the side that already has it does nothing, because this is a choice
 * between two sides and not a toggle that can be off.
 */
const SidePanel = memo(function SidePanel({ side, d }) {
    const { g } = d;
    const sides = useSideLabels();
    const label = sides.label(side);
    const phrase = sides.phrase(side);
    const team = useSideTeam(d.sb, side);
    const urls = useAssetUrls();
    const mirror = side === 2;
    const feedName = side === 1 ? g.name1 : g.name2;
    const override = side === 1 ? g.override1 : g.override2;
    const isHome = num(d.val('home_team', g.homeTeam), 2) === side;
    const shown = d.val(`override.${side}`, override) || feedName;
    const logo = team.msbTeam ? urls.teamIcon(team.msbTeam) : null;
    return (
        <div className={cn('flex min-w-0 flex-col gap-1.5', mirror && 'items-end')}>
            <span className={cn(EYEBROW, d.isStaged(`override.${side}`) && 'text-amber-400')}>
                {label}
            </span>
            <div className={cn('flex w-full min-w-0 items-center gap-1.5', mirror && 'flex-row-reverse')}>
                <div className="min-w-0 flex-1">
                    <ParticipantPicker
                        value={shown}
                        placeholder="Online ID"
                        onResolve={row => d.setNameOverride(side, row?.identities?.rioName || row?.display?.tag || '')}
                        onRawValue={v => d.setNameOverride(side, v)}
                        className={cn('h-7 text-xs', override && 'border-amber-400 ring-1 ring-amber-400/40')}
                    />
                </div>
                <ToggleChip
                    label="Home"
                    ariaLabel={`${phrase} bats last`}
                    title={isHome
                        ? `${shown || label} bats last`
                        : `Make ${phrase} home`}
                    checked={isHome}
                    staged={d.isStaged('home_team')}
                    onChange={() => { if (!isHome) d.setField('home_team', side); }}
                />
            </div>
            {team.msbTeam && (
                <div className={cn('flex min-w-0 items-center gap-1.5', mirror && 'flex-row-reverse')}>
                    {logo && (
                        <img src={logo} alt="" width={16} height={16} className="shrink-0 object-contain pixelated" />
                    )}
                    <Text size="xs" span truncate dimmed className="min-w-0">{team.msbTeam}</Text>
                </div>
            )}
            <RosterGrid roster={team.roster} captain={team.captain} mirror={mirror} />
        </div>
    );
});

// One side's runs, in the centre block beside the other side's — the pair is how
// a score is read, so they sit together rather than one per side column.
const ScoreBox = memo(function ScoreBox({ side, d }) {
    const { label } = useSideLabels();
    // `score_left` / `score_right` are the STATE keys and stay as they are —
    // renaming a state key is a migration, and the feed writes them. Only what
    // the box says about itself is vocabulary.
    const field = side === 1 ? 'score_left' : 'score_right';
    const live = side === 1 ? d.g.scoreLeft : d.g.scoreRight;
    return (
        <NumberInput
            aria-label={`Score — ${label(side)}`}
            value={d.val(field, live)}
            onChange={v => d.setField(field, v === '' ? 0 : Number(v))}
            disabled={d.feedLive}
            min={0}
            className={cn(
                'h-9 w-14 px-1 text-center text-xl font-bold tabular-nums', FEED_OWNED,
                d.isStaged(field) && 'border-amber-400/60 text-amber-400',
            )}
        />
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
    // A capture from an EARLIER game is not this game's receipt (../postgame
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

export default function BoardDesk({ board }) {
    const sb = Number(board);
    const d = useBoardDesk(sb);
    const { g, transport } = d;
    const lifecycle = useBoardLifecycle(sb);
    const stats = useStatsDiagnostics(sb);
    const postgame = usePostGame(sb);
    // Owned here because its control and its surface are on two different rows
    // — the Games rule and the Games body (../games `usePlaybackMode`).
    const [playbackMode, setPlaybackMode] = usePlaybackMode(sb);
    const { options: gameModes } = useGameModes();
    const [refreshingHud, setRefreshingHud] = useState(false);

    // Force a re-read of the HUD file — the recovery path after a board has been
    // cleared or hand-edited, so it matches what Project Rio is showing again.
    const refreshHud = useCallback(() => {
        setRefreshingHud(true);
        fetch('/api/v1/rio/refresh', { method: 'POST' })
            .finally(() => setRefreshingHud(false));
    }, []);

    return (
        <>
            {/* WHAT this board is carrying, before what you can do to it. The
                live game is the subject; the bind and the side ordering are
                qualifiers on it, so they read a tier down rather than as three
                competing subjects. */}
            <BoardSubject
                sb={sb} d={d} lifecycle={lifecycle}
                matchId={g.match} match={d.boundMatch} conflict={g.conflict}
                postgame={postgame}
            />
            {g.conflict && (
                <Text size="xs" className="text-amber-500/90">
                    The live players don’t match the bound match — resolve it on the Match desk.
                </Text>
            )}
            {/* THE MIRROR TAKES THE WHOLE PANEL. Beside a wiring column it was
                two thirds of the width, and a lineup does not compress: nine
                character names in a third of a stage truncate to "Dry Bon…",
                which is the one thing a roster readout exists to avoid. The
                wiring is four one-line settings and reads fine below. */}
            <div className="flex flex-col gap-1.5 pt-1">
                {/* score.{N}.*: what is on air this game. KIT_SECTION's `first:`
                    reset is why this one draws no rule: a divider separates
                    siblings and there is nothing above it to separate from. */}
                <KitColumn
                    className={KIT_SECTION}
                    label="Game state"
                    subject={(
                        <ModeRow
                            d={d} gameModes={gameModes} stats={stats}
                            refreshHud={refreshHud} refreshing={refreshingHud}
                        />
                    )}
                    action={<SidesControl d={d} reason={g.sideReason} transport={transport} />}
                >
                    <div className={BOARD_GRID}>
                        <SidePanel side={1} d={d} />

                        {/* The shared frame, between the two sides that share it:
                            the runs as a pair, then the inning, then the count.
                            `pt` clears the sides' eyebrow line so the scores land
                            level with the two name fields. */}
                        <div className="flex shrink-0 flex-col items-center gap-1.5 pt-[1.1rem]">
                            <div className="flex items-center gap-1">
                                <ScoreBox side={1} d={d} />
                                <Text size="sm" span dimmed>–</Text>
                                <ScoreBox side={2} d={d} />
                            </div>
                            <div className="flex items-center gap-1.5">
                                <SimpleSelect
                                    aria-label="Half inning"
                                    data={halfInningOptions}
                                    disabled={d.feedLive}
                                    value={d.val('half_inning', g.halfInning)}
                                    onChange={v => {
                                        d.setField('half_inning', v ?? 'Top');
                                        d.clearAtBatState();
                                    }}
                                    triggerClassName={cn(
                                        '!h-7 w-[4.75rem] text-xs', FEED_OWNED,
                                        d.isStaged('half_inning') && 'border-amber-400/60 text-amber-400',
                                    )}
                                />
                                <NumberInput
                                    aria-label="Inning"
                                    value={d.val('inning', g.inning)}
                                    onChange={v => d.setField('inning', v === '' ? 1 : Number(v))}
                                    disabled={d.feedLive}
                                    min={1} max={99}
                                    className={cn(
                                        'h-7 w-11 px-1 text-center tabular-nums', FEED_OWNED,
                                        d.isStaged('inning') && 'border-amber-400/60 text-amber-400',
                                    )}
                                />
                            </div>
                            <div className="flex flex-col gap-1 pt-0.5">
                                <CountDots
                                    label="B" max={3} hex="#22c55e"
                                    count={d.val('balls', g.balls)}
                                    onChange={v => d.setField('balls', v)}
                                    disabled={d.feedLive}
                                />
                                <CountDots
                                    label="S" max={2} hex="#f5bb00"
                                    count={d.val('strikes', g.strikes)}
                                    onChange={v => d.setField('strikes', v)}
                                    disabled={d.feedLive}
                                />
                                <CountDots
                                    label="O" max={2} hex="#e60012"
                                    count={d.val('outs', g.outs)}
                                    onChange={v => d.setField('outs', v)}
                                    disabled={d.feedLive}
                                />
                            </div>
                        </div>

                        <SidePanel side={2} d={d} />
                    </div>

                    {/* Belongs to the game, not to either side, so it sits under
                        the mirror rather than in one of its halves.

                        SIZED TO ITS CONTENT, not to the panel. There are ten
                        stadiums and the longest is "Bowser Castle"; a selector
                        stretched across the full width of the desk reads as the
                        most important control in the region, which on a board
                        whose feed names the stadium every frame it is not. */}
                    <FieldRow label="Stadium" staged={d.isStaged('stadium')} className="pt-1">
                        <Combobox
                            placeholder="Select stadium"
                            data={STADIUM_OPTIONS}
                            disabled={d.feedLive}
                            value={d.val('stadium', g.stadium) || null}
                            onChange={v => d.setField('stadium', v ?? '')}
                            clearable
                            className={cn(
                                'h-7 w-56 min-w-0 shrink-0 text-xs', FEED_OWNED,
                                d.isStaged('stadium') && 'border-amber-400/60 text-amber-400',
                            )}
                        />
                    </FieldRow>

                    {(g.override1 || g.override2) && (
                        <Text size="xs" className="text-amber-500/90">
                            A name is pinned over the feed until the next game. Clear the
                            field to hand it back.
                        </Text>
                    )}

                    {/* NO CLEAR DOWN HERE. It was the escape hatch for
                        "every other time" — a live game to blank, a hand-built
                        board to start over — while the turnover group up on the
                        subject row owned the press at the end of a game. But that
                        group's Clear is UNCONDITIONAL, so the two were never
                        alternatives: they were both on screen on an empty or live
                        board and only one of them on a final one. What a producer
                        saw was the button MOVING — press Clear at the top, the
                        board empties, and the clear they just used is suddenly
                        also sitting at the bottom of the panel.

                        One press, one place, and the place is the row it acts on.
                        A control that relocates when its subject changes state is
                        its own confusion (the Match desk's `Clear` makes the same
                        argument about its two faces), and the top is the right
                        home: the clear is part of a sequence with Capture and the
                        take, and those three have to be read together. */}
                </KitColumn>

                  {/* THE POOL IS WHAT EARNS A REGION, not the transport. This was
                      "Games" on every board, carrying a badge, a playback
                      sentence, a re-read and the mode across four lines — and on
                      a HUD board ../games returns nothing, so a board with one
                      possible game from one file spent a whole labelled region
                      and a divider saying so. The badge, the mode and the re-read
                      moved up onto the Game-state rule (see ModeRow); what is
                      left is the pool surface, which only an API board has.

                      THE MODE RIDES THE RULE, where the sentence about it used to
                      be. It is the region's subject in the only sense that
                      matters — everything in the body belongs to whichever half
                      is chosen — and as a `fullWidth` segmented at the top of the
                      body it was a two-option control drawn as a ~1100px bar. The
                      pool count and the running flag that the sentence also
                      carried are the rotator's own status line and its own
                      Start/Stop, a few rows down and unable to disagree. */}
                  {d.transport === 'api' && (
                  <KitColumn
                    className={KIT_SECTION}
                    label="Games"
                    subject={<PlaybackModeControl mode={playbackMode} onChange={setPlaybackMode} />}
                    /* Exactly the condition the server polls under: a
                       single-mode board with a pinned game still being played
                       (game_pool._live_consumers_exist). The countdown is the
                       whole of what "following it live" used to say in words. */
                    action={(
                        <LiveRefreshCountdown
                            active={playbackMode !== 'rotate'
                                && d.pinnedGameId != null
                                && d.g.gameLive}
                        />
                    )}
                  >
                    <GamesSection
                        sb={sb} mode={playbackMode}
                        transport={d.transport} gameModes={gameModes}
                    />
                  </KitColumn>
                  )}

                  {/* The board's captured box score. Last because it is the END
                      of a game — and a readout first: the stat file fires the
                      capture on its own, so the subject usually fills itself in
                      and the controls below are the recovery path. Was a desk of
                      its own until its board picker gave it away (see
                      ../postgame).

                      THE VERBS RIDE THE RULE, in the `action` slot the sides'
                      Swap already uses one region up. All three are recovery —
                      the capture that matters fires on its own, and the one on
                      the turnover bar covers the press a producer makes at the
                      end of a game — so as a row of their own under the subject
                      they were the loudest thing in the region and cost it a
                      third of its height for controls nobody reaches for on an
                      ordinary night. On the rule, an uncaptured board is ONE ROW.

                      IT HAS ITS OWN RULE ABOVE IT, like every other region here.
                      The panel drew exactly one divider, hard-coded under Game
                      state, so on an API board the line landed above Games and
                      Post-game ran straight on out of the pool surface, while on
                      a HUD board the board's name ran straight on out of the
                      capture. KIT_SECTION is the kit's one statement of what a
                      section's rule is, `first:` resets included — which is
                      exactly why the Games region can be absent without leaving
                      a rule hanging at the top of the stack. */}
                  <KitColumn
                    className={KIT_SECTION}
                    label="Post-game"
                    subject={<PostGameSubject pg={postgame.pg} />}
                    action={<PostGameActions desk={postgame} />}
                  >
                    <PostGameSection desk={postgame} />
                  </KitColumn>

                {/* WHAT IS LEFT OF "HOW THE BOARD IS WIRED" IS ONE ROW, and it
                    draws itself only on a rig that has a choice to make.

                    GAMES IS ITS OWN REGION AND TAKES THE FULL WIDTH, not a field
                    inside "This board". Choosing between one game and a rotating
                    pool is the biggest decision made about an API board, and each
                    half of it brings a real surface — a live game table, or a
                    filter with a running transport. Squeezed into a shared column
                    beside the name it became a label-gutter row, which is how a
                    demoted control gets read as a minor setting; given only 7 of
                    12 columns it was a tall stack of full-width fields with 300px
                    of empty panel beside it.

                    THE GAME MODE IS NOT A BOARD PROPERTY either. It IS the binding
                    (`scoreboards.binding.{N}.stats_tag`), it decides which tag
                    every stats fetch for this board goes out under, and it is the
                    Game-state rule's own control now (`ModeRow`).

                    AND THE NAME IS RENAMED WHERE IT IS NAMED. A `Name` field sat
                    here, at the foot of a body four regions long, setting the
                    15px title printed at the top of the very same panel — the
                    console's longest distance between a value and its control,
                    and the producer had to scroll past everything the board was
                    doing to reach it. It is the panel title itself now
                    (`PanelShell onRename`, via ../production `deskBodiesFor`).

                    So the region is the running order alone, which appears only
                    on a rig with more than one — and `BoardQueueRow` owns its own
                    section rule for exactly that reason: a section whose only
                    member self-hides must take its divider with it, or a
                    single-order rig draws a rule under the capture with nothing
                    beneath it. No region eyebrow: the row already says "Matches
                    from", and a THIS BOARD label over one row would be a second
                    name for its only member. */}
                <BoardQueueRow sb={sb} />
            </div>
        </>
    );
}
