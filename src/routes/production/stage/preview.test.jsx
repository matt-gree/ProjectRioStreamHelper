import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useStateStore } from '../../../context/store';
import { ELEMENTS } from '../elements';
import StagePreview, { previewUrl } from './preview';

const el = (id) => ELEMENTS.find(e => e.id === id);
const bind = (url) => ({ item: { sourceName: 'SB', url }, scene: 'Main', where: 'program' });

/*
 * The preview's one real decision: WHICH url it renders.
 *
 * Previewing the element's canonical url when the producer's source carries
 * something else (a size variant, ?intro=0, a different board) would show them
 * an overlay nobody is broadcasting — a confident lie, and worse than no
 * preview at all. So a bound element always previews its own source.
 */
describe('previewUrl', () => {
    it('previews the bound source, not the canonical element url', () => {
        const url = previewUrl(el('scoreboard'), 1,
            bind('http://obs-host:5260/layout/scoreboard1/scoreboard.html?scoreboard=2&size=s'));
        expect(url).toContain('scoreboard=2');
        expect(url).toContain('size=s');
        expect(url).toContain('preview=1');
    });

    // A dual-machine rig's source points at the PRSH host by IP. The preview
    // runs in the producer's browser, which is already served by that host, so
    // it must load same-origin rather than reaching back out over the network.
    it('strips the origin so a remote source url still loads locally', () => {
        const url = previewUrl(el('scoreboard'), 1,
            bind('http://192.168.1.50:5260/layout/scoreboard1/scoreboard.html?scoreboard=1'));
        expect(url.startsWith('/layout/')).toBe(true);
        expect(url).not.toContain('192.168');
    });

    it('falls back to what Bind would create when unbound', () => {
        const url = previewUrl(el('scoreboard'), 2, null);
        expect(url).toContain('scoreboard=2');
        expect(url).toContain('preview=1');
    });

    // Not every element is board-scoped; inventing ?scoreboard= for a Lower
    // Third would be the same bug instanceUrl already guards against.
    it('adds no board param to an element that has no board', () => {
        const url = previewUrl(el('lowerthird'), 1, null);
        expect(url).not.toContain('scoreboard=');
        expect(url).toContain('preview=1');
    });

    it('keeps intro=0 so the preview matches a no-animation source', () => {
        const url = previewUrl(el('scoreboard'), 1,
            bind('http://localhost:5260/layout/scoreboard1/scoreboard.html?scoreboard=1&intro=0'));
        expect(url).toContain('intro=0');
    });

    it('does not double up preview=1 on a url that already has it', () => {
        const url = previewUrl(el('scoreboard'), 1,
            bind('http://localhost:5260/layout/scoreboard1/scoreboard.html?preview=1'));
        expect(url.match(/preview=1/g)).toHaveLength(1);
    });

    it('has something to show for every registered element', () => {
        for (const element of ELEMENTS) {
            expect(previewUrl(element, 1, null), element.id).toBeTruthy();
        }
    });
});

/*
 * A fed element has NO source of its own — Character Spotlight and Game Summary
 * are both registered at /layout/shared/callout-stage.html, and the container
 * draws whichever occupant is fed to it. So `previewUrl` returns the same URL
 * for both, and the container in PREVIEW_MODE hardcodes ONE occupant: every
 * Callout Stage preview drew Character Spotlight, whatever panel it was under.
 *
 * `?feed=` is how a preview names the occupant it wants. The container honours
 * it (callout-stage.html) and falls back to its hardcoded default, so a bare
 * ?preview=1 from the Setup catalog is unchanged.
 */
describe('previewUrl — a fed element names the occupant it wants', () => {
    const CALLOUT = 'http://x/layout/shared/callout-stage.html';
    const fedAt = (carrying) => ({
        item: { id: 3, sourceName: 'Callout', url: CALLOUT, enabled: true },
        scene: 'Game', where: 'program', parent: 'callout@Game',
        container: 'callout-stage', carrying,
    });

    it('asks the container for THIS element, not whatever is fed', () => {
        expect(previewUrl(el('postgamevs'), null, fedAt('postgamecallout')))
            .toContain('feed=postgamevs');
        expect(previewUrl(el('postgamecallout'), null, fedAt('postgamevs')))
            .toContain('feed=postgamecallout');
    });

    // Two elements, one source, two different previews — the whole point.
    it('gives two occupants of one container different preview urls', () => {
        const a = previewUrl(el('postgamevs'), null, fedAt(null));
        const b = previewUrl(el('postgamecallout'), null, fedAt(null));
        expect(a).not.toBe(b);
    });

    // The container's own row shows what it is really carrying.
    it('asks a container row for whatever it is carrying', () => {
        const container = { item: { id: 3, sourceName: 'Callout', url: CALLOUT }, scene: 'Game', where: 'program', container: 'callout-stage', carrying: 'postgamevs' };
        expect(previewUrl({ id: 'layout:/x', name: 'Callout Stage', flavor: 'direct' }, null, container))
            .toContain('feed=postgamevs');
    });

    it('leaves an empty container to its own default', () => {
        const container = { item: { id: 3, sourceName: 'Callout', url: CALLOUT }, scene: 'Game', where: 'program', container: 'callout-stage', carrying: null };
        expect(previewUrl({ id: 'layout:/x', name: 'Callout Stage', flavor: 'direct' }, null, container))
            .not.toContain('feed=');
    });

    // A direct element owns its source; naming a feed on it would be nonsense.
    it('adds no feed param to a direct element', () => {
        expect(previewUrl(el('scoreboard'), 1, bind('http://x/layout/scoreboard1/scoreboard.html')))
            .not.toContain('feed=');
    });
});

/*
 * A pickable fed element (Character Spotlight) has no live selection until the
 * producer picks — and picking is on-air. So its preview draws the STANDING
 * INTENT (the character Push would show) via ?feedsel=, without a live pick.
 */
describe('StagePreview renders', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', {
            getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
        });
        useStateStore.setState({ score: {}, production: {}, postgame: {} });
    });
    afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
    const ui = (node) => render(<TooltipProvider>{node}</TooltipProvider>);
    const CALLOUT = 'http://x/layout/shared/callout-stage.html';
    const fedBinding = (carrying) => ({
        item: { id: 3, sourceName: 'Callout', url: CALLOUT, enabled: true },
        scene: 'Game', where: 'program', parent: 'callout@Game',
        container: 'callout-stage', carrying,
    });
    const ch = (name, b = {}) => ({ name, batting: { singles: 0, doubles: 0, triples: 0, homeruns: 0, rbi: 0, ...b } });

    it('shows an iframe for a fed element', () => {
        ui(<StagePreview element={el('postgamevs')} board={null} binding={fedBinding('postgamecallout')} />);
        const frame = document.querySelector('iframe');
        expect(frame).not.toBeNull();
        expect(frame.getAttribute('src')).toContain('feed=postgamevs');
    });

    it('previews the spotlight\'s SUGGESTED character with no live pick', () => {
        // A captured game with a clear leader, and nothing fed to the container.
        useStateStore.setState({
            postgame: {
                1: {
                    present: true, meta: { winnerSide: 1 },
                    player: { 1: { characters: [ch('Peach', { singles: 1 }), ch('Daisy', { homeruns: 2 })] }, 2: {} },
                },
            },
        });
        ui(<StagePreview element={el('postgamecallout')} board={null} binding={fedBinding(null)} />);
        const src = document.querySelector('iframe').getAttribute('src');
        expect(src).toContain('feed=postgamecallout');
        const feedsel = JSON.parse(decodeURIComponent(new URL(src, 'http://x').searchParams.get('feedsel')));
        expect(feedsel).toMatchObject({ scoreboard: 1, team: 1, charIndex: 1 }); // Daisy, the leader
        // And it did NOT write the live container key — a preview is never on air.
        expect(useStateStore.getState()?.production?.feed?.container?.['callout-stage']).toBeUndefined();
    });

    it('sends no feedsel when there is nothing to spotlight yet', () => {
        ui(<StagePreview element={el('postgamecallout')} board={null} binding={fedBinding(null)} />);
        const src = document.querySelector('iframe').getAttribute('src');
        expect(src).toContain('feed=postgamecallout');
        expect(src).not.toContain('feedsel=');
    });
});
