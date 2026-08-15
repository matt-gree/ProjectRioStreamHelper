import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { useStateStore, useSettingsStore, useConfigStore } from './store';

// io() must return our fake; vi.hoisted gives the mock factory a stable holder.
const h = vi.hoisted(() => ({ socket: null }));
vi.mock('socket.io-client', () => ({ io: () => h.socket }));

import { SocketProvider } from './socket';

// Minimal socket.io double: records handlers, resolves emit-with-callback RPCs,
// and lets a test simulate a server push via .server().
class FakeSocket {
    constructor() {
        this.handlers = {};
        this.id = 'self-sid';
        this.connected = false;
        this.rpc = { 'v1.state.get': {}, 'v1.settings.get': {}, 'v1.config.get': {} };
        this.defer = new Set();   // events whose callback the test will resolve
        this.held = {};
    }
    on(e, fn) { (this.handlers[e] ||= []).push(fn); }
    off(e, fn) { if (this.handlers[e]) this.handlers[e] = this.handlers[e].filter(x => x !== fn); }
    removeAllListeners() { this.handlers = {}; }
    connect() { this.connected = true; }
    close() { this.connected = false; }
    emit(e, _data, cb) {
        if (!cb) return;
        // A held RPC models the real thing: v1.state.get is a round trip, and
        // the server keeps pushing while it is in flight.
        if (this.defer.has(e)) { this.held[e] = cb; return; }
        cb(this.rpc[e] ?? {});
    }
    resolve(e, payload) { const cb = this.held[e]; delete this.held[e]; cb(payload ?? this.rpc[e] ?? {}); }
    server(e, payload) { (this.handlers[e] || []).forEach(fn => fn(payload)); }
}

const STATE_INIT = useStateStore.getState();
const SETTINGS_INIT = useSettingsStore.getState();
const CONFIG_INIT = useConfigStore.getState();

beforeEach(() => {
    useStateStore.setState(STATE_INIT, true);
    useSettingsStore.setState(SETTINGS_INIT, true);
    useConfigStore.setState(CONFIG_INIT, true);
    h.socket = new FakeSocket();
    // Deterministic rAF so flushes don't depend on jsdom's visual loop.
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

async function renderProvider() {
    render(<SocketProvider><div /></SocketProvider>);
    // Initial v1.state.get resolves synchronously in FakeSocket → loaded flips.
    await waitFor(() => expect(useStateStore.getState().loaded).toBe(true));
}

describe('SocketProvider', () => {
    it('fetches and merges full state on connect', async () => {
        h.socket.rpc['v1.state.get'] = { score: { 1: { inning: 4 } } };
        await renderProvider();
        expect(useStateStore.getState().getItem('score.1.inning')).toBe(4);
    });

    it('applies an incoming v1.state.set after a frame', async () => {
        await renderProvider();
        h.socket.server('v1.state.set', { key: 'score.1.batter', value: 'Mario' });
        await waitFor(() =>
            expect(useStateStore.getState().getItem('score.1.batter')).toBe('Mario'));
    });

    it('ignores echoes of its own session id', async () => {
        await renderProvider();
        h.socket.server('v1.state.set', { key: 'x', value: 'y', sid: h.socket.id });
        // Give the (non-)flush a chance to run, then assert it never applied.
        await new Promise(r => setTimeout(r, 10));
        expect(useStateStore.getState().getItem('x')).toBeUndefined();
    });

    it('coalesces multiple events into a single store update', async () => {
        await renderProvider();
        const updates = [];
        const unsub = useStateStore.subscribe(() => updates.push(1));
        h.socket.server('v1.state.set', { key: 'a', value: 1 });
        h.socket.server('v1.state.set', { key: 'b', value: 2 });
        await waitFor(() => expect(useStateStore.getState().getItem('b')).toBe(2));
        expect(useStateStore.getState().getItem('a')).toBe(1);
        expect(updates.length).toBe(1); // both events flushed in one set()
        unsub();
    });

    it('applies a v1.state.set_batch frame', async () => {
        await renderProvider();
        h.socket.server('v1.state.set_batch', {
            items: [{ key: 'p.1', value: 'A' }, { key: 'p.2', value: 'B' }],
        });
        await waitFor(() => expect(useStateStore.getState().getItem('p.2')).toBe('B'));
        expect(useStateStore.getState().getItem('p.1')).toBe('A');
    });

    it('ignores a set_batch echo of its own session id', async () => {
        await renderProvider();
        h.socket.server('v1.state.set_batch', {
            sid: h.socket.id,
            items: [{ key: 'echo', value: 1 }],
        });
        await new Promise(r => setTimeout(r, 10));
        expect(useStateStore.getState().getItem('echo')).toBeUndefined();
    });

    /*
     * ECHO SUPPRESSION IS ABOUT WHAT WE WROTE, AND `augmented` IS NOT THAT.
     *
     * A server write-path hook decides things off our write and rides them back
     * in the same frame (server/state.py `_augment`). They used to be mixed into
     * `items`, so the sid guard dropped them — and the live case was the worst
     * one: a producer's Push made the automation engine answer with
     * `production.feed.reason.{container} = manual`, and that producer's console
     * went on reporting the container as resting (rules still running) while
     * every other browser had it right.
     */
    it('takes the server’s augmented keys even on its own echo', async () => {
        await renderProvider();
        h.socket.server('v1.state.set_batch', {
            sid: h.socket.id,
            items: [{ key: 'production.feed.container.c', value: { element: 'stats' } }],
            augmented: [{ key: 'production.feed.reason.c', value: 'manual' }],
        });
        await waitFor(() =>
            expect(useStateStore.getState().getItem('production.feed.reason.c')).toBe('manual'));
        // …and still not the half we wrote ourselves.
        expect(useStateStore.getState().getItem('production.feed.container.c')).toBeUndefined();
    });

    it('takes both lists from another client’s frame', async () => {
        await renderProvider();
        h.socket.server('v1.state.set_batch', {
            items: [{ key: 'theirs', value: 1 }],
            augmented: [{ key: 'derived', value: 2 }],
        });
        await waitFor(() => expect(useStateStore.getState().getItem('derived')).toBe(2));
        expect(useStateStore.getState().getItem('theirs')).toBe(1);
    });

    it('applies v1.state.unset and unset_batch', async () => {
        h.socket.rpc['v1.state.get'] = { score: { 1: { a: 1, b: 2, c: 3 } } };
        await renderProvider();
        h.socket.server('v1.state.unset', { key: 'score.1.a' });
        h.socket.server('v1.state.unset_batch',
            { items: [{ key: 'score.1.b' }, { key: 'score.1.c' }] });
        await waitFor(() =>
            expect(useStateStore.getState().getItem('score.1.c')).toBeUndefined());
        expect(useStateStore.getState().getItem('score.1.a')).toBeUndefined();
        expect(useStateStore.getState().getItem('score.1.b')).toBeUndefined();
    });

    it('unset removes a top-level (single-segment) key too', async () => {
        // why: Zustand's set() merges by default, and a merge can never
        // remove a top-level key — deletion must use replace mode, or an
        // unset of e.g. "matchup" leaves the stale object behind.
        h.socket.rpc['v1.state.get'] = { matchup: { present: true }, keep: 1 };
        await renderProvider();
        h.socket.server('v1.state.unset', { key: 'matchup' });
        await waitFor(() =>
            expect(useStateStore.getState().getItem('matchup')).toBeUndefined());
        expect(useStateStore.getState().getItem('keep')).toBe(1);
        // Actions survive the replace — the store still functions.
        expect(useStateStore.getState().loaded).toBe(true);
    });

    it('a set and an unset for different keys land in the same frame', async () => {
        await renderProvider();
        h.socket.server('v1.state.set', { key: 'x', value: 9 });
        h.socket.server('v1.state.unset', { key: 'y' });
        await waitFor(() => expect(useStateStore.getState().getItem('x')).toBe(9));
    });

    it('unmount removes listeners and resets loaded', async () => {
        const { unmount } = render(<SocketProvider><div /></SocketProvider>);
        await waitFor(() => expect(useStateStore.getState().loaded).toBe(true));
        unmount();
        expect(useStateStore.getState().loaded).toBe(false);
        // A push after unmount must not apply — the handlers are gone.
        h.socket.server('v1.state.set', { key: 'late', value: 1 });
        await new Promise(r => setTimeout(r, 10));
        expect(useStateStore.getState().getItem('late')).toBeUndefined();
    });
});

describe('SocketProvider settings + config channels', () => {
    it('fetches settings on connect and applies pushes', async () => {
        h.socket.rpc['v1.settings.get'] = { obs: { port: 4455 } };
        await renderProvider();
        await waitFor(() => expect(useSettingsStore.getState().loaded).toBe(true));
        expect(useSettingsStore.getState().getItem('obs.port')).toBe(4455);

        h.socket.server('v1.settings.set', { key: 'obs.port', value: 4460 });
        await waitFor(() =>
            expect(useSettingsStore.getState().getItem('obs.port')).toBe(4460));
    });

    it('ignores settings echoes of its own session id', async () => {
        await renderProvider();
        await waitFor(() => expect(useSettingsStore.getState().loaded).toBe(true));
        h.socket.server('v1.settings.set', { key: 'k', value: 1, sid: h.socket.id });
        await new Promise(r => setTimeout(r, 10));
        expect(useSettingsStore.getState().getItem('k')).toBeUndefined();
    });

    it('applies v1.settings.unset', async () => {
        h.socket.rpc['v1.settings.get'] = { scoreboards: { aliases: { 2: 'Side' } } };
        await renderProvider();
        await waitFor(() => expect(useSettingsStore.getState().loaded).toBe(true));
        h.socket.server('v1.settings.unset', { key: 'scoreboards.aliases.2' });
        await waitFor(() => expect(
            useSettingsStore.getState().getItem('scoreboards.aliases.2')
        ).toBeUndefined());
    });

    it('fetches config once on connect', async () => {
        h.socket.rpc['v1.config.get'] = { version: '2.0.0' };
        await renderProvider();
        await waitFor(() => expect(useConfigStore.getState().loaded).toBe(true));
        expect(useConfigStore.getState().version).toBe('2.0.0');
    });
});


describe('SocketProvider handshake window', () => {
    it('keeps state pushed while the initial v1.state.get is in flight', async () => {
        // The snapshot is a round trip, and PRSH pushes continuously — a HUD
        // frame lands mid-handshake on every page load during a live game.
        // Registering the listeners inside the response callback dropped those
        // events outright: the key stayed at its snapshot value until something
        // happened to write it again, which for a rarely-written key (a match
        // binding, a container feed, a name override) is indefinitely.
        h.socket.defer.add('v1.state.get');
        render(<SocketProvider><div /></SocketProvider>);

        h.socket.server('v1.state.set', { key: 'score.1.batter', value: 'Mario' });
        h.socket.server('v1.state.set_batch', {
            items: [{ key: 'score.1.inning', value: 7 }],
        });

        h.socket.resolve('v1.state.get', { score: { 1: { batter: '', inning: 1 } } });

        await waitFor(() =>
            expect(useStateStore.getState().getItem('score.1.batter')).toBe('Mario'));
        expect(useStateStore.getState().getItem('score.1.inning')).toBe(7);
    });

    it('keeps settings pushed while the initial v1.settings.get is in flight', async () => {
        h.socket.defer.add('v1.settings.get');
        render(<SocketProvider><div /></SocketProvider>);

        h.socket.server('v1.settings.set', { key: 'obs.port', value: 4460 });
        h.socket.resolve('v1.settings.get', { obs: { port: 4455 } });

        await waitFor(() =>
            expect(useSettingsStore.getState().getItem('obs.port')).toBe(4460));
    });

    it('applies a set and an unset of the same key in arrival order', async () => {
        // The flush used to apply every pending set and only then every pending
        // unset, so an unset followed by a set of the same key inside one frame
        // came out backwards — the key vanished though the server had a value.
        h.socket.rpc['v1.state.get'] = { score: { 1: { match: 4 } } };
        await renderProvider();

        h.socket.server('v1.state.unset', { key: 'score.1' });
        h.socket.server('v1.state.set', { key: 'score.1.match', value: 9 });

        await waitFor(() =>
            expect(useStateStore.getState().getItem('score.1.match')).toBe(9));
    });

    it('unmounting mid-handshake leaves nothing behind', async () => {
        h.socket.defer.add('v1.state.get');
        const { unmount } = render(<SocketProvider><div /></SocketProvider>);
        unmount();
        h.socket.resolve('v1.state.get', { score: { 1: { inning: 3 } } });
        await new Promise(r => setTimeout(r, 10));
        // The late response must not resurrect a store the provider let go of.
        expect(useStateStore.getState().loaded).toBe(false);
        expect(useStateStore.getState().getItem('score.1.inning')).toBeUndefined();
    });
});
