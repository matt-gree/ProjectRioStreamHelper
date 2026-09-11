import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore } from '../../context/store';
import { useObsStore } from '../../context/obs';
import { useStagingStore } from '../../context/staging';
import { Stage } from './stage';
import { Rack } from './rack';
import { withContainers } from '../../test/containers';

/*
 * "OBS is scaling this source."
 *
 * A browser source renders at its own resolution and the scene item then scales
 * that finished texture, so dragging a handle — the obvious gesture for
 * resizing — resamples pixels instead of re-rendering the page. Neither program
 * says a word about it, which is the whole reason the console has to.
 *
 * EITHER DIRECTION, which is what makes this more than a sharpness warning.
 * Shrinking a texture is lossless, so a quality-only rule would stay silent —
 * while an element that draws type at an absolute size (the Player Name, whose
 * `nameSize` is a number the producer typed) is drawing a 48px name at 24px on
 * a half-scale item. The setting says one thing, the broadcast shows another,
 * and both programs report that everything is fine.
 */

const item = (id, sourceName, url, over = {}) => ({
    id, sourceName, url, enabled: true, inputKind: 'browser_source',
    isGroup: false, isPrsh: true, stretch: null, cropped: false, ...over,
});

const NAME = 'http://x/layout/scoreboard1/playername.html';
const ROSTER = 'http://x/layout/scoreboard1/roster.html';

const obs = (sceneItems) => useObsStore.setState({
    status: 'connected',
    programScene: Object.keys(sceneItems)[0] ?? null,
    scenes: Object.keys(sceneItems),
    mirroredScenes: Object.keys(sceneItems),
    sceneItems,
});

let redraw;
beforeEach(() => {
    useSettingsStore.setState({ production: withContainers() });
    redraw = vi.fn(() => Promise.resolve({ width: 1440, height: 360, scenes: 1 }));
    useObsStore.setState({ redrawSourceAtSize: redraw });
});
afterEach(() => {
    cleanup();
    useStagingStore.getState().discardAll();
    useObsStore.setState({
        status: 'disconnected', studioMode: false, programScene: null,
        previewScene: null, sceneItems: {}, scenes: [], mirroredScenes: [],
    });
});

const ui = (node) => render(<TooltipProvider>{node}</TooltipProvider>);

describe('the stage panel of a stretched source', () => {
    it('says so, and offers to redraw it at true size', () => {
        obs({ Game: [item(1, 'Player Name 1', `${NAME}?team=1`, { stretch: 1.8 })] });
        ui(<Stage selection="playername~t1@Game" />);
        fireEvent.click(screen.getByRole('button', { name: /Scaled 1\.8× — redraw at true size/ }));
        expect(redraw).toHaveBeenCalledWith({
            scene: 'Game', itemId: 1, sourceName: 'Player Name 1',
        });
    });

    /*
     * A SHRUNK source gets the same row. This is the half a sharpness-only
     * warning would have missed: nothing is soft at 0.5×, and the Player Name is
     * still drawing 24px type from a 48px setting.
     */
    it('says so about a source that was dragged SMALLER too', () => {
        obs({ Game: [item(1, 'Player Name 1', `${NAME}?team=1`, { stretch: 0.5 })] });
        ui(<Stage selection="playername~t1@Game" />);
        expect(screen.getByRole('button', { name: /Scaled 0\.5× — redraw at true size/ }))
            .toBeInTheDocument();
    });

    // The common case, and the one that must stay silent.
    it('says nothing about a source drawn at its own resolution', () => {
        obs({ Game: [item(1, 'Player Name 1', `${NAME}?team=1`)] });
        ui(<Stage selection="playername~t1@Game" />);
        expect(screen.queryByText(/Scaled/)).not.toBeInTheDocument();
    });

    /*
     * A crop is stated in SOURCE pixels, so raising the resolution moves what it
     * cuts away — there is no honest one-press fix. The row still appears: a
     * console that went quiet exactly where it could not help would be quietest
     * about the cases a producer is least likely to work out alone.
     */
    it('still warns about a cropped source, but offers no button', () => {
        obs({ Game: [item(1, 'Player Name 1', `${NAME}?team=1`, { stretch: 2, cropped: true })] });
        ui(<Stage selection="playername~t1@Game" />);
        expect(screen.getByText(/OBS is scaling this 2\.0× — cropped/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /redraw at true size/ })).not.toBeInTheDocument();
    });
});

describe('the rack', () => {
    it('badges the row that is being scaled, and only that row', () => {
        obs({
            Game: [
                item(1, 'Player Name 1', `${NAME}?team=1`, { stretch: 1.8 }),
                item(2, 'Player Name 2', `${NAME}?team=2`),
            ],
        });
        ui(<Rack />);
        expect(screen.getAllByTitle(/being drawn at 1\.8× the resolution/)).toHaveLength(1);
    });

    /*
     * The yell. A row in a collapsed scene is easy to miss, so the count comes
     * to the top of the rack — and it LEADS TO THE FIX rather than only
     * complaining: pressing it selects the offending row, which opens the panel
     * the redraw lives on.
     */
    it('names the one scaled source at the top, and selects it when pressed', () => {
        obs({
            Game: [
                item(1, 'Player Name 1', `${NAME}?team=1`, { stretch: 1.8 }),
                item(2, 'Roster 1', `${ROSTER}?team=1`),
            ],
        });
        ui(<Rack />);
        fireEvent.click(screen.getByRole('button', { name: /OBS is scaling Player Name 1/ }));
        // The row that got selected is the badged one — asserted through the
        // badge rather than a row label, because what the rack CALLS a row is
        // the element's name and its side, not the OBS source's name.
        const badged = screen.getByTitle(/being drawn at 1\.8× the resolution/).closest('[data-rack-row]');
        expect(badged).toHaveClass('bg-secondary/70');
    });

    // A pair scaled opposite ways is still two sources disagreeing with their
    // own settings — the count does not care which direction each went.
    it('counts them when there are several, in either direction', () => {
        obs({
            Game: [
                item(1, 'Player Name 1', `${NAME}?team=1`, { stretch: 1.8 }),
                item(2, 'Player Name 2', `${NAME}?team=2`, { stretch: 0.5 }),
            ],
        });
        ui(<Rack />);
        expect(screen.getByRole('button', { name: /OBS is scaling 2 sources/ }))
            .toBeInTheDocument();
    });

    // Nothing wrong, nothing said. The notice is not a permanent fixture of the
    // rack — a warning that is always there is a warning nobody reads.
    it('is absent when every source renders at its own size', () => {
        obs({ Game: [item(1, 'Player Name 1', `${NAME}?team=1`)] });
        ui(<Rack />);
        expect(screen.queryByText(/OBS is scaling/)).not.toBeInTheDocument();
    });
});

describe('which sources are entitled to complain', () => {
    /*
     * ONLY THE PLAYER NAME, and not out of caution. Every other element fits its
     * artwork to whatever viewport it is handed, so a scaled item costs it
     * sharpness and nothing else — a badge on all of them would put amber over
     * most of a producer's rack for a fidelity note. The Player Name draws at an
     * ABSOLUTE size, so a scaled item is showing a number other than the one in
     * the setting. Correctness, not quality.
     */
    it('says nothing about a scaled Roster', () => {
        obs({ Game: [item(1, 'Roster 1', `${ROSTER}?team=1`, { stretch: 2 })] });
        ui(<Rack />);
        expect(screen.queryByText(/OBS is scaling/)).not.toBeInTheDocument();
        expect(screen.queryByTitle(/the resolution it/)).not.toBeInTheDocument();
    });

    it('counts only the Player Name when both are scaled', () => {
        obs({
            Game: [
                item(1, 'Player Name 1', `${NAME}?team=1`, { stretch: 2 }),
                item(2, 'Roster 1', `${ROSTER}?team=1`, { stretch: 2 }),
            ],
        });
        ui(<Rack />);
        expect(screen.getByRole('button', { name: /OBS is scaling Player Name 1/ }))
            .toBeInTheDocument();
    });

    // The stage panel and the rack badge read ONE predicate, so a source cannot
    // be a problem on one surface and fine on the other.
    it('gives a scaled Roster no row on its own panel either', () => {
        obs({ Game: [item(1, 'Roster 1', `${ROSTER}?team=1`, { stretch: 2 })] });
        ui(<Stage selection="roster~t1@Game" />);
        expect(screen.queryByText(/Scaled/)).not.toBeInTheDocument();
    });
});

/*
 * ── WHY A NAME IS SMALLER THAN THE NUMBER YOU TYPED ─────────────────────────
 *
 * `nameSize` is absolute and the source's box is a ceiling on it, so the name
 * comes down rather than being clipped. Correct, and invisible: the producer
 * sets 48 and the broadcast draws 33 with every surface in both programs
 * reporting that all is well.
 *
 * The HEIGHT clamp is the trap, because its threshold is unguessable and it
 * defeats the natural instinct. 48px with a prefix row needs 87px of frame, so
 * a source dragged into a name-bar shape — wide and short — clamps from the
 * first frame, and widening it does nothing whatever, because width was never
 * what was binding. (Measured in a real browser: 1600x60, 2400x60 and 3200x60
 * all draw 33.23px.)
 */
describe('the Player Name size readout', () => {
    const sized = (w, h) => obs({
        Game: [item(1, 'Player Name 1', `${NAME}?team=1`, { renderWidth: w, renderHeight: h })],
    });

    it('names the axis that is holding the name down, and says widening will not help', () => {
        sized(1600, 60);
        ui(<Stage selection="playername~t1@Game" />);
        // The number a producer can act on is the value; the axis is the
        // eyebrow, and the rule behind it the expansion.
        expect(screen.getByText('CLAMPED')).toBeInTheDocument();
        expect(screen.getByText(/Drawing 33px, not 48px/)).toBeInTheDocument();
        expect(screen.getByTitle(/needs 87px of height/)).toBeInTheDocument();
        expect(screen.getByTitle(/Widening it will not help/)).toBeInTheDocument();
    });

    it('confirms a frame that can hold the size, and says what still shrinks', () => {
        sized(800, 200);
        ui(<Stage selection="playername~t1@Game" />);
        expect(screen.getByText('FITS')).toBeInTheDocument();
        expect(screen.getByText(/800 × 200 holds 48px/)).toBeInTheDocument();
        // The width clamp is per-source, which is the point: one long name comes
        // down on its own side and the other keeps the size that was typed.
        expect(screen.getByTitle(/the other keeps 48px/)).toBeInTheDocument();
    });

    // With no OBS there is no frame to measure against — but the threshold is
    // the thing nobody guesses, so it is still worth stating on its own.
    it('states the requirement with no source to measure', () => {
        obs({ Game: [item(1, 'Player Name 1', `${NAME}?team=1`)] });
        ui(<Stage selection="playername~t1@Game" />);
        expect(screen.getByText('MIN HEIGHT')).toBeInTheDocument();
        expect(screen.getByText('87px for 48px type')).toBeInTheDocument();
        expect(screen.getByTitle(/needs a source at least 87px tall/)).toBeInTheDocument();
    });

    /*
     * The threshold moves with the prefix setting — one run instead of two is
     * 60px rather than 87 — and the panel must not quote a constant. It reads
     * the mount's own inverse, so the two cannot disagree about the number that
     * decides whether a broadcast is drawing the size it was told to.
     */
    it('follows the prefix position, because the stack it measures does', () => {
        useSettingsStore.setState({
            production: withContainers(),
            overlays: { playername: { prefixPosition: 'off' } },
        });
        sized(1600, 60);
        ui(<Stage selection="playername~t1@Game" />);
        expect(screen.getByText(/1600 × 60 holds 48px/)).toBeInTheDocument();
    });
});
