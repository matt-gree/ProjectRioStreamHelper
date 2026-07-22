import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useObsStore } from '../../context/obs';
import { ELEMENTS } from './elements';
import { SourceStrip } from './sourcestrip';

afterEach(() => {
    cleanup();
    useObsStore.setState({
        status: 'disconnected', studioMode: false,
        programScene: null, previewScene: null, sceneItems: {}, scenes: [],
    });
});

const ui = (node) => render(<TooltipProvider>{node}</TooltipProvider>);
const el = (id) => ELEMENTS.find(e => e.id === id);

// A PRSH browser source as the OBS mirror stores it.
const src = (id, sourceName, url, enabled) => ({
    id, sourceName, url, enabled, inputKind: 'browser_source', isGroup: false, isPrsh: true,
});

const connected = (items, extra = {}) => useObsStore.setState({
    status: 'connected', programScene: 'Main', scenes: ['Main'],
    mirroredScenes: ['Main'], sceneItems: { Main: items }, ...extra,
});

// The placement the console hands the strip — element + board + the scene item
// it drives. The strip never resolves one of its own: which source it commands
// is the same fact as which rack row the producer clicked.
const at = (item, where = 'program', scene = 'Main') => ({ scene, where, item });

/*
 * The strip's slots are PROGRESSIVE, not per-element: what renders is decided
 * by whether a source exists, never by which element it is. These tests pin
 * that, because it is the whole reason one strip can serve every workbench.
 */
describe('SourceStrip slots', () => {
    it('offers only Bind while the element has no source', () => {
        connected([]);
        ui(<SourceStrip element={el('scoreboard')} />);
        expect(screen.getByRole('button', { name: /add to obs/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /show|hide/i })).not.toBeInTheDocument();
    });

    it('retires Bind and offers Air once a source is bound', () => {
        const item = src(1, 'Scoreboard', 'http://x/layout/scoreboard1/scoreboard.html', false);
        connected([item]);
        ui(<SourceStrip element={el('scoreboard')} placement={at(item)} />);
        expect(screen.queryByRole('button', { name: /add to obs/i })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /show scoreboard on air/i })).toBeInTheDocument();
    });

    it('reads Hide when the bound source is visible', () => {
        const item = src(1, 'Scoreboard', 'http://x/layout/scoreboard1/scoreboard.html', true);
        connected([item]);
        ui(<SourceStrip element={el('scoreboard')} placement={at(item)} />);
        expect(screen.getByRole('button', { name: /hide scoreboard on air/i })).toBeInTheDocument();
    });

    // Studio mode is what preview is FOR: build off-air, then Take.
    it('says it will add into the preview scene under studio mode', () => {
        connected([], { studioMode: true, previewScene: 'Staging', scenes: ['Main', 'Staging'] });
        ui(<SourceStrip element={el('scoreboard')} />);
        expect(screen.getByRole('button', { name: /add to obs/i })).toBeEnabled();
    });

    it('cannot bind with OBS disconnected, and says why instead of dangling a dead button', () => {
        ui(<SourceStrip element={el('scoreboard')} />);
        expect(screen.queryByRole('button', { name: /add to obs/i })).not.toBeInTheDocument();
        expect(screen.getByText(/obs offline/i)).toBeInTheDocument();
    });
});

/*
 * The strip commands exactly the placement it was handed — never a source it
 * went looking for. That is what stops a header from toggling one board's (or
 * one scene's) copy while the row the producer clicked meant another's.
 */
describe('SourceStrip drives its placement', () => {
    const sb = (n) => src(n, `Board ${n}`,
        `http://x/layout/scoreboard1/scoreboard.html?scoreboard=${n}`, false);

    it('drives the board it was given, not the first source in the scene', () => {
        const [one, two] = [sb(1), sb(2)];
        connected([one, two]);
        ui(<SourceStrip element={el('scoreboard')} board={2} placement={at(two)} />);
        expect(screen.getByRole('button', { name: /show board 2 on air/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /show board 1 on air/i })).not.toBeInTheDocument();
    });

    // In an off-air scene "on air" would be a lie, so the label names the scene.
    it('names the scene when the placement is in neither program nor preview', () => {
        const item = sb(1);
        connected([item], { scenes: ['Main', 'Break'] });
        ui(<SourceStrip element={el('scoreboard')} board={1} placement={at(item, 'other', 'Break')} />);
        expect(screen.getByRole('button', { name: /show board 1 in break/i })).toBeInTheDocument();
    });

    it('offers Bind when the panel has no placement at all', () => {
        connected([sb(1), sb(2)]);
        ui(<SourceStrip element={el('scoreboard')} board={3} />);
        expect(screen.getByRole('button', { name: /add to obs/i })).toBeInTheDocument();
    });
});

/*
 * Fed elements get a third slot, and it STAYS PUT — a slot that appears and
 * vanishes per element is the mishmash this contract exists to end.
 */
describe('SourceStrip push slot', () => {
    it('is absent for direct elements', () => {
        const item = src(1, 'Scoreboard', 'http://x/layout/scoreboard1/scoreboard.html', true);
        connected([item]);
        ui(<SourceStrip element={el('scoreboard')} placement={at(item)} />);
        expect(screen.queryByRole('button', { name: /push|clear/i })).not.toBeInTheDocument();
    });

    it('renders for a fed element even with nothing bound, disabled until pickable content exists', () => {
        connected([]);
        ui(<SourceStrip element={el('stats')} />);
        // 'stats' is a pickable feed with nothing ever picked: honest and grey,
        // not hidden.
        expect(screen.getByRole('button', { name: /^push$/i })).toBeDisabled();
    });

    it('lets a push-only fed element push without a prior pick', () => {
        connected([]);
        ui(<SourceStrip element={el('postgamevs')} />);
        expect(screen.getByRole('button', { name: /^push$/i })).toBeEnabled();
    });

    // A fed element's Air slot commands the CONTAINER, not a source of its own —
    // which is exactly what its placement is (./placements).
    it('binds Air to the shared container the element feeds', () => {
        const item = src(7, 'Callout Stage', 'http://x/layout/shared/callout-stage.html', false);
        connected([item]);
        ui(<SourceStrip element={el('postgamevs')} placement={at(item)} />);
        expect(screen.getByRole('button', { name: /show callout stage on air/i })).toBeInTheDocument();
    });
});
