import { useEffect, useMemo, useState, useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useStateStore, useSettingsStore } from '../../context/store';
import {
    createMatch, deleteMatch, updateMatch, bindScoreboard,
} from '../../context/match';
import ParticipantPicker from '../../components/ParticipantPicker';
import { SimpleSelect } from '../../components/ui/simple-select';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Panel } from '../../components/ui/panel';
import { Stack, Group, Text } from '../../components/ui/primitives';
import { MSB_CAPTAINS } from '../../data/msb';
import { cn } from '../../lib/utils';

/*
 * MatchPanel — authoring surface for the fixture object above scoreboards.
 *
 * A Match holds who's playing each side (registry participant), their captain,
 * controller port, the game mode and the format. Binding a board to a match
 * projects those fixtures onto score.{N}.* server-side (see server/match.py), so
 * every existing overlay renders the draft with no layout changes.
 *
 * Lives atop the Scoreboard manager (the tab is labelled "Match"). The match
 * data itself is read straight from the State socket store.
 */

const FORMAT_OPTIONS = [1, 3, 5, 7].map((n) => ({ label: `Bo${n}`, value: String(n) }));
// Ports are stored 0-indexed (matches score.player.port + the HUD); shown 1-based.
const PORT_OPTIONS = [0, 1, 2, 3].map((n) => ({ label: `P${n + 1}`, value: String(n) }));

const STAGE_BADGE = {
    draft: 'bg-[#a855f7]/15 text-[#c084fc]',
    live:  'bg-[#22c55e]/15 text-[#4ade80]',
    post:  'bg-[#64748b]/15 text-[#94a3b8]',
};

function SideColumn({ m, side, player }) {
    const rioName = player?.rioName || '';
    const captain = player?.captain || '';
    const port = player?.port;

    const onPick = useCallback((row) => {
        updateMatch(m, {
            player: {
                [side]: {
                    participantId: row.id,
                    rioName: row.identities?.rioName || row.display?.tag || '',
                },
            },
        });
    }, [m, side]);

    return (
        <Stack gap="xs">
            <Text size="xs" dimmed span>
                Side {side} · {side === 1 ? 'Left' : 'Right'}
            </Text>
            <ParticipantPicker
                value={rioName}
                onResolve={onPick}
                placeholder="Pick participant…"
            />
            <Group gap="xs" wrap={false}>
                <div className="min-w-0 flex-1">
                    <SimpleSelect
                        placeholder="Captain"
                        data={MSB_CAPTAINS}
                        value={captain || undefined}
                        onChange={(v) => updateMatch(m, { player: { [side]: { captain: v } } })}
                    />
                </div>
                <div className="w-20">
                    <SimpleSelect
                        placeholder="Port"
                        data={PORT_OPTIONS}
                        value={port != null && port !== '' ? String(port) : undefined}
                        onChange={(v) => updateMatch(m, { player: { [side]: { port: parseInt(v, 10) } } })}
                    />
                </div>
            </Group>
        </Stack>
    );
}

function MatchCard({ m, match, active, boundMap, gameModes }) {
    const [label, setLabel] = useState(match?.label || '');
    useEffect(() => { setLabel(match?.label || ''); }, [match?.label]);

    const players = match?.player || {};
    const stage = match?.stage || 'draft';
    const bestOf = match?.format?.bestOf ?? 1;
    const gameMode = match?.gameMode || '';

    const commitLabel = useCallback(() => {
        const next = label.trim();
        if (next !== (match?.label || '')) updateMatch(m, { label: next });
    }, [label, match?.label, m]);

    return (
        <Panel
            title={`Match ${m}`}
            actions={(
                <Badge className={cn('text-[10px] font-semibold uppercase tracking-wider', STAGE_BADGE[stage] || STAGE_BADGE.draft)}>
                    {stage}
                </Badge>
            )}
        >
            <div className="space-y-4 p-4">
                <Group gap="sm" wrap>
                    <Input
                        className="h-8 w-48"
                        placeholder="Label (optional)"
                        value={label}
                        onChange={(e) => setLabel(e.currentTarget.value)}
                        onBlur={commitLabel}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    />
                    <div className="w-44">
                        <SimpleSelect
                            placeholder="Game mode"
                            data={gameModes}
                            value={gameMode || undefined}
                            onChange={(v) => updateMatch(m, { gameMode: v })}
                        />
                    </div>
                    <div className="w-24">
                        <SimpleSelect
                            placeholder="Format"
                            data={FORMAT_OPTIONS}
                            value={String(bestOf)}
                            onChange={(v) => updateMatch(m, { format: { bestOf: parseInt(v, 10) } })}
                        />
                    </div>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        className="ml-auto text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMatch(m)}
                        title="Delete match"
                    >
                        <Trash2 size={16} />
                    </Button>
                </Group>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <SideColumn m={m} side={1} player={players[1] ?? players['1']} />
                    <SideColumn m={m} side={2} player={players[2] ?? players['2']} />
                </div>

                <Stack gap="xs">
                    <Text size="xs" dimmed span>Bound scoreboards</Text>
                    <Group gap="xs" wrap>
                        {active.map((sb) => {
                            const bound = String(boundMap[sb]) === String(m);
                            return (
                                <Button
                                    key={sb}
                                    size="sm"
                                    variant={bound ? 'default' : 'outline'}
                                    onClick={() => bindScoreboard(sb, bound ? null : m)}
                                >
                                    Board {sb}
                                </Button>
                            );
                        })}
                    </Group>
                </Stack>
            </div>
        </Panel>
    );
}

export default function MatchPanel() {
    const matchObj = useStateStore((s) => s.match) || {};
    const scores = useStateStore((s) => s.score);
    const active = useSettingsStore((s) => s?.scoreboards?.active ?? [1]);
    const [gameModes, setGameModes] = useState([]);

    useEffect(() => {
        fetch('/api/v1/rio/game-modes')
            .then((r) => r.json())
            .then((data) => setGameModes(Object.keys(data).map((n) => ({ label: n, value: n }))))
            .catch(() => {});
    }, []);

    const boundMap = useMemo(() => {
        const map = {};
        for (const sb of active) map[sb] = scores?.[sb]?.match ?? scores?.[String(sb)]?.match ?? null;
        return map;
    }, [scores, active]);

    const ids = useMemo(
        () => Object.keys(matchObj).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b)),
        [matchObj],
    );

    return (
        <Stack gap="sm" className="mb-6">
            <Group gap="sm" justify="space-between">
                <Text size="sm" fw={600} span>Matches</Text>
                <Button size="sm" variant="outline" onClick={createMatch}>
                    <Plus size={14} /> New match
                </Button>
            </Group>

            {ids.length === 0 ? (
                <Text size="sm" dimmed>
                    No matches yet. Create one to author a fixture, then bind it to a scoreboard.
                </Text>
            ) : (
                <Stack gap="md">
                    {ids.map((m) => (
                        <MatchCard
                            key={m}
                            m={m}
                            match={matchObj[m]}
                            active={active}
                            boundMap={boundMap}
                            gameModes={gameModes}
                        />
                    ))}
                </Stack>
            )}
        </Stack>
    );
}
