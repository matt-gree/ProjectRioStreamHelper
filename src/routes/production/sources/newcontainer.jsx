import { memo, useMemo, useState } from 'react';
import { Group, Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { cn } from '../../../lib/utils';
import { CONTAINER_MEMBERS, containerSizeClasses, fitsContainer } from '../containers/containers';

// The Add picker's + New form: define a shared container (name, native size,
// members) and add its source to the scene.

/*
 * Building a container, in the picker that adds it.
 *
 * A container is producer-built config, not a file, so there has to be a place
 * to make one — and the honest place is the transaction that puts it in a
 * scene. The producer names it, picks a SIZE, and ticks the members that fit;
 * the new definition is written and immediately selected, so Add drops the
 * source into the scene they opened this from.
 *
 * SIZE FIRST, because it is the constraint everything else answers to. The
 * sizes are the census of what can go in a container (containerSizeClasses),
 * not invented presets, and the member list is filtered to what fits — a member
 * larger than its container is unrepresentable rather than handled, since there
 * is no scaling system. Smaller members center.
 */
export const NewContainerForm = memo(function NewContainerForm({ onCreate, onCancel }) {
    const classes = useMemo(() => containerSizeClasses(), []);
    const [name, setName] = useState('');
    const [sizeId, setSizeId] = useState(classes[0]?.id ?? null);
    const [members, setMembers] = useState([]);

    const size = classes.find(c => c.id === sizeId) ?? classes[0];
    const candidates = size
        ? CONTAINER_MEMBERS.filter(el => fitsContainer(el, size.width, size.height))
        : [];

    // Members that no longer fit after a size change are dropped rather than
    // carried invisibly — the roster the producer confirms is the one they see.
    const pickSize = (id) => {
        const next = classes.find(c => c.id === id);
        setSizeId(id);
        if (next) {
            setMembers(prev => prev.filter(m => {
                const el = CONTAINER_MEMBERS.find(e => e.id === m);
                return fitsContainer(el, next.width, next.height);
            }));
        }
    };

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
                placeholder="Name it — “Lower Bar”, “Replay Stage”"
                className="h-8"
            />

            <div className="flex flex-col gap-0.5">
                <Text size="xs" dimmed className="px-1">
                    Size — members this size fill it; smaller ones center, never scale.
                </Text>
                {classes.map(c => (
                    <button
                        key={c.id} type="button" onClick={() => pickSize(c.id)}
                        className={cn(
                            'flex items-center gap-2 rounded-md px-2 py-1 text-left',
                            c.id === sizeId ? 'bg-accent text-foreground' : 'hover:bg-accent/50',
                        )}
                    >
                        <span className={cn(
                            'size-2 shrink-0 rounded-full',
                            c.id === sizeId ? 'bg-rio-400' : 'bg-muted-foreground/30',
                        )} />
                        <Text size="xs" span className="tabular-nums">{c.width} × {c.height}</Text>
                        <Text size="xs" span truncate dimmed className="min-w-0 flex-1">
                            {c.members.map(m => m.name).join(', ')}
                        </Text>
                    </button>
                ))}
            </div>

            <div className="flex flex-col gap-0.5">
                <Text size="xs" dimmed className="px-1">
                    Members — one at a time on screen. Anything sharing a container
                    can never be up together, which is what sharing one means.
                </Text>
                {candidates.map(el => (
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
                        <Text size="xs" span dimmed className="tabular-nums">
                            {el.width} × {el.height}
                        </Text>
                    </label>
                ))}
            </div>

            <Group gap="xs" className="px-1 pt-1">
                <Button
                    size="sm"
                    disabled={!name.trim() || !size}
                    onClick={() => onCreate(name.trim(), size, members)}
                >
                    Create
                </Button>
                <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
            </Group>
        </div>
    );
});
