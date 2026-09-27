import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, renderHook, act } from '@testing-library/react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useObsStore } from '../../../context/obs';
import RosterLayoutRow, { useRosterPlacement, withLayoutVariant } from './rosterlayout';

/*
 * A Roster's layout is its CANVAS, so switching one must rewrite `?layout=` and
 * resize the OBS source in the same call — never the URL alone, which would draw
 * a row squeezed into a grid-sized source.
 */

const URL_BASE = 'http://localhost:5260/layout/scoreboard1/roster.html?scoreboard=1&team=1';
const roster = { id: 'roster', url: '/layout/scoreboard1/roster.html', boardParam: true };
const placement = (over = {}) => ({
    element: roster, board: 1, scene: 'Game', variant: 't1',
    item: { sourceName: 'Roster 1', url: URL_BASE },
    ...over,
});

describe('RosterLayoutRow', () => {
    const reshapeBrowserSource = vi.fn(() => Promise.resolve({ sourceName: 'Roster 1', scenes: 1 }));

    const store = new Map();
    beforeEach(() => {
        store.clear();
        // The repo's convention (production.test.jsx): jsdom here has no usable
        // localStorage, and the offline choice lives in it.
        vi.stubGlobal('localStorage', {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: (k) => store.delete(k),
            clear: () => store.clear(),
        });
        useObsStore.setState({ reshapeBrowserSource });
        reshapeBrowserSource.mockClear();
    });
    afterEach(cleanup);

    const ui = (p, onSelect = () => {}) => render(
        <TooltipProvider><RosterLayoutRow placement={p} onSelect={onSelect} /></TooltipProvider>,
    );

    it('switches the URL and the source size in one call', async () => {
        const onSelect = vi.fn();
        ui(placement(), onSelect);
        fireEvent.click(screen.getByRole('radio', { name: 'Row' }));
        await waitFor(() => expect(reshapeBrowserSource).toHaveBeenCalledWith({
            sourceName: 'Roster 1', url: `${URL_BASE}&layout=row`, width: 628, height: 68,
        }));
        // The layout is part of the placement id, so the panel follows it.
        await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.stringContaining('yrow')));
    });

    it('reads the current layout off the source', () => {
        ui(placement({ item: { sourceName: 'Roster 1', url: `${URL_BASE}&layout=column` } }));
        expect(screen.getByRole('radio', { name: 'Column' })).toBeChecked();
    });

    it('renders nothing for another element or a container slot', () => {
        const { container: a } = ui(placement({ element: { id: 'statscard' } }));
        expect(a).toBeEmptyDOMElement();
        cleanup();
        const { container: b } = ui(placement({ slot: 'pair' }));
        expect(b).toBeEmptyDOMElement();
    });

    /* OBS closed: nothing to reshape, but the choice must still reach the
     * preview and Copy URL — the console does not lose a surface to OBS. */
    it('with OBS closed, remembers the layout for the row and dresses the placement in it', () => {
        const catalog = placement({ id: 'roster~t1', item: null });
        ui(catalog);
        fireEvent.click(screen.getByRole('radio', { name: 'Field' }));
        expect(reshapeBrowserSource).not.toHaveBeenCalled();
        const { result } = renderHook(() => useRosterPlacement(catalog));
        expect(result.current.variant).toBe('t1.yfield');
        expect(result.current.id).toBe('roster~t1');   // still the rack's row
        act(() => { fireEvent.click(screen.getByRole('radio', { name: 'Grid' })); });
        expect(result.current.variant).toBe('t1');
    });

    it('sets only the layout axis of a variant', () => {
        expect(withLayoutVariant('t2', 'row')).toBe('t2.yrow');
        expect(withLayoutVariant('t2.yrow', 'grid')).toBe('t2');
        expect(withLayoutVariant('t1.ycolumn', 'field')).toBe('t1.yfield');
    });
});
