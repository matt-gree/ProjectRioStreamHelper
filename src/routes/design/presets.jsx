import { memo, useMemo, useState, useCallback } from 'react';
import { Check, MoreHorizontal, Plus, RotateCcw, Upload } from 'lucide-react';
import { Text } from '../../components/ui/primitives';
import { Panel } from '../../components/ui/panel';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { FileButton } from '../../components/ui/file-button';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { cn } from '../../lib/utils';
import { notifications } from '../../lib/notify';
import { useSettingsStore } from '../../context/store';
import { useDesignPackages } from './designPackage';
import {
    DEFAULT_PRESET, exportBody, listPresets, presetIdFor, parseImport, planApply,
    snapshotPreset, wearsPreset,
} from './presets';

/*
 * The PRESETS strip — the top of the Design tab, because switching a whole
 * tournament's preset is the thing a producer comes here to do most, and the
 * controls below are how a preset is made. See ./presets.js for what a preset holds
 * and why applying one replaces rather than merges.
 *
 * The active preset is `overlays.active_preset`, written in the same commit as the
 * apply; "modified" is computed, never stored — the show either still wears the
 * preset or it does not, and a flag could only disagree with that.
 */

const api = async (path, init) => {
    const r = await fetch(`/api/v1/branding/presets/${path}`, init);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.detail || `Request failed (${r.status})`);
    return data;
};

const getOverlays = () => useSettingsStore.getState()?.overlays ?? {};

async function applyPreset(preset) {
    const { sets, unsets } = planApply(getOverlays(), preset);
    sets.push({ key: 'overlays.active_preset', value: preset.id ?? null });
    await useSettingsStore.getState().applyBatch(sets, unsets);
    // A legacy preset never recorded a logo, so it has no opinion about the
    // live one; the built-in defaults deliberately keep it.
    if (preset.id && !preset.legacy) await api(`${preset.id}/logo/apply`, { method: 'POST' });
}

async function savePreset(name, existing) {
    const overlays = getOverlays();
    const taken = Object.keys(overlays.presets ?? {});
    // A legacy preset is keyed by its NAME, which is no id a logo file can
    // live under — updating one re-homes it.
    const id = existing && !existing.legacy ? existing.id : presetIdFor(name, taken);
    const preset = snapshotPreset(overlays, { id, name });
    if (existing?.createdAt) preset.createdAt = existing.createdAt;
    preset.logo = (await api(`${id}/logo/capture`, { method: 'POST' })).logo;
    const unsets = existing && existing.id !== id ? [`overlays.presets.${existing.id}`] : [];
    await useSettingsStore.getState().applyBatch(
        [{ key: `overlays.presets.${id}`, value: preset }, { key: 'overlays.active_preset', value: id }],
        unsets,
    );
    return preset;
}

function download(filename, body) {
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
});

const fail = (verb) => (e) => notifications.show({ message: `${verb} failed: ${e?.message || e}`, color: 'red' });

// ── Name entry, shared by Save and Rename ──
function NameForm({ initial = '', submitLabel, onSubmit, onCancel }) {
    const [name, setName] = useState(initial);
    const trimmed = name.trim();
    return (
        <form
            className="flex items-center gap-2"
            onSubmit={(e) => { e.preventDefault(); if (trimmed) onSubmit(trimmed); }}
        >
            <Input autoFocus value={name} placeholder="e.g. SLICE 26" onChange={(e) => setName(e.currentTarget.value)} className="h-8" />
            <Button type="submit" size="sm" disabled={!trimmed}>{submitLabel}</Button>
            {onCancel && <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
        </form>
    );
}

function SaveNewButton({ variant = 'secondary' }) {
    const [open, setOpen] = useState(false);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button size="sm" variant={variant}><Plus /> Save as new preset</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-3">
                <NameForm
                    submitLabel="Save"
                    onSubmit={async (name) => {
                        setOpen(false);
                        try {
                            await savePreset(name, null);
                            notifications.show({ message: `Saved preset "${name}"`, color: 'green' });
                        } catch (e) { fail('Save')(e); }
                    }}
                />
            </PopoverContent>
        </Popover>
    );
}

function ImportButton() {
    const onFile = useCallback(async (file) => {
        if (!file) return;
        try {
            const data = JSON.parse(await file.text());
            const preset = parseImport(data, file.name.replace(/(\.prsh-preset)?\.json$/i, ''));
            if (!preset) throw new Error('not a preset file');
            const presets = getOverlays().presets ?? {};
            const id = presetIdFor(preset.name, Object.keys(presets));
            const now = new Date().toISOString();
            const stored = { ...exportBody(preset), id, createdAt: now, savedAt: now, logo: false };
            delete stored.logoData;
            if (typeof data.logoData === 'string' && data.logoData.startsWith('data:image/')) {
                const blob = await (await fetch(data.logoData)).blob();
                const form = new FormData();
                form.append('file', blob, `${id}.png`);
                stored.logo = (await api(`${id}/logo`, { method: 'PUT', body: form })).logo;
            }
            await useSettingsStore.getState().applyBatch([{ key: `overlays.presets.${id}`, value: stored }]);
            notifications.show({ message: `Imported preset "${preset.name}"`, color: 'green' });
        } catch (e) { fail('Import')(e); }
    }, []);
    return (
        <FileButton onChange={onFile} accept=".json,application/json">
            {(props) => <Button {...props} size="sm" variant="ghost"><Upload /> Import</Button>}
        </FileButton>
    );
}

// ── One saved preset ──
const PresetCard = memo(function PresetCard({ preset, active, worn, dirtyShow, packageName }) {
    const [menu, setMenu] = useState(false);
    const [mode, setMode] = useState(null);   // null | 'rename' | 'delete'
    const [confirmApply, setConfirmApply] = useState(false);
    const pins = Object.keys(preset.pins ?? {}).length;
    const modified = active && !worn;
    const logoRev = useSettingsStore(s => s?.overlays?.global?.logoRev) ?? 0;

    const doApply = async () => {
        setConfirmApply(false);
        try {
            await applyPreset(preset);
            notifications.show({ message: `Applied preset "${preset.name}"`, color: 'blue' });
        } catch (e) { fail('Apply')(e); }
    };

    const doExport = async () => {
        setMenu(false);
        try {
            const body = exportBody(preset);
            if (preset.logo) {
                const r = await fetch(`/branding/presets/${preset.id}.png?v=${Date.now()}`);
                if (r.ok) body.logoData = await blobToDataUrl(await r.blob());
            }
            download(`${preset.id}.prsh-preset.json`, body);
        } catch (e) { fail('Export')(e); }
    };

    const doDelete = async () => {
        setMenu(false);
        try {
            await useSettingsStore.getState().applyBatch(
                [], [`overlays.presets.${preset.id}`, ...(active ? ['overlays.active_preset'] : [])],
            );
            if (!preset.legacy) await api(`${preset.id}/logo`, { method: 'DELETE' });
            notifications.show({ message: `Deleted preset "${preset.name}"`, color: 'gray' });
        } catch (e) { fail('Delete')(e); }
    };

    const doUpdate = async () => {
        setMenu(false);
        try {
            await savePreset(preset.name, preset);
            notifications.show({ message: `Updated preset "${preset.name}"`, color: 'green' });
        } catch (e) { fail('Update')(e); }
    };

    const doRename = (name) => {
        setMenu(false);
        setMode(null);
        useSettingsStore.getState().setItem(`overlays.presets.${preset.id}.name`, name);
    };

    return (
        <div
            className={cn(
                'flex w-72 shrink-0 flex-col gap-2 rounded-lg border bg-background/40 p-2.5 transition-colors',
                active ? (modified ? 'border-amber-500/60' : 'border-primary/70') : 'border-border hover:border-muted-foreground/40',
            )}
        >
            <div className="flex items-center gap-2.5">
                <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-night-950">
                    {preset.logo
                        ? <img src={`/branding/presets/${preset.id}.png?v=${preset.savedAt ?? ''}-${logoRev}`} alt="" className="size-full object-contain" />
                        : <span className="label-display text-sm text-muted-foreground">{preset.name.slice(0, 2)}</span>}
                </div>
                <div className="min-w-0 flex-1">
                    <Text size="sm" fw={600} truncate title={preset.name}>{preset.name}</Text>
                    <Text size="xs" dimmed truncate>
                        {packageName}{` · ${pins} ${pins === 1 ? 'pin' : 'pins'}`}{preset.legacy ? ' · old preset' : ''}
                    </Text>
                </div>
                <Popover open={menu} onOpenChange={(o) => { setMenu(o); if (!o) setMode(null); }}>
                    <PopoverTrigger asChild>
                        <Button size="icon-sm" variant="ghost" aria-label={`More for ${preset.name}`}><MoreHorizontal /></Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-64 p-1.5">
                        {mode === 'rename' ? (
                            <div className="p-1.5"><NameForm initial={preset.name} submitLabel="Rename" onSubmit={doRename} onCancel={() => setMode(null)} /></div>
                        ) : mode === 'delete' ? (
                            <div className="flex flex-col gap-2 p-1.5">
                                <Text size="sm">Delete “{preset.name}”?</Text>
                                <div className="flex gap-2">
                                    <Button size="sm" variant="destructive" onClick={doDelete}>Delete</Button>
                                    <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col">
                                <MenuItem onClick={doUpdate}>Replace with current design</MenuItem>
                                <MenuItem onClick={() => setMode('rename')}>Rename</MenuItem>
                                <MenuItem onClick={doExport}>Export file</MenuItem>
                                <MenuItem onClick={() => setMode('delete')} className="text-destructive">Delete</MenuItem>
                            </div>
                        )}
                    </PopoverContent>
                </Popover>
            </div>

            <div className="flex items-center gap-2">
                {active && worn && <Badge variant="outline" className="border-primary/60 text-primary"><Check /> Applied</Badge>}
                {modified && (
                    <>
                        <Badge variant="outline" className="border-amber-500/60 text-amber-400">Modified</Badge>
                        <div className="ml-auto flex gap-1.5">
                            <Button size="xs" variant="ghost" onClick={doApply} title="Discard changes and re-apply this preset"><RotateCcw /> Revert</Button>
                            <Button size="xs" onClick={doUpdate}>Update</Button>
                        </div>
                    </>
                )}
                {!active && (
                    <div className="ml-auto">
                        <ApplyButton confirm={dirtyShow} open={confirmApply} setOpen={setConfirmApply} onApply={doApply} disabled={worn}>
                            {worn ? 'Matches current' : 'Apply'}
                        </ApplyButton>
                    </div>
                )}
            </div>
        </div>
    );
});

function MenuItem({ className, ...props }) {
    return (
        <button
            type="button"
            className={cn('rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent', className)}
            {...props}
        />
    );
}

// Apply REPLACES the current design. When that design is not saved in any preset,
// say so first — it is the one press on this strip that can lose work.
function ApplyButton({ confirm, open, setOpen, onApply, disabled, children, variant = 'secondary' }) {
    if (!confirm || disabled) {
        return <Button size="xs" variant={variant} onClick={onApply} disabled={disabled}>{children}</Button>;
    }
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button size="xs" variant={variant}>{children}</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
                <Text size="sm" className="mb-2">The current design isn’t saved in a preset. Replace it anyway?</Text>
                <div className="flex gap-2">
                    <Button size="sm" onClick={onApply}>Replace</Button>
                    <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}

function DefaultsCard({ dirtyShow, worn }) {
    const [open, setOpen] = useState(false);
    const apply = async () => {
        setOpen(false);
        try {
            await applyPreset(DEFAULT_PRESET);
            notifications.show({ message: 'Design reset to defaults', color: 'blue' });
        } catch (e) { fail('Reset')(e); }
    };
    return (
        <div className="flex w-56 shrink-0 flex-col justify-between gap-2 rounded-lg border border-dashed border-border p-2.5">
            <div>
                <Text size="sm" fw={600}>Defaults</Text>
                <Text size="xs" dimmed>Default theme · no pins · logo kept</Text>
            </div>
            <div className="ml-auto">
                <ApplyButton confirm={dirtyShow} open={open} setOpen={setOpen} onApply={apply} disabled={worn} variant="ghost">
                    {worn ? 'Matches current' : 'Reset to defaults'}
                </ApplyButton>
            </div>
        </div>
    );
}

export const PresetsPanel = memo(function PresetsPanel() {
    const overlays = useSettingsStore(s => s?.overlays);
    const packages = useDesignPackages();
    const presets = useMemo(() => listPresets(overlays?.presets), [overlays?.presets]);
    const activeId = overlays?.active_preset ?? null;

    const state = useMemo(() => {
        const o = overlays ?? {};
        const worn = new Set(presets.filter(l => wearsPreset(o, l)).map(l => l.id));
        const defaultsWorn = wearsPreset(o, DEFAULT_PRESET);
        return {
            worn,
            defaultsWorn,
            // Nothing saved describes what is on screen: applying anything loses it.
            unsaved: worn.size === 0 && !defaultsWorn,
        };
    }, [overlays, presets]);

    const nameOf = (id) => packages?.find(p => p.id === id)?.name ?? id ?? 'Default';

    return (
        <Panel
            title="Presets"
            actions={<><ImportButton /><SaveNewButton variant={state.unsaved ? 'default' : 'secondary'} /></>}
        >
            <div className="flex gap-3 overflow-x-auto p-3">
                {presets.map(preset => (
                    <PresetCard
                        key={preset.id}
                        preset={preset}
                        active={preset.id === activeId}
                        worn={state.worn.has(preset.id)}
                        dirtyShow={state.unsaved}
                        packageName={nameOf(preset.global?.designPackage ?? 'default')}
                    />
                ))}
                {presets.length === 0 && (
                    <div className="flex min-w-72 flex-col justify-center rounded-lg border border-dashed border-border px-3 py-2">
                        <Text size="sm" fw={600}>No saved presets</Text>
                        <Text size="xs" dimmed>Save this design to switch back to it for another event.</Text>
                    </div>
                )}
                <DefaultsCard dirtyShow={state.unsaved} worn={state.defaultsWorn} />
            </div>
        </Panel>
    );
});

export { applyPreset, savePreset };
