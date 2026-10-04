import { memo, useMemo, useState } from 'react';
import { Group, Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { sizeForMembers, useContainerDefs } from '../containers/containers';
import { MemberPicker } from '../containers/picker';

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
/*
 * The name a new container starts with: `Container {n}`, the lowest n no
 * existing container is already called. Prefilled and selected, so typing
 * replaces it and Create works without touching it — a required field the
 * producer has to notice is a step the screen has to explain.
 */
export function defaultContainerName(defs) {
    const taken = new Set(Object.values(defs || {}).map(d => String(d?.name ?? '').trim().toLowerCase()));
    for (let n = 1; ; n += 1) {
        if (!taken.has(`container ${n}`) && !(`container-${n}` in (defs || {}))) return `Container ${n}`;
    }
}

export const NewContainerForm = memo(function NewContainerForm({ onCreate, onCancel, onPreview, height }) {
    const defs = useContainerDefs();
    const [fallback] = useState(() => defaultContainerName(defs));
    const [name, setName] = useState(fallback);
    const [members, setMembers] = useState([]);
    const size = useMemo(() => sizeForMembers(members), [members]);

    const toggle = (id) => setMembers(prev => (
        prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    ));

    return (
        <div className="flex flex-col gap-3">
            <Input
                autoFocus
                onFocus={(e) => e.target.select()}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={fallback}
                aria-label="Container name"
                className="h-8 max-w-72"
            />

            <MemberPicker selected={members} onToggle={toggle} onPreview={onPreview} height={height} />

            <Group gap="xs" className="sticky bottom-0 items-center border-t border-border/60 bg-background pt-2">
                <Button
                    size="sm"
                    disabled={members.length === 0}
                    onClick={() => onCreate(name.trim() || fallback, members)}
                >
                    Create
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
                {members.length > 0 && (
                    <Text size="xs" span dimmed className="ml-auto tabular-nums">
                        {size.width} × {size.height}
                    </Text>
                )}
            </Group>
        </div>
    );
});
