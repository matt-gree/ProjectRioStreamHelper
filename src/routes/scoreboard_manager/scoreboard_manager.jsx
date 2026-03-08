import { useCallback } from 'react';
import { Grid } from '@mantine/core';
import { useStateStore } from '../../context/store';
import TeamPanel from '../../components/scoreboard/TeamPanel';
import ScoreControls from '../../components/scoreboard/ScoreControls';

export default function ScoreboardManager() {
    const scoreboardNumber = 1;
    const setItems = useStateStore(s => s.setItems);

    // Swap teams: call backend Rio swap API (persists across HUD events),
    // then fall back to client-side swap if no HUD data.
    const handleSwapTeams = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/rio/swap', { method: 'POST' });
            const data = await resp.json();
            if (data.success) return; // Backend handled it; state updates via SocketIO
        } catch {
            // Backend unavailable or no HUD data — fall through to client-side swap
        }

        // Client-side fallback: exchange team.1 <-> team.2 in one atomic update
        const state = useStateStore.getState();
        const base = state?.score?.[scoreboardNumber];
        const sb = `score.${scoreboardNumber}`;

        setItems([
            { key: `${sb}.team.1`, value: base?.team?.[2] ?? {} },
            { key: `${sb}.team.2`, value: base?.team?.[1] ?? {} },
            { key: `${sb}.score_left`, value: base?.score_right ?? 0 },
            { key: `${sb}.score_right`, value: base?.score_left ?? 0 },
            { key: `${sb}.teamsSwapped`, value: !(base?.teamsSwapped ?? false) },
        ]);
    }, [scoreboardNumber, setItems]);

    return (
        <Grid gutter="md" align="flex-start">
            {/* Team 1 (left) */}
            <Grid.Col span={{ base: 12, md: 4 }}>
                <TeamPanel
                    scoreboardNumber={scoreboardNumber}
                    teamNumber={1}
                    playerCount={1}
                    label="Team 1 (Away)"
                />
            </Grid.Col>

            {/* Score Controls (center) */}
            <Grid.Col span={{ base: 12, md: 4 }}>
                <ScoreControls
                    scoreboardNumber={scoreboardNumber}
                    onSwapTeams={handleSwapTeams}
                />
            </Grid.Col>

            {/* Team 2 (right) */}
            <Grid.Col span={{ base: 12, md: 4 }}>
                <TeamPanel
                    scoreboardNumber={scoreboardNumber}
                    teamNumber={2}
                    playerCount={1}
                    label="Team 2 (Home)"
                />
            </Grid.Col>
        </Grid>
    );
}
