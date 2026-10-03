/*
 * Following OBS renames — of sources, scenes and groups — everywhere PRSH holds
 * a name: the mirror, the request aliases, the input cache, the staged
 * confirm-mode buffer, the console's browser-local layout, and the NAME BOOK
 * that replays renames made while no PRSH was listening.
 *
 * Imports the store from ./obs, which imports this module: the cycle is safe
 * because nothing here touches `useObsStore` until a function runs.
 */
import { notifications } from '../lib/notify';
import { useObsStore } from './obs';
import { session } from './obs-session';
import { renameKeptCanvases } from './obs-source-passes';
import { obsKeyNames, useStagingStore } from './staging';

/*
 * Who else keeps names — the console's browser-local layout (selection, rail
 * pins, open/hidden scenes, folded folders; ../routes/production/sources/
 * renames.js). Told after the mirror has moved, once per rename.
 */
const renameListeners = new Set();
export function onObsRename(fn) {
    renameListeners.add(fn);
    return () => renameListeners.delete(fn);
}

/*
 * Move every name-keyed thing this layer holds from `from` to `to`.
 *
 * ONE function for sources, scenes and groups, because OBS keeps them in one
 * namespace — no input may share a name with a scene — and because a group is
 * both at once: the group's own scene item is listed by `sourceName`, and each
 * item inside it carries the group as `owner` (the scene every request against
 * it must name) and `group` (the folder the rack draws). Missing any of those
 * leaves a folder whose children's events arrive under a name the mirror no
 * longer matches, and whose eyes send the old one to OBS.
 */
export function renameEverywhere(from, to) {
    if (!from || !to || from === to) return;

    const book = readBook();
    let booked = false;
    for (const [uuid, name] of Object.entries(book)) {
        if (name === from) { book[uuid] = to; booked = true; }
    }
    if (booked) writeBook(book);

    for (const [k, v] of session.aliases) if (v === from) session.aliases.set(k, to);
    session.aliases.delete(to);
    session.aliases.set(from, to);

    const hit = session.inputCache.get(from);
    session.inputCache.delete(from);
    if (hit) session.inputCache.set(to, hit);

    if (session.tracked.has(from)) {
        session.tracked.delete(from);
        session.tracked.add(to);
    }
    for (const parents of session.groupParents.values()) {
        if (parents.delete(from)) parents.add(to);
    }
    if (session.groupParents.has(from)) {
        session.groupParents.set(to, session.groupParents.get(from));
        session.groupParents.delete(from);
    }

    const swap = n => (n === from ? to : n);
    useObsStore.setState((state) => {
        const sceneItems = {};
        for (const [scene, items] of Object.entries(state.sceneItems)) {
            sceneItems[swap(scene)] = items.map((it) => (
                it.sourceName === from || it.owner === from || it.group === from
                    ? { ...it, sourceName: swap(it.sourceName), owner: swap(it.owner), group: swap(it.group) }
                    : it));
        }
        return {
            sceneItems,
            programScene: swap(state.programScene),
            previewScene: swap(state.previewScene),
            scenes: state.scenes.map(swap),
            mirroredScenes: [...session.tracked],
        };
    });

    renameRemembered(from, to);
}

// The half of a rename that outlives a connection: everything kept by NAME in
// this browser (and the in-memory staging buffer, which outlives a dropped
// socket). The mirror is not in it — a fresh connection reads that from OBS.
function renameRemembered(from, to) {
    renameKeptCanvases(from, to);
    useStagingStore.getState().renameObs(from, to);
    for (const fn of renameListeners) {
        try { fn(from, to); } catch (e) { console.debug('OBS rename listener failed', e); }
    }
}

/*
 * THE NAME BOOK — OBS uuid -> the name it had when this browser last saw it.
 *
 * A rename made while PRSH was closed (or its socket down) is never announced:
 * obs-websocket only reports what happens while a client is listening, and on
 * the next connect the old name is simply absent, indistinguishable from a
 * delete. OBS 30+ gives every input and scene a uuid that survives renames and
 * restarts, so remembering uuid -> name turns that absence back into a rename:
 * a uuid whose name moved is REPLAYED through the same path as a live rename
 * (`replayRenames`). OBS 28/29 report no uuids, and there nothing is recorded
 * and nothing changes.
 *
 * Kept up to date live by renameEverywhere (by name, so no uuid is needed on
 * the event) and by every list that carries uuids: the connect pass, created
 * events, and each mirrored scene's items — the only place a GROUP's uuid is
 * reported at all.
 */
const NAME_BOOK = 'prsh.obs.nameBook';
function readBook() {
    try {
        const v = JSON.parse(localStorage.getItem(NAME_BOOK) || '{}');
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch { return {}; }
}
function writeBook(book) {
    try { localStorage.setItem(NAME_BOOK, JSON.stringify(book)); } catch { /* private window */ }
}

let placeholderSeq = 0;

/*
 * Record `pairs` ({uuid, name}) and replay every name that moved since this
 * browser last saw it. Returns the moves, [from, to].
 *
 * `current` — every name OBS has right now — is what makes a replay safe to
 * ALIAS: a request under an old name may be redirected only while nothing else
 * answers to that name. Two sources that swapped names offline both still
 * exist, so neither old name session.aliases (the staged-change pass below drops what
 * would otherwise run against the wrong one). Without `current` (a single
 * scene's items) nothing session.aliases.
 *
 * Through a PLACEHOLDER, both halves: replaying A->B then B->A one at a time
 * would move everything stored under A onto B and then all of it back onto A,
 * merging the two. A NUL cannot appear in a name OBS accepts.
 */
export function replayRenames(pairs, current = null) {
    const book = readBook();
    const moves = [];
    let dirty = false;
    for (const { uuid, name } of pairs) {
        if (!uuid || !name) continue;
        const was = book[uuid];
        if (was && was !== name) moves.push([was, name]);
        if (was !== name) { book[uuid] = name; dirty = true; }
    }
    if (dirty) writeBook(book);
    if (!moves.length) return moves;
    const held = moves.map(([from, to]) => {
        const hold = `\u0000prsh-rename-${++placeholderSeq}`;
        renameRemembered(from, hold);
        return [hold, to];
    });
    for (const [hold, to] of held) renameRemembered(hold, to);
    if (current) {
        for (const [from, to] of moves) {
            if (!current.has(from)) session.aliases.set(from, to);
        }
    }
    return moves;
}

/*
 * THE CONNECT PASS — before the console reports connected, so the rack reads
 * its stored layout under today's names from the first frame.
 *
 * 1. Replay renames made while no PRSH was listening (the name book).
 * 2. Drop every staged change that still names something OBS does not have.
 *    The buffer is in memory, so this only matters to a console that stayed
 *    open across a dropped socket — but there, an entry naming a deleted scene
 *    would otherwise sit in the pending bar until Go Live and then fail.
 *    A name is fine if OBS has it and it did not move away, or if it moved
 *    away and nothing took its place (then it is re-keyed and aliased). A name
 *    that moved while something ELSE now answers to it is ambiguous — the
 *    staged `run` captured it and would reach the newcomer — so it is dropped,
 *    and said so, rather than guessed at.
 *
 * Any list failing skips the pass: dropping staged work on half an answer is
 * worse than leaving it to fail loudly at Go Live.
 */
export async function reconcileOnConnect(gen) {
    let scenes;
    let inputs;
    let groups;
    try {
        [{ scenes }, { inputs }, { groups }] = await Promise.all([
            session.client.call('GetSceneList'),
            session.client.call('GetInputList'),
            session.client.call('GetGroupList'),
        ]);
    } catch {
        return;
    }
    if (gen !== session.generation) return;
    const current = new Set([
        ...(scenes || []).map(sc => sc.sceneName),
        ...(inputs || []).map(i => i.inputName),
        ...(groups || []),
    ]);
    const pairs = [
        ...(scenes || []).map(sc => ({ uuid: sc.sceneUuid, name: sc.sceneName })),
        ...(inputs || []).map(i => ({ uuid: i.inputUuid, name: i.inputName })),
    ];

    // Which old names are about to move — decided BEFORE the replay re-keys the
    // buffer, while each entry still carries the name its `run` captured.
    const book = readBook();
    const movedAway = new Set();
    for (const { uuid, name } of pairs) {
        if (uuid && book[uuid] && book[uuid] !== name) movedAway.add(book[uuid]);
    }
    const staging = useStagingStore.getState();
    const dropped = [];
    for (const key of staging.order) {
        const names = obsKeyNames(key);
        if (!names) continue;
        const ok = names.every(n => (current.has(n) ? !movedAway.has(n) : movedAway.has(n)));
        if (!ok) {
            dropped.push(staging.pending[key]?.label || key);
            staging.discard(key);
        }
    }

    replayRenames(pairs, current);

    if (dropped.length) {
        notifications.show({
            color: 'yellow',
            message: `Dropped ${dropped.length} staged change${dropped.length === 1 ? '' : 's'} — `
                + `OBS changed while PRSH was disconnected: ${dropped.join('; ')}`,
        });
    }
}
