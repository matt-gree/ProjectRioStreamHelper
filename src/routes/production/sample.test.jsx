import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useStateStore } from '../../context/store';
import SampleModeBanner, { SampleModeSwitch, isSampleOn, SAMPLE_KEY } from './sample';

beforeEach(() => {
    useStateStore.setState({ production: {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/*
 * Demo mode puts a fixture on every overlay, including ones already in a live
 * OBS scene. Everything here is about the two directions of that risk: it must
 * never come on by itself, and a producer must never be able to lose track of
 * the fact that it is on.
 */
describe('sample-data demo mode', () => {
    it('is off until something turns it on', () => {
        render(<SampleModeBanner />);
        expect(screen.queryByText(/sample data is on air/i)).not.toBeInTheDocument();
    });

    it('the switch writes the global state key, not a per-element one', () => {
        const setItem = vi.fn();
        useStateStore.setState({ production: {}, setItem });

        render(<SampleModeSwitch />);
        fireEvent.click(screen.getByRole('switch'));

        expect(setItem).toHaveBeenCalledWith(SAMPLE_KEY, true);
    });

    it('raises an unmissable banner while it is on', () => {
        useStateStore.setState({ production: { sample: true } });
        render(<SampleModeBanner />);

        expect(screen.getByText(/sample data is on air/i)).toBeInTheDocument();
        // The banner carries the way out. It is the panic button for a producer
        // who has just realised the stream is showing canned content, so it
        // must not be a trip back to the Production tab to find a switch.
        expect(screen.getByRole('button', { name: /show live game/i })).toBeInTheDocument();
    });

    it('the banner turns it off immediately, never staged', () => {
        const setItem = vi.fn();
        useStateStore.setState({ production: { sample: true }, setItem });

        render(<SampleModeBanner />);
        fireEvent.click(screen.getByRole('button', { name: /show live game/i }));

        expect(setItem).toHaveBeenCalledWith(SAMPLE_KEY, false);
    });

    it('reads the switch strictly, matching the overlays', () => {
        // `PUT /api/v1/state` is str-typed, so an off written over REST lands as
        // the string "false". The producer UI and the overlays have to agree on
        // what counts as on, or the banner says one thing and the stream shows
        // another.
        expect(isSampleOn(true)).toBe(true);
        expect(isSampleOn('true')).toBe(true);
        expect(isSampleOn('1')).toBe(true);
        expect(isSampleOn('false')).toBe(false);
        expect(isSampleOn(undefined)).toBe(false);
        expect(isSampleOn(0)).toBe(false);
    });

    it('nothing in the app writes the key on', () => {
        // A "no game running, let's helpfully show the sample" path would put a
        // fixture on a live broadcast. The only writers are the two controls in
        // sample.jsx; this fails if a third appears.
        const writers = import.meta.glob('/src/**/*.{js,jsx}', { eager: true, query: '?raw', import: 'default' });
        const offenders = Object.entries(writers)
            .filter(([path]) => !path.endsWith('/sample.jsx') && !path.includes('.test.'))
            .filter(([, src]) => /production\.sample/.test(src))
            .map(([path]) => path);
        expect(offenders).toEqual([]);
    });
});
