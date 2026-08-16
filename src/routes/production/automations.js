import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore, useStateStore } from '../../context/store';
import { ELEMENTS } from './elements';

/*
 * Container automations — the console half.
 *
 * A rule makes a container feed itself: when a state key changes, show one of
 * its members for a few seconds, then return to the container's RESTING
 * occupant. The engine is server-side and lives in the state-write path
 * (server/automations.py), so a rule's feed write rides the same batch as the
 * HUD change that triggered it. This module holds only what the producer edits:
 * the rules themselves (plain settings, like container definitions) and the
 * QUICK-ADD LIBRARY they are created from.
 *
 * WHY A LIBRARY AND NOT AN EDITOR. A rule has a trigger key in it, and a
 * free-text state key is a way to write an automation that silently never fires.
 * The canned entries are known-good and name the four knobs worth changing
 * (trigger, guard, member, dwell); custom authoring waits until these have been
 * through a real broadcast.
 *
 * PRECEDENCE is manual > rule > resting, mirrored by the engine to
 * `production.feed.reason.{container}` — the same shape as the player-side
 * cascade's `side_reason`, so a surface can say WHY something is up. A producer
 * Push suspends the rules; CLEARING the container is what hands it back, which
 * is why there is no separate Resume verb here.
 */

export const AUTOMATIONS_KEY = 'production.automations';

// The deciding tier, as the engine mirrors it.
export const REASONS = {
    manual: { label: 'Manual', hint: 'A producer pushed this — rules are suspended until it is cleared.' },
    rule: { label: 'Automated', hint: 'An automation put this up; it returns to resting when the dwell ends.' },
    resting: { label: 'Resting', hint: 'The container’s steady state — what it shows when nothing else is up.' },
};

/*
 * The quick-add library.
 *
 * `{sb}` in a trigger resolves from the CONTAINER's scope server-side, so one
 * entry reads the same on every board instead of naming one.
 *
 * `members` is what the rule can show, in PREFERENCE ORDER, and a template only
 * offers itself for a container whose roster already holds one of them — a rule
 * that feeds a non-member is inert by design and would just look broken. A list
 * rather than a single id because "flash the stat card" is one decision the
 * producer makes, and which card their container holds (the themed 2x2 Stat
 * Card, or the fed Stats bar) is a look they already chose when they built the
 * roster. The rule itself always stores the resolved member, so the engine
 * still reads exactly one.
 */
export const AUTOMATION_LIBRARY = [
    {
        id: 'batter-card',
        name: 'Batter change → stat card',
        members: ['statscard', 'stats'],
        trigger: 'score.{sb}.batter',
        triggerLabel: 'the batter changes',
        guard: 'content',
        guardLabel: 'a stat line resolves for this side',
        dwell: 7,
        /*
         * The case study this engine was built from, and the element it
         * replaced: the old Roster + Stats source did exactly this inside one
         * mount — on every new batter, cross-fade from the roster to a stat card
         * and back — with the trigger, the dwell and the pair of layers all
         * welded shut. Because the card resolves per SIDE, the same
         * trigger shows the batter on the side at bat and the pitcher on the
         * side in the field — so a mirrored pair is two scoped containers
         * running this one rule, not two rules.
         */
        blurb: 'Flashes the stat card for whoever this side has on the field — '
            + 'the batter when it is batting, the pitcher when it is not.',
    },
];

export const libraryEntry = (id) => AUTOMATION_LIBRARY.find(t => t.id === id) || null;

/*
 * Which of a template's members this container would actually show: the first
 * one its roster holds. Null when the roster holds none, which is exactly what
 * makes the template unofferable.
 */
export const memberFor = (template, def) => (template?.members || []).find(
    m => (def?.members || []).includes(m),
) || null;

// What a template needs on the roster before it can be offered.
export const templatesFor = (def) => AUTOMATION_LIBRARY.filter(t => !!memberFor(t, def));

const EMPTY = Object.freeze({});

function normalizeRule(id, raw) {
    if (!raw || typeof raw !== 'object' || !raw.container || !raw.member) return null;
    const template = libraryEntry(raw.template || id);
    return {
        id,
        name: raw.name || template?.name || id,
        container: raw.container,
        member: raw.member,
        trigger: raw.trigger || '',
        guard: raw.guard || 'content',
        dwell: Number(raw.dwell) || 0,
        enabled: raw.enabled !== false,
        template: template || null,
    };
}

// Every rule, normalized. Settings are hand-editable JSON, so a malformed entry
// degrades to absent rather than throwing inside a selector.
export function useAutomations() {
    const raw = useSettingsStore(useShallow(s => s?.production?.automations ?? EMPTY));
    return useMemo(
        () => Object.entries(raw).map(([id, r]) => normalizeRule(id, r)).filter(Boolean),
        [raw],
    );
}

// The rules driving one container.
export function useContainerAutomations(container) {
    const all = useAutomations();
    return useMemo(
        () => (container ? all.filter(r => r.container === container) : []),
        [all, container],
    );
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

/*
 * A rule's id: the template it came from, scoped to its container.
 *
 * Two containers can run the same canned rule (that is exactly how a mirrored
 * pair is built), so the container has to be part of the id; adding the same
 * template to one container twice is a no-op rather than a duplicate, because
 * two identical rules on one container would fire twice into a feed key that
 * holds one occupant.
 */
export const ruleIdFor = (templateId, container) => `${container}:${templateId}`;

export function useAutomationActions() {
    const add = useCallback((templateId, container) => {
        const template = libraryEntry(templateId);
        if (!template || !container) return null;
        // The member is resolved against the roster HERE, once, and stored — the
        // engine reads a rule, not a preference list, and a roster edit that
        // takes the member away leaves an inert rule rather than one that
        // silently re-points at a different card mid-broadcast.
        const def = useSettingsStore.getState()?.production?.container_defs?.[container];
        const member = memberFor(template, def);
        if (!member) return null;
        const id = ruleIdFor(templateId, container);
        writeRules({
            ...rawRules(),
            [id]: {
                enabled: true,
                template: templateId,
                name: template.name,
                container,
                member,
                trigger: template.trigger,
                guard: template.guard,
                dwell: template.dwell,
            },
        });
        return id;
    }, []);

    // One knob. Rules are config, so this is immediate and never staged — the
    // broadcast-visible half is the feed the engine writes, not the rule.
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

    return { add, update, remove };
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
