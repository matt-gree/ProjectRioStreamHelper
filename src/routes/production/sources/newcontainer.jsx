import { memo, useMemo, useState } from 'react';
import { Group, Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { CONTAINER_MEMBERS, hostOf, isSharedMember, sizeForMembers, useContainerDefs } from '../containers/containers';

// The Add picker's + New form: name a container, pick what goes on it, and add
// its source to the scene.

/*
 * Building a container, in the picker that adds it.
 *
 * A container is producer-built config, not a file, so there has to be a place
 * to make one — and the honest place is the transaction that puts it in a
 * scene. The producer names it and ticks its members; the new definition is
 * written and immediately selected, so Add drops the source into the scene they
 * opened this from.
 *
 * THERE IS NO SIZE STEP. A container's size is its largest member's
 * (`sizeForMembers`) — PRSH has no scaling, so the size's only job is to hold
 * what is on it — and the form shows the size that roster comes to rather than
 * asking for one. It used to be the first question, with the member list
 * filtered to what fit, which made the decision that matters (what goes on it)
 * answer to the one that follows from it.
 */
export const NewContainerForm = memo(function NewContainerForm({ onCreate, onCancel }) {
    const [name, setName] = useState('');
    const [members, setMembers] = useState([]);
    const defs = useContainerDefs();
    const size = useMemo(() => sizeForMembers(members), [members]);

    const toggle = (id) => setMembers(prev => (
        prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    ));

    return (
        <div className="flex flex-col gap-2 pr-2">
            <Text size="xs" span className="label-display px-1 tracking-wider text-muted-foreground">
                New container
            </Text>

            <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Lower Bar"
                aria-label="Container name"
                className="h-8"
            />

            <div className="flex flex-col gap-0.5">
                <Text size="xs" dimmed className="px-1">
                    Members — one on screen at a time
                </Text>
                {CONTAINER_MEMBERS.map(el => {
                    // Ticking a member another container holds MOVES it here on
                    // Create (unless it is shared), so say so before the tick.
                    const held = isSharedMember(el) ? null : hostOf(defs, el.id);
                    return (
                        <label
                            key={el.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/50"
                        >
                            <input
                                type="checkbox"
                                checked={members.includes(el.id)}
                                onChange={() => toggle(el.id)}
                                className="size-3 shrink-0 accent-current"
                            />
                            <Text size="xs" span truncate className="min-w-0 flex-1">{el.name}</Text>
                            {held && (
                                <Text size="xs" span dimmed className="truncate">
                                    moves from {defs[held]?.name ?? held}
                                </Text>
                            )}
                            <Text size="xs" span dimmed className="tabular-nums">
                                {el.width} × {el.height}
                            </Text>
                        </label>
                    );
                })}
            </div>

            {/* Pinned to the pane's foot: the member list is every hostable element
                and runs past the pane, and Create sat below the fold. */}
            <Group gap="xs" className="sticky bottom-0 items-center border-t border-border/60 bg-background px-1 py-2">
                <Button
                    size="sm"
                    disabled={!name.trim() || members.length === 0}
                    onClick={() => onCreate(name.trim(), members)}
                >
                    Create
                </Button>
                <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
                <Text size="xs" span dimmed className="ml-auto tabular-nums">
                    {members.length ? `${size.width} × ${size.height}` : 'Pick at least one member'}
                </Text>
            </Group>
        </div>
    );
});
