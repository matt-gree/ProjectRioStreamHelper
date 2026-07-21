import { useMemo } from 'react';
import { boardOfUrl } from '../../lib/obs-binding';
import { ELEMENTS } from './elements';
import { useBindingScenes } from './bindings';
import { useActiveBoards, useBoardLabel } from './boards';

/*
 * Instances — what the console's three surfaces actually list.
 *
 * An element is a TYPE ("Scoreboard"). An instance is one of that type on the
 * broadcast ("Scoreboard on board 2"). For most elements the two are the same
 * thing, but a `scope: 'board'` element is URL-scoped: its source carries
 * `?scoreboard=N`, so two of them in one scene are two independent things with
 * their own source, their own air state and their own settings. Before this the
 * rack listed one row per TYPE and the board was a hidden per-element dropdown,
 * which meant a producer running two boards had one row that silently commanded
 * whichever board a stored preference happened to name.
 *
 * The board is part of the IDENTITY now, so it shows up where identity shows
 * up: a rack row each, a rail pin each, a stage selection each.
 *
 * Feed-scoped elements deliberately get no instances. Their container is
 * board-agnostic and the board rides in the pushed payload — see the "two board
 * mechanisms" note in elements.js. Conflating the two is how multiplicity ends
 * up feeling bolted on.
 */

/*
 * The id the surfaces key on: `scoreboard:2`, or plain `scoreboard` for a
 * global element.
 *
 * Desk ids ('desk:match') share the colon, and they must not be parsed as
 * instances. The board suffix is always DIGITS, which is what keeps the two
 * namespaces apart — `desk:match` has a non-numeric tail and falls through as
 * an opaque id. Don't introduce a numeric desk name.
 */
export function instanceId(element, board) {
    if (!element) return null;
    return element.scope === 'board' && board != null ? `${element.id}:${board}` : element.id;
}

export function parseInstanceId(id) {
    const m = /^(.+):(\d+)$/.exec(id ?? '');
    return m ? { elementId: m[1], board: Number(m[2]) } : { elementId: id ?? null, board: null };
}

/*
 * One element's instances: the boards it is DISCOVERED on ∪ the boards the
 * producer has DECLARED.
 *
 * Both halves are load-bearing. Discovery alone would hide a board the producer
 * has configured but not yet added a source for — exactly the case where they
 * need the row, since the strip's Bind slot is how the source gets created.
 * Declaration alone would drop a source pointing at a board that has since left
 * `scoreboards.active`, silently orphaning a thing that is on air right now.
 */
export function elementInstances(element, scenes = [], activeBoards = []) {
    if (element.scope !== 'board') return [{ id: element.id, element, board: null }];
    const boards = new Set(activeBoards.filter(Number.isFinite));
    for (const sc of scenes) {
        for (const it of sc.items ?? []) {
            if (!element.match(it.url || '')) continue;
            const b = boardOfUrl(it.url || '');
            if (b != null) boards.add(b);
        }
    }
    // A board-scoped element with nothing anywhere still gets one row: board 1
    // always exists (CLAUDE.md — at least one board always remains), and a
    // console that renders no Scoreboard row at all reads as a missing feature.
    if (!boards.size) boards.add(1);
    return [...boards]
        .sort((a, b) => a - b)
        .map(board => ({ id: `${element.id}:${board}`, element, board }));
}

export function productionInstances(scenes, activeBoards, elements = ELEMENTS) {
    return elements.flatMap(el => elementInstances(el, scenes, activeBoards));
}

/*
 * What a stored id means TODAY.
 *
 * Selection and rail pins persist in the browser, so they outlive the boards
 * they were written against. Three cases collapse into one rule — fall back to
 * the element's first instance:
 *
 *   'scoreboard'    a pin from before instances existed   → scoreboard:1
 *   'scoreboard:3'  board 3 has since been removed        → scoreboard:1
 *   'scoreboard:2'  still there                           → itself
 *
 * Resolving at READ time rather than rewriting storage once is the point. A
 * one-shot migration would have to run before the OBS mirror and the settings
 * have loaded — which is precisely when the instance list is least trustworthy
 * — and it would destroy the producer's pin if it guessed wrong. This costs a
 * lookup and cannot be wrong for longer than a render.
 */
export function resolveInstance(id, instances) {
    if (!id) return null;
    const exact = instances.find(i => i.id === id);
    if (exact) return exact;
    const { elementId } = parseInstanceId(id);
    return instances.find(i => i.element.id === elementId) ?? null;
}

/*
 * What a stored pin currently POINTS AT — its resolved instance id, or the pin
 * itself for anything instances don't own (desk ids, a retired element).
 */
export const pinTarget = (pin, instances) => resolveInstance(pin, instances)?.id ?? pin;

/*
 * Pin/unpin by instance id, against pins that may still be stored in older
 * forms.
 *
 * Comparing by TARGET rather than by stored string is what stops a legacy
 * `scoreboard` pin and a freshly written `scoreboard:1` from both sitting on
 * the rail as two cards for one source — and it means unpinning removes the
 * card the producer is actually looking at, whatever it is stored as. New pins
 * are always written canonical, so a rail converges as it is used rather than
 * needing a rewrite pass.
 */
export function togglePin(pins, id, instances) {
    const cur = pins ?? [];
    return cur.some(p => pinTarget(p, instances) === id)
        ? cur.filter(p => pinTarget(p, instances) !== id)
        : [...cur, id];
}

export function useProductionInstances() {
    const scenes = useBindingScenes();
    const boards = useActiveBoards();
    return useMemo(() => productionInstances(scenes, boards), [scenes, boards]);
}

/*
 * How an instance names itself in the rack, on the stage and on a rail card.
 *
 * The board suffix appears only when the element HAS more than one instance:
 * a rig running a single board would otherwise read "Scoreboard · Scoreboard 1"
 * on every row, which is the board mechanism charging rent it isn't paying.
 */
export function useInstanceLabel(instances) {
    const boardLabel = useBoardLabel();
    return useMemo(() => {
        const counts = new Map();
        for (const i of instances) counts.set(i.element.id, (counts.get(i.element.id) ?? 0) + 1);
        return (inst) => ({
            name: inst.element.name,
            board: inst.board != null && counts.get(inst.element.id) > 1
                ? boardLabel(inst.board)
                : null,
        });
    }, [instances, boardLabel]);
}
