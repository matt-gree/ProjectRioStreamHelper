import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore } from '../../context/store';
import { useStagingStore } from '../../context/staging';
import { PendingBar } from './production';

beforeEach(() => {
    vi.stubGlobal('localStorage', {
        getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
    });
    useStagingStore.setState({ pending: {}, order: [] });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const ui = () => render(<TooltipProvider><PendingBar /></TooltipProvider>);
const confirmMode = (enabled) =>
    useSettingsStore.setState({ production: { confirm: { enabled } } });

/*
 * The staged-changes bar only renders with confirm mode on, and its chip list
 * only renders once something is actually staged — so it is invisible to any
 * test that just mounts the page. That hid a ReferenceError in the chip markup
 * that would have fired the first time a producer staged a change mid-show.
 */
describe('PendingBar', () => {
    it('stays out of the way when confirm mode is off', () => {
        confirmMode(false);
        const { container } = ui();
        expect(container).toBeEmptyDOMElement();
    });

    it('explains itself when armed but empty', () => {
        confirmMode(true);
        ui();
        expect(screen.getByText(/Confirm mode on/)).toBeInTheDocument();
    });

    it('renders a chip per staged change, with a discard on each', () => {
        confirmMode(true);
        useStagingStore.setState({
            pending: {
                'state:a': { key: 'state:a', label: 'Lower third: slot 1 title', value: 'x', run: () => {} },
                'state:b': { key: 'state:b', label: 'Scorecard 1: Box Score', value: false, run: () => {} },
            },
            order: ['state:a', 'state:b'],
        });
        ui();
        expect(screen.getByText('2 staged changes')).toBeInTheDocument();
        expect(screen.getByText('Lower third: slot 1 title')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Go Live/ })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Discard Scorecard 1: Box Score' }));
        expect(useStagingStore.getState().order).toEqual(['state:a']);
    });
});
