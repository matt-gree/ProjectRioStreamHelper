import { useCallback } from 'react';
import {
    TextInput, NumberInput, Stack, Paper, Text, Grid, Divider
} from '@mantine/core';
import { useStateStore } from '../../context/store';

export default function TournamentInfo() {
    const setItem = useStateStore(s => s.setItem);

    // Subscribe to individual fields to avoid referential equality issues
    const name         = useStateStore(s => s?.tournamentInfo?.name ?? '');
    const abbreviation = useStateStore(s => s?.tournamentInfo?.abbreviation ?? '');
    const location     = useStateStore(s => s?.tournamentInfo?.location ?? '');
    const date         = useStateStore(s => s?.tournamentInfo?.date ?? '');
    const entrants     = useStateStore(s => s?.tournamentInfo?.entrants ?? '');
    const prize_pool   = useStateStore(s => s?.tournamentInfo?.prize_pool ?? '');
    const bracket_link = useStateStore(s => s?.tournamentInfo?.bracket_link ?? '');

    // Organizer fields
    const org0name    = useStateStore(s => s?.tournamentInfo?.organizer_0_name ?? '');
    const org0twitter = useStateStore(s => s?.tournamentInfo?.organizer_0_twitter ?? '');
    const org0pronoun = useStateStore(s => s?.tournamentInfo?.organizer_0_pronoun ?? '');
    const org1name    = useStateStore(s => s?.tournamentInfo?.organizer_1_name ?? '');
    const org1twitter = useStateStore(s => s?.tournamentInfo?.organizer_1_twitter ?? '');
    const org1pronoun = useStateStore(s => s?.tournamentInfo?.organizer_1_pronoun ?? '');
    const org2name    = useStateStore(s => s?.tournamentInfo?.organizer_2_name ?? '');
    const org2twitter = useStateStore(s => s?.tournamentInfo?.organizer_2_twitter ?? '');
    const org2pronoun = useStateStore(s => s?.tournamentInfo?.organizer_2_pronoun ?? '');

    const orgFields = [
        { name: org0name, twitter: org0twitter, pronoun: org0pronoun },
        { name: org1name, twitter: org1twitter, pronoun: org1pronoun },
        { name: org2name, twitter: org2twitter, pronoun: org2pronoun },
    ];

    const set = useCallback((field, value) => {
        setItem(`tournamentInfo.${field}`, value);
    }, [setItem]);

    return (
        <Stack gap="md" maw={700}>
            <Text size="lg" fw={700}>Tournament Info</Text>
            <Paper withBorder p="md">
                <Stack gap="sm">
                    <Grid gutter="sm">
                        <Grid.Col span={8}>
                            <TextInput
                                label="Tournament Name"
                                placeholder="Enter tournament name"
                                size="sm"
                                value={name}
                                onChange={e => set('name', e.currentTarget.value)}
                            />
                        </Grid.Col>
                        <Grid.Col span={4}>
                            <TextInput
                                label="Abbreviation"
                                placeholder="Short name"
                                size="sm"
                                value={abbreviation}
                                onChange={e => set('abbreviation', e.currentTarget.value)}
                            />
                        </Grid.Col>
                    </Grid>

                    <Grid gutter="sm">
                        <Grid.Col span={8}>
                            <TextInput
                                label="Location"
                                placeholder="City, State"
                                size="sm"
                                value={location}
                                onChange={e => set('location', e.currentTarget.value)}
                            />
                        </Grid.Col>
                        <Grid.Col span={4}>
                            <TextInput
                                label="Date"
                                placeholder="YYYY-MM-DD"
                                size="sm"
                                value={date}
                                onChange={e => set('date', e.currentTarget.value)}
                            />
                        </Grid.Col>
                    </Grid>

                    <Divider />

                    <Grid gutter="sm">
                        <Grid.Col span={4}>
                            <TextInput
                                label="Entrants"
                                placeholder="0"
                                size="sm"
                                value={String(entrants)}
                                onChange={e => set('entrants', e.currentTarget.value)}
                            />
                        </Grid.Col>
                        <Grid.Col span={8}>
                            <TextInput
                                label="Prize Pool"
                                placeholder="$0"
                                size="sm"
                                value={prize_pool}
                                onChange={e => set('prize_pool', e.currentTarget.value)}
                            />
                        </Grid.Col>
                    </Grid>

                    <TextInput
                        label="Bracket Link"
                        placeholder="https://start.gg/..."
                        size="sm"
                        value={bracket_link}
                        onChange={e => set('bracket_link', e.currentTarget.value)}
                    />

                    <Divider label="Organizers" labelPosition="center" />

                    {orgFields.map((org, i) => (
                        <Grid gutter="xs" key={i}>
                            <Grid.Col span={4}>
                                <TextInput
                                    label={i === 0 ? "Organizer" : undefined}
                                    placeholder={`Organizer ${i + 1}`}
                                    size="xs"
                                    value={org.name}
                                    onChange={e => set(`organizer_${i}_name`, e.currentTarget.value)}
                                />
                            </Grid.Col>
                            <Grid.Col span={4}>
                                <TextInput
                                    label={i === 0 ? "Twitter" : undefined}
                                    placeholder="@handle"
                                    size="xs"
                                    value={org.twitter}
                                    onChange={e => set(`organizer_${i}_twitter`, e.currentTarget.value)}
                                />
                            </Grid.Col>
                            <Grid.Col span={4}>
                                <TextInput
                                    label={i === 0 ? "Pronoun" : undefined}
                                    placeholder="Pronoun"
                                    size="xs"
                                    value={org.pronoun}
                                    onChange={e => set(`organizer_${i}_pronoun`, e.currentTarget.value)}
                                />
                            </Grid.Col>
                        </Grid>
                    ))}
                </Stack>
            </Paper>
        </Stack>
    );
}
