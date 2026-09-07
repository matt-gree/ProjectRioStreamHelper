import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore } from '../../context/store';
import { useObsStore } from '../../context/obs';
import {
    AddSourceDialog, addName, overlayUrl, isBoardScoped, pickKey, pickerPreviewUrl, rowLabel,
    boardsNote,
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
 *
 * And LOOKING IS NOT CHOOSING: the row body previews, the checkbox selects, and
 * which board a board-scoped pick lands on is asked in the preview pane beside
 * the thing it describes. Tests below pin all three, because the failure they
 * replaced — browsing the catalog quietly building a batch — was invisible until
 * the producer read the footer.
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

    /*
     * A `?team=` row is a SIDE, so it names itself in the producer's side
     * vocabulary (./sides) — and the OBS source inherits that name, because the
     * name in OBS is the label they clicked. Everything else about the row is
     * untouched: this is the only variant whose label is a preference.
     */
    it('names a side row in the producer’s vocabulary', () => {
        const roster = { name: 'Roster', type: 'roster', team: 2, url: '/layout/scoreboard1/roster.html?team=2' };
        expect(rowLabel(roster)).toBe('Roster — Side 2');
        expect(rowLabel(roster, 'lr')).toBe('Roster — Right');
        expect(addName(roster, null, [1], 'tb')).toBe('Roster — Bottom');
        // A size row is not a side and does not move with it.
        expect(rowLabel(layout(), 'lr')).toBe('Scoreboard — Large');
    });
});

describe('boardsNote — the row states its boards, it does not control them', () => {
    it('lists the picked boards on a multi-board rig', () => {
        expect(boardsNote(layout(), new Set([2, 1]), [1, 2])).toBe('1, 2');
        expect(boardsNote(layout(), new Set([2]), [1, 2])).toBe('2');
    });

    // A "1" on a rig with one board is a fact with no alternative — noise.
    it('says nothing on a single-board rig, or for a board-less row', () => {
        expect(boardsNote(layout(), new Set([1]), [1])).toBe('');
        expect(boardsNote(lowerthird, new Set([null]), [1, 2])).toBe('');
        expect(boardsNote(layout(), undefined, [1, 2])).toBe('');
    });
});

describe('AddSourceDialog', () => {
    const addBrowserSource = vi.fn();

    // The two gestures the panel now separates.
    const preview = (label) => fireEvent.click(
        screen.getByRole('button', { name: `Preview ${label}` }));
    const select = (label) => fireEvent.click(
        screen.getByRole('checkbox', { name: `Select ${label}` }));

    beforeEach(() => {
        useSettingsStore.setState({ scoreboards: {}, production: {} });
        useObsStore.setState({
            status: 'connected', addBrowserSource, sceneItems: {}, mirroredScenes: [],
        });
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
        await screen.findByText('Lower Third');
        select('Lower Third');
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
        await screen.findByText('Lower Third');
        preview('Lower Third');
        fireEvent.click(screen.getByRole('button', { name: /copy url/i }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(lowerthird.url));
        expect(addBrowserSource).not.toHaveBeenCalled();
    });

    /*
     * WHICH BOARD is a property of the pick, not of the catalog row — so it is
     * asked in the preview pane, beside the thing it describes, and only when
     * there is a choice to make. One board means the pick silently carries board
     * 1, exactly as it always did.
     */
    it('asks which board only when the rig has more than one', async () => {
        ui('Break');
        await screen.findByText('Scoreboard — Large');
        preview('Scoreboard — Large');
        expect(screen.queryByRole('checkbox', { name: /^Scoreboard 1/ })).not.toBeInTheDocument();

        cleanup();
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui('Break');
        await screen.findByText('Scoreboard — Large');
        preview('Scoreboard — Large');
        expect(screen.getByRole('checkbox', { name: 'Scoreboard 1' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Scoreboard 2' })).toBeInTheDocument();

        // A board-less row is never asked, however many boards the rig has.
        preview('Lower Third');
        expect(screen.queryByRole('checkbox', { name: 'Scoreboard 2' })).not.toBeInTheDocument();
    });

    /*
     * One catalog row, two boards, two sources. This is why a pick is keyed on
     * url + board: the row's own checkbox answers "does it go in", and the
     * preview pane's per-board boxes answer "how many times".
     */
    it('adds one catalog row twice when two boards are ticked', async () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui('Break');
        await screen.findByText('Scoreboard — Large');
        select('Scoreboard — Large');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Scoreboard 2' }));
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
        await screen.findByText('Lower Third');
        select('Lower Third');
        select('Scoreboard — Large');
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
        await screen.findByText('Lower Third');
        select('Lower Third');
        select('Scoreboard — Large');
        fireEvent.click(screen.getByRole('button', { name: /add 2 hidden/i }));

        await waitFor(() => expect(addBrowserSource).toHaveBeenCalledTimes(2));
        // Still open, one pick left — the one that failed, named in the tray.
        expect(await screen.findByText(/^1 selected/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove Scoreboard — Large' }))
            .toBeInTheDocument();

        addBrowserSource.mockClear();
        fireEvent.click(screen.getByRole('button', { name: /add hidden/i }));
        await waitFor(() => expect(addBrowserSource).toHaveBeenCalledTimes(1));
        expect(addBrowserSource.mock.calls[0][0].inputName).toBe('Scoreboard — Large');
    });

    /*
     * THE TWO ADDS. Hidden is the answer that is never wrong mid-broadcast, so
     * it keeps the filled button and the ⌘⏎ reflex; visible is for the other
     * half of the job, laying a scene out before a stream, where the producer
     * has to see what they just placed.
     *
     * `enabled` is the whole of the difference, and it is easy to get backwards:
     * a click handler is called with the EVENT, so a bare `onClick={add}` on a
     * defaulted flag adds visible every time.
     */
    it('adds hidden from the filled button', async () => {
        ui('Break');
        await screen.findByText('Lower Third');
        select('Lower Third');
        fireEvent.click(screen.getByRole('button', { name: /add hidden/i }));

        await waitFor(() => expect(addBrowserSource).toHaveBeenCalledTimes(1));
        expect(addBrowserSource.mock.calls[0][0].enabled).toBe(false);
    });

    it('adds VISIBLE from the outline one', async () => {
        ui('Break');
        await screen.findByText('Lower Third');
        select('Lower Third');
        fireEvent.click(screen.getByRole('button', { name: /add visible/i }));

        await waitFor(() => expect(addBrowserSource).toHaveBeenCalledTimes(1));
        expect(addBrowserSource.mock.calls[0][0].enabled).toBe(true);
    });

    // The reflex commit stays the safe one.
    it('adds HIDDEN on the ⌘⏎ shortcut', async () => {
        ui('Break');
        await screen.findByText('Lower Third');
        select('Lower Third');
        fireEvent.keyDown(screen.getByPlaceholderText(/search overlays/i),
            { key: 'Enter', metaKey: true });

        await waitFor(() => expect(addBrowserSource).toHaveBeenCalledTimes(1));
        expect(addBrowserSource.mock.calls[0][0].enabled).toBe(false);
    });

    // Both are blocked by the same thing, so both say the same thing about it.
    it('greys both Adds until something is selected', async () => {
        ui('Break');
        await screen.findByText('Lower Third');
        preview('Lower Third');

        expect(screen.getByRole('button', { name: /add hidden/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /add visible/i })).toBeDisabled();
    });

    /*
     * LOOK, THEN CHOOSE. Browsing the catalog is what a producer does most in
     * here, and it must not quietly build a batch they then have to undo — so
     * the FIRST click on a row is the cheap, reversible act and selects nothing.
     */
    it('previews on the first row click and selects nothing', async () => {
        ui('Break');
        await screen.findByText('Lower Third');
        preview('Lower Third');

        expect(screen.getByTitle('Lower Third preview')).toBeInTheDocument();
        expect(screen.getByText(/^Nothing selected yet/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /add hidden/i })).toBeDisabled();
    });

    /*
     * ...and the second click on the row ALREADY being previewed selects it. By
     * then the producer has seen the thing, so the click is a deliberate repeat
     * rather than a browse — the same two beats the keyboard has (↑↓ look, ⏎
     * choose), on the target the mouse is already over.
     */
    it('selects on the second click of the row it is previewing', async () => {
        ui('Break');
        await screen.findByText('Lower Third');
        preview('Lower Third');
        fireEvent.click(screen.getByRole('button', { name: 'Select Lower Third' }));

        expect(screen.getByRole('checkbox', { name: 'Select Lower Third' }))
            .toHaveAttribute('aria-checked', 'true');
        expect(screen.getByText(/^1 selected/)).toBeInTheDocument();
    });

    // Deselect is the same click again, and it KEEPS the preview: focus and
    // check stay different questions, so unchecking never takes the frame away.
    it('deselects on a third click without dropping the preview', async () => {
        ui('Break');
        await screen.findByText('Lower Third');
        preview('Lower Third');
        fireEvent.click(screen.getByRole('button', { name: 'Select Lower Third' }));
        fireEvent.click(screen.getByRole('button', { name: 'Deselect Lower Third' }));

        expect(screen.getByText(/^Nothing selected yet/)).toBeInTheDocument();
        expect(screen.getByTitle('Lower Third preview')).toBeInTheDocument();
    });

    /*
     * The count is per ROW, not per click: moving to another row and coming back
     * previews each time. Otherwise a producer who browsed a list and returned
     * would select whatever they looked at twice.
     */
    it('does not carry a row’s first click over to another row', async () => {
        ui('Break');
        await screen.findByText('Lower Third');
        preview('Lower Third');
        preview('Scoreboard — Large');
        preview('Lower Third');

        expect(screen.getByText(/^Nothing selected yet/)).toBeInTheDocument();
    });

    /*
     * ...and having selected nothing, Add is grey — so the grey has to say what
     * would ungrey it, IN VIEW. A producer who previewed a row sees a filled
     * frame, a named scene and a dead button with nothing joining them up, and
     * the one channel that explained it was a tooltip on the control they had
     * already read as dead.
     */
    it('names the act that would ungrey Add', async () => {
        ui('Break');
        await screen.findByText('Lower Third');
        preview('Lower Third');

        expect(screen.getByRole('button', { name: /add hidden/i })).toBeDisabled();
        expect(screen.getByText(/^Nothing selected yet — tick a box/)).toBeInTheDocument();
    });

    /*
     * On a multi-board rig it names the BOARD STRIP, not the box in the list — a
     * board-scoped row can be ticked from either, and only one of them is where
     * the producer is looking.
     */
    it('points a board-scoped row at the board strip it is previewing', async () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui('Break');
        await screen.findByText('Scoreboard — Large');
        preview('Scoreboard — Large');

        expect(screen.getByRole('button', { name: /add hidden/i })).toBeDisabled();
        expect(screen.getByText(/^Nothing selected yet — tick a board above/))
            .toBeInTheDocument();
    });

    // And once a board IS ticked the line is the count again, with Add live.
    it('drops the prompt the moment a board is ticked', async () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui('Break');
        await screen.findByText('Scoreboard — Large');
        preview('Scoreboard — Large');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Scoreboard 2' }));

        expect(screen.getByText(/^1 selected/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /add hidden/i })).toBeEnabled();
    });

    // The other half: the checkbox is the whole of "this goes in" — and it
    // previews too, because you should see what you just agreed to put on air.
    it('selects on the checkbox, and previews what it selected', async () => {
        ui('Break');
        await screen.findByText('Lower Third');
        select('Lower Third');

        expect(screen.getByRole('checkbox', { name: 'Select Lower Third' }))
            .toHaveAttribute('aria-checked', 'true');
        expect(screen.getByText(/^1 selected/)).toBeInTheDocument();
        expect(screen.getByTitle('Lower Third preview')).toBeInTheDocument();
    });

    // Unticking clears EVERY board it was picked on: a box that left a board 2
    // pick behind would be a lie, and the tray would disagree with the row.
    it('untick clears every board the row was picked on', async () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui('Break');
        await screen.findByText('Scoreboard — Large');
        select('Scoreboard — Large');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Scoreboard 2' }));
        expect(screen.getByText(/^2 selected/)).toBeInTheDocument();

        select('Scoreboard — Large');
        expect(screen.getByText(/^Nothing selected yet/)).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Scoreboard 2' }))
            .not.toBeChecked();
    });

    // The preview has to work on a machine with no game running, which is what
    // every Layout's sample bundle is for.
    it('previews with sample data, not live state', async () => {
        ui('Break');
        await screen.findByText('Lower Third');
        preview('Lower Third');
        const src = screen.getByTitle('Lower Third preview').getAttribute('src');
        expect(src).toContain('preview=1');
        expect(src).toContain('sample=1');
    });

    /*
     * Adding a duplicate by accident and finding it in OBS an hour later is the
     * failure this prevents. Not a block — a producer may genuinely want two.
     */
    it('marks a row already in the scene', async () => {
        useObsStore.setState({
            mirroredScenes: ['Break'],
            sceneItems: {
                Break: [{ sourceName: 'LT', url: lowerthird.url, isPrsh: true }],
            },
        });
        ui('Break');
        await screen.findByText('Lower Third');
        expect(screen.getByText('in scene')).toBeInTheDocument();

        // …and only that row.
        expect(screen.getAllByText('in scene')).toHaveLength(1);
    });

    /*
     * ↑↓ LOOK, Enter CHOOSE. Enter rather than Space because the search box has
     * autofocus and holds it while the producer filters.
     */
    it('walks the list with the arrows and selects with Enter', async () => {
        ui('Break');
        await screen.findByText('Lower Third');
        const dialog = screen.getByRole('dialog');

        // Scoreboard first — the shelf order is deliberate, not folder order.
        fireEvent.keyDown(dialog, { key: 'ArrowDown' });
        expect(screen.getByTitle('Scoreboard — Large preview')).toBeInTheDocument();

        fireEvent.keyDown(dialog, { key: 'ArrowDown' });
        expect(screen.getByTitle('Lower Third preview')).toBeInTheDocument();

        fireEvent.keyDown(dialog, { key: 'Enter' });
        expect(screen.getByText(/^1 selected/)).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Select Lower Third' }))
            .toHaveAttribute('aria-checked', 'true');
    });

    it('commits the batch on ⌘/Ctrl+Enter', async () => {
        ui('Break');
        await screen.findByText('Lower Third');
        select('Lower Third');
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', metaKey: true });
        await waitFor(() => expect(addBrowserSource).toHaveBeenCalledTimes(1));
    });

    // Folder-walk order put the bracket at the top and the scoreboard two
    // thirds of the way down; the shelf a producer opens this for goes first.
    it('orders the shelves deliberately, not by folder', async () => {
        ui('Break');
        await screen.findByText('Lower Third');
        const headings = screen.getAllByText(/^(Scoreboard|Break)$/)
            .map(el => el.textContent);
        expect(headings).toEqual(['Scoreboard', 'Break']);
    });

    // The producer's word for a shelf is the heading at least as often as the
    // layout's own name — "talent" has to find Commentary.
    it('searches group names as well as row names', async () => {
        ui('Break');
        await screen.findByText('Lower Third');
        fireEvent.change(screen.getByPlaceholderText('Search overlays…'), {
            target: { value: 'break' },
        });
        expect(screen.getByText('Lower Third')).toBeInTheDocument();
        expect(screen.queryByText('Scoreboard — Large')).not.toBeInTheDocument();
    });

    // The tray is the batch itself, not a count of it: removable where it's read.
    it('drops a pick from the tray', async () => {
        ui('Break');
        await screen.findByText('Lower Third');
        select('Lower Third');
        fireEvent.click(screen.getByRole('button', { name: 'Remove Lower Third' }));
        expect(screen.getByText(/^Nothing selected yet/)).toBeInTheDocument();
    });

    /*
     * Copy follows the selection, one URL per line — what a dual-machine
     * producer pastes into a column of browser sources.
     */
    it('copies every selected URL, newline-joined', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        vi.stubGlobal('navigator', { clipboard: { writeText } });

        ui('Break');
        await screen.findByText('Lower Third');
        select('Lower Third');
        select('Scoreboard — Large');
        fireEvent.click(screen.getByRole('button', { name: /copy urls/i }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(
            `${lowerthird.url}\n${layout().url}&scoreboard=1`,
        ));
    });
});
