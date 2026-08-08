import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { Text } from '../../components/ui/primitives';
import { Badge } from '../../components/ui/badge';
import { cn } from '../../lib/utils';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore, useStateStore } from '../../context/store';
import MatchPanel from './MatchPanel';
import ScoreControls from '../../components/scoreboard/ScoreControls';
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
 * A single scoreboard: game state + its game pool.
 *
 * The roster grid, per-character stat editing and manual runner/fielder
 * placement used to live here too. All three were read-only under HUD, nobody
 * used them, and they were ~1,400 lines of surface between the producer and the
 * two controls on this tab that earn their place. Deleted rather than moved.
 */
function ScoreboardTab({ scoreboardNumber }) {
    const setItems = useStateStore(s => s.setItems);

    // Transport is derived, not selected: board 1 carries the local HUD when the
    // global HUD toggle is on; every other board (and board 1 with HUD off) is
    // API transport. See server/bindings.py.
    const hudEnabled = useSettingsStore(s => s?.project_rio?.hud_enabled ?? true);
    const transport = (scoreboardNumber === 1 && hudEnabled) ? 'hud' : 'api';

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
            <div className="md:col-span-3">
                <ScoreControls
                    scoreboardNumber={scoreboardNumber}
                    onSwapTeams={handleSwapTeams}
                    transport={transport}
                />
            </div>

            {/* A HUD board has no pool to browse — its game is whatever Project
                Rio is playing locally. */}
            {transport !== 'hud' && (
                <div className="md:col-span-7">
                    <PoolBrowser scoreboardNumber={scoreboardNumber} />
                </div>
            )}
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
    // A board removed on the console takes its tab with it, so fall back rather
    // than leaving the strip pointing at nothing.
    useEffect(() => {
        if (!active.map(String).includes(activeTab)) setActiveTab(String(active[0] ?? 1));
    }, [active, activeTab]);

    return (
        <>
        <MatchPanel />
        <Tabs value={activeTab} onValueChange={setActiveTab}>
            {/* Navigation only. Adding, renaming and removing a board are the
                console's job — the rack's DESK section has a row per board, a +
                in its header, and rename/remove on each board's own panel. Two
                places to manage the rig is the duplication boards became desks
                to end. */}
            <div className="mb-4 flex items-center gap-2">
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
                                </span>
                            </TabsTrigger>
                        );
                    })}
                </TabsList>
                <Text size="xs" dimmed span>
                    Boards are added and renamed on the Production tab.
                </Text>
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
