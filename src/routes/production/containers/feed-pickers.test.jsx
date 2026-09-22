import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { useStagingStore } from '../../../context/staging';
import { ELEMENTS } from '../elements';
import { PostgameCalloutPicker, characterSummary } from './feed-pickers';
import { withContainers } from '../../../test/containers';

beforeEach(() => {
    vi.stubGlobal('localStorage', {
        getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
    });
    useSettingsStore.setState({ overlays: {}, scoreboards: {}, production: withContainers() });
    useStateStore.setState({ score: {}, production: {}, postgame: {} });
    useStagingStore.setState({ pending: {}, order: [] });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const spotlight = ELEMENTS.find(e => e.id === 'postgamecallout');
/*
 * A captured character. `line` is written the way the SERVER writes it
 * (format_batting_line: H-for-AB plus every non-zero count stat, count elided
 * at one) — a fixture that pairs a bare "2-for-4" with separate homeruns/rbi
 * fields is a shape the server cannot produce, and asserting against it is how
 * the duplicated-stats bug got a passing test.
 */
const ch = (name, b = {}, line = null) => {
    const bat = { singles: 0, doubles: 0, triples: 0, homeruns: 0, rbi: 0, ...b };
    return { name, batting: { ...bat, ...(line ? { line } : {}) } };
};

// A finished game: side 1 won, Daisy had the biggest day on it.
const captureLoaded = () => useStateStore.setState({
    postgame: {
        1: {
            present: true,
            meta: { winnerSide: 1 },
            player: {
                1: {
                    rioName: 'left',
                    characters: [
                        ch('Peach', { singles: 2 }, '2-for-4'),
                        ch('Daisy', { homeruns: 2 }, '2-for-4, 2 HR, 4 RBI'),
                    ],
                },
                2: { rioName: 'right', characters: [ch('Wario', { homeruns: 3 }, '3-for-4, 3 HR, 5 RBI')] },
            },
        },
    },
});

const feed = () => useStateStore.getState()?.production?.feed?.container?.['callout-stage'];
const memory = () => useStateStore.getState()?.production?.feed?.last?.postgamecallout;
const ui = () => render(<PostgameCalloutPicker element={spotlight} scoreboard={1} />);

/*
 * The picker is a popover Combobox, not a native <select>, so a pick is two
 * acts: open the trigger, click the option. `trigger` is also the READOUT —
 * it carries the character's name and their line, which is what let the
 * "SHOWING <name>" caption under it go.
 */
const trigger = () => screen.getByRole('combobox');
const open = () => fireEvent.click(trigger());
const optionText = () => screen.getAllByRole('option').map(o => o.textContent);
const pick = (name) => {
    open();
    fireEvent.click(screen.getByRole('option', { name: new RegExp(name) }));
};

// Put this element on the stage (mine) carrying `sel`, so the picker is live.
// Airing always came from a pick or a push, both of which record the intent —
// so seed the memory too, mirroring the real flow.
const airing = (sel) => {
    const payload = { element: 'postgamecallout', scoreboard: 1, ...sel };
    useStateStore.getState().setItems([
        { key: 'production.feed.container.callout-stage', value: payload },
        { key: 'production.feed.last.postgamecallout', value: payload },
    ]);
};

/*
 * Selecting a character is DECOUPLED from airing it: picking arms the spotlight
 * (records the intent the preview draws and Push airs) without touching the
 * live container — unless this element already holds the stage, where the pick
 * is a live edit. The whole point of the user's ask: preview before you cut.
 */
describe('spotlight pick is decoupled from air', () => {
    it('arms the pick without putting it on the container', () => {
        captureLoaded();
        ui();
        pick('Peach');
        // Armed, not aired: intent records Peach, the container stays empty.
        expect(memory()).toMatchObject({ element: 'postgamecallout', team: 1, charIndex: 0, name: 'Peach' });
        expect(feed()).toBeUndefined();
        // The closed trigger IS the readout — the name AND what they did — so
        // there is no caption under it repeating either.
        expect(trigger().textContent).toContain('Peach');
        expect(trigger().textContent).toContain('2-for-4');
    });

    /*
     * THE TENSE IS THE PANEL'S SUBJECT, NOT A ROW IN ITS BODY. This picker
     * carried five captions — SHOWING / ON STAGE / PUSH SHOWS / SUGGESTED —
     * each naming the character a second time under a control that had just
     * named them. `FedSubject` (../subject) answers "what is this showing" in
     * the panel header and on the rail card, and the console has one home for
     * that question.
     */
    it('says nothing about tense — no caption restating the control', () => {
        captureLoaded();
        ui();
        pick('Peach');
        for (const gone of ['SHOWING', 'PUSH SHOWS', 'ON STAGE', 'SUGGESTED']) {
            expect(screen.queryByText(gone)).toBeNull();
        }
    });

    it('live-edits the container when this element already holds the stage', () => {
        captureLoaded();
        airing({ team: 2, charIndex: 0, name: 'Wario' }); // spotlight is live on Wario
        ui();
        pick('Peach'); // swap
        // Live: the pick goes straight to the container.
        expect(feed()).toMatchObject({ element: 'postgamecallout', team: 1, charIndex: 0, name: 'Peach' });
    });

    it('survives another element taking the stage — the pick is intent, not air', () => {
        captureLoaded();
        ui();
        pick('Peach');

        // Game Summary takes the stage — the container carries someone else.
        useStateStore.getState().setItems([
            { key: 'production.feed.container.callout-stage', value: { element: 'postgamevs', scoreboard: 1 } },
        ]);
        cleanup();
        ui();
        expect(trigger().textContent).toContain('Peach');
    });

    it('keeps the pick through a Clear — Clear takes it off air, it does not un-pick', () => {
        captureLoaded();
        airing({ team: 1, charIndex: 0, name: 'Peach' }); // live on Peach
        ui();
        fireEvent.click(screen.getByLabelText('Take this off the stage'));
        expect(feed()).toBeUndefined();
        expect(memory()).toMatchObject({ name: 'Peach' });
        cleanup();
        ui();
        expect(trigger().textContent).toContain('Peach');
    });
});

/*
 * With nothing remembered the picker proposes rather than sitting empty, so a
 * producer who just captured a game can go straight to Push.
 */
/*
 * The formatter behind the line each option carries, over the shapes a real
 * capture produces.
 */
describe('characterSummary', () => {
    /*
     * A PITCHER IS DESCRIBED BY THEIR BATTING, like everyone else. The callout
     * is a batting graphic — its AB Theater replays plate appearances and holds
     * on the spray chart — so an ERA answers a question this picker is not
     * asking, and one row measured differently makes the list unscannable for
     * the very thing it is scanned for.
     */
    /*
     * THE SERVER'S LINE, VERBATIM. `format_batting_line` already appends every
     * non-zero count stat — HR, 3B, 2B, BB, HBP, RBI, SB, count elided at one —
     * so appending HR and RBI to it printed both twice: Bowser read
     * "1-for-3, HR, 3 RBI, 1 HR, 3 RBI". These are real server outputs.
     */
    it('does not re-append the stats the line already carries', () => {
        expect(characterSummary({ batting: {
            line: '1-for-3, HR, 3 RBI', at_bats: 3, hits: 1, homeruns: 1, rbi: 3,
        } })).toBe('1-for-3, HR, 3 RBI');
        expect(characterSummary({ batting: {
            line: '4-for-5, 2 2B', at_bats: 5, hits: 4, doubles: 2, homeruns: 0, rbi: 0,
        } })).toBe('4-for-5, 2 2B');
        expect(characterSummary({ batting: { line: '0-for-3', at_bats: 3, hits: 0 } }))
            .toBe('0-for-3');
    });

    /*
     * A PITCHER IS DESCRIBED BY THEIR BATTING, like everyone else. The callout
     * is a batting graphic — its AB Theater replays plate appearances and holds
     * on the spray chart — so an ERA answers a question this picker is not
     * asking, and one row measured differently makes the list unscannable for
     * the very thing it is scanned for.
     */
    it('describes a PITCHER by their batting, ignoring the pitching block', () => {
        const bat = { line: '1-for-3, HR', at_bats: 3, hits: 1, homeruns: 1 };
        expect(characterSummary({
            name: 'Boo', wasPitcher: true, batting: bat,
            pitching: { ip: '8.1', strikeouts_pitched: 4, earned_runs: 4 },
        })).toBe('1-for-3, HR');
        // ...which is exactly what a non-pitcher with the same day reads.
        expect(characterSummary({ wasPitcher: true, batting: bat, pitching: { ip: '9.0' } }))
            .toBe(characterSummary({ wasPitcher: false, batting: bat }));
    });

    /*
     * The fallback is a compatibility floor for a capture written before `line`
     * existed — the H-for-AB stem and nothing else. Rebuilding the count stats
     * here would be the second formatter this whole function exists to avoid.
     */
    it('falls back to the H-for-AB stem alone, and says nothing when it cannot', () => {
        expect(characterSummary({ batting: { hits: 3, at_bats: 4, homeruns: 2 } }))
            .toBe('3-for-4');
        expect(characterSummary({ batting: {} })).toBe('');
        expect(characterSummary({})).toBe('');
        expect(characterSummary(null)).toBe('');
    });
});

describe('spotlight suggestion', () => {
    /*
     * A SUGGESTION IS NOT A PICK — and saying so is the PANEL's job, not this
     * row's. `FedSubject` (../subject) draws "Push shows Daisy · suggested" in
     * the header of the panel this picker sits in, pinned by subject.test.jsx;
     * the picker itself only has to open on the proposal rather than sitting
     * empty, so a producer who just captured a game can go straight to Push.
     */
    it('opens on the winning side\'s leader in total bases', () => {
        captureLoaded();
        ui();
        expect(trigger().textContent).toContain('Daisy'); // 8 TB
        expect(screen.queryByText('SUGGESTED')).toBeNull();
    });

    it('offers no clear while off the stage — there is no feed to clear', () => {
        captureLoaded();
        ui();
        expect(screen.queryByLabelText('Take this off the stage')).toBeNull();
        open();
        expect(optionText().some(l => l.startsWith('Daisy'))).toBe(true);
    });

    /*
     * WHAT THEY DID, on the option. Nine bare names per side asks a producer to
     * remember a box score they are standing next to, when the whole reason to
     * spotlight someone is what they did.
     */
    it('carries each character’s line on the option', () => {
        captureLoaded();
        ui();
        open();
        const labels = optionText();
        // The server's line, VERBATIM — not the server's line plus a second
        // helping of the stats already in it.
        expect(labels).toContain('Daisy2-for-4, 2 HR, 4 RBI');
        expect(labels).toContain('Peach2-for-4');
        // Per LABEL, not across the list: two characters may each have a HR.
        for (const l of labels) expect((l.match(/HR/g) || []).length).toBeLessThan(2);
    });

    /*
     * BOTH SIDES AT ONCE. The groups are the two players, nine roster slots
     * each, and the choice is made by comparing them — so they are laid out as
     * columns (Combobox `columns`) rather than stacked, where reaching the
     * second team means scrolling past the whole of the first.
     */
    it('lists both sides under their own headings', () => {
        captureLoaded();
        ui();
        open();
        expect(screen.getByText('left')).toBeTruthy();
        expect(screen.getByText('right')).toBeTruthy();
        expect(optionText().some(l => l.startsWith('Wario'))).toBe(true);
        expect(optionText().some(l => l.startsWith('Peach'))).toBe(true);
    });

    /*
     * THE SPRITE IS WHY A NINE-DEEP ROSTER IS SCANNABLE — a producer knows the
     * face before they have read the name. It is the app's own asset resolver,
     * so a pack dropped in mid-show is picked up on the next render, and a
     * character the pack has no art for simply draws nothing.
     */
    it('draws each character’s icon on the option', () => {
        captureLoaded();
        ui();
        open();
        const icon = screen.getByRole('option', { name: /Daisy/ }).querySelector('img');
        expect(icon.getAttribute('src')).toMatch(/game_assets\/msb\/characterIcons\/5\.png/);
    });

    it('offers the clear once the element holds the stage', () => {
        captureLoaded();
        airing({ team: 1, charIndex: 0, name: 'Peach' }); // live
        ui();
        expect(screen.getByLabelText('Take this off the stage')).toBeTruthy();
        expect(screen.queryByText('ON STAGE')).toBeNull();
    });

    it('says to capture a game first when there is nothing to spotlight', () => {
        ui();
        expect(screen.getByText(/No captured game on scoreboard 1 yet/)).toBeTruthy();
    });
});
