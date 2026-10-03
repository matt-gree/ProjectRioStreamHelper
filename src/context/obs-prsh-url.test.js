import { describe, it, expect, vi } from 'vitest';

vi.mock('obs-websocket-js', () => ({ default: class {}, EventSubscription: { All: 0, SceneItemTransformChanged: 0 } }));

const { isPrshUrl, setGcLegacyPorts } = await import('./obs');

// Which browser sources are PRSH's. The address repair REWRITES what this
// claims, so a false positive is someone else's source rewritten.
describe('isPrshUrl', () => {
    it('claims PRSH layouts and the gc-overlay proxy, on any host', () => {
        expect(isPrshUrl('http://127.0.0.1:5260/layout/scoreboard1/scoreboard.html')).toBe(true);
        expect(isPrshUrl('http://192.168.1.20:5391/gc/?port=1')).toBe(true);
    });

    it('claims a pre-proxy gc-overlay source only on a port PRSH has on record', () => {
        setGcLegacyPorts([8069]);
        expect(isPrshUrl('http://localhost:8069/?port=2&bg=transparent&gear=0')).toBe(true);
        expect(isPrshUrl('http://localhost:8070/?port=1')).toBe(false);
        // The old setting recorded 8070: now it's one of ours.
        setGcLegacyPorts([8069, 8070]);
        expect(isPrshUrl('http://localhost:8070/?port=1')).toBe(true);
        setGcLegacyPorts([8069]);
    });

    it('never claims a producer\'s own tool that happens to sit on a nearby port', () => {
        expect(isPrshUrl('http://localhost:8080/')).toBe(false);
        expect(isPrshUrl('http://localhost:8080/chat?port=1')).toBe(false);
        expect(isPrshUrl('http://localhost:8069/overlay')).toBe(false);
        expect(isPrshUrl('http://localhost:8069/?port=7&bg=transparent')).toBe(false);
        expect(isPrshUrl('file:///Users/me/overlay.html')).toBe(false);
    });
});
