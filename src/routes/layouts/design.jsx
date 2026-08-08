import { memo, useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { Stack, Text } from '../../components/ui/primitives';
import { Panel } from '../../components/ui/panel';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { NumberInput } from '../../components/ui/number-input';
import { SimpleSelect } from '../../components/ui/simple-select';
import { FontCombobox } from '../../components/ui/font-combobox';
import { FileButton } from '../../components/ui/file-button';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import { Collapsible, CollapsibleContent } from '../../components/ui/collapsible';
import { cn } from '../../lib/utils';
import { notifications } from '../../lib/notify';
import { useSettingsStore } from '../../context/store';
import { useShallow } from 'zustand/react/shallow';
import ScaledIframe from '../../components/ScaledIframe';
import { COLOR_SWATCHES, ColorWithOpacity, LabeledColor, DebouncedColorInput } from './shared';
import { invalidateDesignPackages } from './designPackage';
import { PresetsPanel } from './presets';

// ── Live preview grid for the Design tab ──
const PREVIEW_ROWS = [
    [
        { label: 'Large Scoreboard', path: '/layout/scoreboard1/scoreboard.html?scoreboard=1&size=l', w: 800,  h: 460 },
        { label: 'Player Stats',     path: '/layout/scoreboard1/stats.html?scoreboard=1',             w: 800,  h: 460 },
    ],
    [
        { label: 'Small Scoreboard', path: '/layout/scoreboard1/scoreboard.html?scoreboard=1&size=s', w: 388,  h: 156 },
        { label: 'Bracket',          path: '/layout/bracket/index.html',                              w: 960, h: 540 },
    ],
    [
        { label: 'Ticker',           path: '/layout/rotator/ticker.html',                             w: 1920, h: 80  },
    ],
];

const PreviewTile = memo(function PreviewTile({ label, path: _path, w, h, src, reloadKey }) {
    return (
        <div>
            <Text size="xs" fw={600} dimmed className="mb-1">{label}</Text>
            <div
                className="mx-auto overflow-hidden rounded-lg border border-night-600"
                style={{ width: '100%', maxWidth: w, aspectRatio: `${w} / ${h}`, background: '#0b0b0f' }}
            >
                <ScaledIframe key={reloadKey} src={src} nativeWidth={w} nativeHeight={h} height="100%" />
            </div>
        </div>
    );
});

const DesignPreviews = memo(function DesignPreviews({ baseUrl, showOverrides, onToggleOverrides }) {
    // `sample=1` is what makes these tiles render a representative game rather
    // than live state — a design gallery has to show something on a machine with
    // no game in progress. The Production console's stage preview deliberately
    // omits it: there, the point is what is about to go on air.
    const buildUrl = (path) => {
        const sep = path.includes('?') ? '&' : '?';
        const flags = `preview=1&sample=1${showOverrides ? '' : '&preview_globals_only=1'}`;
        return `${baseUrl}${path}${sep}${flags}`;
    };
    const reloadSuffix = showOverrides ? 'ov' : 'g';

    return (
        <Stack gap="sm">
            <div className="flex flex-nowrap items-center justify-between">
                <Text size="xs" dimmed className="flex-1">
                    Live previews — every control on the left updates these in real time.
                </Text>
                <SimpleTooltip label={showOverrides
                    ? 'Showing per-layout overrides on top of the global design'
                    : 'Showing the global design only — per-layout overrides hidden'}>
                    <Label className="flex items-center gap-1.5 text-xs">
                        <Switch checked={showOverrides} onCheckedChange={onToggleOverrides} />
                        Apply overrides
                    </Label>
                </SimpleTooltip>
            </div>

            {PREVIEW_ROWS.map((row, rowIdx) => (
                <div key={rowIdx} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
                    {row.map(item => (
                        <PreviewTile key={item.path} {...item} src={buildUrl(item.path)} reloadKey={`${item.path}-${reloadSuffix}`} />
                    ))}
                </div>
            ))}
        </Stack>
    );
});

// Per-file theme-compiler report for the last package install: slot-binding
// coverage + findings (warn = something won't bind on stream; info = FYI).
const InstallReport = memo(function InstallReport({ report, onDismiss }) {
    const LEVEL_STYLE = {
        error: 'text-red-400',
        warn: 'text-amber-400',
        info: 'text-[var(--text-dim)]',
    };
    return (
        <div className="mt-1 rounded border border-[var(--border)] p-2">
            <div className="flex items-center justify-between">
                <Text size="xs" fw={600}>Install report — {report.pkg}</Text>
                <Button size="sm" variant="ghost" onClick={onDismiss}><X size={12} /></Button>
            </div>
            <div className="flex flex-col gap-1 mt-1">
                {report.files.map((f) => (
                    <div key={f.file}>
                        <Text size="xs" fw={500}>
                            {f.file}
                            {f.total ? ` — ${f.bound}/${f.total} slots bound` : ''}
                            {f.changed ? ' (compiled)' : ''}
                        </Text>
                        {(f.findings || []).map((fi, i) => (
                            <Text key={i} size="xs" className={cn('pl-3', LEVEL_STYLE[fi.level] || '')}>
                                {fi.level === 'warn' ? '⚠ ' : fi.level === 'error' ? '✕ ' : ''}{fi.message}
                            </Text>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
});

// ── Design Package selector (rendered at the top of the Design tab) ──
// Packages are folders of per-element theme SVGs (see public/design/README.md):
// `default` + `classic` ship built-in; anything else is user-installed under
// user_data/design_packages/ via the zip upload here. The selection is the
// normal settings key overlays.global.designPackage, read by every SVG-element
// mount.
const DesignPackageSection = memo(function DesignPackageSection() {
    const designPackage = useSettingsStore(s => s?.overlays?.global?.designPackage) ?? 'default';
    const setItem = useSettingsStore(s => s.setItem);
    const [packages, setPackages] = useState(null);   // null = loading
    const [busy, setBusy] = useState(false);
    // Theme-compiler report from the last install (grammar translation + lint;
    // see server/theme_compiler.py). Kept visible until dismissed or replaced.
    const [report, setReport] = useState(null);

    const refresh = useCallback(async () => {
        // The session-wide cache the Production stage reads is keyed off the same
        // endpoint; an install or uninstall is the only thing that can change it.
        invalidateDesignPackages();
        try {
            const r = await fetch('/api/v1/design/packages');
            setPackages(r.ok ? await r.json() : []);
        } catch {
            setPackages([]);
        }
    }, []);
    useEffect(() => { refresh(); }, [refresh]);

    const install = async (file) => {
        if (!file) return;
        setBusy(true);
        try {
            const form = new FormData();
            form.append('file', file);
            const r = await fetch('/api/v1/design/packages/install', { method: 'POST', body: form });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(data?.detail || `Install failed (${r.status})`);
            notifications.show({ message: `Installed design package "${data.name}"`, color: 'green' });
            setReport(data.report?.length ? { pkg: data.name, files: data.report } : null);
            await refresh();
        } catch (e) {
            notifications.show({ message: `Install failed: ${e?.message || e}`, color: 'red' });
        } finally {
            setBusy(false);
        }
    };

    const uninstall = async (pkg) => {
        setBusy(true);
        try {
            const r = await fetch(`/api/v1/design/packages/${encodeURIComponent(pkg.id)}`, { method: 'DELETE' });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(data?.detail || `Uninstall failed (${r.status})`);
            notifications.show({ message: `Removed "${pkg.name}"`, color: 'green' });
            if (designPackage === pkg.id) setItem('overlays.global.designPackage', 'default');
            await refresh();
        } catch (e) {
            notifications.show({ message: `Uninstall failed: ${e?.message || e}`, color: 'red' });
        } finally {
            setBusy(false);
        }
    };

    const list = packages ?? [];
    const selected = list.find(p => p.id === designPackage) || null;
    // Elements the package paints ITSELF — the knobs below never reach them, so
    // the panel says which ones rather than letting the user find out by
    // dragging a colour and watching nothing happen. Per element, not per
    // package: a token skin can still carry one fixed-palette element.
    const fixedPalette = (selected?.elements ?? [])
        .filter(e => !(selected?.appVarElements ?? []).includes(e));
    const selectData = list.map(p => ({ value: p.id, label: p.builtin ? p.name : `${p.name} (installed)` }));
    // Keep an orphaned selection (package deleted on disk) visible so the user
    // understands why overlays fell back to Default.
    if (packages && !selected && designPackage) {
        selectData.push({ value: designPackage, label: `${designPackage} (missing)` });
    }

    return (
        <div>
            <Text size="xs" fw={700} dimmed className="mb-2 uppercase tracking-wide">Design Package</Text>
            <div className="flex flex-col gap-1 sm:max-w-md">
                <div className="flex items-center gap-2">
                    <SimpleSelect
                        className="min-w-0 flex-1"
                        value={designPackage}
                        onChange={(val) => setItem('overlays.global.designPackage', val)}
                        data={selectData.length ? selectData : [{ value: 'default', label: 'Default' }]}
                    />
                    <FileButton accept=".zip" onChange={install}>
                        {(props) => (
                            <Button size="sm" variant="secondary" disabled={busy} {...props}>Install…</Button>
                        )}
                    </FileButton>
                    {selected && !selected.builtin && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => uninstall(selected)}>
                            <X size={14} className="mr-1" /> Remove
                        </Button>
                    )}
                </div>
                <Text size="xs" dimmed>
                    {selected
                        ? `${selected.description || 'No description.'}${selected.elements?.length ? ` Themes: ${selected.elements.join(', ')}.` : ''} Elements a package doesn't theme fall back to Default.`
                        : 'Themes every SVG element (commentary, lower third, stat callout). Install a package as a .zip, or drop a folder into user_data/design_packages/.'}
                </Text>
                {fixedPalette.length > 0 && (
                    <Text size="xs" dimmed>
                        Brings its own palette on {fixedPalette.join(', ')} — the colour,
                        border, shadow and font controls below don’t reach those.
                    </Text>
                )}
                {report && <InstallReport report={report} onDismiss={() => setReport(null)} />}
            </div>
        </div>
    );
});

// ── Global Design Section (rendered inside the Design tab) ──
const GlobalDesignSection = memo(function GlobalDesignSection() {
    const globalDesign = useSettingsStore(useShallow(s => s?.overlays?.global ?? {}));
    const setItem = useSettingsStore(s => s.setItem);

    const accentColor       = globalDesign.accentColor       ?? '#f59e0b';
    const cardBg            = globalDesign.cardBg            ?? 'rgba(15, 15, 25, 0.88)';
    const textColor         = globalDesign.textColor         ?? '#ffffff';
    const borderRadius      = globalDesign.borderRadius      ?? 16;
    const borderWidth       = globalDesign.borderWidth       ?? 1;
    const borderColor       = globalDesign.borderColor       ?? 'rgba(255, 255, 255, 0.08)';
    const fontFamily        = globalDesign.fontFamily        ?? 'Inter';
    const showShadow        = globalDesign.showShadow        !== false;
    const cardShadowBlur    = globalDesign.cardShadowBlur    ?? 16;
    const cardShadowColor   = globalDesign.cardShadowColor   ?? 'rgba(0, 0, 0, 0.5)';
    const textShadowEnabled = globalDesign.textShadowEnabled === true;
    const textShadowBlur    = globalDesign.textShadowBlur    ?? 4;
    const textShadowColor   = globalDesign.textShadowColor   ?? 'rgba(0, 0, 0, 0.8)';
    const showCaptains      = globalDesign.showCaptains      !== false;
    const showLogo          = globalDesign.showLogo          !== false;
    const finalBadgeColor   = globalDesign.finalBadgeColor   ?? '';

    return (
        <Stack gap="md">
            <DesignPackageSection />

            <div>
                <Text size="xs" fw={700} dimmed className="mb-2 uppercase tracking-wide">Color & Typography</Text>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <LabeledColor label="Accent Color" value={accentColor} onChange={(color) => setItem('overlays.global.accentColor', color)} swatches={COLOR_SWATCHES} />
                    <LabeledColor label="Text Color" value={textColor} onChange={(color) => setItem('overlays.global.textColor', color)} swatches={['#ffffff', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#1e293b', '#0f172a']} />
                    <ColorWithOpacity label="Card Background" value={cardBg} onChange={(val) => setItem('overlays.global.cardBg', val)} />
                    <ColorWithOpacity label="Border Color" value={borderColor} onChange={(val) => setItem('overlays.global.borderColor', val)} />
                    <div className="flex flex-col gap-1">
                        <Label className="field-label">Final Badge Color</Label>
                        <div className="flex items-end gap-2">
                            <DebouncedColorInput
                                value={finalBadgeColor}
                                placeholder="Default"
                                onChange={(color) => setItem('overlays.global.finalBadgeColor', color || null)}
                                swatches={COLOR_SWATCHES}
                                className="flex-1"
                            />
                            {finalBadgeColor && (
                                <Button variant="ghost" size="sm" onClick={() => setItem('overlays.global.finalBadgeColor', null)}>Reset</Button>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="field-label">Font Family</Label>
                        <FontCombobox
                            value={fontFamily}
                            onChange={(val) => setItem('overlays.global.fontFamily', val)}
                        />
                        <p className="text-xs text-muted-foreground">
                            Search fonts installed on this machine, pick a bundled web font, or type
                            any font name available on the machine running the OBS browser source.
                        </p>
                    </div>
                </div>
            </div>

            <div>
                <Text size="xs" fw={700} dimmed className="mb-2 uppercase tracking-wide">Card Chrome</Text>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                        <Label className="field-label">Border Radius</Label>
                        <NumberInput value={borderRadius} onChange={(val) => setItem('overlays.global.borderRadius', val)} min={0} max={48} step={2} suffix="px" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="field-label">Border Thickness</Label>
                        <NumberInput value={borderWidth} onChange={(val) => setItem('overlays.global.borderWidth', val)} min={0} max={16} step={1} suffix="px" />
                    </div>
                </div>
                <Stack gap="xs" className="mt-2">
                    <div>
                        <Label className="flex items-start gap-2">
                            <Switch checked={showShadow} onCheckedChange={(c) => setItem('overlays.global.showShadow', c)} className="mt-0.5" />
                            <span className="flex flex-col">
                                <Text size="sm">Card Shadow</Text>
                                <Text size="xs" dimmed>Drop shadow behind overlay cards</Text>
                            </span>
                        </Label>
                        <Collapsible open={showShadow}>
                            <CollapsibleContent>
                                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <div className="flex flex-col gap-1">
                                        <Label className="field-label">Shadow Blur</Label>
                                        <NumberInput value={cardShadowBlur} onChange={(val) => setItem('overlays.global.cardShadowBlur', val ?? 16)} min={0} max={80} step={2} suffix="px" />
                                    </div>
                                    <ColorWithOpacity label="Shadow Color" value={cardShadowColor} onChange={(val) => setItem('overlays.global.cardShadowColor', val)} />
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    </div>
                    <div>
                        <Label className="flex items-start gap-2">
                            <Switch checked={textShadowEnabled} onCheckedChange={(c) => setItem('overlays.global.textShadowEnabled', c)} className="mt-0.5" />
                            <span className="flex flex-col">
                                <Text size="sm">Text Shadow</Text>
                                <Text size="xs" dimmed>Drop shadow on text across overlays</Text>
                            </span>
                        </Label>
                        <Collapsible open={textShadowEnabled}>
                            <CollapsibleContent>
                                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <div className="flex flex-col gap-1">
                                        <Label className="field-label">Blur</Label>
                                        <NumberInput value={textShadowBlur} onChange={(val) => setItem('overlays.global.textShadowBlur', val ?? 4)} min={0} max={40} step={1} suffix="px" />
                                    </div>
                                    <ColorWithOpacity label="Shadow Color" value={textShadowColor} onChange={(val) => setItem('overlays.global.textShadowColor', val)} />
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    </div>
                </Stack>
            </div>

            <div>
                <Text size="xs" fw={700} dimmed className="mb-2 uppercase tracking-wide">Display Toggles</Text>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Label className="flex items-center gap-2 text-sm">
                        <Switch checked={showCaptains} onCheckedChange={(c) => setItem('overlays.global.showCaptains', c)} />
                        Show Captains
                    </Label>
                    <Label className="flex items-center gap-2 text-sm">
                        <Switch checked={showLogo} onCheckedChange={(c) => setItem('overlays.global.showLogo', c)} />
                        Show Overlay Logo
                    </Label>
                </div>
            </div>
        </Stack>
    );
});

// ── Design tab body (controls + previews + presets) ──
const DesignTabBody = memo(function DesignTabBody({ baseUrl }) {
    const [showOverrides, setShowOverrides] = useState(false);

    return (
        <Stack gap="lg">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                <div className="md:col-span-4">
                    <Panel title="Global Design">
                        <div className="p-4">
                            <GlobalDesignSection />
                        </div>
                    </Panel>
                </div>
                <div className="md:col-span-8">
                    <Panel title="Previews">
                        <div className="p-4">
                            <DesignPreviews baseUrl={baseUrl} showOverrides={showOverrides} onToggleOverrides={setShowOverrides} />
                        </div>
                    </Panel>
                </div>
            </div>

            <Panel title="Presets & Branding">
                <div className="p-4">
                    <PresetsPanel />
                </div>
            </Panel>
        </Stack>
    );
});

export { DesignTabBody };
