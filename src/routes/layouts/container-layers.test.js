import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    createLayers, memberBox, memberOffset, resolveFeed, _resetCssForTests,
} from '../../../public/layout/lib/container-layers.js';

/*
 * The shared-container runtime (`public/layout/lib/container-layers.js`).
 *
 * This is the half of the container engine that used to be an if-chain inside
 * `fed-container.js`, where nothing could reach it: that file imports its mounts
 * by absolute `/layout/…` URL and pulls in three.js and GSAP. Splitting the
 * MECHANICS out from the REGISTRY is what makes them testable — the registry
 * (which mount, which native size, which sample) stays in fed-container.js and
 * is pinned against the console by `production/containers.test.jsx`.
 *
 * What matters here is what the automation in the next phase depends on:
 * members stay mounted so a swap can cross-fade instead of cutting, only the
 * member on screen is updated, and a scoped source's own frame of reference beats
 * the payload's.
 */

// A fake member: records every update it is handed, and whether it replayed.
function fakeMember(size, { fail = false } = {}) {
    const calls = { mounts: 0, updates: [], replays: 0, disposes: 0 };
    return {
        calls,
        spec: {
            size,
            mount: (box, ctx, sel) => {
                if (fail) throw new Error('nope');
                calls.mounts += 1;
                calls.box = box;
                calls.mountedWith = sel;
                return {
                    update: (state, payload) => { calls.updates.push(payload); },
                    replay: () => { calls.replays += 1; },
                    dispose: () => { calls.disposes += 1; },
                };
            },
        },
    };
}

const host = () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
};

// Synchronous rAF so a replay lands inside the awaited call.
const now = (fn) => fn();

beforeEach(() => {
    document.body.replaceChildren();
    document.head.replaceChildren();
    _resetCssForTests();
});

describe('resolveFeed — what the container is being asked to draw', () => {
    it('is null when nothing is fed', () => {
        expect(resolveFeed({ live: null })).toBeNull();
        // A payload with no element names no occupant, so there is nothing to draw.
        expect(resolveFeed({ live: { scoreboard: 2 } })).toBeNull();
    });

    it('passes a live feed through untouched', () => {
        expect(resolveFeed({ live: { element: 'stats', scoreboard: 2 } }))
            .toEqual({ element: 'stats', scoreboard: 2 });
    });

    /*
     * ?feed= overrides the ELEMENT only. Several members share one container URL,
     * so without it a preview of one of them draws whatever is currently fed —
     * but the rest of the live selection (which board, which character) still
     * applies.
     */
    it('lets ?feed= name the occupant without taking its content', () => {
        expect(resolveFeed({
            live: { element: 'stats', scoreboard: 2, charIndex: 4 },
            forceElement: 'postgamevs',
        })).toEqual({ element: 'postgamevs', scoreboard: 2, charIndex: 4 });
    });

    it('draws a forced element even with nothing fed at all', () => {
        expect(resolveFeed({ live: null, forceElement: 'stats' }))
            .toEqual({ element: 'stats' });
    });

    // ?feedsel= supplies CONTENT over that base — the pick the console's Push
    // would show, so a pickable member previews without going on air.
    it('layers ?feedsel= content over the forced element', () => {
        expect(resolveFeed({
            live: { element: 'stats', scoreboard: 1 },
            forceElement: 'postgamecallout',
            previewSel: { scoreboard: 3, charIndex: 7 },
        })).toEqual({ element: 'postgamecallout', scoreboard: 3, charIndex: 7 });
    });

    /*
     * The payload arrives ALREADY SCOPED — the definition's scope is applied by
     * whoever writes the feed key (`_scope_of` server-side, `useMemberScope` for
     * a Push), so a mirrored pair is two scoped definitions rather than two
     * URL-scoped sources of one. Nothing here re-applies it.
     */
    it('passes a scoped payload through without second-guessing it', () => {
        expect(resolveFeed({
            live: { element: 'stats', scoreboard: 4, team: 2, charIndex: 2 },
        })).toEqual({ element: 'stats', scoreboard: 4, team: 2, charIndex: 2 });
    });
});

/*
 * OFFSETS — the anchor that lets a container hold a band.
 *
 * Centering is right for a card and wrong for a ticker: 1920×80 centered in a
 * full-canvas container floats 500px above where a ticker belongs. The anchor
 * carries the INTENT so it survives a resize; x/y are the nudge on top.
 */
describe('memberOffset — anchor plus nudge', () => {
    const band = (offset) => memberOffset(1920, 80, 1920, 1080, offset);

    it('is absent for a container with no offset at all', () => {
        expect(band(null)).toBeNull();
        expect(band(undefined)).toBeNull();
        expect(band('bottom')).toBeNull();          // not an object: ignored
    });

    it('is absent for an explicit centered offset with no nudge', () => {
        // The default expressed rather than omitted still means "leave the flex
        // centering alone" — one code path for the same picture.
        expect(band({ anchor: 'center' })).toBeNull();
        expect(band({ anchor: 'center', x: 0, y: 0 })).toBeNull();
    });

    it('puts a band on the floor of a full-canvas container', () => {
        expect(band({ anchor: 'bottom' })).toEqual({ left: 0, top: 1000 });
    });

    it('reads a bare vertical anchor as horizontally centered', () => {
        expect(memberOffset(800, 460, 1920, 1080, { anchor: 'top' }))
            .toEqual({ left: 560, top: 0 });
    });

    it('takes the corners, in either word order', () => {
        expect(memberOffset(400, 200, 1000, 600, { anchor: 'bottom-right' }))
            .toEqual({ left: 600, top: 400 });
        expect(memberOffset(400, 200, 1000, 600, { anchor: 'right-bottom' }))
            .toEqual({ left: 600, top: 400 });
    });

    it('adds the nudge to the anchor, positive right and down', () => {
        expect(band({ anchor: 'bottom', y: -40 })).toEqual({ left: 0, top: 960 });
        expect(memberOffset(400, 200, 1000, 600, { anchor: 'top-left', x: 24, y: 16 }))
            .toEqual({ left: 24, top: 16 });
    });

    it('nudges from the center when only x/y are given', () => {
        expect(memberOffset(400, 200, 1000, 600, { x: 0, y: 100 }))
            .toEqual({ left: 300, top: 300 });
    });

    it('ignores an anchor it does not know rather than throwing', () => {
        expect(memberOffset(400, 200, 1000, 600, { anchor: 'sideways' }))
            .toEqual({ left: 300, top: 200 });
    });

    it('rides along on memberBox, which still never scales', () => {
        expect(memberBox([1920, 80], { width: 1920, height: 1080 }, { anchor: 'bottom' }))
            .toEqual({ fill: false, width: 1920, height: 80, left: 0, top: 1000 });
        // An overflowing member fills; an offset cannot rescue it or shrink it.
        expect(memberBox([1280, 720], { width: 960, height: 1080 }, { anchor: 'top' }))
            .toEqual({ fill: true, overflow: true });
    });
});

describe('memberBox — native size, centered, never scaled', () => {
    it('gives a member that fits its own native size', () => {
        expect(memberBox([325, 120], { width: 1920, height: 1080 }))
            .toEqual({ fill: false, width: 325, height: 120 });
    });

    it('gives an exactly-sized member the same thing', () => {
        expect(memberBox([1920, 1080], { width: 1920, height: 1080 }))
            .toEqual({ fill: false, width: 1920, height: 1080 });
    });

    /*
     * A member larger than its container is unrepresentable in the console
     * (`fitsContainer` filters it out), but a pre-2.0 named shell can still
     * produce one — split-screen.html is a 960×1080 page hosting a 1280×720 hit.
     * Filling is what that did before containers became definitions, so it
     * degrades to its old behaviour instead of being clipped by a box it
     * overflows.
     */
    it('fills instead of overflowing when the member is bigger than the container', () => {
        expect(memberBox([1280, 720], { width: 960, height: 1080 }))
            .toEqual({ fill: true, overflow: true });
        // One axis is enough.
        expect(memberBox([1280, 720], { width: 1280, height: 700 }).fill).toBe(true);
    });

    it('fills for a member with no native size of its own', () => {
        expect(memberBox(null, { width: 800, height: 600 })).toEqual({ fill: true });
        expect(memberBox([0, 0], { width: 800, height: 600 })).toEqual({ fill: true });
    });

    // No definition to read (a legacy shell whose def is gone): trust the
    // member's own size rather than guessing from the viewport.
    it('trusts the native size when the container size is unknown', () => {
        expect(memberBox([325, 120], null)).toEqual({ fill: false, width: 325, height: 120 });
    });
});

describe('createLayers — the cross-fade', () => {
    const container = { width: 1920, height: 1080 };

    function setup() {
        const a = fakeMember([325, 120]);
        const b = fakeMember([1920, 1080]);
        const h = host();
        const layers = createLayers({
            host: h, container, raf: now,
            registry: { a: a.spec, b: b.spec },
            warn: () => {},
        });
        return { a, b, h, layers };
    }

    const activeOf = (h) => [...h.querySelectorAll('.fc-layer')]
        .filter(l => l.dataset.active === '1').map(l => l.dataset.member);

    /*
     * A member that binds its frame of reference at MOUNT time (the themed stat
     * card closes over sb/team and resolves the line itself) needs the selection
     * that built its layer, not just the box. Pair that with `identity` — as the
     * stat card does — or a scope change updates a layer bound to the old side.
     */
    it('hands the mount the selection that built its layer', async () => {
        const a = fakeMember([325, 120]);
        const layers = createLayers({
            host: host(), container, raf: now, warn: () => {},
            registry: {
                a: { ...a.spec, identity: (sel) => `a:${sel.team}` },
            },
        });
        await layers.show('a', { element: 'a', scoreboard: 1, team: 2 }, {});
        expect(a.calls.mountedWith).toEqual({ element: 'a', scoreboard: 1, team: 2 });
        // A different side is a different layer, not an update on this one.
        await layers.show('a', { element: 'a', scoreboard: 1, team: 1 }, {});
        expect(a.calls.mounts).toBe(2);
    });

    it('mounts a member lazily, on first show', async () => {
        const { a, b, layers } = setup();
        expect(a.calls.mounts).toBe(0);
        await layers.show('a', { element: 'a' }, {});
        expect(a.calls.mounts).toBe(1);
        // The member never shown is never built — a mounted-but-idle GL context
        // or GSAP timeline costs the broadcast for nothing.
        expect(b.calls.mounts).toBe(0);
    });

    /*
     * The heart of it: swapping RETAINS the outgoing member. Tearing it down and
     * rebuilding the incoming one is a hard cut, which is disqualifying for a
     * container an automation flips several times an inning.
     */
    it('keeps both members mounted across a swap', async () => {
        const { a, b, h, layers } = setup();
        await layers.show('a', { element: 'a' }, {});
        await layers.show('b', { element: 'b' }, {});

        expect(h.querySelectorAll('.fc-layer')).toHaveLength(2);
        expect(a.calls.disposes).toBe(0);
        expect(b.calls.mounts).toBe(1);
        expect(activeOf(h)).toEqual(['b']);
    });

    it('reveals exactly one member at a time', async () => {
        const { h, layers } = setup();
        await layers.show('a', { element: 'a' }, {});
        expect(activeOf(h)).toEqual(['a']);
        await layers.show('b', { element: 'b' }, {});
        expect(activeOf(h)).toEqual(['b']);
        expect(layers.active().element).toBe('b');
    });

    /*
     * Only the member on screen is updated. A cross-fade wants a still frame to
     * fade out of, not a member re-rendering behind its own dissolve — and a
     * hidden member re-reading a HUD feed is pure cost.
     */
    it('updates only the active member', async () => {
        const { a, b, layers } = setup();
        await layers.show('a', { element: 'a', n: 1 }, {});
        await layers.show('b', { element: 'b', n: 2 }, {});
        await layers.show('b', { element: 'b', n: 3 }, {});

        expect(a.calls.updates).toHaveLength(1);
        expect(b.calls.updates.map(u => u.n)).toEqual([2, 3]);
    });

    it('draws the incoming member before revealing it', async () => {
        const { b, h, layers } = setup();
        await layers.show('a', { element: 'a' }, {});
        // The update has to land while the layer is still dark, or the fade
        // brings up a stale frame and then pops.
        b.spec.mount = ((orig) => (box) => {
            const m = orig(box);
            return {
                ...m,
                update: (s, p) => {
                    expect(activeOf(h)).toEqual(['a']);
                    m.update(s, p);
                },
            };
        })(b.spec.mount);
        await layers.show('b', { element: 'b' }, {});
        expect(activeOf(h)).toEqual(['b']);
    });

    // A member returning from idle re-enters with its own animation; a freshly
    // built one already played it on mount.
    it('replays a member coming back from idle, but not a new one', async () => {
        const { a, layers } = setup();
        await layers.show('a', { element: 'a' }, {});
        expect(a.calls.replays).toBe(0);
        await layers.show('b', { element: 'b' }, {});
        await layers.show('a', { element: 'a' }, {});
        expect(a.calls.replays).toBe(1);
    });

    it('does not replay while a member simply stays up', async () => {
        const { a, layers } = setup();
        await layers.show('a', { element: 'a' }, {});
        await layers.show('a', { element: 'a' }, {});
        await layers.show('a', { element: 'a' }, {});
        expect(a.calls.replays).toBe(0);
    });

    it('fades everything out on clear, without unmounting', async () => {
        const { a, h, layers } = setup();
        await layers.show('a', { element: 'a' }, {});
        layers.clear();
        expect(activeOf(h)).toEqual([]);
        expect(layers.active()).toBeNull();
        expect(a.calls.disposes).toBe(0);
        expect(h.querySelectorAll('.fc-layer')).toHaveLength(1);
    });

    /*
     * The reveal is CSS: the engine only flips `data-active`, and the stylesheet
     * turns that into opacity. So the attribute the code writes and the selector
     * the CSS matches have to be the same string — a typo in either leaves every
     * layer at full opacity, stacked, with every attribute-level assertion in
     * this file still passing. (Found the hard way: a hidden tab freezes CSS
     * transitions at their start value, so a browser check of computed opacity
     * proves nothing either.)
     */
    it('pins the attribute the engine writes to the selector the CSS matches', async () => {
        const { h, layers } = setup();
        await layers.show('a', { element: 'a' }, {});
        await layers.show('b', { element: 'b' }, {});

        const css = document.getElementById('container-layers-css').textContent;
        // Dark by default…
        expect(css).toMatch(/\.fc-layer\s*\{[^}]*opacity:\s*0\s*;/);
        // …lit only by the exact attribute set below, and only via a transition.
        expect(css).toMatch(/\.fc-layer\[data-active="1"\]\s*\{\s*opacity:\s*1\s*;?\s*\}/);
        expect(css).toMatch(/transition:\s*opacity/);
        /*
         * And never `will-change`: it would pin every layer to its own composited
         * layer for the life of the page, and a resident composited layer is
         * rastered once then GPU-scaled — the same thing that made the
         * scoreboard's meld blurry after its first animation.
         */
        expect(css).not.toMatch(/will-change/);

        const active = h.querySelector('.fc-layer[data-active="1"]');
        expect(active.dataset.member).toBe('b');
        expect(h.querySelectorAll('.fc-layer[data-active="1"]')).toHaveLength(1);
    });

    it('sizes a smaller member to its native box and centers it', async () => {
        const { a, layers } = setup();
        await layers.show('a', { element: 'a' }, {});
        const box = a.calls.box;
        expect(box.style.width).toBe('325px');
        expect(box.style.height).toBe('120px');
        expect(box.classList.contains('fc-fill')).toBe(false);
        // Centering is the layer's job, so every member gets it for free.
        const css = document.getElementById('container-layers-css').textContent;
        expect(css).toMatch(/align-items: center/);
        expect(css).toMatch(/justify-content: center/);
    });

    it('fills the box for an overflowing member and says so once', async () => {
        const warn = vi.fn();
        const big = fakeMember([1920, 1080]);
        const h = host();
        const layers = createLayers({
            host: h, container: { width: 960, height: 1080 },
            registry: { big: big.spec }, raf: now, warn,
        });
        await layers.show('big', { element: 'big' }, {});
        expect(big.calls.box.classList.contains('fc-fill')).toBe(true);
        expect(big.calls.box.style.width).toBe('');
        expect(warn).toHaveBeenCalledTimes(1);
    });

    /*
     * A member that needs more than one layer says so with `identity`. The hit
     * visualizer caches stadium geometry and playback per board, so a board
     * change has to be a separate mount rather than an update.
     */
    it('gives a member one layer per identity', async () => {
        const hit = fakeMember([1280, 720]);
        hit.spec.identity = (sel) => `hit:${sel.scoreboard}`;
        hit.spec.payload = (sel) => sel.scoreboard;
        const h = host();
        const layers = createLayers({ host: h, container, registry: { hit: hit.spec }, raf: now });

        await layers.show('hit', { element: 'hit', scoreboard: 1 }, {});
        await layers.show('hit', { element: 'hit', scoreboard: 2 }, {});
        expect(hit.calls.mounts).toBe(2);
        expect(h.querySelectorAll('.fc-layer')).toHaveLength(2);
        // …and the payload is what that member's update actually takes.
        expect(hit.calls.updates).toEqual([1, 2]);

        // Back to board 1: the existing layer, not a third mount.
        await layers.show('hit', { element: 'hit', scoreboard: 1 }, {});
        expect(hit.calls.mounts).toBe(2);
    });

    it('reports a member it cannot mount rather than throwing', async () => {
        const { h, layers } = setup();
        expect(await layers.show('nope', { element: 'nope' }, {})).toBe(false);
        expect(h.querySelectorAll('.fc-layer')).toHaveLength(0);
    });

    // A member that cannot stand up must not take the container with it: the
    // source stays alive and the next feed still draws.
    it('survives a member whose mount throws', async () => {
        const bad = fakeMember([325, 120], { fail: true });
        const good = fakeMember([325, 120]);
        const h = host();
        const layers = createLayers({
            host: h, container, raf: now, warn: () => {},
            registry: { bad: bad.spec, good: good.spec },
        });
        expect(await layers.show('bad', { element: 'bad' }, {})).toBe(false);
        expect(h.querySelectorAll('.fc-layer')).toHaveLength(0);
        expect(await layers.show('good', { element: 'good' }, {})).toBe(true);
        expect(activeOf(h)).toEqual(['good']);
    });

    it('disposes every member it stood up', async () => {
        const { a, b, h, layers } = setup();
        await layers.show('a', { element: 'a' }, {});
        await layers.show('b', { element: 'b' }, {});
        layers.dispose();
        expect(a.calls.disposes).toBe(1);
        expect(b.calls.disposes).toBe(1);
        expect(h.children).toHaveLength(0);
        expect(layers.active()).toBeNull();
    });
});
