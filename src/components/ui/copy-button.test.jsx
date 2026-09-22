import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyButton } from './copy-button';

const show = vi.fn();
vi.mock('../../lib/notify', () => ({ notifications: { show: (...a) => show(...a) } }));

const URL_ = 'http://192.168.1.42:5260/layout/lowerthird/lowerthird.html';

function ui() {
    render(
        <CopyButton value={URL_}>
            {({ copied, copy }) => (
                <button onClick={copy}>{copied ? 'Copied' : 'Copy URL'}</button>
            )}
        </CopyButton>,
    );
    return () => fireEvent.click(screen.getByRole('button'));
}

afterEach(() => {
    vi.unstubAllGlobals();
    delete document.execCommand;
    show.mockClear();
});

describe('CopyButton', () => {
    it('uses the async clipboard API when the page has one', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        vi.stubGlobal('navigator', { clipboard: { writeText } });

        ui()();
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_));
        await screen.findByText('Copied');
        expect(show).not.toHaveBeenCalled();
    });

    /*
     * THE CASE THIS BUTTON EXISTS FOR. Copy URL is the escape hatch for a
     * producer whose OBS is on another machine — who is therefore on PRSH over
     * the LAN, a NON-SECURE CONTEXT with no navigator.clipboard at all. The
     * button copied nothing and said nothing there.
     */
    it('falls back to execCommand with no clipboard API (plain-HTTP LAN)', async () => {
        vi.stubGlobal('navigator', {});
        const exec = vi.fn(() => true);
        document.execCommand = exec;

        ui()();
        await screen.findByText('Copied');
        expect(exec).toHaveBeenCalledWith('copy');
        expect(show).not.toHaveBeenCalled();
    });

    it('falls back when the clipboard API is present but refuses', async () => {
        const writeText = vi.fn(() => Promise.reject(new Error('not focused')));
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const exec = vi.fn(() => true);
        document.execCommand = exec;

        ui()();
        await screen.findByText('Copied');
        expect(exec).toHaveBeenCalledWith('copy');
    });

    /* A copy that fails must SAY so: silence reads as success, and the producer
     * pastes whatever was in the clipboard before. */
    it('reports a failure instead of showing Copied', async () => {
        vi.stubGlobal('navigator', {});
        document.execCommand = vi.fn(() => false);

        ui()();
        await waitFor(() => expect(show).toHaveBeenCalledWith(
            expect.objectContaining({ color: 'red' }),
        ));
        expect(screen.getByRole('button')).toHaveTextContent('Copy URL');
    });
});
