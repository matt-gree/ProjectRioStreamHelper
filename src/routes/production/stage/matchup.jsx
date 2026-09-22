import { memo, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../../context/store';
import { stageOrRun, usePending } from '../../../context/staging';
import { clearMatchup, fetchMatchup } from '../../../context/match';
import { Text } from '../../../components/ui/primitives';
import { ActionRow, SelectRow } from '../kit';
import { matchDisplayLabel, matchIds } from '../match/matches';
import { DirectStage } from './generic';

/*
 * Matchup History stage — the head-to-head band. The producer picks a match
 * and hits Fetch: the server pulls every completed game between its two
 * participants from the Project Rio API and projects the singleton matchup.*
 * state the overlay renders. Fetch and Clear both REPLACE broadcast-visible
 * content, so both route through the staging gateway (one entry,
 * key 'matchup:fetch').
 */
export default function MatchupStage({ element, placement }) {
    return (
        <>
            <DirectStage element={element} placement={placement} />
            <MatchupContent />
        </>
    );
}

/*
 * The fetch, as the stage and the rail card both drive it: which match is
 * selected (the producer's pick, else the one on air, else the first), and the
 * two staged verbs. One hook so the card and the panel open on the same match
 * and stage the same entry; a pick made on one is local to it.
 */
function useMatchupFetch() {
    const mu = useStateStore(useShallow(s => s?.matchup ?? {}));
    const matches = useStateStore(useShallow(s => s?.match ?? {}));
    const pending = usePending('matchup:fetch');
    const [selRaw, setSelRaw] = useState('');

    const ids = useMemo(() => matchIds(matches), [matches]);
    const sel = selRaw && matches[selRaw] ? selRaw
        : (mu.matchId != null && matches[String(mu.matchId)] ? String(mu.matchId) : (ids[0] || ''));

    const doFetch = () => stageOrRun({
        key: 'matchup:fetch',
        label: `Matchup: ${matchDisplayLabel(matches, sel)}`,
        value: sel,
        run: () => fetchMatchup(Number(sel)),
    });
    const doClear = () => stageOrRun({
        key: 'matchup:fetch', label: 'Clear matchup', value: null, run: () => clearMatchup(),
    });

    const fetchedFor = mu.matchId != null ? String(mu.matchId) : '';
    const stale = mu.present && sel && fetchedFor !== sel;
    const options = ids.length
        ? ids.map(id => ({ label: matchDisplayLabel(matches, id), value: id }))
        : [{ label: 'No matches yet', value: '' }];

    return { mu, pending, sel, setSel: setSelRaw, options, doFetch, doClear, stale };
}

/*
 * The rail card's row: the match and Fetch, side by side on one line — a new
 * set's head-to-head is one press from the rail. Clear stays on the stage: it
 * takes a band off air, which is not a thing to do from a glance. Stale (on air
 * for another match) is the button's tooltip and its fill, since the card has
 * no line to spare for the stage's sentence.
 */
export const MatchupQuickRow = memo(function MatchupQuickRow() {
    const m = useMatchupFetch();
    return (
        <div className="flex min-h-7 min-w-0 items-center gap-2">
            <SelectRow
                label={null} value={m.sel} onChange={m.setSel} staged={!!m.pending}
                options={m.options} className="min-w-0 flex-1"
            />
            <ActionRow fit actions={[{
                label: 'Fetch', onClick: m.doFetch, disabled: !m.sel,
                variant: !m.mu.present || m.stale ? 'default' : 'secondary',
                title: m.stale ? 'On air for another match — Fetch to replace it'
                    : 'Pull this match’s head-to-head from Project Rio',
            }]} />
        </div>
    );
});

const MatchupContent = memo(function MatchupContent() {
    const { mu, pending, sel, setSel: setSelRaw, options, doFetch, doClear, stale } = useMatchupFetch();

    return (
        <>
            <SelectRow
                label="Match" value={sel} onChange={setSelRaw} staged={!!pending}
                options={options}
            />
            <ActionRow actions={[
                { label: 'Fetch', onClick: doFetch, disabled: !sel, variant: 'default' },
                { label: 'Clear', onClick: doClear, disabled: !mu.present && !pending, variant: 'ghost' },
            ]} />
            {/* The fetched series itself is the panel's SUBJECT and the stage
                draws it above this body (../subject). What stays here is what
                the subject can't know: that the band on air was fetched for a
                DIFFERENT match than the one selected above. */}
            {stale ? (
                <Text size="xs" truncate className="text-amber-400">
                    On air for another match — Fetch to replace it.
                </Text>
            ) : !mu.present && (
                <Text size="xs" className="text-muted-foreground">
                    Both sides need Rio names. All-time series + last five games;
                    fetch again after new games finish.
                </Text>
            )}
        </>
    );
});
