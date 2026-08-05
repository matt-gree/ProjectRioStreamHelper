import { Text } from '../../../components/ui/primitives';
import { DirectStage } from './generic';
import { useBracketDesk } from '../desks/bracket';

/*
 * Bracket stage — visibility, plus what the source will actually draw.
 *
 * Choosing the phase is the Bracket desk's job (one workflow, one place), so
 * this reports rather than duplicates: a bracket source that's on air with
 * nothing loaded renders empty, and that's worth saying here rather than
 * leaving the producer to discover it in the program feed.
 */

export default function BracketStage({ element }) {
    const d = useBracketDesk();
    return (
        <>
            <DirectStage element={element} />
            {/* WHICH phase is drawn is the panel's subject and the stage draws
                it above this body (../subject). What is left to say is where to
                change it — one workflow, one place. */}
            <Text size="xs" className="border-t border-border/60 pt-2 text-muted-foreground">
                {d.loaded
                    ? 'Switch phase or re-pull from the Bracket desk.'
                    : 'Pick a phase on the Bracket desk to give this source something to draw.'}
            </Text>
        </>
    );
}
