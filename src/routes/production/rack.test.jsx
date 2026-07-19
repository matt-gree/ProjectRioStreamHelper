import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { elementsForPhase, ELEMENTS } from './elements';
import { DESKS, RAIL_SEED, Rack } from './rack';

// The test env's localStorage (Node's experimental stub) has no working
// methods — usePersistentState silently no-ops against it. Stub a real one so
// selection/rail persistence is observable.
const store = new Map();
const fakeLocalStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
};

beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', fakeLocalStorage);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const ui = (node) => render(<TooltipProvider>{node}</TooltipProvider>);

// With OBS disconnected (store defaults), the rack must still render: desks
// stay usable and every in-phase element lists with an unbound (—) chip.
// This is the console's no-OBS contract — same guarantee MatchCard had.
describe('Rack without OBS', () => {
    it('renders every desk row with live meta defaults', () => {
        ui(<Rack phase="live" />);
        for (const desk of DESKS) expect(screen.getByText(desk.name), desk.id).toBeInTheDocument();
        expect(screen.getByText('no match')).toBeInTheDocument();
        expect(screen.getByText('empty')).toBeInTheDocument();
        expect(screen.getByText('nothing loaded')).toBeInTheDocument();
    });

    // Every desk the rack lists needs a body to select into and, when it says
    // it's pinnable, a quick face for the rail — the three registries are
    // written in three files and would otherwise drift apart silently.
    it('every desk row has a stage body, and a quick face iff it is pinnable', async () => {
        const { DESK_BODIES } = await import('./production');
        const { DESK_QUICK_FACES } = await import('./quickface');
        for (const desk of DESKS) {
            expect(DESK_BODIES[desk.id], `${desk.id} has a stage body`).toBeTruthy();
            expect(DESK_BODIES[desk.id].pinnable !== false, `${desk.id} body agrees on pinnable`)
                .toBe(desk.pinnable !== false);
            expect(DESK_QUICK_FACES[desk.id] != null, `${desk.id} quick face`)
                .toBe(desk.pinnable !== false);
        }
        expect(Object.keys(DESK_BODIES).length).toBe(DESKS.length);
    });

    it('lists every current-phase element under off-air with an unbound chip', () => {
        ui(<Rack phase="live" />);
        const live = elementsForPhase('live');
        for (const el of live) expect(screen.getByText(el.name)).toBeInTheDocument();
        // all unbound → chips read '—'; every desk row carries a DESK chip
        expect(screen.getAllByText('—').length).toBe(live.length);
        expect(document.querySelectorAll('[data-chip-state="desk"]').length).toBe(DESKS.length);
    });

    it('collapses the other phases behind a count row and expands on click', () => {
        ui(<Rack phase="live" />);
        const rest = ELEMENTS.length - elementsForPhase('live').length;
        const toggle = screen.getByRole('button', { expanded: false, name: /OTHER PHASES/ });
        expect(toggle).toHaveTextContent(String(rest));
        expect(screen.queryByText('Lower Third')).not.toBeInTheDocument();
        fireEvent.click(toggle);
        expect(screen.getByText('Lower Third')).toBeInTheDocument();
    });

    it('clicking a row selects it (persisted selection)', () => {
        ui(<Rack phase="live" />);
        fireEvent.click(screen.getByText('Scoreboard'));
        expect(JSON.parse(fakeLocalStorage.getItem('prsh.ui.production.selection'))).toBe('scoreboard');
    });

    it('pinning a row appends it to the seeded rail order', () => {
        ui(<Rack phase="live" />);
        // A never-touched rail starts seeded, so the seeded rows already read
        // as pinned and the first ◇ belongs to something else.
        const pins = screen.getAllByRole('button', { name: 'Pin to quick rail' });
        fireEvent.click(pins[0]);
        const rail = JSON.parse(fakeLocalStorage.getItem('prsh.ui.production.rail'));
        expect(rail.slice(0, RAIL_SEED.length)).toEqual(RAIL_SEED);
        expect(rail.length).toBe(RAIL_SEED.length + 1);
    });

    it('unpinning a seeded row writes an explicit array without it', () => {
        ui(<Rack phase="live" />);
        const unpin = screen.getAllByRole('button', { name: 'Unpin from quick rail' });
        expect(unpin.length).toBe(RAIL_SEED.length);
        fireEvent.click(unpin[0]);
        const rail = JSON.parse(fakeLocalStorage.getItem('prsh.ui.production.rail'));
        expect(rail).toEqual(RAIL_SEED.slice(1));
    });
});
