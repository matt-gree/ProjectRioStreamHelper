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
import { invalidateDesignPackages, usePortColors, useDesignPackages, useAppPaletteThemesAnything } from './designPackage';
import { PORT_COLOR_KEYS, settingOn } from './designConstants';
import { PresetsPanel } from './presets';

// ── Live preview grid for the Design tab ──
const PREVIEW_ROWS = [
    [
        { label: 'Large Scoreboard', path: '/layout/scoreboard1/scoreboard.html?scoreboard=1&size=l', w: 800,  h: 460 },
        // 452x118 is the bar's own canvas — the tile was quoting the large
        // scoreboard's 800x460 beside it, which is the one thing a preview
        // frame must not do (ScaledIframe hands the overlay this aspect as
        // its viewport).
        { label: 'Stat Bar',         path: '/layout/scoreboard1/statsbar.html?scoreboard=1',          w: 452,  h: 118 },
    ],
    [
        { label: 'Small Scoreboard', path: '/layout/scoreboard1/scoreboard.html?scoreboard=1&size=s', w: 388,  h: 156 },
        // The Bracket tile sat here. It is shelved (elements.js `hidden` +
        // _SHELVED_GROUPS in server/api/v1/layouts.py), and previewing the
        // design settings on a layout the producer can no longer add is a tile
        // that asks a question with no answer. Restore it with the shelf.
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
    // All three tiles are themed elements, so under a package that paints them
    // itself nothing on the left moves them — and a caption promising otherwise
    // is the same dead-control problem one level up. What still reaches an
    // overlay there (accent, text colour, font, text shadow) reaches the Event
    // Header and Player Name, neither of which has a tile.
    const paletteLive = useAppPaletteThemesAnything();
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
                    {paletteLive
                        ? 'Live previews — every control on the left updates these in real time.'
                        : 'Live previews — the active design package paints these itself, so the controls on the left don’t change them.'}
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
    // ...and whether ANY themed element is left for the app palette, which is
    // what decides between "these knobs miss a few elements" and "these knobs
    // are gone". Same hook the section below gates on, so the caption and the
    // panel cannot disagree.
    const paletteLive = useAppPaletteThemesAnything();
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
                        {paletteLive
                            ? `Brings its own palette on ${fixedPalette.join(', ')} — the card, border and shadow controls below don’t reach those.`
                            : 'Paints every element itself, so the card, border and shadow controls are hidden — nothing is left for them to change. Accent, text colour, font and text shadow stay: they still reach the Event Header and Player Name, which carry no theme.'}
                    </Text>
                )}
                {report && <InstallReport report={report} onDismiss={() => setReport(null)} />}
            </div>
        </div>
    );
});

// ── Controller ports (rendered under the package selector) ──
// Four colours, one palette, every overlay: the scoreboard, the scorecard, the
// lower third and both post-game callouts all tint their sides from a player's
// controller port. It sits with the design package rather than in Color &
// Typography because a package can DECLARE its own set (`portColors` in its
// manifest) — so this section is the package's palette, with the producer's
// own choices layered on top port by port.
//
// An inherited port is shown at its resolved colour rather than blank: the
// producer is looking at this to read the palette, and a row of empty swatches
// answers "what is port 3" with nothing. What separates set from inherited is
// the Reset control and the caption, not a missing value.
const PortColorRow = memo(function PortColorRow({ index, resolved, onChange }) {
    const label = `Port ${index + 1}`;
    return (
        <div className="flex flex-col gap-1">
            <Label className="field-label">{label}</Label>
            <div className="flex items-end gap-2">
                <DebouncedColorInput
                    value={resolved.color}
                    onChange={(color) => onChange(color || null)}
                    swatches={COLOR_SWATCHES}
                    className="flex-1"
                />
                {resolved.source === 'user' && (
                    <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Reset</Button>
                )}
            </div>
        </div>
    );
});

const PortColorsSection = memo(function PortColorsSection() {
    const setItem = useSettingsStore(s => s.setItem);
    const activeId = useSettingsStore(s => s?.overlays?.global?.designPackage) ?? 'default';
    const packages = useDesignPackages();
    const ports = usePortColors();

    const pkgName = packages?.find(p => p.id === activeId)?.name || activeId;
    const inherited = ports.some(p => p.source === 'package')
        ? `Unset ports follow the ${pkgName} package.`
        : `${pkgName} declares no port palette, so unset ports use the Project Rio convention (P1 red · P2 blue · P3 yellow · P4 green).`;

    return (
        <div>
            <Text size="xs" fw={700} dimmed className="mb-2 uppercase tracking-wide">Controller Ports</Text>
            {/* Two columns, not four. The panel this sits in is ~370px, and
                the breakpoint prefixes key off the VIEWPORT, not the panel — so
                a four-across row is 86px per port on a wide screen, which
                clips the hex and squeezes the Reset control. 2×2 also happens
                to be how the Match desk draws a set of ports. */}
            <div className="grid grid-cols-2 gap-2 sm:max-w-md">
                {ports.map((resolved, i) => (
                    <PortColorRow
                        key={PORT_COLOR_KEYS[i]}
                        index={i}
                        resolved={resolved}
                        onChange={(color) => setItem(`overlays.global.${PORT_COLOR_KEYS[i]}`, color)}
                    />
                ))}
            </div>
            <Text size="xs" dimmed className="mt-1">
                Each player’s side takes their controller port’s colour on the scoreboard,
                scorecard, lower third and both post-game callouts. {inherited}
            </Text>
        </div>
    );
});

// ── Global Design Section (rendered inside the Design tab) ──
const GlobalDesignSection = memo(function GlobalDesignSection() {
    const globalDesign = useSettingsStore(useShallow(s => s?.overlays?.global ?? {}));
    const setItem = useSettingsStore(s => s.setItem);
    // Does the app's palette still paint anything the active package themes? A
    // package that paints every element itself (`default` ships that way) leaves
    // the card-surface knobs below with nothing to change, and a control that
    // cannot change anything does not belong on the panel — the same call the
    // Production stage makes per element. Unknown answers yes: hiding a live
    // control is the worse failure, and there is no affordance to ask where it
    // went. See ./designPackage.js.
    const paletteLive = useAppPaletteThemesAnything();

    const accentColor       = globalDesign.accentColor       ?? '#f59e0b';
    const cardBg            = globalDesign.cardBg            ?? 'rgba(15, 15, 25, 0.88)';
    const textColor         = globalDesign.textColor         ?? '#ffffff';
    const borderRadius      = globalDesign.borderRadius      ?? 16;
    const borderWidth       = globalDesign.borderWidth       ?? 1;
    const borderColor       = globalDesign.borderColor       ?? 'rgba(255, 255, 255, 0.08)';
    const displayFont       = globalDesign.displayFont       ?? 'Rajdhani';
    const bodyFont          = globalDesign.bodyFont          ?? 'Inter';
    const monoFont          = globalDesign.monoFont          ?? 'Chivo Mono';
    const showShadow        = settingOn(globalDesign.showShadow, true);
    const cardShadowBlur    = globalDesign.cardShadowBlur    ?? 16;
    const cardShadowColor   = globalDesign.cardShadowColor   ?? 'rgba(0, 0, 0, 0.5)';
    const textShadowEnabled = settingOn(globalDesign.textShadowEnabled, false);
    const textShadowBlur    = globalDesign.textShadowBlur    ?? 4;
    const textShadowColor   = globalDesign.textShadowColor   ?? 'rgba(0, 0, 0, 0.8)';
    const textStrokeWidth   = globalDesign.textStrokeWidth   ?? 0;
    const textStrokeColor   = globalDesign.textStrokeColor   ?? 'rgba(0, 0, 0, 1)';
    const showCaptains      = settingOn(globalDesign.showCaptains, true);
    const showLogo          = settingOn(globalDesign.showLogo, true);
    const finalBadgeColor   = globalDesign.finalBadgeColor   ?? '';

    return (
        <Stack gap="md">
            <DesignPackageSection />
            <PortColorsSection />

            <div>
                <Text size="xs" fw={700} dimmed className="mb-2 uppercase tracking-wide">Color & Typography</Text>
                {/* How far "global" actually reaches is a function of the active
                    package, and it is worth saying when it collapses. A token
                    skin puts these on eight mounts; a full-art package leaves
                    two — the Event Header and Player Name, the only elements
                    with no theme SVG at all. Without this line the section is a
                    panel headed "Global Design" quietly driving two small
                    overlays, which reads as a bug rather than as the package
                    doing its job. */}
                {!paletteLive && (
                    <Text size="xs" dimmed className="mb-2">
                        The package paints everything else, so these reach the Event Header
                        and Player Name — the two elements with no theme of their own.
                    </Text>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <LabeledColor label="Accent Color" value={accentColor} onChange={(color) => setItem('overlays.global.accentColor', color)} swatches={COLOR_SWATCHES} />
                    <LabeledColor label="Text Color" value={textColor} onChange={(color) => setItem('overlays.global.textColor', color)} swatches={['#ffffff', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#1e293b', '#0f172a']} />
                    {/* The card surface. Only a theme SVG painted from the app
                        palette reads these three, so under a package that paints
                        every element itself they are dead and the panel drops
                        them — the same rule the Production stage applies per
                        element (THEME_ONLY_GLOBAL_KEYS in designConstants.js).
                        The two above and the font below stay: the Event Header
                        and Player Name carry no theme and read them always. */}
                    {paletteLive && (
                        <>
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
                        </>
                    )}
                    {/* THREE ROLES, ONE HELP LINE. The broadcast has always set
                        type three ways — a name, a caption and a score are not
                        the same job — and every theme SVG paints from those three
                        vars. The single "Font Family" knob this replaces reached
                        only the four DOM-rendered elements, so using it split the
                        show in half.

                        The three rows carry a role DESCRIPTION rather than three
                        copies of the same "where do these names come from"
                        paragraph: what a producer has to learn once is how the
                        picker works, and what they need at each row is which
                        part of the broadcast it moves. */}
                    <div className="flex flex-col gap-3">
                        <Label className="field-label">Typography</Label>
                        {[
                            { key: 'displayFont', label: 'Display',  value: displayFont, hint: 'Names, titles and status labels' },
                            { key: 'bodyFont',    label: 'Body',     value: bodyFont,    hint: 'Meta, captions and prose lines' },
                            { key: 'monoFont',    label: 'Numerals', value: monoFont,    hint: 'Scores, stats, linescores and clocks' },
                        ].map((role) => (
                            <div key={role.key} className="flex flex-col gap-1">
                                <Label className="field-label">{role.label}</Label>
                                <FontCombobox
                                    value={role.value}
                                    onChange={(val) => setItem(`overlays.global.${role.key}`, val)}
                                />
                                <p className="text-xs text-muted-foreground">{role.hint}</p>
                            </div>
                        ))}
                        <p className="text-xs text-muted-foreground">
                            Search fonts installed on this machine, pick a bundled web font, or type
                            any font name available on the machine running the OBS browser source.
                        </p>
                    </div>
                </div>
                {/* Text shadow is typography, and it is the one shadow that
                    survives a full-art package: playername-mount reads
                    --text-shadow with no theme SVG of its own. It used to sit
                    under Card Chrome, which is now the section that goes away
                    whole — leaving it there would have taken it with it. */}
                <div className="mt-2">
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
                {/* Font border — an outline around text, and the sibling of the
                    shadow above rather than part of Card Chrome: both are
                    typography, and both survive a full-art package for the same
                    reason (playername-mount reads them with no theme SVG of its
                    own).

                    No enable switch, unlike the shadow: 0 is off. The shadow
                    carries one because its blur has a meaningful non-zero
                    default, so "off" and "4px" are different facts; a border of
                    0px is simply no border, and a flag beside it could only
                    ever disagree with the number.

                    Left at 0 here, this changes nothing anywhere — which is the
                    intent. A border is usually wanted on ONE element over busy
                    footage, and that is pinned from that element's Production
                    stage panel (Style Overrides → Font Border). */}
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                        <Label className="field-label">Font Border</Label>
                        <NumberInput value={textStrokeWidth} onChange={(val) => setItem('overlays.global.textStrokeWidth', val ?? 0)} min={0} max={12} step={0.5} suffix="px" />
                        <p className="text-xs text-muted-foreground">
                            Outline drawn around text. 0 is off. Pin it on a single element
                            from that element’s Production stage panel.
                        </p>
                    </div>
                    <ColorWithOpacity label="Font Border Color" value={textStrokeColor} onChange={(val) => setItem('overlays.global.textStrokeColor', val)} />
                </div>
            </div>

            {/* Card Chrome reaches overlays ONLY through a theme SVG painted from
                the app palette, so the whole section goes when the active package
                leaves the palette nothing to paint — a heading over three inert
                controls is worse than no heading. */}
            {paletteLive && (
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
                    <div className="mt-2">
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
                </div>
            )}

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
