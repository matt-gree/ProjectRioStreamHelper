import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useSettingsStore } from '../../../context/store';
import { useStagingStore } from '../../../context/staging';
import { ElementStyleSettings, RENDERABLE } from './overlay-settings';

beforeEach(() => {
    useSettingsStore.setState({ overlays: {}, production: {} });
    useStagingStore.setState({ pending: {}, order: [] });
});
afterEach(cleanup);

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
