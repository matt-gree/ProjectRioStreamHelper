import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRevealGate } from '../../public/layout/lib/reveal-gate.js';

/*
 * The show/hide sequencing every animated overlay shares.
 *
 * All three rules below are invisible in a browser and only wrong inside OBS,
 * which is exactly why they need pinning here: a reveal that plays a frame too
 * early looks perfect on a dev machine and shows the finished graphic for a
 * beat before its own intro on air.
 *
 * `restingIsShown` is the newest of them, and the one with a second failure
 * mode: the post-game callouts' resting DOM is zeroed counters and collapsed
 * bars, so honouring `?intro=0` there would not skip an animation, it would
 * publish a broken graphic.
 */

function rig(opts = {}) {
    const host = document.createElement('div');
    host.className = 'x-host x-off';
    document.body.appendChild(host);
    const play = vi.fn();
    const gate = createRevealGate({ host, offClass: 'x-off', play, ...opts });
    return { host, play, gate, off: () => host.classList.contains('x-off') };
}

// rAF in jsdom is a timer; run it plus the gate's settle window.
const frame = async () => { await vi.advanceTimersByTimeAsync(150); };

describe('createRevealGate', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        window.history.replaceState({}, '', '/');
    });

    it('holds the host dark until the reveal actually runs, on the paint clock', async () => {
        const { play, off, gate } = rig();
        gate.requestReveal();
        // Same task as the content build: nothing has painted, nothing plays.
        expect(play).not.toHaveBeenCalled();
        expect(off()).toBe(true);
        await frame();
        expect(play).toHaveBeenCalledTimes(1);
        expect(off()).toBe(false);
    });

    it('snaps dark on hide and plays exactly once on the next show', async () => {
        const { play, off, gate } = rig();
        gate.requestReveal();
        await frame();
        play.mockClear();

        gate.setShown(false);
        expect(off()).toBe(true);          // synchronous — before OBS stops frames
        // OBS's on→off→on dispatch burst must collapse to one reveal.
        gate.setShown(true);
        gate.setShown(true);
        await frame();
        expect(play).toHaveBeenCalledTimes(1);
    });

    it('ignores the redundant activate OBS dispatches after load', async () => {
        const { play, gate } = rig();
        gate.requestReveal();
        await frame();
        play.mockClear();
        gate.setShown(true);               // never went off-screen
        await frame();
        expect(play).not.toHaveBeenCalled();
    });

    describe('?intro=0', () => {
        beforeEach(() => window.history.replaceState({}, '', '/?intro=0'));

        it('is a pass-through when the resting CSS is the shown state', async () => {
            const { play, off, gate } = rig();
            expect(off()).toBe(false);     // content visible with no reveal
            gate.requestReveal();
            gate.setShown(false);
            await frame();
            expect(play).not.toHaveBeenCalled();
            expect(off()).toBe(false);     // and a hide can never gate it dark
        });

        it('is ignored when the reveal IS the content (restingIsShown: false)', async () => {
            const { play, off, gate } = rig({ restingIsShown: false });
            expect(off()).toBe(true);
            gate.requestReveal();
            await frame();
            expect(play).toHaveBeenCalledTimes(1);
            expect(off()).toBe(false);
        });
    });
});
