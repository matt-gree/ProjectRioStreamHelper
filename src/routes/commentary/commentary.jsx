import { useCallback } from 'react';
import { Panel } from '../../components/ui/panel';
import { TextField } from '../../components/ui/text-field';
import { Stack, Title } from '../../components/ui/primitives';
import { useStateStore } from '../../context/store';

/**
 * A single commentator slot.
 */
function CommentatorSlot({ index }) {
    const basePath = `commentary.${index}`;
    const setItem = useStateStore(s => s.setItem);

    const name    = useStateStore(s => s?.commentary?.[index]?.name ?? '');
    const twitter = useStateStore(s => s?.commentary?.[index]?.twitter ?? '');
    const pronoun = useStateStore(s => s?.commentary?.[index]?.pronoun ?? '');
    const realName = useStateStore(s => s?.commentary?.[index]?.real_name ?? '');

    const set = useCallback((field, value) => {
        setItem(`${basePath}.${field}`, value);
    }, [basePath, setItem]);

    return (
        <Panel glow={false} title={`Commentator ${index + 1}`}>
            <div className="grid grid-cols-1 gap-3 p-3.5 sm:grid-cols-2 lg:grid-cols-4">
                <TextField
                    label="Name"
                    placeholder="Tag"
                    value={name}
                    onChange={e => set('name', e.currentTarget.value)}
                />
                <TextField
                    label="Real Name"
                    placeholder="Full name"
                    value={realName}
                    onChange={e => set('real_name', e.currentTarget.value)}
                />
                <TextField
                    label="Twitter"
                    placeholder="@handle"
                    value={twitter}
                    onChange={e => set('twitter', e.currentTarget.value)}
                />
                <TextField
                    label="Pronoun"
                    placeholder="He/Him"
                    value={pronoun}
                    onChange={e => set('pronoun', e.currentTarget.value)}
                />
            </div>
        </Panel>
    );
}

export default function Commentary() {
    // Fixed 4 commentator slots (matching original PyQt version)
    const slots = [0, 1, 2, 3];

    return (
        <Stack gap="md">
            <Title order={3}>Commentary</Title>
            {slots.map(i => (
                <CommentatorSlot key={i} index={i} />
            ))}
        </Stack>
    );
}
