import { memo, useMemo } from 'react';
import { Captions, Eye, EyeOff, Plus, X } from 'lucide-react';
import { useStateStore } from '../../../context/store';
import { stageOrRun, usePending } from '../../../context/staging';
import { setCommentarySlots, SUBFIELD_OPTIONS, MAX_COMMENTATORS } from '../../../context/commentary';
import ParticipantPicker from '../../../components/ParticipantPicker';
import { Group, Text } from '../../../components/ui/primitives';
import { cn } from '../../../lib/utils';
import { ActionRow, IconToggle, KIT_INPUT, ListRow } from '../kit';
import { StagedDot, MoveButtons } from '../controls';
import { DirectStage } from './generic';

/*
 * Commentary desk stage — ONE row per caster: move ▲/▼ (reorder) · on-air eye
 * · person picker · sub-plate field · sub-plate toggle · remove. This is the
 * ONLY place the desk is authored: a standalone Commentary tab used to carry
 * the same six controls in a taller form and was removed as pure duplication.
 * Each caster is a person in the address book, so the identity fields (real
 * name, socials, pronouns) are edited on Address Book, not here. Reorder is
 * buttons, not drag, so it works from a phone at the venue (see MoveButtons).
 */

const blankCasterSlot = () => ({ participantId: null, subField: '', visible: true, subVisible: true });

// The desk as the console works with it: the staged draft slots array when one
// is pending, else the live authored slots. Every edit computes the whole next
// array and stages ONE entry (key 'commentary') whose commit is the whole-array
// PUT — matching the server API, and keeping add/remove/reorder/edit trivially
// stageable. `_name` is a client-only display tag for staged picks (the
// projector hasn't resolved them yet) and is stripped before the PUT.
function useCommentaryDesk() {
    const commentary = useStateStore(s => s.commentary);
    const liveSlots = useMemo(
        () => (Array.isArray(commentary?.slots) ? commentary.slots : []),
        [commentary],
    );
    const pending = usePending('commentary');
    const slots = pending ? pending.value : liveSlots;

    // participantId → resolved display name, from the server-side projection of
    // the LIVE slots (staged drafts may be reordered, so index lookups lie).
    const nameById = useMemo(() => {
        const out = {};
        liveSlots.forEach((s, i) => {
            const n = commentary?.[i]?.name ?? commentary?.[String(i)]?.name;
            if (s?.participantId && n) out[s.participantId] = n;
        });
        return out;
    }, [commentary, liveSlots]);
    const nameFor = (slot) => slot?._name || (slot?.participantId && nameById[slot.participantId]) || '';

    const setSlots = (next) => stageOrRun({
        key: 'commentary',
        label: 'Commentary desk',
        value: next,
        run: () => setCommentarySlots(next.map(({ _name, ...s }) => s)),
    });

    return {
        slots, staged: !!pending, nameFor,
        update: (i, patch) => setSlots(slots.map((s, j) => (j === i ? { ...s, ...patch } : s))),
        add: () => { if (slots.length < MAX_COMMENTATORS) setSlots([...slots, blankCasterSlot()]); },
        remove: (i) => setSlots(slots.filter((_, j) => j !== i)),
        reorder: (from, to) => {
            if (from === to || from < 0 || to < 0 || from >= slots.length || to >= slots.length) return;
            const next = slots.slice();
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            setSlots(next);
        },
    };
}

// One caster as a kit list row: reorder + eye lead, the person picker in the
// name slot (it's editable, so it takes a node), sub-plate field and the
// sub/remove toggles trailing.
const CasterRow = memo(function CasterRow({ i, slot, desk }) {
    const visible = slot.visible !== false;
    const subVisible = slot.subVisible !== false;
    return (
        <ListRow
            lead={
                <>
                    <MoveButtons
                        label={`caster ${i + 1}`}
                        canUp={i > 0} canDown={i < desk.slots.length - 1}
                        onUp={() => desk.reorder(i, i - 1)}
                        onDown={() => desk.reorder(i, i + 1)}
                    />
                    <IconToggle
                        icon={Eye} offIcon={EyeOff} on={visible} tone="plain"
                        label={visible ? 'On air — click to hide' : 'Hidden — click to show'}
                        onClick={() => desk.update(i, { visible: !visible })}
                    />
                </>
            }
            name={
                <div className={cn('min-w-0 flex-1', !visible && 'opacity-50')}>
                    <ParticipantPicker
                        value={desk.nameFor(slot)}
                        selectedId={slot.participantId || null}
                        onResolve={(picked) => desk.update(i, {
                            participantId: picked.id,
                            _name: picked.display?.tag || picked.identities?.rioName || '',
                        })}
                        placeholder="Pick person…"
                    />
                </div>
            }
            controls={
                <>
                    <select
                        value={slot.subField || ''}
                        onChange={(e) => desk.update(i, { subField: e.target.value })}
                        title="Sub-plate field"
                        className={cn(KIT_INPUT, 'w-[88px] shrink-0')}
                    >
                        <option value="">No sub</option>
                        {SUBFIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <IconToggle
                        icon={Captions} on={subVisible} disabled={!slot.subField}
                        label={subVisible ? 'Sub-plate shown' : 'Sub-plate hidden'}
                        onClick={() => desk.update(i, { subVisible: !subVisible })}
                    />
                    <IconToggle
                        icon={X} tone="danger" label="Remove commentator"
                        onClick={() => desk.remove(i)}
                    />
                </>
            }
        />
    );
});

export default function CommentaryStage({ element, placement }) {
    const desk = useCommentaryDesk();

    return (
        <>
            <DirectStage element={element} placement={placement} />
            {desk.staged && (
                <Group gap="xs" className="items-center">
                    <StagedDot show />
                    <Text size="xs" className="text-amber-400">Desk changes staged</Text>
                </Group>
            )}
            {desk.slots.length === 0 && (
                <Text size="xs" className="text-muted-foreground">No commentators yet — add one below.</Text>
            )}

            {desk.slots.map((slot, i) => <CasterRow key={i} i={i} slot={slot} desk={desk} />)}

            <ActionRow actions={[{
                label: 'Add commentator', icon: Plus,
                disabled: desk.slots.length >= MAX_COMMENTATORS,
                onClick: desk.add,
            }]} />
        </>
    );
}
