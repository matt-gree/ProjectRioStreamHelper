import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore } from '../../context/store';
import { useObsStore } from '../../context/obs';
import {
    AddSourceDialog, addName, overlayUrl, isBoardScoped, pickKey, pickerPreviewUrl,
} from './addsource';

/*
 * The Add picker is the other half of "the rack lists only what's in the
 * scene". With unbound rows gone it is the only way a source comes into being,
 * so its three rules have to hold: the right URL, added to the RIGHT SCENE, and
 * added HIDDEN.
 *
 * Building a scene is a batch, so it also has to hold them for SEVERAL picks at
 * once: keyed on url + board (one catalog row, two boards, two sources), added
 * one at a time, and honest when only some of them land.
 */

const layout = (over = {}) => ({
    group: 'scoreboard1', name: 'scoreboard', type: 'scoreboard',
    url: 'http://host:5260/layout/scoreboard1/scoreboard.html?size=l',
    width: 800, height: 460, sizeLabel: 'Large', parentName: 'Scoreboard', ...over,
});

const lowerthird = layout({
    group: 'lowerthird', name: 'Lower Third', type: 'lowerthird',
    url: 'http://host:5260/layout/lowerthird/lowerthird.html',
    width: 1920, height: 1080, sizeLabel: undefined, parentName: undefined,
});

describe('isBoardScoped — derived, not hand-listed', () => {
    // The two places that already answer this: Setup's board tabs (the
    // scoreboard1 group) and the registry's `scope: 'board'` elements.
    it('covers the scoreboard group and the board-scoped elements', () => {
        expect(isBoardScoped(layout())).toBe(true);
        expect(isBoardScoped(layout({ group: 'scorecard', type: 'scorecard' }))).toBe(true);
        expect(isBoardScoped(layout({ group: 'hitvisualizer', type: 'hitvisualizer' }))).toBe(true);
    });

    it('leaves everything else board-less, exactly as Setup adds it', () => {
        expect(isBoardScoped(lowerthird)).toBe(false);
        expect(isBoardScoped(layout({ group: 'shared', type: 'stats' }))).toBe(false);
        expect(isBoardScoped(null)).toBe(false);
    });
});

describe('overlayUrl', () => {
    it('writes the board in beside the variant the row already carries', () => {
        expect(overlayUrl(layout(), 2))
            .toBe('http://host:5260/layout/scoreboard1/scoreboard.html?size=l&scoreboard=2');
    });

    // Writing ?scoreboard= onto an overlay that has no board would invent a
    // distinction the layout doesn't have.
    it('leaves a board-less layout alone', () => {
        expect(overlayUrl(lowerthird, 2)).toBe(lowerthird.url);
    });

    it('keeps the origin the API returned — the source may live on another machine', () => {
        expect(overlayUrl(layout(), 1)).toContain('http://host:5260/');
    });
});

describe('pickKey — a pick is a url AND a board', () => {
    /*
     * Scoreboard on board 1 and board 2 are two sources with their own air
     * state, settings and instance id. Keying a selection on url alone would
     * collapse them into one pick — the same bug board-aware binding fixed one
     * axis over.
     */
    it('separates the same row on two boards', () => {
        expect(pickKey(layout(), 1)).not.toBe(pickKey(layout(), 2));
    });

    it('is stable for a board-less row', () => {
        expect(pickKey(lowerthird, null)).toBe(pickKey(lowerthird, null));
        expect(pickKey(lowerthird, null)).not.toBe(pickKey(layout(), null));
    });
});

describe('pickerPreviewUrl', () => {
    /*
     * `sample=1` is the whole reason the picker can show anything: a producer
     * building a scene has no game running. The console's STAGE preview
     * deliberately omits it (there the point is what's about to go on air).
     */
    it('previews the URL Add would create, with sample data', () => {
        const src = pickerPreviewUrl(layout(), 2);
        expect(src).toContain('/layout/scoreboard1/scoreboard.html');
        expect(src).toContain('size=l');
        expect(src).toContain('scoreboard=2');
        expect(src).toContain('preview=1');
        expect(src).toContain('sample=1');
    });

    // A dual-machine rig's catalog URL points at the PRSH host by IP; the
    // producer's browser still has to load it from wherever the app is served.
    it('drops the origin so a host-qualified URL loads locally', () => {
        expect(pickerPreviewUrl(lowerthird, null).startsWith('/layout/')).toBe(true);
    });
});

describe('addName', () => {
    /*
     * The name in OBS is the label the producer clicked. The catalog's raw
     * `name` for a variant row is the filename stem ('scoreboard'), so naming
     * from it would create "scoreboard 2" for a row reading "Scoreboard —
     * Large" — findable in the console, not in OBS's source list.
     */
    it('names the input what the row said, variant and all', () => {
        expect(addName(layout(), 1, [1])).toBe('Scoreboard — Large');
        expect(addName(lowerthird, null, [1])).toBe('Lower Third');
    });

    it('suffixes the board only on a multi-board rig', () => {
        expect(addName(layout(), 2, [1, 2])).toBe('Scoreboard — Large 2');
        // A "1" that means nothing is worse than no suffix at all.
        expect(addName(layout(), 1, [1])).toBe('Scoreboard — Large');
        expect(addName(lowerthird, 2, [1, 2])).toBe('Lower Third');
    });
});

describe('AddSourceDialog', () => {
    const addBrowserSource = vi.fn();

    beforeEach(() => {
        useSettingsStore.setState({ scoreboards: {}, production: {} });
        useObsStore.setState({ status: 'connected', addBrowserSource });
        // Reset the implementation too — several tests below install their own
        // (a failing OBS, an overlap detector).
        addBrowserSource.mockReset();
        addBrowserSource.mockImplementation(
            async ({ inputName, sceneName }) => ({ inputName, sceneName }),
        );
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
            ok: true, json: () => Promise.resolve([layout(), lowerthird]),
        })));
    });
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    const ui = (scene) => render(
        <TooltipProvider><AddSourceDialog scene={scene} onClose={() => {}} /></TooltipProvider>,
    );

    it('names the scene it was opened from — the producer never has to answer "where"', async () => {
        ui('Break');
        expect(await screen.findByText('Add to “Break”')).toBeInTheDocument();
    });

    /*
     * Added HIDDEN, into the scene the + belonged to. Adding a source is setup,
     * and setup must never be the thing that puts something on the broadcast —
     * the rack row's eye is the one deliberate act that does.
     */
    it('adds hidden, into the scene the picker was opened from', async () => {
        ui('Break');
        fireEvent.click(await screen.findByText('Lower Third'));
        fireEvent.click(screen.getByRole('button', { name: /add hidden/i }));
        await waitFor(() => expect(addBrowserSource).toHaveBeenCalledTimes(1));
        expect(addBrowserSource).toHaveBeenCalledWith(expect.objectContaining({
            sceneName: 'Break',
            enabled: false,
            url: lowerthird.url,
            width: 1920,
            height: 1080,
        }));
    });

    it('cannot add until something is picked', async () => {
        ui('Break');
        await screen.findByText('Lower Third');
        expect(screen.getByRole('button', { name: /add hidden/i })).toBeDisabled();
    });

    /*
     * The OBS-independent escape hatch: a producer running OBS on another
     * machine (or wiring sources by hand) copies the exact URL Add would create,
     * with no OBS round-trip. So Copy stays live even with OBS disconnected.
     */
    it('copies the overlay URL without OBS', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        useObsStore.setState({ status: 'disconnected' });

        ui('Break');
        fireEvent.click(await screen.findByText('Lower Third'));
        fireEvent.click(screen.getByRole('button', { name: /copy url/i }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(lowerthird.url));
        expect(addBrowserSource).not.toHaveBeenCalled();
    });

    // One board means no choice to make, so the row isn't asked — the pick
    // still carries board 1, exactly as it always did.
    it('shows board chips only when the rig has more than one', async () => {
        ui('Break');
        await screen.findByText('Scoreboard — Large');
        expect(screen.queryByRole('button', { name: /on Scoreboard 1$/ })).not.toBeInTheDocument();

        cleanup();
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui('Break');
        await screen.findByText('Scoreboard — Large');
        expect(screen.getByRole('button', { name: 'Scoreboard — Large on Scoreboard 1' }))
            .toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Scoreboard — Large on Scoreboard 2' }))
            .toBeInTheDocument();
    });

    /*
     * One catalog row, two boards, two sources. This is why a pick is keyed on
     * url + board and why the board control sits on the ROW rather than in the
     * footer: a single footer dropdown can only describe one of them.
     */
    it('adds one catalog row twice when two boards are chipped', async () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui('Break');
        await screen.findByText('Scoreboard — Large');
        fireEvent.click(screen.getByRole('button', { name: 'Scoreboard — Large on Scoreboard 1' }));
        fireEvent.click(screen.getByRole('button', { name: 'Scoreboard — Large on Scoreboard 2' }));
        fireEvent.click(screen.getByRole('button', { name: /add 2 hidden/i }));

        await waitFor(() => expect(addBrowserSource).toHaveBeenCalledTimes(2));
        expect(addBrowserSource.mock.calls[0][0]).toMatchObject({
            url: 'http://host:5260/layout/scoreboard1/scoreboard.html?size=l&scoreboard=1',
            inputName: 'Scoreboard — Large 1',
        });
        expect(addBrowserSource.mock.calls[1][0]).toMatchObject({
            url: 'http://host:5260/layout/scoreboard1/scoreboard.html?size=l&scoreboard=2',
            inputName: 'Scoreboard — Large 2',
        });
    });

    /*
     * Sequential, never parallel. The OBS mirror reconciles one event at a time,
     * and CreateInput's own uniqueness check is read-then-write: two adds in
     * flight both see the same name free.
     */
    it('adds a batch one at a time', async () => {
        let inFlight = 0;
        let overlapped = false;
        addBrowserSource.mockImplementation(async ({ inputName }) => {
            inFlight += 1;
            if (inFlight > 1) overlapped = true;
            await Promise.resolve();
            inFlight -= 1;
            return { inputName, sceneName: 'Break' };
        });

        ui('Break');
        fireEvent.click(await screen.findByText('Lower Third'));
        fireEvent.click(screen.getByText('Scoreboard — Large'));
        fireEvent.click(screen.getByRole('button', { name: /add 2 hidden/i }));

        await waitFor(() => expect(addBrowserSource).toHaveBeenCalledTimes(2));
        expect(overlapped).toBe(false);
    });

    /*
     * No rollback: deleting sources the producer just watched appear is worse
     * than naming the one that didn't make it. The successes stay in OBS and
     * leave the selection, so a second Add retries the failure instead of
     * duplicating what already landed.
     */
    it('reports a partial failure and keeps only what failed selected', async () => {
        addBrowserSource.mockImplementation(async ({ inputName }) => {
            if (inputName.startsWith('Scoreboard')) throw new Error('OBS said no');
            return { inputName, sceneName: 'Break' };
        });

        ui('Break');
        fireEvent.click(await screen.findByText('Lower Third'));
        fireEvent.click(screen.getByText('Scoreboard — Large'));
        fireEvent.click(screen.getByRole('button', { name: /add 2 hidden/i }));

        await waitFor(() => expect(addBrowserSource).toHaveBeenCalledTimes(2));
        // Still open, one pick left — the one that failed.
        expect(await screen.findByText('1 selected')).toBeInTheDocument();

        addBrowserSource.mockClear();
        fireEvent.click(screen.getByRole('button', { name: /add hidden/i }));
        await waitFor(() => expect(addBrowserSource).toHaveBeenCalledTimes(1));
        expect(addBrowserSource.mock.calls[0][0].inputName).toBe('Scoreboard — Large');
    });

    /*
     * Focus and check are different questions. Clicking a checked row unchecks
     * it but keeps it previewed — the producer is still looking at it.
     */
    it('previews the row it was told about, checked or not', async () => {
        ui('Break');
        fireEvent.click(await screen.findByText('Lower Third'));
        expect(screen.getByTitle('Lower Third preview')).toBeInTheDocument();

        // By role — once it's previewed, its name is on screen twice (the row
        // and the preview's header).
        fireEvent.click(screen.getByRole('button', { name: /^Lower Third/ }));
        expect(screen.getByText('Nothing selected yet.')).toBeInTheDocument();
        expect(screen.getByTitle('Lower Third preview')).toBeInTheDocument();
    });

    // The preview has to work on a machine with no game running, which is what
    // every Layout's sample bundle is for.
    it('previews with sample data, not live state', async () => {
        ui('Break');
        fireEvent.click(await screen.findByText('Lower Third'));
        const src = screen.getByTitle('Lower Third preview').getAttribute('src');
        expect(src).toContain('preview=1');
        expect(src).toContain('sample=1');
    });

    /*
     * Copy follows the selection, one URL per line — what a dual-machine
     * producer pastes into a column of browser sources.
     */
    it('copies every selected URL, newline-joined', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        vi.stubGlobal('navigator', { clipboard: { writeText } });

        ui('Break');
        fireEvent.click(await screen.findByText('Lower Third'));
        fireEvent.click(screen.getByText('Scoreboard — Large'));
        fireEvent.click(screen.getByRole('button', { name: /copy urls/i }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(
            `${lowerthird.url}\n${layout().url}&scoreboard=1`,
        ));
    });
});
