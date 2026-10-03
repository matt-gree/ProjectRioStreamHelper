import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeReq } from './api';

const respond = (status, body) => vi.fn().mockResolvedValue({
    ok: status < 400, status, json: () => Promise.resolve(body),
});

describe('makeReq', () => {
    afterEach(() => vi.unstubAllGlobals());

    it("surfaces FastAPI's `detail` — every HTTPException's message", async () => {
        vi.stubGlobal('fetch', respond(409, { detail: 'nothing in the queue is waiting for a board' }));
        await expect(makeReq('/api/v1')('/x')).rejects.toThrow('nothing in the queue is waiting');
    });

    it("falls back to a handler's own `error`, then the status", async () => {
        vi.stubGlobal('fetch', respond(400, { error: 'bad' }));
        await expect(makeReq()('/x')).rejects.toThrow('bad');
        vi.stubGlobal('fetch', respond(422, { detail: [{ msg: 'field required' }] }));
        await expect(makeReq()('/x')).rejects.toThrow('Request failed: 422');
    });
});
