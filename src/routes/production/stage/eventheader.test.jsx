import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { useStagingStore } from '../../../context/staging';
import { LAYOUT_SETTINGS } from '../../layouts/designConstants';
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
 * overlay (eventheader.html's `fieldSource`) and the server, which migrates and
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

    it('matches the overlay’s own resolver', () => {
        const html = readFileSync('public/layout/eventheader/eventheader.html', 'utf8');
        const body = html.match(/function fieldSource\(id\) \{([\s\S]*?)\n {4}\}/)[1];
        const drawn = new Set([...body.matchAll(/case '(\w+)':/g)].map(m => m[1]));
        for (const id of Object.keys(FIELDS)) expect(drawn.has(id), id).toBe(true);
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
    it('keeps each band’s own master and offset on that band’s heading', () => {
        ui();
        for (const [master, offset] of [['Header Band', 'Top Offset'], ['Footer Band', 'Bottom Offset']]) {
            expect(screen.getByRole('button', { name: master, pressed: true })).toBeInTheDocument();
            expect(screen.getByLabelText(offset)).toBeInTheDocument();
        }
    });

    it('keeps the shared look, and leaves nothing for the Style catch-all', () => {
        ui();
        for (const label of ['Band Background', 'Band Width', 'Font Scale', 'Field Separator']) {
            expect(screen.getByText(label), label).toBeInTheDocument();
        }
        expect(screen.queryByText('Style')).not.toBeInTheDocument();
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
