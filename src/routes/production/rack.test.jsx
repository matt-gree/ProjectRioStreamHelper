import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore } from '../../context/store';
import { elementsForPhase, ELEMENTS } from './elements';
import { DESKS, RAIL_SEED, Rack, deskForPhase } from './rack';

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
    useSettingsStore.setState({ scoreboards: {}, production: {} });
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
    // Each desk racks only in its own phase, with its live meta. The rack shows
    // what the producer is working on now, so a phase's desk is the only one
    // present — and Live, owning none, shows no DESK section at all.
    it.each([
        ['draft', 'Match', 'no match'],
        ['post', 'Capture', 'empty'],
        ['break', 'Bracket', 'nothing loaded'],
    ])('racks only the %s desk, with live meta defaults', (phase, name, meta) => {
        ui(<Rack phase={phase} />);
        // Scoped to the desk section — some element rows share a desk's name
        // (the Bracket overlay vs the Bracket desk).
        const section = within(document.querySelector('[data-rack-section="desk"]'));
        expect(section.getByText(name)).toBeInTheDocument();
        expect(section.getByText(meta)).toBeInTheDocument();
        for (const other of DESKS.filter(d => d.phase !== phase)) {
            expect(section.queryByText(other.name), `${other.id} is off-phase`).not.toBeInTheDocument();
        }
        expect(document.querySelectorAll('[data-chip-state="desk"]').length).toBe(1);
    });

    it('shows no desk section in Live, which owns none', () => {
        ui(<Rack phase="live" />);
        expect(screen.queryByText('DESK')).not.toBeInTheDocument();
        expect(document.querySelectorAll('[data-chip-state="desk"]').length).toBe(0);
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

    // Each desk owns the phase it belongs to, and the page's phase switch
    // selects it — the producer lands on the desk that phase is *for*. Live
    // owns none on purpose: mid-game the selection is the producer's.
    it('assigns each desk its home phase, one desk per phase', () => {
        expect(deskForPhase('draft')).toBe('desk:match');
        expect(deskForPhase('post')).toBe('desk:capture');
        expect(deskForPhase('break')).toBe('desk:bracket');
        expect(deskForPhase('live')).toBeUndefined();
        const phases = DESKS.map(d => d.phase);
        expect(new Set(phases).size, 'no two desks claim the same phase').toBe(phases.length);
    });

    it('lists every current-phase element under off-air with an unbound chip', () => {
        ui(<Rack phase="live" />);
        const live = elementsForPhase('live');
        for (const el of live) expect(screen.getByText(el.name)).toBeInTheDocument();
        // all unbound → chips read '—' (Live racks no desk, so no DESK chips)
        expect(screen.getAllByText('—').length).toBe(live.length);
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

    it('clicking a row selects the INSTANCE, board and all', () => {
        ui(<Rack phase="live" />);
        fireEvent.click(screen.getByText('Scoreboard'));
        expect(JSON.parse(fakeLocalStorage.getItem('prsh.ui.production.selection'))).toBe('scoreboard:1');
    });

    /*
     * Instances. A board-scoped element is one row PER BOARD, because two
     * `?scoreboard=N` sources are two independent things with their own air
     * state. Before this the rack had one Scoreboard row whose board came from
     * a hidden stored preference, so a two-board rig had one control silently
     * driving one of them.
     */
    // Rows read "<name><board?>"; several board-scoped elements share a board
    // meta, so rows are addressed structurally rather than by text.
    // The row's select button is name + board meta; the chip and pin glyphs
    // around it aren't part of what the row is called.
    const rowsNamed = (name) => [...document.querySelectorAll(`[data-rack-row="${name}"]`)]
        .map(r => r.querySelector('button').textContent);

    it('racks a board-scoped element once per active board, named apart', () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui(<Rack phase="live" />);
        expect(rowsNamed('Scoreboard')).toEqual(['ScoreboardScoreboard 1', 'ScoreboardScoreboard 2']);
    });

    it('leaves a global element as one row however many boards are active', () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2, 3] } });
        ui(<Rack phase="break" />);
        expect(rowsNamed('Lower Third')).toEqual(['Lower Third']);
    });

    // The suffix is the board mechanism charging rent: on a single-board rig
    // there is nothing to tell apart, so "Scoreboard · Scoreboard 1" is noise.
    it('drops the board suffix when there is only one of an element', () => {
        ui(<Rack phase="live" />);
        expect(rowsNamed('Scoreboard')).toEqual(['Scoreboard']);
    });

    it('uses the board ALIAS in the row, not a bare number', () => {
        useSettingsStore.setState({
            scoreboards: { active: [1, 2], aliases: { 2: 'Feature Court' } },
        });
        ui(<Rack phase="live" />);
        expect(rowsNamed('Scoreboard')).toContain('ScoreboardFeature Court');
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
