import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { useSettingsStore } from '../../../context/store';
import { useStagingStore } from '../../../context/staging';
import { invalidateDesignPackages } from '../../layouts/designPackage';
import { invalidateLayoutWhitelist } from '../../layouts/layoutWhitelist';
import {
    ElementStyleSettings, ElementStyleOverrides, RENDERABLE, chunkDefs, groupDefs,
    seedValue,
} from './overlay-settings';
import { OVERRIDABLE_GLOBAL_KEYS, GLOBAL_DESIGN_DEFAULTS } from '../../layouts/designConstants';

/*
 * Two session caches fetch here — the design packages and the layout catalog —
 * so the mock routes by URL. A single blanket response fed the package list to
 * the whitelist reader, which then believed every layout declared nothing.
 */
let _packages = [];
let _layouts = [];
const mockFetch = () => {
    global.fetch = vi.fn(async (url) => ({
        ok: true,
        json: async () => (String(url).includes('/design/packages') ? _packages : _layouts),
    }));
};
const packages = (list) => { _packages = list; mockFetch(); };
// Catalog entries as server/api/v1/layouts.py reports them: one per layout,
// carrying the layout type and its <meta name="overlay-settings"> whitelist.
const layouts = (list) => { _layouts = list; mockFetch(); };

beforeEach(() => {
    useSettingsStore.setState({ overlays: {}, production: {} });
    useStagingStore.setState({ pending: {}, order: [] });
    _packages = [];
    _layouts = [];
    mockFetch();
    invalidateDesignPackages();
    invalidateLayoutWhitelist();
});
afterEach(() => {
    cleanup();
    invalidateDesignPackages();
    invalidateLayoutWhitelist();
    delete global.fetch;
});

// Phase 7 lifted the stage cap from switch/select to every element-settings
// type. These pin that a colour, number and text setting each render as a kit
// row and write to the element's namespace — the whole point of the phase is
// that no element setting is stranded on the Setup tab.
describe('ElementStyleSettings — every setting type is stage-renderable (phase 7)', () => {
    it('covers all six element-settings control types', () => {
        expect(RENDERABLE).toEqual(new Set([
            'switch', 'select', 'text', 'number-override', 'fraction-override', 'color-override',
        ]));
    });

    /*
     * The controller's idle fill is a 0..1 opacity, and it is a SLIDER because a
     * number field accepted `10` — ten percent, off the scale by a hundred — and
     * drew as fully solid. The console speaks percent; storage stays in
     * gc-overlay's own unit, because the query string this ends up on rejects
     * anything outside 0..1 and skips the key rather than complaining.
     */
    it('writes a fraction override as a fraction, not a percentage', () => {
        render(<ElementStyleSettings type="controller" label="Controller" />);
        fireEvent.change(screen.getByLabelText('Idle Fill'), { target: { value: '65' } });
        expect(useSettingsStore.getState()?.overlays?.controller?.idleFillOpacity).toBe(0.65);
    });

    it('renders the controller settings as one layer, with no inherit state', () => {
        render(<ElementStyleSettings type="controller" label="Controller" />);
        // Two plain switches and a slider — nothing offering "use Connections",
        // which was a second layer that a pin silently beat.
        expect(screen.getByText('Letters')).toBeInTheDocument();
        expect(screen.getByText('Keyline')).toBeInTheDocument();
        expect(screen.getByLabelText('Idle Fill')).toHaveAttribute('type', 'range');
        expect(screen.queryByText(/use connections/i)).not.toBeInTheDocument();
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
 * THE PER-SIZE GATE (settingReachesSize). The scoreboard's three-sizes-one-HTML
 * shape is exactly what the `<meta>` whitelist cannot express: it is per layout
 * TYPE, so a setting only some sizes draw passes it everywhere. Rosters are the
 * case — only the Large board has the band — and a switch offered on a source
 * that has nothing to move is worse than a missing one, because the producer
 * flips it and concludes the overlay is broken.
 *
 * Bare = Large: the mount resolves an absent or retired ?size= to `l`, and this
 * gate has to agree with it or the row disappears on the very sources that have
 * the band.
 */
describe('ElementStyleSettings — a setting only one size draws', () => {
    const at = (size) => render(
        <ElementStyleSettings type="scoreboard" label="Scoreboard 1" size={size} />,
    );
    beforeEach(() => useSettingsStore.setState({ overlays: {}, production: {} }));

    it('offers the band switches on the size that has the bands', () => {
        at('l');
        expect(screen.getByRole('button', { name: 'Rosters' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Box Score' })).toBeInTheDocument();
    });

    it('drops them on a size with neither band', () => {
        at('s');
        expect(screen.queryByRole('button', { name: 'Rosters' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Box Score' })).not.toBeInTheDocument();
        // Not the whole panel — the ungated switches beside them still render.
        expect(screen.getByRole('button', { name: 'Live Cluster' })).toBeInTheDocument();
    });

    it('treats a source with no size as the one it actually renders at', () => {
        at(undefined);
        expect(screen.getByRole('button', { name: 'Rosters' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Box Score' })).toBeInTheDocument();
    });

    /*
     * EACH SIZE GETS ITS OWN LIST, in its own order. One registry array is
     * filtered by `sizes` and what survives has to read top-of-card to
     * bottom-of-card for the size the source is actually on — Small melds
     * outward (inning segment, then the live cluster, then the mode band under
     * the card), Large stacks downward (live cluster, both nines, linescore).
     *
     * The two lists are nearly disjoint, which is the point: Small has no
     * roster or linescore band, and Large draws its inning inside row-top and
     * its game mode inline in the linescore's meta pane, where neither costs
     * height and so neither has anything to toggle.
     */
    const switchesAt = (size) => {
        at(size);
        const known = ['Team Logos', 'Inning', 'Live Cluster', 'Stats', 'Rosters', 'Box Score', 'Game Mode'];
        return screen.getAllByRole('button')
            .map(b => b.textContent).filter(t => known.includes(t));
    };

    it('gives the Large board its stack, top to bottom', () => {
        expect(switchesAt('l')).toEqual(['Team Logos', 'Live Cluster', 'Stats', 'Rosters', 'Box Score']);
    });

    it('gives the Small board its meld, inboard to outboard', () => {
        expect(switchesAt('s')).toEqual(['Team Logos', 'Inning', 'Live Cluster', 'Game Mode']);
    });
});

/*
 * The scoreboard's Inning is ORed with the Live Cluster in the mount
 * (showInningSeg), so with the cluster up the switch cannot say no. The console
 * has to say that: a control still offering a choice it does not have is
 * indistinguishable from a broken setting.
 */
describe('ElementStyleSettings — a switch its master holds on', () => {
    // At the SMALL size: Inning is the melded board's own segment switch, and
    // `sizes: ['s']` means the Large panel does not carry it at all.
    const board = () => render(
        <ElementStyleSettings type="scoreboard" label="Scoreboard 1" size="s" />,
    );
    const inning = () => screen.getByRole('button', { name: 'Inning' });

    it('leaves the switch alone while the master is off', () => {
        // Confirm mode on, so a click is observable as a staged write rather
        // than going straight to the server the test has no socket for.
        useSettingsStore.setState({
            overlays: { scoreboard: { showLive: false, showInning: false } },
            production: { confirm: { enabled: true } },
        });
        board();
        expect(inning()).not.toHaveAttribute('aria-disabled');
        expect(inning()).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(inning());
        expect(useStagingStore.getState().pending['settings:overlays.scoreboard.showInning'])
            .toMatchObject({ value: true });
    });

    it('holds it on, and says why, while the master is on', () => {
        useSettingsStore.setState({
            overlays: { scoreboard: { showLive: true, showInning: false } },
            production: { confirm: { enabled: true } },
        });
        board();
        // Pressed even though the stored value is false — what the overlay draws.
        expect(inning()).toHaveAttribute('aria-pressed', 'true');
        expect(inning()).toHaveAttribute('aria-disabled', 'true');
        // aria-disabled rather than `disabled`, so the one explanation there is
        // stays hoverable — and so a held-ON chip isn't faded below the OFF
        // chips beside it.
        expect(inning()).not.toBeDisabled();
        expect(inning()).toHaveAttribute('title', expect.stringContaining('Live Cluster'));
        // And it does not move: a lock that still wrote would be worse than none.
        fireEvent.click(inning());
        expect(useStagingStore.getState().pending['settings:overlays.scoreboard.showInning'])
            .toBeUndefined();
    });

    /*
     * Staged, not yet live — same reason the showWhen gate reads staged values:
     * turning the cluster on has to hold the inning NOW, or the producer reads
     * the console as disagreeing with itself until Go Live.
     */
    it('holds it from a staged master, before the change goes live', () => {
        useSettingsStore.setState({ overlays: { scoreboard: { showLive: false } }, production: {} });
        useStagingStore.setState({
            pending: { 'settings:overlays.scoreboard.showLive': { value: true } },
            order: ['settings:overlays.scoreboard.showLive'],
        });
        board();
        expect(inning()).toHaveAttribute('aria-disabled', 'true');
        expect(inning()).toHaveAttribute('aria-pressed', 'true');
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

/*
 * ── Style overrides ─────────────────────────────────────────────────────────
 * A global design key pinned for ONE element. The UI for these was dropped with
 * the Setup tab while the mechanism stayed live in overlay-base.js, which is how
 * a producer ends up with `overlays.eventheader.fontFamily` on air and no
 * surface anywhere that shows it.
 */
describe('ElementStyleOverrides', () => {
    const EVENTHEADER = {
        type: 'eventheader',
        supportedSettings: ['showHeader', 'textColor', 'accentColor', 'fontFamily'],
    };
    const SPOTLIGHT = { type: 'postgamecallout', supportedSettings: ['accentColor', 'fontFamily'] };
    const STATSBAR = {
        type: 'statsbar',
        supportedSettings: ['accentColor', 'cardBg', 'borderColor', 'fontFamily'],
    };
    // Carry `name` like a real manifest does — the tooltip names the package,
    // and an id-only fixture would pin the lowercase fallback instead.
    const FULL_ART = { id: 'default', name: 'Default', elements: ['statsbar'], appVarElements: [] };
    const SKIN = { id: 'classic', name: 'Classic', elements: ['statsbar'], appVarElements: ['statsbar'] };

    // The section is an EXCEPTION LIST: nothing is on it until the producer
    // puts it there, so the Add button is what proves the panel rendered.
    const show = async (props) => {
        render(<ElementStyleOverrides label="Panel" {...props} />);
        await screen.findByRole('button', { name: /Add style override/ });
    };
    const openAdd = () =>
        fireEvent.click(screen.getByRole('button', { name: /Add style override/ }));
    const offered = () => {
        openAdd();
        return screen.queryAllByRole('button')
            .map(b => b.textContent)
            .filter(t => t && !/Add style override/.test(t));
    };
    const pin = (overlays) => useSettingsStore.setState({ overlays, production: {} });

    /*
     * THE SHAPE OF THIS SECTION. Every key here already has a home on the
     * Design tab; a row on an element means "this one element departs from
     * that". Rendering all thirteen on every element made a wall of controls
     * whose overwhelming answer was "Global", which read as configuration
     * rather than as the short list of exceptions it is.
     */
    it('starts empty — a row exists because the producer added it', async () => {
        layouts([EVENTHEADER]);
        await show({ type: 'eventheader' });
        expect(screen.queryByLabelText('Accent Color')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Font Family')).not.toBeInTheDocument();
    });

    it('shows a row for a key already pinned', async () => {
        layouts([EVENTHEADER]);
        pin({ eventheader: { accentColor: '#abcdef' } });
        await show({ type: 'eventheader' });
        expect(screen.getByLabelText('Accent Color')).toHaveValue('#abcdef');
    });

    it('offers the keys the layout declares', async () => {
        layouts([EVENTHEADER]);
        await show({ type: 'eventheader' });
        const options = offered();
        expect(options).toContain('Font Family');
        // Not declared by this layout at all.
        expect(options).not.toContain('Card Background');
    });

    /*
     * DECLARED IS NOT ENOUGH. eventheader.html whitelists `textColor` and the
     * mount really does paint from `--text-primary` — but that var is only ever
     * set from the GLOBAL for this element, because overlay-base's
     * LAYOUT_VAR_MAP binds a per-element textColor for the scoreboard and the
     * player name and nobody else. So the Design tab's Text Color reaches the
     * event header and a pin on the event header does not.
     *
     * A control that would not adjust this element's design is not offered at
     * all — an option that silently does nothing is worse than a missing one,
     * because the producer spends the next ten minutes believing they set it.
     */
    it('never offers a declared key that is not read back on this type', async () => {
        layouts([EVENTHEADER]);
        await show({ type: 'eventheader' });
        expect(offered()).not.toContain('Text Color');
    });

    it('keeps that same key where a var map does bind it', async () => {
        layouts([{ type: 'playername', supportedSettings: ['textColor', 'accentColor'] }]);
        await show({ type: 'playername' });
        expect(offered()).toContain('Text Color');
    });

    /*
     * The font border is the pair this section was most obviously missing: the
     * global default is 0, so the ONLY way to have one is to pin it on the
     * element that needs it. Both halves are offered together — a border pinned
     * on one element is pinned to sit on one background, so its colour has to
     * be pinnable there too.
     */
    it('offers both halves of the font border where the layout declares it', async () => {
        layouts([{ type: 'playername', supportedSettings: ['textStroke'] }]);
        await show({ type: 'playername' });
        const options = offered();
        expect(options).toContain('Font Border');
        expect(options).toContain('Font Border Color');
    });

    it('pins the font border without changing what is on air', async () => {
        layouts([{ type: 'playername', supportedSettings: ['textStroke'] }]);
        await show({ type: 'playername' });
        openAdd();
        fireEvent.click(screen.getByRole('button', { name: 'Font Border' }));
        // Seeded at the global — 0, which is no border. The row is now there to
        // turn up; adding it drew nothing.
        expect(useSettingsStore.getState()?.overlays?.playername?.textStrokeWidth).toBe(0);
    });

    it('stops offering a key once it is on the element', async () => {
        layouts([EVENTHEADER]);
        pin({ eventheader: { accentColor: '#abcdef' } });
        await show({ type: 'eventheader' });
        const options = offered();
        expect(options).not.toContain('Accent Color');
        expect(options).toContain('Font Family');
    });

    /*
     * Adding hands over a knob; it does not turn one. The pin starts at what
     * the element is already showing, so the picture on air is unchanged and
     * the producer moves from there.
     */
    it('pins a newly added key at the value the element already shows', async () => {
        layouts([EVENTHEADER]);
        useSettingsStore.setState({
            overlays: { global: { accentColor: '#0abcde' } }, production: {},
        });
        await show({ type: 'eventheader' });
        openAdd();
        fireEvent.click(screen.getByRole('button', { name: 'Accent Color' }));
        expect(useSettingsStore.getState()?.overlays?.eventheader?.accentColor).toBe('#0abcde');
    });

    /*
     * finalBadgeColor is the one key with no global default — unset, the badge
     * is `fill:var(--accent)`. Seeding it null would write "unpinned" and the
     * row would never appear, so its def names the accent as where it starts.
     */
    it('seeds a key with no global of its own from what actually paints it', () => {
        const def = OVERRIDABLE_GLOBAL_KEYS.find(d => d.key === 'finalBadgeColor');
        expect(seedValue(def, { finalBadgeColor: null, accentColor: '#123456' })).toBe('#123456');
    });

    it('gives every overridable key a non-null starting value', () => {
        // A null seed is a no-op add: the row the producer just asked for
        // simply would not appear.
        for (const def of OVERRIDABLE_GLOBAL_KEYS) {
            expect(seedValue(def, GLOBAL_DESIGN_DEFAULTS)).not.toBeNull();
        }
    });

    it('removes a row back to the global', async () => {
        layouts([EVENTHEADER]);
        pin({ eventheader: { accentColor: '#abcdef' } });
        await show({ type: 'eventheader' });
        fireEvent.click(screen.getByLabelText('Remove Accent Color override'));
        expect(useSettingsStore.getState()?.overlays?.eventheader?.accentColor).toBe(null);
    });

    /*
     * ONE removal per row. ColorRow ships its own reset and the font row had a
     * Reset button, and once a cleared value means "off this element" both said
     * the same thing in different words, side by side — two × on one row.
     */
    it('leaves exactly one way to take a row off', async () => {
        layouts([EVENTHEADER]);
        pin({ eventheader: { accentColor: '#abcdef', fontFamily: 'Rajdhani' } });
        await show({ type: 'eventheader' });
        expect(screen.queryByLabelText('Reset Accent Color')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
        expect(screen.getByLabelText('Remove Accent Color override')).toBeInTheDocument();
        expect(screen.getByLabelText('Remove Font Family override')).toBeInTheDocument();
    });

    /*
     * Under confirm mode the pin is STAGED, not stored. A section that listed
     * only stored pins would drop the row the instant it was added and hand
     * back an empty panel.
     */
    it('keeps a staged row visible before it goes live', async () => {
        layouts([EVENTHEADER]);
        useSettingsStore.setState({
            overlays: {}, production: { confirm: { enabled: true } },
        });
        await show({ type: 'eventheader' });
        openAdd();
        fireEvent.click(screen.getByRole('button', { name: 'Accent Color' }));
        expect(useSettingsStore.getState()?.overlays?.eventheader?.accentColor).toBeUndefined();
        await waitFor(() => expect(screen.getByLabelText('Accent Color')).toBeInTheDocument());
    });

    /*
     * The whitelist is a CLAIM, not proof. Both post-game callouts declare
     * accentColor + fontFamily and neither mount ever calls applyDesignSettings
     * — they are painted by rio-theme/tokens.css — so the meta alone would put
     * a picker offering two dead keys on each.
     */
    it('renders nothing for a layout whose mount never applies the palette', () => {
        layouts([SPOTLIGHT]);
        const { container } = render(
            <ElementStyleOverrides type="postgamecallout" label="Character Spotlight" />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing until the catalog answers', () => {
        // No whitelist yet = no claim yet. Unknown resolves to "offer nothing"
        // here, the opposite of the design-package rule, because an unknown
        // would CONJURE a control rather than hide a live one.
        const { container } = render(<ElementStyleOverrides type="eventheader" label="Event header" />);
        expect(container).toBeEmptyDOMElement();
    });

    it('writes a pin to overlays.{type}.{key}', async () => {
        layouts([EVENTHEADER]);
        pin({ eventheader: { accentColor: '#abcdef' } });
        await show({ type: 'eventheader' });
        fireEvent.change(screen.getByLabelText('Accent Color'), { target: { value: '#123456' } });
        expect(useSettingsStore.getState()?.overlays?.eventheader?.accentColor).toBe('#123456');
    });

    it('writes a per-board pin to the namespace the mount reads', async () => {
        // scoreboard-mount reads its override from `overlays.scoreboard.{SB}.*`
        // (its NS), never the bare leaf.
        layouts([{ type: 'scoreboard', supportedSettings: ['accentColor'] }]);
        pin({ scoreboard: { 2: { accentColor: '#abcdef' } } });
        await show({ type: 'scoreboard', board: 2 });
        fireEvent.change(screen.getByLabelText('Accent Color'), { target: { value: '#00ff00' } });
        expect(useSettingsStore.getState()?.overlays?.scoreboard?.[2]?.accentColor).toBe('#00ff00');
    });

    /*
     * DISABLED, not dropped — and deliberately unlike useLiveDefs above. An
     * element's own appPalette setting has nowhere else to live, so a dead row
     * is noise and goes; an override already pinned here is a value that starts
     * working again the moment the producer swaps packages, and a pin they
     * cannot see is a pin they cannot remove. The PICKER is what closes: adding
     * one under this package would do nothing at all.
     */
    it('disables an existing pin under a package that paints the element itself', async () => {
        layouts([STATSBAR]);
        packages([FULL_ART]);
        useSettingsStore.setState({
            overlays: { global: { designPackage: 'default' }, statsbar: { accentColor: '#abcdef' } },
            production: {},
        });
        await show({ type: 'statsbar' });
        await waitFor(() => expect(screen.getByLabelText('Accent Color')).toBeDisabled());
        expect(screen.getByRole('button', { name: /Add style override/ })).toBeDisabled();
        // The explanation is a TOOLTIP on what is dead, not a paragraph above
        // the section: it names the package, and it costs no panel height in
        // the state most producers are never in.
        expect(screen.queryByText(/paints this element itself/)).not.toBeInTheDocument();
        // On the WRAPPER, not the button: a disabled Button is
        // pointer-events-none, so a title sitting on it is never hoverable.
        expect(screen.getByRole('button', { name: /Add style override/ }).parentElement)
            .toHaveAttribute('title', 'Default paints this element itself');
        expect(screen.getByLabelText('Accent Color').closest('[title]'))
            .toHaveAttribute('title', 'Default paints this element itself');
    });

    /*
     * ...and the × STAYS LIVE, because removing is the only act on this row
     * that still means something under a full-art package: the pin is stored,
     * and it comes back the moment the package changes. Greying it out defeated
     * the whole reason the row is kept visible — the producer could see a pin
     * they could neither use nor get rid of.
     */
    it('still lets a dead pin be removed', async () => {
        layouts([STATSBAR]);
        packages([FULL_ART]);
        useSettingsStore.setState({
            overlays: { global: { designPackage: 'default' }, statsbar: { accentColor: '#abcdef' } },
            production: {},
        });
        await show({ type: 'statsbar' });
        const remove = screen.getByRole('button', { name: /Remove Accent Color override/ });
        await waitFor(() => expect(screen.getByLabelText('Accent Color')).toBeDisabled());
        expect(remove).not.toBeDisabled();
        fireEvent.click(remove);
        // null is this section's "not pinned" — the mount reads the pin with
        // `??`, so it falls through to the global exactly as an absent key does.
        expect(useSettingsStore.getState()?.overlays?.statsbar?.accentColor).toBeNull();
        expect(screen.queryByLabelText('Accent Color')).not.toBeInTheDocument();
    });

    it('leaves them live under a token skin', async () => {
        layouts([STATSBAR]);
        packages([FULL_ART, SKIN]);
        useSettingsStore.setState({
            overlays: { global: { designPackage: 'classic' }, statsbar: { accentColor: '#abcdef' } },
            production: {},
        });
        await show({ type: 'statsbar' });
        await waitFor(() => expect(screen.getByLabelText('Accent Color')).not.toBeDisabled());
        expect(screen.getByRole('button', { name: /Add style override/ })).not.toBeDisabled();
        // ...and nothing wears the tooltip when nothing is dead.
        expect(screen.getByLabelText('Accent Color').closest('[title]')).toBeNull();
    });

    /*
     * The scoreboard is three theme files and a package may tier them
     * differently, so the gate has to ask about the size the SOURCE renders —
     * not a constant stem.
     */
    it('asks about the size the source actually draws', async () => {
        layouts([{ type: 'scoreboard', supportedSettings: ['accentColor'] }]);
        packages([{
            id: 'mixed',
            elements: ['scoreboard-l', 'scoreboard-s'],
            appVarElements: ['scoreboard-l'],
        }]);
        useSettingsStore.setState({
            overlays: { global: { designPackage: 'mixed' }, scoreboard: { accentColor: '#abcdef' } },
            production: {},
        });
        await show({ type: 'scoreboard', size: 's' });
        await waitFor(() => expect(screen.getByLabelText('Accent Color')).toBeDisabled());
        cleanup();
        await show({ type: 'scoreboard', size: 'l' });
        await waitFor(() => expect(screen.getByLabelText('Accent Color')).not.toBeDisabled());
    });
});
