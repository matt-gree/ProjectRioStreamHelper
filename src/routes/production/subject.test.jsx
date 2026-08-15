import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useStateStore } from '../../context/store';
import { Subject, battingSide } from './subject';
import { ELEMENTS } from './elements';

/*
 * The subject contract (production-console-contract skill).
 *
 * What a panel is DRAWING, as opposed to what you can do to it. Three things
 * are worth pinning: that the batting-side rule matches its two other runtimes,
 * that each identity axis (board, team variant, container scope) resolves to
 * the right frame of reference, and WHICH elements draw a subject at all —
 * since the rail spends one of its two rows on it.
 */

const setState = (state) => useStateStore.setState({ ...state }, true);

const placementFor = (id, extra = {}) => ({
    id, element: ELEMENTS.find(e => e.id === id), board: null, variant: '',
    scene: 'Game', where: 'program', item: { sourceName: 's', url: '' }, ...extra,
});

beforeEach(() => setState({}));

describe('battingSide', () => {
    /*
     * Mirrors `_team_role` (server/automations.py) and `RioData.getTeamRole`
     * (public/layout/lib/rio-data.js). Three runtimes, no shared module — the
     * same split the scoreboard's blank-reason predicate lives with. If this
     * changes, all three change.
     */
    it('the away side bats in the top half, the home side in the bottom', () => {
        expect(battingSide(2, 'Top')).toBe(1);
        expect(battingSide(2, 'Bottom')).toBe(2);
        expect(battingSide(1, 'Top')).toBe(2);
        expect(battingSide(1, 'Bottom')).toBe(1);
    });

    it('defaults to a top-half, side-2-home game when state says nothing', () => {
        expect(battingSide(undefined, undefined)).toBe(1);
    });
});

describe('Subject', () => {
    it('a board-scoped element states the live game, not its wiring', () => {
        setState({
            score: {
                1: {
                    player: { 1: { rioName: 'Matt' }, 2: { rioName: 'Jake' } },
                    score_left: 5, score_right: 7, inning: 5, half_inning: 'Bottom',
                },
            },
        });
        render(<Subject placement={placementFor('scoreboard', { board: 1 })} />);
        expect(screen.getByText('Matt 5–7 Jake')).toBeInTheDocument();
        expect(screen.getByText('Bot 5')).toBeInTheDocument();
    });

    it('an empty board says so plainly — escalating is ReadinessNote\'s job', () => {
        render(<Subject placement={placementFor('scoreboard', { board: 1 })} />);
        expect(screen.getByText(/No game on this board yet/)).toBeInTheDocument();
    });

    /*
     * The answer a `?team=` source cannot give about itself. Rio reassigns
     * away/home every game, so "Team 2" is a position and not an identity —
     * which is the whole reason this row exists.
     */
    it('a team-variant source names who is on that side', () => {
        setState({ score: { 1: { player: { 2: { rioName: 'Jake', msb_team: 'Yoshi' } } } } });
        render(<Subject placement={placementFor('roster', {
            variant: 't2', item: { sourceName: 's', url: '/layout/scoreboard1/roster.html?team=2' },
        })} />);
        expect(screen.getByText('Right — Jake')).toBeInTheDocument();
    });

    it('a container states its occupant AND why, so a push reads apart from a rule', () => {
        setState({
            production: { feed: { reason: { pit: 'rule' } } },
        });
        render(<Subject placement={{
            ...placementFor('scoreboard'),
            element: { id: 'container:pit', name: 'Pit', container: 'pit' },
            carrying: 'statscard',
        }} />);
        expect(screen.getByText('Carrying Stat Card')).toBeInTheDocument();
        expect(screen.getByText('automation')).toBeInTheDocument();
    });

    it('renders nothing for an element with no live content of its own', () => {
        const { container } = render(<Subject placement={placementFor('ticker')} />);
        expect(container).toBeEmptyDOMElement();
    });

    /*
     * A pick, said in the tense of the row it is on. On a container SLOT it is
     * what Push would put up; on the element's own source the overlay renders
     * that key itself, so it is simply what is drawn.
     *
     * And a SUGGESTION IS NOT A PICK: `resolveIntent` proposes when there is no
     * memory, which is right for "what would Push show" and a lie next to a
     * source drawing nothing — so the direct row keeps the proposal as a
     * qualifier rather than claiming it is on screen.
     */
    const CAPTURE = {
        postgame: {
            1: {
                present: true, meta: { winnerSide: 1 },
                player: {
                    1: {
                        rioName: 'Matt', score: 7,
                        characters: [{ name: 'Mario', batting: { singles: 1, homeruns: 2, rbi: 4 } }],
                    },
                    2: { rioName: 'Jake', score: 3, characters: [{ name: 'Wario', batting: {} }] },
                },
            },
        },
    };

    it('says what a pick WOULD show on a slot, and what it IS showing on its own source', () => {
        setState({
            ...CAPTURE,
            production: {
                feed: {
                    last: {
                        postgamecallout: {
                            element: 'postgamecallout', scoreboard: 1, team: 1,
                            charIndex: 0, name: 'Mario',
                        },
                    },
                },
            },
        });
        const slot = placementFor('postgamecallout', {
            slot: 'callout-stage', container: 'callout-stage', parent: 'container:callout-stage@Game',
        });
        const { unmount } = render(<Subject placement={slot} />);
        expect(screen.getByText('Push shows Mario')).toBeInTheDocument();
        unmount();

        render(<Subject placement={placementFor('postgamecallout')} />);
        expect(screen.getByText('Showing Mario')).toBeInTheDocument();
    });

    it('keeps a suggestion a suggestion on the element’s own source', () => {
        setState(CAPTURE);
        const { unmount } = render(<Subject placement={placementFor('postgamecallout', {
            slot: 'callout-stage', container: 'callout-stage', parent: 'x',
        })} />);
        // On a container the proposal IS what Push would send.
        expect(screen.getByText('Push shows Mario')).toBeInTheDocument();
        unmount();

        // On its own source nothing has been picked, so nothing is drawn.
        render(<Subject placement={placementFor('postgamecallout')} />);
        expect(screen.getByText('Nothing picked yet')).toBeInTheDocument();
        expect(screen.getByText('Mario suggested')).toBeInTheDocument();
    });

    // …and on a container slot, where it has no pick either, the honest line is
    // what Push will do — `canPush` is true for a whole-game element with or
    // without a memory, so "nothing armed yet" described a state it can't be in.
    it('a whole-game element on a slot says what Push will do', () => {
        setState(CAPTURE);
        render(<Subject placement={placementFor('postgamevs', {
            slot: 'callout-stage', container: 'callout-stage', parent: 'x',
        })} />);
        expect(screen.getByText('Push shows this game')).toBeInTheDocument();
    });

    // A whole-game element has no pick, so "nothing picked yet" would describe a
    // control it does not have. What it can say is the game it will draw.
    it('a whole-game element states its capture rather than a pick', () => {
        setState(CAPTURE);
        render(<Subject placement={placementFor('postgamevs')} />);
        expect(screen.getByText('Matt 7–3 Jake')).toBeInTheDocument();
        expect(screen.getByText('captured')).toBeInTheDocument();
    });
});

describe('what does and does not get a subject', () => {
    /*
     * The rail spends one of its two rows on this, so which elements draw one
     * is a design decision worth pinning rather than a side effect. A card that
     * gets none degrades to its single toggle — no placeholder, no empty row.
     */
    it('draws for elements with live content, and nothing for the rest', () => {
        const cases = [
            ['scoreboard', placementFor('scoreboard', { board: 1 }), true],
            ['hit visualizer', placementFor('hitvisualizer', { board: 1 }), true],
            ['roster (team variant)', placementFor('roster', { variant: 't1' }), true],
            ['commentary', placementFor('commentary'), true],
            ['ticker', placementFor('ticker'), false],
            ['event header', placementFor('eventheader'), false],
            // A scoped member on no roster has no frame of reference to draw
            // from, which is why the predicate that used to live here couldn't
            // be right: it cannot read the store.
            ['stat card with no container', placementFor('statscard'), false],
        ];
        for (const [what, placement, expected] of cases) {
            const { container, unmount } = render(<Subject placement={placement} />);
            expect(container.textContent !== '', what).toBe(expected);
            unmount();
        }
    });

    it('renders nothing for a placement with no element at all', () => {
        const { container } = render(<Subject placement={null} />);
        expect(container).toBeEmptyDOMElement();
    });
});
