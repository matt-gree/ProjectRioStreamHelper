import { memo, useState, useEffect, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Stack, Text, Loader } from '../../components/ui/primitives';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { FileButton } from '../../components/ui/file-button';
import { notifications } from '../../lib/notify';
import { useSettingsStore } from '../../context/store';
import {
    LAYOUT_SETTINGS, OVERRIDABLE_GLOBAL_KEYS, GLOBAL_DESIGN_KEYS, GLOBAL_DESIGN_DEFAULTS,
} from './designConstants';

// ── Tournament Logo Upload ──
const LogoUpload = memo(function LogoUpload({ label, description }) {
    const [logoInfo, setLogoInfo] = useState(null);
    const [uploading, setUploading] = useState(false);

    const fetchLogo = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/branding/logo');
            if (resp.ok) setLogoInfo(await resp.json());
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { fetchLogo(); }, [fetchLogo]);

    const handleUpload = useCallback(async (file) => {
        if (!file) return;
        setUploading(true);
        try {
            const form = new FormData();
            form.append('file', file);
            const resp = await fetch('/api/v1/branding/logo', { method: 'POST', body: form });
            if (resp.ok) setLogoInfo(await resp.json());
        } catch { /* ignore */ }
        setUploading(false);
    }, []);

    const handleRemove = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/branding/logo', { method: 'DELETE' });
            if (resp.ok) setLogoInfo(await resp.json());
        } catch { /* ignore */ }
    }, []);

    return (
        <div>
            <Text size="sm" fw={500}>{label}</Text>
            {description && <Text size="xs" dimmed className="mb-1">{description}</Text>}
            <div className="flex items-center gap-2">
                {logoInfo?.exists && logoInfo.url && (
                    <img
                        src={logoInfo.url + '?t=' + Date.now()}
                        alt="Tournament logo"
                        className="size-12 rounded-md border border-border object-contain"
                    />
                )}
                <FileButton onChange={handleUpload} accept="image/png,image/jpeg,image/svg+xml,image/webp">
                    {(props) => (
                        <Button {...props} variant="secondary" size="xs" disabled={uploading}>
                            {uploading && <Loader size={10} />}
                            {logoInfo?.exists ? 'Replace' : 'Upload'}
                        </Button>
                    )}
                </FileButton>
                {logoInfo?.exists && (
                    <Button variant="ghost" size="xs" className="text-destructive" onClick={handleRemove}>
                        Remove
                    </Button>
                )}
            </div>
        </div>
    );
});

// ── Presets Panel (save/load/export hub for design configurations) ──
const PresetsPanel = memo(function PresetsPanel() {
    const globalDesign = useSettingsStore(useShallow(s => s?.overlays?.global ?? {}));
    const presets = useSettingsStore(s => s?.overlays?.presets ?? {});
    const allLayoutSettings = useSettingsStore(useShallow(s => {
        const result = {};
        for (const layoutType of Object.keys(LAYOUT_SETTINGS)) {
            if (LAYOUT_SETTINGS[layoutType].length === 0) continue;
            result[layoutType] = s?.overlays?.[layoutType] ?? null;
        }
        return result;
    }));
    const setItem = useSettingsStore(s => s.setItem);

    const [presetName, setPresetName] = useState('');
    const [savingPreset, setSavingPreset] = useState(false);

    const handleSavePreset = useCallback(() => {
        const name = presetName.trim();
        if (!name) return;
        const global = {};
        for (const key of GLOBAL_DESIGN_KEYS) {
            global[key] = globalDesign[key] ?? GLOBAL_DESIGN_DEFAULTS[key];
        }
        const preset = { version: 2, global, layouts: allLayoutSettings };
        setItem(`overlays.presets.${name}`, preset);
        setPresetName('');
        setSavingPreset(false);
        notifications.show({ message: `Saved preset "${name}"`, color: 'green' });
    }, [presetName, globalDesign, allLayoutSettings, setItem]);

    const handleLoadPreset = useCallback((name) => {
        const preset = presets[name];
        if (!preset) return;
        const isV1 = !preset.version;
        const globalData = preset.global ?? preset;
        for (const key of GLOBAL_DESIGN_KEYS) {
            if (globalData[key] != null) setItem(`overlays.global.${key}`, globalData[key]);
        }
        const promotedToGlobal = new Set([
            'showCaptains', 'showLogo', 'showShadow', 'finalBadgeColor',
        ]);
        if (preset.layouts) {
            for (const [layoutType, layoutValues] of Object.entries(preset.layouts)) {
                if (!layoutValues) continue;
                for (const [key, value] of Object.entries(layoutValues)) {
                    if (isV1 && promotedToGlobal.has(key)) continue;
                    setItem(`overlays.${layoutType}.${key}`, value);
                }
            }
        }
        notifications.show({ message: `Loaded preset "${name}"`, color: 'blue' });
    }, [presets, setItem]);

    const handleDeletePreset = useCallback((name) => {
        setItem(`overlays.presets.${name}`, null);
        notifications.show({ message: `Deleted preset "${name}"`, color: 'gray' });
    }, [setItem]);

    const resetGlobalDesign = useCallback(() => {
        for (const [key, value] of Object.entries(GLOBAL_DESIGN_DEFAULTS)) {
            setItem(`overlays.global.${key}`, value);
        }
        notifications.show({ message: 'Global design reset to defaults', color: 'blue' });
    }, [setItem]);

    const resetOverrides = useCallback(() => {
        for (const layoutType of Object.keys(LAYOUT_SETTINGS)) {
            for (const def of OVERRIDABLE_GLOBAL_KEYS) {
                setItem(`overlays.${layoutType}.${def.key}`, null);
            }
        }
        notifications.show({ message: 'All layout overrides cleared', color: 'blue' });
    }, [setItem]);

    const handleExportPreset = useCallback((name) => {
        const preset = presets[name];
        if (!preset) return;
        const blob = new Blob([JSON.stringify({ name, ...preset }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, [presets]);

    const handleImportPreset = useCallback((file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                const name = data.name || file.name.replace(/\.json$/i, '');
                const global = data.global ?? {};
                const layouts = data.layouts ?? {};
                const version = data.version ?? 1;
                setItem(`overlays.presets.${name}`, { version, global, layouts });
                notifications.show({ message: `Imported preset "${name}"`, color: 'green' });
            } catch {
                notifications.show({ message: 'Invalid preset file', color: 'red' });
            }
        };
        reader.readAsText(file);
    }, [setItem]);

    const presetNames = Object.keys(presets).filter(k => presets[k] != null);

    return (
        <Stack gap="md" className="max-w-[500px]">
            <LogoUpload
                label="Overlay Logo"
                description="Upload a logo to display on overlays (channel logo, league logo, etc.)"
            />

            <div>
                <Text size="sm" fw={500} className="mb-1">Presets</Text>
                <Text size="xs" dimmed className="mb-2">Save and load full design configurations including global settings and per-layout overrides.</Text>
                <Stack gap="xs">
                    {presetNames.map(name => (
                        <div key={name} className="flex flex-nowrap items-center justify-between gap-2">
                            <Text size="sm" truncate className="min-w-0 flex-1">{name}</Text>
                            <div className="flex flex-nowrap gap-1">
                                <Button variant="secondary" size="xs" onClick={() => handleLoadPreset(name)}>Load</Button>
                                <Button variant="ghost" size="xs" onClick={() => handleExportPreset(name)}>Export</Button>
                                <Button variant="ghost" size="xs" className="text-destructive" onClick={() => handleDeletePreset(name)}>Delete</Button>
                            </div>
                        </div>
                    ))}

                    {savingPreset ? (
                        <div className="flex flex-nowrap items-center gap-2">
                            <Input
                                placeholder="Preset name"
                                value={presetName}
                                onChange={(e) => setPresetName(e.currentTarget.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(); }}
                                className="flex-1"
                                autoFocus
                            />
                            <Button size="xs" onClick={handleSavePreset} disabled={!presetName.trim()}>Save</Button>
                            <Button size="xs" variant="ghost" onClick={() => { setSavingPreset(false); setPresetName(''); }}>Cancel</Button>
                        </div>
                    ) : (
                        <div className="flex flex-nowrap items-center gap-2">
                            <Button variant="secondary" size="xs" onClick={() => setSavingPreset(true)}>
                                Save current as preset
                            </Button>
                            <FileButton onChange={handleImportPreset} accept=".json">
                                {(props) => (
                                    <Button {...props} variant="secondary" size="xs">Import preset</Button>
                                )}
                            </FileButton>
                        </div>
                    )}
                </Stack>
            </div>

            <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={resetGlobalDesign}>
                    Reset global design
                </Button>
                <Button variant="secondary" size="sm" onClick={resetOverrides}>
                    Reset all overrides
                </Button>
            </div>
        </Stack>
    );
});

export { PresetsPanel };
