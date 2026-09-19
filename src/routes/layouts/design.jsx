import { memo, useState, useEffect, useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import { Loader, Text } from '../../components/ui/primitives';
import { Panel } from '../../components/ui/panel';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { NumberInput } from '../../components/ui/number-input';
import { SimpleSelect } from '../../components/ui/simple-select';
import { FontCombobox } from '../../components/ui/font-combobox';
import { FileButton } from '../../components/ui/file-button';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { cn } from '../../lib/utils';
import { notifications } from '../../lib/notify';
import { useSettingsStore } from '../../context/store';
import ScaledIframe from '../../components/ScaledIframe';
import { COLOR_SWATCHES, ColorWithOpacity, DebouncedColorInput } from './shared';
import {
    invalidateDesignPackages, usePortColors, useDesignPackages, useAppPaletteThemesAnything, useGlobalReach,
} from './designPackage';
import { PORT_COLOR_KEYS, TYPE_ROLE_DEFAULTS, settingOn } from './designConstants';
import { elementPins } from './presets';
import { PresetsPanel } from './presets.jsx';

/*
 * THE DESIGN TAB: presets across the top, the controls a preset is made of on the
 * left, and live previews pinned beside them on the right.
 *
 * It used to be a narrow column of controls with a paragraph under most of them,
 * a preview grid that ended a screen before the controls did, and the preset
 * save/load buried under both. Three rules came out of undoing that:
 *
 *   - WHAT A CONTROL REACHES IS DATA, NOT A SENTENCE. Each section names the
 *     elements it moves under the active package (useGlobalReach) in one dim
 *     line; a section that reaches nothing on this package is not drawn.
 *   - A CONTROL NEVER JUMPS. Text shadow's blur and colour stay put and disable
 *     when the shadow is off, rather than collapsing the rows beneath them.
 *   - THE PREVIEWS FOLLOW THE CONTROLS. They stick to the viewport at `lg`, so a
 *     colour being dragged at the bottom of the panel is still on screen.
 */

// ── Layout atoms ──

function Section({ title, reach, children, className }) {
    return (
        <section className={cn('flex flex-col gap-2.5 border-t border-border px-4 py-3.5 first:border-t-0', className)}>
            <header className="flex items-baseline gap-3">
                <span className="label-display shrink-0 text-xs text-foreground">{title}</span>
                <Reach names={reach} />
            </header>
            {children}
        </section>
    );
}

// The elements a section moves. Three or fewer are named; more are counted,
// with the names on hover. Unknown (packages still loading) draws nothing.
function Reach({ names }) {
    if (!names) return null;
    const unique = [...new Set(names)];
    const all = unique.join(' · ');
    const text = unique.length === 0 ? 'reaches nothing on this theme'
        : unique.length <= 3 ? all : `${unique.length} elements`;
    return (
        <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={unique.length ? all : undefined}>
            {text}
        </span>
    );
}

function Field({ label, hint, className, children }) {
    return (
        <div className={cn('flex min-w-0 flex-col gap-1', className)}>
            <Label className="field-label" title={hint}>{label}</Label>
            {children}
        </div>
    );
}

const useGlobal = (key, fallback) => useSettingsStore(s => s?.overlays?.global?.[key]) ?? fallback;
const useSet = () => useSettingsStore(s => s.setItem);

// ── Theme (design package) ──

// Per-file theme-compiler report for the last install: slot coverage + findings.
const InstallReport = memo(function InstallReport({ report, onDismiss }) {
    const LEVEL_STYLE = { error: 'text-red-400', warn: 'text-amber-400', info: 'text-muted-foreground' };
    return (
        <div className="rounded-md border border-border p-2">
            <div className="flex items-center justify-between">
                <Text size="xs" fw={600}>Install report — {report.pkg}</Text>
                <Button size="icon-xs" variant="ghost" onClick={onDismiss} aria-label="Dismiss"><X /></Button>
            </div>
            <div className="mt-1 flex max-h-48 flex-col gap-1 overflow-y-auto">
                {report.files.map((f) => (
                    <div key={f.file}>
                        <Text size="xs" fw={500}>
                            {f.file}{f.total ? ` — ${f.bound}/${f.total} slots bound` : ''}{f.changed ? ' (compiled)' : ''}
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

const ThemeSection = memo(function ThemeSection() {
    const designPackage = useGlobal('designPackage', 'default');
    const setItem = useSet();
    const packages = useDesignPackages();
    const [busy, setBusy] = useState(false);
    const [report, setReport] = useState(null);
    const [confirmRemove, setConfirmRemove] = useState(false);

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
            invalidateDesignPackages();
        } catch (e) {
            notifications.show({ message: `Install failed: ${e?.message || e}`, color: 'red' });
        } finally {
            setBusy(false);
        }
    };

    const uninstall = async (pkg) => {
        setConfirmRemove(false);
        setBusy(true);
        try {
            const r = await fetch(`/api/v1/design/packages/${encodeURIComponent(pkg.id)}`, { method: 'DELETE' });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(data?.detail || `Uninstall failed (${r.status})`);
            notifications.show({ message: `Removed "${pkg.name}"`, color: 'green' });
            if (designPackage === pkg.id) setItem('overlays.global.designPackage', 'default');
            invalidateDesignPackages();
        } catch (e) {
            notifications.show({ message: `Uninstall failed: ${e?.message || e}`, color: 'red' });
        } finally {
            setBusy(false);
        }
    };

    const list = packages ?? [];
    const selected = list.find(p => p.id === designPackage) || null;
    const data = list.map(p => ({ value: p.id, label: p.builtin ? p.name : `${p.name} (installed)` }));
    // Keep an orphaned selection visible, so it is clear why overlays fell back.
    if (packages && !selected && designPackage) data.push({ value: designPackage, label: `${designPackage} (missing)` });

    const own = (selected?.elements ?? []).filter(e => !(selected?.appVarElements ?? []).includes(e));
    const tier = !selected ? null
        : own.length === 0 ? { label: 'Uses your palette', tone: 'text-emerald-400 border-emerald-500/50' }
            : own.length === selected.elements.length ? { label: 'Own palette', tone: 'text-muted-foreground' }
                : { label: 'Mixed palette', tone: 'text-amber-400 border-amber-500/50', title: `Paints its own palette on ${own.join(', ')}` };

    return (
        <Section title="Theme">
            <div className="flex items-center gap-2">
                <SimpleSelect
                    className="min-w-0 flex-1"
                    value={designPackage}
                    onChange={(val) => setItem('overlays.global.designPackage', val)}
                    data={data.length ? data : [{ value: 'default', label: 'Default' }]}
                />
                <FileButton accept=".zip" onChange={install}>
                    {(props) => <Button size="sm" variant="secondary" disabled={busy} {...props}>{busy && <Loader size={10} />}Install…</Button>}
                </FileButton>
                {selected && !selected.builtin && (
                    <Popover open={confirmRemove} onOpenChange={setConfirmRemove}>
                        <PopoverTrigger asChild>
                            <Button size="sm" variant="ghost" disabled={busy}>Remove</Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-64 p-3">
                            <Text size="sm" className="mb-2">Uninstall “{selected.name}”? Overlays fall back to Default.</Text>
                            <div className="flex gap-2">
                                <Button size="sm" variant="destructive" onClick={() => uninstall(selected)}>Uninstall</Button>
                                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>Cancel</Button>
                            </div>
                        </PopoverContent>
                    </Popover>
                )}
            </div>
            {selected && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {tier && <Badge variant="outline" className={tier.tone} title={tier.title}>{tier.label}</Badge>}
                    <Badge
                        variant="outline"
                        className="text-muted-foreground"
                        title={`${selected.elements?.join(', ')} — anything else falls back to Default`}
                    >
                        Themes {selected.elements?.length ?? 0} elements
                    </Badge>
                    {selected.description && (
                        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={selected.description}>
                            {selected.description}
                        </span>
                    )}
                </div>
            )}
            {report && <InstallReport report={report} onDismiss={() => setReport(null)} />}
        </Section>
    );
});

// ── Logo ──

const LogoSection = memo(function LogoSection() {
    const [info, setInfo] = useState(null);
    const [busy, setBusy] = useState(false);
    const rev = useGlobal('logoRev', 0);

    const refresh = useCallback(async () => {
        try {
            const r = await fetch('/api/v1/branding/logo');
            if (r.ok) setInfo(await r.json());
        } catch { /* ignore */ }
    }, []);
    // A preset apply swaps the file server-side and bumps the revision — refetch on it.
    useEffect(() => { refresh(); }, [refresh, rev]);

    const upload = async (file) => {
        if (!file) return;
        setBusy(true);
        try {
            const form = new FormData();
            form.append('file', file);
            const r = await fetch('/api/v1/branding/logo', { method: 'POST', body: form });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(data?.detail || `Upload failed (${r.status})`);
            setInfo(data);
        } catch (e) {
            notifications.show({ message: `Upload failed: ${e?.message || e}`, color: 'red' });
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        const r = await fetch('/api/v1/branding/logo', { method: 'DELETE' });
        if (r.ok) setInfo(await r.json());
    };

    return (
        <Section title="Logo" reach={['Scoreboard', 'Scorecard', 'Post-game']}>
            <div className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center overflow-hidden rounded-md border border-border bg-night-950">
                    {info?.exists
                        ? <img src={`${info.url}?v=${rev}`} alt="Overlay logo" className="size-full object-contain" />
                        : <span className="text-[10px] text-muted-foreground">None</span>}
                </div>
                <FileButton onChange={upload} accept="image/png,image/jpeg,image/svg+xml,image/webp">
                    {(props) => (
                        <Button {...props} size="sm" variant="secondary" disabled={busy}>
                            {busy && <Loader size={10} />}{info?.exists ? 'Replace' : 'Upload'}
                        </Button>
                    )}
                </FileButton>
                {info?.exists && <Button size="sm" variant="ghost" onClick={remove}>Remove</Button>}
                <span className="ml-auto text-[11px] text-muted-foreground">PNG · JPG · SVG · WebP, 2 MB</span>
            </div>
        </Section>
    );
});

// ── Colour ──

function ColorField({ label, value, onChange, placeholder, onReset, swatches = COLOR_SWATCHES }) {
    return (
        <Field label={label}>
            <div className="flex items-center gap-1">
                <DebouncedColorInput value={value} placeholder={placeholder} onChange={onChange} swatches={swatches} className="min-w-0 flex-1" />
                {onReset && (
                    <Button size="icon-sm" variant="ghost" onClick={onReset} title="Back to the theme's colour" aria-label={`Reset ${label}`}><X /></Button>
                )}
            </div>
        </Field>
    );
}

const ColourSection = memo(function ColourSection({ reach }) {
    const setItem = useSet();
    const accentColor = useGlobal('accentColor', '#f59e0b');
    const textColor = useGlobal('textColor', '#ffffff');
    return (
        <Section title="Colour" reach={reach?.palette}>
            <div className="grid grid-cols-2 gap-3">
                <ColorField label="Accent" value={accentColor} onChange={(c) => setItem('overlays.global.accentColor', c)} />
                <ColorField
                    label="Text"
                    value={textColor}
                    onChange={(c) => setItem('overlays.global.textColor', c)}
                    swatches={['#ffffff', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#1e293b', '#0f172a']}
                />
            </div>
        </Section>
    );
});

// Four colours, one palette, every overlay that tints a side by controller
// port. An unset port shows its RESOLVED colour (the package's, or the Project
// Rio convention); only a port the producer set carries a reset.
const PortsSection = memo(function PortsSection() {
    const setItem = useSet();
    const ports = usePortColors();
    return (
        <Section title="Controller ports" reach={['Scoreboard', 'Scorecard', 'Lower Third', 'Game Summary', 'Character Spotlight']}>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {ports.map((resolved, i) => (
                    <ColorField
                        key={PORT_COLOR_KEYS[i]}
                        label={`Port ${i + 1}`}
                        value={resolved.color}
                        onChange={(c) => setItem(`overlays.global.${PORT_COLOR_KEYS[i]}`, c || null)}
                        onReset={resolved.source === 'user' ? () => setItem(`overlays.global.${PORT_COLOR_KEYS[i]}`, null) : null}
                    />
                ))}
            </div>
        </Section>
    );
});

// ── Type ──

const TYPE_ROLES = [
    { key: 'displayFont', role: 'display', label: 'Display', hint: 'Names, titles and status labels' },
    { key: 'bodyFont', role: 'body', label: 'Body', hint: 'Meta, captions and prose lines' },
    { key: 'monoFont', role: 'mono', label: 'Numerals', hint: 'Scores, stats, linescores and clocks' },
].map(r => ({ ...r, fallback: TYPE_ROLE_DEFAULTS.find(d => d.role === r.role).value }));

const TypeSection = memo(function TypeSection() {
    const setItem = useSet();
    const global = useSettingsStore(s => s?.overlays?.global);
    return (
        <Section title="Type" reach={['every element']}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {TYPE_ROLES.map(role => (
                    <Field key={role.key} label={role.label} hint={role.hint}>
                        <FontCombobox
                            pinned={TYPE_ROLE_DEFAULTS}
                            role={role.role}
                            value={global?.[role.key] ?? role.fallback}
                            onChange={(val) => setItem(`overlays.global.${role.key}`, val)}
                        />
                    </Field>
                ))}
            </div>
        </Section>
    );
});

// Shadow and border are typography, and both survive a full-art package (the
// Player Name reads them with no theme of its own), so they sit apart from Card
// chrome, which does not.
const TextEffectsSection = memo(function TextEffectsSection({ reach }) {
    const setItem = useSet();
    const shadowOn = settingOn(useGlobal('textShadowEnabled', false), false);
    const blur = useGlobal('textShadowBlur', 4);
    const shadowColor = useGlobal('textShadowColor', 'rgba(0, 0, 0, 0.8)');
    const strokeWidth = useGlobal('textStrokeWidth', 0);
    const strokeColor = useGlobal('textStrokeColor', 'rgba(0, 0, 0, 1)');
    const reached = reach ? [...new Set([...(reach.textShadow ?? []), ...(reach.textStroke ?? [])])] : null;
    return (
        <Section title="Text effects" reach={reached}>
            <div className="grid grid-cols-[5rem_2.25rem_6.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
                <Label className="field-label" title={reach?.textShadow?.join(', ')}>Shadow</Label>
                <Switch checked={shadowOn} onCheckedChange={(c) => setItem('overlays.global.textShadowEnabled', c)} aria-label="Text shadow" />
                <NumberInput aria-label="Shadow blur" value={blur} disabled={!shadowOn} onChange={(v) => setItem('overlays.global.textShadowBlur', v === '' ? 4 : v)} min={0} max={40} suffix="px" />
                <div className={cn(!shadowOn && 'pointer-events-none opacity-50')}>
                    <ColorWithOpacity value={shadowColor} onChange={(v) => setItem('overlays.global.textShadowColor', v)} />
                </div>

                <Label className="field-label" title="Outline around text. 0 is off.">Border</Label>
                <span />
                <NumberInput aria-label="Border width" value={strokeWidth} onChange={(v) => setItem('overlays.global.textStrokeWidth', v === '' ? 0 : v)} min={0} max={12} step={0.5} allowDecimal suffix="px" />
                <div className={cn(!Number(strokeWidth) && 'opacity-60')}>
                    <ColorWithOpacity value={strokeColor} onChange={(v) => setItem('overlays.global.textStrokeColor', v)} />
                </div>
            </div>
        </Section>
    );
});

// ── Card chrome — only reaches an app-palette theme, so only drawn under one ──

const ChromeSection = memo(function ChromeSection({ reach }) {
    const setItem = useSet();
    const cardBg = useGlobal('cardBg', 'rgba(15, 15, 25, 0.88)');
    const borderColor = useGlobal('borderColor', 'rgba(255, 255, 255, 0.08)');
    const borderWidth = useGlobal('borderWidth', 1);
    const showShadow = settingOn(useGlobal('showShadow', true), true);
    const shadowBlur = useGlobal('cardShadowBlur', 16);
    const shadowColor = useGlobal('cardShadowColor', 'rgba(0, 0, 0, 0.5)');
    const badge = useGlobal('finalBadgeColor', '') ?? '';
    return (
        <Section title="Card chrome" reach={reach?.chrome}>
            <div className="grid grid-cols-2 gap-3">
                <ColorWithOpacity label="Card background" value={cardBg} onChange={(v) => setItem('overlays.global.cardBg', v)} />
                <ColorWithOpacity label="Border colour" value={borderColor} onChange={(v) => setItem('overlays.global.borderColor', v)} />
                <Field label="Border width">
                    <NumberInput value={borderWidth} onChange={(v) => setItem('overlays.global.borderWidth', v === '' ? 1 : v)} min={0} max={16} suffix="px" />
                </Field>
                {reach?.badge?.length !== 0 && (
                    <ColorField
                        label="Final badge"
                        value={badge}
                        placeholder="Accent"
                        onChange={(c) => setItem('overlays.global.finalBadgeColor', c || null)}
                        onReset={badge ? () => setItem('overlays.global.finalBadgeColor', null) : null}
                    />
                )}
            </div>
            <div className="grid grid-cols-[5rem_2.25rem_6.5rem_minmax(0,1fr)] items-center gap-x-3">
                <Label className="field-label">Shadow</Label>
                <Switch checked={showShadow} onCheckedChange={(c) => setItem('overlays.global.showShadow', c)} aria-label="Card shadow" />
                <NumberInput aria-label="Card shadow blur" value={shadowBlur} disabled={!showShadow} onChange={(v) => setItem('overlays.global.cardShadowBlur', v === '' ? 16 : v)} min={0} max={80} step={2} suffix="px" />
                <div className={cn(!showShadow && 'pointer-events-none opacity-50')}>
                    <ColorWithOpacity value={shadowColor} onChange={(v) => setItem('overlays.global.cardShadowColor', v)} />
                </div>
            </div>
        </Section>
    );
});

// ── Display toggles ──

const TOGGLES = [
    { key: 'showCaptains', label: 'Captains', fallback: true, reach: 'Ticker' },
    { key: 'showLogo', label: 'Overlay logo', fallback: true, reach: 'Scoreboard' },
    // Package chrome, not palette, so it is here and not under Card chrome.
    { key: 'showRail', label: 'Card rail', fallback: false, reach: 'Scoreboard · Scorecard' },
];

const ShowSection = memo(function ShowSection() {
    const setItem = useSet();
    const global = useSettingsStore(s => s?.overlays?.global);
    return (
        <Section title="Show">
            <div className="grid grid-cols-3 gap-3">
                {TOGGLES.map(t => (
                    <Label key={t.key} className="flex items-center gap-2.5 rounded-md border border-border px-2.5 py-2">
                        <Switch checked={settingOn(global?.[t.key], t.fallback)} onCheckedChange={(c) => setItem(`overlays.global.${t.key}`, c)} />
                        <span className="flex min-w-0 flex-col">
                            <span className="truncate text-sm">{t.label}</span>
                            <span className="truncate text-[11px] text-muted-foreground">{t.reach}</span>
                        </span>
                    </Label>
                ))}
            </div>
        </Section>
    );
});

// ── Element pins (the per-element style overrides set on the Production stage) ──

const PinsFooter = memo(function PinsFooter() {
    const overlays = useSettingsStore(s => s?.overlays);
    const pins = useMemo(() => Object.keys(elementPins(overlays)), [overlays]);
    const [open, setOpen] = useState(false);
    const byElement = useMemo(() => {
        const counts = {};
        for (const p of pins) {
            const ns = p.split('.')[0];
            counts[ns] = (counts[ns] ?? 0) + 1;
        }
        return Object.entries(counts).map(([ns, n]) => `${ns} ${n}`).join(' · ');
    }, [pins]);

    const clear = async () => {
        setOpen(false);
        try {
            await useSettingsStore.getState().applyBatch([], pins.map(p => `overlays.${p}`));
            notifications.show({ message: 'Element style pins cleared', color: 'blue' });
        } catch (e) {
            notifications.show({ message: `Clear failed: ${e?.message || e}`, color: 'red' });
        }
    };

    return (
        <div className="flex items-center gap-3 border-t border-border bg-popover/40 px-4 py-2.5">
            <SimpleTooltip label="Set per element on its Production panel (Style overrides). They sit on top of everything above." disabled={!pins.length}>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={byElement || undefined}>
                    {pins.length ? `${pins.length} element style ${pins.length === 1 ? 'pin' : 'pins'} · ${byElement}` : 'No element style pins'}
                </span>
            </SimpleTooltip>
            {pins.length > 0 && (
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild><Button size="xs" variant="ghost">Clear all</Button></PopoverTrigger>
                    <PopoverContent align="end" className="w-64 p-3">
                        <Text size="sm" className="mb-2">Remove all {pins.length} element style pins?</Text>
                        <div className="flex gap-2">
                            <Button size="sm" variant="destructive" onClick={clear}>Clear</Button>
                            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                        </div>
                    </PopoverContent>
                </Popover>
            )}
        </div>
    );
});

const DesignControls = memo(function DesignControls() {
    const reach = useGlobalReach();
    // Card chrome reaches overlays only through an app-palette theme. Unknown
    // answers yes, the same rule as everywhere else this is gated.
    const chromeLive = useAppPaletteThemesAnything();
    return (
        <Panel title="Design">
            <ThemeSection />
            <LogoSection />
            <ColourSection reach={reach} />
            <PortsSection />
            <TypeSection />
            <TextEffectsSection reach={reach} />
            {chromeLive && <ChromeSection reach={reach} />}
            <ShowSection />
            <PinsFooter />
        </Panel>
    );
});

// ── Previews ──

// Each tile's canvas is the element's own native size — ScaledIframe hands the
// overlay that aspect as its viewport, so a tile quoting any other size lies.
const PREVIEW_COLUMNS = [
    [
        { label: 'Scoreboard · Large', path: '/layout/scoreboard1/scoreboard.html?scoreboard=1&size=l', w: 800, h: 460 },
        { label: 'Scoreboard · Small', path: '/layout/scoreboard1/scoreboard.html?scoreboard=1&size=s', w: 388, h: 156 },
    ],
    [
        { label: 'Stat Bar', path: '/layout/scoreboard1/statsbar.html?scoreboard=1&team=1', w: 452, h: 118 },
        { label: 'Stat Card', path: '/layout/scoreboard1/statscard.html?scoreboard=1&team=1', w: 380, h: 240 },
        // The palette's one reader under every package, so it is the tile that
        // answers "did my accent / shadow / border do anything" on a full-art theme.
        { label: 'Player Name', path: '/layout/scoreboard1/playername.html?scoreboard=1&team=1', w: 800, h: 200 },
    ],
];
const PREVIEW_WIDE = { label: 'Results Ticker', path: '/layout/rotator/ticker.html', w: 1920, h: 80 };

const PreviewTile = memo(function PreviewTile({ label, w, h, src }) {
    return (
        <figure className="flex min-w-0 flex-col gap-1">
            <figcaption className="text-[11px] font-medium text-muted-foreground">{label}</figcaption>
            <div
                className="overflow-hidden rounded-md border border-border"
                style={{ width: '100%', maxWidth: w, aspectRatio: `${w} / ${h}`, background: '#0b0b0f' }}
            >
                <ScaledIframe key={src} src={src} nativeWidth={w} nativeHeight={h} height="100%" />
            </div>
        </figure>
    );
});

const DesignPreviews = memo(function DesignPreviews({ baseUrl }) {
    const [withPins, setWithPins] = useState(true);
    // `sample=1` renders a representative game, so the gallery shows something
    // on a machine with no game in progress.
    const src = (path) => {
        const sep = path.includes('?') ? '&' : '?';
        return `${baseUrl}${path}${sep}preview=1&sample=1${withPins ? '' : '&preview_globals_only=1'}`;
    };
    return (
        <Panel
            title="Preview"
            actions={(
                <Label className="flex items-center gap-2 text-xs text-muted-foreground" title="Include each element's own style pins from the Production console">
                    <Switch size="sm" checked={withPins} onCheckedChange={setWithPins} />
                    Element pins
                </Label>
            )}
        >
            <div className="flex flex-col gap-4 p-4">
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                    {PREVIEW_COLUMNS.map((col, i) => (
                        <div key={i} className="flex min-w-0 flex-col gap-4">
                            {col.map(t => <PreviewTile key={t.path} {...t} src={src(t.path)} />)}
                        </div>
                    ))}
                </div>
                <PreviewTile {...PREVIEW_WIDE} src={src(PREVIEW_WIDE.path)} />
            </div>
        </Panel>
    );
});

// ── Design tab body ──
const DesignTabBody = memo(function DesignTabBody({ baseUrl }) {
    return (
        <div className="flex flex-col gap-4">
            <PresetsPanel />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
                <div className="lg:col-span-5">
                    <DesignControls />
                </div>
                <div className="lg:sticky lg:top-4 lg:col-span-7">
                    <DesignPreviews baseUrl={baseUrl} />
                </div>
            </div>
        </div>
    );
});

export { DesignTabBody };
