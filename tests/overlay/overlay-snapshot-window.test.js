import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/*
 * The full-state snapshot an overlay asks for on connect is a ROUND TRIP, and
 * PRSH pushes throughout it. `refill` clears the state object and repopulates
 * it from a response assembled before those pushes happened — so an update that
 * lands in that window is erased by the very reply meant to bring the source up
 * to date.
 *
 * This is not a launch-only edge. The OBS animation contract sets `shutdown` on
 * animated browser sources, so a source RELOADS every time it is shown, and a
 * reconnect after a network blip runs the same handshake again. A score key
 * heals on the next HUD frame; a match binding, a container feed or a name
 * override just stays wrong for the rest of the broadcast.
 *
 * overlay-base.js is an IIFE meant for a <script> tag, so it is evaluated here
 * against jsdom with `io` and `fetch` stubbed — the same file OBS loads, not a
 * copy of its logic.
 */

const SRC = readFileSync('public/layout/lib/overlay-base.js', 'utf8');

// Minimal socket.io double. `emit(event, data, cb)` HOLDS the callback so the
// test can decide when the snapshot comes back — that gap is the whole subject.
class FakeSocket {
    constructor() {
        this.handlers = {};
        this.id = 'overlay-sid';
        this.held = {};
    }
    on(e, fn) { (this.handlers[e] ||= []).push(fn); }
    off(e, fn) { if (this.handlers[e]) this.handlers[e] = this.handlers[e].filter(x => x !== fn); }
    emit(e, _data, cb) { if (cb) this.held[e] = cb; }
    connect() { (this.handlers['connect'] || []).forEach(fn => fn()); }
    server(e, payload) { (this.handlers[e] || []).forEach(fn => fn(payload)); }
    reply(e, payload) { const cb = this.held[e]; delete this.held[e]; cb(payload); }
}

let socket;

async function loadOverlayBase() {
    socket = new FakeSocket();
    vi.stubGlobal('io', () => socket);
    // No server here; init() catches the failure and carries on to the socket.
    vi.stubGlobal('fetch', () => Promise.reject(new Error('no server in test')));
    delete window.OverlayBase;
    new Function(SRC)();
    await window.OverlayBase.init({ render: () => {} });
    return window.OverlayBase;
}

beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('an overlay across the state snapshot round trip', () => {
    it('keeps an update that lands while v1.state.get is in flight', async () => {
        const OB = await loadOverlayBase();
        socket.connect();                       // asks for the snapshot

        socket.server('v1.state.set', { key: 'score.1.match', value: 9 });
        socket.server('v1.state.set_batch', {
            items: [{ key: 'score.1.batter', value: 'Mario' }],
        });

        // The snapshot the server assembled BEFORE those pushes.
        socket.reply('v1.state.get', { score: { 1: { match: 4, batter: '' } } });

        expect(OB.deepGet(OB.state, 'score.1.match')).toBe(9);
        expect(OB.deepGet(OB.state, 'score.1.batter')).toBe('Mario');
    });

    it('keeps a clear that lands while v1.state.get is in flight', async () => {
        // The mirror case, and the worse one: a producer clearing a container
        // feed mid-handshake had the snapshot put the old occupant back up.
        const OB = await loadOverlayBase();
        socket.connect();

        socket.server('v1.state.unset', { key: 'production.feed.container.lower' });
        socket.reply('v1.state.get', {
            production: { feed: { container: { lower: { element: 'stats' } } } },
        });

        expect(OB.deepGet(OB.state, 'production.feed.container.lower')).toBeUndefined();
    });

    it('lets the snapshot win for keys nothing pushed', async () => {
        // Replay is a patch on top, not a replacement: the snapshot is still
        // how a source learns everything it was not told about.
        const OB = await loadOverlayBase();
        socket.connect();
        socket.server('v1.state.set', { key: 'score.1.batter', value: 'Mario' });
        socket.reply('v1.state.get', { score: { 1: { batter: '', inning: 7 } } });

        expect(OB.deepGet(OB.state, 'score.1.inning')).toBe(7);
    });

    it('does not replay those events into the NEXT reconnect', async () => {
        const OB = await loadOverlayBase();
        socket.connect();
        socket.server('v1.state.set', { key: 'score.1.batter', value: 'Mario' });
        socket.reply('v1.state.get', { score: { 1: { batter: '' } } });
        expect(OB.deepGet(OB.state, 'score.1.batter')).toBe('Mario');

        // A blip: the buffer must be empty, so the fresh snapshot stands alone.
        socket.connect();
        socket.reply('v1.state.get', { score: { 1: { batter: 'Peach' } } });
        expect(OB.deepGet(OB.state, 'score.1.batter')).toBe('Peach');
    });
});
