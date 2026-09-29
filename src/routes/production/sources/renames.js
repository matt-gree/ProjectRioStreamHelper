import { onObsRename } from '../../../context/obs';
import { updatePersistent } from '../../../hooks/usePersistentState';
import {
    HIDDEN_SCENES_KEY, OPEN_SCENES_KEY, RAIL_KEY, SELECTION_KEY, SHUT_FOLDERS_KEY, folderKey,
} from '../rack';
import { parsePlacementId, placementId } from './placements';

/*
 * THE RACK'S STORED LAYOUT FOLLOWS AN OBS RENAME.
 *
 * Selection, rail pins, expanded scenes, hidden scenes and folded folders are
 * browser-local and stored by NAME — the scene's, and for a folder the group's
 * — because OBS 28/29 gives neither a stable id. They are resolved at read time
 * and never rewritten (./placements `resolvePlacement`), which is the right
 * answer to a name that is simply GONE: a pin whose scene was deleted falls
 * back to the same source wherever it is, and a hidden scene that comes back
 * is hidden again.
 *
 * A rename is not a disappearance, and read-time resolution answers it wrong
 * three ways: a hidden scene reappears on the rack, an expanded one collapses
 * and stops being mirrored, and a pin on the Break copy of a source quietly
 * starts flying the Program copy — then, if a new scene is ever given the old
 * name, points at that. The rename event says exactly what moved, so the
 * stored names move with it.
 *
 * Only while this console is connected to hear it. A rename made with this
 * browser closed is indistinguishable from a delete, and falls back to
 * read-time resolution like one.
 */

const renameScene = (from, to) => (id) => {
    if (typeof id !== 'string') return id;
    const { instance, scene } = parsePlacementId(id);
    return scene === from ? placementId(instance, to) : id;
};

function mapList(key, fn) {
    updatePersistent(key, (list) => {
        if (!Array.isArray(list)) return undefined;
        const next = list.map(fn);
        return next.some((v, i) => v !== list[i]) ? next : undefined;
    });
}

export function followRename(from, to) {
    const inPlacement = renameScene(from, to);
    updatePersistent(SELECTION_KEY, (id) => {
        const next = inPlacement(id);
        return next === id ? undefined : next;
    });
    mapList(RAIL_KEY, inPlacement);
    mapList(OPEN_SCENES_KEY, n => (n === from ? to : n));
    mapList(HIDDEN_SCENES_KEY, n => (n === from ? to : n));
    // `scene\ngroup` — either half can be what was renamed.
    mapList(SHUT_FOLDERS_KEY, (k) => {
        if (typeof k !== 'string') return k;
        const cut = k.indexOf('\n');
        if (cut < 0) return k;
        const scene = k.slice(0, cut);
        const group = k.slice(cut + 1);
        if (scene !== from && group !== from) return k;
        return folderKey(scene === from ? to : scene, group === from ? to : group);
    });
}

onObsRename(followRename);
