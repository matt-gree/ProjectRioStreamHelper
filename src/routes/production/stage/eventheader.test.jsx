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
