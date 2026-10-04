import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Group, Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { notifications } from '../../../lib/notify';
import { cn } from '../../../lib/utils';
import { KIT_INPUT, NumberField } from '../kit';
import { useActiveBoards, useBoardLabel } from '../board/boards';
import { useSideLabels } from '../sides';
import AutomationSection from '../stage/automation';
import {
    CONTAINER_MEMBERS, growContainerSources, sizeForMembers, useCarrying, useContainerActions,
} from './containers';
import { subjectKind, useContainerAutomations } from './automations';
import { MemberPicker, PreviewFrame } from './picker';
import { settingsTypeOf } from '../elements';
import { useLooks } from '../stage/look';

/*
 * A container, open on the Containers tab — where it is BUILT.
 *
 * THE PREVIEW IS THE PANEL'S SUBJECT. A container is a picture before it is a
 * definition, so the largest thing here is the container itself, drawing the
 * member you have selected at the place it sits, on sample data. The roster
 * beside it is how you choose what the preview shows; selecting a member is
 * also what its position controls act on, so they appear only for it rather
 * than as a column of anchors and nudges on every row.
 *
 * NO EXPLANATORY PROSE. What each part means is shown, not told: the preview
 * says what a member looks like in here, amber says what a pick will move or
 * grow, and the size is on the section header. Precedence for the rules lives in
 * the Rules heading's tooltip.
 *
 * Edit swaps the panel for the same picker a new container is built with —
 * list and preview, the current members ticked — rather than a popover of
 * names; it is the one place members come on and off. The editor sits the
 * same way round (controls left, preview right), and the caller's `footer`
 * (scenes, Copy URL, Delete) stands down while editing, so the picker is the
 * whole panel.
 *
 * MEMBERS ARE MUTUALLY EXCLUSIVE, and that is the definition rather than
 * advice: `production.feed.container.{id}` holds exactly one occupant. Adding an
 * element another container holds MOVES it — except a container-SCOPED member,
 * which is added, so a mirrored pair is buildable. THE SIZE FOLLOWS THE ROSTER,
 * UP: adding a bigger member grows the container and resizes its OBS sources at
 * their scale; taking one off never shrinks it.
 */
export function ContainerEditor({ def, footer = null, previewHeight = 280 }) {
    const [editing, setEditing] = useState(false);
    const carrying = useCarrying(def.id);
    const members = useMemo(() => membersOf(def), [def]);
    const [focusId, setFocusId] = useState(null);
    // The selected member: a pick that is still on the roster, else what the
    // container carries, else the first member.
    const focus = members.find(el => el.id === focusId)
        ?? members.find(el => el.id === carrying) ?? members[0] ?? null;

    if (editing) {
        return (
            <EditMembers
                def={def} height={previewHeight}
                onDone={(added) => { setEditing(false); if (added?.length) setFocusId(added[added.length - 1]); }}
            />
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Controls left, preview right — the same sides as the add picker,
                so switching between the two moves nothing the eye is on. */}
            <div className="grid grid-cols-[minmax(0,19rem)_minmax(0,1fr)] items-start gap-4">
                <div className="flex min-w-0 flex-col gap-3">
                    <MemberList
                        members={members} focus={focus} carrying={carrying}
                        onFocus={setFocusId} onEdit={() => setEditing(true)}
                    />
                    {focus && <PositionRow def={def} element={focus} />}
                    {focus && <MemberLookRow def={def} element={focus} />}
                    <ScopeRow def={def} />
                </div>
                <ContainerPreview def={def} focus={focus} h={previewHeight} />
            </div>
            <AutomationSection def={def} />
            {footer}
        </div>
    );
}

const membersOf = def => (def.members || [])
    .map(m => CONTAINER_MEMBERS.find(el => el.id === m))
    .filter(Boolean);

// Small caps over a group of controls — the only words in the panel that are
// not data.
function Eyebrow({ children, title }) {
    return (
        <Text size="xs" span title={title} className="label-display text-[10px] tracking-wider text-muted-foreground">
            {children}
        </Text>
    );
}

/*
 * The container itself, drawing the selected member where it sits. Reloaded
 * when the geometry changes, because the shell reads the definition once at
 * load — so a nudge shows the moment it is made.
 */
const ContainerPreview = memo(function ContainerPreview({ def, focus, h }) {
    const at = focus ? def.offsets?.[focus.id] : null;
    const v = [def.width, def.height, at?.anchor, at?.x, at?.y].join('.');
    const src = focus
        ? `/layout/shared/container.html?container=${encodeURIComponent(def.id)}&preview=1&sample=1`
            + `&feed=${encodeURIComponent(focus.id)}&v=${encodeURIComponent(v)}`
        : null;
    return (
        <PreviewFrame
            src={src} width={def.width} height={def.height} h={h}
            title={`${def.name} preview`} empty="No members yet"
        />
    );
});

const MemberList = memo(function MemberList({ members, focus, carrying, onFocus, onEdit }) {
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
                <Eyebrow>Members</Eyebrow>
                <Button size="xs" variant="ghost" className="h-6" onClick={onEdit}><Pencil /> Edit</Button>
            </div>
            <div role="listbox" aria-label="Members" className="flex flex-col">
                {members.map(el => (
                    <div
                        key={el.id} role="option" aria-selected={focus?.id === el.id} tabIndex={0}
                        data-member={el.id}
                        onClick={() => onFocus(el.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFocus(el.id); } }}
                        className={cn(
                            'group flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 outline-none',
                            'hover:bg-accent/40 focus-visible:ring-1 focus-visible:ring-ring',
                            focus?.id === el.id && 'bg-accent/60',
                        )}
                    >
                        <span
                            className={cn('size-1.5 shrink-0 rounded-full', carrying === el.id ? 'bg-emerald-400' : 'bg-foreground/20')}
                            title={carrying === el.id ? 'On the container now' : undefined}
                        />
                        <Text size="xs" span truncate className="min-w-0 flex-1 text-foreground">{el.name}</Text>
                        <Text size="xs" span dimmed className="shrink-0 tabular-nums">{el.width} × {el.height}</Text>
                    </div>
                ))}
            </div>
        </div>
    );
});

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

/*
 * Where the SELECTED member sits. Only for a member smaller than the container
 * — one that fills it has nowhere to go. The anchor carries the intent ("on the
 * floor" stays on the floor whatever the container grows to); the nudge is
 * pixels on top of it.
 */
const PositionRow = memo(function PositionRow({ def, element }) {
    const { setOffset } = useContainerActions();
    if (!(element.width < def.width || element.height < def.height)) return null;
    const cur = def.offsets?.[element.id] || { anchor: 'center', x: 0, y: 0 };
    const write = patch => setOffset(def.id, element.id, { ...cur, ...patch });
    return (
        <div className="flex flex-col gap-1">
            <Eyebrow>Position</Eyebrow>
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
        </div>
    );
});

/*
 * Which LOOK the selected member wears in this container (stage/look). Only
 * when the element has a look to choose: looks are made on the console, on the
 * element's own panel, and a menu holding only "Main" is not a choice.
 */
const MemberLookRow = memo(function MemberLookRow({ def, element }) {
    const looks = useLooks(settingsTypeOf(element));
    const { setMemberLook } = useContainerActions();
    if (!looks.length) return null;
    const cur = looks.find(l => l.id === def.looks?.[element.id])?.id ?? '';
    return (
        <div className="flex flex-col gap-1">
            <Eyebrow>Look</Eyebrow>
            <select
                aria-label={`${element.name} look`} value={cur}
                onChange={e => setMemberLook(def.id, element.id, e.target.value || null)}
                className={cn(KIT_INPUT, 'w-40')}
            >
                <option value="">Main</option>
                {looks.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
        </div>
    );
});

const SIDE_RULE = r => r.by === 'scope' || r.subject === 'scope' || r.state === 'side_batting' || r.state === 'side_pitching';

/*
 * SCOPE — whose game this container is about. Only when something on it reads
 * one: a member that follows a side, or a rule that names this container's
 * side. A full-canvas callout stage has no side, and a Board/Side pair on it
 * would be two controls that do nothing.
 */
const ScopeRow = memo(function ScopeRow({ def }) {
    const { setScope } = useContainerActions();
    const rules = useContainerAutomations(def.id);
    const boards = useActiveBoards();
    const boardLabel = useBoardLabel();
    const sides = useSideLabels();
    if (!(def.members.some(m => subjectKind(m)) || rules.some(SIDE_RULE))) return null;
    return (
        <div className="flex flex-col gap-1">
            <Eyebrow title="Whose batter, pitcher and roster this container shows">Scope</Eyebrow>
            <div className="flex items-center gap-1">
                <select
                    aria-label="Board" value={String(def.scoreboard)}
                    onChange={e => setScope(def.id, e.target.value, def.team)}
                    className={cn(KIT_INPUT, 'min-w-0 flex-1')}
                >
                    {boards.map(b => <option key={b} value={String(b)}>{boardLabel(b)}</option>)}
                </select>
                <div role="radiogroup" aria-label="Side" className="flex shrink-0 overflow-hidden rounded-md border border-border">
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
            </div>
        </div>
    );
});

/*
 * EDITING THE ROSTER: the same picker a container is built with, the current
 * members already ticked — tick to add, untick to take off, Save once.
 *
 * Every consequence is on screen before the press, so there is nothing to
 * confirm: a pick bigger than the container shows its size in amber and the
 * size it grows to sits beside Save (it never shrinks — that would move what
 * the other members draw); unticking a member that rules drive says how many
 * rules go with it, because a rule whose member has left is deleted
 * (`detach`/`dropRules` in ./containers).
 */
const EditMembers = memo(function EditMembers({ def, height, onDone }) {
    const { setMember } = useContainerActions();
    const rules = useContainerAutomations(def.id);
    const [picks, setPicks] = useState(def.members);
    const toggle = useCallback(id => setPicks(prev => (
        prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    )), []);
    const added = picks.filter(id => !def.members.includes(id));
    const removed = def.members.filter(id => !picks.includes(id));
    const changed = added.length > 0 || removed.length > 0;
    const after = sizeForMembers(picks);
    const grows = after.width > def.width || after.height > def.height;
    const to = { width: Math.max(def.width, after.width), height: Math.max(def.height, after.height) };
    const lostRules = rules.filter(r => removed.includes(r.member)).length;

    // Escape backs out, the way closing a popover would.
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onDone([]); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onDone]);

    const save = async () => {
        for (const id of removed) setMember(def.id, id, false);
        for (const id of added) setMember(def.id, id, true);
        onDone(added);
        if (!grows) return;
        try {
            const n = await growContainerSources(def.id, to.width, to.height);
            notifications.show({
                color: 'green',
                message: `Grew to ${to.width} × ${to.height}`
                    + (n ? ` and resized ${n === 1 ? 'its OBS source' : `${n} OBS sources`}` : ''),
            });
        } catch (e) {
            notifications.show({ color: 'red', message: `Grew the container, but OBS refused: ${e.message}` });
        }
    };

    return (
        <div className="flex flex-col gap-3">
            <MemberPicker selected={picks} onToggle={toggle} target={def} height={height} />
            <Group gap="xs" className="items-center border-t border-border/60 pt-2">
                <Button size="sm" disabled={!changed} onClick={save}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => onDone([])}>Cancel</Button>
                <span className="ml-auto flex items-center gap-3">
                    {lostRules > 0 && (
                        <Text size="xs" span className="text-amber-400/90"
                            title="Rules that show a member are deleted when it comes off the container">
                            {lostRules === 1 ? '1 rule removed' : `${lostRules} rules removed`}
                        </Text>
                    )}
                    {grows && (
                        <Text
                            size="xs" span className="tabular-nums text-amber-400/90"
                            title="The container grows to hold this, and its OBS sources resize at the scale they draw at"
                        >
                            {def.width} × {def.height} → {to.width} × {to.height}
                        </Text>
                    )}
                </span>
            </Group>
        </div>
    );
});
