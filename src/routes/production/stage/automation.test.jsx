import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { useObsStore } from '../../../context/obs';
import ContainerStage from './container';

/*
 * The container panel's rules, as a producer reads and edits them: each rule is
 * one line of text, every underlined word is its own menu, and editing a word
 * never grows the row.
 */

const C = 'card';
const stored = () => useSettingsStore.getState().production.automations;

beforeEach(() => {
    useSettingsStore.setState({
        scoreboards: { active: [1] },
        production: {
            container_defs: {
                [C]: {
                    name: 'Card', width: 1920, height: 1080,
                    members: ['statscard', 'postgamevs'], resting: 'statscard',
                    scope: { scoreboard: 1, team: 1 },
                },
            },
            automations: {
                r1: {
                    kind: 'when', event: 'batter_up', by: 'any', subject: 'fielding',
                    member: 'statscard', container: C, until: 8, once: 'always',
                    conditions: [{ field: 'inning', op: '>=', value: 7 }], order: 0,
                },
                r2: { kind: 'while', state: 'final', member: 'postgamevs', container: C, order: 0 },
            },
        },
    });
    useStateStore.setState({ production: {} });
    useObsStore.setState({ status: 'disconnected', sceneItems: {} });
});
afterEach(cleanup);

const ui = () => render(
    <TooltipProvider>
        <ContainerStage element={{ id: `container:${C}`, container: C }} placement={{ container: C }} />
    </TooltipProvider>,
);

describe('the rule list', () => {
    it('reads each rule as one sentence', () => {
        ui();
        expect(screen.getByText('a new batter steps up')).toBeInTheDocument();
        expect(screen.getByText('either side')).toBeInTheDocument();
        expect(screen.getByText('if inning ≥ 7')).toBeInTheDocument();
        // A Stat Card is about a player, so the subject reads as one.
        expect(screen.getByText('the pitcher')).toBeInTheDocument();
        expect(screen.getByText('8 s')).toBeInTheDocument();
        expect(screen.getByText('the game is final')).toBeInTheDocument();
        expect(screen.getByText('Otherwise')).toBeInTheDocument();
    });

    it('edits one word from its own menu', () => {
        ui();
        fireEvent.click(screen.getByRole('button', { name: '8 s' }));
        fireEvent.click(screen.getByRole('option', { name: 'the next batter' }));
        expect(stored().r1.until).toBe('next_batter');
    });

    it('re-seats the subject when the member changes to one without an "of"', () => {
        ui();
        fireEvent.click(screen.getAllByRole('button', { name: 'Stat Card' })[0]);
        fireEvent.click(screen.getByRole('option', { name: 'Game Summary' }));
        expect(stored().r1).toMatchObject({ member: 'postgamevs', subject: 'scope' });
    });

    it('sets the Otherwise member, nothing included', () => {
        ui();
        const otherwise = screen.getByText('Otherwise').parentElement;
        fireEvent.click(within(otherwise).getByRole('button', { name: 'Stat Card' }));
        fireEvent.click(screen.getByRole('option', { name: 'nothing (transparent)' }));
        expect(useSettingsStore.getState().production.container_defs[C].resting).toBeUndefined();
    });

    it('adds a While rule that already makes sense', () => {
        ui();
        fireEvent.click(screen.getByRole('button', { name: /While/ }));
        const added = Object.values(stored()).filter(r => r.kind === 'while');
        expect(added).toHaveLength(2);
        expect(added[1]).toMatchObject({ container: C, order: 1 });
    });
});

describe('scope', () => {
    it('shows only when something on the container reads one', () => {
        ui();
        expect(screen.getByText('Scope')).toBeInTheDocument();
        cleanup();
        useSettingsStore.setState({
            production: {
                container_defs: { [C]: { name: 'Card', width: 1920, height: 1080, members: ['postgamevs'] } },
                automations: {},
            },
        });
        ui();
        expect(screen.queryByText('Scope')).not.toBeInTheDocument();
    });
});

describe('the manual pick', () => {
    it('Show puts a member on the container, and Hand back clears it', () => {
        ui();
        const row = screen.getAllByText('Stat Card').find(n => n.closest('.group'))?.closest('.group');
        fireEvent.click(within(row).getByRole('button', { name: 'Show' }));
        expect(useStateStore.getState().production.feed.container[C])
            .toMatchObject({ element: 'statscard', scoreboard: 1, team: 1 });

        cleanup();
        useStateStore.setState({ production: {
            feed: { container: { [C]: { element: 'statscard', scoreboard: 1, team: 1 } }, reason: { [C]: 'manual' } },
        } });
        ui();
        const held = screen.getAllByText('Stat Card').find(n => n.closest('.group'))?.closest('.group');
        fireEvent.click(within(held).getByRole('button', { name: 'Hand back' }));
        expect(useStateStore.getState().production.feed.container?.[C]).toBeUndefined();
    });

    it('offers Hold, not Hand back, on a member a rule put up', () => {
        useStateStore.setState({ production: {
            feed: { container: { [C]: { element: 'statscard', scoreboard: 1, team: 1 } }, reason: { [C]: 'rule' } },
        } });
        ui();
        expect(screen.getByRole('button', { name: 'Hold' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Hand back' })).not.toBeInTheDocument();
    });
});
