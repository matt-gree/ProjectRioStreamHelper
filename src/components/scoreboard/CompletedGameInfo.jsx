import { Panel } from '../ui/panel';
import { Stack, Text } from '../ui/primitives';
import { Badge } from '../ui/badge';
import { useStateStore } from '../../context/store';
import { STADIUM_OPTIONS } from '../../data/stadiums';

const STADIUM_LABELS = Object.fromEntries(STADIUM_OPTIONS.map(o => [o.value, o.label]));

export default function CompletedGameInfo({ scoreboardNumber = 1 }) {
    const gameCompleted     = useStateStore(s => s?.score?.[scoreboardNumber]?.game_completed ?? false);
    const gameId            = useStateStore(s => s?.score?.[scoreboardNumber]?.game_id);
    const stadium           = useStateStore(s => s?.score?.[scoreboardNumber]?.stadium ?? '');
    const gameMode          = useStateStore(s => s?.score?.[scoreboardNumber]?.game_mode ?? '');
    const inningsPlayed     = useStateStore(s => s?.score?.[scoreboardNumber]?.innings_played);
    const inningsSelected   = useStateStore(s => s?.score?.[scoreboardNumber]?.innings_selected);
    const dateTimeEnd       = useStateStore(s => s?.score?.[scoreboardNumber]?.date_time_end);
    const winnerIncomingElo = useStateStore(s => s?.score?.[scoreboardNumber]?.winner_incoming_elo);
    const winnerResultElo   = useStateStore(s => s?.score?.[scoreboardNumber]?.winner_result_elo);
    const loserIncomingElo  = useStateStore(s => s?.score?.[scoreboardNumber]?.loser_incoming_elo);
    const loserResultElo    = useStateStore(s => s?.score?.[scoreboardNumber]?.loser_result_elo);
    const winnerUser        = useStateStore(s => s?.score?.[scoreboardNumber]?.winner_user ?? '');
    const loserUser         = useStateStore(s => s?.score?.[scoreboardNumber]?.loser_user ?? '');

    if (!gameCompleted) return null;

    return (
        <Panel glow={false} className="p-2" style={{ backgroundColor: 'rgba(76, 29, 149, 0.35)' }}>
            <Stack gap="xs">
                <div className="flex items-center justify-between">
                    <Text size="xs" fw={600} c="#a78bfa">Completed Game</Text>
                    {gameId && (
                        <Badge className="bg-[#a78bfa] px-1.5 text-[10px] text-[#1a1033]">#{gameId}</Badge>
                    )}
                </div>
                {(winnerUser || loserUser) && (
                    <div className="flex flex-wrap items-center gap-2">
                        <Text size="xs" fw={600} c="#2dd4bf">{winnerUser}</Text>
                        <Text size="xs" dimmed>def.</Text>
                        <Text size="xs" fw={600} c="#ff5a5f">{loserUser}</Text>
                    </div>
                )}
                <div className="grid grid-cols-2 gap-1">
                    {stadium && (
                        <div>
                            <Text size="xs" dimmed>Stadium</Text>
                            <Text size="xs">{STADIUM_LABELS[stadium] || stadium}</Text>
                        </div>
                    )}
                    {gameMode && (
                        <div>
                            <Text size="xs" dimmed>Mode</Text>
                            <Text size="xs">{gameMode}</Text>
                        </div>
                    )}
                    {inningsPlayed != null && (
                        <div>
                            <Text size="xs" dimmed>Innings</Text>
                            <Text size="xs">{inningsPlayed}/{inningsSelected ?? '?'}</Text>
                        </div>
                    )}
                    {dateTimeEnd && (
                        <div>
                            <Text size="xs" dimmed>Played</Text>
                            <Text size="xs">
                                {(() => {
                                    try { return new Date(dateTimeEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
                                    catch { return ''; }
                                })()}
                            </Text>
                        </div>
                    )}
                </div>
                {(winnerIncomingElo != null || loserIncomingElo != null) && (
                    <div className="flex flex-wrap gap-4">
                        {winnerIncomingElo != null && (
                            <Text size="xs">
                                <Text span dimmed>W ELO: </Text>
                                {winnerIncomingElo} → {winnerResultElo}
                                {winnerResultElo > winnerIncomingElo && (
                                    <Text span c="#2dd4bf" fw={600}> (+{winnerResultElo - winnerIncomingElo})</Text>
                                )}
                            </Text>
                        )}
                        {loserIncomingElo != null && (
                            <Text size="xs">
                                <Text span dimmed>L ELO: </Text>
                                {loserIncomingElo} → {loserResultElo}
                                {loserResultElo < loserIncomingElo && (
                                    <Text span c="#ff5a5f" fw={600}> ({loserResultElo - loserIncomingElo})</Text>
                                )}
                            </Text>
                        )}
                    </div>
                )}
            </Stack>
        </Panel>
    );
}
