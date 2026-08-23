import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useStateStore } from '../../../context/store';
import { ELEMENTS } from '../elements';
import StagePreview, { previewUrl, frameMaxWidth } from './preview';

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

    /*
     * A catalog-tier row — no scene item, but a variant of its own. The variant
     * is the ROW's, not the source's, so it has to survive having no source: the
     * component narrows its `binding` to null when there is no item, and passing
     * that narrowed value here made "Scoreboard — Small" preview the Large
     * board at Small's dimensions.
     */
    it('honours a sourceless placement’s variant', () => {
        const url = previewUrl(el('scoreboard'), 1, {
            element: el('scoreboard'), board: 1, variant: 'zs', item: null,
        });
        expect(url).toContain('size=s');
        expect(url).toContain('scoreboard=1');
    });

    // The default size is the bare URL, so the Large row must not start
    // spelling a param the mount already assumes.
    it('leaves a bare variant out of the preview url', () => {
        const url = previewUrl(el('scoreboard'), 1, {
            element: el('scoreboard'), board: 1, variant: '', item: null,
        });
        expect(url).not.toContain('size=');
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
 * A member's SLOT has no source of its own: its row's source IS the container,
 * and the container draws whichever occupant is fed to it. So `previewUrl`
 * returns the same URL for every member of one container, and a container in
 * PREVIEW_MODE hardcodes ONE occupant: every Callout Stage preview drew
 * Character Spotlight, whatever panel it was under.
 *
 * `?feed=` is how a preview names the occupant it wants. The container honours
 * it (container.html / callout-stage.html) and falls back to its own default,
 * so a bare ?preview=1 from the Add picker is unchanged.
 *
 * The element's OWN source names nobody — it isn't a container, and ?feed=
 * there would be a param its layout never reads.
 */
describe('previewUrl — a fed element names the occupant it wants', () => {
    const CALLOUT = 'http://x/layout/shared/callout-stage.html';
    const fedAt = (carrying) => ({
        item: { id: 3, sourceName: 'Callout', url: CALLOUT, enabled: true },
        scene: 'Game', where: 'program', parent: 'callout@Game',
        container: 'callout-stage', slot: 'callout-stage', carrying,
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

    /*
     * …and the same element's OWN source is not a container, so it names
     * nobody. It reads its pick out of state itself (the spotlight layout
     * renders `production.feed.last.postgamecallout`), and a ?feed= there would
     * be the preview telling the overlay something it already knows.
     */
    it('names no occupant on the element’s own dedicated source', () => {
        const own = {
            item: {
                id: 4, sourceName: 'Spotlight', enabled: true,
                url: 'http://x/layout/postgame/spotlight.html',
            },
            scene: 'Game', where: 'program',
        };
        const url = previewUrl(el('postgamecallout'), null, own);
        expect(url).toContain('/layout/postgame/spotlight.html');
        expect(url).not.toContain('feed=');
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
 * The Intro toggle writes a preference and then asks OBS to rewrite its
 * sources. The preference is the half that always lands, so the preview follows
 * it rather than the bound url — otherwise toggling Intro changed nothing on
 * screen with OBS closed, which is the case where the preview is the only way
 * to see it. Since the param is part of the src, this is also what remounts the
 * iframe and replays (or skips) the reveal.
 */
describe('previewUrl — the intro preference beats the source url', () => {
    const SB = 'http://localhost:5260/layout/scoreboard1/scoreboard.html?scoreboard=1';

    it('adds intro=0 when the preference is off, even on a url without it', () => {
        expect(previewUrl(el('scoreboard'), 1, bind(SB), 0, null, true)).toContain('intro=0');
    });

    it('strips intro=0 when the preference is on, even if the source still has it', () => {
        expect(previewUrl(el('scoreboard'), 1, bind(`${SB}&intro=0`), 0, null, false))
            .not.toContain('intro=');
    });

    // No preference (an element with no intro animation) must not touch the url
    // — that is what keeps a bound source's own ?intro=0 honest.
    it('leaves the url alone when there is no preference', () => {
        expect(previewUrl(el('scoreboard'), 1, bind(`${SB}&intro=0`), 0, null, null))
            .toContain('intro=0');
    });
});

/*
 * The frame is the SOURCE'S shape, and never bigger than the source.
 *
 * The regression: the frame was `w-full` and only its HEIGHT came from the
 * aspect, so anything smaller than the stage got the panel's width whatever its
 * shape — the 360×360 team logo sat in a 1180×720 landscape box, blown up to
 * 200%, and the stats card to over 300%. Upscaling is the tell, because the
 * readout beside the label is there to say how far DOWN a source is scaled.
 */
describe('frameMaxWidth', () => {
    it('never lets a small element be drawn bigger than the source', () => {
        // The team logo: square, and 360 is its own width, so 100% on any stage.
        expect(frameMaxWidth(360, 360)).toBe(360);
        expect(frameMaxWidth(325, 120)).toBe(325);   // the stats card
    });

    it('leaves a full-size element the panel, up to what the cap allows', () => {
        // A 16:9 source is wider than any stage, so the panel is the limiting
        // side until the 720 cap is — and at the cap the frame is 1280×720, the
        // element's own shape rather than a 720-tall box with dead sides.
        expect(frameMaxWidth(1920, 1080)).toBe(1280);
        expect(frameMaxWidth(800, 460)).toBe(800);
    });

    it('narrows a TALL source so the height cap does not leave dead width', () => {
        // A 400×800 container capped at 720 tall is 360 wide — the frame follows
        // the iframe rather than letterboxing it at the sides.
        expect(frameMaxWidth(400, 800)).toBe(360);
    });

    it('has no answer for an element with no declared size', () => {
        expect(frameMaxWidth(0, 0)).toBeUndefined();
        expect(frameMaxWidth(undefined, undefined)).toBeUndefined();
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
        container: 'callout-stage', slot: 'callout-stage', carrying,
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

    /*
     * Reload NAVIGATES the iframe; it does not replace it.
     *
     * Keying the ScaledIframe on the nonce remounted it, and a fresh one has no
     * derived height yet — so its box collapsed to `minHeight` for as long as it
     * took the layout effect to measure. Nothing PAINTS at that height, but the
     * layout effect calls getBoundingClientRect, so layout does happen, and the
     * browser clamps scrollTop against the shorter page right then: hitting
     * Reload threw the whole console back to the top. Same element + a new src
     * reloads the document just as thoroughly and never resizes the box.
     */
    it('reloads by changing the url, keeping the same iframe element', async () => {
        const user = userEvent.setup();
        ui(<StagePreview element={el('postgamevs')} board={null} binding={fedBinding('postgamecallout')} />);
        const before = document.querySelector('iframe');
        const srcBefore = before.getAttribute('src');

        await user.click(screen.getByLabelText('Reload preview'));

        const after = document.querySelector('iframe');
        expect(after).toBe(before);                          // never remounted
        expect(after.getAttribute('src')).not.toBe(srcBefore); // but did navigate
    });
});
