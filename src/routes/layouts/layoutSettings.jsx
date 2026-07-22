import { memo, useMemo, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { RotateCcw, X } from 'lucide-react';
import { Stack, Text, Divider } from '../../components/ui/primitives';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
import { NumberInput } from '../../components/ui/number-input';
import { SimpleSelect } from '../../components/ui/simple-select';
import { FontCombobox } from '../../components/ui/font-combobox';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
} from '../../components/ui/dropdown-menu';
import { useSettingsStore } from '../../context/store';
import { LAYOUT_SETTINGS, OVERRIDABLE_GLOBAL_KEYS } from './designConstants';
import { ColorWithOpacity, DebouncedColorInput, COLOR_SWATCHES } from './shared';

// ── Per-layout settings panel ──
// The Scorecard and Scoreboard store their config per scoreboard
// (overlays.{type}.{N}.*) so two sources on different boards can be configured
// independently; a plain overlays.{type}.* leaf is the legacy global, merged
// underneath as a non-destructive fallback. These are exactly the URL-scoped
// (?scoreboard=N) elements the console binds per board — the team-variant types
// in the same mode (stats, roster, teamlogo) stay global on purpose, since
// their setting is shared across boards. All other layout types stay global.
const PER_BOARD_SETTINGS_TYPES = new Set(['scorecard', 'scoreboard']);
const LayoutSettingsPanel = memo(function LayoutSettingsPanel({ layoutType, supportedSettings, scoreboardId }) {
    const allDefs = LAYOUT_SETTINGS[layoutType] ?? [];
    const settingsDefs = supportedSettings
        ? allDefs.filter(def => supportedSettings.includes(def.key))
        : allDefs;
    const perScoreboard = PER_BOARD_SETTINGS_TYPES.has(layoutType) && scoreboardId != null;
    const writeNs = perScoreboard ? `${layoutType}.${scoreboardId}` : layoutType;

    const typeSettings = useSettingsStore(useShallow(s => s?.overlays?.[layoutType] ?? {}));
    const globalSettings = useSettingsStore(useShallow(s => s?.overlays?.global ?? {}));
    const setItem = useSettingsStore(s => s.setItem);
    const deleteItem = useSettingsStore(s => s.deleteItem);

    // Effective values: per-scoreboard overrides win over the legacy global leaves.
    const overlaySettings = useMemo(() => {
        if (!perScoreboard) return typeSettings;
        const perSb = typeSettings?.[scoreboardId] ?? typeSettings?.[String(scoreboardId)] ?? {};
        return { ...typeSettings, ...perSb };
    }, [perScoreboard, typeSettings, scoreboardId]);

    const overridable = useMemo(() => OVERRIDABLE_GLOBAL_KEYS.filter(def =>
        !supportedSettings || def.meta.some(m => supportedSettings.includes(m))
    ), [supportedSettings]);

    const pinned = overridable.filter(def => overlaySettings[def.key] != null);
    const available = overridable.filter(def => overlaySettings[def.key] == null);

    const setOverride = useCallback((key, value) =>
        setItem(`overlays.${writeNs}.${key}`, value), [writeNs, setItem]);

    // Reset every element setting + pinned override for this layout back to its
    // built-in default by removing the stored keys (overlays read the default
    // when the key is absent).
    const hasCustomized = useMemo(
        () => settingsDefs.some(def => overlaySettings[def.key] != null) || pinned.length > 0,
        [settingsDefs, overlaySettings, pinned],
    );
    const resetToDefaults = useCallback(() => {
        for (const def of settingsDefs) deleteItem(`overlays.${writeNs}.${def.key}`);
        for (const def of pinned) deleteItem(`overlays.${writeNs}.${def.key}`);
    }, [settingsDefs, pinned, writeNs, deleteItem]);

    return (
        <Stack gap="md">
            {perScoreboard && (
                <Text size="xs" dimmed>
                    These settings apply to <b>Scoreboard {scoreboardId}</b> only — each scoreboard is configured independently.
                </Text>
            )}
            {(settingsDefs.length > 0 || pinned.length > 0) && (
                <div className="flex justify-end">
                    <Button variant="ghost" size="xs" onClick={resetToDefaults} disabled={!hasCustomized}>
                        <RotateCcw size={13} className="mr-1" /> Reset to defaults
                    </Button>
                </div>
            )}
            {settingsDefs.length > 0 && (
                <Stack gap="xs">
                    {settingsDefs.map(def => renderElementSetting(def, writeNs, overlaySettings, setItem))}
                </Stack>
            )}

            {(pinned.length > 0 || available.length > 0) && (
                <div>
                    {settingsDefs.length > 0 && <Divider className="mb-3" />}
                    <div className="mb-2 flex items-center justify-between">
                        <div>
                            <Text size="sm" fw={600}>Style Overrides</Text>
                            <Text size="xs" dimmed>
                                Pin per-overlay values that win over the global Design settings.
                            </Text>
                        </div>
                        {available.length > 0 && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="secondary" size="xs">+ Add override</Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-[220px]">
                                    <DropdownMenuLabel>Override a global setting</DropdownMenuLabel>
                                    {available.map(def => (
                                        <DropdownMenuItem
                                            key={def.key}
                                            onClick={() => {
                                                const seed = globalSettings[def.key] ?? def.defaultValue ?? '';
                                                setOverride(def.key, seed === '' ? def.defaultValue ?? '#000000' : seed);
                                            }}
                                        >
                                            {def.label}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                    </div>

                    {pinned.length === 0 ? (
                        <Text size="xs" dimmed>No overrides — using global values from the Design tab.</Text>
                    ) : (
                        <Stack gap="xs">
                            {pinned.map(def => (
                                <OverrideRow
                                    key={def.key}
                                    def={def}
                                    value={overlaySettings[def.key]}
                                    onChange={(v) => setOverride(def.key, v)}
                                    onRemove={() => setOverride(def.key, null)}
                                />
                            ))}
                        </Stack>
                    )}
                </div>
            )}

            {settingsDefs.length === 0 && pinned.length === 0 && available.length === 0 && (
                <Text size="xs" dimmed>This overlay has no configurable settings.</Text>
            )}
        </Stack>
    );
});

function renderElementSetting(def, writeNs, overlaySettings, setItem) {
    const settingsKey = `overlays.${writeNs}.${def.key}`;

    if (def.type === 'switch') {
        const checked = overlaySettings?.[def.key] !== false;
        return (
            <Label key={def.key} className="flex items-start gap-2">
                <Switch checked={checked} onCheckedChange={(c) => setItem(settingsKey, c)} className="mt-0.5" />
                <span className="flex flex-col">
                    <Text size="sm">{def.label}</Text>
                    {def.description && <Text size="xs" dimmed>{def.description}</Text>}
                </span>
            </Label>
        );
    }
    if (def.type === 'select') {
        const value = overlaySettings?.[def.key] ?? def.defaultValue;
        return (
            <div key={def.key} className="flex flex-col gap-1">
                <Label className="field-label">{def.label}</Label>
                {def.description && <Text size="xs" dimmed>{def.description}</Text>}
                <SimpleSelect value={value} onChange={(val) => setItem(settingsKey, val)} data={def.options} />
            </div>
        );
    }
    if (def.type === 'text') {
        const value = overlaySettings?.[def.key] ?? '';
        return (
            <div key={def.key} className="flex flex-col gap-1">
                <Label className="field-label">{def.label}</Label>
                {def.description && <Text size="xs" dimmed>{def.description}</Text>}
                <Input value={value} placeholder={def.placeholder || ''} onChange={(e) => setItem(settingsKey, e.currentTarget.value)} />
            </div>
        );
    }
    if (def.type === 'color-override') {
        const value = overlaySettings?.[def.key] ?? null;
        return (
            <div key={def.key}>
                <Text size="sm" fw={500}>{def.label}</Text>
                {def.description && <Text size="xs" dimmed className="mb-1">{def.description}</Text>}
                <div className="flex items-end gap-2">
                    <DebouncedColorInput
                        value={value ?? ''}
                        placeholder="Default"
                        onChange={(color) => setItem(settingsKey, color || null)}
                        swatches={COLOR_SWATCHES}
                        className="flex-1"
                    />
                    {value != null && (
                        <Button variant="ghost" size="sm" onClick={() => setItem(settingsKey, null)}>Reset</Button>
                    )}
                </div>
            </div>
        );
    }
    if (def.type === 'number-override') {
        const value = overlaySettings?.[def.key] ?? def.defaultValue;
        return (
            <div key={def.key} className="flex flex-col gap-1">
                <Label className="field-label">{def.label}</Label>
                {def.description && <Text size="xs" dimmed>{def.description}</Text>}
                <NumberInput value={value} onChange={(val) => setItem(settingsKey, val ?? def.defaultValue)} min={def.min} max={def.max} step={def.step} suffix={def.suffix} />
            </div>
        );
    }
    return null;
}

// One pinned override row (any type).
const OverrideRow = memo(function OverrideRow({ def, value, onChange, onRemove }) {
    const sharedRemove = (
        <SimpleTooltip label="Remove override (use global value)">
            <Button variant="ghost" size="icon-sm" onClick={onRemove}><X size={14} /></Button>
        </SimpleTooltip>
    );

    let editor = null;
    if (def.type === 'color') {
        editor = (
            <div className="flex flex-col gap-1">
                <Label className="field-label">{def.label}</Label>
                <DebouncedColorInput value={value ?? ''} onChange={(c) => onChange(c || null)} swatches={COLOR_SWATCHES} className="flex-1" />
            </div>
        );
    } else if (def.type === 'color-opacity') {
        editor = <ColorWithOpacity label={def.label} value={value} onChange={onChange} />;
    } else if (def.type === 'number') {
        editor = (
            <div className="flex flex-col gap-1">
                <Label className="field-label">{def.label}</Label>
                <NumberInput value={value ?? def.defaultValue} onChange={(v) => onChange(v ?? def.defaultValue)} min={def.min} max={def.max} step={def.step} suffix={def.suffix} />
            </div>
        );
    } else if (def.type === 'switch') {
        editor = (
            <Label className="flex items-center gap-2 text-sm">
                <Switch checked={value !== false} onCheckedChange={onChange} />
                {def.label}
            </Label>
        );
    } else if (def.type === 'font') {
        editor = (
            <div className="flex flex-col gap-1">
                <Label className="field-label">{def.label}</Label>
                <FontCombobox
                    value={value ?? def.defaultValue}
                    onChange={(v) => onChange(v || def.defaultValue)}
                />
            </div>
        );
    }

    return (
        <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">{editor}</div>
            {sharedRemove}
        </div>
    );
});

export { LayoutSettingsPanel };
