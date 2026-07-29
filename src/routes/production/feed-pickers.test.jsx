import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useStagingStore } from '../../context/staging';
import { ELEMENTS } from './elements';
import { PostgameCalloutPicker } from './feed-pickers';
import { withContainers } from '../../test/containers';

beforeEach(() => {
    vi.stubGlobal('localStorage', {
        getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
    });
    useSettingsStore.setState({ overlays: {}, scoreboards: {}, production: withContainers() });
    useStateStore.setState({ score: {}, production: {}, postgame: {} });
    useStagingStore.setState({ pending: {}, order: [] });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const spotlight = ELEMENTS.find(e => e.id === 'postgamecallout');
const ch = (name, b = {}) => ({ name, batting: { singles: 0, doubles: 0, triples: 0, homeruns: 0, rbi: 0, ...b } });

// A finished game: side 1 won, Daisy had the biggest day on it.
const captureLoaded = () => useStateStore.setState({
    postgame: {
        1: {
            present: true,
            meta: { winnerSide: 1 },
            player: {
                1: { rioName: 'left', characters: [ch('Peach', { singles: 2 }), ch('Daisy', { homeruns: 2 })] },
                2: { rioName: 'right', characters: [ch('Wario', { homeruns: 3 })] },
            },
        },
    },
});

const feed = () => useStateStore.getState()?.production?.feed?.container?.['callout-stage'];
const memory = () => useStateStore.getState()?.production?.feed?.last?.postgamecallout;
const ui = () => render(<PostgameCalloutPicker element={spotlight} scoreboard={1} />);

// Put this element on the stage (mine) carrying `sel`, so the picker is live.
// Airing always came from a pick or a push, both of which record the intent —
// so seed the memory too, mirroring the real flow.
const airing = (sel) => {
    const payload = { element: 'postgamecallout', scoreboard: 1, ...sel };
    useStateStore.getState().setItems([
        { key: 'production.feed.container.callout-stage', value: payload },
        { key: 'production.feed.last.postgamecallout', value: payload },
    ]);
};

/*
 * Selecting a character is DECOUPLED from airing it: picking arms the spotlight
 * (records the intent the preview draws and Push airs) without touching the
 * live container — unless this element already holds the stage, where the pick
 * is a live edit. The whole point of the user's ask: preview before you cut.
 */
describe('spotlight pick is decoupled from air', () => {
    it('arms the pick without putting it on the container', () => {
        captureLoaded();
        ui();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '1:0' } });
        // Armed, not aired: intent records Peach, the container stays empty.
        expect(memory()).toMatchObject({ element: 'postgamecallout', team: 1, charIndex: 0, name: 'Peach' });
        expect(feed()).toBeUndefined();
        expect(screen.getByRole('combobox').value).toBe('1:0');
        expect(screen.getByText(/Not on the stage — Push shows Peach\./)).toBeTruthy();
    });

    it('live-edits the container when this element already holds the stage', () => {
        captureLoaded();
        airing({ team: 2, charIndex: 0, name: 'Wario' }); // spotlight is live on Wario
        ui();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '1:0' } }); // swap to Peach
        // Live: the pick goes straight to the container.
        expect(feed()).toMatchObject({ element: 'postgamecallout', team: 1, charIndex: 0, name: 'Peach' });
    });

    it('survives another element taking the stage — the pick is intent, not air', () => {
        captureLoaded();
        ui();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '1:0' } });

        // Game Summary takes the stage — the container carries someone else.
        useStateStore.getState().setItems([
            { key: 'production.feed.container.callout-stage', value: { element: 'postgamevs', scoreboard: 1 } },
        ]);
        cleanup();
        ui();
        expect(screen.getByRole('combobox').value).toBe('1:0');
        expect(screen.getByText(/Not on the stage — Push shows Peach\./)).toBeTruthy();
    });

    it('keeps the pick through a Clear — Clear takes it off air, it does not un-pick', () => {
        captureLoaded();
        airing({ team: 1, charIndex: 0, name: 'Peach' }); // live on Peach
        ui();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } }); // Clear
        expect(feed()).toBeUndefined();
        expect(memory()).toMatchObject({ name: 'Peach' });
        cleanup();
        ui();
        expect(screen.getByRole('combobox').value).toBe('1:0');
    });
});

/*
 * With nothing remembered the picker proposes rather than sitting empty, so a
 * producer who just captured a game can go straight to Push.
 */
describe('spotlight suggestion', () => {
    it('opens on the winning side\'s leader in total bases, labelled as a suggestion', () => {
        captureLoaded();
        ui();
        expect(screen.getByRole('combobox').value).toBe('1:1'); // Daisy, 8 TB
        expect(screen.getByText(/Suggested — Daisy led the winning side in total bases\./)).toBeTruthy();
    });

    it('drops "Nothing fed" while off the stage — there is no feed to clear', () => {
        captureLoaded();
        ui();
        const labels = [...screen.getByRole('combobox').options].map(o => o.textContent);
        expect(labels).not.toContain('Nothing fed');
        expect(labels).toContain('Daisy');
    });

    it('offers "Nothing fed" once the element holds the stage', () => {
        captureLoaded();
        airing({ team: 1, charIndex: 0, name: 'Peach' }); // live
        ui();
        const labels = [...screen.getByRole('combobox').options].map(o => o.textContent);
        expect(labels).toContain('Nothing fed');
        expect(screen.getByText(/On the stage now/)).toBeTruthy();
    });

    it('says to capture a game first when there is nothing to spotlight', () => {
        ui();
        expect(screen.getByText(/No captured game on scoreboard 1 yet/)).toBeTruthy();
    });
});
