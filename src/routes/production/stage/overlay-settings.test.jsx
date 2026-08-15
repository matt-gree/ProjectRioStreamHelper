import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { useSettingsStore } from '../../../context/store';
import { useStagingStore } from '../../../context/staging';
import { invalidateDesignPackages } from '../../layouts/designPackage';
import { ElementStyleSettings, RENDERABLE, chunkDefs, groupDefs } from './overlay-settings';

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
        // bracket is not per-board, but the ns wiring is exercised with a board
        // arg here to prove the {type}.{board} path lands correctly.
        render(<ElementStyleSettings type="bracket" board={2} label="Bracket 2" />);
        fireEvent.change(screen.getByLabelText('Connector Line Color'), { target: { value: '#00ff00' } });
        expect(useSettingsStore.getState()?.overlays?.bracket?.[2]?.connectorColor).toBe('#00ff00');
    });

    it('excludes keys a body already surfaced, keeps the rest', () => {
        render(<ElementStyleSettings type="eventheader" label="Event header" exclude={['showHeader']} />);
        expect(screen.queryByText('Header Band')).not.toBeInTheDocument();
        expect(screen.getByText('Band Width')).toBeInTheDocument(); // number, not excluded
    });

    it('renders nothing for an element with no settings', () => {
        const { container } = render(<ElementStyleSettings type="matchuphistory" label="Matchup" />);
        expect(container).toBeEmptyDOMElement();
    });
});

/*
 * A run of one is not a set. A lone part toggle takes the label column so it
 * lines up with the rows around it; two or more pack into a strip, which is the
 * whole reason the strip exists.
 *
 * The rule this replaces promoted EVERY chip in a region the moment ANY switch
 * in it owned a text field. It was written for the scorecard (one unpaired
 * toggle among two paired ones) and its cost scaled with the loners: the event
 * header's Bottom band has one pair and three other field toggles, so a single
 * 34px strip became three 128px chips on three rows, each with ~590px of empty
 * panel beside it.
 */
describe('chunkDefs — a run of one aligns, a run of many packs', () => {
    const sw = key => ({ key, type: 'switch' });
    const text = key => ({ key, type: 'text' });
    const shape = defs => chunkDefs(defs).map(s => `${s.kind}:${s.defs.map(d => d.key).join('+')}`);

    it('packs adjacent fieldless toggles into one strip', () => {
        expect(shape([sw('a'), sw('b'), sw('c')])).toEqual(['chips:a+b+c']);
    });

    it('gives a lone toggle the label column instead of a one-chip strip', () => {
        expect(shape([sw('a')])).toEqual(['pair:a']);
    });

    // The scorecard's Top bars: two titled bars and one without. All three
    // toggles line up in the same column — the case the region-wide rule existed
    // for, and the one this keeps.
    it('lines an unpaired toggle up with its titled siblings', () => {
        expect(shape([sw('a'), text('at'), sw('b'), text('bt'), sw('c')]))
            .toEqual(['pair:a+at', 'pair:b+bt', 'pair:c']);
    });

    /*
     * The event header's Bottom band. A pair in the region no longer breaks the
     * strip beside it apart — that is what made this panel four rows taller than
     * its own Top band, which has the same shape and no pair.
     */
    it('leaves a strip packed even when the region has a pair', () => {
        expect(shape([sw('band'), { key: 'off', type: 'number-override' },
            sw('msg'), text('msgText'), sw('x'), sw('y'), sw('z')]))
            .toEqual(['pair:band', 'row:off', 'pair:msg+msgText', 'chips:x+y+z']);
    });
});

describe('groupDefs', () => {
    const def = (key, group) => ({ key, group });

    it('orders groups by first appearance, not alphabetically or by size', () => {
        expect(groupDefs([def('a', 'Z'), def('b', 'A'), def('c', 'Z')])).toEqual([
            { group: 'Z', defs: [def('a', 'Z'), def('c', 'Z')] },
            { group: 'A', defs: [def('b', 'A')] },
        ]);
    });

    /*
     * A def can be filtered out between the registry and here (a body's
     * `exclude`, an app-palette gate), which splits a group's run. Collecting by
     * name rather than by consecutive run means the survivors still render as
     * one region instead of as two identically-titled ones.
     */
    it('rejoins a group whose run was broken by a filtered-out def', () => {
        const [first, ...rest] = groupDefs([def('a', 'X'), def('b', 'Y'), def('c', 'X')]);
        expect(first.defs.map(d => d.key)).toEqual(['a', 'c']);
        expect(rest).toHaveLength(1);
    });

    it('keeps ungrouped defs in one run, so untouched types render flat', () => {
        expect(groupDefs([def('a'), def('b')])).toEqual([
            { group: null, defs: [def('a'), def('b')] },
        ]);
    });
});

/*
 * A detail whose master gives it no job is INERT, not merely inactive: the Stat
 * Card's custom bottom text reaches nothing at all while the bottom line is
 * showing the game line. That is the bar for hiding a control — a disabled row
 * still costs a line and still has to be read past.
 */
describe('ElementStyleSettings — a detail follows its master', () => {
    const card = () => render(<ElementStyleSettings type="statscard" label="Stat Card" />);

    it('hides the custom text while another mode owns the line', () => {
        card();
        expect(screen.getByText('Bottom Line')).toBeInTheDocument();   // the master
        expect(screen.queryByText('Custom Bottom Text')).not.toBeInTheDocument();
        expect(screen.queryByText('Custom Top Text')).not.toBeInTheDocument();
    });

    it('shows it once that mode is chosen', () => {
        useSettingsStore.setState({ overlays: { statscard: { subLine: 'custom' } }, production: {} });
        card();
        expect(screen.getByText('Custom Bottom Text')).toBeInTheDocument();
        // topLine is untouched, so its own detail stays away.
        expect(screen.queryByText('Custom Top Text')).not.toBeInTheDocument();
    });

    /*
     * Staged, not yet live: the field has to appear when the producer picks the
     * mode, not after Go Live — otherwise choosing "Custom Text" looks like it
     * did nothing.
     */
    it('reveals it from a staged master, before the change goes live', () => {
        useStagingStore.setState({
            pending: { 'settings:overlays.statscard.subLine': { value: 'custom' } },
            order: ['settings:overlays.statscard.subLine'],
        });
        card();
        expect(screen.getByText('Custom Bottom Text')).toBeInTheDocument();
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
