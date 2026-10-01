import { memo, useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Plus, Trash2, X } from 'lucide-react';
import { Group, Stack, Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover';
import { useSettingsStore } from '../../../context/store';
import { useObsStore } from '../../../context/obs';
import { notifications } from '../../../lib/notify';
import { cn } from '../../../lib/utils';
import { IconToggle, KIT_INPUT, KIT_SECTION, NumberField } from '../kit';
import {
    CONTAINER_MEMBERS, containerOfSource, growContainerSources, isSharedMember, sizeForMembers,
    useContainerActions, useContainerDefs,
} from '../containers/containers';
import { subjectKind, useContainerAutomations } from '../containers/automations';
import { useActiveBoards, useBoardLabel } from '../board/boards';
import { useSideLabels } from '../sides';
import { BindingNote } from './generic';
import AutomationSection from './automation';

/*
 * A container's stage panel — where a container is BUILT.
 *
 * Top to bottom: what it is (its size, and the scenes its source is in), what
 * goes on it (the ROSTER), whose game it is about (SCOPE, only when something
 * on it needs one), and how it feeds itself (the RULES). The name is the panel
 * title (`useContainerRename`), and what it is showing right now — and why —
 * is the panel's subject line.
 *
 * MEMBERS ARE MUTUALLY EXCLUSIVE, and that is the definition rather than
 * advice: `production.feed.container.{id}` holds exactly one occupant, so
 * sharing a container is what "these two never appear at once" means. Adding an
 * element that another container already holds MOVES it, and the picker says
 * so before the click — except for a container-SCOPED member (a roster, a stat
 * card), which has no content of its own to be in two places at once and is
 * added rather than moved. That exception is what makes a mirrored pair
 * buildable here.
 *
 * THE SIZE FOLLOWS THE ROSTER, UP. A container is as big as its largest member
 * (`sizeForMembers`), so there is no size control: adding a bigger member grows
 * it, and resizes its OBS sources at their current scale, behind a confirm that
 * says so — members anchored to the centre or the bottom move when the canvas
 * grows. Taking a member off never shrinks it, for the same reason.
 */

/*
 * The panel title IS the name field. Returns null for anything that is not a
 * container, so the stage shell can ask every element.
 */
export function useContainerRename(element) {
    const id = element?.container ?? null;
    const stored = useSettingsStore(s => (id ? s?.production?.container_defs?.[id]?.name : undefined));
    const exists = useSettingsStore(s => !!(id && s?.production?.container_defs?.[id]));
    const { rename } = useContainerActions();
    const onChange = useCallback(v => rename(id, v), [rename, id]);
    if (!id || !exists) return null;
    return { value: stored ?? '', placeholder: id, onChange };
}

// Which other containers hold each element, so the picker can say what adding
// it would take it away from.
function useHolders(defs) {
    return useMemo(() => {
        const out = {};
        for (const def of Object.values(defs)) {
            for (const m of def.members || []) (out[m] ??= []).push(def);
        }
        return out;
    }, [defs]);
}

// The scenes this container's source is in, off the scene mirror.
function useContainerScenes(id) {
    return useObsStore(useShallow((s) => {
        const out = [];
        for (const [scene, items] of Object.entries(s.sceneItems || {})) {
            if ((items || []).some(it => it?.url && containerOfSource(it.url) === id)) out.push(scene);
        }
        return out;
    }));
}

/*
 * Where a smaller member sits in the container, inline under its roster row.
 * The anchor carries the intent — "on the floor" stays on the floor whatever
 * the container grows to — and the nudge is pixels on top of it. This is what
 * lets a container hold a band: a 1920×80 ticker centered in a full-canvas
 * container floats 500px above where a ticker belongs.
 */
const ANCHORS = [
    { value: 'top-left', label: 'Top left' },
    { value: 'top', label: 'Top' },
    { value: 'top-right', label: 'Top right' },
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Center' },
    { value: 'right', label: 'Right' },
    { value: 'bottom-left', label: 'Bottom left' },
    { value: 'bottom', label: 'Bottom' },
    { value: 'bottom-right', label: 'Bottom right' },
];

const MemberRow = memo(function MemberRow({ element, def, carrying, setMember, setOffset }) {
    const smaller = element.width < def.width || element.height < def.height;
    const cur = def.offsets?.[element.id] || { anchor: 'center', x: 0, y: 0 };
    const write = patch => setOffset(def.id, element.id, { ...cur, ...patch });
    return (
        <div className="group flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-1.5 hover:bg-accent/40">
            <span className={cn('size-1.5 shrink-0 rounded-full', carrying ? 'bg-emerald-400' : 'bg-foreground/25')}
                title={carrying ? 'On the container now' : undefined} />
            <Text size="xs" span truncate className="min-w-0 basis-36 text-foreground">{element.name}</Text>
            <Text size="xs" span dimmed className="w-20 shrink-0 tabular-nums">{element.width} × {element.height}</Text>
            {smaller ? (
                <div className="flex items-center gap-1">
                    <select
                        aria-label={`Where ${element.name} sits`} value={cur.anchor}
                        onChange={e => write({ anchor: e.target.value })}
                        className={cn(KIT_INPUT, 'w-28')}
                    >
                        {ANCHORS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                    </select>
                    <NumberField value={cur.x} onChange={v => write({ x: v || 0 })} ariaLabel="Nudge X" suffix="x" />
                    <NumberField value={cur.y} onChange={v => write({ y: v || 0 })} ariaLabel="Nudge Y" suffix="y" />
                </div>
            ) : (
                <Text size="xs" span dimmed>fills it</Text>
            )}
            <span className="ml-auto opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                <IconToggle icon={X} tone="danger" label={`Take ${element.name} off this container`}
                    onClick={() => setMember(def.id, element.id, false)} />
            </span>
        </div>
    );
});

/*
 * "+ Add member": every hostable element not already on, with what adding it
 * does — move it from another container, or grow this one. A grow asks first,
 * because it resizes the OBS source on air.
 */
const AddMember = memo(function AddMember({ def, holders, onAdd }) {
    const [open, setOpen] = useState(false);
    const [growing, setGrowing] = useState(null);
    const candidates = CONTAINER_MEMBERS.filter(el => !(def.members || []).includes(el.id));
    if (!candidates.length) return null;
    const pick = (el) => {
        const size = sizeForMembers([...def.members, el.id]);
        if (size.width > def.width || size.height > def.height) setGrowing({ el, size });
        else { onAdd(el); setOpen(false); }
    };
    return (
        <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setGrowing(null); }}>
            <PopoverTrigger asChild>
                <Button size="xs" variant="ghost" className="w-fit"><Plus /> Add member</Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-1">
                {growing ? (
                    <Stack gap="xs" className="p-2">
                        <Text size="sm" className="text-foreground">
                            Grow to {growing.size.width} × {growing.size.height}?
                        </Text>
                        <Text size="xs" className="text-muted-foreground">
                            {growing.el.name} is bigger than this container. Its OBS source is resized
                            at the scale it draws at, so members anchored to the center or bottom
                            move on screen.
                        </Text>
                        <Group gap="xs" className="justify-end">
                            <Button size="xs" variant="ghost" onClick={() => setGrowing(null)}>Back</Button>
                            <Button size="xs" onClick={() => { onAdd(growing.el); setOpen(false); setGrowing(null); }}>
                                Grow and add
                            </Button>
                        </Group>
                    </Stack>
                ) : candidates.map((el) => {
                    const others = (holders[el.id] || []).filter(h => h.id !== def.id);
                    const grows = el.width > def.width || el.height > def.height;
                    const note = [
                        others.length ? `${isSharedMember(el) ? 'also on' : 'moves from'} ${others.map(h => h.name).join(', ')}` : null,
                        grows ? 'grows it' : null,
                    ].filter(Boolean).join(' · ');
                    return (
                        <button
                            key={el.id} type="button" onClick={() => pick(el)}
                            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent"
                        >
                            <span className="min-w-0 flex-1 truncate text-foreground">{el.name}</span>
                            {note && <span className={cn('truncate', grows ? 'text-amber-400' : 'text-muted-foreground')}>{note}</span>}
                            <span className="shrink-0 tabular-nums text-muted-foreground">{el.width} × {el.height}</span>
                        </button>
                    );
                })}
            </PopoverContent>
        </Popover>
    );
});

/*
 * SCOPE — whose game this container is about. Only drawn when something on it
 * reads one: a container-scoped member (whose content is "whoever this side has
 * on the field"), or a rule that names this container's side. A full-canvas
 * callout stage has no side, and a Board/Side pair on it would be two controls
 * that do nothing.
 */
const ScopeRow = memo(function ScopeRow({ def }) {
    const { setScope } = useContainerActions();
    const boards = useActiveBoards();
    const boardLabel = useBoardLabel();
    const sides = useSideLabels();
    return (
        <div className={KIT_SECTION}>
            <div className="flex flex-wrap items-center gap-2">
                <Text size="xs" span className="label-display w-14 tracking-wider text-muted-foreground">Scope</Text>
                <select
                    aria-label="Board" value={String(def.scoreboard)}
                    onChange={e => setScope(def.id, e.target.value, def.team)}
                    className={cn(KIT_INPUT, 'w-40')}
                >
                    {boards.map(b => <option key={b} value={String(b)}>{boardLabel(b)}</option>)}
                </select>
                <div role="radiogroup" aria-label="Side" className="flex overflow-hidden rounded-md border border-border">
                    {[1, 2].map(t => (
                        <button
                            key={t} type="button" role="radio" aria-checked={def.team === t}
                            onClick={() => setScope(def.id, def.scoreboard, t)}
                            className={cn('h-7 px-3 text-xs',
                                def.team === t ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
                        >
                            {sides.label(t)}
                        </button>
                    ))}
                </div>
                <Text size="xs" span dimmed>whose batter, pitcher and roster this container shows</Text>
            </div>
        </div>
    );
});

const SIDE_RULE = r => r.by === 'scope' || r.subject === 'scope' || r.state === 'side_batting' || r.state === 'side_pitching';

export default function ContainerStage({ element, placement }) {
    const id = element.container ?? placement?.container;
    const defs = useContainerDefs();
    const def = id ? defs[id] : null;
    const holders = useHolders(defs);
    const scenes = useContainerScenes(id);
    const rules = useContainerAutomations(id);
    const { remove, setMember, setOffset } = useContainerActions();
    const [confirmDel, setConfirmDel] = useState(false);

    /*
     * Adding is where the size can move: the definition grows first (config,
     * immediate), then the OBS sources follow. A source that refuses (a crop)
     * leaves the container's size right and that one source at its old canvas,
     * which the toast names.
     */
    const add = useCallback(async (el) => {
        const grew = setMember(id, el.id, true);
        if (!grew) return;
        try {
            const n = await growContainerSources(id, grew.to.width, grew.to.height);
            notifications.show({
                color: 'green',
                message: `Grew to ${grew.to.width} × ${grew.to.height}`
                    + (n ? ` and resized ${n === 1 ? 'its OBS source' : `${n} OBS sources`}` : ''),
            });
        } catch (e) {
            notifications.show({ color: 'red', message: `Grew the container, but OBS refused: ${e.message}` });
        }
    }, [id, setMember]);

    /*
     * A source pointing at a container with no definition — a pre-2.0 named
     * shell, or one the producer deleted while its source was still in a scene.
     * It still renders whatever is fed to it, so the row and the Air slot are
     * honest; what it has no answer for is the roster.
     */
    if (!def) {
        return (
            <>
                <BindingNote binding={placement} what="This container" />
                <Text size="xs" className="text-amber-500/90">
                    No definition for “{id}”. The source still renders whatever is
                    fed to it, but nothing can be added to it until a container by
                    that name exists — build one with the + beside a scene and
                    point this source at it.
                </Text>
            </>
        );
    }

    const members = (def.members || [])
        .map(m => CONTAINER_MEMBERS.find(el => el.id === m))
        .filter(Boolean);
    const needsScope = def.members.some(m => subjectKind(m)) || rules.some(SIDE_RULE);

    return (
        <>
            <BindingNote binding={placement} what="This container" />

            <div className={KIT_SECTION}>
                <div className="flex flex-wrap items-center gap-2">
                    <Text size="xs" span className="label-display tracking-wider text-muted-foreground">Roster</Text>
                    <span className="rounded border border-border px-1.5 text-[11px] tabular-nums text-muted-foreground"
                        title="A container is as big as its largest member">
                        {def.width} × {def.height}
                    </span>
                    <Text size="xs" span dimmed className="min-w-0 flex-1 truncate">
                        one on screen at a time
                        {scenes.length ? ` · in ${scenes.join(', ')}` : ''}
                    </Text>
                </div>
                {members.length === 0 && (
                    <Text size="xs" dimmed className="px-1.5">Nothing on it yet.</Text>
                )}
                {members.map(el => (
                    <MemberRow
                        key={el.id} element={el} def={def}
                        carrying={placement?.carrying === el.id}
                        setMember={setMember} setOffset={setOffset}
                    />
                ))}
                <AddMember def={def} holders={holders} onAdd={add} />
            </div>

            {needsScope && <ScopeRow def={def} />}

            <AutomationSection def={def} />

            {/* Two-step, the same Popover confirm the Match desk uses on its own
                delete — and this one has the LARGER blast radius: removing a
                definition takes its feed, its resting member and every rule on
                it (`detach`/`dropRules` in ../containers/containers). */}
            <div className={cn(KIT_SECTION, 'flex-row items-center')}>
                <Text size="xs" span dimmed className="flex-1">Deleting keeps the OBS source — remove that in OBS.</Text>
                <Popover open={confirmDel} onOpenChange={setConfirmDel}>
                    <PopoverTrigger asChild>
                        <Button size="xs" variant="ghost" className="text-muted-foreground hover:text-destructive">
                            <Trash2 /> Delete container
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-60">
                        <Stack gap="xs">
                            <Text size="sm" className="text-foreground">Delete “{def.name || def.id}”?</Text>
                            <Text size="xs" className="text-muted-foreground">
                                Clears what it is showing and deletes its rules.
                                The OBS source stays — delete that in OBS.
                            </Text>
                            <Group gap="xs" className="justify-end">
                                <Button size="xs" variant="ghost" onClick={() => setConfirmDel(false)}>Cancel</Button>
                                <Button size="xs" variant="destructive" onClick={() => remove(def.id)}>Delete</Button>
                            </Group>
                        </Stack>
                    </PopoverContent>
                </Popover>
            </div>
        </>
    );
}
