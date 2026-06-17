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
    }
    on(e, fn) { (this.handlers[e] ||= []).push(fn); }
    off(e, fn) { if (this.handlers[e]) this.handlers[e] = this.handlers[e].filter(x => x !== fn); }
    removeAllListeners() { this.handlers = {}; }
    connect() { this.connected = true; }
    close() { this.connected = false; }
    emit(e, _data, cb) { if (cb) cb(this.rpc[e] ?? {}); }
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
});
