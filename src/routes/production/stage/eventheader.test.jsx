import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fieldSource } from '../../../../public/layout/lib/eventheader-mount.js';
import { socialMark, SOCIAL_MARKS } from '../../../../public/layout/lib/social-marks.js';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { useStagingStore } from '../../../context/staging';
import { LAYOUT_SETTINGS } from '../../design/designConstants';
import { DEFAULT_BANDS, FIELDS } from '../eventheader';
import { Stage } from './index';

beforeEach(() => {
    vi.stubGlobal('localStorage', {
        getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
    });
    useSettingsStore.setState({ overlays: {}, scoreboards: {}, production: {} });
    useStateStore.setState({ tournamentInfo: {} });
    useStagingStore.setState({ pending: {}, order: [] });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const ui = () => render(<TooltipProvider><Stage selection="eventheader" /></TooltipProvider>);

// A loaded event, so every field has something behind it.
const loaded = () => useStateStore.setState({
    tournamentInfo: {
        name: 'Slice 2026', event_name: 'MSB Singles', location: 'Chicago, IL',
        date: 'Aug 15–17', phase: 'Top Cut',
    },
});

const bands = () => useSettingsStore.getState()?.overlays?.eventheader?.bands;
const ids = (band) => bands()[band].map(e => e.id);
const ribbon = (label) => screen.getByRole('tablist', { name: `${label} fields` });
const seg = (label, field) => within(ribbon(label)).getByRole('tab', { name: new RegExp(`^${field} —`) });

/*
 * A layout's <meta name="overlay-settings"> whitelist is what Setup filters its
 * LAYOUT_SETTINGS entries against, so a key defined in the registry and read by
 * the mount but missing from the whitelist is a setting nobody can reach. The
 * event header shipped that way — every one of its switches was unreachable.
 */
describe('overlay-settings whitelist parity', () => {
    const cases = [
        ['eventheader', 'public/layout/eventheader/eventheader.html'],
        ['scorecard', 'public/layout/scorecard/scorecard.html'],
        ['playername', 'public/layout/scoreboard1/playername.html'],
        ['statsbar', 'public/layout/scoreboard1/statsbar.html'],
        ['schedule', 'public/layout/schedule/schedule.html'],
        ['roster', 'public/layout/scoreboard1/roster.html'],
        // The controller's three settings are query params on a gc-overlay
        // iframe rather than anything PRSH draws, which makes this parity
        // MORE load-bearing, not less: nothing in either codebase notices a
        // key that never reaches the URL.
        ['controller', 'public/layout/controller/controller.html'],
    ];

    for (const [type, file] of cases) {
        it(`${type} whitelists every setting its registry defines`, () => {
            const html = readFileSync(file, 'utf8');
            const meta = html.match(/<meta name="overlay-settings" content="([^"]*)"/);
            expect(meta, `${file} declares a whitelist`).toBeTruthy();
            const allowed = new Set(meta[1].split(',').map(s => s.trim()));
            for (const def of LAYOUT_SETTINGS[type]) {
                expect(allowed.has(def.key), `${type}: ${def.key}`).toBe(true);
            }
        });
    }

    // The bands are NOT a LAYOUT_SETTINGS def — they are an ordered model the
    // stage authors directly — so the loop above can't reach them, and the
    // overlay reads them through the same whitelist as everything else.
    it('whitelists the band field lists the mount reads', () => {
        const html = readFileSync('public/layout/eventheader/eventheader.html', 'utf8');
        expect(html.match(/<meta name="overlay-settings" content="([^"]*)"/)[1]).toContain('bands');
    });
});

/*
 * ONE CENSUS OF THE FIELDS, in three runtimes: the console (../eventheader), the
 * overlay (`lib/eventheader-mount.js`'s `fieldSource`) and the server, which migrates and
 * heals the stored lists. A field in one and not the others is either a segment
 * with no label, a segment that draws nothing, or a field with no way back into
 * a band.
 */
describe('the field census agrees across runtimes', () => {
    const serverFields = () => {
        const py = readFileSync('server/settings.py', 'utf8');
        const block = py.match(/EVENTHEADER_FIELDS = \{([\s\S]*?)\n\}/)[1];
        return [...block.matchAll(/\("(\w+)", "(\w+)"\)/g)].map(m => m[1]);
    };

    it('matches the server’s EVENTHEADER_FIELDS', () => {
        expect(new Set(serverFields())).toEqual(new Set(Object.keys(FIELDS)));
    });

    /*
     * IMPORTED, not read as source text. This used to regex `fieldSource` out
     * of eventheader.html and count its `case` labels — which proved a label
     * existed and nothing about what it drew. The resolver lives in
     * `lib/eventheader-mount.js` now (a module that imports nothing and reads
     * `OverlayBase` only at call time), so the test can run it: a field the
     * console lists and the mount cannot resolve comes back empty and fails.
     */
    const STATE = {
        tournamentInfo: {
            name: 'Slice 2026', event_name: 'MSB Singles',
            location: 'Chicago, IL', date: 'Aug 15–17', phase: 'Top Cut',
        },
        score: { 1: { match: '7', phase: 'Winners Semis' } },
        match: { 7: { phase: 'Bracket A' } },
    };
    // `message` is the entry whose whole content is its own text — it has no
    // source on purpose, which is what makes it the banner line.
    // Fields whose whole content is the producer's own text. The socials are
    // here for the same reason `message` is: the account belongs to the stream,
    // not to the loaded event, so there is nothing in state to resolve.
    const NO_SOURCE = new Set(['message', 'twitter', 'youtube']);

    beforeEach(() => {
        globalThis.OverlayBase = {
            deepGet: (obj, path, def) => {
                const v = String(path).split('.').reduce(
                    (o, k) => (o == null ? undefined : o[k]), obj,
                );
                return v === undefined ? def : v;
            },
        };
    });

    it('matches the overlay’s own resolver', () => {
        for (const id of Object.keys(FIELDS)) {
            const drawn = fieldSource(id, STATE, 1);
            if (NO_SOURCE.has(id)) expect(drawn, id).toBe('');
            else expect(drawn, `"${id}" draws nothing`).toBeTruthy();
        }
    });

    /*
     * THE MARK IS THE FEATURE. Without it these two are `message` under another
     * name — a producer can already type a handle there. "@NNL_MSB" cannot say
     * which platform it belongs to, and the mark is the only part of the field
     * that can.
     */
    it('draws a platform mark for a socials field, and none for the rest', () => {
        expect(Object.keys(SOCIAL_MARKS).sort()).toEqual(['twitter', 'youtube']);
        for (const id of Object.keys(FIELDS)) {
            const mark = socialMark(id);
            if (id === 'twitter' || id === 'youtube') {
                expect(mark, id).toBeTruthy();
                expect(mark.querySelector('path').getAttribute('fill'), id).toBe('currentColor');
            } else {
                expect(mark, id).toBeNull();
            }
        }
    });

    it('reads Phase off the bound fixture, and Event off the competition when the event has no name', () => {
        // The board's fixture wins over the competition-wide phase…
        expect(fieldSource('phase', STATE, 1)).toBe('Bracket A');
        // …and falls back to it when no fixture is bound.
        expect(fieldSource('phase', { ...STATE, score: {} }, 1)).toBe('Top Cut');
        // A manually-entered tournament has no event_name; the Event field
        // carries the competition rather than going blank.
        const noEvent = { ...STATE, tournamentInfo: { ...STATE.tournamentInfo, event_name: '' } };
        expect(fieldSource('event', noEvent, 1)).toBe('Slice 2026');
    });

    it('places every field in exactly one default band', () => {
        const placed = [...DEFAULT_BANDS.header, ...DEFAULT_BANDS.footer];
        expect(placed).toHaveLength(Object.keys(FIELDS).length);
        expect(new Set(placed).size).toBe(placed.length);
    });
});

/*
 * THE PANEL IS THE BAND — one ribbon per band, its fields in the order they
 * draw. What this replaces: seven `show*` switches in registry order, with the
 * order itself hardcoded in the overlay's render call, so the panel could say
 * whether a field was on and never where it was.
 */
describe('Event Header stage — the band ribbons', () => {
    it('draws each band’s fields in the order the band renders them', () => {
        ui();
        for (const [band, label] of [['header', 'Top band'], ['footer', 'Bottom band']]) {
            const tabs = within(ribbon(label)).getAllByRole('tab');
            expect(tabs.map(t => t.getAttribute('aria-label').split(' —')[0]))
                .toEqual(DEFAULT_BANDS[band].map(id => FIELDS[id].label));
        }
    });

    /*
     * A segment carries the VALUE, not the field name twice. What a producer
     * checks at a glance is whether the strip says the right thing — and a field
     * with nothing behind it drops out of the band however its eye is set, which
     * was invisible before (a paragraph at the foot of the panel named three of
     * the seven).
     */
    it('shows what each field will actually draw', () => {
        loaded();
        ui();
        expect(seg('Top band', 'Competition')).toHaveTextContent('Slice 2026');
        expect(seg('Bottom band', 'Round')).toHaveTextContent('Nothing behind it');
    });

    it('moves the selected field along its band', () => {
        ui();
        fireEvent.click(seg('Top band', 'Dates'));
        fireEvent.click(screen.getByLabelText('Move Dates left'));
        expect(ids('header')).toEqual(['competition', 'dates', 'location']);
    });

    // The ends are ends: a field at position 1 has nowhere left to go, and the
    // way OUT of a band is the editor's own move, not falling off the edge.
    it('stops at the ends of the band', () => {
        ui();
        fireEvent.click(seg('Top band', 'Competition'));
        expect(screen.getByLabelText('Move Competition left')).toBeDisabled();
        expect(screen.getByLabelText('Move Competition right')).not.toBeDisabled();
    });

    it('shows and hides a field from its own segment', () => {
        ui();
        fireEvent.click(screen.getByLabelText('Hide Location'));
        expect(bands().header.find(e => e.id === 'location').on).toBe(false);
        expect(screen.getByLabelText('Show Location')).toBeInTheDocument();
    });
});

/*
 * Every field can be WRITTEN now — the control that was missing. Blank falls
 * back to the source, so the override is additive: it never costs a producer the
 * live value they had.
 */
describe('Event Header stage — the field editor', () => {
    const editor = () => screen.getByLabelText('Text');

    it('overrides the selected field’s source text', () => {
        loaded();
        ui();
        fireEvent.click(seg('Bottom band', 'Phase'));
        fireEvent.change(editor(), { target: { value: 'Winners Final' } });
        fireEvent.blur(editor());
        expect(bands().footer.find(e => e.id === 'phase').text).toBe('Winners Final');
        expect(seg('Bottom band', 'Phase')).toHaveTextContent('Winners Final');
    });

    // The placeholder is the live value, so an empty field states what leaving it
    // empty will draw — a placeholder that named the field would vanish the
    // moment it held one.
    it('offers the live source as the placeholder', () => {
        loaded();
        ui();
        fireEvent.click(seg('Top band', 'Location'));
        expect(editor()).toHaveAttribute('placeholder', 'Chicago, IL');
    });

    it('says where a blank field’s text comes from', () => {
        loaded();
        ui();
        fireEvent.click(seg('Top band', 'Dates'));
        expect(screen.getByText(/Blank uses Competition/)).toBeInTheDocument();
    });

    // The message is the entry with NO source — which is exactly what it always
    // was, said the same way as every other field instead of as a special key.
    it('names the message as the field that has no source', () => {
        ui();
        fireEvent.click(seg('Bottom band', 'Message'));
        expect(screen.getByText(/no source: what you type here is all it draws/)).toBeInTheDocument();
    });

    /*
     * Across is the same edit as along. Both bands live under ONE settings key
     * for this reason: a move is two array changes, and confirming half of it
     * would leave the field in both bands or in neither.
     */
    it('moves a field to the other band', () => {
        ui();
        fireEvent.click(seg('Bottom band', 'Round'));
        fireEvent.click(screen.getByRole('button', { name: /Move to top band/ }));
        expect(ids('footer')).not.toContain('round');
        expect(ids('header')).toEqual(['competition', 'location', 'dates', 'round']);
        // Selection follows the field, so the editor is still editing the thing
        // the producer just moved.
        expect(seg('Top band', 'Round')).toHaveAttribute('aria-selected', 'true');
    });
});

/*
 * What is left in LAYOUT_SETTINGS is what is genuinely a setting: whether each
 * BAND is drawn, where it sits, and how both look. The fields inside them are
 * not settings any more, so no `show*` switch survives.
 */
describe('Event Header stage — what stays a setting', () => {
    it('keeps each band’s own master on that band’s heading', () => {
        ui();
        for (const master of ['Header Band', 'Footer Band']) {
            expect(screen.getByRole('button', { name: master, pressed: true })).toBeInTheDocument();
        }
    });

    /*
     * The two offsets place the bands RELATIVE TO EACH OTHER — how far in from
     * each edge is one question asked twice — so they sit together beside the
     * width rather than one under each band's switch.
     */
    it('groups both band offsets with the shared geometry', () => {
        ui();
        const both = document.querySelector('[data-setting-group="Both bands"]');
        for (const offset of ['Top Offset', 'Bottom Offset']) {
            expect(within(both).getAllByText(offset).length, offset).toBeGreaterThan(0);
        }
        // …exactly once each: this panel hand-places the band masters and
        // renders the rest from the registry group, so a key in both places
        // draws twice rather than moving.
        for (const offset of ['Top Offset', 'Bottom Offset']) {
            expect(screen.getAllByText(offset).length, offset).toBe(1);
        }
    });

    it('keeps the shared look, and leaves nothing for the Style catch-all', () => {
        ui();
        for (const label of ['Band Background', 'Band Width', 'Top Font Size', 'Bottom Font Size', 'Field Separator']) {
            expect(screen.getByText(label), label).toBeInTheDocument();
        }
        expect(screen.queryByText('Style')).not.toBeInTheDocument();
    });

    /*
     * The plate's colour is a STYLE OVERRIDE of the global card surface, not a
     * setting of its own — the bands are the same plate every other overlay
     * draws behind text, and hard-coded blacks made this the one surface that
     * ignored the Design tab. Three gates, and the registry half is pinned in
     * designConstants.test.js; these are the two that live here.
     */
    it('declares the card surface, and binds both plate styles to it', () => {
        const html = readFileSync('public/layout/eventheader/eventheader.html', 'utf8');
        expect(html.match(/<meta name="overlay-settings" content="([^"]*)"/)[1]).toContain('cardBg');
        const mount = readFileSync('public/layout/lib/eventheader-mount.js', 'utf8');
        for (const style of ['.eh-band.eh-scrim', '.eh-band.eh-bar']) {
            const rule = mount.split(style)[1].split('\n')[0];
            expect(rule, style).toContain('var(--card-bg');
        }
    });

    /*
     * DECLARED BECAUSE DRAWN. The whitelist is where a layout says its CSS reads
     * a var, so these two must be checked against the mount rather than against
     * the registry — a name in the meta whose var nothing binds is precisely the
     * control that is offered and does nothing.
     */
    it('declares the text effects its own CSS binds', () => {
        const html = readFileSync('public/layout/eventheader/eventheader.html', 'utf8');
        const meta = html.match(/<meta name="overlay-settings" content="([^"]*)"/)[1];
        const mount = readFileSync('public/layout/lib/eventheader-mount.js', 'utf8');
        expect(meta).toContain('textShadow');
        expect(mount).toContain('var(--text-shadow');
        expect(meta).toContain('textStroke');
        expect(mount).toContain('var(--text-stroke-width');
        expect(mount).toContain('var(--text-stroke-color');
    });

    /*
     * PX, not a percentage of a base the producer never sees. Pinned as the
     * pair — the key AND its unit — because a `%` suffix left on a px value is
     * exactly the mislabel this replaced.
     */
    /*
     * PX, and ONE PER BAND. The pair is pinned together with the unit because
     * both were the same mistake in different dimensions: a percentage of a base
     * nobody sees, and one number standing in for two bands that carry different
     * things.
     */
    it('states a type size in pixels, per band', () => {
        for (const key of ['headerFontSize', 'footerFontSize']) {
            expect(LAYOUT_SETTINGS.eventheader.find(d => d.key === key), key)
                .toMatchObject({ suffix: 'px', defaultValue: 34 });
        }
        for (const gone of ['fontScale', 'fontSize']) {
            expect(LAYOUT_SETTINGS.eventheader.some(d => d.key === gone), gone).toBe(false);
        }
    });

    /*
     * TWO WAYS THIS ELEMENT COULD BE WRONG UNTIL THE SOURCE IS RELOADED, which
     * is the shape a producer reports as "it renders too high until I hit
     * refresh". Both leave a correct page drawing a stale layout with nothing
     * scheduled to recompute it, and both are silent.
     *
     * A webfont arrives whenever the network says so, and until it does the
     * canvas answers the optical measurement with the FALLBACK's metrics —
     * cached under the real font's name, that is a wrong offset forever.
     *
     * And `window.resize` never fires for a box that changed under a window
     * that did not: a container re-laying out its member, or a browser source
     * measured at zero while hidden and given its real size only when shown.
     */
    it('recomputes rather than waiting for a reload', () => {
        const mount = readFileSync('public/layout/lib/eventheader-mount.js', 'utf8');
        // Only a measurement the real face produced is cached.
        expect(mount).toContain('if (faceReady(fontSpec)) capOffsets.set');
        // …and the host is watched, not just the window.
        expect(mount).toContain('new ResizeObserver');
        expect(mount).toContain('ro.observe(root)');
    });

    /*
     * THE PLATFORM MARK IS SEATED ON THE MEASURED CAP BAND, NOT A BAKED ONE.
     *
     * The mark is an inline box whose BOTTOM sits on the baseline, so it
     * overhangs the cap band by (its own height − cap height), all of it below
     * the letters, and half of that pushed back down centres it on them. Cap
     * height is a fact about the FACE — which is why the row's own optical
     * correction is measured — and the seat was a constant anyway, at Inter's
     * nominal 0.727. The display role has defaulted to Rajdhani since type
     * became three roles, and Rajdhani's measured cap is 0.643: the mark rode
     * 1.4px above the handle at the composed 34px, and further at every larger
     * Font Size.
     *
     * One probe answers both, so a producer's face cannot move the type without
     * moving the mark with it.
     */
    it('seats the platform mark on the measured cap band', () => {
        const mount = readFileSync('public/layout/lib/eventheader-mount.js', 'utf8');
        // One probe, reporting both readings of the cap band.
        expect(mount).toMatch(/out = \{\s*dy:/);
        expect(mount).toContain('cap: cap / PROBE_PX');
        // Published for the CSS to divide…
        expect(mount).toContain("stage.style.setProperty('--eh-cap'");
        // …and divided there, rather than restated as a number.
        expect(mount).toContain('transform: translateY(calc((${MARK_EM}em - var(--eh-cap');
        // An unmeasurable face falls back to the declaration, never to 0 —
        // which would seat the mark half its own height below the baseline.
        expect(mount).toContain("stage.style.removeProperty('--eh-cap')");
    });

    /*
     * The two sizes drive their own band and nothing else — `--font-scale` is
     * set on each BAND rather than on the shared stage, which is what makes the
     * band height, the bar's corner and the field gap follow the row they
     * belong to instead of whichever size was written last.
     */
    it('scopes the type scale to each band', () => {
        const mount = readFileSync('public/layout/lib/eventheader-mount.js', 'utf8');
        expect(mount).toContain("header.style.setProperty('--font-scale'");
        expect(mount).toContain("footer.style.setProperty('--font-scale'");
        expect(mount).not.toContain("stage.style.setProperty('--font-scale'");
    });

    it('has no per-field switch left in the registry', () => {
        const switches = LAYOUT_SETTINGS.eventheader.filter(d => d.type === 'switch').map(d => d.key);
        expect(switches).toEqual(['showHeader', 'showFooter']);
    });

    it('writes the band master to the shared (not per-board) namespace', () => {
        ui();
        fireEvent.click(screen.getByText('Footer Band'));
        expect(useSettingsStore.getState()?.overlays?.eventheader?.showFooter).toBe(false);
    });
});
