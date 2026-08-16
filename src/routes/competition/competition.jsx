import { useState } from 'react';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { Panel } from '../../components/ui/panel';
import { Text } from '../../components/ui/primitives';
import { useStateStore } from '../../context/store';
import TournamentLoader from './tournament_loader';
import EntrantsPanel from './entrants';
import TournamentInfo from '../tournament_info/tournament_info';
import Bracket from '../bracket/bracket';

/*
 * Competition — one page about one loaded event.
 *
 * It was two pages behind a segmented control: "Info & Entrants" and "Bracket".
 * Both were views of the SAME loaded event, so the switch asked a producer to
 * choose between the event's facts and the event's sets — and it bundled the
 * competition form in with the entrants table, which is why that form's width
 * was a function of whether a tournament had been loaded.
 *
 * The form is a fixed left column now. The switch survives but is demoted to
 * what it was always really choosing: which LIST fills the right column.
 * Entrants is setup-time work (map the field into the Address Book) and Sets is
 * run-time (load tonight's matches), so they are genuinely alternatives — and
 * the form stays on screen for both, which it never did before.
 *
 * Both views are kept mounted so switching doesn't refetch or lose in-progress
 * edits; only visibility toggles.
 */

const LISTS = [
    { label: 'Entrants', value: 'entrants' },
    { label: 'Sets', value: 'sets' },
];

export default function Competition() {
    const [list, setList] = useState('entrants');
    const loaded = useStateStore(s => !!s?.tournamentInfo?.bracket_link);

    return (
        /*
         * TWO COLUMNS FROM THE TOP EDGE. The loader used to be a full-width row
         * above both, which bought nothing — it is one input and a button, so it
         * spanned the page to hold ~640px of content — and cost the right column
         * its first ~95px, starting the list a card's height down the screen
         * from where the page begins.
         *
         * It belongs in the left column with the form: both are "the event's
         * inputs", they are the same width, and the lists get the full height
         * beside them.
         */
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
            {/* The left column owns the width — the loader and the form are the
                same 40rem at every size, rather than each capping itself. */}
            <div className="flex w-full min-w-0 max-w-[40rem] flex-col gap-4 xl:w-[40rem] xl:shrink-0">
                <TournamentLoader />
                <TournamentInfo />
            </div>

            {/*
             * One panel, one header, the switch in it — the two lists are
             * alternatives, not two more cards to scroll past.
             *
             * THE HEIGHT FLOWS; it is not two magic numbers. Each list used to
             * size its own scroll area against the VIEWPORT (`calc(100vh -
             * 280px)` in one file, `- 320px` in the other), so the two had to be
             * kept in step by hand and both went stale the moment this card
             * moved up the page — leaving 64px of dead panel under a list that
             * was scrolling. The column is told how tall it is once, and every
             * box between here and the scroll viewport just passes it down.
             */}
            {/* A DEFINITE height at both breakpoints, because the flex chain
                below needs one to divide: `6.5rem` is this card's own top offset
                (the app chrome plus the page's padding) once it sits beside the
                left column, and `70vh` is the stacked case, where it sits under
                the form and the page scrolls to it. */}
            <div className="flex h-[70vh] min-w-0 flex-1 flex-col xl:h-[calc(100vh-6.5rem)]">
                {loaded ? (
                    <Panel
                        title="Event"
                        className="flex min-h-0 flex-1 flex-col"
                        actions={
                            <SegmentedControl
                                size="xs" data={LISTS} value={list} onChange={setList}
                            />
                        }
                    >
                        <div className="flex min-h-0 flex-1 flex-col p-4">
                            {LISTS.map(({ value }) => (
                                <div
                                    key={value}
                                    data-list={value}
                                    data-active={list === value ? '' : undefined}
                                    className={list === value ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
                                >
                                    {value === 'entrants' ? <EntrantsPanel /> : <Bracket />}
                                </div>
                            ))}
                        </div>
                    </Panel>
                ) : (
                    /* Said ONCE, for both lists, and IN THE SPACE THE LISTS WILL
                       FILL — each view used to carry its own copy, so an empty
                       page could print the same sentence twice. */
                    <Text size="sm" dimmed className="block p-4">
                        Load a start.gg event to see its entrants and its sets.
                    </Text>
                )}
            </div>
        </div>
    );
}
