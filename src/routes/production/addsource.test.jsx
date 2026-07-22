import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore } from '../../context/store';
import { useObsStore } from '../../context/obs';
import { AddSourceDialog, addName, addUrl, isBoardScoped } from './addsource';

/*
 * The Add picker is the other half of "the rack lists only what's in the
 * scene". With unbound rows gone it is the only way a source comes into being,
 * so its three rules have to hold: the right URL, added to the RIGHT SCENE, and
 * added HIDDEN.
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

describe('addUrl', () => {
    it('writes the board in beside the variant the row already carries', () => {
        expect(addUrl(layout(), 2))
            .toBe('http://host:5260/layout/scoreboard1/scoreboard.html?size=l&scoreboard=2');
    });

    // Writing ?scoreboard= onto an overlay that has no board would invent a
    // distinction the layout doesn't have.
    it('leaves a board-less layout alone', () => {
        expect(addUrl(lowerthird, 2)).toBe(lowerthird.url);
    });

    it('keeps the origin the API returned — the source may live on another machine', () => {
        expect(addUrl(layout(), 1)).toContain('http://host:5260/');
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
    const addBrowserSource = vi.fn(() => Promise.resolve({ inputName: 'Lower Third', sceneName: 'Break' }));

    beforeEach(() => {
        useSettingsStore.setState({ scoreboards: {}, production: {} });
        useObsStore.setState({ status: 'connected', addBrowserSource });
        addBrowserSource.mockClear();
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

    // One board means no choice to make, so the step isn't shown at all.
    it('asks for a board only when the rig has more than one', async () => {
        ui('Break');
        fireEvent.click(await screen.findByText('Scoreboard — Large'));
        expect(screen.queryByText('Board')).not.toBeInTheDocument();

        cleanup();
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui('Break');
        fireEvent.click(await screen.findByText('Scoreboard — Large'));
        expect(screen.getByText('Board')).toBeInTheDocument();
    });
});
