import { useEffect, useMemo } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../context/store';
import { useParticipantsStore } from '../../context/participants';
import {
    addSlot, removeSlot, moveSlot, updateSlot,
    SUBFIELD_OPTIONS, MAX_COMMENTATORS,
} from '../../context/commentary';
import ParticipantPicker from '../../components/ParticipantPicker';
import { SimpleSelect } from '../../components/ui/simple-select';
import { Button } from '../../components/ui/button';
import { Switch } from '../../components/ui/switch';
import { Panel } from '../../components/ui/panel';
import { Stack, Group, Text, Title } from '../../components/ui/primitives';

/*
 * Commentary — the in-depth authoring surface for the registry-bound caster desk
 * (Phase 4). Each commentator slot references a person in the address book (the
 * participant registry); the producer also picks which address-book field shows
 * on that caster's sub-plate. Slots are an ordered list (max 4) with reorder +
 * add/remove. The data lives in `commentary.*` in State (its OWN object, separate
 * from match/score); a server-side projector resolves each slot against the
 * registry and writes the keys the overlay reads (resolve-by-copy). The Production
 * tab gets a condensed version of these controls.
 */

function SlotCard({ index, slot, count, row }) {
    const name = row ? (row.display?.tag || row.identities?.rioName || '') : '';

    return (
        <Panel
            glow={false}
            title={`Commentator ${index + 1}`}
            actions={(
                <Group gap="xs" wrap={false}>
                    <Button
                        variant="ghost" size="icon-sm"
                        disabled={index === 0}
                        onClick={() => moveSlot(index, -1)}
                        title="Move up"
                    >
                        <ArrowUp size={15} />
                    </Button>
                    <Button
                        variant="ghost" size="icon-sm"
                        disabled={index === count - 1}
                        onClick={() => moveSlot(index, 1)}
                        title="Move down"
                    >
                        <ArrowDown size={15} />
                    </Button>
                    <Button
                        variant="ghost" size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeSlot(index)}
                        title="Remove commentator"
                    >
                        <Trash2 size={15} />
                    </Button>
                </Group>
            )}
        >
            <div className="grid grid-cols-1 gap-3 p-3.5 sm:grid-cols-2">
                <Stack gap="xs">
                    <Text size="xs" dimmed span>Person</Text>
                    <ParticipantPicker
                        value={name}
                        selectedId={slot.participantId || null}
                        onResolve={(picked) => updateSlot(index, { participantId: picked.id })}
                        placeholder="Pick from address book…"
                    />
                </Stack>
                <Stack gap="xs">
                    <Text size="xs" dimmed span>Sub-plate field</Text>
                    <SimpleSelect
                        placeholder="None"
                        data={SUBFIELD_OPTIONS}
                        value={slot.subField || undefined}
                        onChange={(v) => updateSlot(index, { subField: v })}
                    />
                </Stack>
                <label className="flex items-center justify-between gap-3">
                    <Text size="sm">Show on overlay</Text>
                    <Switch
                        checked={slot.visible !== false}
                        onCheckedChange={(v) => updateSlot(index, { visible: v })}
                    />
                </label>
                <label className="flex items-center justify-between gap-3">
                    <Text size="sm">Show sub-plate</Text>
                    <Switch
                        checked={slot.subVisible !== false}
                        onCheckedChange={(v) => updateSlot(index, { subVisible: v })}
                    />
                </label>
            </div>
        </Panel>
    );
}

export default function Commentary() {
    const slots = useStateStore((s) => s.commentary?.slots);
    const list = Array.isArray(slots) ? slots : [];

    const { participants, load } = useParticipantsStore(useShallow((s) => ({
        participants: s.participants,
        load: s.load,
    })));
    useEffect(() => { load(); }, [load]);

    const byId = useMemo(() => {
        const m = {};
        for (const p of participants) m[p.id] = p;
        return m;
    }, [participants]);

    return (
        <Stack gap="md">
            <Group justify="space-between">
                <Title order={3}>Commentary</Title>
                <Button
                    size="sm" variant="outline"
                    disabled={list.length >= MAX_COMMENTATORS}
                    onClick={addSlot}
                >
                    <Plus size={14} /> Add commentator
                </Button>
            </Group>

            {list.length === 0 ? (
                <Text size="sm" dimmed>
                    No commentators yet. Add one and pick a person from the address book.
                </Text>
            ) : (
                <Stack gap="md">
                    {list.map((slot, i) => (
                        <SlotCard
                            key={i}
                            index={i}
                            slot={slot}
                            count={list.length}
                            row={slot.participantId ? byId[slot.participantId] : null}
                        />
                    ))}
                </Stack>
            )}
        </Stack>
    );
}
