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

const BRACKET_TYPES = {
    DOUBLE_ELIMINATION: 'Double elimination',
    SINGLE_ELIMINATION: 'Single elimination',
    ROUND_ROBIN: 'Round robin',
};

export default function BracketStage({ element }) {
    const d = useBracketDesk();
    return (
        <>
            <DirectStage element={element} />
            <Text size="xs" className="border-t border-border/60 pt-2 text-muted-foreground">
                {d.loaded
                    ? <>Drawing <b>{d.phaseName}</b>{d.type ? ` · ${BRACKET_TYPES[d.type] || d.type}` : ''}. Switch phase or re-pull from the Bracket desk.</>
                    : <>No bracket loaded — this source will render empty. Pick a phase on the Bracket desk.</>}
            </Text>
        </>
    );
}
