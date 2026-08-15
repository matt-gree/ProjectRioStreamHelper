import { memo, useState } from 'react';
import { Text } from '../../components/ui/primitives';
import { ActionRow, SelectRow } from './kit';
import { FEED_OPTION_HOOKS, flattenGroups } from './feed-pickers';
import { quickFaceFor } from './elements';
import { useContainerPush } from './feeds';
import { isFedPlacement, useConsoleOffline } from './placements';
import { boardOfDeskId, useMatchBindableBoards } from './boards';
import { useNextUp } from './queue';
import { takeNextMatch } from '../../context/match';
import { notifications } from '../../lib/notify';
import { BoardGameSubject, Subject } from './subject';
import { SourceToggleRow } from './stage/generic';
import { ScorecardModeRow, useScorecard } from './stage/scorecard';
import { EventHeaderBandRows, useEventHeader } from './stage/eventheader';
import { BracketPhasePicker, useBracketDesk } from './bracket';
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

// What the toggle row calls itself. The scene is part of the answer now: the
// same overlay can be pinned twice from two scenes, and "On air" is true of at
// most one of them.
function whereLabel(placement, what) {
    const where = placement.where === 'program' ? 'on air'
        : placement.where === 'preview' ? 'in preview'
            : `in ${placement.scene}`;
    return what ? `${what} ${where}` : where[0].toUpperCase() + where.slice(1);
}

/*
 * Direct element, row 2: the one decision that matters live — is it on the
 * broadcast. Kept as its own single-row component because the custom faces
 * (Scorecard) compose it as their state row and must not inherit a subject on
 * top of their own second row.
 */
const DirectQuickFace = memo(function DirectQuickFace({ element: _element, placement }) {
    const offline = useConsoleOffline();
    if (!placement?.item) {
        // "No longer" would be a claim we can't make: with OBS offline the
        // source may be sitting in a scene we simply can't see right now — which
        // is worth SAYING when that is the actual reason, since a rail card has
        // no room to explain twice.
        return (
            <Text size="xs" className="text-muted-foreground">
                {offline ? 'OBS not connected.' : 'Not in any scene we can see.'}
            </Text>
        );
    }
    return (
        <SourceToggleRow
            label={whereLabel(placement)}
            item={placement.item} sceneName={placement.scene}
        />
    );
});

// The container's state — the first row of every fed quick face. A fed
// placement IS its container's source, so the pin already names which scene's
// copy this card flies.
const ContainerRow = memo(function ContainerRow({ placement }) {
    const offline = useConsoleOffline();
    if (!placement?.item) {
        return (
            <Text size="xs" className="text-muted-foreground">
                {offline
                    ? 'OBS not connected.'
                    : 'That container isn’t in any scene we can see.'}
            </Text>
        );
    }
    return (
        <SourceToggleRow
            label={whereLabel(placement, 'Container')}
            item={placement.item} sceneName={placement.scene}
        />
    );
});

/*
 * Fed element with choices (Stats, Character Spotlight): pick the content, then
 * push it. Two rows, so the container-visibility toggle steps aside — the card
 * chip already reports on-air state, and pick+push is what makes the card
 * self-sufficient.
 *
 * Picking ARMS (writes the element's intent); it airs only if this element
 * already holds the container. Push is what takes an armed pick on air — the
 * same decoupling as the stage, so the rail and the stage mean one thing by a
 * pick. `placeholder` (the "Nothing fed" clear) shows only while on air, where
 * clearing means take-off-stage; off air it would clear whatever else is up.
 */
const PickableFedQuickFace = memo(function PickableFedQuickFace({ element, useOptions, placement }) {
    const o = useOptions(element);
    // The card's OWN container — a scoped member can be pinned from two of
    // them, and a lookup from the element would push both cards into one.
    const { mine, canPush, toggle } = useContainerPush(element, 1, placement?.slot);
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

// Fed element with nothing to pick (Game Summary): push it, or hand the
// container back. The only decision is timing.
const PushOnlyFedQuickFace = memo(function PushOnlyFedQuickFace({ element, placement }) {
    const { mine, canPush, toggle } = useContainerPush(element, 1, placement?.slot);
    return (
        <>
            <ContainerRow placement={placement} />
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
 * The direct flavor's DEFAULT face: what it's drawing, then whether it's on.
 *
 * A card that is only an on/off switch is a worse copy of the rack row it was
 * pinned from — same control, minus the scene it sits in. Eleven of the
 * console's elements defaulted to exactly that, which made the rail look like a
 * surface for one kind of element (Scorecard, Event Header) that everything
 * else was tolerated on. The subject is what the rail can say that the rack
 * deliberately won't: the rack is a dense scannable monitor and a second line
 * per row would cost it that, while a card has the height and is already
 * opt-in.
 *
 * `Subject` renders nothing for an element with no live content of its own, so
 * those cards degrade to the single toggle they were, rather than carrying an
 * empty row — the two-row cap is a budget, not a quota.
 */
const DefaultDirectQuickFace = memo(function DefaultDirectQuickFace({ element, placement }) {
    return (
        <>
            <Subject placement={placement} />
            <DirectQuickFace element={element} placement={placement} />
        </>
    );
});

// Scorecard: on air + which score block. Its other eight bands are stage work —
// these are the two a producer reaches for without leaving the rail.
const ScorecardQuickFace = memo(function ScorecardQuickFace({ element, placement, board }) {
    const sc = useScorecard(board);
    return (
        <>
            <DirectQuickFace element={element} placement={placement} />
            <ScorecardModeRow sc={sc} />
        </>
    );
});

// Event header: the two bands. Its source is almost always resident on air, so
// the useful live decision is which band is showing, not the source toggle —
// that stays one click away on the stage.
const EventHeaderQuickFace = memo(function EventHeaderQuickFace() {
    const os = useEventHeader();
    return <EventHeaderBandRows os={os} />;
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
                title: `Put ${next.label} on this board — the next fixture in the queue`,
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
const ELEMENT_QUICK_FACES = {
    scorecard: ScorecardQuickFace,
    eventheader: EventHeaderQuickFace,
    bracket: BracketQuickFace,
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
    // `board` is the pinned placement's board — a board-scoped face (Scorecard)
    // must write the same board the card's chip reads.
    if (Custom) return <Custom element={element} placement={placement} board={board} />;
    return <DefaultDirectQuickFace element={element} placement={placement} />;
});
