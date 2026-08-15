import { memo, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../../context/store';
import { stageOrRun, usePending } from '../../../context/staging';
import { clearMatchup, fetchMatchup } from '../../../context/match';
import { Text } from '../../../components/ui/primitives';
import { ActionRow, SelectRow } from '../kit';
import { matchDisplayLabel, matchIds } from '../matches';
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

const MatchupContent = memo(function MatchupContent() {
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

    return (
        <>
            <SelectRow
                label="Match" value={sel} onChange={setSelRaw} staged={!!pending}
                options={ids.length
                    ? ids.map(id => ({ label: matchDisplayLabel(matches, id), value: id }))
                    : [{ label: 'No matches yet', value: '' }]}
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
