import { memo, useState } from 'react';
import { Text } from '../../components/ui/primitives';
import { ActionRow, SelectRow } from './kit';
import { FEED_OPTION_HOOKS, flattenGroups } from './feed-pickers';
import { quickFaceFor, settingsTypeOf, sizeOptionFor } from './elements';
import { useContainerPush } from './feeds';
import { useMemberScope } from './containers';
import { isFedPlacement } from './placements';
import { boardOfDeskId, useMatchBindableBoards } from './boards';
import { useNextUp } from './queue';
import { takeNextMatch } from '../../context/match';
import { notifications } from '../../lib/notify';
import { BoardGameSubject, Subject } from './subject';
import {
    SettingSegments, defsFor, useLiveDefs, useOverlaySettings,
} from './stage/overlay-settings';
import { settingReachesSize } from '../design/designConstants';
import { BracketPhasePicker, useBracketDesk } from './bracket';
import { LowerThirdSegmentChips } from './stage/lowerthird';
import { CommentarySeatChips } from './stage/commentary';
import { HitVizQuickActions } from './stage/hitvisualizer';
import { MatchupQuickRow } from './stage/matchup';
import { useBoardDesk } from './desks/board';

/*
 * Quick faces — the ≤2-row control set an element exposes on a rail card
 * (production-console-contract skill). The cap is enforced structurally by
 * QuickCard; these components stay honest by construction: one row of state,
 * one row of action, everything deeper defers to the stage.
 *
 * Flavor defaults come from quickFaceFor() in elements.js; this module renders
 * them. An element with quickFace: null never reaches here — it isn't pinnable.
 */

/*
 * Fed element with choices (Character Spotlight): pick the content, then push
 * it. The container's own show/hide is the card header's eye (../rail).
 *
 * Picking ARMS (writes the element's intent); it airs only if this element
 * already holds the container. Push is what takes an armed pick on air — the
 * same decoupling as the stage, so the rail and the stage mean one thing by a
 * pick. `placeholder` (the "Nothing fed" clear) shows only while on air, where
 * clearing means take-off-stage; off air it would clear whatever else is up.
 */
const PickableFedQuickFace = memo(function PickableFedQuickFace({ element, useOptions, placement }) {
    // The card's OWN container, and the board that container is scoped to — a
    // scoped member can be pinned from two of them, and a lookup from the
    // element would push both cards into one. The options come from the same
    // board the push lands on, so the card cannot offer a pick it won't send.
    const { scoreboard } = useMemberScope(element, placement?.slot);
    const o = useOptions(element, scoreboard);
    const { mine, canPush, toggle } = useContainerPush(element, scoreboard, placement?.slot);
    if (o.empty) return <Text size="xs" className="text-muted-foreground">{o.empty}</Text>;
    return (
        <>
            <SelectRow
                label={null} value={o.value} onChange={o.choose} staged={o.staged}
                placeholder={o.live ? 'Nothing fed' : undefined}
                options={flattenGroups(o.groups)}
            />
            <ActionRow actions={[
                {
                    label: mine ? 'Clear' : 'Push',
                    variant: mine ? 'ghost' : 'default',
                    disabled: !mine && !canPush,
                    title: mine ? 'Take this off the container' : 'Push the armed pick onto the container',
                    onClick: toggle,
                },
            ]} />
        </>
    );
});

// Fed element with nothing to pick (Game Summary): what it would put up, then
// push it or hand the container back. The only decision is timing. Showing
// the container itself is the card header's eye (../rail).
const PushOnlyFedQuickFace = memo(function PushOnlyFedQuickFace({ element, placement }) {
    const { scoreboard } = useMemberScope(element, placement?.slot);
    const { mine, canPush, toggle } = useContainerPush(element, scoreboard, placement?.slot);
    return (
        <>
            <Subject placement={placement} />
            <ActionRow actions={[
                {
                    label: mine ? 'Clear' : 'Push',
                    variant: mine ? 'ghost' : 'default',
                    disabled: !mine && !canPush,
                    title: mine ? 'Hand the container back' : 'Push this onto the container',
                    onClick: toggle,
                },
            ]} />
        </>
    );
});

const FedQuickFace = memo(function FedQuickFace({ element, placement }) {
    const useOptions = FEED_OPTION_HOOKS[element.feed];
    return useOptions
        ? <PickableFedQuickFace element={element} useOptions={useOptions} placement={placement} />
        : <PushOnlyFedQuickFace element={element} placement={placement} />;
});

/*
 * The direct flavor's DEFAULT face: what it's drawing.
 *
 * Whether it's ON is the card header's eye (../rail) — the rack row's control,
 * in the rack row's place. It was a labelled switch row here, which made a card
 * a worse copy of the rack row it was pinned from; the subject is what the rail
 * can say that the rack deliberately won't (a second line per rack row would
 * cost the density that makes it a monitor).
 *
 * `Subject` renders nothing for an element with no live content of its own, so
 * those cards are the header alone — the eye and the pin.
 */
const DefaultDirectQuickFace = memo(function DefaultDirectQuickFace({ placement }) {
    return <Subject placement={placement} />;
});

/*
 * The `setting` row: the element's declared `quickSettings`, drawn exactly as
 * its stage draws them (SettingSegments — switches pack into one chip strip,
 * so a run of them spends one row), writing through the same staging gateway.
 *
 * It resolves its namespace the way the stage does (./stage/index): a
 * board-scoped element stores per board, so the card writes the board its chip
 * reads. And it takes the SOURCE's size: the scoreboard's sizes are one layout
 * with one registry list, so a key whose part the pinned size doesn't draw is
 * dropped here exactly as the stage drops it — a Small card never offers
 * Rosters. Palette settings dead under the active package drop out too
 * (useLiveDefs).
 */
const QuickSettingsRow = memo(function QuickSettingsRow({ element, placement, board }) {
    const type = settingsTypeOf(element);
    const scoped = element.scope === 'board' && board != null;
    const os = useOverlaySettings(
        type,
        scoped ? `${type}.${board}` : type,
        scoped ? `${element.name} ${board}` : element.name,
        scoped ? board : null,
    );
    const size = sizeOptionFor(element, placement?.variant)?.value;
    const defs = useLiveDefs(type, defsFor(type, element.quickSettings ?? [])
        .filter(def => settingReachesSize(def, type, size)));
    if (defs.length === 0) return null;
    return <SettingSegments os={os} defs={defs} compact />;
});

const FACE_ROWS = {
    subject: ({ placement }) => <Subject placement={placement} />,
    setting: QuickSettingsRow,
};

/*
 * A direct face declared in the registry as rows — subject and setting, in the
 * order the element names them. This is what
 * lets an element put its live look on the rail with one registry entry rather
 * than a component here: the Scoreboard, both stat cards, the Scorecard and the
 * Event Header are all this face.
 */
const RowsQuickFace = memo(function RowsQuickFace({ element, placement, board, rows }) {
    return rows.map((row) => {
        const Row = FACE_ROWS[row];
        return Row
            ? <Row key={row} element={element} placement={placement} board={board} />
            : null;
    });
});

/*
 * Bracket: switch phase, or re-pull the one on screen after results land.
 *
 * The one bracket control with a live tempo — start.gg advances all night and
 * the drawn phase goes stale — so it earns a card even though the source toggle
 * does not. This is the face the deleted Bracket desk carried, moved to the
 * source it acts on (../stage/bracket). The phase is global: pinning two bracket
 * sources gives two cards driving one loaded phase, which is what they draw.
 */
const BracketQuickFace = memo(function BracketQuickFace() {
    const d = useBracketDesk();
    return (
        <>
            <BracketPhasePicker desk={d} label={null} />
            <ActionRow actions={[
                {
                    label: d.busy ? 'Loading…' : 'Refresh',
                    disabled: d.busy || d.phaseGroupId == null,
                    onClick: d.refresh,
                },
            ]} />
        </>
    );
});

/*
 * Board desk: what the board is carrying, then the two corrections a producer
 * makes without stopping to look — the sides are backwards, or the HUD frame
 * landed wrong. Everything else about a board is stage work.
 */
const BoardQuickFace = memo(function BoardQuickFace({ id }) {
    const sb = boardOfDeskId(id);
    const d = useBoardDesk(sb);
    // The board's OWN running order, so the card names the fixture this board
    // would actually take rather than the head of the union.
    const nextUp = useNextUp(sb);
    // …and nothing to take at all on a rotating board: a match has two fixed
    // sides and a rotation has none, so the server 409s the bind. Same single
    // client statement of the rule the Match desk's chips and the board panel's
    // fixture slot read (./boards useMatchBindableBoards).
    const canBind = useMatchBindableBoards()(sb);
    const next = canBind ? nextUp : null;
    const [refreshing, setRefreshing] = useState(false);
    const [taking, setTaking] = useState(false);
    const refreshHud = () => {
        setRefreshing(true);
        fetch('/api/v1/rio/refresh', { method: 'POST' }).finally(() => setRefreshing(false));
    };
    const takeNext = () => {
        setTaking(true);
        takeNextMatch(sb)
            .catch(e => notifications.show({ message: `Up next: ${e?.message || e}`, color: 'red' }))
            .finally(() => setTaking(false));
    };
    /*
     * UP NEXT EARNS THE FIRST SLOT when the queue has something waiting. The rail
     * is the surface for flying the show, and "that game just ended, put the next
     * fixture up" is the most live thing a board does — one press instead of
     * finding the match in a stack and clicking its board chip.
     *
     * It displaces RE-READ HUD, never Swap sides. The face is capped at two rows
     * and the subject takes one, so something has to give — and swap is the
     * correction a producer makes most often mid-game, where re-read is a recovery
     * path they reach for at the panel. Anything queued would otherwise take swap
     * off the card for the whole night.
     *
     * The label is bare here and names the fixture only in its tooltip: a 252px
     * card splitting two buttons cannot hold "Up next · Erin vs Frank" without
     * truncating it, and the panel is where the fixture is spelled out.
     */
    const actions = [
        ...(next
            ? [{
                label: 'Up next', onClick: takeNext, disabled: taking,
                title: `Put ${next.label} on this board — the next match in the queue`,
            }]
            : []),
        { label: 'Swap sides', onClick: d.swapSides },
        ...(!next && d.transport === 'hud'
            ? [{
                label: refreshing ? 'Re-reading…' : 'Re-read HUD',
                onClick: refreshHud, disabled: refreshing,
            }]
            : []),
    ];
    return (
        <>
            <BoardGameSubject board={sb} />
            <ActionRow actions={actions} />
        </>
    );
});

/*
 * Fixed desks with a rail face. Empty: Match is the only fixed desk and its
 * dense fixture authoring does not fit the two-row cap, so every pinnable desk
 * card resolves through BoardQuickFace below.
 *
 * Kept as a map rather than deleted — the tier is the shape, and a desk that
 * earns a face registers here beside the resolver that reads it.
 */
export const DESK_QUICK_FACES = {};

/*
 * A desk's quick face, or null when it has none (Match — dense fixture
 * authoring, nothing that fits the two-row cap).
 *
 * A resolver rather than a map read, because a board's id carries the board and
 * the rail therefore cannot key components on it. The face takes the id and
 * reads the board back out of it, so the rail passes one prop for every desk.
 */
export function deskQuickFace(id) {
    if (boardOfDeskId(id) != null) return BoardQuickFace;
    return DESK_QUICK_FACES[id] ?? null;
}

// Elements whose quick face isn't the flavor default. Adding one is a design
// decision, not a convenience: it must still fit the two-row cap.
/*
 * `strip` faces: show/hide over the element's own CONTENT — state, not
 * settings, so it cannot ride `quickSettings`. Each strip lives beside the
 * stage code whose reads and staged writes it reuses.
 */
/*
 * `action` faces: what the element is showing, then its own one-shot verbs.
 * The verbs live beside the stage code they share a hook with.
 */
const HitVizQuickFace = memo(function HitVizQuickFace({ placement, board }) {
    return (
        <>
            <Subject placement={placement} />
            <HitVizQuickActions board={board} />
        </>
    );
});

const MatchupQuickFace = memo(function MatchupQuickFace({ placement }) {
    return (
        <>
            <Subject placement={placement} />
            <MatchupQuickRow />
        </>
    );
});

const ELEMENT_QUICK_FACES = {
    bracket: BracketQuickFace,
    hitvisualizer: HitVizQuickFace,
    matchuphistory: MatchupQuickFace,
    lowerthird: LowerThirdSegmentChips,
    commentary: CommentarySeatChips,
};

// The quick face for a registered element, by flavor. Returns null when the
// element declared quickFace: null (the rail should not be offering it).
export const QuickFace = memo(function QuickFace({ element, placement, board }) {
    const face = quickFaceFor(element);
    if (!face) return null;
    /*
     * A pin of a member's SLOT gets the fed face, whatever the element is
     * elsewhere: that card's Push hands the container this element's content,
     * and its chip already reads both halves of being on air. A pin of the
     * element's own source gets the element's own face — including the custom
     * ones, which drive settings that belong to that source.
     */
    if (isFedPlacement(placement)) return <FedQuickFace element={element} placement={placement} />;
    const Custom = ELEMENT_QUICK_FACES[element.id];
    // `board` is the pinned placement's board — a board-scoped face (Scoreboard)
    // must write the same board the card's chip reads.
    if (Custom) return <Custom element={element} placement={placement} board={board} />;
    // A face with a `setting` row is declared rows, rendered as declared.
    if (face.rows.includes('setting')) {
        return <RowsQuickFace element={element} placement={placement} board={board} rows={face.rows} />;
    }
    return <DefaultDirectQuickFace placement={placement} />;
});
