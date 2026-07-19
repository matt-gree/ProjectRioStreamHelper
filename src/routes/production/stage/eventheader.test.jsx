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

    it('leaves geometry knobs to Setup — no kit row can express them', () => {
        ui();
        for (const key of ['headerOffsetY', 'footerOffsetY', 'bandWidth', 'fontScale', 'separator']) {
            const def = LAYOUT_SETTINGS.eventheader.find(d => d.key === key);
            expect(screen.queryByText(def.label), key).not.toBeInTheDocument();
        }
    });

    it('warns which fields are switched on but have nothing behind them', () => {
        useStateStore.setState({ tournamentInfo: { name: 'Slice 2026', location: 'Chicago' } });
        ui();
        // date + message are blank; name + location are not.
        expect(screen.getByText(/dates, message/)).toBeInTheDocument();
    });

    it('writes to the shared (not per-board) namespace', () => {
        ui();
        fireEvent.click(screen.getByText('Show Footer'));
        expect(useSettingsStore.getState()?.overlays?.eventheader?.showFooter).toBe(false);
    });
});
