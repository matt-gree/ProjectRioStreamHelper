import { describe, it, expect } from 'vitest';
import { ELEMENTS } from '../elements';
import { previewUrl } from './preview';

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
