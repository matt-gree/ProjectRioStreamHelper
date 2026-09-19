import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useSettingsStore } from '../../../context/store';
import { useObsStore } from '../../../context/obs';
import {
    AddSourceDialog, addName, overlayUrl, isBoardScoped, pickKey, pickerPreviewUrl, rowLabel,
    boardsNote, sceneBoard, picksBoard, offeredOn, pairRows,
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
 * which board a board-scoped pick lands on is asked ONCE, by the board tab the
 * list is showing. Tests below pin all three, because the failure they
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

    // Every overlay that READS ?scoreboard= gets the step, including the ones
    // whose settings are global — the post-game callouts are named differently
    // in the catalog than in the registry, so they match by url.
    it('covers every overlay that reads the board, not just the board-scoped ones', () => {
        const at = (group, type, path) => layout({ group, type, url: `http://host:5260/layout/${path}` });
        expect(isBoardScoped(at('postgame', 'spotlight', 'postgame/spotlight.html'))).toBe(true);
        expect(isBoardScoped(at('postgame', 'summary', 'postgame/summary.html'))).toBe(true);
        expect(isBoardScoped(at('eventheader', 'eventheader', 'eventheader/eventheader.html'))).toBe(true);
        expect(isBoardScoped(at('rotator', 'ticker', 'rotator/ticker.html'))).toBe(true);
        expect(isBoardScoped(at('controller', 'controller', 'controller/controller.html?team=1'))).toBe(true);
    });

    it('leaves everything else board-less, exactly as Setup adds it', () => {
        expect(isBoardScoped(lowerthird)).toBe(false);
        expect(isBoardScoped(layout({
            group: 'shared', type: 'container',
            url: 'http://host:5260/layout/shared/container.html?container=callout-stage',
        }))).toBe(false);
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

    // The sample replaces the whole store, so it can never draw the producer's
    // own logos or names — a board holding a game previews that game.
    it('previews live when the board has a game', () => {
        const src = pickerPreviewUrl(layout(), 1, { live: true });
        expect(src).toContain('preview=1');
        expect(src).not.toContain('sample=1');
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

    // A bare trailing number beside a side read as part of the side:
    // "Stat Bar — Side 1 1". The board is a word.
    it('names the board as a word, never a bare number beside a side', () => {
        const bar = {
            group: 'scoreboard1', name: 'Stat Bar', type: 'statsbar', team: 1,
            url: '/layout/scoreboard1/statsbar.html?team=1',
        };
        expect(addName(bar, 1, [1, 2])).toBe('Stat Bar — Side 1 (Board 1)');
    });

    it('suffixes the board only on a multi-board rig', () => {
        expect(addName(layout(), 2, [1, 2])).toBe('Scoreboard — Large (Board 2)');
        // A "1" that means nothing is worse than no suffix at all.
        expect(addName(layout(), 1, [1])).toBe('Scoreboard — Large');
        expect(addName(lowerthird, 2, [1, 2])).toBe('Lower Third');
    });

    /*
     * A `?team=` row is a SIDE, so it names itself in the producer's side
     * vocabulary (../sides) — and the OBS source inherits that name, because the
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

describe('boardsNote — the row states the boards out of sight', () => {
    // The tab already says the board the row's own box answers for.
    it('lists the OTHER picked boards on a multi-board rig', () => {
        expect(boardsNote(layout(), new Set([2, 1, 3]), [1, 2, 3], 1)).toBe('2, 3');
        expect(boardsNote(layout(), new Set([2]), [1, 2], 1)).toBe('2');
        expect(boardsNote(layout(), new Set([1]), [1, 2], 1)).toBe('');
    });

    it('says nothing on a single-board rig, or for a board-less row', () => {
        expect(boardsNote(layout(), new Set([1]), [1], 1)).toBe('');
        expect(boardsNote(lowerthird, new Set([null]), [1, 2], null)).toBe('');
        expect(boardsNote(layout(), undefined, [1, 2], 1)).toBe('');
    });
});

describe('picksBoard — which rows go under a board’s tab', () => {
    const eventheader = layout({
        group: 'eventheader', name: 'Event Header', type: 'eventheader',
        url: 'http://host:5260/layout/eventheader/eventheader.html',
        sizeLabel: undefined, parentName: undefined,
    });
    const controller = layout({
        group: 'controller', name: 'controller', type: 'controller',
        url: 'http://host:5260/layout/controller/controller.html?team=1',
        sizeLabel: undefined, parentName: 'Controller', team: 1,
    });

    it('asks a board for the scoreboard and the side-following controller', () => {
        expect(picksBoard(layout())).toBe(true);
        expect(picksBoard(controller)).toBe(true);
    });

    // The Event Header reads a board for one field and is otherwise chrome for
    // the whole show — Show-wide in the picker, still re-pointable on stage.
    it('shelves the Event Header show-wide though it can name a board', () => {
        expect(isBoardScoped(eventheader)).toBe(true);
        expect(picksBoard(eventheader)).toBe(false);
        expect(picksBoard(lowerthird)).toBe(false);
    });
});

describe('offeredOn — the Results Ticker only under a rotating board', () => {
    const ticker = layout({
        group: 'rotator', name: 'Results Ticker', type: 'ticker',
        url: 'http://host:5260/layout/rotator/ticker.html',
        sizeLabel: undefined, parentName: undefined,
    });
    // It draws the board's rotation pool and nothing else.
    it('offers the ticker only on a board that is rotating', () => {
        expect(offeredOn(ticker, 2, [2])).toBe(true);
        expect(offeredOn(ticker, 1, [2])).toBe(false);
        expect(offeredOn(ticker, 1, [])).toBe(false);
    });
    it('offers everything else on every board', () => {
        expect(offeredOn(layout(), 1, [])).toBe(true);
        expect(offeredOn(lowerthird, null, [])).toBe(true);
    });
});

const statsbar = (team) => layout({
    group: 'scoreboard1', name: 'statsbar', type: 'statsbar',
    url: `http://host:5260/layout/scoreboard1/statsbar.html?team=${team}`,
    width: 452, height: 118, sizeLabel: undefined, parentName: 'Stat Bar', team,
});

describe('pairRows — a side 1 / side 2 pair is one row', () => {
    it('folds both sides into one row, in side order, where the first side was', () => {
        const rows = pairRows([layout(), statsbar(2), lowerthird, statsbar(1)]);
        expect(rows.map(r => r.members.length)).toEqual([1, 2, 1]);
        expect(rows[1].members.map(l => l.team)).toEqual([1, 2]);
        expect(rows[1].key).toBe(statsbar(1).url);
    });

    // A lone side is an ordinary row — there is nothing to fold it with.
    it('leaves a lone side alone', () => {
        const rows = pairRows([statsbar(1), lowerthird]);
        expect(rows.map(r => r.members.length)).toEqual([1, 1]);
    });
});

describe('sceneBoard — the tab a scene opens on', () => {
    const item = (url) => ({ url, isPrsh: true });
    it('picks the board the scene already holds most of', () => {
        expect(sceneBoard([
            item('http://h/layout/scoreboard1/scoreboard.html?scoreboard=2'),
            item('http://h/layout/scoreboard1/statsbar.html?team=1&scoreboard=2'),
            item('http://h/layout/scoreboard1/statsbar.html?team=1&scoreboard=1'),
        ], [1, 2])).toBe(2);
    });

    // A board-less source says nothing about a board — read through the
    // documented default it would pull every scene toward board 1.
    it('ignores sources that name no board', () => {
        expect(sceneBoard([
            item('http://h/layout/lowerthird/lowerthird.html'),
            item('http://h/layout/lowerthird/lowerthird.html'),
            item('http://h/layout/scoreboard1/scoreboard.html?scoreboard=2'),
        ], [1, 2])).toBe(2);
    });

    it('falls back to the rig’s first board, never a board it no longer has', () => {
        expect(sceneBoard([], [2, 3])).toBe(2);
        expect(sceneBoard([item('http://h/x.html?scoreboard=5')], [1, 2])).toBe(1);
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
     * WHICH BOARD is asked once, by the tab — and only when the rig has a
     * choice to make. One board means no tabs and the pick carries board 1.
     */
    it('draws board tabs only when the rig has more than one board', async () => {
        ui('Break');
        await screen.findByText('Scoreboard — Large');
        expect(screen.queryByRole('tablist', { name: 'Board' })).not.toBeInTheDocument();

        cleanup();
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui('Break');
        await screen.findByText('Scoreboard — Large');
        expect(screen.getByRole('tab', { name: 'Scoreboard 1' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Scoreboard 2' })).toBeInTheDocument();
    });

    // A board's tab lists that board's elements; what reads no board sits
    // beneath on a Show-wide shelf that is the same under every tab.
    it('puts board-less overlays on a show-wide shelf under the board’s', async () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui('Break');
        await screen.findByText('Lower Third');
        const order = screen.getAllByText(/^(Scoreboard — Large|show-wide · .*|Lower Third)$/)
            .map(el => el.textContent.split(' ')[0]);
        expect(order).toEqual(['Scoreboard', 'show-wide', 'Lower']);
    });

    /*
     * One catalog row, two boards, two sources. This is why a pick is keyed on
     * url + board: tick it on one tab, switch, tick it on the other.
     */
    it('adds one catalog row twice when it is ticked on two tabs', async () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui('Break');
        await screen.findByText('Scoreboard — Large');
        select('Scoreboard — Large');
        fireEvent.click(screen.getByRole('tab', { name: 'Scoreboard 2' }));
        // The box answers for THIS tab's board, so it is unticked here…
        expect(screen.getByRole('checkbox', { name: 'Select Scoreboard — Large' }))
            .toHaveAttribute('aria-checked', 'false');
        // …and the row says where else it is going in.
        expect(screen.getByText('also 1')).toBeInTheDocument();
        select('Scoreboard — Large');
        fireEvent.click(screen.getByRole('button', { name: /add 2 hidden/i }));

        await waitFor(() => expect(addBrowserSource).toHaveBeenCalledTimes(2));
        expect(addBrowserSource.mock.calls[0][0]).toMatchObject({
            url: 'http://host:5260/layout/scoreboard1/scoreboard.html?size=l&scoreboard=1',
            inputName: 'Scoreboard — Large (Board 1)',
        });
        expect(addBrowserSource.mock.calls[1][0]).toMatchObject({
            url: 'http://host:5260/layout/scoreboard1/scoreboard.html?size=l&scoreboard=2',
            inputName: 'Scoreboard — Large (Board 2)',
        });
    });

    // The tab counts its picks — the batch on a tab out of sight is still seen.
    it('counts each board’s picks on its tab', async () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui('Break');
        await screen.findByText('Scoreboard — Large');
        select('Scoreboard — Large');
        expect(screen.getAllByTitle(/picked for this board$/).map(el => el.title))
            .toEqual(['1 picked for this board']);
        expect(screen.getByRole('tab', { name: 'Scoreboard 1' }))
            .toContainElement(screen.getByTitle('1 picked for this board'));
    });

    // Opened from a scene that already holds board 2's sources, the picker is
    // about board 2 — and "in scene" answers for the tab's board.
    it('opens on the scene’s board and marks what that board already has', async () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        useObsStore.setState({
            mirroredScenes: ['Game 2'],
            sceneItems: {
                'Game 2': [{
                    sourceName: 'SB2', isPrsh: true,
                    url: 'http://host:5260/layout/scoreboard1/scoreboard.html?size=l&scoreboard=2',
                }],
            },
        });
        ui('Game 2');
        await screen.findByText('Scoreboard — Large');
        expect(screen.getByRole('tab', { name: 'Scoreboard 2' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('in scene')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: 'Scoreboard 1' }));
        expect(screen.queryByText('in scene')).not.toBeInTheDocument();
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

    // Unticking takes back only THIS tab's pick — the other board's is still
    // stated on the row and in the tray, so nothing is left behind unseen.
    it('untick on one tab leaves the other board’s pick', async () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui('Break');
        await screen.findByText('Scoreboard — Large');
        select('Scoreboard — Large');
        fireEvent.click(screen.getByRole('tab', { name: 'Scoreboard 2' }));
        select('Scoreboard — Large');
        expect(screen.getByText(/^2 selected/)).toBeInTheDocument();

        select('Scoreboard — Large');
        expect(screen.getByText(/^1 selected/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove Scoreboard — Large · B1' }))
            .toBeInTheDocument();
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

    describe('a per-side pair', () => {
        beforeEach(() => {
            vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
                ok: true, json: () => Promise.resolve([layout(), statsbar(1), statsbar(2), lowerthird]),
            })));
        });

        it('lists the pair as one row with a chip per side', async () => {
            ui('Break');
            await screen.findByText('Stat Bar');
            expect(screen.queryByText('Stat Bar — Side 1')).not.toBeInTheDocument();
            expect(screen.getByRole('checkbox', { name: 'Select Stat Bar — Side 1' })).toBeInTheDocument();
            expect(screen.getByRole('checkbox', { name: 'Select Stat Bar — Side 2' })).toBeInTheDocument();
        });

        // The usual answer is both sides, so the row's box gives both — and
        // the tray folds them back into one chip.
        it('takes both sides from the row’s box, as one chip in the tray', async () => {
            ui('Break');
            await screen.findByText('Stat Bar');
            select('Stat Bar');
            expect(screen.getByRole('checkbox', { name: 'Select Stat Bar' }))
                .toHaveAttribute('aria-checked', 'true');
            expect(screen.getByText(/^2 selected/)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Remove Stat Bar' })).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: /add 2 hidden/i }));
            await waitFor(() => expect(addBrowserSource).toHaveBeenCalledTimes(2));
            expect(addBrowserSource.mock.calls.map(c => c[0].inputName))
                .toEqual(['Stat Bar — Side 1', 'Stat Bar — Side 2']);
        });

        it('takes one side alone from its chip, and says the box is mixed', async () => {
            ui('Break');
            await screen.findByText('Stat Bar');
            fireEvent.click(screen.getByRole('checkbox', { name: 'Select Stat Bar — Side 2' }));
            expect(screen.getByRole('checkbox', { name: 'Select Stat Bar' }))
                .toHaveAttribute('aria-checked', 'mixed');
            expect(screen.getByRole('button', { name: 'Remove Stat Bar — Side 2' })).toBeInTheDocument();
            // …and previews the side it took.
            expect(screen.getByTitle('Stat Bar — Side 2 preview')).toBeInTheDocument();

            // The box from mixed completes the pair rather than clearing it.
            select('Stat Bar');
            expect(screen.getByText(/^2 selected/)).toBeInTheDocument();
            select('Stat Bar');
            expect(screen.getByText(/^Nothing selected yet/)).toBeInTheDocument();
        });

        it('removes both sides with the folded chip’s ×', async () => {
            ui('Break');
            await screen.findByText('Stat Bar');
            select('Stat Bar');
            fireEvent.click(screen.getByRole('button', { name: 'Remove Stat Bar' }));
            expect(screen.getByText(/^Nothing selected yet/)).toBeInTheDocument();
        });

        // A pair is ONE stop for the arrows, and Enter takes both sides.
        it('walks a pair as one row', async () => {
            ui('Break');
            await screen.findByText('Stat Bar');
            const dialog = screen.getByRole('dialog');
            fireEvent.keyDown(dialog, { key: 'ArrowDown' });
            fireEvent.keyDown(dialog, { key: 'ArrowDown' });
            expect(screen.getByTitle('Stat Bar — Side 1 preview')).toBeInTheDocument();
            fireEvent.keyDown(dialog, { key: 'Enter' });
            expect(screen.getByText(/^2 selected/)).toBeInTheDocument();
            fireEvent.keyDown(dialog, { key: 'ArrowDown' });
            expect(screen.getByTitle('Lower Third preview')).toBeInTheDocument();
        });
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
