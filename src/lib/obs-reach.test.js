import { describe, it, expect, afterEach, vi } from 'vitest';
import { isLoopback, lanCopy, resolveUrlForObs } from './obs-reach';

// The rule itself is server-side and tested there (tests/unit/test_source_addresses.py);
// this pins the client's half: what it asks and what it does with the answer.

const LOCAL = 'http://127.0.0.1:5260/layout/scoreboard1/scoreboard.html?scoreboard=1';

function stubFetch(routes) {
    globalThis.fetch = vi.fn(async (path, init) => {
        const answer = routes[path];
        return { ok: answer !== undefined, json: async () => (typeof answer === 'function' ? answer(init) : answer) };
    });
}

afterEach(() => { delete globalThis.fetch; });

describe('resolveUrlForObs', () => {
    it('hands OBS the address the server says reaches it', async () => {
        let asked;
        stubFetch({
            '/api/v1/network/obs-sources': (init) => {
                asked = JSON.parse(init.body);
                return { fixed: { [LOCAL]: LOCAL.replace('127.0.0.1', '192.168.1.20') } };
            },
        });
        const url = await resolveUrlForObs(LOCAL, { obs: { host: '192.168.1.40' } });
        expect(url).toBe('http://192.168.1.20:5260/layout/scoreboard1/scoreboard.html?scoreboard=1');
        expect(asked).toEqual({ obs_host: '192.168.1.40', urls: [LOCAL] });
    });

    it('keeps the URL when nothing needs fixing, or the server cannot be asked', async () => {
        stubFetch({ '/api/v1/network/obs-sources': { fixed: {} } });
        expect(await resolveUrlForObs(LOCAL, {})).toBe(LOCAL);
        stubFetch({});
        expect(await resolveUrlForObs(LOCAL, {})).toBe(LOCAL);
    });
});

describe('lanCopy', () => {
    it('copies the LAN address while PRSH is listening on it', () => {
        expect(lanCopy(LOCAL, { lan_bound: true, addresses: ['192.168.1.20'] }))
            .toBe(LOCAL.replace('127.0.0.1', '192.168.1.20'));
    });

    it('rewrites each line of a multi-URL copy', () => {
        const two = `${LOCAL}\nhttp://localhost:5260/layout/x.html`;
        expect(lanCopy(two, { lan_bound: true, addresses: ['10.0.0.5'] }))
            .toBe(`${LOCAL.replace('127.0.0.1', '10.0.0.5')}\nhttp://10.0.0.5:5260/layout/x.html`);
    });

    it('keeps loopback when LAN is off, or before the answer arrives', () => {
        expect(lanCopy(LOCAL, { lan_bound: false, addresses: ['192.168.1.20'] })).toBe(LOCAL);
        expect(lanCopy(LOCAL, null)).toBe(LOCAL);
    });
});

describe('isLoopback', () => {
    it('knows the loopback spellings', () => {
        for (const h of ['localhost', '127.0.0.1', '127.1.2.3', '[::1]', 'app.localhost']) expect(isLoopback(h)).toBe(true);
        for (const h of ['192.168.1.4', 'mac.local', '10.0.0.1']) expect(isLoopback(h)).toBe(false);
    });
});
