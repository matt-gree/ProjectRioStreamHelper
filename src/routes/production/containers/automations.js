import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { ELEMENTS } from '../elements';
import VOCAB from '../../../../public/layout/lib/automation-vocab.json';

/*
 * Container automations — the console half.
 *
 * A rule makes a container feed itself, and it is a SENTENCE:
 *
 *   when <event> by <side> [if …] → show <member> of <subject> for <duration> · <how often>
 *   while <state> → show <member> of <subject>
 *   otherwise show <the resting member>
 *
 * Every word in it is an id from `automation-vocab.json`, which the engine
 * (server/automations.py) implements id by id — so the menus a producer picks
 * from are exactly what the engine can do, and a rule that silently never fires
 * cannot be written. That file used to be a canned library of whole rules; a
 * vocabulary is what lets "when a home run is hit" arrive later as one entry
 * instead of a new kind of rule.
 *
 * PRECEDENCE is manual > when > while > otherwise, mirrored by the engine to
 * `production.feed.reason.{container}` as manual / rule / state / resting. A
 * producer Push suspends the rules; CLEARING the container is what hands it
 * back, which is why there is no separate Resume verb here.
 */

export { VOCAB };

export const AUTOMATIONS_KEY = 'production.automations';

// The deciding tier, as the engine mirrors it.
export const REASONS = {
    manual: { label: 'Pushed', hint: 'You pushed this — the rules are paused until you clear it.' },
    rule: { label: 'When rule', hint: 'A moment put this up; it hands back when its time is up.' },
    state: { label: 'While rule', hint: 'A state that holds right now is showing this.' },
    resting: { label: 'Otherwise', hint: 'Nothing else applies, so this is the container at rest.' },
};

const byId = list => Object.fromEntries(list.map(e => [e.id, e]));
export const EVENTS = byId(VOCAB.events);
export const STATES = byId(VOCAB.states);
const UNTIL = byId(VOCAB.until);
const ONCE = byId(VOCAB.once);
const BY = byId(VOCAB.by);
const CONDITIONS = byId(VOCAB.conditions);

/*
 * Whose content a member is handed — and whether the question applies at all.
 *
 * Only a CONTAINER-SCOPED member (Roster, Stat Card, Controller) draws "whoever"
 * from a frame of reference, so only those get an "of". A Stat Card is about a
 * PLAYER (the batter, the pitcher); a Roster or a Controller is about a SIDE.
 * Same four subjects underneath — they all pick a side — read in the word that
 * member's content is.
 */
const PLAYER_MEMBERS = new Set(['statscard']);
export function subjectKind(memberId) {
    if (PLAYER_MEMBERS.has(memberId)) return 'player';
    return ELEMENTS.find(el => el.id === memberId)?.containerScoped ? 'side' : null;
}

export function subjectOptions(rule) {
    const kind = subjectKind(rule?.member);
    if (!kind) return [];
    const sided = rule.kind === 'when' && !!EVENTS[rule.event]?.sided;
    return VOCAB.subjects
        .filter(s => !s.needsSidedEvent || sided)
        .map(s => ({ value: s.id, label: s[kind] }));
}

export const eventOptions = () => VOCAB.events.map(e => ({ value: e.id, label: e.label }));
export const stateOptions = () => VOCAB.states.map(e => ({ value: e.id, label: e.label }));
export const byOptions = () => VOCAB.by.map(e => ({ value: e.id, label: e.label }));
export const onceOptions = () => VOCAB.once.map(e => ({ value: e.id, label: e.label }));
export const conditionFields = () => VOCAB.conditions.map(e => ({ value: e.id, label: e.label }));
export const OPS = VOCAB.ops;
export const SECOND_PRESETS = VOCAB.seconds;
export const untilOptions = () => [
    ...VOCAB.seconds.map(s => ({ value: s, label: `${s} s` })),
    ...VOCAB.until.map(u => ({ value: u.id, label: u.label })),
];

// The words a rule's tokens read as.
export const untilLabel = u => (typeof u === 'number' ? `${u} s` : UNTIL[u]?.label ?? String(u));
export const label = {
    event: id => EVENTS[id]?.label ?? id,
    state: id => STATES[id]?.label ?? id,
    by: id => BY[id]?.label ?? id,
    once: id => ONCE[id]?.label ?? id,
    field: id => CONDITIONS[id]?.label ?? id,
};
export const conditionLabel = c => `${label.field(c.field)} ${c.op === '>=' ? '≥' : c.op === '<=' ? '≤' : '='} ${c.value}`;

const EMPTY = Object.freeze({});

function normalizeRule(id, raw) {
    if (!raw || typeof raw !== 'object' || !raw.container || !raw.member) return null;
    const kind = raw.kind === 'while' ? 'while' : raw.kind === 'when' ? 'when' : null;
    if (!kind) return null;
    const until = typeof raw.until === 'number' ? raw.until : (raw.until ?? 8);
    return {
        id,
        kind,
        container: raw.container,
        member: raw.member,
        event: raw.event ?? null,
        state: raw.state ?? null,
        by: String(raw.by ?? 'any'),
        subject: raw.subject ?? 'scope',
        until,
        once: raw.once ?? 'always',
        conditions: Array.isArray(raw.conditions) ? raw.conditions.filter(c => c && typeof c === 'object') : [],
        enabled: raw.enabled !== false,
        order: Number(raw.order) || 0,
    };
}

const ruleSort = (a, b) => (a.kind === b.kind ? (a.order - b.order) || a.id.localeCompare(b.id)
    : a.kind === 'when' ? -1 : 1);

// Every rule, normalized. Settings are hand-editable JSON, so a malformed entry
// degrades to absent rather than throwing inside a selector.
export function useAutomations() {
    const raw = useSettingsStore(useShallow(s => s?.production?.automations ?? EMPTY));
    return useMemo(
        () => Object.entries(raw).map(([id, r]) => normalizeRule(id, r)).filter(Boolean).sort(ruleSort),
        [raw],
    );
}

// The rules driving one container: When rules first, then While, each in the
// producer's order — the order the engine reads them in.
export function useContainerAutomations(container) {
    const all = useAutomations();
    return useMemo(
        () => (container ? all.filter(r => r.container === container) : []),
        [all, container],
    );
}

/*
 * Why a rule cannot do anything, in the producer's words — or null when it can.
 * Shown on the rule rather than hidden: the engine treats every one of these as
 * inert, and a rule that reads as working and never fires is the bug the
 * vocabulary exists to prevent.
 */
export function ruleProblem(rule, def) {
    if (!(def?.members || []).includes(rule.member)) return 'Its member is no longer on this container.';
    if (rule.kind === 'when' && !EVENTS[rule.event]) return 'This build doesn’t know that event.';
    if (rule.kind === 'while' && !STATES[rule.state]) return 'This build doesn’t know that state.';
    return null;
}

/*
 * Which tier decided what this container is showing, straight off the engine's
 * mirror. Undefined for a container no automation has ever touched — that is a
 * real answer (nothing is deciding anything), not a missing one.
 */
export function useFeedReason(container) {
    return useStateStore(s => (container ? s?.production?.feed?.reason?.[container] : undefined));
}

function rawRules() {
    return useSettingsStore.getState()?.production?.automations || {};
}

function writeRules(next) {
    useSettingsStore.getState().setItem(AUTOMATIONS_KEY, next);
}

let seq = 0;
const newId = container => `${container}:${Date.now().toString(36)}${(seq++).toString(36)}`;

/*
 * What a new rule starts as — a sentence that already makes sense, so adding one
 * is the same gesture as editing one. The member is the first container-scoped
 * one on the roster when there is one (those are the members a rule most often
 * flashes), else the first member.
 */
export function defaultRule(kind, def) {
    const members = def?.members || [];
    const member = members.find(m => subjectKind(m)) ?? members[0] ?? null;
    return kind === 'while'
        ? { kind, state: VOCAB.states[0].id, member, subject: 'scope' }
        : {
            kind, event: VOCAB.events[0].id, by: 'any', member, subject: 'scope',
            until: 8, once: 'always', conditions: [],
        };
}

export function useAutomationActions() {
    // Rules are config, so every write is immediate and never staged — the
    // broadcast-visible half is the feed the engine writes, not the rule.
    const add = useCallback((kind, container) => {
        const def = useSettingsStore.getState()?.production?.container_defs?.[container];
        const base = defaultRule(kind, def);
        if (!container || !base.member) return null;
        const rules = rawRules();
        const orders = Object.values(rules)
            .filter(r => r?.container === container && r?.kind === kind)
            .map(r => Number(r.order) || 0);
        const id = newId(container);
        writeRules({
            ...rules,
            [id]: { ...base, container, enabled: true, order: orders.length ? Math.max(...orders) + 1 : 0 },
        });
        return id;
    }, []);

    const update = useCallback((id, patch) => {
        const rules = rawRules();
        if (!rules[id]) return;
        writeRules({ ...rules, [id]: { ...rules[id], ...patch } });
    }, []);

    const remove = useCallback((id) => {
        const rules = rawRules();
        if (!(id in rules)) return;
        const next = { ...rules };
        delete next[id];
        writeRules(next);
    }, []);

    /*
     * Swap a rule with its neighbour of the same kind on the same container —
     * order only means something within a kind (moments are tried top-down,
     * states are checked top-down), so a When rule never moves below a While.
     * Re-numbers the whole group, so a hand-edited file with duplicate orders
     * comes out of one move with a clean sequence.
     */
    const move = useCallback((id, dir) => {
        const rules = rawRules();
        const rule = normalizeRule(id, rules[id]);
        if (!rule) return;
        const group = Object.entries(rules)
            .map(([rid, r]) => normalizeRule(rid, r))
            .filter(r => r && r.container === rule.container && r.kind === rule.kind)
            .sort(ruleSort);
        const at = group.findIndex(r => r.id === id);
        const to = at + dir;
        if (at < 0 || to < 0 || to >= group.length) return;
        [group[at], group[to]] = [group[to], group[at]];
        const next = { ...rules };
        group.forEach((r, i) => { next[r.id] = { ...rules[r.id], order: i }; });
        writeRules(next);
    }, []);

    return { add, update, remove, move };
}

/*
 * Drop the rules a roster edit just made meaningless.
 *
 * The engine already treats a rule whose container is gone (or whose member has
 * left the roster) as INERT, so this is not about correctness on air — it is
 * about a deleted container leaving rules behind that would come back to life
 * the day somebody rebuilds a container with the same id. Called from the
 * container mutations, which is the only place either fact changes.
 */
export function dropRules({ container, member = null }) {
    const rules = rawRules();
    const next = {};
    let dropped = false;
    for (const [id, rule] of Object.entries(rules)) {
        const hit = rule?.container === container && (member == null || rule?.member === member);
        if (hit) dropped = true;
        else next[id] = rule;
    }
    if (dropped) writeRules(next);
}

/*
 * A member's display name, for the rule rows. Elements are dev-defined, so a
 * member id with no registry entry is a rule pointing at something this build
 * no longer has — shown as the raw id rather than blank.
 */
export function memberName(id) {
    return ELEMENTS.find(el => el.id === id)?.name || id;
}
