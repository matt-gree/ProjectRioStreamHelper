import { useCallback, useEffect, useState } from 'react';
import { notifications } from '../../lib/notify';
import { useAssetsVersionStore } from '../../lib/assets';
import { MSB_DISCORD_URL } from '../../lib/links';
import { cn } from '../../lib/utils';
import { Anchor } from '../../components/ui/primitives';
import { Button } from '../../components/ui/button';
import {
    BusyButton, CONN_BTN, ConnCard, ErrorLine, FieldLabel, Hint, PathField, Section, StatusPill, ToggleRow,
} from './kit';

/*
 * PROJECT RIO — the game itself: the HUD file PRSH reads a live game from, and
 * the MSB image pack overlays draw from.
 *
 * Both are paths into somebody else's install, and both have a real failure
 * state a producer fixes in Finder and then re-checks — exactly the work a modal
 * could not host, because you have to close a modal to do any of it.
 *
 * TWO COMPONENTS, NOT ONE, for two reasons. The page's grid is the visible one:
 * the Project Rio card is one of three narrow cards in the top row and the asset
 * card spans the full width under them, so emitted together the spanning one
 * would split the top row. The better reason is that they share nothing — separate endpoints,
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
    // undefined = not asked yet; null = asked, and nothing is there.
    const [resolved, setResolved] = useState(undefined);
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

    // Off outranks the file: with the follow switched off, whether the file is
    // there answers nothing anyone is asking.
    const [tone, label] = resolved === undefined ? ['idle', 'Checking…']
        : !enabled ? ['idle', 'Off']
            : resolved ? ['ok', 'Found'] : ['bad', 'Not found'];

    return (
        <ConnCard title="Project Rio" status={<StatusPill tone={tone}>{label}</StatusPill>}>
            <Section>
                <FieldLabel title="Project Rio’s decoded.hud.json — the live game Scoreboard 1 follows">
                    HUD file
                </FieldLabel>
                <PathField value={path} fallback={resolved && !path ? resolved : defaultPath}
                    onReset={() => save('')} resetting={saving}>
                    <BusyButton busy={browsing} onClick={browse}>Browse…</BusyButton>
                </PathField>
                <ErrorLine>{error}</ErrorLine>
                {/* The one thing a path field cannot show: what WRITES the file
                    it points at. */}
                <Hint>Project Rio writes this file (decoded.hud.json) while a game is running.</Hint>
                <ToggleRow
                    checked={enabled} onChange={toggle}
                    label="Follow on Scoreboard 1"
                    hint="On, Scoreboard 1 shows the game running on this computer. Off makes it an ordinary board that can follow a game from the Rio API."
                />
            </Section>
            <RioApiRow />
        </ConnCard>
    );
}

/*
 * The Rio API, not a path — but the same kind of thing: a cache of somebody
 * else's data, refreshed at launch, with a manual pull for when a mode was added
 * mid-event. It rides the Project Rio card because it IS Project Rio; it sat
 * under the image pack only because that card had room.
 */
function RioApiRow() {
    const [busy, setBusy] = useState(false);
    const refresh = useCallback(async () => {
        setBusy(true);
        try {
            const data = await (await fetch('/api/v1/rio/game-modes/refresh', { method: 'POST' })).json();
            notifications.show({
                message: `Refreshed game data — ${data.count ?? 0} active game modes`,
                color: 'green',
            });
        } catch {
            notifications.show({ message: 'Failed to refresh game data', color: 'red' });
        }
        setBusy(false);
    }, []);

    return (
        <Section className="gap-1.5">
            <div className="flex items-center justify-between gap-3">
                <FieldLabel>Online API</FieldLabel>
                <BusyButton busy={busy} onClick={refresh}>Refresh</BusyButton>
            </div>
            {/* What the button is FOR, which a button that says `Refresh` on a
                cache nobody can see cannot say by itself. */}
            <Hint>
                Game modes from Project Rio are cached when PRSH starts.
                Refresh if a new mode was added.
            </Hint>
        </Section>
    );
}

/*
 * The MSB image pack.
 *
 * SPANS THE ROW: the path and its two buttons, then one chip per folder.
 *
 * PRSH ships no MSB images (Nintendo IP); the pack is user-supplied and
 * validated against pyrio's canonical filename lists — server/api/v1/assets.py.
 */
export function MsbAssetsConnection() {
    const [path, setPath] = useState('');
    const [defaultPath, setDefaultPath] = useState('');
    const [categories, setCategories] = useState({});
    const [browsing, setBrowsing] = useState(false);
    const [importing, setImporting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [revealing, setRevealing] = useState(false);
    const [error, setError] = useState('');
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

    /*
     * Pick a folder, and COPY what's in it — the new-user path, and the reason
     * it is the primary button.
     *
     * A producer's pack arrives as a download from Discord, which means the
     * folder they point at is a folder they will later tidy up. `Browse…`
     * stores a POINTER to it, so the overlays keep working right up until the
     * day they don't, and the failure is missing art mid-broadcast with the
     * Connections card reporting a path that no longer exists. Importing
     * leaves nothing to break.
     *
     * The server finds the real pack root inside whatever was picked, so the
     * common near-misses (the zip's wrapper folder, the parent of it) import
     * cleanly instead of reporting an empty census.
     */
    const doImport = useCallback(async () => {
        setImporting(true);
        setError('');
        try {
            const picked = await (await fetch('/api/v1/assets/msb/browse', { method: 'POST' })).json();
            if (!picked?.path) { setImporting(false); return; }
            const resp = await fetch(`/api/v1/assets/msb/import?path=${encodeURIComponent(picked.path)}`, { method: 'POST' });
            const data = await resp.json();
            if (resp.ok) {
                setPath('');
                setCategories(data.categories || {});
                bumpAssetsVersion();
                notifications.show({
                    message: data.complete
                        ? `Imported ${data.copied} images — pack complete`
                        : `Imported ${data.copied} images — some are still missing`,
                    color: data.complete ? 'green' : 'yellow',
                });
            } else {
                const msg = data.detail || data.error || 'Import failed';
                setError(msg);
                notifications.show({ message: msg, color: 'red' });
            }
        } catch (e) {
            setError(String(e));
        }
        setImporting(false);
    }, [bumpAssetsVersion]);

    const reveal = useCallback(async () => {
        setRevealing(true);
        try {
            await fetch('/api/v1/assets/msb/reveal', { method: 'POST' });
        } catch { /* ignore */ }
        setRevealing(false);
    }, []);

    const entries = Object.entries(categories);
    const missing = entries.reduce((n, [, i]) => n + (i.missing_count || 0), 0);
    const status = !entries.length
        ? <StatusPill>Checking…</StatusPill>
        : missing === 0
            ? <StatusPill tone="ok">Complete</StatusPill>
            : <StatusPill tone="bad">Incomplete</StatusPill>;

    return (
        <ConnCard title="MSB image pack" className="lg:col-span-3" status={status}>
            <Section>
                <FieldLabel>Folder</FieldLabel>
                <PathField value={path} fallback={defaultPath} onReset={() => save('')} resetting={saving}>
                    {/* Import is the only FILLED button on this tab. PRSH states
                        this pack as required and every other control here just
                        reports or re-points — so on a fresh install this is the
                        one press that changes the card's own status, and the
                        card is where a blocked producer lands. */}
                    <Button size="sm" className={CONN_BTN} onClick={doImport} disabled={importing}>
                        {importing ? 'Importing…' : 'Import…'}
                    </Button>
                    <BusyButton busy={revealing} onClick={reveal}>Open folder</BusyButton>
                    <BusyButton busy={browsing} onClick={browse}>Browse…</BusyButton>
                </PathField>
                <ErrorLine>{error}</ErrorLine>
                {missing > 0 && <PackSourceHint />}
            </Section>

            {/* Every folder, marked present or missing — and no counts. A pack is
                dropped in whole or not at all, so a found/expected per folder
                (and the bars that drew it) only ever read 0 or full. Which
                files are missing rides the chip's title. */}
            {entries.length > 0 && (
                <Section className="flex-row flex-wrap gap-1.5">
                    {entries.map(([name, info]) => <FolderChip key={name} name={name} info={info} />)}
                </Section>
            )}
        </ConnCard>
    );
}

/*
 * Where the pack comes from — the one thing this card never said.
 *
 * PRSH cannot ship MSB images (Nintendo IP) and says so in three places, all
 * of which explained where to PUT a pack and none of which said where to GET
 * one. For a producer who isn't already in the community that is a hard
 * requirement with no next step, on the first screen that matters.
 *
 * Shown only while something is missing: once the pack is complete this is a
 * solved problem, and a permanent line telling a producer where to get what
 * they already have is the kind of sediment a settings page dies of.
 */
function PackSourceHint() {
    return (
        <p className="text-xs leading-snug text-muted-foreground">
            PRSH can&rsquo;t ship the MSB images. Get the pack from the{' '}
            <Anchor href={MSB_DISCORD_URL} target="_blank" rel="noopener noreferrer">
                Mario Superstar Baseball Discord
            </Anchor>
            , unzip it, then Import.
        </p>
    );
}

function FolderChip({ name, info }) {
    const ok = info.missing_count === 0;
    const extra = info.missing_count - (info.missing_sample?.length ?? 0);
    const title = ok ? undefined
        : `Missing: ${(info.missing_sample ?? []).join(', ')}${extra > 0 ? ` +${extra} more` : ''}`;
    return (
        <span
            title={title}
            className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 font-mono text-xs',
                ok ? 'border-border/60 text-foreground' : 'border-destructive/40 bg-destructive/10 text-red-300',
            )}
        >
            <span className={ok ? 'text-emerald-400' : 'text-red-400'} aria-hidden>{ok ? '✓' : '✗'}</span>
            {name}/
            {!ok && <span className="font-sans text-[11px] font-semibold uppercase tracking-wide">missing</span>}
        </span>
    );
}
