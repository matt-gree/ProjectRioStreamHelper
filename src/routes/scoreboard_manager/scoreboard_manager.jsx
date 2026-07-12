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
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore, useStateStore } from '../../context/store';
import MatchPanel from './MatchPanel';
import TeamPanel from '../../components/scoreboard/TeamPanel';
import ScoreControls from '../../components/scoreboard/ScoreControls';
import ActiveMatchupStats from '../../components/scoreboard/ActiveMatchupStats';
import DiamondPanel from '../../components/scoreboard/DiamondPanel';
import PoolBrowser from '../../components/scoreboard/PoolBrowser';

// Stable fallback references. Zustand v5's useStore uses the raw
// useSyncExternalStore (no selector memoization), so an inline `?? []`/`?? {}`
// fallback returns a new reference every getSnapshot call and loops React
// ("getSnapshot should be cached" → "Maximum update depth exceeded"). Only a
// hazard when the underlying key is momentarily absent (e.g. a fresh profile
// with no aliases, or the split active/binding broadcasts during add/remove),
// but cheap to make bulletproof.
const DEFAULT_ACTIVE = [1];
const EMPTY_OBJ = {};

/**
 * A single scoreboard instance (team panels + score controls).
 */
function ScoreboardTab({ scoreboardNumber }) {
    const setItems = useStateStore(s => s.setItems);

    // Transport is derived, not selected: board 1 carries the local HUD when the
    // global HUD toggle is on; every other board (and board 1 with HUD off) is
    // API transport. See server/bindings.py.
    const hudEnabled = useSettingsStore(s => s?.project_rio?.hud_enabled ?? true);
    const transport = (scoreboardNumber === 1 && hudEnabled) ? 'hud' : 'api';

    // Binding: playback.mode (single | rotate) + the currently-followed gameId.
    const mode = useSettingsStore(
        s => s?.scoreboards?.binding?.[scoreboardNumber]?.playback?.mode
            ?? s?.scoreboards?.binding?.[String(scoreboardNumber)]?.playback?.mode
            ?? 'single'
    );
    const gameId = useSettingsStore(
        s => s?.scoreboards?.binding?.[scoreboardNumber]?.playback?.gameId
            ?? s?.scoreboards?.binding?.[String(scoreboardNumber)]?.playback?.gameId
            ?? null
    );

    // Effective read-only mode for the editor components (they still key off a
    // "sourceType" string): HUD and a loaded single game are read-only; an
    // empty single board and a rotating pool stay editable.
    const effectiveSourceType = transport === 'hud'
        ? 'hud'
        : (mode === 'single' && gameId != null ? 'live_game' : 'manual');

    const handleSwapTeams = useCallback(async () => {
        const state = useStateStore.getState();
        const base = state?.score?.[scoreboardNumber];
        const sb = `score.${scoreboardNumber}`;
        const currentHome = Number(base?.home_team ?? 2);
        const newHome = currentHome === 1 ? 2 : 1;

        if (transport === 'hud') {
            // A HUD board's live feed keeps writing its sides, so the swap is
            // owned entirely by the server: /rio/swap flips the orientation flag
            // and re-applies the whole player unit (address-book identity
            // included) — or, with no live frame, swaps what's already in State.
            // One authoritative broadcast keeps the UI and every overlay in sync;
            // no partial client-side swap (that split is what let them diverge).
            try {
                await fetch(
                    `/api/v1/rio/swap?scoreboard_number=${scoreboardNumber}`,
                    { method: 'POST' },
                );
            } catch { /* nothing changed client-side; nothing to roll back */ }
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
    }, [scoreboardNumber, setItems, transport]);

    return (
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-10">
            <div className="md:col-span-4">
                <Stack gap="md">
                    <TeamPanel
                        scoreboardNumber={scoreboardNumber}
                        teamNumber={1}
                        playerCount={1}
                        sourceType={effectiveSourceType}
                    />
                    <ActiveMatchupStats scoreboardNumber={scoreboardNumber} />
                </Stack>
            </div>

            <div className="md:col-span-2">
                <Stack gap="md">
                    <ScoreControls
                        scoreboardNumber={scoreboardNumber}
                        onSwapTeams={handleSwapTeams}
                        transport={transport}
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
                        sourceType={effectiveSourceType}
                    />
                    {transport !== 'hud' && (
                        <PoolBrowser scoreboardNumber={scoreboardNumber} />
                    )}
                </Stack>
            </div>
        </div>
    );
}

// Tinted-translucent chips per the Rio brand — never solid fills.
const BADGES = {
    hud:    { color: 'bg-[#22c55e]/15 text-[#4ade80]', label: 'HUD' },
    api:    { color: 'bg-[#3b82f6]/15 text-[#60a5fa]', label: 'API' },
    rotate: { color: 'bg-[#a855f7]/15 text-[#c084fc]', label: 'Rotator' },
};

// Resolve the single tab badge from transport + binding. Empty single boards
// (manual/editable) get no badge.
function tabBadge({ transport, mode, gameId }) {
    if (transport === 'hud') return BADGES.hud;
    if (mode === 'rotate') return BADGES.rotate;
    if (mode === 'single' && gameId != null) return BADGES.api;
    return null;
}

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
    const active = useSettingsStore(s => s?.scoreboards?.active ?? DEFAULT_ACTIVE);
    const bindings = useSettingsStore(s => s?.scoreboards?.binding ?? EMPTY_OBJ);
    const aliases = useSettingsStore(s => s?.scoreboards?.aliases ?? EMPTY_OBJ);
    const hudEnabled = useSettingsStore(s => s?.project_rio?.hud_enabled ?? true);
    // Live loaded game per board — the ground-truth "a game is on this board",
    // independent of the settings-side binding.gameId. Shallow-compared so the
    // tab list only re-renders when a game loads/clears, not on every pitch.
    const loadedGameIds = useStateStore(useShallow(s => {
        const out = {};
        for (const id of active) out[id] = s?.score?.[id]?.game_id ?? null;
        return out;
    }));
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
                        const bind = bindings[sbId] ?? bindings[String(sbId)] ?? {};
                        const transport = (sbId === 1 && hudEnabled) ? 'hud' : 'api';
                        const badge = tabBadge({
                            transport,
                            mode: bind.playback?.mode ?? 'single',
                            gameId: bind.playback?.gameId ?? loadedGameIds[sbId] ?? null,
                        });
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
