import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import ScaledIframe, { fitBox, boxHeight } from './ScaledIframe';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const frame = (title = 'Layout preview') => screen.getByTitle(title);

// jsdom gives every element a 0×0 box, so the container has to be faked for
// anything size-related to mean something.
function stubContainer(width, height) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockReturnValue({ width, height, top: 0, left: 0, right: width, bottom: height });
}

// The global stub in src/test/setup.js is a no-op, which makes any resize test
// silently vacuous — it passes because nothing ever recalculates. These tests
// are about what happens ON a resize, so they need a real one.
let observers = [];
beforeEach(() => {
    observers = [];
    global.ResizeObserver = class {
        constructor(cb) { this.cb = cb; observers.push(this); }
        observe() {}
        disconnect() { observers = observers.filter(o => o !== this); }
    };
});

// Resize the container to `width` and deliver the observation.
function resizeTo(width, height) {
    stubContainer(width, height);
    act(() => { observers.forEach(o => o.cb([{ contentRect: { width } }])); });
}

/*
 * The sizing contract.
 *
 * A preview is the overlay rendered as a SMALLER BROWSER SOURCE — the iframe is
 * sized to the largest box of the right aspect that fits, and the overlay lays
 * itself out against it exactly as it does for OBS. Nothing is zoomed or
 * transformed; there is one coordinate system.
 *
 * Two earlier approaches are pinned against here by their absence:
 * `transform: scale()` (rasters once, stays blurry) and `zoom` (gives the inner
 * document a viewport that is neither the native size nor the box size, which
 * had the matchup band drawing at ~40% of its authored width).
 *
 * The iframe must also never be created at the wrong size: several mounts lay
 * out ONCE at init off `window.innerWidth`, so a corrected-later iframe has
 * already lost.
 */
describe('fitBox', () => {
    it('fits to width when the container is the limiting dimension', () => {
        expect(fitBox({ width: 960, height: 1000 }, { w: 1920, h: 1080 }))
            .toEqual({ w: 960, h: 540 });
    });

    it('fits to height when the container is short', () => {
        expect(fitBox({ width: 4000, height: 540 }, { w: 1920, h: 1080 }))
            .toEqual({ w: 960, h: 540 });
    });

    it('preserves aspect for a wide, short overlay (the ticker)', () => {
        expect(fitBox({ width: 960, height: 560 }, { w: 1920, h: 80 }))
            .toEqual({ w: 960, h: 40 });
    });

    it('refuses a zero-size container instead of returning a 0-px box', () => {
        expect(fitBox({ width: 0, height: 0 }, { w: 1920, h: 1080 })).toBeNull();
        expect(fitBox({ width: 900, height: 500 }, null)).toBeNull();
    });
});

/*
 * Height comes from WIDTH alone, and only this component computes it.
 *
 * The regression these guard: the Production preview used to wrap the iframe in
 * a box shaped by CSS `aspect-ratio` + `max-height`, so wrapper and iframe each
 * derived the height. They agreed until the cap engaged — a stage wider than
 * ~995px for a 16:9 element — and then the ResizeObserver between them
 * oscillated, clipping the overlay at the bottom and right and hanging the
 * renderer. Height must never be an input to computing height.
 */
describe('boxHeight', () => {
    it('gives the element its own shape when it fits under the cap', () => {
        expect(boxHeight(871, { w: 1920, h: 1080 }, 140, 560)).toBe(490);
    });

    it('caps a wide stage instead of growing past the panel', () => {
        // 1065 / (16/9) = 599 — the width at which the old two-authority
        // layout started to fight itself.
        expect(boxHeight(1065, { w: 1920, h: 1080 }, 140, 560)).toBe(560);
    });

    it('floors a wide, flat overlay so a ticker is not a sliver', () => {
        expect(boxHeight(960, { w: 1920, h: 80 }, 140, 560)).toBe(140);
    });

    it('refuses a zero width rather than returning a zero-height box', () => {
        expect(boxHeight(0, { w: 1920, h: 1080 }, 140, 560)).toBeNull();
        expect(boxHeight(960, null, 140, 560)).toBeNull();
    });
});

describe('ScaledIframe sizing', () => {
    it('shapes its own capped box, and the iframe fits inside it', () => {
        stubContainer(1065, 560);
        render(
            <ScaledIframe
                src="/layout/x.html" nativeWidth={1920} nativeHeight={1080}
                minHeight={140} maxHeight={560}
            />,
        );
        const el = frame();
        // Capped to 560 tall, so the iframe letterboxes horizontally — it must
        // NOT be 1065×599, which is what overflowed the box and clipped the
        // overlay at the bottom and right.
        expect(el.style.height).toBe('560px');
        expect(el.style.width).toBe('996px');
        expect(el.parentElement.style.height).toBe('560px');
    });

    it('holds its height when a scrollbar appears, so the window cannot shake', () => {
        // The document-level cycle: a taller box makes the page taller, the
        // scrollbar appears, the viewport narrows ~15px, the box shortens, the
        // scrollbar goes. index.css reserves the gutter so this cannot start;
        // the threshold here is the backstop, and a scrollbar-sized change must
        // not move the box.
        stubContainer(900, 506);
        render(
            <ScaledIframe
                src="/layout/x.html" nativeWidth={1920} nativeHeight={1080}
                minHeight={140} maxHeight={560}
            />,
        );
        const settled = frame().parentElement.style.height;
        expect(settled).toBe('506px');
        resizeTo(885, 506);   // the scrollbar takes 15px
        expect(frame().parentElement.style.height).toBe(settled);
    });

    it('still re-shapes for a resize a person actually meant', () => {
        stubContainer(900, 506);
        render(
            <ScaledIframe
                src="/layout/x.html" nativeWidth={1920} nativeHeight={1080}
                minHeight={140} maxHeight={560}
            />,
        );
        resizeTo(600, 506);
        expect(frame().parentElement.style.height).toBe('338px');
    });

    it('tracks a slow drag, because drift accumulates against one baseline', () => {
        stubContainer(900, 506);
        render(
            <ScaledIframe
                src="/layout/x.html" nativeWidth={1920} nativeHeight={1080}
                minHeight={140} maxHeight={560}
            />,
        );
        // Every step is under the threshold on its own. Measured against the
        // width the box was last shaped at, the drift crosses at 870 (30px) and
        // it re-shapes there, re-baselining — so 860 is 10px out and holds. The
        // box trails a drag by less than the threshold; it never sticks.
        [890, 880, 870, 860].forEach(w => resizeTo(w, 506));
        expect(frame().parentElement.style.height).toBe('489px');   // 870-wide
    });

    it('ignores height-only container changes, so it cannot oscillate', () => {
        stubContainer(1065, 560);
        const { rerender } = render(
            <ScaledIframe
                src="/layout/x.html" nativeWidth={1920} nativeHeight={1080}
                minHeight={140} maxHeight={560}
            />,
        );
        // Same width, different height — the loop's feedback edge.
        stubContainer(1065, 599);
        rerender(
            <ScaledIframe
                src="/layout/x.html" nativeWidth={1920} nativeHeight={1080}
                minHeight={140} maxHeight={560}
            />,
        );
        expect(frame().style.height).toBe('560px');
    });

    it('renders the iframe at the fitted size, in true pixels', () => {
        stubContainer(960, 600);
        render(<ScaledIframe src="/layout/x.html" nativeWidth={1920} nativeHeight={1080} />);
        const el = frame();
        // Synchronous: an await here would hide the create-at-wrong-size bug
        // this test exists to prevent.
        expect(el.style.width).toBe('960px');
        expect(el.style.height).toBe('540px');
        expect(el.style.opacity).toBe('1');
    });

    it('never zooms or transforms — the overlay scales itself', () => {
        stubContainer(960, 600);
        render(<ScaledIframe src="/layout/x.html" nativeWidth={1920} nativeHeight={1080} />);
        expect(frame().style.zoom).toBe('');
        expect(frame().style.transform).toBe('');
    });

    it('keeps the last good box when the container collapses to zero', () => {
        stubContainer(960, 600);
        const { rerender } = render(
            <ScaledIframe src="/layout/x.html" nativeWidth={1920} nativeHeight={1080} />);
        stubContainer(0, 0);
        rerender(<ScaledIframe src="/layout/y.html" nativeWidth={1920} nativeHeight={1080} />);
        expect(frame().style.width).toBe('960px');
    });

    it('probes at 1px, hidden, only when it has no declared aspect', () => {
        stubContainer(960, 600);
        render(<ScaledIframe src="/layout/x.html" />);
        const el = frame();
        expect(el.style.width).toBe('1px');
        expect(el.style.opacity).toBe('0');
    });

    it('ignores a partial declared size rather than trusting half of it', () => {
        stubContainer(960, 600);
        render(<ScaledIframe src="/layout/x.html" nativeWidth={1920} nativeHeight={0} />);
        expect(frame().style.width).toBe('1px');   // fell back to probing
    });
});
