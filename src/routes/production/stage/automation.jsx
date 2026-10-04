import { memo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Power, Trash2 } from 'lucide-react';
import { Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover';
import { cn } from '../../../lib/utils';
import { IconToggle, KIT_INPUT, KIT_NUMBER, KIT_SECTION } from '../kit';
import { useContainerActions } from '../containers/containers';
import {
    OPS, byOptions, conditionFields, conditionLabel, eventOptions, label, memberName,
    onceOptions, ruleProblem, stateOptions, subjectOptions, untilLabel, untilOptions,
    useAutomationActions, useContainerAutomations, EVENTS,
} from '../containers/automations';

/*
 * A container's rules — where a container is taught to feed itself.
 *
 * EACH RULE IS ONE LINE OF TEXT, and every underlined word in it is a menu:
 *
 *   When  a new batter steps up by either side + if → show Stat Card of the batter for 8 s · every time
 *   While the game is final → show Game Summary
 *   Otherwise show Roster
 *
 * A form per rule (a labelled row per knob) was drawn first and came out ~110px
 * a rule; the sentence is one 28px line on a stage panel and only wraps on a
 * narrow one. The row never EXPANDS to edit — a word opens its own small menu
 * where it is, so editing one knob never pushes the rest of the panel down.
 *
 * The words come from the shared vocabulary (automation-vocab.json), which the
 * engine implements id by id: a menu here can only offer what can fire.
 *
 * When rules are listed above While rules because that is the order the engine
 * reads them in — a moment interrupts, and hands back to whatever the states
 * (and finally Otherwise) say. Order within each kind is the producer's: the
 * first moment that matches wins, the top state that holds wins.
 */

const TOKEN = 'cursor-pointer whitespace-nowrap border-b border-dashed border-foreground/35 '
    + 'text-foreground outline-none hover:border-rio-400 hover:text-rio-200 '
    + 'focus-visible:border-rio-400 data-[state=open]:border-rio-400 data-[state=open]:text-rio-200';
const WARN = 'border-amber-500/70 text-amber-400';

// One word of the sentence, and the menu it opens.
const Token = memo(function Token({ value, options, onChange, children, problem, extra }) {
    const [open, setOpen] = useState(false);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button type="button" title={problem || undefined} className={cn(TOKEN, problem && WARN)}>
                    {children}
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto min-w-44 p-1">
                {extra?.(() => setOpen(false))}
                <div role="listbox" className="flex flex-col">
                    {options.map(o => (
                        <button
                            key={String(o.value)} type="button" role="option"
                            aria-selected={o.value === value}
                            onClick={() => { onChange(o.value); setOpen(false); }}
                            className={cn(
                                'rounded px-2 py-1 text-left text-xs hover:bg-accent focus-visible:bg-accent outline-none',
                                o.value === value && 'bg-accent/60 text-foreground',
                            )}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
});

// The seconds field at the top of the duration menu: the presets cover the
// usual, and this covers everything else without a second control on the row.
function SecondsField({ value, onCommit }) {
    const [text, setText] = useState(typeof value === 'number' ? String(value) : '');
    const commit = () => {
        const n = Number(text);
        if (n > 0) onCommit(Math.min(n, 600));
    };
    return (
        <div className="mb-1 flex items-center gap-1 border-b border-border/60 px-1 pb-1">
            <input
                type="number" min={1} max={600} value={text} placeholder="Seconds"
                aria-label="Seconds"
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commit(); }}
                className={cn(KIT_INPUT, KIT_NUMBER, 'w-20')}
            />
            <Button size="xs" variant="ghost" onClick={commit}>Set</Button>
        </div>
    );
}

// "+ if" and each "if inning ≥ 7" chip: a three-part editor in one popover.
const ConditionEditor = memo(function ConditionEditor({ condition, onSave, onRemove, children }) {
    const [open, setOpen] = useState(false);
    const fields = conditionFields();
    const [draft, setDraft] = useState(condition || { field: fields[0].value, op: '>=', value: 1 });
    const save = () => {
        onSave({ ...draft, value: Number(draft.value) || 0 });
        setOpen(false);
    };
    return (
        <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setDraft(condition || draft); }}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-2">
                <div className="flex items-center gap-1">
                    <Text size="xs" span dimmed>only if</Text>
                    <select
                        aria-label="What to check" value={draft.field}
                        onChange={e => setDraft({ ...draft, field: e.target.value })}
                        className={cn(KIT_INPUT, 'w-auto')}
                    >
                        {fields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <select
                        aria-label="Comparison" value={draft.op}
                        onChange={e => setDraft({ ...draft, op: e.target.value })}
                        className={cn(KIT_INPUT, 'w-14')}
                    >
                        {OPS.map(op => <option key={op} value={op}>{op === '>=' ? '≥' : op === '<=' ? '≤' : '='}</option>)}
                    </select>
                    <input
                        type="number" aria-label="Value" value={draft.value}
                        onChange={e => setDraft({ ...draft, value: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') save(); }}
                        className={cn(KIT_INPUT, KIT_NUMBER, 'w-14')}
                    />
                    <Button size="xs" onClick={save}>Done</Button>
                    {onRemove && (
                        <Button size="xs" variant="ghost" onClick={() => { onRemove(); setOpen(false); }}>Remove</Button>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
});

const RuleRow = memo(function RuleRow({ rule, def, first, last, actions }) {
    const { update, remove, move } = actions;
    const set = patch => update(rule.id, patch);
    const problem = ruleProblem(rule, def);
    const memberOptions = (def.members || []).map(m => ({ value: m, label: memberName(m) }));
    const subjects = subjectOptions(rule);
    const subject = subjects.find(s => s.value === rule.subject) ?? subjects[0];
    const when = rule.kind === 'when';

    // Picking a member whose content is a different KIND of thing (a player vs
    // a side vs nothing) re-seats the subject, so the rule never carries an
    // "of" its member cannot answer.
    const setMember = (member) => {
        const next = subjectOptions({ ...rule, member });
        set({ member, subject: next.some(s => s.value === rule.subject) ? rule.subject : 'scope' });
    };
    const setEvent = (event) => {
        const sided = !!EVENTS[event]?.sided;
        set({ event, ...(rule.subject === 'event' && !sided ? { subject: 'scope' } : {}) });
    };

    return (
        <div className={cn('group flex items-start gap-2 rounded-md px-1.5 py-0.5 hover:bg-accent/40',
            !rule.enabled && 'opacity-50')}>
            <span className={cn('w-[4.75rem] shrink-0 pt-1 text-[11px] font-semibold uppercase tracking-wider',
                when ? 'text-sky-400' : 'text-emerald-400')}>
                {when ? 'When' : 'While'}
            </span>
            <div className="min-w-0 flex-1 text-xs leading-7 text-muted-foreground">
                {when ? (
                    <>
                        <Token value={rule.event} options={eventOptions()} onChange={setEvent}>
                            {label.event(rule.event)}
                        </Token>
                        {EVENTS[rule.event]?.sided && (
                            <>{' by '}
                                <Token value={rule.by} options={byOptions()} onChange={by => set({ by })}>
                                    {label.by(rule.by)}
                                </Token>
                            </>
                        )}
                        {rule.conditions.map((c, i) => (
                            <span key={i}>{' '}
                                <ConditionEditor
                                    condition={c}
                                    onSave={nc => set({ conditions: rule.conditions.map((x, j) => (j === i ? nc : x)) })}
                                    onRemove={() => set({ conditions: rule.conditions.filter((_, j) => j !== i) })}
                                >
                                    <button type="button" className="whitespace-nowrap rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground hover:border-rio-400">
                                        if {conditionLabel(c)}
                                    </button>
                                </ConditionEditor>
                            </span>
                        ))}
                        {' '}
                        <ConditionEditor onSave={nc => set({ conditions: [...rule.conditions, nc] })}>
                            <button type="button" className="whitespace-nowrap text-[11px] text-muted-foreground/70 hover:text-rio-200">+ if</button>
                        </ConditionEditor>
                    </>
                ) : (
                    <Token value={rule.state} options={stateOptions()} onChange={state => set({ state })}>
                        {label.state(rule.state)}
                    </Token>
                )}
                {' → show '}
                <Token value={rule.member} options={memberOptions} onChange={setMember}
                    problem={!(def.members || []).includes(rule.member) ? problem : null}>
                    {memberName(rule.member)}
                </Token>
                {subject && (
                    <>{' of '}
                        <Token value={subject.value} options={subjects} onChange={s => set({ subject: s })}>
                            {subject.label}
                        </Token>
                    </>
                )}
                {when && (
                    <>{typeof rule.until === 'number' ? ' for ' : ' until '}
                        <Token
                            value={rule.until} options={untilOptions()} onChange={until => set({ until })}
                            extra={close => (
                                <SecondsField value={rule.until} onCommit={(s) => { set({ until: s }); close(); }} />
                            )}
                        >
                            {untilLabel(rule.until)}
                        </Token>
                        {' · '}
                        <Token value={rule.once} options={onceOptions()} onChange={once => set({ once })}>
                            {label.once(rule.once)}
                        </Token>
                    </>
                )}
            </div>
            {/* Row controls appear on hover (and on keyboard focus), so the
                right edge isn't a column of icons on every rule. */}
            <div className="flex shrink-0 items-center gap-1.5 pt-1.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                <IconToggle icon={ArrowUp} tone="plain" label="Move up" disabled={first} onClick={() => move(rule.id, -1)} />
                <IconToggle icon={ArrowDown} tone="plain" label="Move down" disabled={last} onClick={() => move(rule.id, 1)} />
                <IconToggle
                    icon={Power} on={rule.enabled}
                    label={rule.enabled ? 'Pause this rule' : 'Turn this rule back on'}
                    onClick={() => set({ enabled: !rule.enabled })}
                />
                <IconToggle icon={Trash2} tone="danger" label="Delete this rule" onClick={() => remove(rule.id)} />
            </div>
        </div>
    );
});

/*
 * OTHERWISE — the resting member, as the last line of the logic.
 *
 * It was a "Resting" select of its own, and before that a marker on the roster;
 * as the closing line of the rules it reads as what it is: the answer when no
 * moment and no state applies, which is also what the container shows at boot
 * and after a producer clears a push.
 */
const OtherwiseRow = memo(function OtherwiseRow({ def }) {
    const { setResting } = useContainerActions();
    const options = [
        { value: '', label: 'nothing (transparent)' },
        ...(def.members || []).map(m => ({ value: m, label: memberName(m) })),
    ];
    return (
        <div className="flex items-start gap-2 px-1.5 py-0.5">
            <span className="w-[4.75rem] shrink-0 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Otherwise
            </span>
            <div className="min-w-0 flex-1 text-xs leading-7 text-muted-foreground">
                {'show '}
                <Token value={def.resting || ''} options={options} onChange={v => setResting(def.id, v || null)}>
                    {def.resting ? memberName(def.resting) : 'nothing'}
                </Token>
            </div>
        </div>
    );
});

export default memo(function AutomationSection({ def }) {
    const actions = useAutomationActions();
    const rules = useContainerAutomations(def.id);
    const canAdd = (def.members || []).length > 0;
    const whens = rules.filter(r => r.kind === 'when');
    const whiles = rules.filter(r => r.kind === 'while');
    const row = (group) => (r, i) => (
        <RuleRow key={r.id} rule={r} def={def} actions={actions}
            first={i === 0} last={i === group.length - 1} />
    );
    return (
        <div className={KIT_SECTION}>
            <div className="flex items-center gap-2">
                {/* Precedence is a tooltip, not a sentence on the panel. */}
                <Text
                    size="xs" span className="label-display flex-1 text-[10px] tracking-wider text-muted-foreground"
                    title="When rules interrupt and hand back · the first While that holds wins · a push beats both"
                >
                    Rules
                </Text>
                <Button size="xs" variant="ghost" disabled={!canAdd} onClick={() => actions.add('when', def.id)}>
                    <Plus /> When
                </Button>
                <Button size="xs" variant="ghost" disabled={!canAdd} onClick={() => actions.add('while', def.id)}>
                    <Plus /> While
                </Button>
            </div>
            <div className="flex flex-col">
                {whens.map(row(whens))}
                {whiles.map(row(whiles))}
                <OtherwiseRow def={def} />
            </div>
        </div>
    );
});

// Exported for the tests.
export { RuleRow, Token };
