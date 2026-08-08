import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { useStagingStore } from '../../../context/staging';
import { LAYOUT_SETTINGS } from '../../layouts/designConstants';
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
});

describe('Event Header stage', () => {
    it('offers both bands and every per-field switch', () => {
        ui();
        for (const key of ['showHeader', 'showFooter', 'showEvent', 'showLocation',
            'showDates', 'showMessage', 'showPhase', 'showRound']) {
            const def = LAYOUT_SETTINGS.eventheader.find(d => d.key === key);
            expect(screen.getByText(def.label), key).toBeInTheDocument();
        }
    });

    it('surfaces the geometry knobs too — nothing is stranded on the Setup tab', () => {
        ui();
        for (const key of ['headerOffsetY', 'footerOffsetY', 'bandWidth', 'fontScale', 'separator']) {
            const def = LAYOUT_SETTINGS.eventheader.find(d => d.key === key);
            expect(screen.getByText(def.label), key).toBeInTheDocument();
        }
    });

    /*
     * The panel is laid out as the overlay is — top strip, bottom strip, then
     * what applies to both — so a control sits with the thing it changes. The
     * failure this replaces: sorted by control KIND, a band's offset rendered in
     * a "Style" section five rows below the switch that turns that band on.
     */
    it('groups every setting under the band it changes, in on-screen order', () => {
        ui();
        const groups = [...document.querySelectorAll('[data-setting-group]')]
            .map(e => e.dataset.settingGroup);
        expect(groups).toEqual(['Top band', 'Bottom band', 'Both bands']);
        // No leftovers: the body covers all fourteen, so the catch-all is empty.
        expect(screen.queryByText('Style')).not.toBeInTheDocument();
    });

    it('keeps a band’s offset in the same group as its switch', () => {
        ui();
        const top = document.querySelector('[data-setting-group="Top band"]');
        expect(top).toHaveTextContent('Header Band');
        expect(top).toHaveTextContent('Top Offset');
        expect(top).not.toHaveTextContent('Bottom Offset');
    });

    it('writes a geometry number to the shared namespace', () => {
        ui();
        const sep = LAYOUT_SETTINGS.eventheader.find(d => d.key === 'separator');
        const input = screen.getByPlaceholderText(sep.placeholder); // '◆'
        fireEvent.change(input, { target: { value: '·' } });
        // Kit text rows debounce (a settings write broadcasts to every overlay,
        // so one per keystroke is a storm). Blur is the immediate-commit path.
        fireEvent.blur(input);
        expect(useSettingsStore.getState()?.overlays?.eventheader?.separator).toBe('·');
    });

    it('warns which fields are switched on but have nothing behind them', () => {
        useStateStore.setState({ tournamentInfo: { name: 'Slice 2026', location: 'Chicago' } });
        ui();
        // date + message are blank; name + location are not.
        expect(screen.getByText(/dates, message/)).toBeInTheDocument();
    });

    it('writes to the shared (not per-board) namespace', () => {
        ui();
        fireEvent.click(screen.getByText('Footer Band'));
        expect(useSettingsStore.getState()?.overlays?.eventheader?.showFooter).toBe(false);
    });
});

/*
 * A registry switch is a PART of the overlay, and every part is a chip.
 *
 * The event header is eight booleans — two band masters and six fields inside
 * them — and all eight answer "is this piece drawn". Rendered as eight switch
 * rows they cost ~224px and read as eight unrelated settings. The earlier rule
 * chipped only runs of two or more, which left the two masters as switches;
 * that read fine here but drew one concept two ways on the scorecard, whose
 * band toggles are each separated by their own title field.
 */
describe('every part toggle is a chip', () => {
    const pressed = (label) => screen.getByRole('button', { name: label, pressed: true });

    it('chips the per-field switches inside each band', () => {
        ui();
        for (const label of ['Location', 'Dates', 'Message', 'Phase', 'Round']) {
            expect(pressed(label), label).toBeInTheDocument();
        }
    });

    // The masters too — a band's own on/off is still a part of the overlay, so
    // it takes the same control as the fields it governs. Its rank shows in
    // position (first, on its own row above the offset), not in control type.
    it('chips each band’s own master', () => {
        ui();
        for (const label of ['Header Band', 'Footer Band']) {
            expect(pressed(label), label).toBeInTheDocument();
        }
    });

    // Alone in its group ('Both bands' is switch · select · number), and still a
    // chip: consistency is the point, so a lone part does not get a lone switch.
    it('chips a part toggle that has no siblings', () => {
        ui();
        expect(pressed('Event Name')).toBeInTheDocument();
    });

    // Nothing in this panel should be left drawing a part as a switch.
    it('leaves no switch behind on the panel', () => {
        ui();
        expect(screen.queryAllByRole('switch')).toHaveLength(0);
    });

    it('writes through a chip the same way a row does', () => {
        ui();
        fireEvent.click(pressed('Dates'));
        expect(useSettingsStore.getState()?.overlays?.eventheader?.showDates).toBe(false);
        expect(screen.getByRole('button', { name: 'Dates', pressed: false })).toBeInTheDocument();
    });
});
