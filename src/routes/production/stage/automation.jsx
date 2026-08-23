import { memo, useMemo } from 'react';
import { Plus, Power, Trash2 } from 'lucide-react';
import { Text } from '../../../components/ui/primitives';
import { IconToggle, ListRow, NumberRow, SegmentedRow, SelectRow } from '../kit';
import { useActiveBoards, useBoardLabel } from '../boards';
import { useContainerActions } from '../containers';
import { useSideLabels } from '../sides';
import {
    REASONS, memberName, templatesFor, useAutomationActions, useContainerAutomations,
    useFeedReason,
} from '../automations';

/*
 * A container's automation panel — where a container is taught to feed itself.
 *
 * Three things, in the order a producer decides them:
 *
 *   1. FRAME OF REFERENCE. Which board and side this container is about. It
 *      resolves `{sb}` in a rule's trigger and picks the side of the content the
 *      engine feeds, which is the whole mechanism behind a mirrored pair: two
 *      containers running one canned rule, one showing the batter and the other
 *      the pitcher.
 *   2. RESTING. What this container shows when nothing else is up — the state a
 *      dwell returns to. Empty is a real answer, and the default.
 *   3. RULES, added from the quick-add library. A rule is read-only except for
 *      its switch and its dwell: the trigger and the guard are what make a
 *      canned entry known-good, and a free-text state key is a way to write an
 *      automation that silently never fires.
 *
 * The engine is server-side and in the state-write path (server/automations.py),
 * so its feed write lands in the same batch as the HUD change that triggered it.
 * Nothing here polls, and nothing here decides.
 */

// The deciding tier, straight off the engine's mirror
// (`production.feed.reason.{id}`). Same instinct as the rack's side_reason line:
// say WHY something is up rather than leaving it to be inferred from what moved.
const ReasonLine = memo(function ReasonLine({ container }) {
    const reason = useFeedReason(container);
    const meta = REASONS[reason];
    if (!meta) return null;
    return (
        <Text size="xs" className={reason === 'manual' ? 'text-amber-500/90' : 'text-muted-foreground'}>
            {meta.label} — {meta.hint}
        </Text>
    );
});

const RuleRow = memo(function RuleRow({ rule, update, remove }) {
    const t = rule.template;
    return (
        <ListRow
            dot={rule.enabled ? 'bg-emerald-400' : 'bg-foreground/30'}
            name={rule.name}
            meta={`${rule.dwell}s`}
            defaultExpanded={false}
            controls={(
                <>
                    <IconToggle
                        icon={Power} on={rule.enabled}
                        label={rule.enabled ? 'Suspend this automation' : 'Enable this automation'}
                        onClick={() => update(rule.id, { enabled: !rule.enabled })}
                    />
                    <IconToggle
                        icon={Trash2} tone="danger" label="Remove this automation"
                        onClick={() => remove(rule.id)}
                    />
                </>
            )}
        >
            <Text size="xs" className="text-muted-foreground">
                When {t?.triggerLabel || rule.trigger} and {t?.guardLabel || 'the content resolves'},
                show {memberName(rule.member)}.
            </Text>
            <NumberRow
                label="Dwell" value={rule.dwell} min={1} max={60} step={1} suffix="seconds"
                onChange={(v) => update(rule.id, { dwell: Number(v) || 1 })}
            />
        </ListRow>
    );
});

export default memo(function AutomationSection({ def }) {
    const { setResting, setScope } = useContainerActions();
    const { add, update, remove } = useAutomationActions();
    const rules = useContainerAutomations(def.id);
    const boards = useActiveBoards();
    const boardLabel = useBoardLabel();

    // Only what this container's roster can support — a rule that feeds a
    // non-member is inert by design, so it is never offered.
    const available = useMemo(() => {
        const taken = new Set(rules.map(r => r.template?.id).filter(Boolean));
        return templatesFor(def).filter(t => !taken.has(t.id));
    }, [def, rules]);

    const sides = useSideLabels();

    const restingOptions = useMemo(() => [
        { label: 'Empty — transparent', value: '' },
        ...(def.members || []).map(m => ({ label: memberName(m), value: m })),
    ], [def.members]);

    return (
        <div className="mt-1 flex flex-col gap-1 border-t border-border/60 pt-2">
            <Text size="xs" className="text-muted-foreground">
                Automation — this container feeding itself off the game.
            </Text>
            <ReasonLine container={def.id} />

            <SelectRow
                label="Board" value={String(def.scoreboard)}
                options={boards.map(b => ({ label: boardLabel(b), value: String(b) }))}
                onChange={(v) => setScope(def.id, v, def.team)}
            />
            <SegmentedRow
                label="Side" value={String(def.team)}
                data={[
                    { label: sides.label(1), value: '1' },
                    { label: sides.label(2), value: '2' },
                ]}
                onChange={(v) => setScope(def.id, def.scoreboard, v)}
            />
            <SelectRow
                label="Resting" value={def.resting || ''} options={restingOptions}
                onChange={(v) => setResting(def.id, v || null)}
            />

            {rules.map(rule => (
                <RuleRow key={rule.id} rule={rule} update={update} remove={remove} />
            ))}

            {available.map(t => (
                <ListRow
                    key={t.id}
                    name={t.name}
                    meta={t.blurb}
                    controls={(
                        <IconToggle
                            icon={Plus} on={false} tone="plain"
                            label={`Add “${t.name}” to this container`}
                            onClick={() => add(t.id, def.id)}
                        />
                    )}
                />
            ))}

            {rules.length === 0 && available.length === 0 && (
                <Text size="xs" className="text-muted-foreground">
                    No automation fits this roster yet. Each canned rule drives one
                    member — put that member on the container above and its rule
                    appears here.
                </Text>
            )}
        </div>
    );
});
