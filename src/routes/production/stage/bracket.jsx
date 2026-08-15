import { RefreshCw } from 'lucide-react';
import { Text } from '../../../components/ui/primitives';
import { ActionRow } from '../kit';
import { DirectStage } from './generic';
import { BracketPhasePicker, useBracketDesk } from '../bracket';

/*
 * Bracket stage — visibility, plus WHICH phase this source draws.
 *
 * The phase used to be chosen on a Bracket desk, on the reasoning that one
 * global publish deserves one owner. What that missed is that every consumer
 * already carries the picker: this stage's own `useBracketDesk`, and the
 * lower-third's bracket slot (../stage/lowerthird). The desk was a third copy of
 * a control the two surfaces that need it already had, holding a permanent rack
 * row for a workflow that only matters when something is on air to draw it.
 *
 * So it lives here, on the source. The rack lists sources across EVERY scene
 * (../placements), so a bracket source anywhere in OBS is reachable without
 * changing scenes — which is what the desk was really providing.
 *
 * The phase is still global (`bracket.*`, one loaded phase for all bracket
 * sources); the picker says so rather than pretending to be per-source. Loads
 * are momentary — they fetch and publish immediately rather than staging, same
 * as the Competition tab's own selector.
 */

export default function BracketStage({ element }) {
    const d = useBracketDesk();
    return (
        <>
            <DirectStage element={element} />
            <BracketPhasePicker desk={d} />
            <ActionRow actions={[
                {
                    label: d.busy ? 'Loading…' : 'Refresh',
                    icon: RefreshCw,
                    disabled: d.busy || d.phaseGroupId == null,
                    title: 'Re-pull this phase from start.gg',
                    onClick: d.refresh,
                },
            ]} />
            <Text size="xs" className="border-t border-border/60 pt-2 text-muted-foreground">
                {d.loaded
                    ? 'Every bracket source draws this phase — refresh after results land on start.gg.'
                    : 'Pick a phase to give this source something to draw. Events are loaded on the Competition tab.'}
            </Text>
        </>
    );
}
