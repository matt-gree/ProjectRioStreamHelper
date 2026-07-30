import { memo } from 'react';
import { Text } from '../../components/ui/primitives';
import { ActionRow, SelectRow } from './kit';
import { FEED_OPTION_HOOKS, flattenGroups } from './feed-pickers';
import { quickFaceFor } from './elements';
import { useContainerPush } from './feeds';
import { useConsoleOffline } from './placements';
import { SourceToggleRow } from './stage/generic';
import { ScorecardModeRow, useScorecard } from './stage/scorecard';
import { EventHeaderBandRows, useEventHeader } from './stage/eventheader';
import { useCaptureDesk } from './desks/capture';
import { BracketPhasePicker, useBracketDesk } from './desks/bracket';

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

// Direct element: the one decision that matters live — is it on the broadcast.
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
const PickableFedQuickFace = memo(function PickableFedQuickFace({ element, useOptions }) {
    const o = useOptions(element);
    const { mine, canPush, toggle } = useContainerPush(element);
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
    const { mine, canPush, toggle } = useContainerPush(element);
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
        ? <PickableFedQuickFace element={element} useOptions={useOptions} />
        : <PushOnlyFedQuickFace element={element} placement={placement} />;
});

// Capture desk: pick the board, capture. The only desk with a compliant face.
const CaptureQuickFace = memo(function CaptureQuickFace() {
    const d = useCaptureDesk();
    return (
        <>
            <Text size="xs" truncate className="text-muted-foreground">
                {d.pg.present
                    ? `${d.pg.n1 || 'Side 1'} ${d.pg.s1 ?? 0}–${d.pg.s2 ?? 0} ${d.pg.n2 || 'Side 2'}`
                    : 'Nothing captured'}
            </Text>
            <ActionRow actions={[
                {
                    label: d.busy ? 'Capturing…' : 'Capture',
                    variant: 'default', disabled: d.busy, onClick: d.capture,
                },
                ...(d.pg.present ? [{ label: 'Clear', variant: 'ghost', disabled: d.busy, onClick: d.clear }] : []),
            ]} />
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

// Bracket desk: switch phase, or re-pull the one on screen after results land.
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

export const DESK_QUICK_FACES = {
    'desk:capture': CaptureQuickFace,
    'desk:bracket': BracketQuickFace,
};

// Elements whose quick face isn't the flavor default. Adding one is a design
// decision, not a convenience: it must still fit the two-row cap.
const ELEMENT_QUICK_FACES = {
    scorecard: ScorecardQuickFace,
    eventheader: EventHeaderQuickFace,
};

// The quick face for a registered element, by flavor. Returns null when the
// element declared quickFace: null (the rail should not be offering it).
export const QuickFace = memo(function QuickFace({ element, placement, board }) {
    const face = quickFaceFor(element);
    if (!face) return null;
    const Custom = ELEMENT_QUICK_FACES[element.id];
    // `board` is the pinned placement's board — a board-scoped face (Scorecard)
    // must write the same board the card's chip reads.
    if (Custom) return <Custom element={element} placement={placement} board={board} />;
    return element.flavor === 'fed'
        ? <FedQuickFace element={element} placement={placement} />
        : <DirectQuickFace element={element} placement={placement} />;
});
