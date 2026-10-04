import { createContext, memo, useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useSettingsStore } from '../../../context/store';
import { liveName, useObsStore } from '../../../context/obs';
import { obsStageKey, stageOrRun, usePending } from '../../../context/staging';
import { usePersistentState } from '../../../hooks/usePersistentState';
import { notifications } from '../../../lib/notify';
import { cn } from '../../../lib/utils';
import { Group, Stack, Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { FieldRow, KIT_INPUT } from '../kit';
import { LAYOUT_SETTINGS, OVERRIDE_CAPABLE_TYPES } from '../../design/designConstants';
import { settingsTypeOf } from '../elements';
import { boardOfUrl } from '../../../lib/obs-binding';
import { instanceId, variantParams, variantTagFor } from '../sources/instances';
import { isFedPlacement, placementId } from '../sources/placements';
import { useContainerActions, useContainerDefs, CONTAINER_DEFS_KEY } from '../containers/containers';
import {
    defaultLookName, lookKey, lookOfUrl, looksOf, newLookId, urlWithLook,
} from '../../../../public/layout/lib/looks.js';

/*
 * LOOKS on the console — a named variation of one element's settings, worn by a
 * SOURCE (`?look=`) or by a container member (its definition's `looks`).
 *
 * NOT A NEW INTERFACE. A look is edited with the same panel as Main: the Look
 * row names which one this source wears, and every setting on the panel — the
 * stage body's headline controls and the Style section alike — reads and writes
 * that look (`LookContext`, consumed by `useOverlaySettings`). A setting the
 * look sets itself carries a dot; pressing it hands the setting back to Main.
 * Everything else follows Main as Main changes (public/layout/lib/looks.js).
 *
 * Per ELEMENT: the Stat Bar's looks are the Stat Bar's. Main is never stored as
 * a look; it is the element's ordinary settings.
 */

export const LookContext = createContext(null);

const NO_LOOKS = Object.freeze({});

// One element type's looks, as a list in the order they were made.
export function useLooks(type) {
    const bag = useSettingsStore(s => s?.overlays?.[type]?.looks ?? NO_LOOKS);
    return useMemo(() => looksOf({ [type]: { looks: bag } }, type), [type, bag]);
}

// Can this element's look differ at all — does it have anything to set?
export const hasLookableSettings = (type) => (LAYOUT_SETTINGS[type]?.length ?? 0) > 0
    || OVERRIDE_CAPABLE_TYPES.includes(type);

/*
 * The look a placement wears, RESOLVED AT READ TIME: a member's from its
 * container's definition, a source's from its URL (via the variant). An id no
 * look answers to any more — one since deleted — is Main, because Main is what
 * that source is drawing.
 */
export function usePlacementLook(element, placement) {
    const defs = useContainerDefs();
    const type = settingsTypeOf(element);
    const looks = useLooks(type);
    const fed = isFedPlacement({ ...placement, element });
    const raw = fed
        ? defs[placement?.slot]?.looks?.[element?.id] ?? null
        : variantParams(placement?.variant).find(([p]) => p === 'look')?.[1] ?? null;
    const look = raw ? looks.find(l => l.id === raw) ?? null : null;
    return { type, look, looks, fed };
}

/*
 * WITH OBS CLOSED a catalog row has no URL to carry a look, so the pick is kept
 * in the browser against that row — the Roster layout's answer to the same
 * problem — and written into the placement the stage hands on, so the preview
 * and Copy URL wear it too. The row keeps its id.
 */
const OFFLINE_KEY = 'prsh.ui.production.looks';
const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const useOfflineLooks = () => usePersistentState(OFFLINE_KEY, {}, isMap);
const isCatalogRow = (placement) => !placement?.item && !placement?.slot;

export function withLookVariant(variant, look) {
    const parts = variantParams(variant).filter(([p]) => p !== 'look');
    if (look) parts.push(['look', look]);
    return parts.map(([p, v]) => variantTagFor(p, v)).filter(Boolean).join('.');
}

export function useLookPlacement(placement) {
    const [offline] = useOfflineLooks();
    const look = isCatalogRow(placement) ? offline[placement?.id] : null;
    return useMemo(
        () => (look ? { ...placement, variant: withLookVariant(placement.variant, look) } : placement),
        [placement, look],
    );
}

/*
 * Every other place this look is worn: OBS sources (by name, so one source in
 * three scenes counts once) and container slots. The panel says so before an
 * edit, because an edit reaches all of them.
 */
function useWearers(type, lookId, selfName) {
    return useObsStore(useShallow((s) => {
        if (!lookId) return 0;
        const names = new Set();
        for (const items of Object.values(s.sceneItems || {})) {
            for (const it of items || []) {
                if (it?.url && it.sourceName !== selfName && lookOfUrl(it.url) === lookId) names.add(it.sourceName);
            }
        }
        return names.size;
    })) + useSettingsStore((s) => {
        if (!lookId) return 0;
        return Object.values(s?.production?.container_defs ?? {})
            .filter(d => Object.values(d?.looks ?? {}).includes(lookId)).length;
    });
}

const pendingKey = (placement) => obsStageKey('look', [placement.item.sourceName]);

/*
 * THE LOOK ROW — which look this source wears, and the way to make another.
 * With the Board and Layout rows, because like them it is a fact about the
 * SOURCE rather than a setting of the element.
 */
export const LookRow = memo(function LookRow({ element, placement, onSelect, className }) {
    const { type, look, looks, fed } = usePlacementLook(element, placement);
    const { setMemberLook } = useContainerActions();
    const [, setOffline] = useOfflineLooks();
    const pending = usePending(placement?.item && !fed ? pendingKey(placement) : '∅');
    const wearers = useWearers(type, look?.id, placement?.item?.sourceName);

    const offline = isCatalogRow(placement);
    const eligible = !element?.generic && !element?.container && hasLookableSettings(type)
        && (fed || offline || !!placement?.item?.url);

    const wear = useCallback((to) => {
        if ((to || null) === (look?.id ?? null)) return;
        if (fed) { setMemberLook(placement.slot, element.id, to || null); return; }
        if (offline) {
            setOffline((m) => {
                const next = { ...m };
                if (to) next[placement.id] = to;
                else delete next[placement.id];
                return next;
            });
            return;
        }
        const { sourceName, url } = placement.item;
        const nextUrl = urlWithLook(url, to || null);
        const name = to ? (looksOf(useSettingsStore.getState().overlays, type).find(l => l.id === to)?.name ?? 'a look') : 'Main';
        stageOrRun({
            key: pendingKey(placement),
            label: `${sourceName} wears ${name}`,
            value: to || '',
            liveValue: look?.id ?? '',
            run: async () => {
                try {
                    await useObsStore.getState().repointBrowserSource({ sourceName, url: nextUrl });
                    // The look is part of the placement id; stay on this source.
                    onSelect?.(placementId(
                        instanceId(placement.element, placement.board ?? boardOfUrl(nextUrl), nextUrl),
                        liveName(placement.scene),
                    ));
                } catch (e) {
                    notifications.show({ color: 'red', message: e?.message || String(e) });
                }
            },
        });
    }, [fed, offline, look, placement, element, type, setMemberLook, setOffline, onSelect]);

    const create = useCallback(() => {
        const overlays = useSettingsStore.getState().overlays ?? {};
        const taken = Object.values(overlays).flatMap(b => Object.keys(b?.looks ?? {}));
        const id = newLookId(taken);
        useSettingsStore.getState().setItem(lookKey(type, id), { name: defaultLookName(looks), values: {} });
        wear(id);
    }, [type, looks, wear]);

    if (!eligible) return null;
    const shown = pending ? (pending.value || null) : (look?.id ?? null);

    return (
        <FieldRow label="Look" staged={!!pending} className={className}>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <select
                    aria-label="Look" value={shown ?? ''}
                    onChange={e => wear(e.target.value || null)}
                    className={cn(KIT_INPUT, 'w-40')}
                >
                    <option value="">Main</option>
                    {looks.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                {look && <RenameLook type={type} look={look} />}
                {look && <DeleteLook type={type} look={look} onDeleted={() => wear(null)} />}
                <Button size="xs" variant="ghost" className="h-7 text-muted-foreground" onClick={create}>
                    <Plus /> New look
                </Button>
                {look && wearers > 0 && (
                    <Text size="xs" span dimmed className="tabular-nums"
                        title="Changing this look changes every source wearing it">
                        Also on {wearers} {wearers === 1 ? 'other source' : 'other sources'}
                    </Text>
                )}
            </div>
        </FieldRow>
    );
});

function RenameLook({ type, look }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState(look.name);
    const save = () => {
        const v = name.trim();
        if (v && v !== look.name) useSettingsStore.getState().setItem(`${lookKey(type, look.id)}.name`, v);
        setOpen(false);
    };
    return (
        <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setName(look.name); }}>
            <PopoverTrigger asChild>
                <Button size="xs" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" aria-label={`Rename ${look.name}`}>
                    <Pencil />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56">
                <input
                    autoFocus aria-label="Look name" value={name}
                    onFocus={e => e.target.select()}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
                    onBlur={save}
                    className={KIT_INPUT}
                />
            </PopoverContent>
        </Popover>
    );
}

/*
 * Two-step, because every source wearing the look goes back to Main with it.
 * They are not re-pointed in OBS (a reload mid-show is a blink on air); the id
 * they still carry answers to nothing and draws Main. Container slots are
 * cleared in the same commit.
 */
function DeleteLook({ type, look, onDeleted }) {
    const [open, setOpen] = useState(false);
    const remove = () => {
        const store = useSettingsStore.getState();
        const defs = store?.production?.container_defs ?? {};
        let touched = false;
        const next = {};
        for (const [id, d] of Object.entries(defs)) {
            const looks = Object.fromEntries(Object.entries(d?.looks ?? {}).filter(([, v]) => v !== look.id));
            if (Object.keys(looks).length !== Object.keys(d?.looks ?? {}).length) touched = true;
            next[id] = { ...d, looks };
        }
        onDeleted();
        if (touched) store.setItem(CONTAINER_DEFS_KEY, next);
        store.deleteItem(lookKey(type, look.id));
        setOpen(false);
    };
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button size="xs" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" aria-label={`Delete ${look.name}`}>
                    <Trash2 />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-60">
                <Stack gap="xs">
                    <Text size="sm" className="text-foreground">Delete “{look.name}”?</Text>
                    <Text size="xs" className="text-muted-foreground">Everything wearing it goes back to Main.</Text>
                    <Group gap="xs" className="justify-end">
                        <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button size="xs" variant="destructive" onClick={remove}>Delete</Button>
                    </Group>
                </Stack>
            </PopoverContent>
        </Popover>
    );
}

/*
 * The mark on a setting this look sets itself. A button, because the one thing
 * to do with it is hand the setting back to Main.
 */
export function LookDot({ os, def, className }) {
    return (
        <button
            type="button"
            onClick={() => os.set(def, null)}
            aria-label={`Use Main for ${def.label}`}
            title="Set by this look — click to follow Main"
            className={cn('size-2 shrink-0 rounded-full bg-violet-400 hover:ring-2 hover:ring-violet-400/40', className)}
        />
    );
}
