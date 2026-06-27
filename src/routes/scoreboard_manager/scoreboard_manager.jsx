import { useState, useCallback } from 'react';
import { Pencil, Check, X, Plus } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { Stack, Text } from '../../components/ui/primitives';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import { cn } from '../../lib/utils';
import { useSettingsStore, useStateStore } from '../../context/store';
import MatchPanel from './MatchPanel';
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
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-10">
            <div className="md:col-span-4">
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
            </div>

            <div className="md:col-span-2">
                <Stack gap="md">
                    <ScoreControls
                        scoreboardNumber={scoreboardNumber}
                        onSwapTeams={handleSwapTeams}
                        sourceType={sourceType}
                        onSetSource={handleSetSource}
                    />
                    <DiamondPanel scoreboardNumber={scoreboardNumber} />
                </Stack>
            </div>

            <div className="md:col-span-4">
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
            </div>
        </div>
    );
}

// Tinted-translucent chips per the Rio brand — never solid fills.
const SOURCE_BADGE = {
    hud:       { color: 'bg-[#22c55e]/15 text-[#4ade80]', label: 'HUD' },
    live_game: { color: 'bg-[#3b82f6]/15 text-[#60a5fa]', label: 'API' },
    rotator:   { color: 'bg-[#a855f7]/15 text-[#c084fc]', label: 'Rotator' },
    // backward compat
    ongoing_api:   { color: 'bg-[#3b82f6]/15 text-[#60a5fa]', label: 'API' },
    completed_api: { color: 'bg-[#a855f7]/15 text-[#c084fc]', label: 'Rotator' },
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
        <Popover open={opened} onOpenChange={setOpened}>
            <PopoverTrigger asChild>
                <span
                    role="button"
                    tabIndex={0}
                    className="inline-flex cursor-pointer items-center text-muted-foreground hover:text-foreground"
                    onClick={(e) => { e.stopPropagation(); setValue(currentAlias); setOpened(true); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setValue(currentAlias); setOpened(true); } }}
                >
                    <Pencil size={12} />
                </span>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" onClick={(e) => e.stopPropagation()}>
                <div className="relative flex items-center">
                    <Input
                        placeholder="Alias (optional)"
                        value={value}
                        onChange={(e) => setValue(e.currentTarget.value)}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        className="pr-8"
                    />
                    <button
                        type="button"
                        className="absolute right-2 inline-flex items-center text-muted-foreground hover:text-foreground"
                        onClick={handleSave}
                    >
                        <Check size={14} />
                    </button>
                </div>
            </PopoverContent>
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
        if (!resp.ok) return;
        const data = await resp.json();
        setActiveTab(String(data.id));
    }, []);

    const handleRemoveScoreboard = useCallback(async (e, sbId) => {
        e.stopPropagation();
        const resp = await fetch(`/api/v1/scoreboards/${sbId}`, { method: 'DELETE' });
        if (!resp.ok) return;
        const data = await resp.json();
        const remaining = data.active ?? [1];
        setActiveTab(String(remaining[0]));
    }, []);

    return (
        <>
        <MatchPanel />
        <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="mb-4 flex items-center gap-1">
                <TabsList>
                    {active.map(sbId => {
                        const src = sources[sbId] ?? sources[String(sbId)];
                        const srcType = src?.type ?? 'manual';
                        const badge = SOURCE_BADGE[srcType];
                        const alias = aliases[sbId] ?? aliases[String(sbId)] ?? '';
                        return (
                            <TabsTrigger key={sbId} value={String(sbId)}>
                                <span className="flex flex-nowrap items-center gap-1.5">
                                    <Text size="sm" span>{tabLabel(sbId, alias)}</Text>
                                    {badge && (
                                        <Badge className={cn('text-[10px] font-semibold uppercase tracking-wider', badge.color)}>
                                            {badge.label}
                                        </Badge>
                                    )}
                                    <RenamePopover sbId={sbId} currentAlias={alias} />
                                    {active.length > 1 && (
                                        <span
                                            role="button"
                                            tabIndex={0}
                                            className="inline-flex cursor-pointer items-center text-muted-foreground hover:text-foreground"
                                            onClick={(e) => handleRemoveScoreboard(e, sbId)}
                                        >
                                            <X size={12} />
                                        </span>
                                    )}
                                </span>
                            </TabsTrigger>
                        );
                    })}
                </TabsList>
                <SimpleTooltip label="Add scoreboard">
                    <Button variant="ghost" size="icon-sm" onClick={handleAddScoreboard}>
                        <Plus size={18} />
                    </Button>
                </SimpleTooltip>
            </div>

            {active.map(sbId => (
                <TabsContent key={sbId} value={String(sbId)}>
                    <ScoreboardTab scoreboardNumber={sbId} />
                </TabsContent>
            ))}
        </Tabs>
        </>
    );
}
