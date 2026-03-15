import { useCallback, useMemo, useState } from 'react';
import {
    NumberInput, Select, Radio, Stack, Grid, Paper, Text, Group, ActionIcon,
    Divider, Tooltip, SegmentedControl,
} from '@mantine/core';
import { useStateStore } from '../../context/store';
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
export default function CharacterStatEditor({
    scoreboardNumber = 1, teamNumber, charIndex, charName, onBack,
    characterOptions, onCharacterChange, isCaptain, onSetCaptain,
    sourceType = 'manual',
}) {
    const prefix = `score.${scoreboardNumber}.stats.team.${teamNumber}.character.${charIndex}`;
    const setItem = useStateStore(s => s.setItem);
    const [scope, setScope] = useState('web');

    // State path depends on which scope is active
    const statPath = scope === 'web' ? 'api' : 'current_game';
    const isReadOnly = scope === 'local' && sourceType !== 'manual';

    const charStats = useStateStore(
        s => s?.score?.[scoreboardNumber]?.stats?.team?.[teamNumber]?.character?.[charIndex]
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
                    />
                ) : (
                    <Text size="sm" fw={700}>{charName || `Slot ${charIndex + 1}`}</Text>
                )}
                {onSetCaptain && (
                    <Tooltip label="Captain" position="right">
                        <Radio
                            size="xs"
                            checked={!!isCaptain}
                            onChange={onSetCaptain}
                            styles={{ radio: { cursor: 'pointer' } }}
                        />
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
