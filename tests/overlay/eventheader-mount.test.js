// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { settingOn } from '../../src/routes/design/designConstants';

// The Event Header recomputes from the page rather than waiting for a reload.
// jsdom has no canvas, FontFaceSet or ResizeObserver, so all three are stubbed.

let capPx, faceLoaded, fontListeners, observers;

beforeEach(() => {
    vi.resetModules();   // the cap cache is module-level
    document.body.innerHTML = document.head.innerHTML = '';
    const deepGet = (o, path, def) => path.split('.').reduce((c, k) => c?.[k], o) ?? def;
    globalThis.OverlayBase = { deepGet, settingOn, applyDesignSettings: () => {} };

    capPx = 140;   // cap height the probe reports, at its 200px probe size
    faceLoaded = true;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
        measureText: () => ({
            fontBoundingBoxAscent: 180, fontBoundingBoxDescent: 40, actualBoundingBoxAscent: capPx,
        }),
    }));
    fontListeners = [];
    Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: {
            check: () => faceLoaded,
            ready: new Promise(() => {}),
            addEventListener: (_, fn) => fontListeners.push(fn),
            removeEventListener: () => {},
        },
    });
    observers = [];
    globalThis.ResizeObserver = class {
        constructor(cb) { this.cb = cb; this.targets = []; observers.push(this); }
        observe(el) { this.targets.push(el); }
        disconnect() {}
    };
});

afterEach(() => {
    vi.restoreAllMocks();
    delete document.fonts;
    delete globalThis.ResizeObserver;
});

async function mount(eventheader = {}) {
    const { mountEventHeader } = await import('../../public/layout/lib/eventheader-mount.js');
    const host = document.body.appendChild(document.createElement('div'));
    mountEventHeader({ host }).update({}, { overlays: { eventheader } });
    const stage = host.querySelector('.eh-stage');
    return {
        stage,
        cap: () => stage.style.getPropertyValue('--eh-cap'),
        resize: () => observers.forEach(o => o.cb([])),
    };
}

describe('event header mount', () => {
    it('scales each band by its own type size, not the stage', async () => {
        const { stage } = await mount({ headerFontSize: 34, footerFontSize: 51 });
        expect(stage.querySelector('.eh-header').style.getPropertyValue('--font-scale')).toBe('1');
        expect(stage.querySelector('.eh-footer').style.getPropertyValue('--font-scale')).toBe('1.5');
        expect(stage.style.getPropertyValue('--font-scale')).toBe('');
    });

    it('seats the platform mark on the measured cap height', async () => {
        const { cap } = await mount();
        expect(cap()).toBe('0.7000em');
        expect(document.getElementById('eventheader-mount-css').textContent).toContain('var(--eh-cap');
    });

    it('leaves the CSS fallback for a face it cannot measure', async () => {
        capPx = 0;
        expect((await mount()).cap()).toBe('');
    });

    it('re-measures until the real face has loaded', async () => {
        faceLoaded = false;
        const { cap, resize } = await mount();
        capPx = 130;
        resize();
        expect(cap()).toBe('0.6500em');
    });

    it('caches a loaded face until a font lands', async () => {
        const { cap, resize } = await mount();
        capPx = 130;
        resize();
        expect(cap()).toBe('0.7000em');
        fontListeners.forEach(fn => fn());
        expect(cap()).toBe('0.6500em');
    });

    it('re-fits the stage when its host resizes', async () => {
        const { stage, resize } = await mount();
        const root = stage.parentElement;
        expect(observers.some(o => o.targets.includes(root))).toBe(true);
        Object.defineProperty(root, 'clientWidth', { value: 960 });
        Object.defineProperty(root, 'clientHeight', { value: 540 });
        resize();
        expect(stage.style.transform).toBe('scale(0.5)');
    });
});
