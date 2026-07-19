import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../../context/store';
import { Text } from '../../../components/ui/primitives';
import { PanelShell, chipState } from '../kit';
import { ELEMENTS, isPinnable } from '../elements';
import { elementBindings, useBindingScenes } from '../bindings';
import { DirectStage, FedStage } from './generic';
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

const ElementStage = memo(function ElementStage({ element, pinned, onPinToggle }) {
    const scenes = useBindingScenes();
    const override = useSettingsStore(useShallow(s => s?.production?.overrides?.[element.id]));
    const bindings = elementBindings(element, scenes, override);
    const Body = stageBodyComponent(element);
    return (
        <PanelShell
            state={chipState(bindings)} title={element.name}
            meta={bindings.primary ? bindings.primary.item.sourceName : undefined}
            pinnable={isPinnable(element)} pinned={pinned} onPinToggle={onPinToggle}
        >
            <Body element={element} />
        </PanelShell>
    );
});

// selection is either an element id or a 'desk:<name>' key; deskBodies maps
// the latter to { title, meta, body }.
export const Stage = memo(function Stage({ selection, deskBodies = {}, pins = [], onPinToggle }) {
    const desk = deskBodies[selection];
    if (desk) {
        return (
            <PanelShell
                state="desk" title={desk.title} meta={desk.meta}
                pinnable={desk.pinnable !== false}
                pinned={pins.includes(selection)}
                onPinToggle={() => onPinToggle?.(selection)}
            >
                {desk.body}
            </PanelShell>
        );
    }

    const element = ELEMENTS.find(e => e.id === selection);
    if (!element) {
        return (
            <PanelShell state="unbound" title="Stage" pinnable={false}>
                <Text size="xs" className="text-muted-foreground">
                    Pick anything in the rack to bring its controls here.
                </Text>
            </PanelShell>
        );
    }
    return (
        <ElementStage
            element={element}
            pinned={pins.includes(element.id)}
            onPinToggle={() => onPinToggle?.(element.id)}
        />
    );
});
