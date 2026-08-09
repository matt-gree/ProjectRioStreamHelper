import { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { Text } from '../../components/ui/primitives';
import { Badge } from '../../components/ui/badge';
import { cn } from '../../lib/utils';
import { useSettingsStore } from '../../context/store';
import PoolBrowser from '../../components/scoreboard/PoolBrowser';

/*
 * The Match tab — now ONE thing: which API games fill which board.
 *
 * It used to be three. Fixture authoring lived here as a stack of fully-expanded
 * cards (MatchPanel) beside the console's own Match desk, so the same match was
 * authored in two places with different controls; and every board carried a
 * "Game State" panel (ScoreControls) whose score, inning, count, stadium,
 * stats tag, swap and reset are the board desk's corrections now. Both are
 * deleted — the four verbs MatchPanel had that the desk lacked (flip, decide,
 * reopen, retire) moved onto the desk first, and Retire turned out to be one
 * chip click once a match could only ever hold one board.
 *
 * What is left is the game pool and playback authoring (PoolBrowser), which is
 * the last thing on this tab and the reason it still exists. When that moves to
 * the board desk, this route, this file and the tab go with it.
 */

// Stable fallback references. Zustand v5's useStore uses the raw
// useSyncExternalStore (no selector memoization), so an inline `?? []`/`?? {}`
// fallback returns a new reference every getSnapshot call and loops React
// ("getSnapshot should be cached" → "Maximum update depth exceeded"). Only a
// hazard when the underlying key is momentarily absent (e.g. a fresh profile
// with no aliases, or the split active/binding broadcasts during add/remove),
// but cheap to make bulletproof.
const DEFAULT_ACTIVE = [1];
const EMPTY_OBJ = {};

// Tinted-translucent chips per the Rio brand — never solid fills.
const BADGES = {
    hud:    { color: 'bg-[#22c55e]/15 text-[#4ade80]', label: 'HUD' },
    api:    { color: 'bg-[#3b82f6]/15 text-[#60a5fa]', label: 'API' },
    rotate: { color: 'bg-[#a855f7]/15 text-[#c084fc]', label: 'Rotator' },
};

// Resolve the single tab badge from transport + binding. Empty single boards
// (manual/editable) get no badge.
function tabBadge({ transport, mode }) {
    if (transport === 'hud') return BADGES.hud;
    if (mode === 'rotate') return BADGES.rotate;
    return BADGES.api;
}

/** The display label for a tab: always "N" or "N: Alias". */
function tabLabel(sbId, alias) {
    if (alias) return `${sbId}: ${alias}`;
    return String(sbId);
}

export default function ScoreboardManager() {
    const active = useSettingsStore(s => s?.scoreboards?.active ?? DEFAULT_ACTIVE);
    const bindings = useSettingsStore(s => s?.scoreboards?.binding ?? EMPTY_OBJ);
    const aliases = useSettingsStore(s => s?.scoreboards?.aliases ?? EMPTY_OBJ);
    const hudEnabled = useSettingsStore(s => s?.project_rio?.hud_enabled ?? true);
    const [activeTab, setActiveTab] = useState(String(active[0] ?? 1));
    // A board removed on the console takes its tab with it, so fall back rather
    // than leaving the strip pointing at nothing.
    useEffect(() => {
        if (!active.map(String).includes(activeTab)) setActiveTab(String(active[0] ?? 1));
    }, [active, activeTab]);

    return (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
            {/* Navigation only. Adding, renaming and removing a board are the
                console's job — the rack's BOARDS section has a row per board, a +
                and a remove in that section, and rename on each board's own
                panel. Two places to manage the rig is the duplication boards
                became desks to end. */}
            <div className="mb-4 flex items-center gap-2">
                <TabsList>
                    {active.map(sbId => {
                        const bind = bindings[sbId] ?? bindings[String(sbId)] ?? {};
                        // Transport is derived, not selected: board 1 carries the
                        // local HUD when the global HUD toggle is on; every other
                        // board (and board 1 with HUD off) is API transport. See
                        // server/bindings.py.
                        const transport = (sbId === 1 && hudEnabled) ? 'hud' : 'api';
                        const badge = tabBadge({
                            transport,
                            mode: bind.playback?.mode ?? 'single',
                        });
                        const alias = aliases[sbId] ?? aliases[String(sbId)] ?? '';
                        return (
                            <TabsTrigger key={sbId} value={String(sbId)}>
                                <span className="flex flex-nowrap items-center gap-1.5">
                                    <Text size="sm" span>{tabLabel(sbId, alias)}</Text>
                                    <Badge className={cn('text-[10px] font-semibold uppercase tracking-wider', badge.color)}>
                                        {badge.label}
                                    </Badge>
                                </span>
                            </TabsTrigger>
                        );
                    })}
                </TabsList>
                <Text size="xs" dimmed span>
                    Boards are added, renamed and removed on the Production tab.
                </Text>
            </div>

            {active.map(sbId => (
                <TabsContent key={sbId} value={String(sbId)}>
                    {(sbId === 1 && hudEnabled) ? (
                        /* A HUD board has no pool to browse — its game is whatever
                           Project Rio is playing locally. The tab used to fall back
                           to the Game State panel here, so this said nothing; now
                           it has to name the reason, or board 1 reads as broken. */
                        <Text size="sm" dimmed>
                            This board follows the local HUD feed, so it has no game pool.
                            Turn off Settings → Project Rio → HUD to bind it to API games
                            instead.
                        </Text>
                    ) : (
                        <PoolBrowser scoreboardNumber={sbId} />
                    )}
                </TabsContent>
            ))}
        </Tabs>
    );
}
