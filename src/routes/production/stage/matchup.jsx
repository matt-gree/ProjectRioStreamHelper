import { memo, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../../context/store';
import { stageOrRun, usePending } from '../../../context/staging';
import { clearMatchup, fetchMatchup } from '../../../context/match';
import { Text } from '../../../components/ui/primitives';
import { cn } from '../../../lib/utils';
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
export default function MatchupStage({ element }) {
    return (
        <>
            <DirectStage element={element} />
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
            {mu.present ? (
                <Text size="xs" truncate className={cn(stale ? 'text-amber-400' : 'text-muted-foreground')}>
                    {mu.side1?.rioName} {mu.side1?.wins}–{mu.side2?.wins} {mu.side2?.rioName}
                    {' · '}{mu.totalGames} game{mu.totalGames === 1 ? '' : 's'}
                    {stale ? ' (other match)' : ''}
                </Text>
            ) : (
                <Text size="xs" className="text-muted-foreground">
                    Nothing fetched yet — both sides need Rio names. All-time series + last
                    five games; fetch again after new games finish.
                </Text>
            )}
        </>
    );
});
