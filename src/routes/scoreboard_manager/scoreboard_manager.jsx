import { useState, useCallback } from 'react';
import {
    Tabs, Grid, Stack, ActionIcon, Group, Text, Badge, Tooltip, CloseButton,
    TextInput, Popover, Box,
} from '@mantine/core';
import { useSettingsStore, useStateStore } from '../../context/store';
import TeamPanel from '../../components/scoreboard/TeamPanel';
import ScoreControls from '../../components/scoreboard/ScoreControls';
import ActiveMatchupStats from '../../components/scoreboard/ActiveMatchupStats';
import DiamondPanel from '../../components/scoreboard/DiamondPanel';
import RotationControls from '../../components/scoreboard/RotationControls';
import LiveGameSelector from '../../components/scoreboard/LiveGameSelector';
import CompletedGameInfo from '../../components/scoreboard/CompletedGameInfo';

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
        const state = useStateStore.getState();
        const base = state?.score?.[scoreboardNumber];
        const sb = `score.${scoreboardNumber}`;
        const currentHome = Number(base?.home_team ?? 2);
        const newHome = currentHome === 1 ? 2 : 1;

        if (sourceType === 'hud') {
            // Swap start.gg profile fields client-side (server only handles Rio game data)
            const t1 = base?.player?.[1] ?? {};
            const t2 = base?.player?.[2] ?? {};
            const profileFields = ['full_name', 'country', 'state', 'pronoun'];
            const swapEntries = [
                { key: `${sb}.home_team`, value: newHome },
            ];
            for (const f of profileFields) {
                swapEntries.push({ key: `${sb}.player.1.${f}`, value: t2[f] ?? '' });
                swapEntries.push({ key: `${sb}.player.2.${f}`, value: t1[f] ?? '' });
            }
            setItems(swapEntries);
            try {
                await fetch(
                    `/api/v1/rio/swap?scoreboard_number=${scoreboardNumber}`,
                    { method: 'POST' },
                );
            } catch { /* server swap failed, but home_team is already flipped */ }
            return;
        }

        setItems([
            { key: `${sb}.player.1`, value: base?.player?.[2] ?? {} },
            { key: `${sb}.player.2`, value: base?.player?.[1] ?? {} },
            { key: `${sb}.score_left`, value: base?.score_right ?? 0 },
            { key: `${sb}.score_right`, value: base?.score_left ?? 0 },
            { key: `${sb}.home_team`, value: newHome },
            { key: `${sb}.teamsSwapped`, value: !(base?.teamsSwapped ?? false) },
        ]);
    }, [scoreboardNumber, setItems, sourceType]);

    const handleSetSource = useCallback(async (newSource) => {
        await fetch(`/api/v1/scoreboards/${scoreboardNumber}/source?source_type=${newSource}`, {
            method: 'PUT',
        });
    }, [scoreboardNumber]);

    return (
        <Grid gutter="md" align="flex-start" columns={10}>
            <Grid.Col span={{ base: 10, md: 4 }}>
                <Stack gap="md">
                    <TeamPanel
                        scoreboardNumber={scoreboardNumber}
                        teamNumber={1}
                        playerCount={1}
                        sourceType={sourceType}
                    />
                    {sourceType === 'rotator' && (
                        <CompletedGameInfo scoreboardNumber={scoreboardNumber} />
                    )}
                    <ActiveMatchupStats scoreboardNumber={scoreboardNumber} />
                </Stack>
            </Grid.Col>

            <Grid.Col span={{ base: 10, md: 2 }}>
                <Stack gap="md">
                    <ScoreControls
                        scoreboardNumber={scoreboardNumber}
                        onSwapTeams={handleSwapTeams}
                        sourceType={sourceType}
                        onSetSource={handleSetSource}
                    />
                    <DiamondPanel scoreboardNumber={scoreboardNumber} />
                </Stack>
            </Grid.Col>

            <Grid.Col span={{ base: 10, md: 4 }}>
                <Stack gap="md">
                    <TeamPanel
                        scoreboardNumber={scoreboardNumber}
                        teamNumber={2}
                        playerCount={1}
                        sourceType={sourceType}
                    />
                    {sourceType === 'live_game' && (
                        <LiveGameSelector scoreboardNumber={scoreboardNumber} />
                    )}
                    {sourceType === 'rotator' && (
                        <RotationControls scoreboardNumber={scoreboardNumber} />
                    )}
                </Stack>
            </Grid.Col>
        </Grid>
    );
}

const SOURCE_BADGE = {
    hud:       { color: 'green',  label: 'HUD' },
    live_game: { color: 'blue',   label: 'API' },
    rotator:   { color: 'violet', label: 'Rotator' },
    // backward compat
    ongoing_api:   { color: 'blue',   label: 'API' },
    completed_api: { color: 'violet', label: 'Rotator' },
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
                <Box
                    component="span"
                    role="button"
                    tabIndex={0}
                    style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
                    onClick={(e) => { e.stopPropagation(); setValue(currentAlias); setOpened(true); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setValue(currentAlias); setOpened(true); } }}
                >
                    <Text size="xs" lh={1}>&#9998;</Text>
                </Box>
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
                        <Box
                            component="span"
                            role="button"
                            tabIndex={0}
                            style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
                            onClick={handleSave}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                        >
                            <Text size="xs" lh={1}>&#10003;</Text>
                        </Box>
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
                                            component="div"
                                            role="button"
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
