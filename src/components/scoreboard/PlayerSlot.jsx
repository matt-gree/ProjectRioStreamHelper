import { useCallback } from 'react';
import {
    TextInput, Select, Radio, Group, Stack, Grid, Paper,
    Text, Collapse, ActionIcon, Autocomplete
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useStateStore } from '../../context/store';
import { MSB_CHARACTERS, MSB_TEAMS, ROSTER_SIZE } from '../../data/msb';

const characterOptions = MSB_CHARACTERS.map(c => ({ value: c, label: c }));
const teamOptions = MSB_TEAMS.map(t => ({ value: t, label: t }));

/**
 * A single player slot within a team panel.
 *
 * Props:
 *   scoreboardNumber: number (usually 1)
 *   teamNumber: 1 | 2
 *   playerNumber: 1-based player index
 */
export default function PlayerSlot({ scoreboardNumber = 1, teamNumber, playerNumber }) {
    const basePath = `score.${scoreboardNumber}.team.${teamNumber}.player.${playerNumber}`;
    const [detailsOpen, { toggle: toggleDetails }] = useDisclosure(false);

    // ---- selectors (subscribe to individual keys to minimise re-renders) ----
    const name       = useStateStore(s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.player?.[playerNumber]?.name ?? '');
    const teamPrefix = useStateStore(s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.player?.[playerNumber]?.team ?? '');
    const rioName    = useStateStore(s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.player?.[playerNumber]?.rioName ?? '');
    const msbTeam    = useStateStore(s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.player?.[playerNumber]?.msb_team ?? '');
    const captain    = useStateStore(s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.player?.[playerNumber]?.rio_captainIndex ?? 0);
    const country    = useStateStore(s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.player?.[playerNumber]?.country ?? '');
    const pronoun    = useStateStore(s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.player?.[playerNumber]?.pronoun ?? '');
    const twitter    = useStateStore(s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.player?.[playerNumber]?.twitter ?? '');

    const setItem = useStateStore(s => s.setItem);

    const set = useCallback((field, value) => {
        setItem(`${basePath}.${field}`, value);
    }, [basePath, setItem]);

    // Build roster array from state
    const roster = [];
    const rosterState = useStateStore(s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.player?.[playerNumber]?.character);
    for (let i = 0; i < ROSTER_SIZE; i++) {
        roster.push(rosterState?.[i]?.name ?? '');
    }

    const setCharacter = useCallback((index, charName) => {
        setItem(`${basePath}.character.${index}.name`, charName);
    }, [basePath, setItem]);

    const setCaptain = useCallback((index) => {
        set('rio_captainIndex', index);
    }, [set]);

    return (
        <Paper withBorder p="xs" mb="xs">
            {/* Main row: name + team prefix + Rio name */}
            <Grid gutter="xs" align="flex-end">
                <Grid.Col span={4}>
                    <TextInput
                        label={`Player ${playerNumber}`}
                        placeholder="Tag"
                        size="xs"
                        value={name}
                        onChange={e => set('name', e.currentTarget.value)}
                    />
                </Grid.Col>
                <Grid.Col span={3}>
                    <TextInput
                        label="Prefix"
                        placeholder="Team/Sponsor"
                        size="xs"
                        value={teamPrefix}
                        onChange={e => set('team', e.currentTarget.value)}
                    />
                </Grid.Col>
                <Grid.Col span={3}>
                    <TextInput
                        label="Rio Name"
                        placeholder="Online ID"
                        size="xs"
                        value={rioName}
                        onChange={e => set('rioName', e.currentTarget.value)}
                    />
                </Grid.Col>
                <Grid.Col span={2}>
                    <ActionIcon
                        variant="subtle"
                        size="sm"
                        onClick={toggleDetails}
                        title={detailsOpen ? 'Hide details' : 'Show details'}
                    >
                        <Text size="xs">{detailsOpen ? '▲' : '▼'}</Text>
                    </ActionIcon>
                </Grid.Col>
            </Grid>

            {/* Collapsible detail fields */}
            <Collapse in={detailsOpen}>
                <Grid gutter="xs" mt="xs">
                    <Grid.Col span={4}>
                        <Select
                            label="MSB Team"
                            placeholder="Select team"
                            data={teamOptions}
                            size="xs"
                            searchable
                            clearable
                            value={msbTeam || null}
                            onChange={val => set('msb_team', val ?? '')}
                        />
                    </Grid.Col>
                    <Grid.Col span={3}>
                        <TextInput
                            label="Country"
                            placeholder="US, CA..."
                            size="xs"
                            value={country}
                            onChange={e => set('country', e.currentTarget.value)}
                        />
                    </Grid.Col>
                    <Grid.Col span={3}>
                        <TextInput
                            label="Pronoun"
                            placeholder="He/Him"
                            size="xs"
                            value={pronoun}
                            onChange={e => set('pronoun', e.currentTarget.value)}
                        />
                    </Grid.Col>
                    <Grid.Col span={2}>
                        <TextInput
                            label="Twitter"
                            placeholder="@handle"
                            size="xs"
                            value={twitter}
                            onChange={e => set('twitter', e.currentTarget.value)}
                        />
                    </Grid.Col>
                </Grid>
            </Collapse>

            {/* Character roster (9 slots) */}
            <Text size="xs" fw={600} mt="xs" mb={4}>Roster</Text>
            <Grid gutter={4}>
                {roster.map((charName, i) => (
                    <Grid.Col span={4} key={i}>
                        <Group gap={4} wrap="nowrap">
                            <Radio
                                size="xs"
                                checked={captain === i}
                                onChange={() => setCaptain(i)}
                                title="Captain"
                                styles={{ radio: { cursor: 'pointer' } }}
                            />
                            <Select
                                placeholder={`Slot ${i + 1}`}
                                data={characterOptions}
                                size="xs"
                                searchable
                                clearable
                                value={charName || null}
                                onChange={val => setCharacter(i, val ?? '')}
                                style={{ flex: 1 }}
                            />
                        </Group>
                    </Grid.Col>
                ))}
            </Grid>
        </Paper>
    );
}
