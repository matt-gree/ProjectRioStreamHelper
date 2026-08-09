import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useObsStore } from '../../context/obs';
import { DESKS, RAIL_SEED, Rack } from './rack';
import { withContainers } from '../../test/containers';

// The test env's localStorage (Node's experimental stub) has no working
// methods — usePersistentState silently no-ops against it. Stub a real one so
// selection/rail persistence is observable.
const store = new Map();
const fakeLocalStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
};

beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', fakeLocalStorage);
    useSettingsStore.setState({ scoreboards: {}, production: withContainers() });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useObsStore.setState({
        status: 'disconnected', studioMode: false, programScene: null,
        previewScene: null, sceneItems: {}, scenes: [], mirroredScenes: [],
    });
});

const ui = (node) => render(<TooltipProvider>{node}</TooltipProvider>);

const item = (id, sourceName, url, enabled = false) =>
    ({ id, sourceName, url, enabled, inputKind: 'browser_source', isGroup: false, isPrsh: true });

// An OBS mirror with the given scenes. First scene is program unless told
// otherwise; every listed scene is mirrored (the rack only reads mirrored ones).
const obs = (sceneItems, extra = {}) => useObsStore.setState({
    status: 'connected',
    programScene: Object.keys(sceneItems)[0] ?? null,
    scenes: Object.keys(sceneItems),
    mirroredScenes: Object.keys(sceneItems),
    sceneItems,
    ...extra,
});

const SB = 'http://x/layout/scoreboard1/scoreboard.html';
const LOWER = 'http://x/layout/lowerthird/lowerthird.html';
const CALLOUT = 'http://x/layout/shared/callout-stage.html';

// Rows read "<name><board?>"; several board-scoped elements share a board meta,
// so rows are addressed structurally rather than by text. The row's select
// button is name + board meta; the chip and pin glyphs around it aren't part of
// what the row is called.
const rowsNamed = (name) => [...document.querySelectorAll(`[data-rack-row="${name}"]`)]
    .map(r => r.querySelector('button').textContent);
const sectionRows = (scene) => [
    ...document.querySelectorAll(`[data-rack-section="${scene}"] [data-rack-row]`),
].map(r => r.getAttribute('data-rack-row'));
const row = (name) => document.querySelector(`[data-rack-row="${name}"]`);
const rowChip = (name) => row(name)?.querySelector('[data-chip-state]')?.getAttribute('data-chip-state');
const rowNested = (name) => row(name)?.hasAttribute('data-rack-nested');

/*
 * Desks are permanent. They used to appear one at a time, keyed to a "phase"
 * the producer picked — a rule that always needed a special case (Live owned no
 * desk, so the section stood empty), which was the tell that desks were never
 * phase-shaped.
 */
describe('Rack desks', () => {
    it('racks all three workflow desks, always, with their live meta defaults', () => {
        ui(<Rack />);
        const section = within(document.querySelector('[data-rack-section="desk"]'));
        for (const [name, meta] of [['Match', 'no match'], ['Capture', 'empty'], ['Bracket', 'nothing loaded']]) {
            expect(section.getByText(name)).toBeInTheDocument();
            expect(section.getByText(meta)).toBeInTheDocument();
        }
    });

    /*
     * A board is a desk too, and unlike the three above it is derived from the
     * rig: `scoreboards.active` finally has an online reader. Boards row FIRST —
     * the fixture, the capture and the bracket all act on one.
     */
    it('rows one board per active scoreboard, boards first, named by alias', () => {
        useSettingsStore.setState({
            scoreboards: { active: [1, 2], aliases: { 2: 'Stream B' } },
            production: withContainers(),
        });
        ui(<Rack />);
        const section = within(document.querySelector('[data-rack-section="desk"]'));
        expect(section.getByText('Scoreboard 1')).toBeInTheDocument();
        expect(section.getByText('Stream B')).toBeInTheDocument();
        expect(sectionRows('desk').slice(0, 2)).toEqual(['Scoreboard 1', 'Stream B']);
        expect(document.querySelectorAll('[data-chip-state="desk"]').length)
            .toBe(DESKS.length + 2);
    });

    // The meta says what the board is CARRYING, and reads state only — the rack
    // redraws on every HUD frame and must not fire a desk's own fetches.
    it("says what each board is carrying, and what it's waiting for when empty", () => {
        useSettingsStore.setState({
            scoreboards: {
                active: [1, 2],
                binding: { 2: { playback: { mode: 'rotate' } } },
            },
            production: withContainers(),
        });
        useStateStore.setState({
            score: {
                1: { player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } }, score_left: 3, score_right: 2, inning: 5, half_inning: 'Bottom' },
            },
            scoreboards: { rotation: { 2: { game_ids: [1, 2, 3] } } },
        });
        ui(<Rack />);
        const section = within(document.querySelector('[data-rack-section="desk"]'));
        // One fact, at the rack's house length. The transport and the inning are
        // both on the panel (the badge, and BoardGameSubject), so the row keeps
        // only what is nowhere else at a glance: which game is on this board.
        expect(section.getByText('Alice 3–2 Bob')).toBeInTheDocument();
        expect(section.getByText('rotating · 3')).toBeInTheDocument();
    });

    // With nothing on the board there is no matchup to name, so the transport
    // becomes the informative thing — but only where it is not the default.
    it('names the transport only on an idle board', () => {
        useSettingsStore.setState({
            scoreboards: { active: [1, 2], binding: {} },
            production: withContainers(),
        });
        useStateStore.setState({ score: {} });
        ui(<Rack />);
        const section = within(document.querySelector('[data-rack-section="desk"]'));
        expect(section.getByText('HUD · no game')).toBeInTheDocument();
        expect(section.getByText('no game')).toBeInTheDocument();
    });

    // Every desk the rack lists needs a body to select into and, when it says
    // it's pinnable, a quick face for the rail — the three registries are
    // written in three files and would otherwise drift apart silently. Boards
    // are in the same contract, one tier down: their bodies and faces are
    // resolved from the id rather than declared per row.
    it('every desk row has a stage body, and a quick face iff it is pinnable', async () => {
        const { DESK_BODIES, deskBodiesFor } = await import('./production');
        const { DESK_QUICK_FACES, deskQuickFace } = await import('./quickface');
        for (const desk of DESKS) {
            expect(DESK_BODIES[desk.id], `${desk.id} has a stage body`).toBeTruthy();
            expect(DESK_BODIES[desk.id].pinnable !== false, `${desk.id} body agrees on pinnable`)
                .toBe(desk.pinnable !== false);
            expect(DESK_QUICK_FACES[desk.id] != null, `${desk.id} quick face`)
                .toBe(desk.pinnable !== false);
            expect(deskQuickFace(desk.id) != null).toBe(desk.pinnable !== false);
        }
        expect(Object.keys(DESK_BODIES).length).toBe(DESKS.length);

        const bodies = deskBodiesFor([1, 2]);
        expect(Object.keys(bodies).length).toBe(DESKS.length + 2);
        for (const id of ['desk:board:1', 'desk:board:2']) {
            expect(bodies[id], `${id} has a stage body`).toBeTruthy();
            expect(bodies[id].pinnable !== false, `${id} is pinnable`).toBe(true);
            expect(deskQuickFace(id), `${id} quick face`).toBeTruthy();
        }
    });

    it('carries no phase — the console has no phase axis to key one to', () => {
        for (const d of DESKS) expect(d.phase).toBeUndefined();
    });
});

/*
 * Scenes are the grouping axis, and a row exists because a SOURCE exists. The
 * rack lists nothing that isn't really in a scene: those were six dead "—" rows
 * pretending to be a catalog, and the section's + is the honest version.
 */
describe('Rack scene sections', () => {
    it('lists a scene section per OBS scene, program first and labelled', () => {
        obs({ Game: [item(1, 'SB', SB)], Break: [] });
        ui(<Rack />);
        const headers = [...document.querySelectorAll('[data-rack-section]')]
            .map(s => s.getAttribute('data-rack-section'));
        expect(headers).toEqual(['desk', 'Game', 'Break']);
        expect(screen.getByText('PROGRAM · Game')).toBeInTheDocument();
    });

    it('rows only what is actually in the scene', () => {
        obs({ Game: [item(1, 'SB', SB)] });
        ui(<Rack />);
        expect(sectionRows('Game')).toEqual(['Scoreboard']);
        expect(screen.queryByText('Lower Third')).not.toBeInTheDocument();
    });

    /*
     * The payoff, and the reason the scene is part of a row's identity: the
     * same overlay in two scenes is two rows, with their own air state.
     */
    it('rows the same overlay once per scene, with a chip each', () => {
        obs({
            Game: [item(1, 'SB', SB, true)],
            Break: [item(9, 'SB', SB, true)],
        }, { mirroredScenes: ['Game', 'Break'] });
        ui(<Rack />);
        // The Break section is collapsed until expanded — expanding is also
        // what mirrors it.
        fireEvent.click(screen.getByRole('button', { name: /Break/ }));
        expect(sectionRows('Game')).toEqual(['Scoreboard']);
        expect(sectionRows('Break')).toEqual(['Scoreboard']);
        // Enabled in program is AIR; enabled in a scene nobody cut to is not.
        const chip = (scene) => document.querySelector(`[data-rack-section="${scene}"] [data-chip-state]`)
            .getAttribute('data-chip-state');
        expect(chip('Game')).toBe('air');
        expect(chip('Break')).toBe('off');
    });

    it('keeps off-air scenes collapsed until the producer opens them', () => {
        obs({ Game: [], Break: [item(9, 'SB', SB)] });
        ui(<Rack />);
        expect(sectionRows('Break')).toEqual([]);
        fireEvent.click(screen.getByRole('button', { name: /Break/ }));
        expect(sectionRows('Break')).toEqual(['Scoreboard']);
    });

    it('marks the studio preview scene, but only while studio mode is on', () => {
        obs({ Game: [], Staging: [] }, { studioMode: true, previewScene: 'Staging' });
        ui(<Rack />);
        expect(screen.getByText('PREVIEW · Staging')).toBeInTheDocument();
        cleanup();
        obs({ Game: [], Staging: [] }, { studioMode: false, previewScene: 'Staging' });
        ui(<Rack />);
        expect(screen.queryByText('PREVIEW · Staging')).not.toBeInTheDocument();
    });

    it('says a scene is empty rather than leaving the producer guessing', () => {
        obs({ Game: [] });
        ui(<Rack />);
        expect(screen.getByText(/No PRSH overlays here yet/)).toBeInTheDocument();
    });

    it('offers an Add button per open scene — the replacement for dead rows', () => {
        const onAdd = vi.fn();
        obs({ Game: [] });
        ui(<Rack onAdd={onAdd} />);
        fireEvent.click(screen.getByRole('button', { name: 'Add an overlay to Game' }));
        expect(onAdd).toHaveBeenCalledWith('Game');
    });
});

/*
 * Instances. A board-scoped element is one row PER BOARD in a scene, because
 * two `?scoreboard=N` sources are two independent things with their own air
 * state.
 */
describe('Rack instances', () => {
    /*
     * The detail is a QUALIFIER on a name already printed, so an unnamed board
     * contributes its number and not its default alias: "Scoreboard · Scoreboard
     * 1 · Medium" said the word twice in a ~278px row, and the repeat carried
     * nothing. See useBoardTag.
     */
    it('rows a board-scoped element once per board present, named apart', () => {
        obs({ Game: [item(1, 'A', `${SB}?scoreboard=1`), item(2, 'B', `${SB}?scoreboard=2`)] });
        ui(<Rack />);
        expect(rowsNamed('Scoreboard')).toEqual(['ScoreboardB1', 'ScoreboardB2']);
    });

    // The suffix is the board mechanism charging rent: with one board there is
    // nothing to tell apart, so "Scoreboard · Scoreboard 1" is noise.
    it('drops the board suffix when there is only one of an element', () => {
        obs({ Game: [item(1, 'SB', SB)] });
        ui(<Rack />);
        expect(rowsNamed('Scoreboard')).toEqual(['Scoreboard']);
    });

    // One board in three scenes is still one thing to tell apart from nothing.
    it('does not suffix just because a board appears in several scenes', () => {
        obs({ Game: [item(1, 'SB', SB)], Break: [item(9, 'SB', SB)] });
        ui(<Rack />);
        fireEvent.click(screen.getByRole('button', { name: /Break/ }));
        expect(rowsNamed('Scoreboard')).toEqual(['Scoreboard', 'Scoreboard']);
    });

    // A named board keeps its name — the producer chose it to mean something,
    // and it is not a repeat of the element above it.
    it('uses the board ALIAS in the row, not a bare number', () => {
        useSettingsStore.setState({ scoreboards: { aliases: { 2: 'Feature Court' } } });
        obs({ Game: [item(1, 'A', `${SB}?scoreboard=1`), item(2, 'B', `${SB}?scoreboard=2`)] });
        ui(<Rack />);
        expect(rowsNamed('Scoreboard')).toContain('ScoreboardFeature Court');
    });

    it('leaves a global element as one row per scene', () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2, 3] } });
        obs({ Game: [item(1, 'L3', LOWER)] });
        ui(<Rack />);
        expect(rowsNamed('Lower Third')).toEqual(['Lower Third']);
    });

    it('clicking a row selects the PLACEMENT — element, board and scene', () => {
        obs({ Game: [item(1, 'SB', `${SB}?scoreboard=2`)] });
        ui(<Rack />);
        fireEvent.click(screen.getByText('Scoreboard'));
        expect(JSON.parse(fakeLocalStorage.getItem('prsh.ui.production.selection')))
            .toBe('scoreboard:2@Game');
    });
});

describe('Rack pins', () => {
    it('pinning a row appends it to the seeded rail order', () => {
        obs({ Game: [item(1, 'SB', SB)] });
        ui(<Rack />);
        // A never-touched rail starts seeded, so the seeded row already reads
        // as pinned and the first ◇ belongs to something else.
        const pins = screen.getAllByRole('button', { name: 'Pin to quick rail' });
        fireEvent.click(pins[0]);
        const rail = JSON.parse(fakeLocalStorage.getItem('prsh.ui.production.rail'));
        expect(rail.slice(0, RAIL_SEED.length)).toEqual(RAIL_SEED);
        expect(rail.length).toBe(RAIL_SEED.length + 1);
    });

    // A seed pin is stored pre-scene ('scoreboard'); the row it lights up is
    // 'scoreboard:1@Game'. Unpinning has to remove the card the producer is
    // looking at, whatever form it is stored in.
    it('unpins a seeded pin through the row it resolves to', () => {
        obs({ Game: [item(1, 'SB', SB)] });
        ui(<Rack />);
        const unpin = screen.getAllByRole('button', { name: 'Unpin from quick rail' });
        expect(unpin.length).toBeGreaterThan(0);
        fireEvent.click(unpin[0]);
        const rail = JSON.parse(fakeLocalStorage.getItem('prsh.ui.production.rail'));
        expect(rail).not.toContain('scoreboard');
    });
});

/*
 * Fed elements nest under the CONTAINER they feed, because that is what is
 * really in the scene. They used to be top-level rows with no container row at
 * all, which was wrong three ways: two rows shared one scene item so both chips
 * read AIR when at most one could be on screen, either row's eye toggled the
 * other's source, and the container appeared as a row only while nothing was
 * aimed at it.
 */
describe('Rack fed containers', () => {
    const feed = (element) => useStateStore.setState({
        production: { feed: { container: { 'callout-stage': element ? { element } : undefined } } },
    });

    it('rows the container, with what can occupy it nested underneath', () => {
        obs({ Game: [item(3, 'Callout', CALLOUT, true)] });
        ui(<Rack />);
        expect(sectionRows('Game')).toEqual(['Callout Stage', 'Character Spotlight', 'Game Summary']);
        expect(rowNested('Callout Stage')).toBe(false);
        expect(rowNested('Character Spotlight')).toBe(true);
        expect(rowNested('Game Summary')).toBe(true);
    });

    /*
     * The chip that used to lie. One container holds one feed, so only the fed
     * element it is CARRYING is on the broadcast — the other is off, however
     * visible the source is.
     */
    it('gives AIR to the container and to the one feed it is carrying', () => {
        feed('postgamecallout');
        obs({ Game: [item(3, 'Callout', CALLOUT, true)] });
        ui(<Rack />);
        expect(rowChip('Callout Stage')).toBe('air');
        expect(rowChip('Character Spotlight')).toBe('air');
        expect(rowChip('Game Summary')).toBe('off');
    });

    it('takes every fed row off air when the container is hidden', () => {
        feed('postgamecallout');
        obs({ Game: [item(3, 'Callout', CALLOUT, false)] });
        ui(<Rack />);
        expect(rowChip('Callout Stage')).toBe('off');
        expect(rowChip('Character Spotlight')).toBe('off');
    });

    // The eye belongs to the source; a fed row decides only whether its content
    // is the one on the container, which is a choice among siblings.
    it('gives the container an eye and its children a radio', () => {
        obs({ Game: [item(3, 'Callout', CALLOUT, true)] });
        ui(<Rack />);
        const container = within(document.querySelector('[data-rack-row="Callout Stage"]'));
        const child = within(document.querySelector('[data-rack-row="Game Summary"]'));
        expect(container.getByRole('button', { name: /Hide source/ })).toBeInTheDocument();
        expect(child.getByRole('button', { name: /container/ })).toBeInTheDocument();
        expect(child.queryByRole('button', { name: /source/ })).not.toBeInTheDocument();
    });
});

// With OBS disconnected the rack still renders: desks are content workflows
// that never touched OBS, and the producer is told why the scene list is empty
// rather than shown a blank column.
/*
 * With no OBS the rack becomes a CATALOG instead of a mirror (./placements
 * `catalogPlacements`). It used to collapse to three desk rows and an apology,
 * which made every stage — lower-third authoring, container rosters, scorecard
 * bands, all the previews — unreachable because of the one thing PRSH can't do
 * without OBS. It monitors nothing and selects everything, which is the honest
 * half of its job.
 */
describe('Rack without OBS', () => {
    it('lists what PRSH can configure instead of what is in a scene', () => {
        ui(<Rack />);
        expect(screen.getByText('Match')).toBeInTheDocument();       // desks stay
        expect(screen.getByText(/OBS not connected/)).toBeInTheDocument();
        expect(document.querySelector('[data-rack-section="catalog"]')).toBeInTheDocument();

        const rows = document.querySelectorAll('[data-rack-row]');
        expect(rows.length).toBeGreaterThan(DESKS.length);
        expect(screen.getAllByText('Scoreboard').length).toBeGreaterThan(0);
        expect(screen.getByText('Lower Third')).toBeInTheDocument();
    });

    /*
     * The scoreboard's sizes are three different canvases and three different
     * browser sources, and with OBS closed there is no source to read a size off
     * — so the catalog has to OFFER them or a producer building their scenes from
     * copied URLs can only ever get the Large board.
     *
     * The default size keeps the bare row: a source with no ?size= IS large, so
     * naming it anything else would mean a pin made here opens nothing once OBS
     * is up (see the note in catalogPlacements).
     */
    it('offers the scoreboard’s sizes, with the default as the bare row', () => {
        ui(<Rack />);
        const scoreboards = [...document.querySelectorAll('[data-rack-row="Scoreboard"]')];
        expect(scoreboards.length).toBe(3);
        const details = scoreboards.map(r => r.textContent);
        expect(details.some(t => t.includes('Small'))).toBe(true);
        expect(details.some(t => t.includes('Medium'))).toBe(true);
        // The Large row carries no size detail — it is the canonical instance.
        expect(details.some(t => !t.includes('Small') && !t.includes('Medium'))).toBe(true);
    });

    // The producer's containers are definitions in Settings, so they are just as
    // real with OBS closed — and their rostered members nest under them exactly
    // as they do on air.
    it('rows the producer’s containers with their members nested', () => {
        ui(<Rack />);
        expect(screen.getByText('Callout Stage')).toBeInTheDocument();
        const nested = [...document.querySelectorAll('[data-rack-nested]')]
            .map(n => n.getAttribute('data-rack-row'));
        expect(nested).toContain('Game Summary');
        expect(nested).toContain('Character Spotlight');
    });

    /*
     * No eye: there is no scene item to show or hide, and a dead control is worse
     * than an absent one. Every row still SELECTS, which is the whole point.
     */
    it('offers no visibility control, and every chip reads unbound', () => {
        ui(<Rack />);
        expect(screen.queryByRole('button', { name: /show source/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /hide source/i })).not.toBeInTheDocument();
        const chips = [...document.querySelectorAll('[data-rack-section="catalog"] [data-chip-state]')];
        expect(chips.length).toBeGreaterThan(0);
        expect(chips.every(c => c.getAttribute('data-chip-state') === 'unbound')).toBe(true);
    });

    // The + still opens the picker — with no scene, for its Copy URL and its
    // container builder, both of which need nothing from OBS.
    it('keeps an Add affordance that opens the picker with no scene', () => {
        const onAdd = vi.fn();
        ui(<Rack onAdd={onAdd} />);
        const add = screen.getByRole('button', { name: /copy an overlay url/i });
        fireEvent.click(add);
        expect(onAdd).toHaveBeenCalledWith(null);
    });
});
