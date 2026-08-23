import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore } from '../../context/store';
import { ELEMENTS, isPinnable } from './elements';
import { Stage, stageBodyComponent } from './stage';
import { DirectStage, FedStage } from './stage/generic';
import { withContainers } from '../../test/containers';

beforeEach(() => useSettingsStore.setState({ production: withContainers() }));
afterEach(cleanup);

const ui = (node) => render(<TooltipProvider>{node}</TooltipProvider>);

/*
 * Like the rack, the stage must work with OBS disconnected — and unlike the
 * rack, it must still open a panel for something with no source anywhere. The
 * rack lists only what is really in a scene, but several stage bodies write
 * STATE, not OBS: authoring a lower third the night before is a real workflow
 * that has nothing to do with whether a browser source exists yet.
 */
describe('Stage without OBS', () => {
    /*
     * "Scoreboard · Large" not "Scoreboard": with OBS closed the catalog offers
     * all three sizes, so the default one names itself like its siblings rather
     * than being the unlabelled row beside a Small and a Medium. Its id is still
     * the bare `scoreboard` (see variantLabelFor).
     */
    it('renders the selected element in a panel with its state chip', () => {
        ui(<Stage selection="scoreboard" />);
        expect(screen.getByText('Scoreboard · Large')).toBeInTheDocument();
        expect(document.querySelectorAll('[data-chip-state="unbound"]').length).toBe(1);
    });

    /*
     * An unbound panel explains itself rather than showing dead controls — and
     * with OBS closed it explains the RIGHT thing. "Isn't in any scene we can
     * see" is true then but useless, and both ways out it used to name (the
     * header's Bind, a scene's +) exist only with a connection.
     */
    it('points at Copy URL rather than at a Bind it cannot offer', () => {
        ui(<Stage selection="scoreboard" />);
        expect(screen.getByText(/OBS isn’t connected/)).toBeInTheDocument();
        expect(screen.getByText(/Copy URL in the header/)).toBeInTheDocument();
    });

    it('renders a desk body with a DESK chip and honours pinnable:false', () => {
        ui(<Stage
            selection="desk:match"
            deskBodies={{ 'desk:match': { title: 'Match', body: <p>desk body</p>, pinnable: false } }}
        />);
        expect(screen.getByText('desk body')).toBeInTheDocument();
        expect(document.querySelectorAll('[data-chip-state="desk"]').length).toBe(1);
        expect(screen.queryByRole('button', { name: /quick rail/ })).not.toBeInTheDocument();
    });

    it('falls back to a hint when nothing valid is selected', () => {
        ui(<Stage selection="nope" />);
        expect(screen.getByText(/Pick anything in the rack/)).toBeInTheDocument();
    });
});

// The stage-body switchboard is the contract's "every element has a stage":
// a dedicated file when it has one, else the floor its flavor guarantees.
describe('stageBodyComponent', () => {
    it('resolves a component for every registered element', () => {
        // memo() wrappers are objects, plain function components are functions —
        // both are valid element types, neither may be missing.
        for (const el of ELEMENTS) {
            const Body = stageBodyComponent(el);
            expect(['function', 'object']).toContain(typeof Body);
            expect(Body).toBeTruthy();
        }
    });

    it('falls back by flavor for elements without a dedicated body', () => {
        const scoreboard = ELEMENTS.find(e => e.id === 'scoreboard');
        const statscard = ELEMENTS.find(e => e.id === 'statscard');
        expect(stageBodyComponent(scoreboard)).toBe(DirectStage);
        // The Stat Card has no source of its own, so it is fed wherever it is
        // asked about — there is no other answer for it.
        expect(stageBodyComponent(statscard)).toBe(FedStage);
    });

    /*
     * A member that owns a source is two panels, and the PLACEMENT is what
     * says which one. Its own source gets the direct floor (or its own body);
     * its slot on a container gets the fed one, whose questions are what to
     * hand over and which container is carrying it.
     */
    it('answers by placement for a member that also owns a source', () => {
        const spotlight = ELEMENTS.find(e => e.id === 'postgamecallout');
        const hit = ELEMENTS.find(e => e.id === 'hitvisualizer');
        expect(stageBodyComponent(spotlight, { scene: 'Main' })).toBe(DirectStage);
        expect(stageBodyComponent(spotlight, { slot: 'callout-stage' })).toBe(FedStage);
        // …including one with a dedicated body: Replay and Spotlight act on the
        // hit's own source, so its slot row must not offer them.
        expect(stageBodyComponent(hit, { slot: 'split-screen' })).toBe(FedStage);
    });

    it('only offers the rail pin where the element declares a quick face', () => {
        const pinnable = ELEMENTS.filter(isPinnable);
        expect(pinnable.length).toBeGreaterThan(0);
        const el = pinnable[0];
        ui(<Stage selection={el.id} />);
        expect(screen.getByRole('button', { name: /quick rail/ })).toBeInTheDocument();
    });
});

/*
 * Deleting a container definition takes its feed, its resting occupant and every
 * automation rule driving one of its members with it (`detach`/`dropRules` in
 * ./containers) — a larger blast radius than the match delete one page over,
 * which has always confirmed. It must not be reachable in one click.
 */
describe('Container delete', () => {
    it('confirms before it deletes, and the first click deletes nothing', () => {
        ui(<Stage selection="container:callout-stage" />);
        fireEvent.click(screen.getByRole('button', { name: /Delete container/ }));
        // Still defined — the first click only opened the confirm.
        expect(useSettingsStore.getState().production.container_defs['callout-stage']).toBeTruthy();
        expect(screen.getByText(/drops its members’ automation rules/)).toBeInTheDocument();
    });

    it('deletes on the second click', () => {
        ui(<Stage selection="container:callout-stage" />);
        fireEvent.click(screen.getByRole('button', { name: /Delete container/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(useSettingsStore.getState().production.container_defs['callout-stage']).toBeFalsy();
    });
});
