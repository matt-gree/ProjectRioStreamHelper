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
     * WITH OBS CLOSED THE PANEL SAYS NOTHING ABOUT ITS BINDING. Every panel is
     * unbound then — that is what disconnected means — so a per-panel notice is
     * one fact repeated once per panel, and the app already carries it at the
     * page's top left. What is left is the affordance itself: Copy URL in the
     * header strip, which is a control, not a caption about a control.
     */
    it('offers Copy URL and no notice about the connection', () => {
        ui(<Stage selection="scoreboard" />);
        expect(screen.queryByText('NO OBS')).not.toBeInTheDocument();
        expect(screen.queryByText('NO SOURCE')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Copy URL/ })).toBeInTheDocument();
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

    /*
     * A PANEL WHOSE NAME IS AUTHORED IS RENAMED WHERE IT IS NAMED. Only a desk
     * that hands the stage a `rename` gets a typeable title; every other panel's
     * title is derived, and offering to type over one would promise a name the
     * thing does not have.
     */
    it('makes a renameable desk’s title the field that sets it', () => {
        const wrote = [];
        ui(<Stage
            selection="desk:board:2"
            deskBodies={{
                'desk:board:2': {
                    title: 'Cam A',
                    rename: { value: 'Cam A', placeholder: 'Scoreboard 2', onChange: v => wrote.push(v) },
                    body: <p>board body</p>,
                },
            }}
        />);
        const field = screen.getByLabelText('Name');
        expect(field).toHaveValue('Cam A');
        expect(field).toHaveAttribute('placeholder', 'Scoreboard 2');
        fireEvent.change(field, { target: { value: 'Cam B' } });
        fireEvent.blur(field);
        expect(wrote).toEqual(['Cam B']);
    });

    it('leaves a derived title as text — there is no name to type over', () => {
        ui(<Stage
            selection="desk:match"
            deskBodies={{ 'desk:match': { title: 'Match', body: <p>desk body</p> } }}
        />);
        expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
        expect(screen.getByText('Match')).toBeInTheDocument();
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
        expect(stageBodyComponent(scoreboard)).toBe(DirectStage);
        // A hypothetical fed-only element — the registry has none since the Stat
        // Card got its own ?team= source, and the floor still has to answer for
        // one, because `flavor` is what a placement falls back to when it names
        // no slot (see placementFlavor).
        expect(stageBodyComponent({ id: 'nosource', flavor: 'fed' })).toBe(FedStage);
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
