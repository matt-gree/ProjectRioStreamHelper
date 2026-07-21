import { memo } from 'react';
import { Text } from '../../components/ui/primitives';
import { ActionRow, SelectRow } from './kit';
import { FEED_OPTION_HOOKS, flattenGroups } from './feed-pickers';
import { quickFaceFor } from './elements';
import {
    defaultContainerFor, useContainerBinding, useContainerPush, useContainerTarget,
} from './feeds';
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

// Direct element: the one decision that matters live — is it on the broadcast.
const DirectQuickFace = memo(function DirectQuickFace({ element: _element, bindings }) {
    if (!bindings?.primary) {
        return <Text size="xs" className="text-muted-foreground">No source in program or preview.</Text>;
    }
    return (
        <SourceToggleRow
            label={bindings.primary.where === 'preview' ? 'In preview' : 'On air'}
            item={bindings.primary.item} sceneName={bindings.primary.scene}
        />
    );
});

// The container's on-air state — the first row of every fed quick face.
const ContainerRow = memo(function ContainerRow({ container }) {
    const binding = useContainerBinding(container);
    if (!binding) {
        return <Text size="xs" className="text-muted-foreground">Container not in program or preview.</Text>;
    }
    return (
        <SourceToggleRow
            label={binding.where === 'preview' ? 'Container in preview' : 'Container on air'}
            item={binding.item} sceneName={binding.scene}
        />
    );
});

/*
 * Fed element with choices (Stats, Character Spotlight): the content pick
 * itself, as one row. Picking IS feeding, so no separate push is needed — and
 * that is what makes a pinned Stats card useful on its own, rather than only
 * re-pushing whatever the stage last chose.
 */
const PickableFedQuickFace = memo(function PickableFedQuickFace({ element, useOptions }) {
    const o = useOptions(element);
    const { container } = useContainerTarget(element.id, defaultContainerFor(element));
    if (o.empty) return <Text size="xs" className="text-muted-foreground">{o.empty}</Text>;
    return (
        <>
            <ContainerRow container={container} />
            <SelectRow
                label={null} value={o.value} onChange={o.choose} staged={o.staged}
                placeholder="Nothing fed" options={flattenGroups(o.groups)}
            />
        </>
    );
});

// Fed element with nothing to pick (Game Summary): push it, or hand the
// container back. The only decision is timing.
const PushOnlyFedQuickFace = memo(function PushOnlyFedQuickFace({ element }) {
    const { container, mine, canPush, toggle } = useContainerPush(element);
    return (
        <>
            <ContainerRow container={container} />
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

const FedQuickFace = memo(function FedQuickFace({ element }) {
    const useOptions = FEED_OPTION_HOOKS[element.feed];
    return useOptions
        ? <PickableFedQuickFace element={element} useOptions={useOptions} />
        : <PushOnlyFedQuickFace element={element} />;
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
const ScorecardQuickFace = memo(function ScorecardQuickFace({ element, bindings, board }) {
    const sc = useScorecard(board);
    return (
        <>
            <DirectQuickFace element={element} bindings={bindings} />
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
export const QuickFace = memo(function QuickFace({ element, bindings, board }) {
    const face = quickFaceFor(element);
    if (!face) return null;
    const Custom = ELEMENT_QUICK_FACES[element.id];
    // `board` is the pinned instance's board — a board-scoped face (Scorecard)
    // must write the same board the card's chip reads.
    if (Custom) return <Custom element={element} bindings={bindings} board={board} />;
    return element.flavor === 'fed'
        ? <FedQuickFace element={element} />
        : <DirectQuickFace element={element} bindings={bindings} />;
});
