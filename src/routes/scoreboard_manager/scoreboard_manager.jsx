import { useState, useCallback } from 'react';
import {
    Tabs, Grid, ActionIcon, Group, Text, Badge, Tooltip, CloseButton,
    TextInput, Popover,
} from '@mantine/core';
import { useSettingsStore, useStateStore } from '../../context/store';
import TeamPanel from '../../components/scoreboard/TeamPanel';
import ScoreControls from '../../components/scoreboard/ScoreControls';

/**
 * A single scoreboard instance (team panels + score controls).
 */
function ScoreboardTab({ scoreboardNumber }) {
    const setItems = useStateStore(s => s.setItems);
    const sourceType = useSettingsStore(
        s => s?.scoreboards?.sources?.[scoreboardNumber]?.type
            ?? s?.scoreboards?.sources?.[String(scoreboardNumber)]?.type
            ?? 'manual'
    );

    const handleSwapTeams = useCallback(async () => {
        if (sourceType === 'hud') {
            try {
                const resp = await fetch(
                    `/api/v1/rio/swap?scoreboard_number=${scoreboardNumber}`,
                    { method: 'POST' },
                );
                const data = await resp.json();
                if (data.success) return;
            } catch { /* fall through to client-side swap */ }
        }

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
    }, [scoreboardNumber, setItems, sourceType]);

    const handleSetSource = useCallback(async (newSource) => {
        await fetch(`/api/v1/scoreboards/${scoreboardNumber}/source?source_type=${newSource}`, {
            method: 'PUT',
        });
    }, [scoreboardNumber]);

    return (
        <Grid gutter="md" align="flex-start">
            <Grid.Col span={{ base: 12, md: 4 }}>
                <TeamPanel
                    scoreboardNumber={scoreboardNumber}
                    teamNumber={1}
                    playerCount={1}
                    label="Team 1 (Away)"
                />
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 4 }}>
                <ScoreControls
                    scoreboardNumber={scoreboardNumber}
                    onSwapTeams={handleSwapTeams}
                    sourceType={sourceType}
                    onSetSource={handleSetSource}
                />
            </Grid.Col>

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

const SOURCE_BADGE = {
    hud: { color: 'green', label: 'HUD' },
    api: { color: 'blue', label: 'API' },
};

/**
 * Inline rename popover for a scoreboard tab.
 */
function RenamePopover({ sbId, currentAlias }) {
    const [opened, setOpened] = useState(false);
    const [value, setValue] = useState(currentAlias);

    const handleSave = useCallback(async () => {
        await fetch(
            `/api/v1/scoreboards/${sbId}/alias?alias=${encodeURIComponent(value.trim())}`,
            { method: 'PUT' },
        );
        setOpened(false);
    }, [sbId, value]);

    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter') handleSave();
        if (e.key === 'Escape') setOpened(false);
    }, [handleSave]);

    return (
        <Popover opened={opened} onChange={setOpened} position="bottom" withArrow>
            <Popover.Target>
                <ActionIcon
                    variant="subtle" size="xs"
                    onClick={(e) => { e.stopPropagation(); setValue(currentAlias); setOpened(true); }}
                >
                    <Text size="xs" lh={1}>&#9998;</Text>
                </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown onClick={(e) => e.stopPropagation()}>
                <TextInput
                    size="xs"
                    placeholder="Alias (optional)"
                    value={value}
                    onChange={(e) => setValue(e.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    rightSection={
                        <ActionIcon size="xs" variant="filled" onClick={handleSave}>
                            <Text size="xs" lh={1}>&#10003;</Text>
                        </ActionIcon>
                    }
                />
            </Popover.Dropdown>
        </Popover>
    );
}

/**
 * Builds the display label for a tab: always "N" or "N: Alias"
 */
function tabLabel(sbId, alias) {
    if (alias) return `${sbId}: ${alias}`;
    return String(sbId);
}

export default function ScoreboardManager() {
    const active = useSettingsStore(s => s?.scoreboards?.active ?? [1]);
    const sources = useSettingsStore(s => s?.scoreboards?.sources ?? {});
    const aliases = useSettingsStore(s => s?.scoreboards?.aliases ?? {});
    const [activeTab, setActiveTab] = useState(String(active[0] ?? 1));

    const handleAddScoreboard = useCallback(async () => {
        const resp = await fetch('/api/v1/scoreboards', { method: 'POST' });
        const data = await resp.json();
        if (data.success) {
            setActiveTab(String(data.id));
        }
    }, []);

    const handleRemoveScoreboard = useCallback(async (e, sbId) => {
        e.stopPropagation();
        const resp = await fetch(`/api/v1/scoreboards/${sbId}`, { method: 'DELETE' });
        const data = await resp.json();
        if (data.success) {
            const remaining = data.active ?? [1];
            setActiveTab(String(remaining[0]));
        }
    }, []);

    return (
        <Tabs value={activeTab} onChange={setActiveTab} variant="outline">
            <Group gap={0} align="center" mb="md">
                <Tabs.List>
                    {active.map(sbId => {
                        const src = sources[sbId] ?? sources[String(sbId)];
                        const srcType = src?.type ?? 'manual';
                        const badge = SOURCE_BADGE[srcType];
                        const alias = aliases[sbId] ?? aliases[String(sbId)] ?? '';
                        return (
                            <Tabs.Tab key={sbId} value={String(sbId)}>
                                <Group gap={6} wrap="nowrap">
                                    <Text size="sm">{tabLabel(sbId, alias)}</Text>
                                    {badge && (
                                        <Badge size="xs" color={badge.color} variant="filled">
                                            {badge.label}
                                        </Badge>
                                    )}
                                    <RenamePopover sbId={sbId} currentAlias={alias} />
                                    {active.length > 1 && (
                                        <CloseButton
                                            size="xs"
                                            variant="subtle"
                                            onClick={(e) => handleRemoveScoreboard(e, sbId)}
                                        />
                                    )}
                                </Group>
                            </Tabs.Tab>
                        );
                    })}
                </Tabs.List>
                <Tooltip label="Add scoreboard">
                    <ActionIcon variant="subtle" size="md" ml="xs" onClick={handleAddScoreboard}>
                        <Text size="lg" lh={1}>+</Text>
                    </ActionIcon>
                </Tooltip>
            </Group>

            {active.map(sbId => (
                <Tabs.Panel key={sbId} value={String(sbId)}>
                    <ScoreboardTab scoreboardNumber={sbId} />
                </Tabs.Panel>
            ))}
        </Tabs>
    );
}
