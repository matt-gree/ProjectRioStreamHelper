import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { followRename } from './sources/renames';
import {
    HIDDEN_SCENES_KEY, OPEN_SCENES_KEY, RAIL_KEY, SELECTION_KEY, SHUT_FOLDERS_KEY, folderKey,
} from './rack';

/*
 * The rack's browser-local layout is stored by OBS name. A rename moves it —
 * read-time resolution would otherwise unhide a hidden scene, collapse an open
 * one, and send a Break pin to the Program copy of its source.
 */
// The test env's localStorage has no working methods (see rack.test.jsx).
const mem = new Map();
const fakeLocalStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
    clear: () => mem.clear(),
};

const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const get = k => JSON.parse(localStorage.getItem(k));

describe('followRename', () => {
    beforeEach(() => {
        mem.clear();
        vi.stubGlobal('localStorage', fakeLocalStorage);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('moves pins, selection, open and hidden scenes named after the scene', () => {
        put(SELECTION_KEY, 'scoreboard:1@Break');
        put(RAIL_KEY, ['scoreboard:1@Break', 'scoreboard:1@Game', 'desk:match', 'statsbar']);
        put(OPEN_SCENES_KEY, ['Break', 'Other']);
        put(HIDDEN_SCENES_KEY, ['Break']);
        followRename('Break', 'Intermission');
        expect(get(SELECTION_KEY)).toBe('scoreboard:1@Intermission');
        expect(get(RAIL_KEY)).toEqual(['scoreboard:1@Intermission', 'scoreboard:1@Game', 'desk:match', 'statsbar']);
        expect(get(OPEN_SCENES_KEY)).toEqual(['Intermission', 'Other']);
        expect(get(HIDDEN_SCENES_KEY)).toEqual(['Intermission']);
    });

    it('keeps a scene name holding @ intact', () => {
        put(SELECTION_KEY, 'lowerthird@A@B');
        followRename('A@B', 'C');
        expect(get(SELECTION_KEY)).toBe('lowerthird@C');
    });

    it('moves a folded folder by either its scene or its group', () => {
        put(SHUT_FOLDERS_KEY, [folderKey('Game', 'Graphics'), folderKey('Break', 'Graphics')]);
        followRename('Graphics', 'Folder');
        followRename('Game', 'Live');
        expect(get(SHUT_FOLDERS_KEY)).toEqual([folderKey('Live', 'Folder'), folderKey('Break', 'Folder')]);
    });

    it('writes nothing when nothing stored names it', () => {
        followRename('Break', 'Intermission');
        expect(localStorage.getItem(RAIL_KEY)).toBeNull();
        put(RAIL_KEY, null);
        followRename('Break', 'Intermission');
        expect(get(RAIL_KEY)).toBeNull();
    });
});
