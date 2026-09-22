import { useCallback, useState } from 'react';
import { Text } from '../../../components/ui/primitives';
import { Combobox } from '../../../components/ui/combobox';
import { NumberInput } from '../../../components/ui/number-input';
import { SimpleSelect } from '../../../components/ui/simple-select';
import { cn } from '../../../lib/utils';
import { STADIUM_OPTIONS } from '../../../data/stadiums';
import { FieldRow, KIT_SECTION, KitColumn } from '../kit';
import { GamesSection, PlaybackModeControl, usePlaybackMode } from './games';
import PostGameSection, { PostGameActions, PostGameSubject, usePostGame } from './postgame';
import { useGameModes } from './gamemodes';
import { useBoardLifecycle } from './boards';
import { BOARD_GRID, FEED_OWNED, halfInningOptions } from './shared';
import { useBoardDesk } from './data';
import { CountDots, ScoreBox, SidePanel, SidesControl } from './sides';
import { BoardSubject } from './subject';
import { BoardQueueRow, LiveRefreshCountdown, ModeRow, useStatsDiagnostics } from './feed';

/*
 * Board desk — the console's panel for one scoreboard.
 *
 * A board is a desk, not an element: it feeds the broadcast and is never on it
 * (see ./boards for why the id lives in the desk namespace). This panel is the
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
 * WIRED — settings, which outlive the game: its **Games** (./games, the mode
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



export default function BoardDesk({ board }) {
    const sb = Number(board);
    const d = useBoardDesk(sb);
    const { g, transport } = d;
    const lifecycle = useBoardLifecycle(sb);
    const stats = useStatsDiagnostics(sb);
    const postgame = usePostGame(sb);
    // Owned here because its control and its surface are on two different rows
    // — the Games rule and the Games body (./games `usePlaybackMode`).
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
                      a HUD board ./games returns nothing, so a board with one
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
                      ./postgame).

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
