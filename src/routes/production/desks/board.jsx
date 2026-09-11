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
import { ActionRow, Eyebrow, FieldRow, GAME_STAGE, KitColumn, KitColumns, TextRow, ToggleChip } from '../kit';
import { GamesSection } from '../games';
import PostGameSection, { PostGameSubject, usePostGame } from '../postgame';
import { useBoardQueueId, useNextUp, useQueues } from '../queue';
import { useGameModes, withHeldModes } from '../gamemodes';
import { isStaleBoard, useBoardLifecycle, useMatchBindableBoards } from '../boards';
import { useSideLabels } from '../sides';
import { bindScoreboard, takeNextMatch } from '../../../context/match';

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
const poolSize = (ids) => (Array.isArray(ids) ? ids.length : 0);

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
    manual: 'set by hand',
    match: 'from the bound match',
    pin: 'pinned in the Address Book',
    back_to_back: 'as they were last game',
};

/*
 * WHICH LAYER SEATED THE SIDES — three words on the region’s own eyebrow.
 *
 * It was a sentence one tier under the subject: "Alice on the left — pinned in
 * Settings", later "Alice on side 1 — pinned in the Address Book". Two of its
 * three parts were already drawn larger a few pixels below, in the mirror: which
 * player is on which side is the whole point of that graphic, and repeating it
 * in prose is how a panel gets read as wordy. What the mirror CANNOT show is the
 * only part worth keeping — why the order is what it is — so that is all that is
 * left, and it rides the header rule beside the controls that change it.
 */
export function sideReasonPhrase(reason) {
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
 * This is the sentence; ../games holds the controls that set it.
 */
export function playbackLine({ transport, mode, running, poolCount, gameId, live }) {
    if (transport === 'hud') return 'One game — the local HUD feed.';
    if (mode === 'rotate') {
        // Rotation on with an empty pool is a real state (nothing matched the
        // filters yet), and "0 in pool" reads like a count that failed.
        if (!poolCount) return 'Rotating — nothing in its pool yet.';
        return running
            ? `Rotating — ${poolCount} in pool.`
            : `Rotating (paused) — ${poolCount} in pool.`;
    }
    // A pinned game that is still being played tracks the ongoing feed on its
    // own, server-side (OngoingGamePool._reapply_single_live). Saying so is what
    // the panel owed the producer: the game list below is a BROWSER they refresh
    // when they want to see what else is on, and it was easy to read the two as
    // one thing back when that list re-fetched on a visible countdown.
    if (gameId) return live ? 'One game, pinned — following it live.' : 'One game, pinned.';
    return poolCount
        ? `One game — following the newest of ${poolCount} in pool.`
        : 'One game — nothing in its pool yet.';
}

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
const TakeNextButton = memo(function TakeNextButton({ sb, label }) {
    const [taking, setTaking] = useState(false);
    const take = () => {
        setTaking(true);
        takeNextMatch(sb)
            .catch(e => notifications.show({ message: `Up next: ${e?.message || e}`, color: 'red' }))
            .finally(() => setTaking(false));
    };
    return (
        <Button
            size="xs" variant="secondary" className="h-7 shrink-0"
            onClick={take} disabled={taking}
            title={`Put ${label} on this board — the next match in the queue`}
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
 * THE GAME SLOT — the board's first clock, in the same shape as its second.
 *
 * A board runs TWO clocks and the panel drew them as different kinds of thing.
 * The game (score.{N}: empty → live → final/stranded, feed-owned, watched) was a
 * bare line of text; the match (match.{M}: draft → live → post, producer-owned,
 * driven) was a bordered slot with an id chip, both players and the round. Same
 * subject, two registers, so the pair never read as the two halves of one
 * question — which is most of why the game state was described as "hidden".
 *
 * One shape now, twice: chip · side · score · side · where it is up to.
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

const GameSlot = memo(function GameSlot({ d, lifecycle }) {
    const { label } = useSideLabels();
    const { g } = d;
    const shell = 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2 py-1.5';

    if (!g.name1 && !g.name2) {
        return (
            <div className={cn(shell, 'border-dashed border-border/50')}>
                <SlotChip title="Nothing has loaded onto this board">NO GAME</SlotChip>
                <Text size="xs" dimmed className="min-w-0 flex-1 truncate">
                    {d.transport === 'hud'
                        ? 'Waiting for Project Rio to write a game.'
                        : 'Waiting for a game from this board’s pool.'}
                </Text>
            </div>
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
        <div className={cn(shell, 'border-border/60 bg-secondary/30')}>
            {stage && (
                <SlotChip title={stage.title} className={stage.className}>{stage.label}</SlotChip>
            )}
            <span className="min-w-0 flex-1 truncate text-sm">{g.name1 || label(1)}</span>
            <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                {g.scoreLeft ?? 0}–{g.scoreRight ?? 0}
            </span>
            <span className="min-w-0 flex-1 truncate text-right text-sm">{g.name2 || label(2)}</span>
            {where && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{where}</span>}
        </div>
    );
});

/*
 * THE FIXTURE SLOT — which fixture this board is carrying, as a PLACE rather than
 * a sentence about one.
 *
 * It was a line of prose that read "No match on this board" when empty: a
 * statement ABOUT absence, sitting where a bound fixture printed
 * "Match 2 · Winners R2 · 1–0" — prose as well, and prose that never said who was
 * playing, which is the first thing a producer checks a fixture for. Neither
 * state looked like the thing it was describing.
 *
 * One shape, three states, and the SHAPE carries the state:
 *
 *   bound    solid holder with the fixture in it — id, the two players with the
 *            series between them, the round and phase as a trailing qualifier.
 *   waiting  the same holder, DASHED, holding a GHOST of the fixture that would
 *            fill it, with the take beside it. The producer reads what they are
 *            about to put on air in the place it is about to appear.
 *   empty    dashed and quiet, naming where fixtures come from instead of
 *            restating that there aren't any.
 *
 * Dashed-means-unbound is the console's existing vocabulary (the `—` chip), not a
 * new idiom, and the two filled states differ in surface as well as border — the
 * rule that a selection must be visible in a stack, applied to a slot.
 *
 * The take no longer has to name its fixture ("Up next · FrostyFeet492"), because
 * the slot it acts on names it an inch to the left. That rule — never change what
 * is on air from a control that doesn't say what to — is satisfied more strongly
 * by putting the fixture and the verb in one box than by cramming the name into
 * the button, where it was truncating at 60% of the row.
 */
const FixtureSlot = memo(function FixtureSlot({ sb, matchId, match, conflict }) {
    const next = useNextUp(sb);
    const canBind = useMatchBindableBoards()(sb);
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

    const shell = (extra) => cn(
        'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2 py-1.5',
        extra,
    );

    if (bound) {
        const w1 = num(match?.series?.[1] ?? match?.series?.['1'], 0);
        const w2 = num(match?.series?.[2] ?? match?.series?.['2'], 0);
        /*
         * THE SERIES IS ONLY NEWS IN A SERIES. `default_match()` is
         * `{"bestOf": 1}` and a Bo1 night is what almost every night is, where
         * this cell reads 0–0 for the whole match and then 1–0 once the capture
         * lands — a number that says nothing the row above it does not, in the
         * middle of the two names, which is the widest thing a Bo1 slot prints.
         * A Bo3 needs it and keeps it.
         */
        const series = num(match?.bestOf, 1) > 1;
        const round = [match?.label, match?.phase].filter(Boolean).join(' · ');
        /*
         * WHEN IS A FIXTURE DONE? `decided`, never `stage` — the server only ever
         * moves stage forward, and a Bo3 sits at `post` BETWEEN GAMES while still
         * being the current fixture (server/schedule.py states this rule once, for
         * `not_waiting_reason`; this is the same question asked on the panel).
         *
         * The two states say different things and the slot says both, because
         * "what happens when a match goes to post" was invisible here: a finished
         * fixture and a mid-series one rendered identically, and a producer at the
         * end of a match had no way to tell that nothing was going to clear it for
         * them. Only ONE server path unbinds by itself (`_retire_match_from_board`
         * — a decided match plus a new game between different players), so on the
         * ordinary end of a night, clearing the board is the producer's move.
         */
        const done = match?.decided === 1 || match?.decided === 2;
        const between = !done && match?.stage === 'post';
        const winner = done ? (match.decided === 1 ? match?.name1 : match?.name2) : '';
        return (
            <div
                className={cn(
                    'min-w-0 rounded-md border px-2 py-1.5',
                    conflict
                        // Amber is what the console spends on "you would want to
                        // know before this is on air" — the same tone the conflict
                        // sentence below already uses, so the slot and its
                        // explanation match.
                        ? 'border-amber-500/50 bg-amber-500/5'
                        : 'border-border/60 bg-secondary/30',
                )}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="label-display shrink-0 rounded bg-secondary px-1 text-[10px] tracking-wider text-muted-foreground">
                    M{matchId}
                </span>
                {/* The winner reads at full strength and the loser drops a tier:
                    the result is the thing you are checking at this point, and it
                    needs no colour to say it. */}
                <span className={cn(
                    'min-w-0 flex-1 truncate text-sm',
                    done && match.decided !== 1 ? 'text-muted-foreground' : 'text-foreground',
                )}>
                    {match?.name1 || 'Side 1'}
                </span>
                {series ? (
                    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                        {w1}–{w2}
                    </span>
                ) : (
                    <span className="shrink-0 text-xs text-muted-foreground/60">vs</span>
                )}
                <span className={cn(
                    'min-w-0 flex-1 truncate text-right text-sm',
                    done && match.decided !== 2 ? 'text-muted-foreground' : 'text-foreground',
                )}>
                    {match?.name2 || 'Side 2'}
                </span>
                {done && (
                    <span
                        className="label-display shrink-0 rounded bg-secondary px-1 text-[10px] tracking-wider text-foreground"
                        title={winner ? `${winner} took the series` : 'Series decided'}
                    >
                        FINAL
                    </span>
                )}
                {round && (
                    <span className="shrink-0 truncate text-xs text-muted-foreground">{round}</span>
                )}
                {between && (
                    // Why nothing cleared: the game is over, the FIXTURE isn't.
                    <span className="shrink-0 truncate text-xs text-muted-foreground">
                        between games
                    </span>
                )}
                {/*
                 * UNBIND, from the board's side. It used to live only on the
                 * Match desk's lit bind chip — correct, since a match fills one
                 * board so retiring IS unbinding that chip, but it asked a
                 * producer looking at the wrong fixture ON THIS BOARD to go find
                 * the match holding it. The verb belongs wherever the fact is
                 * shown, and both routes are the same staged write.
                 *
                 * No confirm: it unbinds, it doesn't delete — the fixture keeps
                 * its series and goes back to the running order, and Up next puts
                 * it straight back.
                 */}
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
                            stagedOff
                                ? 'text-amber-400'
                                : 'text-muted-foreground/70 hover:text-foreground',
                        )}
                    >
                        <Unlink size={13} />
                    </button>
                </SimpleTooltip>
              </div>

              {/*
                * THE END-OF-MATCH MOVE, in the slot the match is finishing in.
                *
                * A decided fixture stays bound — deliberately, since only a new
                * game between different players auto-retires one — so the board
                * sat on a finished match with the take hidden behind an unbind the
                * producer had to know to press first. Taking the next fixture
                * needs no unbind: `bind_board` overwrites `score.{N}.match`, so
                * Put on board IS the handover.
                *
                * THERE IS EXACTLY ONE TAKE ON THE PANEL AT A TIME. This is the
                * FIXTURE's end of life and holds while the board is empty; the
                * turnover bar's is the GAME's, for the Bo1 whose match is not
                * decided yet because the capture that decides it has not been
                * made — so the bar stands its take down whenever this one is up
                * (see TurnoverBar `fixtureDone`).
                */}
              {done && (
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/50 pt-1.5">
                    {/* DONE with nothing beside it IS the statement. The line
                        that used to fill the value slot ("clear the board when
                        you're ready") pointed at the turnover bar's own Clear,
                        which is on screen and lit at exactly this moment. */}
                    <Eyebrow title={next
                        ? 'The next fixture waiting in this board’s running order.'
                        : 'This match is decided and nothing else is waiting in the running order.'}>
                        {next ? 'UP NEXT' : 'DONE'}
                    </Eyebrow>
                    {next && (
                        <Text size="xs" dimmed className="min-w-0 flex-1 truncate">{next.label}</Text>
                    )}
                    {next && canBind && <TakeNextButton sb={sb} label={next.label} />}
                </div>
              )}
            </div>
        );
    }

    /*
     * A ROTATING BOARD CANNOT HOLD A FIXTURE, and the slot says so instead of
     * offering a take the server would 409. A match encodes both sides of one
     * fixture; a board cycling a pool has no fixed sides to project onto — the
     * same rule as `bind_scoreboard` / `take_next_match` on the server and the
     * Match desk's dimmed bind chips (../boards `useMatchBindableBoards` is the
     * one client statement of it).
     *
     * It sits AFTER the bound branch on purpose: a board switched to rotate while
     * already holding a match still shows that match, because unbinding it is
     * exactly how a producer fixes that state.
     */
    if (!canBind) {
        return (
            <div className={shell('border-dashed border-border/50')}>
                {/* Two boards can say NO MATCH for different reasons, and the
                    reason is the whole content of this row — so it is the
                    eyebrow's own word, not a sentence after it. */}
                <Eyebrow title="A rotating board can’t hold a match: a match encodes both sides of one fixture, and a board cycling a pool has no fixed sides to project onto.">
                    ROTATING
                </Eyebrow>
                <Text size="xs" dimmed className="min-w-0 flex-1 truncate">No match</Text>
            </div>
        );
    }

    if (next) {
        return (
            <div className={shell('border-dashed border-border/70')}>
                <span className="label-display shrink-0 text-[10px] tracking-wider text-muted-foreground/70">
                    UP NEXT
                </span>
                {/* The ghost: dimmed because it is not on the board yet. */}
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {next.label}
                </span>
                <TakeNextButton sb={sb} label={next.label} />
            </div>
        );
    }

    return (
        <div className={shell('border-dashed border-border/50')}>
            <Eyebrow title="Nothing is waiting in this board’s running order. Author a fixture on the Match desk and it joins the order.">
                NO MATCH
            </Eyebrow>
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
 * The board's TYPE in one word — `playbackLine` compressed to what fits a rack
 * row. The two axes produce exactly three states, because HUD + rotate is not a
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

    // The playback axis, for the readout only — this desk does not author it yet.
    const playback = useSettingsStore(useShallow(s => {
        const p = s?.scoreboards?.binding?.[sb]?.playback
            ?? s?.scoreboards?.binding?.[String(sb)]?.playback ?? {};
        return {
            mode: p.mode || 'single',
            running: !!p.running,
            gameId: p.gameId ?? null,
        };
    }));
    // Mirrored into State by the server, so a rotating board's pool size is a
    // read rather than a fetch (the rack draws this on every frame too).
    const poolCount = useStateStore(
        s => poolSize(s?.scoreboards?.rotation?.[sb]?.game_ids),
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
    const resetGame = () => stageOrRun({
        // The staging KEY stays `reset` — it is an id, and the Match desk and the
        // quick face stage against it — but what a producer reads in the confirm
        // buffer is the verb printed on the button they pressed.
        key: `board:${sb}:reset`,
        label: `Board ${sb}: clear game state`,
        value: true,
        run: () => {
            if (transport === 'hud') {
                fetch('/api/v1/rio/release', { method: 'POST' }).catch(() => {});
            }
            const entries = [
                ['score_left', 0], ['score_right', 0], ['inning', 1], ['half_inning', 'Top'],
                ['outs', 0], ['strikes', 0], ['balls', 0],
                ['cbRioRunnerOn1', false], ['cbRioRunnerOn2', false], ['cbRioRunnerOn3', false],
                ['runner1Name', ''], ['runner2Name', ''], ['runner3Name', ''],
                ['batter', ''], ['pitcher', ''], ['batter_hand', 0], ['pitcher_hand', 0],
                ['batterSide', 'right'], ['batter_roster_index', -1], ['pitcher_roster_index', -1],
                ['star_chance', false], ['game_completed', false], ['game_over', false],
                ['game_id', null],
                ['home_team', 2], ['innings_selected', null], ['stadium', ''],
                ['tag_set', null],
                // The resolved name beside tag_set's raw id; both feeds write it,
                // so both have to be cleared or an overlay keeps naming the old mode.
                ['game_mode', ''],
                ['side_reason', ''], ['away_linescore', []], ['home_linescore', []],
            ];
            for (const pos of ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']) {
                entries.push([`field.${pos}`, '']);
            }
            for (const t of [1, 2]) {
                entries.push(
                    [`player.${t}.rioName`, ''], [`player.${t}.name`, ''],
                    [`player.${t}.msb_team`, ''], [`player.${t}.team`, ''],
                    [`player.${t}.rio_captainIndex`, -1], [`player.${t}.logo`, ''],
                    [`player.${t}.port`, null], [`player.${t}.team_stars`, 0],
                    [`player.${t}.batting_hands`, []], [`player.${t}.fielding_hands`, []],
                );
                for (let i = 0; i < 9; i++) {
                    entries.push(
                        [`player.${t}.character.${i}.name`, ''],
                        [`player.${t}.character.${i}.is_starred`, false],
                        [`player.${t}.character.${i}.position`, ''],
                    );
                }
            }
            setItems(entries.map(([k, v]) => ({ key: `${base}.${k}`, value: v })));
        },
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
        sb, base, transport, feedLive, statsTag, statsTagManual, liveMode, playback, poolCount,
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
    const phrase = sideReasonPhrase(reason);
    // Only the HUD feed carries the server-side override, so only a HUD board
    // can be handed back (see releaseSides).
    const releasable = manual && transport === 'hud';
    return (
        <>
            {phrase && (
                <Text
                    size="xs" span truncate
                    className={cn('min-w-0', manual ? 'text-amber-500/90' : 'text-muted-foreground')}
                >
                    Sides {phrase}
                </Text>
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
 * live `score.{N}` keys and deliberately leaves `postgame.{N}` alone. The
 * captured box score is a DIFFERENT broadcast surface (the Game Summary and
 * Character Spotlight draw it), it is the thing most likely to be on air while
 * the next fixture is being prepped, and it has its own Clear in the post-game
 * region. Dropping it here would be the irreversible half of a verb whose
 * reversible half is what was asked for.
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
 * `fixtureDone` keeps there being exactly ONE take on the panel: a decided
 * fixture offers its own, in the slot it is finishing in, and holds it after the
 * board is cleared — so this one stands down rather than printing a second.
 */
const TurnoverBar = memo(function TurnoverBar({
    sb, lifecycle, matchId, fixtureDone, onClear, clearStaged, postgame,
}) {
    const next = useNextUp(sb);
    const canBind = useMatchBindableBoards()(sb);
    if (!isStaleBoard(lifecycle)) return null;

    const { pg, stale, busy, capture } = postgame;
    // A capture from an EARLIER game is not this game's receipt (../postgame
    // reads the capture's own gameId to tell them apart), so the bar still
    // offers the press.
    const captured = pg.present && !stale;
    const bound = matchId != null && matchId !== '';

    return (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/60 bg-secondary/20 px-2 py-1.5">
            {captured ? (
                // THE RECEIPT IS THREE WORDS, NOT THE BOX SCORE. The post-game
                // region below prints that, badge and all, and a panel that says
                // the same thing twice is the wordiness this rework is about.
                // What the bar owes the producer is only whether press one
                // happened.
                <Text size="xs" truncate dimmed className="min-w-0 flex-1">
                    {pg.capturedBy === 'auto' ? 'Captured automatically.' : 'Captured.'}
                </Text>
            ) : (
                <>
                    <Text size="xs" truncate dimmed className="min-w-0 flex-1">
                        {bound ? `Nothing captured for M${matchId} yet.` : 'Nothing captured.'}
                    </Text>
                    <SimpleTooltip label="Read this game’s stat file — it advances the match to post-game and credits the series">
                        <Button
                            variant="ghost" size="xs" className="shrink-0"
                            onClick={() => capture()} disabled={busy}
                        >
                            Capture
                        </Button>
                    </SimpleTooltip>
                </>
            )}
            <SimpleTooltip label="Blank this board’s live game. The captured box score stays — it has its own Clear below.">
                <Button
                    variant="ghost"
                    size="xs"
                    onClick={onClear}
                    className={cn('shrink-0', clearStaged && 'text-amber-400')}
                >
                    {clearStaged ? 'Clear staged' : 'Clear game state'}
                </Button>
            </SimpleTooltip>
            {next && canBind && !fixtureDone && <TakeNextButton sb={sb} label={next.label} />}
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
    const { options: gameModes } = useGameModes();
    const [refreshingHud, setRefreshingHud] = useState(false);
    const aliases = useSettingsStore(s => s?.scoreboards?.aliases);
    const storedAlias = aliases?.[sb] ?? aliases?.[String(sb)] ?? '';

    // Force a re-read of the HUD file — the recovery path after a board has been
    // cleared or hand-edited, so it matches what Project Rio is showing again.
    const refreshHud = useCallback(() => {
        setRefreshingHud(true);
        fetch('/api/v1/rio/refresh', { method: 'POST' })
            .finally(() => setRefreshingHud(false));
    }, []);

    const commitAlias = useCallback((next) => {
        const v = (next ?? '').trim();
        if (v === storedAlias) return;
        fetch(`/api/v1/scoreboards/${sb}/alias?alias=${encodeURIComponent(v)}`, { method: 'PUT' })
            .catch(e => notifications.show({ message: `Rename: ${e?.message || e}`, color: 'red' }));
    }, [sb, storedAlias]);

    return (
        <>
            {/* WHAT this board is carrying, before what you can do to it. The
                live game is the subject; the bind and the side ordering are
                qualifiers on it, so they read a tier down rather than as three
                competing subjects. */}
            <GameSlot d={d} lifecycle={lifecycle} />
            <FixtureSlot sb={sb} matchId={g.match} match={d.boundMatch} conflict={g.conflict} />
            <TurnoverBar
                sb={sb}
                lifecycle={lifecycle}
                matchId={g.match}
                fixtureDone={d.boundMatch?.decided === 1 || d.boundMatch?.decided === 2}
                onClear={d.resetGame}
                clearStaged={d.isStaged('reset')}
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
                {/* score.{N}.*: what is on air this game. */}
                <KitColumn
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

                    {/* The escape hatch, at the bottom of the thing it escapes
                        from, and ALONE: Swap sat beside it and the pair read as
                        two equal buttons, when one flips an orientation and the
                        other blanks the board. Swap belongs with the layer that
                        decides it, on the region's own rule (see SidesControl).

                        ONE VERB, ONE NAME, ONE BUTTON. This and the turnover bar's
                        are the same `resetGame`, and were called "Reset game
                        state" and "Clear the board" — two names on one panel for
                        one press, with "reset" additionally suggesting a return to
                        defaults rather than what it does, which is empty the
                        board. Naming them the same thing then showed the real
                        problem: both were on screen at once at the end of a game.
                        The bar owns the press at the moment it is part of a
                        sequence; this is the hatch for every other time — a live
                        game to blank, a hand-built board to start over — so it
                        stands down while the bar is up. `fit` because a lone
                        button given `flex-1` was a ~1200px banner. */}
                    {!isStaleBoard(lifecycle) && (
                        <ActionRow
                            fit
                            className="pt-0.5"
                            actions={[
                                {
                                    label: 'Clear game state', onClick: d.resetGame, variant: 'outline',
                                    className: 'border-destructive/40 text-destructive hover:bg-destructive/10',
                                },
                            ]}
                        />
                    )}
                </KitColumn>

                <Divider className="my-1.5" />
{/* THE POOL IS WHAT EARNS A REGION, not the transport. This was
                      "Games" on every board, carrying a badge, a playback
                      sentence, a re-read and the mode across four lines — and on
                      a HUD board ../games returns nothing, so a board with one
                      possible game from one file spent a whole labelled region
                      and a divider saying so. The badge, the mode and the re-read
                      moved up onto the Game-state rule (see ModeRow); what is
                      left is the pool surface, which only an API board has.

                      The playback sentence stays down here with it, because on an
                      API board it IS the region's subject — a live game table or a
                      filter with a running transport is what it describes. */}
                  {d.transport === 'api' && (
                  <KitColumn
                    label="Games"
                    subject={(
                        <>
                            <Text size="xs" truncate dimmed className="min-w-0">
                                {playbackLine({
                                    transport: d.transport,
                                    mode: d.playback.mode,
                                    running: d.playback.running,
                                    gameId: d.playback.gameId,
                                    poolCount: d.poolCount,
                                    live: d.g.gameLive,
                                })}
                            </Text>
                            {/* Exactly the condition the server polls under: a
                                single-mode board with a pinned game still being
                                played (game_pool._live_consumers_exist). */}
                            <LiveRefreshCountdown
                                active={d.playback.mode !== 'rotate'
                                    && d.playback.gameId != null
                                    && d.g.gameLive}
                            />
                        </>
                    )}
                  >
                    <GamesSection sb={sb} transport={d.transport} gameModes={gameModes} />
                  </KitColumn>
                  )}

                  {/* The board's captured box score. Last because it is the END
                      of a game — and a readout first: the stat file fires the
                      capture on its own, so the subject usually fills itself in
                      and the controls below are the recovery path. Was a desk of
                      its own until its board picker gave it away (see
                      ../postgame). */}
                  <KitColumn label="Post-game" subject={<PostGameSubject pg={postgame.pg} />}>
                    <PostGameSection desk={postgame} />
                  </KitColumn>

                {/* How the board is WIRED — settings, which outlive this game, so
                    they read below what is on air rather than beside it.
                    PROPERTIES ONLY: whether this board exists at all is rig
                    membership, and that belongs to the rack's BOARDS section
                    beside the + that adds one (see RowRemove in ../rack).

                    GAMES IS ITS OWN REGION AND TAKES THE FULL WIDTH, not a field
                    inside "This board". Choosing between one game and a rotating
                    pool is the biggest decision made about an API board, and each
                    half of it brings a real surface — a live game table, or a
                    filter with a running transport. Squeezed into a shared column
                    beside the name it became a label-gutter row, which is how a
                    demoted control gets read as a minor setting; given only 7 of
                    12 columns it was a tall stack of full-width fields with 300px
                    of empty panel beside it. The width is what lets the rotator
                    put its pool and its transport side by side (../games) and the
                    game table show a mode name without truncating it.

                    THE GAME MODE IS NOT A BOARD PROPERTY. It lived up here as a
                    field beside the board's Name, with the Games region that
                    actually owns it directly underneath and nothing tying the two
                    together — a mode floating above a header that had its own
                    badge and sentence, so it read as one more setting rather than
                    part of what this board is fetching. It IS the binding
                    (`scoreboards.binding.{N}.stats_tag`), it decides which tag
                    every stats fetch for this board goes out under, and on a HUD
                    board it was the only thing in this half of the panel a
                    producer ever changes. It is the Games region's first row now.

                    WHAT IS LEFT IS THE LEAST URGENT THING ON THE PANEL, so it goes
                    last. Sat above Games it was a bare labelled field wedged
                    between two regions with eyebrows, which is what made the
                    bottom half read as a pile rather than as three regions: a
                    board's name is set once and its running order once a night,
                    while everything above changes every game. Ordered by how often
                    a producer touches it, the panel now reads game state → where
                    the games come from → what the last one ended as → what this
                    board is called.

                    No region eyebrow on purpose: the rows already say "Matches
                    from" and "Name", so a THIS BOARD label would be a third label
                    line stating nothing they don't. */}
                <KitColumns>
                    {/* Which running order Up next walks for THIS board. Only
                        once there is more than one to choose between: on a
                        single-order rig the answer is "the only one", and a
                        picker with one option is a control that cannot do
                        anything. Authored here rather than on the Match desk
                        because it is a property of the board, not of the order —
                        the order's own heading just reports the consequence. */}
                    <BoardQueueRow sb={sb} />

                    {/* TextRow echoes keystrokes locally and writes once you stop
                        or blur — a rename is a settings round-trip and every
                        overlay reading the alias would otherwise redraw per
                        letter. */}
                    <TextRow
                        label="Name" value={storedAlias} placeholder={`Scoreboard ${sb}`}
                        onChange={commitAlias}
                    />
                    {/* A third, empty cell. `KitColumns` is a 2-up grid and the
                        running order only appears on a rig with more than one, so
                        without this the Name spread across the whole panel on the
                        single-order rig that is almost every rig. */}
                    <span aria-hidden />
                </KitColumns>
            </div>
        </>
    );
}
