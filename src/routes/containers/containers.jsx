import { memo, useState } from 'react';
import { Check, Copy, Plus, Trash2 } from 'lucide-react';
import { useObsStore } from '../../context/obs';
import { Group, Stack, Text, Title } from '../../components/ui/primitives';
import { Popover, PopoverTrigger, PopoverContent } from '../../components/ui/popover';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { CopyButton } from '../../components/ui/copy-button';
import { notifications } from '../../lib/notify';
import { useCopyableUrl } from '../../lib/obs-reach';
import { cn } from '../../lib/utils';
import { KIT_INPUT } from '../production/kit';
import { absoluteOverlayUrl } from '../production/board/bindings';
import { NewContainerForm } from '../production/sources/newcontainer';
import { ContainerEditor } from '../production/containers/editor';
import { memberName, REASONS, useFeedReason } from '../production/containers/automations';
import {
    useCarrying, useContainerActions, useContainerScenes, useContainerTabSelection, useSharedContainers,
} from '../production/containers/containers';

/*
 * THE CONTAINERS TAB — the one workbench every container is built on.
 *
 * A container is a definition (name · roster · positions · scope · rules) that
 * OBS sources point at, and the definition outlives every one of them: take a
 * container out of every scene and it is still here, ready to go back in.
 *
 * WHY A TAB. It was a desk on the console first, and building a container is
 * heavy authoring — the console's depth rule puts that on a tab. The stage
 * column between rack and rail could hold one container at a time, a preview
 * the size of a thumbnail, and an Edit that had to take over the whole panel.
 * Flying a container (show, hold, hand back) stays on its SOURCE panel in the
 * console, which links here with that container selected.
 *
 * Master-detail: every container down the left, the selected one on the right
 * around a large preview. The selection is browser-local and RESOLVED AT READ
 * TIME — a stored id for a deleted container falls back to the first.
 */
const PREVIEW_H = 420;

export default function ContainersTab() {
    const list = useSharedContainers();
    const [stored, setSelected] = useContainerTabSelection();
    const [creating, setCreating] = useState(false);
    const { create } = useContainerActions();
    const selected = list.find(d => d.id === stored) ?? list[0] ?? null;

    const onCreate = (name, members) => {
        const id = create(name, members);
        setCreating(false);
        setSelected(id);
    };
    const pick = (id) => { setCreating(false); setSelected(id); };

    return (
        <div className="flex flex-col gap-3">
            <Title order={3}>Containers</Title>
            {/* The list column appears once there is a list: on an empty tab
                the detail's one press is the whole answer. */}
            <div className={cn('grid items-start gap-4', list.length > 0 && 'lg:grid-cols-[16rem_minmax(0,1fr)]')}>
                {list.length > 0 && <nav aria-label="Containers" className="flex flex-col gap-1 rounded-md border border-border p-1.5">
                    {list.map(def => (
                        <ContainerRow
                            key={def.id} def={def}
                            active={!creating && selected?.id === def.id}
                            onPick={() => pick(def.id)}
                        />
                    ))}
                    <Button
                        size="xs" variant="ghost" className="justify-start text-muted-foreground"
                        onClick={() => setCreating(true)}
                    >
                        <Plus size={13} className="mr-1" /> New container
                    </Button>
                </nav>}

                <section className="min-w-0 rounded-md border border-border p-4">
                    {creating ? (
                        <NewContainerForm
                            onCreate={onCreate} onCancel={() => setCreating(false)} height={PREVIEW_H}
                        />
                    ) : selected ? (
                        <ContainerDetail key={selected.id} def={selected} />
                    ) : (
                        <div className="flex min-h-48 flex-col items-center justify-center gap-3">
                            <Text size="sm" dimmed>No containers yet</Text>
                            <Button size="sm" onClick={() => setCreating(true)}>
                                <Plus size={14} className="mr-1" /> New container
                            </Button>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}

/*
 * One container in the list: its name, what it carries now and why, and — only
 * with OBS there to ask — that no scene has a source for it.
 */
const ContainerRow = memo(function ContainerRow({ def, active, onPick }) {
    const carrying = useCarrying(def.id);
    const reason = useFeedReason(def.id);
    const scenes = useContainerScenes(def.id);
    const connected = useObsStore(s => s.status === 'connected');
    const now = carrying ? memberName(carrying) : null;
    return (
        <button
            type="button" onClick={onPick} aria-current={active ? 'true' : undefined}
            className={cn(
                'flex min-w-0 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left',
                active ? 'bg-accent/60' : 'hover:bg-accent/30',
            )}
        >
            <span className="flex w-full min-w-0 items-center gap-2">
                <span className="label-display min-w-0 flex-1 truncate text-sm text-foreground">{def.name}</span>
                {connected && !scenes.length && <NotInObs />}
            </span>
            <span
                className="w-full truncate text-xs text-muted-foreground"
                title={reason ? REASONS[reason]?.hint : undefined}
            >
                {now ?? 'empty'}
                {now && reason && REASONS[reason] ? ` · ${REASONS[reason].label}` : ''}
            </span>
        </button>
    );
});

function NotInObs() {
    return (
        <Badge
            className="shrink-0 bg-amber-500/15 text-[10px] font-semibold uppercase tracking-wider text-amber-300"
            title="No scene has a source for this container"
        >
            Not in OBS
        </Badge>
    );
}

// The selected container: its name (renamed where it is named), then the editor.
const ContainerDetail = memo(function ContainerDetail({ def }) {
    const scenes = useContainerScenes(def.id);
    const connected = useObsStore(s => s.status === 'connected');
    const { rename } = useContainerActions();
    return (
        <div className="flex flex-col gap-4">
            <div className="flex min-w-0 items-center gap-2">
                <input
                    aria-label="Container name" value={def.name === def.id ? '' : def.name} placeholder={def.id}
                    onChange={e => rename(def.id, e.target.value)}
                    className="label-display min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-base text-foreground outline-none hover:border-border focus:border-ring"
                />
                {connected && !scenes.length && <NotInObs />}
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{def.width} × {def.height}</span>
            </div>
            <ContainerEditor
                def={def} previewHeight={PREVIEW_H}
                footer={<DetailFoot def={def} scenes={scenes} connected={connected} />}
            />
        </div>
    );
});

/*
 * WHERE IT IS ON SCREEN, and the way out — the scenes holding a source for it,
 * adding one (hidden, like every console add path: the eye on its row is the
 * deliberate act that puts it on air), Copy URL whatever OBS is doing, and
 * Delete at the far end, two-step.
 */
const DetailFoot = memo(function DetailFoot({ def, scenes, connected }) {
    const allScenes = useObsStore(s => s.scenes);
    const { remove } = useContainerActions();
    const [adding, setAdding] = useState(false);
    const [confirmDel, setConfirmDel] = useState(false);
    const url = absoluteOverlayUrl(def.url);
    const copyable = useCopyableUrl(url);
    const free = (allScenes || []).filter(sc => !scenes.includes(sc));

    const addTo = async (sceneName) => {
        if (!sceneName) return;
        setAdding(true);
        try {
            const res = await useObsStore.getState().addBrowserSource({
                inputName: def.name, url, width: def.width, height: def.height, sceneName, enabled: false,
            });
            notifications.show({
                color: 'green',
                message: `Added “${res.inputName}” to ${res.sceneName} — hidden. Flip it on when you're ready.`,
            });
        } catch (e) {
            notifications.show({ color: 'red', message: e?.message || 'Failed to add to OBS' });
        }
        setAdding(false);
    };

    return (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            {connected && scenes.length > 0 && (
                <Text size="xs" span dimmed className="min-w-0 truncate">In {scenes.join(', ')}</Text>
            )}
            {connected && free.length > 0 && (
                <select
                    aria-label="Add to scene" value="" disabled={adding}
                    onChange={e => addTo(e.target.value)}
                    className={cn(KIT_INPUT, 'w-36')}
                >
                    <option value="">{adding ? 'Adding…' : 'Add to scene…'}</option>
                    {free.map(sc => <option key={sc} value={sc}>{sc}</option>)}
                </select>
            )}
            <CopyButton value={copyable}>
                {({ copied, copy }) => (
                    <Button size="xs" variant="ghost" onClick={copy} className="shrink-0">
                        {copied
                            ? <><Check size={11} className="mr-0.5" /> Copied</>
                            : <><Copy size={11} className="mr-0.5" /> Copy URL</>}
                    </Button>
                )}
            </CopyButton>
            {/* Two-step: a delete takes the feed, the resting member and every
                rule with it (`detach`/`dropRules` in ../production/containers).
                The OBS sources stay; removing those instead is how a container
                is kept for later. */}
            <Popover open={confirmDel} onOpenChange={setConfirmDel}>
                <PopoverTrigger asChild>
                    <Button size="xs" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive">
                        <Trash2 /> Delete container
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-60">
                    <Stack gap="xs">
                        <Text size="sm" className="text-foreground">Delete “{def.name || def.id}”?</Text>
                        <Text size="xs" className="text-muted-foreground">
                            Clears what it is showing and deletes its rules.
                            Its OBS sources stay — delete those in OBS.
                        </Text>
                        <Group gap="xs" className="justify-end">
                            <Button size="xs" variant="ghost" onClick={() => setConfirmDel(false)}>Cancel</Button>
                            <Button size="xs" variant="destructive" onClick={() => remove(def.id)}>Delete</Button>
                        </Group>
                    </Stack>
                </PopoverContent>
            </Popover>
        </div>
    );
});
