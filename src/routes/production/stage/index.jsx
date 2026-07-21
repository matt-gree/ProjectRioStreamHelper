import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../../context/store';
import { Text } from '../../../components/ui/primitives';
import { PanelShell, chipState } from '../kit';
import { isPinnable } from '../elements';
import { elementBindings, useBindingScenes } from '../bindings';
import {
    pinTarget, resolveInstance, useInstanceLabel, useProductionInstances,
} from '../instances';
import { SourceStrip } from '../sourcestrip';
import { DirectStage, FedStage } from './generic';
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
};

// An element's stage body: its own file when it has one, else the floor its
// flavor guarantees.
export function stageBodyComponent(element) {
    return STAGE_BODIES[element.id] ?? (element.flavor === 'fed' ? FedStage : DirectStage);
}

const ElementStage = memo(function ElementStage({ instance, title, pinned, onPinToggle }) {
    const { element, board } = instance;
    const scenes = useBindingScenes();
    const override = useSettingsStore(useShallow(s => s?.production?.overrides?.[element.id]));
    // The board comes from the SELECTION now (../instances), not from a hidden
    // per-element preference. Which board this panel commands is the same fact
    // as which rack row the producer clicked, so the strip's source and the
    // body's settings cannot point at different boards.
    const bindings = elementBindings(element, scenes, override, board);
    const Body = stageBodyComponent(element);
    return (
        <PanelShell
            state={chipState(bindings)} title={title}
            meta={bindings.primary ? bindings.primary.item.sourceName : undefined}
            primaryAction={<SourceStrip element={element} board={board} />}
            pinnable={isPinnable(element)} pinned={pinned} onPinToggle={onPinToggle}
        >
            {/* Controls, then the preview BELOW them at the panel's full width.
                An overlay is a wide, fixed-size picture — a 1920×1080 scene in
                a 350px side column scales to a thumbnail nobody can read, and
                the stage's own column is the widest space on the page. Width is
                what a preview is worth; a side-by-side split spends it. */}
            <div className="flex min-w-0 flex-col gap-1.5">
                <Body element={element} board={board} />
            </div>
            <StagePreview
                element={element} board={board} binding={bindings.primary}
            />
        </PanelShell>
    );
});

// selection is either an instance id ('scoreboard:2', 'lowerthird') or a
// 'desk:<name>' key; deskBodies maps the latter to { title, meta, body }.
export const Stage = memo(function Stage({ selection, deskBodies = {}, pins = [], onPinToggle }) {
    const instances = useProductionInstances();
    const label = useInstanceLabel(instances);
    const pinnedIds = useMemo(
        () => new Set(pins.map(p => pinTarget(p, instances))),
        [pins, instances],
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

    // Resolution, not a lookup: a selection persisted before instances existed
    // — or against a board that has since been removed — still lands on a real
    // panel instead of dumping the producer on the empty state.
    const instance = resolveInstance(selection, instances);
    if (!instance) {
        return (
            <PanelShell state="unbound" title="Stage" pinnable={false}>
                <Text size="xs" className="text-muted-foreground">
                    Pick anything in the rack to bring its controls here.
                </Text>
            </PanelShell>
        );
    }
    const { name, board } = label(instance);
    return (
        <ElementStage
            instance={instance}
            title={board ? `${name} · ${board}` : name}
            pinned={pinnedIds.has(instance.id)}
            onPinToggle={() => onPinToggle?.(instance.id)}
        />
    );
});
