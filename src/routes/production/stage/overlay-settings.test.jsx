import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { useSettingsStore } from '../../../context/store';
import { useStagingStore } from '../../../context/staging';
import { invalidateDesignPackages } from '../../layouts/designPackage';
import { ElementStyleSettings, RENDERABLE } from './overlay-settings';

// The package list the session cache fetches. Same shape the server reports.
const packages = (list) => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => list }));
};

beforeEach(() => {
    useSettingsStore.setState({ overlays: {}, production: {} });
    useStagingStore.setState({ pending: {}, order: [] });
    packages([]);
    invalidateDesignPackages();
});
afterEach(() => {
    cleanup();
    invalidateDesignPackages();
    delete global.fetch;
});

// Phase 7 lifted the stage cap from switch/select to every element-settings
// type. These pin that a colour, number and text setting each render as a kit
// row and write to the element's namespace — the whole point of the phase is
// that no element setting is stranded on the Setup tab.
describe('ElementStyleSettings — every setting type is stage-renderable (phase 7)', () => {
    it('covers all five element-settings control types', () => {
        expect(RENDERABLE).toEqual(new Set(['switch', 'select', 'text', 'number-override', 'color-override']));
    });

    it('renders the colour + number rows the old cap dropped', () => {
        render(<ElementStyleSettings type="bracket" label="Bracket" />);
        expect(screen.getByText('Connector Line Color')).toBeInTheDocument(); // color-override
        expect(screen.getByText('Active Match Color')).toBeInTheDocument();   // color-override
        expect(screen.getByText('Max Upscale')).toBeInTheDocument();          // number-override
    });

    it('writes a colour override to overlays.{type}.{key}', () => {
        render(<ElementStyleSettings type="bracket" label="Bracket" />);
        fireEvent.change(screen.getByLabelText('Connector Line Color'), { target: { value: '#123456' } });
        expect(useSettingsStore.getState()?.overlays?.bracket?.connectorColor).toBe('#123456');
    });

    it('writes a per-board colour to overlays.{type}.{board}.{key}', () => {
        // postgamecallout is not per-board, but the ns wiring is exercised with a
        // board arg here to prove the {type}.{board} path lands correctly.
        render(<ElementStyleSettings type="postgamecallout" board={2} label="Character Spotlight 2" />);
        fireEvent.change(screen.getByLabelText('Port 1 Color'), { target: { value: '#00ff00' } });
        expect(useSettingsStore.getState()?.overlays?.postgamecallout?.[2]?.port0Color).toBe('#00ff00');
    });

    it('excludes keys a body already surfaced, keeps the rest', () => {
        render(<ElementStyleSettings type="eventheader" label="Event header" exclude={['showHeader']} />);
        expect(screen.queryByText('Show Header')).not.toBeInTheDocument();
        expect(screen.getByText('Band Width')).toBeInTheDocument(); // number, not excluded
    });

    it('renders nothing for an element with no settings', () => {
        const { container } = render(<ElementStyleSettings type="matchuphistory" label="Matchup" />);
        expect(container).toBeEmptyDOMElement();
    });
});

/*
 * A setting that paints through the app's palette does nothing under a design
 * package that paints that element itself — the mount clears those CSS vars
 * rather than honouring them. The row goes rather than dimming: switching
 * packages is deliberate, and the customisations not coming with it is the
 * thing the producer should read off the new look.
 */
describe('ElementStyleSettings — app-palette settings under a full-art theme', () => {
    const FULL_ART = { id: 'default', elements: ['statscard'], appVarElements: [] };
    const SKIN = { id: 'classic', elements: ['statscard'], appVarElements: ['statscard'] };

    const stat = async (active, list) => {
        packages(list);
        useSettingsStore.setState({ overlays: { global: { designPackage: active } }, production: {} });
        render(<ElementStyleSettings type="statscard" label="Stat Card" />);
        // Behavioural settings are never gated, so this is the panel rendering.
        await screen.findByText('Bottom Line');
    };

    it('drops the colour rows the active package can’t honour', async () => {
        await stat('default', [FULL_ART]);
        await waitFor(() => expect(screen.queryByText('Stat Value Color')).not.toBeInTheDocument());
        expect(screen.queryByText('Subtext Color')).not.toBeInTheDocument();
        expect(screen.getByText('Bottom Line')).toBeInTheDocument();
    });

    it('keeps them under a package that paints the element from the knobs', async () => {
        await stat('classic', [FULL_ART, SKIN]);
        expect(await screen.findByText('Stat Value Color')).toBeInTheDocument();
        expect(screen.getByText('Subtext Color')).toBeInTheDocument();
    });

    /*
     * Hiding a live control is the worse failure of the two, so anything the
     * resolver can't answer — the list still in flight, the package gone from
     * disk — renders the row.
     */
    it('shows them while the package list is unknown', () => {
        useSettingsStore.setState({ overlays: { global: { designPackage: 'default' } }, production: {} });
        render(<ElementStyleSettings type="statscard" label="Stat Card" />);
        expect(screen.getByText('Stat Value Color')).toBeInTheDocument();
    });
});
