import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { ELEMENTS, isPinnable } from './elements';
import { Stage, stageBodyComponent } from './stage';
import { DirectStage, FedStage } from './stage/generic';

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
    it('renders the selected element in a panel with its state chip', () => {
        ui(<Stage selection="scoreboard" />);
        expect(screen.getByText('Scoreboard')).toBeInTheDocument();
        expect(document.querySelectorAll('[data-chip-state="unbound"]').length).toBe(1);
    });

    it('explains an unbound source instead of showing dead controls', () => {
        ui(<Stage selection="scoreboard" />);
        expect(screen.getByText(/isn’t in any scene we can see/)).toBeInTheDocument();
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
        const stats = ELEMENTS.find(e => e.id === 'stats');
        expect(stageBodyComponent(scoreboard)).toBe(DirectStage);
        expect(stageBodyComponent(stats)).toBe(FedStage);
    });

    it('only offers the rail pin where the element declares a quick face', () => {
        const pinnable = ELEMENTS.filter(isPinnable);
        expect(pinnable.length).toBeGreaterThan(0);
        const el = pinnable[0];
        ui(<Stage selection={el.id} />);
        expect(screen.getByRole('button', { name: /quick rail/ })).toBeInTheDocument();
    });
});
