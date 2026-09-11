import { memo, useMemo } from 'react';
import { Text } from '../../../components/ui/primitives';
import { PanelShell, chipFor } from '../kit';
import { isPinnable, settingsTypeOf, sizeOptionFor } from '../elements';
import { DESK_PREFIX } from '../instances';
import { placementDims } from '../bindings';
import { useContainerDefs } from '../containers';
import {
    isFedPlacement, placementTarget, resolvePlacement, useConsolePlacements, useConsoleScenes,
    usePlacementLabel,
} from '../placements';
import { SourceStrip } from '../sourcestrip';
import { Subject } from '../subject';
import { DirectStage, FedStage } from './generic';
import { ElementStyleSettings, ElementStyleOverrides } from './overlay-settings';
import { IntroRow, introTypeFor } from './intro';
import SizeMatchRow from './sizematch';
import RedrawRow from './resolution';
import { PlayerNameStage } from './playername';
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

// Exported for `generic.test.jsx`, which renders every one of them to hold the
// rule that a body forwards its `placement` — a guard is only a guard if it
// covers the body added after it was written.
export const STAGE_BODIES = {
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
    playername: PlayerNameStage,
};

/*
 * A placement's stage body: the element's own file when it has one, else the
 * floor the placement's kind guarantees.
 *
 * A CONTAINER is dispatched on being one rather than by id — every container
 * the producer builds is a different element id (`container:{id}`), and they
 * all edit the same two things: the name and the member roster.
 *
 * A MEMBER'S SLOT always takes FedStage, even when the element has a body of
 * its own: that row is the element's place on a container, so the questions it
 * answers are what content to hand over and which container is carrying it —
 * not the element's own live controls, which belong to the source that has
 * them. The hit visualizer is the case that proves it: Replay and Spotlight act
 * on its dedicated source, and rendering them on its slot row would be a panel
 * whose buttons drive a different source than its header does.
 */
export function stageBodyComponent(element, placement) {
    if (element?.container) return ContainerStage;
    // Through the one definition, with the element filled in: a panel can be
    // asked for before its placement resolves, and an element with no source of
    // its own is fed wherever it is asked about.
    if (isFedPlacement({ ...placement, element })) return FedStage;
    return STAGE_BODIES[element.id] ?? DirectStage;
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
    // Through placementDims, so a size VARIANT reports its own canvas rather
    // than the element's default — the preview's "800 × 460" readout is the
    // number a producer sizes their browser source from.
    const { width, height } = placementDims(placement);
    return useMemo(
        () => (width && height ? { width, height } : null),
        [width, height],
    );
}

const ElementStage = memo(function ElementStage({
    placement, placements, title, pinned, onPinToggle,
}) {
    const { element, board } = placement;
    /* The settings NAMESPACE, never the element id — Matchup History is
       `matchuphistory` here and `overlays.matchup.*` in its mount, and a panel
       keyed on the id writes where nothing reads (see settingsTypeOf). */
    const settingsType = settingsTypeOf(element);
    const settingsBoard = element.scope === 'board' ? board : null;
    const settingsLabel = element.scope === 'board'
        ? `${element.name} ${board ?? ''}`.trim()
        : element.name;
    const Body = stageBodyComponent(element, placement);
    const dims = useContainerDims(placement);
    /* The source's ?size=, read once: it picks the theme file an override has
       to reach AND drops the element settings that size doesn't draw. */
    const size = sizeOptionFor(element, placement.variant)?.value;
    return (
        <PanelShell
            state={chipFor(placement)} title={title}
            subject={<Subject placement={placement} />}
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
                <Body element={element} board={board} placement={placement} />
                {/* An OBS ACTION on this source, so it sits with the body's
                    controls rather than under two sections of settings — and
                    above them, because it is the only row here whose effect is
                    a producer's own hand-placed geometry. Renders nothing
                    unless this element comes in sides and both are in this
                    scene (see sizematch.jsx). */}
                <SizeMatchRow placement={placement} placements={placements} />
                {/* ...and the other geometry fact the console can see and OBS
                    never mentions: this source is being STRETCHED rather than
                    redrawn. Renders nothing unless it is (see resolution.jsx),
                    so it sits with the size match rather than below the
                    settings — both are about the source's own shape. */}
                <RedrawRow placement={placement} />
                {/* The body surfaces the settings a producer reaches for live;
                    this is the catch-all so every remaining element setting is
                    still reachable on the stage (phase 7). A body names what it
                    already showed in `surfacedKeys` so nothing doubles up. */}
                <ElementStyleSettings
                    type={settingsType}
                    board={settingsBoard}
                    label={settingsLabel}
                    exclude={Body.surfacedKeys}
                    size={size}
                />
                {/* ...and the GLOBAL design keys this element can pin for
                    itself. Separate section, below its own settings, because a
                    pin is a different kind of decision: an element setting is
                    what this overlay does, an override is this overlay
                    disagreeing with the Design tab. */}
                {/* `leading` is the intro control, riding this section's footer
                    row rather than taking a near-empty row of its own above it
                    (intro.jsx, and the footer's own note). It is a GUEST, not a
                    style override: the two are unrelated, and what they have in
                    common is only that each is one panel-level, set-once
                    control. Renders nothing for an overlay with no intro. */}
                <ElementStyleOverrides
                    type={settingsType}
                    board={settingsBoard}
                    label={settingsLabel}
                    size={size}
                    /* `introTypeFor`, not the component: IntroRow renders
                       null for an overlay with no intro, but the ELEMENT is
                       always truthy, so passing it unconditionally would put a
                       spacer — and a right-aligned Add button — on every panel
                       whose guest draws nothing. */
                    leading={introTypeFor(element) ? <IntroRow element={element} /> : null}
                />
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
    // Handed to resolution so a container whose source has gone still opens its
    // panel under its own name and size — see `sourcelessPlacement`.
    const defs = useContainerDefs();
    const pinnedIds = useMemo(
        () => new Set(pins.map(p => placementTarget(p, placements))),
        [pins, placements],
    );

    /*
     * A stored selection naming a desk that no longer exists — a board since
     * removed — must not fall through to placement resolution: no source has a
     * `desk:` id, so it would resolve to a sourceless placement and offer to bind
     * an OBS source for a board that is gone. A desk id answers here or not at
     * all.
     */
    const desk = deskBodies[selection];
    if (!desk && String(selection ?? '').startsWith(DESK_PREFIX)) {
        return (
            <PanelShell state="unbound" title="Stage" pinnable={false}>
                <Text size="xs" className="text-muted-foreground">
                    That desk is gone — the board it belonged to was removed. Pick
                    another row in the rack.
                </Text>
            </PanelShell>
        );
    }
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
    const placement = resolvePlacement(selection, placements, defs);
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
            placements={placements}
            title={detail ? `${name} · ${detail}` : name}
            pinned={pinnedIds.has(placement.id)}
            onPinToggle={() => onPinToggle?.(placement.id)}
        />
    );
});
