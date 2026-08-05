import { memo, useMemo } from 'react';
import { Text } from '../../../components/ui/primitives';
import { PanelShell, chipFor } from '../kit';
import { isPinnable } from '../elements';
import {
    placementTarget, resolvePlacement, useConsolePlacements, useConsoleScenes,
    usePlacementLabel,
} from '../placements';
import { SourceStrip } from '../sourcestrip';
import { Subject } from '../subject';
import { DirectStage, FedStage } from './generic';
import { ElementStyleSettings } from './overlay-settings';
import { IntroRow } from './intro';
import StagePreview from './preview';
import HitVisualizerStage from './hitvisualizer';
import MatchupStage from './matchup';
import ScheduleStage from './schedule';
import PlayerPlatesStage from './playerplates';
import CommentaryStage from './commentary';
import LowerThirdStage from './lowerthird';
import ScorecardStage from './scorecard';
import EventHeaderStage from './eventheader';
import BracketStage from './bracket';
import ControllerStage from './controller';
import ContainerStage from './container';

/*
 * The stage — the console's center surface: ONE selected item's full controls,
 * content-sized (production-console-contract skill). What used to be split
 * across a card face and a gear popover is one panel here; the depth rule is
 * rack row = state + quick face, stage = full controls + basic settings, tab =
 * heavy authoring.
 *
 * Desk bodies are passed in rather than imported so this module stays free of
 * the page shell (they move into ../desks/ in the next slice).
 */

const STAGE_BODIES = {
    hitvisualizer: HitVisualizerStage,
    matchuphistory: MatchupStage,
    schedule: ScheduleStage,
    playerplates: PlayerPlatesStage,
    commentary: CommentaryStage,
    lowerthird: LowerThirdStage,
    scorecard: ScorecardStage,
    eventheader: EventHeaderStage,
    bracket: BracketStage,
    controller: ControllerStage,
};

/*
 * An element's stage body: its own file when it has one, else the floor its
 * flavor guarantees.
 *
 * A CONTAINER is dispatched on being one rather than by id — every container
 * the producer builds is a different element id (`container:{id}`), and they
 * all edit the same two things: the name and the member roster.
 */
export function stageBodyComponent(element) {
    if (element?.container) return ContainerStage;
    return STAGE_BODIES[element.id] ?? (element.flavor === 'fed' ? FedStage : DirectStage);
}

/*
 * The panel commands ONE PLACEMENT — this element, on this board, in this
 * scene. All three coordinates come from the selection and are passed down;
 * nothing here re-derives any of them. Which source the header strip toggles
 * and which settings the body writes are then the same fact as which rack row
 * the producer clicked, and cannot drift apart.
 */
/*
 * A container row IS a source and deserves a preview, and unlike a generic
 * element it knows its own size: `containerElement` carries the definition's,
 * which is the size the OBS source was created at. A container with no
 * definition left (a pre-2.0 named shell) has none, and gets no preview — the
 * same rule as any unregistered source, for the same reason.
 */
function useContainerDims(placement) {
    const { width, height } = placement?.element ?? {};
    return useMemo(
        () => (width && height ? { width, height } : null),
        [width, height],
    );
}

const ElementStage = memo(function ElementStage({ placement, title, pinned, onPinToggle }) {
    const { element, board } = placement;
    const Body = stageBodyComponent(element);
    const dims = useContainerDims(placement);
    return (
        <PanelShell
            state={chipFor(placement)} title={title}
            meta={placement.item?.sourceName}
            primaryAction={<SourceStrip element={element} board={board} placement={placement} />}
            pinnable={isPinnable(element)} pinned={pinned} onPinToggle={onPinToggle}
        >
            {/* Controls, then the preview BELOW them at the panel's full width.
                An overlay is a wide, fixed-size picture — a 1920×1080 scene in
                a 350px side column scales to a thumbnail nobody can read, and
                the stage's own column is the widest space on the page. Width is
                what a preview is worth; a side-by-side split spends it. */}
            <div className="flex min-w-0 flex-col gap-1.5">
                {/* WHAT this is drawing, before WHAT you can do to it. Every
                    other row on the panel is a control and the header strip is
                    transport; without this the stage could describe a source
                    fully and never once say what was on it (../subject). */}
                <Subject placement={placement} />
                <Body element={element} board={board} placement={placement} />
                {/* The body surfaces the settings a producer reaches for live;
                    this is the catch-all so every remaining element setting is
                    still reachable on the stage (phase 7). A body names what it
                    already showed in `surfacedKeys` so nothing doubles up. */}
                <ElementStyleSettings
                    type={element.id}
                    board={element.scope === 'board' ? board : null}
                    label={element.scope === 'board' ? `${element.name} ${board ?? ''}`.trim() : element.name}
                    exclude={Body.surfacedKeys}
                />
                {/* Reveal behaviour for animated overlays — renders nothing for
                    the rest (see intro.jsx). A source-level toggle, so it sits
                    below the element's own style knobs. */}
                <IntroRow element={element} />
            </div>
            {/* A generic placement is a PRSH source the registry has never
                heard of, so we don't know its native size — and a preview at a
                guessed aspect is exactly the failure this column was rebuilt to
                stop telling. It gets the strip and the chip; the picture needs
                a registration. A CONTAINER is the exception: it is generic (its
                element comes from the URL) but the catalog knows its size. */}
            {(!element.generic || dims) && (
                <StagePreview
                    element={element} board={board} binding={placement}
                    width={dims?.width} height={dims?.height}
                />
            )}
        </PanelShell>
    );
});

// selection is either a placement id ('scoreboard:2@Break', 'lowerthird@Game')
// or a 'desk:<name>' key; deskBodies maps the latter to { title, meta, body }.
export const Stage = memo(function Stage({ selection, deskBodies = {}, pins = [], onPinToggle }) {
    const scenes = useConsoleScenes();
    const placements = useConsolePlacements(scenes);
    const label = usePlacementLabel(placements);
    const pinnedIds = useMemo(
        () => new Set(pins.map(p => placementTarget(p, placements))),
        [pins, placements],
    );

    const desk = deskBodies[selection];
    if (desk) {
        return (
            <PanelShell
                state="desk" title={desk.title} meta={desk.meta}
                pinnable={desk.pinnable !== false}
                pinned={pinnedIds.has(selection)}
                onPinToggle={() => onPinToggle?.(selection)}
            >
                {desk.body}
            </PanelShell>
        );
    }

    // Resolution, not a lookup: a selection persisted before scenes were the
    // axis — or naming a scene or board since removed — still lands on a real
    // panel instead of dumping the producer on the empty state.
    const placement = resolvePlacement(selection, placements);
    if (!placement) {
        return (
            <PanelShell state="unbound" title="Stage" pinnable={false}>
                <Text size="xs" className="text-muted-foreground">
                    Pick anything in the rack to bring its controls here — or add
                    an overlay to a scene with the + beside its name.
                </Text>
            </PanelShell>
        );
    }
    const { name, detail } = label(placement);
    return (
        <ElementStage
            placement={placement}
            title={detail ? `${name} · ${detail}` : name}
            pinned={pinnedIds.has(placement.id)}
            onPinToggle={() => onPinToggle?.(placement.id)}
        />
    );
});
