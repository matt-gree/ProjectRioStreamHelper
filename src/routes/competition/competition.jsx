import { useState } from 'react';
import { SegmentedControl } from '../../components/ui/segmented-control';
import TournamentLoader from './tournament_loader';
import TournamentInfo from '../tournament_info/tournament_info';
import Bracket from '../bracket/bracket';

/*
 * Competition — the merged tournament tab (Phase 2).
 *
 * Collapses the former "Competition Info" and "Bracket" tabs into one route.
 * Both already read the same store (useBracketStore) and hook (useTournament)
 * and the same tournamentInfo.bracket_link state key, so this is UI
 * consolidation, not a data-layer change: a segmented control swaps between
 * the metadata + entrants/import-mapping surface and the bracket view.
 *
 * The single TournamentLoader sits below the section switch as shared chrome
 * — the one place to load a tournament for the whole tab. (The switch may be
 * dropped later; the loader is positioned to stand on its own when it is.)
 */

const SECTIONS = [
    { label: 'Info & Entrants', value: 'info' },
    { label: 'Bracket', value: 'bracket' },
];

export default function Competition() {
    const [section, setSection] = useState('info');

    return (
        <div className="flex flex-col gap-4">
            <SegmentedControl data={SECTIONS} value={section} onChange={setSection} />
            <TournamentLoader />
            {/* Keep both mounted so switching sections doesn't refetch or lose
                in-progress edits; just toggle visibility. */}
            <div className={section === 'info' ? '' : 'hidden'}>
                <TournamentInfo />
            </div>
            <div className={section === 'bracket' ? '' : 'hidden'}>
                <Bracket />
            </div>
        </div>
    );
}
