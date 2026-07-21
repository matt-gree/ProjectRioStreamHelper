import { useState, useEffect, useCallback, useMemo } from 'react';
import { RotateCw, Settings as SettingsIcon } from 'lucide-react';
import { Stack, Text, Loader } from '../../components/ui/primitives';
import { Panel } from '../../components/ui/panel';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
import { Collapsible, CollapsibleContent } from '../../components/ui/collapsible';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import { CopyButton } from '../../components/ui/copy-button';
import ScaledIframe, { DEFAULT_PREVIEW_HEIGHT as PREVIEW_HEIGHT } from '../../components/ScaledIframe';
import { cn } from '../../lib/utils';
import { notifications } from '../../lib/notify';
import { useSettingsStore, useConfigStore } from '../../context/store';
import { useObsStore } from '../../context/obs';
import { usePersistentState } from '../../hooks/usePersistentState';
import { bindingBadgeKey, SOURCE_COLORS, SOURCE_LABEL, ObsBindingControls } from './binding';
import { LayoutList, LayoutItem, ANIMATED_TYPES } from './catalog';
import { BracketLayoutList } from './bracket';
import { LayoutSettingsPanel } from './layoutSettings';
import { DesignTabBody } from './design';
import { ControllerOverlayPanel } from './controller';

export default function LayoutBrowser() {
    const active = useSettingsStore(s => s?.scoreboards?.active ?? [1]);
    const bindings = useSettingsStore(s => s?.scoreboards?.binding ?? {});
    const hudEnabled = useSettingsStore(s => s?.project_rio?.hud_enabled ?? true);
    const aliases = useSettingsStore(s => s?.scoreboards?.aliases ?? {});
    const controllerSupported = useConfigStore(s => s.controller_overlay_supported) !== false;

    const [allLayouts, setAllLayouts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selected, setSelected] = useState(null);
    const [activeScoreboardTab, setActiveScoreboardTab] = useState(String(active[0] ?? 1));
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [previewRevision, setPreviewRevision] = useState(0);

    // Remember the last Setup sub-tab across tab switches / restarts (local UI
    // pref). Drop a stored 'controller' when this build can't show it.
    const [mode, setMode] = usePersistentState(
        'prsh.ui.setup.mode', 'scoreboard',
        v => ['design', 'scoreboard', 'scenes', 'talent', 'break', 'shared', 'bracket', 'controller'].includes(v)
            && (v !== 'controller' || controllerSupported),
    );

    const fetchLayouts = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const resp = await fetch('/api/v1/layouts');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            setAllLayouts(await resp.json());
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchLayouts();
    }, [fetchLayouts]);

    const filteredLayouts = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return allLayouts.filter(l => {
            if (l.group === 'bracket') return false;
            const isScoreboard = l.group.startsWith('scoreboard') || l.group === 'scorecard' || l.group === 'rotator';
            if (!isScoreboard) return false;
            if (q && !l.name.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [allLayouts, searchQuery]);

    const sceneLayouts = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return allLayouts.filter(l => {
            // Full 1920×1080 scenes, plus the Event Header banner which lives with
            // the scene-level furniture in this grouping.
            if (l.group !== 'scenes' && l.group !== 'eventheader') return false;
            if (q && !l.name.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [allLayouts, searchQuery]);

    // Shared "fed" sources (e.g. the stats-feed the producer feeds content to
    // from the Production page). They live under public/layout/shared/.
    const sharedLayouts = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return allLayouts.filter(l => {
            if (l.group !== 'shared') return false;
            if (q && !l.name.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [allLayouts, searchQuery]);

    // Talent — registry-bound person and matchup overlays: the commentary
    // caster strip, the player-plates band, and the Matchup History card.
    // All three render content fed from the address book / match.
    const talentLayouts = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return allLayouts.filter(l => {
            if (l.group !== 'commentary' && l.group !== 'playerplates' && l.group !== 'matchup') return false;
            if (q && !l.name.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [allLayouts, searchQuery]);

    // Break — broadcast-furniture overlays for breaks / mid-game cuts. The
    // re-themable SVG lower-third now; more break graphics may join later.
    const breakLayouts = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return allLayouts.filter(l => {
            if (l.group !== 'lowerthird') return false;
            if (q && !l.name.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [allLayouts, searchQuery]);

    useEffect(() => {
        const activeLayouts = mode === 'scenes' ? sceneLayouts
            : mode === 'shared' ? sharedLayouts
            : mode === 'talent' ? talentLayouts
            : mode === 'break' ? breakLayouts
            : filteredLayouts;
        if (mode !== 'scoreboard' && mode !== 'scenes' && mode !== 'shared' && mode !== 'talent' && mode !== 'break') return;
        if (activeLayouts.length > 0) {
            setSelected(prev => {
                if (prev && activeLayouts.some(l => l.url === prev.url)) return prev;
                return activeLayouts[0];
            });
        } else {
            setSelected(null);
        }
    }, [filteredLayouts, sceneLayouts, sharedLayouts, talentLayouts, breakLayouts, mode]);

    useEffect(() => {
        setSearchQuery('');
        setSelected(null);
        setSettingsOpen(false);
        setPreviewRevision(0);
    }, [mode]);

    useEffect(() => {
        setSearchQuery('');
    }, [activeScoreboardTab]);

    useEffect(() => {
        setSettingsOpen(false);
    }, [selected?.url]);

    const selectedType = selected?.type;
    const supportedSettings = useMemo(() => {
        if (selected?.supportedSettings) return selected.supportedSettings;
        if (!selectedType) return null;
        const match = allLayouts.find(l => l.type === selectedType && l.supportedSettings);
        return match?.supportedSettings ?? null;
    }, [selected?.supportedSettings, selectedType, allLayouts]);
    const hasAnySupportedSettings = supportedSettings === null || supportedSettings.length > 0;
    const showSettingsPanel = !!selectedType && hasAnySupportedSettings && mode !== 'design';

    const setSetting = useSettingsStore(s => s.setItem);
    const isAnimatedType = !!selectedType && ANIMATED_TYPES.has(selectedType);
    const introDisabled = useSettingsStore(s => !!s?.overlays?.[selectedType]?.disableIntro);

    const selectedUrl = useMemo(() => {
        if (!selected?.url) return null;
        try {
            const u = new URL(selected.url);
            if (mode === 'scoreboard') {
                u.searchParams.set('scoreboard', activeScoreboardTab);
            }
            // Carry the intro opt-out into the copy/preview/Add-to-OBS URL so a
            // newly-added source starts in the right state.
            if (isAnimatedType && introDisabled) u.searchParams.set('intro', '0');
            return u.toString();
        } catch {
            return selected.url;
        }
    }, [selected?.url, activeScoreboardTab, mode, isAnimatedType, introDisabled]);

    // Turn the reveal animation on/off for this layout. Persists the preference
    // (drives the copy/preview URL above) AND rewrites any already-added OBS
    // sources of this layout in place, so bound sources update without re-copying.
    const setIntroEnabled = useCallback(async (animOn) => {
        if (!selectedType || !selected?.url) return;
        const disabled = !animOn;
        setSetting(`overlays.${selectedType}.disableIntro`, disabled);
        setPreviewRevision(r => r + 1);
        try {
            const path = new URL(selected.url).pathname;
            const n = await useObsStore.getState().setLayoutIntroDisabled(path, disabled);
            if (n) notifications.show({
                message: `Intro animation ${disabled ? 'off' : 'on'} — updated ${n} OBS source${n > 1 ? 's' : ''}`,
                color: 'green',
            });
        } catch { /* OBS offline or source gone — the setting still persists */ }
    }, [selectedType, selected?.url, setSetting]);

    const baseUrl = useMemo(() => {
        try {
            const first = allLayouts.find(l => l.group === 'bracket');
            if (first) return new URL(first.url).origin;
        } catch { /* malformed URL — fall through to the default */ }
        return `http://localhost:5260`;
    }, [allLayouts]);

    return (
        <Stack gap="md">
            {/* Top-level mode tabs */}
            <Tabs value={mode} onValueChange={setMode}>
                <TabsList>
                    <TabsTrigger value="design">Design</TabsTrigger>
                    <TabsTrigger value="scoreboard">Scoreboards</TabsTrigger>
                    <TabsTrigger value="scenes">Scenes</TabsTrigger>
                    <TabsTrigger value="talent">Talent</TabsTrigger>
                    <TabsTrigger value="break">Break</TabsTrigger>
                    <TabsTrigger value="shared">Shared</TabsTrigger>
                    <TabsTrigger value="bracket">Bracket</TabsTrigger>
                    {controllerSupported && <TabsTrigger value="controller">Controller</TabsTrigger>}
                </TabsList>
            </Tabs>

            {/* Scoreboard sub-tabs (only in scoreboard mode) */}
            {mode === 'scoreboard' && (
                <Tabs value={activeScoreboardTab} onValueChange={setActiveScoreboardTab}>
                    <TabsList>
                        {active.map(sbId => {
                            const bind = bindings[sbId] ?? bindings[String(sbId)] ?? {};
                            const transport = (sbId === 1 && hudEnabled) ? 'hud' : 'api';
                            const srcType = bindingBadgeKey({
                                transport,
                                mode: bind.playback?.mode ?? 'single',
                                gameId: bind.playback?.gameId ?? null,
                            });
                            const alias = aliases[sbId] ?? aliases[String(sbId)] ?? '';
                            const label = alias || `Scoreboard ${sbId}`;
                            return (
                                <TabsTrigger key={sbId} value={String(sbId)}>
                                    <span className="flex items-center gap-1.5">
                                        {label}
                                        <Badge className={cn('text-[10px] font-semibold uppercase tracking-wider', SOURCE_COLORS[srcType] || SOURCE_COLORS.manual)}>
                                            {SOURCE_LABEL[srcType] || srcType}
                                        </Badge>
                                    </span>
                                </TabsTrigger>
                            );
                        })}
                    </TabsList>
                </Tabs>
            )}

            {mode === 'design' ? (
                <DesignTabBody baseUrl={baseUrl} />
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                    {/* Left panel: layout list */}
                    <div className="md:col-span-4">
                        <Stack gap="xs">
                            <Text size="xs" dimmed>
                                Select a layout to preview. Copy the URL into an OBS Browser Source, or
                                — when OBS is connected — use Add to OBS. The dot shows whether each
                                layout is already a source in your program (green) or preview (amber) scene.
                            </Text>

                            {mode === 'scoreboard' && (
                                <>
                                    <Input placeholder="Search layouts..." value={searchQuery} onChange={(e) => setSearchQuery(e.currentTarget.value)} />
                                    {loading && <Loader size={18} />}
                                    {error && <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
                                    <LayoutList layouts={filteredLayouts} selected={selected} onSelect={setSelected} activeTab={activeScoreboardTab} />
                                </>
                            )}

                            {mode === 'scenes' && (
                                <>
                                    <Input placeholder="Search scenes..." value={searchQuery} onChange={(e) => setSearchQuery(e.currentTarget.value)} />
                                    {loading && <Loader size={18} />}
                                    {error && <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
                                    {sceneLayouts.length === 0 && !loading && (
                                        <Text size="sm" dimmed>No scene layouts found.</Text>
                                    )}
                                    <Stack gap="xs">
                                        {sceneLayouts.map(item => (
                                            <LayoutItem key={item.url} item={item} selected={selected} onSelect={setSelected} activeTab={activeScoreboardTab} />
                                        ))}
                                    </Stack>
                                </>
                            )}

                            {mode === 'talent' && (
                                <>
                                    <Text size="xs" dimmed>
                                        Talent and matchup overlays — the commentary caster strip, the
                                        player-plates band, and the Matchup History card. Author them on
                                        the Commentary / Match tabs; control them live from the
                                        Production page.
                                    </Text>
                                    <Input placeholder="Search talent overlays..." value={searchQuery} onChange={(e) => setSearchQuery(e.currentTarget.value)} />
                                    {loading && <Loader size={18} />}
                                    {error && <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
                                    {talentLayouts.length === 0 && !loading && (
                                        <Text size="sm" dimmed>No talent overlays found.</Text>
                                    )}
                                    <Stack gap="xs">
                                        {talentLayouts.map(item => (
                                            <LayoutItem key={item.url} item={item} selected={selected} onSelect={setSelected} activeTab={activeScoreboardTab} />
                                        ))}
                                    </Stack>
                                </>
                            )}

                            {mode === 'break' && (
                                <>
                                    <Text size="xs" dimmed>
                                        Break graphics — the re-themable lower-third (logo · match ·
                                        title · clock). Add it to OBS and author the match/title/countdown
                                        live from the Production page → Break. Its look follows the
                                        Design Package picked on the Design tab.
                                    </Text>
                                    <Input placeholder="Search break overlays..." value={searchQuery} onChange={(e) => setSearchQuery(e.currentTarget.value)} />
                                    {loading && <Loader size={18} />}
                                    {error && <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
                                    {breakLayouts.length === 0 && !loading && (
                                        <Text size="sm" dimmed>No break overlays found.</Text>
                                    )}
                                    <Stack gap="xs">
                                        {breakLayouts.map(item => (
                                            <LayoutItem key={item.url} item={item} selected={selected} onSelect={setSelected} activeTab={activeScoreboardTab} />
                                        ))}
                                    </Stack>
                                </>
                            )}

                            {mode === 'shared' && (
                                <>
                                    <Text size="xs" dimmed>
                                        Shared “fed” sources. Add one to OBS once, then choose what it
                                        shows from the Production page (e.g. which player’s stats).
                                    </Text>
                                    <Input placeholder="Search shared sources..." value={searchQuery} onChange={(e) => setSearchQuery(e.currentTarget.value)} />
                                    {loading && <Loader size={18} />}
                                    {error && <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
                                    {sharedLayouts.length === 0 && !loading && (
                                        <Text size="sm" dimmed>No shared sources found.</Text>
                                    )}
                                    <Stack gap="xs">
                                        {sharedLayouts.map(item => (
                                            <LayoutItem key={item.url} item={item} selected={selected} onSelect={setSelected} activeTab={activeScoreboardTab} />
                                        ))}
                                    </Stack>
                                </>
                            )}

                            {mode === 'bracket' && (
                                <BracketLayoutList selected={selected} onSelect={setSelected} baseUrl={baseUrl} />
                            )}

                            {mode === 'controller' && (
                                <ControllerOverlayPanel selected={selected} onSelect={setSelected} />
                            )}
                        </Stack>
                    </div>

                    {/* Right panel: iframe preview + settings */}
                    <div className="md:col-span-8">
                        <Panel className="overflow-hidden">
                            {selected && selectedUrl ? (
                                <>
                                    <div className="flex flex-nowrap items-center justify-between gap-1 border-b border-border p-2">
                                        <Text size="xs" dimmed truncate className="min-w-0 flex-1">{selectedUrl}</Text>
                                        <div className="flex flex-nowrap items-center gap-1">
                                            <ObsBindingControls
                                                url={selectedUrl}
                                                name={selected?.name || selectedType || 'PRSH Overlay'}
                                                width={selected?.width}
                                                height={selected?.height}
                                            />
                                            {isAnimatedType && (
                                                <SimpleTooltip label={introDisabled
                                                    ? 'Intro animation off — source stays resident (no reload on show)'
                                                    : 'Intro animation on — source reloads on show for a clean reveal'}>
                                                    <label className="flex items-center gap-1.5 whitespace-nowrap px-1">
                                                        <Text size="xs" dimmed>Intro</Text>
                                                        <Switch
                                                            checked={!introDisabled}
                                                            onCheckedChange={setIntroEnabled}
                                                        />
                                                    </label>
                                                </SimpleTooltip>
                                            )}
                                            <SimpleTooltip label="Reload preview">
                                                <Button variant="ghost" size="icon-sm" onClick={() => setPreviewRevision(r => r + 1)}>
                                                    <RotateCw size={14} />
                                                </Button>
                                            </SimpleTooltip>
                                            {showSettingsPanel && (
                                                <SimpleTooltip label={settingsOpen ? 'Close settings' : 'Layout settings'}>
                                                    <Button variant={settingsOpen ? 'default' : 'ghost'} size="icon-sm" onClick={() => setSettingsOpen(o => !o)}>
                                                        <SettingsIcon size={14} />
                                                    </Button>
                                                </SimpleTooltip>
                                            )}
                                            <CopyButton value={selectedUrl}>
                                                {({ copied, copy }) => (
                                                    <SimpleTooltip label={copied ? 'Copied!' : 'Copy URL'}>
                                                        <Button variant="ghost" size="xs" className={copied ? 'text-[#14b8a6]' : ''} onClick={copy}>
                                                            {copied ? 'Copied' : 'Copy'}
                                                        </Button>
                                                    </SimpleTooltip>
                                                )}
                                            </CopyButton>
                                        </div>
                                    </div>
                                    <ScaledIframe key={`${selectedUrl}-${previewRevision}`} src={selectedUrl} nativeWidth={selected?.width} nativeHeight={selected?.height} fallbackWidth={selected?.width} fallbackHeight={selected?.height} className="bg-muted" />
                                </>
                            ) : (
                                <div className="flex items-center justify-center" style={{ height: PREVIEW_HEIGHT }}>
                                    <Text dimmed>
                                        {mode === 'bracket'
                                            ? 'Select a bracket phase to preview'
                                            : mode === 'controller'
                                            ? 'Start the controller overlay to preview'
                                            : 'Select a layout to preview'}
                                    </Text>
                                </div>
                            )}
                        </Panel>

                        {showSettingsPanel && (
                            <Collapsible open={settingsOpen}>
                                <CollapsibleContent>
                                    <Panel className="mt-2 p-3">
                                        <Text size="sm" fw={600} className="mb-2 capitalize">
                                            {selectedType} Settings
                                        </Text>
                                        <LayoutSettingsPanel layoutType={selectedType} supportedSettings={supportedSettings} scoreboardId={mode === 'scoreboard' ? activeScoreboardTab : null} />
                                    </Panel>
                                </CollapsibleContent>
                            </Collapsible>
                        )}
                    </div>
                </div>
            )}
        </Stack>
    );
}
