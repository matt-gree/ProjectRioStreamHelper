import { useCallback, useMemo, useState } from 'react';
import {
    NumberInput, Select, Stack, Grid, Paper, Text, Group, ActionIcon,
    Divider, Tooltip, SegmentedControl, UnstyledButton,
} from '@mantine/core';
import { useStateStore } from '../../context/store';
const charIconUrl = (name) => `/game_assets/msb/characterIcons/${encodeURIComponent(name)}.png`;

const renderCharOption = ({ option }) => (
    <Group gap="xs" wrap="nowrap">
        <img src={charIconUrl(option.value)} alt="" width={20} height={20} style={{ objectFit: 'contain' }} />
        <span>{option.label}</span>
    </Group>
);

import {
    BATTING_RAW_KEYS, PITCHING_RAW_KEYS,
    BATTING_LABELS, PITCHING_LABELS,
    deriveBatting, derivePitching,
    DERIVED_BATTING_LABELS, DERIVED_PITCHING_LABELS,
} from '../../utils/statCalc';

/**
 * Editable stat sheet for a single character, shown in place of the roster.
 *
 * Props:
 *   scoreboardNumber, teamNumber — scoreboard / team identifiers
 *   charIndex — 0-based roster index
 *   charName — display name of the character
 *   onBack — callback to return to roster view
 *   characterOptions — array of { value, label } for the character Select
 *   onCharacterChange — callback(val) to change which character is in this slot
 *   isCaptain — whether this character is currently the captain
 *   onSetCaptain — callback to set this character as captain
 *   sourceType — 'manual' | 'hud' | 'api_game'
 */
function StarIcon({ active }) {
    if (active) {
        return <img src="/game_assets/msb/superstar.png" alt="Superstar" width={14} height={14} style={{ objectFit: 'contain', display: 'block', filter: 'drop-shadow(0 0 3px rgba(245,159,0,0.8))' }} />;
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

export default function CharacterStatEditor({
    scoreboardNumber = 1, teamNumber, charIndex, charName, onBack,
    characterOptions, onCharacterChange, isCaptain, onSetCaptain,
    isSuperstar, onToggleSuperstar,
    sourceType = 'manual',
}) {
    const prefix = `score.${scoreboardNumber}.stats.${teamNumber}.character.${charIndex}`;
    const setItem = useStateStore(s => s.setItem);
    const [scope, setScope] = useState('web');

    // State path depends on which scope is active
    const statPath = scope === 'web' ? 'api' : 'current_game';
    const isReadOnly = scope === 'local' && sourceType !== 'manual';

    const charStats = useStateStore(
        s => s?.score?.[scoreboardNumber]?.stats?.[teamNumber]?.character?.[charIndex]
    );

    const batting = (scope === 'web' ? charStats?.api?.batting : charStats?.current_game?.batting) ?? {};
    const pitching = (scope === 'web' ? charStats?.api?.pitching : charStats?.current_game?.pitching) ?? {};

    const setBatting = useCallback((key, val) => {
        setItem(`${prefix}.${statPath}.batting.${key}`, val === '' ? 0 : Number(val));
    }, [prefix, statPath, setItem]);

    const setPitching = useCallback((key, val) => {
        setItem(`${prefix}.${statPath}.pitching.${key}`, val === '' ? 0 : Number(val));
    }, [prefix, statPath, setItem]);

    const derivedBatting = useMemo(() => deriveBatting(batting), [batting]);
    const derivedPitching = useMemo(() => derivePitching(pitching), [pitching]);

    return (
        <Stack gap="xs" mt="sm">
            {/* Header with back button, slot indicator + character selector */}
            <Group gap="xs">
                <ActionIcon variant="subtle" size="sm" onClick={onBack} title="Back to roster">
                    <Text size="xs" lh={1}>&larr;</Text>
                </ActionIcon>
                <Text size="xs" c="dimmed" fw={600}>#{charIndex + 1}</Text>
                {characterOptions && onCharacterChange ? (
                    <Select
                        data={characterOptions}
                        value={charName || null}
                        onChange={onCharacterChange}
                        placeholder={`Slot ${charIndex + 1}`}
                        size="xs"
                        searchable
                        clearable
                        style={{ flex: 1 }}
                        renderOption={renderCharOption}
                        leftSection={charName ? <img src={charIconUrl(charName)} alt="" width={16} height={16} style={{ objectFit: 'contain' }} /> : undefined}
                        leftSectionPointerEvents="none"
                    />
                ) : (
                    <Text size="sm" fw={700}>{charName || `Slot ${charIndex + 1}`}</Text>
                )}
                {onToggleSuperstar && (
                    <Tooltip label={isSuperstar ? 'Superstar' : 'Set superstar'} position="right" withArrow>
                        <UnstyledButton
                            onClick={onToggleSuperstar}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 22,
                                height: 22,
                                borderRadius: 4,
                                border: '1px solid var(--mantine-color-default-border)',
                                color: isSuperstar ? '#f59f00' : 'var(--mantine-color-dimmed)',
                                transition: 'color 150ms',
                            }}
                        >
                            <StarIcon active={isSuperstar} />
                        </UnstyledButton>
                    </Tooltip>
                )}
                {onSetCaptain && (
                    <Tooltip label={isCaptain ? 'Captain' : 'Set captain'} position="right" withArrow>
                        <UnstyledButton
                            onClick={onSetCaptain}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 22,
                                height: 22,
                                borderRadius: 4,
                                border: '1px solid var(--mantine-color-default-border)',
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
                )}
            </Group>

            {/* Scope toggle */}
            <SegmentedControl
                size="xs"
                value={scope}
                onChange={setScope}
                data={[
                    { value: 'web', label: 'Web' },
                    { value: 'local', label: 'This Game' },
                ]}
            />

            {isReadOnly && (
                <Text size="xs" c="dimmed" fs="italic">
                    Read-only during HUD game (stats update automatically)
                </Text>
            )}

            {/* ---- Batting ---- */}
            <Divider label="Batting" labelPosition="center" />
            <Grid gutter={4}>
                {BATTING_RAW_KEYS.map(key => (
                    <Grid.Col span={2} key={key}>
                        <NumberInput
                            label={BATTING_LABELS[key]}
                            value={batting[key] ?? 0}
                            onChange={val => setBatting(key, val)}
                            min={0}
                            size="xs"
                            disabled={isReadOnly}
                            styles={{ label: { fontSize: 10 } }}
                        />
                    </Grid.Col>
                ))}
            </Grid>

            {/* Derived batting (read-only) */}
            <Group gap="xs" wrap="wrap">
                {Object.entries(DERIVED_BATTING_LABELS).map(([key, label]) => (
                    <Paper key={key} withBorder px={6} py={2}>
                        <Text size="xs" c="dimmed" lh={1}>{label}</Text>
                        <Text size="xs" fw={600} lh={1.2}>{derivedBatting[key]}</Text>
                    </Paper>
                ))}
            </Group>

            {/* ---- Pitching ---- */}
            <Divider label="Pitching" labelPosition="center" />
            <Grid gutter={4}>
                {PITCHING_RAW_KEYS.map(key => (
                    <Grid.Col span={2} key={key}>
                        <NumberInput
                            label={PITCHING_LABELS[key]}
                            value={pitching[key] ?? 0}
                            onChange={val => setPitching(key, val)}
                            min={0}
                            size="xs"
                            disabled={isReadOnly}
                            styles={{ label: { fontSize: 10 } }}
                        />
                    </Grid.Col>
                ))}
            </Grid>

            {/* Derived pitching (read-only) */}
            <Group gap="xs" wrap="wrap">
                {Object.entries(DERIVED_PITCHING_LABELS).map(([key, label]) => (
                    <Paper key={key} withBorder px={6} py={2}>
                        <Text size="xs" c="dimmed" lh={1}>{label}</Text>
                        <Text size="xs" fw={600} lh={1.2}>{derivedPitching[key]}</Text>
                    </Paper>
                ))}
            </Group>
        </Stack>
    );
}
