import { useCallback, useEffect, useState } from 'react';
import { Text, Loader } from '../../components/ui/primitives';
import { Panel } from '../../components/ui/panel';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import { notifications } from '../../lib/notify';
import { useAssetsVersionStore } from '../../lib/assets';
import { ConnBadge, ConnBody } from './connections';

/*
 * PROJECT RIO — the game itself: the HUD file PRSH reads a live game from, and
 * the MSB image pack overlays draw from.
 *
 * Both are paths into somebody else's install, and both have a real failure
 * state a producer fixes in Finder and then re-checks — exactly the work a modal
 * could not host, because you have to close a modal to do any of it.
 *
 * TWO COMPONENTS, NOT ONE, for two reasons. The page's grid is the visible one:
 * the HUD card is narrow and the asset card spans both columns, so emitted
 * together as siblings the spanning one could not fit beside the narrow one and
 * bumped OBS out of row 1, leaving a hole no CSS on the cards themselves would
 * close. The better reason is that they share nothing — separate endpoints,
 * separate failure states — and one component holding both meant one blob of
 * state where the page's own comment promises each card owns its own fetches.
 */

/*
 * The HUD file, and the one switch that says whether board 1 follows it. The
 * path and its on/off are a single decision, which is why the toggle travelled
 * here rather than staying behind with the preferences.
 */
export function RioHudConnection() {
    const [path, setPath] = useState('');
    const [resolved, setResolved] = useState(null);
    const [defaultPath, setDefaultPath] = useState('');
    const [enabled, setEnabled] = useState(true);
    const [browsing, setBrowsing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        try {
            const data = await (await fetch('/api/v1/rio/hud-path')).json();
            setPath(data.configured || '');
            setResolved(data.resolved || null);
            setDefaultPath(data.default || '');
        } catch { /* ignore */ }
        try {
            const data = await (await fetch('/api/v1/settings?key=project_rio.hud_enabled')).json();
            // Default true when unset; treat explicit false-ish as disabled.
            setEnabled(!(data === false || data === 'false' || data === '0'));
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const save = useCallback(async (next) => {
        setSaving(true);
        setError('');
        try {
            const resp = await fetch(`/api/v1/rio/hud-path?path=${encodeURIComponent(next)}`, { method: 'PUT' });
            const data = await resp.json();
            if (resp.ok) {
                setPath(next);
                setResolved(data.resolved || null);
                if (data.warning) setError(data.warning);
                else notifications.show({ message: next ? 'HUD path updated' : 'HUD path reset to default', color: 'green' });
            } else {
                setError(data.error || 'Failed to set path');
                notifications.show({ message: data.error || 'Failed to set HUD path', color: 'red' });
            }
        } catch (e) {
            setError(String(e));
            notifications.show({ message: 'Failed to set HUD path', color: 'red' });
        }
        setSaving(false);
    }, []);

    const browse = useCallback(async () => {
        setBrowsing(true);
        setError('');
        try {
            const resp = await fetch('/api/v1/rio/browse-hud', { method: 'POST' });
            const data = await resp.json();
            if (resp.ok && data.path) await save(data.path);
            else if (data.error) setError(data.error);
        } catch (e) {
            setError(String(e));
        }
        setBrowsing(false);
    }, [save]);

    const toggle = useCallback(async (on) => {
        setEnabled(on);
        try {
            await fetch(`/api/v1/scoreboards/hud-enabled?enabled=${on}`, { method: 'PUT' });
            notifications.show({
                message: on
                    ? 'HUD enabled — scoreboard 1 follows the local game'
                    : 'HUD disabled — scoreboard 1 is a normal board',
                color: 'green',
            });
        } catch {
            notifications.show({ message: 'Failed to toggle HUD', color: 'red' });
        }
    }, []);

    return (
        <Panel
            title="Project Rio — HUD file"
            actions={<ConnBadge state={!!resolved} ok="Found" bad="Not found" />}
        >
            <ConnBody>
                <Text size="xs" dimmed>
                    Path to Project Rio’s decoded.hud.json. Leave empty to use the default location.
                </Text>

                {path ? (
                    <div className="flex items-center gap-2">
                        <Input value={path} readOnly className="flex-1" />
                        <SimpleTooltip label="Clear (use default)">
                            <Button size="icon-sm" variant="ghost" className="text-destructive"
                                onClick={() => save('')} disabled={saving}>×</Button>
                        </SimpleTooltip>
                    </div>
                ) : (
                    <Input value="" placeholder={defaultPath} readOnly />
                )}

                {resolved && !path && <Text size="xs" dimmed>(using the default location)</Text>}

                <Button size="xs" variant="outline" className="w-fit" onClick={browse} disabled={browsing}>
                    {browsing && <Loader size={12} />}
                    Browse…
                </Button>

                {error && <Text size="xs" c="#ff5a5f">{error}</Text>}

                <div className="mt-2 flex items-start gap-3 border-t border-border/60 pt-3">
                    <Switch checked={enabled} onCheckedChange={toggle} className="mt-0.5" />
                    <div className="flex flex-col">
                        <Text size="sm" fw={500}>Follow local HUD on Scoreboard 1</Text>
                        <Text size="xs" dimmed>
                            When on, Scoreboard 1 auto-fills from the local Project Rio game. Turn off to use
                            Scoreboard 1 as a normal single/set board (e.g. an API-only setup).
                        </Text>
                    </div>
                </div>
            </ConnBody>
        </Panel>
    );
}

/*
 * The MSB image pack, and the Rio API cache beside it.
 *
 * SPANS BOTH COLUMNS: the census is five counted categories beside the path, and
 * under it one line of missing filenames per category — the widest thing on this
 * page, and the clearest argument for a tab over the modal it came from.
 *
 * PRSH ships no MSB images (Nintendo IP); the pack is user-supplied and
 * validated against pyrio's canonical filename lists — server/api/v1/assets.py.
 */
export function MsbAssetsConnection() {
    const [path, setPath] = useState('');
    const [defaultPath, setDefaultPath] = useState('');
    const [categories, setCategories] = useState({});
    const [browsing, setBrowsing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [revealing, setRevealing] = useState(false);
    const [error, setError] = useState('');
    const [refreshingGameData, setRefreshingGameData] = useState(false);
    const bumpAssetsVersion = useAssetsVersionStore(s => s.bump);

    const refresh = useCallback(async () => {
        try {
            const data = await (await fetch('/api/v1/assets/msb')).json();
            setPath(data.configured || '');
            setDefaultPath(data.default || '');
            setCategories(data.categories || {});
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    /*
     * Re-check when the window regains focus. In the modal this was a workaround
     * for BEING a modal — you had to close it to reach Finder. Here it is the
     * honest behaviour: the producer tabs away to drop files in and tabs back,
     * and the census should already be right when they look.
     */
    useEffect(() => {
        const onFocus = () => { refresh(); bumpAssetsVersion(); };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [refresh, bumpAssetsVersion]);

    const save = useCallback(async (next) => {
        setSaving(true);
        setError('');
        try {
            const resp = await fetch(`/api/v1/assets/msb?path=${encodeURIComponent(next)}`, { method: 'PUT' });
            const data = await resp.json();
            if (resp.ok) {
                setPath(next);
                setCategories(data.categories || {});
                bumpAssetsVersion();
                notifications.show({ message: next ? 'MSB assets path updated' : 'MSB assets path reset to default', color: 'green' });
            } else {
                setError(data.error || 'Failed to set path');
                notifications.show({ message: data.error || 'Failed to set MSB assets path', color: 'red' });
            }
        } catch (e) {
            setError(String(e));
        }
        setSaving(false);
    }, [bumpAssetsVersion]);

    const browse = useCallback(async () => {
        setBrowsing(true);
        setError('');
        try {
            const resp = await fetch('/api/v1/assets/msb/browse', { method: 'POST' });
            const data = await resp.json();
            if (resp.ok && data.path) await save(data.path);
            else if (data.error) setError(data.error);
        } catch (e) {
            setError(String(e));
        }
        setBrowsing(false);
    }, [save]);

    const reveal = useCallback(async () => {
        setRevealing(true);
        try {
            await fetch('/api/v1/assets/msb/reveal', { method: 'POST' });
        } catch { /* ignore */ }
        setRevealing(false);
    }, []);

    const refreshGameData = useCallback(async () => {
        setRefreshingGameData(true);
        try {
            const data = await (await fetch('/api/v1/rio/game-modes/refresh', { method: 'POST' })).json();
            notifications.show({
                message: `Refreshed game data — ${data.count ?? 0} active game modes`,
                color: 'green',
            });
        } catch {
            notifications.show({ message: 'Failed to refresh game data', color: 'red' });
        }
        setRefreshingGameData(false);
    }, []);

    const names = Object.keys(categories);
    const complete = names.length > 0 && Object.values(categories).every(i => i.missing_count === 0);

    return (
        <Panel
            title="MSB image pack"
            className="lg:col-span-2"
            actions={<ConnBadge state={names.length ? complete : null} ok="Complete" bad="Incomplete" />}
        >
            <ConnBody>
                <Text size="xs" dimmed>
                    Folder of character icons, team logos and other MSB images. Required — overlays and the UI
                    show broken images without it. PRSH doesn’t ship these; the default location lives under
                    user data so it survives app updates.
                </Text>

                <div className="flex items-start gap-4">
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                        {path ? (
                            <div className="flex items-center gap-2">
                                <Input value={path} readOnly className="flex-1" />
                                <SimpleTooltip label="Clear (use default)">
                                    <Button size="icon-sm" variant="ghost" className="text-destructive"
                                        onClick={() => save('')} disabled={saving}>×</Button>
                                </SimpleTooltip>
                            </div>
                        ) : (
                            <Input value="" placeholder={defaultPath} readOnly />
                        )}

                        <div className="flex items-center gap-2">
                            <Button size="xs" onClick={reveal} disabled={revealing}>
                                {revealing && <Loader size={12} />}
                                Open Folder
                            </Button>
                            <Button size="xs" variant="outline" onClick={browse} disabled={browsing}>
                                {browsing && <Loader size={12} />}
                                Browse…
                            </Button>
                            <Text size="xs" dimmed>Drop files in, then tab back — this re-checks itself.</Text>
                        </div>
                    </div>

                    {names.length > 0 && (
                        <div className="flex shrink-0 flex-col gap-1">
                            {Object.entries(categories).map(([name, info]) => {
                                const ok = info.missing_count === 0;
                                return (
                                    <div key={name} className="flex items-center gap-2">
                                        <Text size="xs" fw={700} c={ok ? '#2dd4bf' : '#ff5a5f'} className="min-w-3">
                                            {ok ? '✓' : '✗'}
                                        </Text>
                                        <Text size="xs" className="min-w-[100px]">{name}/</Text>
                                        <Text size="xs" dimmed className="tabular-nums">
                                            {info.found}/{info.expected}
                                        </Text>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {Object.entries(categories).some(([, i]) => i.missing_count > 0 && i.missing_sample.length > 0) && (
                    <div className="flex flex-col gap-0.5 pl-2">
                        {Object.entries(categories)
                            .filter(([, i]) => i.missing_count > 0 && i.missing_sample.length > 0)
                            .map(([name, info]) => (
                                <Text key={name} size="xs" dimmed truncate>
                                    {name}/ missing: {info.missing_sample.join(', ')}
                                    {info.missing_count > info.missing_sample.length
                                        ? ` (+${info.missing_count - info.missing_sample.length} more)`
                                        : ''}
                                </Text>
                            ))}
                    </div>
                )}

                {error && <Text size="xs" c="#ff5a5f">{error}</Text>}

                {/* The Rio API, not a path — but the same kind of thing: a cache
                    of somebody else's data, refreshed at launch, with a manual
                    pull for when a mode was added mid-event. */}
                <div className="mt-2 flex items-center gap-3 border-t border-border/60 pt-3">
                    <Button size="xs" variant="outline" onClick={refreshGameData} disabled={refreshingGameData}>
                        {refreshingGameData && <Loader size={12} />}
                        Refresh game data
                    </Button>
                    <Text size="xs" dimmed>
                        Game modes, tags and users from the Project Rio API refresh at every launch.
                    </Text>
                </div>
            </ConnBody>
        </Panel>
    );
}
