import { memo, useCallback, useMemo, useState } from 'react';
import {
    TextInput, Select, Group, Stack, Grid, Paper,
    Text, Collapse, ActionIcon, UnstyledButton, Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../context/store';
import { MSB_CHARACTERS, MSB_TEAMS, ROSTER_SIZE } from '../../data/msb';
import CharacterStatEditor from './CharacterStatEditor';

const characterOptions = MSB_CHARACTERS.map(c => ({ value: c, label: c }));
const teamOptions = MSB_TEAMS.map(t => ({ value: t, label: t }));

const charIconUrl = (name) => `/game_assets/rio_characterIcons/${encodeURIComponent(name)}.png`;
const teamIconUrl = (name) => `/game_assets/rio_teamLogos/${encodeURIComponent(name)}.png`;

const renderCharOption = ({ option }) => (
    <Group gap="xs" wrap="nowrap">
        <img src={charIconUrl(option.value)} alt="" width={20} height={20} style={{ objectFit: 'contain' }} />
        <span>{option.label}</span>
    </Group>
);

const renderTeamOption = ({ option }) => (
    <Group gap="xs" wrap="nowrap">
        <img src={teamIconUrl(option.value)} alt="" width={20} height={20} style={{ objectFit: 'contain' }} />
        <span>{option.label}</span>
    </Group>
);

/**
 * A single player slot within a team panel.
 *
 * Props:
 *   scoreboardNumber: number (usually 1)
 *   teamNumber: 1 | 2
 *   playerNumber: 1-based player index
 */
export default memo(function PlayerSlot({ scoreboardNumber = 1, teamNumber, playerNumber, sourceType = 'manual' }) {
    const basePath = `score.${scoreboardNumber}.team.${teamNumber}.player.${playerNumber}`;
    const [detailsOpen, { toggle: toggleDetails }] = useDisclosure(false);
    const [activeCharDetail, setActiveCharDetail] = useState(null);

    // Single shallow selector for the whole player object — Zustand's useShallow
    // does a shallow equality check so we only re-render when the player sub-tree
    // actually changes, not on every unrelated state update.
    const player = useStateStore(useShallow(
        s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.player?.[playerNumber]
    ));
    const name       = player?.name ?? '';
    const teamPrefix = player?.team ?? '';
    const rioName    = player?.rioName ?? '';
    const msbTeam    = player?.msb_team ?? '';
    const captain    = player?.rio_captainIndex ?? 0;
    const fullName   = player?.full_name ?? '';
    const country    = player?.country ?? '';
    const state      = player?.state ?? '';
    const pronoun    = player?.pronoun ?? '';

    const setItem = useStateStore(s => s.setItem);

    const set = useCallback((field, value) => {
        setItem(`${basePath}.${field}`, value);
    }, [basePath, setItem]);

    // Build roster array from character state, memoized to avoid re-creating on every render
    const rosterState = player?.character;
    const roster = useMemo(() => {
        const r = [];
        for (let i = 0; i < ROSTER_SIZE; i++) {
            r.push(rosterState?.[i]?.name ?? '');
        }
        return r;
    }, [rosterState]);

    const setCharacter = useCallback((index, charName) => {
        setItem(`${basePath}.character.${index}.name`, charName);
    }, [basePath, setItem]);

    const setCaptain = useCallback((index) => {
        set('rio_captainIndex', index);
    }, [set]);

    return (
        <Stack gap="xs">
            {/* Main row: tag + prefix + Rio name */}
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
                <Grid.Col span={2}>
                    <TextInput
                        label="Prefix"
                        placeholder="Sponsor"
                        size="xs"
                        value={teamPrefix}
                        onChange={e => set('team', e.currentTarget.value)}
                    />
                </Grid.Col>
                <Grid.Col span={4}>
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
                        <TextInput
                            label="Full Name"
                            placeholder="First Last"
                            size="xs"
                            value={fullName}
                            onChange={e => set('full_name', e.currentTarget.value)}
                        />
                    </Grid.Col>
                    <Grid.Col span={2}>
                        <TextInput
                            label="State"
                            placeholder="NY, CA..."
                            size="xs"
                            value={state}
                            onChange={e => set('state', e.currentTarget.value)}
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
                </Grid>
            </Collapse>

            {/* Character roster / stat editor drill-in */}
            {activeCharDetail !== null ? (
                <CharacterStatEditor
                    scoreboardNumber={scoreboardNumber}
                    teamNumber={teamNumber}
                    charIndex={activeCharDetail}
                    charName={roster[activeCharDetail]}
                    onBack={() => setActiveCharDetail(null)}
                    characterOptions={characterOptions}
                    onCharacterChange={(val) => setCharacter(activeCharDetail, val ?? '')}
                    isCaptain={captain === activeCharDetail}
                    onSetCaptain={() => setCaptain(activeCharDetail)}
                    sourceType={sourceType}
                />
            ) : (
                <>
                    <Select
                        placeholder="MSB Team"
                        data={teamOptions}
                        size="xs"
                        searchable
                        clearable
                        value={msbTeam || null}
                        onChange={val => set('msb_team', val ?? '')}
                        renderOption={renderTeamOption}
                        leftSection={msbTeam ? <img src={teamIconUrl(msbTeam)} alt="" width={16} height={16} style={{ objectFit: 'contain' }} /> : null}
                        mt="xs"
                    />
                    <Grid gutter={4}>
                        {roster.map((charName, i) => {
                            const isCaptain = captain === i;
                            return (
                                <Grid.Col span={4} key={i}>
                                    <Paper
                                        withBorder
                                        style={{
                                            display: 'flex',
                                            overflow: 'hidden',
                                            borderColor: isCaptain ? 'var(--mantine-color-yellow-5)' : undefined,
                                        }}
                                    >
                                        <UnstyledButton
                                            onClick={() => setActiveCharDetail(i)}
                                            style={{ flex: 1, minWidth: 0, padding: '4px 6px' }}
                                        >
                                            <Group gap={4} wrap="nowrap">
                                                {charName && (
                                                    <img src={charIconUrl(charName)} alt="" width={16} height={16} style={{ objectFit: 'contain', flexShrink: 0 }} />
                                                )}
                                                <Text size="xs" truncate c={charName ? undefined : 'dimmed'}>
                                                    {charName || `Slot ${i + 1}`}
                                                </Text>
                                            </Group>
                                        </UnstyledButton>
                                        <Tooltip label="Set captain" position="top" withArrow>
                                            <UnstyledButton
                                                onClick={() => setCaptain(i)}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    width: 22,
                                                    flexShrink: 0,
                                                    borderLeft: '1px solid var(--mantine-color-default-border)',
                                                    backgroundColor: isCaptain ? 'var(--mantine-color-yellow-5)' : undefined,
                                                    color: isCaptain ? 'var(--mantine-color-dark-9)' : 'var(--mantine-color-dimmed)',
                                                    fontWeight: 700,
                                                    fontSize: 11,
                                                    transition: 'background-color 150ms, color 150ms',
                                                }}
                                            >
                                                C
                                            </UnstyledButton>
                                        </Tooltip>
                                    </Paper>
                                </Grid.Col>
                            );
                        })}
                    </Grid>
                </>
            )}
        </Stack>
    );
});
