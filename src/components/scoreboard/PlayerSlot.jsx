import { memo, useCallback, useMemo, useState } from 'react';
import {
    TextInput, Select, Group, Stack, Grid, Paper,
    Text, Collapse, ActionIcon, UnstyledButton, Tooltip, Badge,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../context/store';
import { useAssetUrls } from '../../lib/assets';
import { MSB_CHARACTERS, MSB_TEAMS, ROSTER_SIZE } from '../../data/msb';
import CharacterStatEditor from './CharacterStatEditor';

const characterOptions = MSB_CHARACTERS.map(c => ({ value: c, label: c }));
const teamOptions = MSB_TEAMS.map(t => ({ value: t, label: t }));

function StarIcon({ active, superstarUrl }) {
    if (active) {
        return <img src={superstarUrl} alt="Superstar" width={14} height={14} style={{ objectFit: 'contain', display: 'block', filter: 'drop-shadow(0 0 3px rgba(245,159,0,0.8))' }} />;
    }
    return (
        <svg viewBox="0 0 20 20" width="12" height="12" xmlns="http://www.w3.org/2000/svg">
            <polygon
                points="10,1 12.9,7 19.5,7.6 14.5,12 16.2,18.5 10,15 3.8,18.5 5.5,12 0.5,7.6 7.1,7"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.2}
                strokeLinejoin="round"
            />
        </svg>
    );
}

const makeRenderCharOption = (charIconUrl) => ({ option }) => (
    <Group gap="xs" wrap="nowrap">
        <img src={charIconUrl(option.value)} alt="" width={20} height={20} style={{ objectFit: 'contain' }} />
        <span>{option.label}</span>
    </Group>
);

const makeRenderTeamOption = (teamIconUrl) => ({ option }) => (
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
export default memo(function PlayerSlot({ scoreboardNumber = 1, teamNumber, playerNumber, sourceType = 'manual', losers, isHome, onToggleLosers, onToggleHome }) {
    const basePath = `score.${scoreboardNumber}.player.${teamNumber}`;
    const [detailsOpen, { toggle: toggleDetails }] = useDisclosure(false);
    const [activeCharDetail, setActiveCharDetail] = useState(null);

    const urls = useAssetUrls();
    const charIconUrl = urls.charIcon;
    const teamIconUrl = urls.teamIcon;
    const superstarUrl = urls.gameIcon('superstar.png');
    const renderCharOption = useMemo(() => makeRenderCharOption(charIconUrl), [charIconUrl]);
    const renderTeamOption = useMemo(() => makeRenderTeamOption(teamIconUrl), [teamIconUrl]);

    // Single shallow selector for the whole player object — Zustand's useShallow
    // does a shallow equality check so we only re-render when the player sub-tree
    // actually changes, not on every unrelated state update.
    const player = useStateStore(useShallow(
        s => s?.score?.[scoreboardNumber]?.player?.[teamNumber]
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
    const youtube    = player?.youtube ?? '';
    const twitter    = player?.twitter ?? '';

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

    const rosterStarred = useMemo(() => {
        const s = [];
        for (let i = 0; i < ROSTER_SIZE; i++) {
            s.push(rosterState?.[i]?.is_starred ?? false);
        }
        return s;
    }, [rosterState]);

    const setCharacter = useCallback((index, charName) => {
        setItem(`${basePath}.character.${index}.name`, charName);
    }, [basePath, setItem]);

    const setCaptain = useCallback((index) => {
        set('rio_captainIndex', index);
    }, [set]);

    const toggleSuperstar = useCallback((index) => {
        setItem(`${basePath}.character.${index}.is_starred`, !rosterStarred[index]);
    }, [basePath, setItem, rosterStarred]);

    return (
        <Stack gap="xs">
            {/* Main row: tag + prefix + Rio name */}
            <Grid gutter="xs" align="stretch">
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
                        leftSection={<img src="/game_assets/rio_logo.png" alt="Rio" width={16} height={16} style={{ objectFit: 'contain' }} />}
                        leftSectionWidth={28}
                        leftSectionPointerEvents="none"
                    />
                </Grid.Col>
                <Grid.Col span={2}>
                    <Stack gap={3} align="flex-end" justify="space-between" style={{ height: '100%' }}>
                        <Group gap={3} wrap="nowrap">
                            <UnstyledButton onClick={onToggleLosers}>
                                <Badge size="xs" color={losers ? 'red' : 'gray'} variant={losers ? 'filled' : 'light'}>L</Badge>
                            </UnstyledButton>
                            <UnstyledButton onClick={onToggleHome}>
                                 <Badge size="xs" color={isHome ? 'blue' : 'gray'} variant={isHome ? 'filled' : 'light'} style={{ minWidth: 44 }}>
                                    {isHome ? 'Home' : 'Away'}
                                </Badge>
                            </UnstyledButton>
                        </Group>
                        <ActionIcon
                            variant="subtle"
                            size="sm"
                            onClick={toggleDetails}
                            title={detailsOpen ? 'Hide details' : 'Show details'}
                        >
                            <Text size="xs">{detailsOpen ? '▲' : '▼'}</Text>
                        </ActionIcon>
                    </Stack>
                </Grid.Col>
            </Grid>

            {/* Collapsible detail fields */}
            <Collapse in={detailsOpen}>
                <Grid gutter="xs" mt={0}>
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
                    <Grid.Col span={6}>
                        <TextInput
                            label="YouTube"
                            placeholder="@handle"
                            size="xs"
                            value={youtube}
                            onChange={e => set('youtube', e.currentTarget.value)}
                        />
                    </Grid.Col>
                    <Grid.Col span={6}>
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
                    isSuperstar={rosterStarred[activeCharDetail]}
                    onToggleSuperstar={() => toggleSuperstar(activeCharDetail)}
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
                            const isSuperstar = rosterStarred[i];
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
                                        <Tooltip label={isSuperstar ? 'Superstar' : 'Set superstar'} position="top" withArrow>
                                            <UnstyledButton
                                                onClick={() => toggleSuperstar(i)}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    width: 22,
                                                    flexShrink: 0,
                                                    borderLeft: '1px solid var(--mantine-color-default-border)',
                                                    color: isSuperstar ? '#f59f00' : 'var(--mantine-color-dimmed)',
                                                    transition: 'color 150ms',
                                                }}
                                            >
                                                <StarIcon active={isSuperstar} superstarUrl={superstarUrl} />
                                            </UnstyledButton>
                                        </Tooltip>
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
