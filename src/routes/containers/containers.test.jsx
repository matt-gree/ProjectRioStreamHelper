import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useObsStore } from '../../context/obs';
import ContainersTab from './containers';
import ContainerStage from '../production/stage/container';
import { CONTAINER_TAB_KEY } from '../production/containers/containers';

/*
 * The Containers tab: the one workbench every container is built on, whether
 * or not any scene has a source for it.
 */

const C = 'card';
const defs = () => useSettingsStore.getState().production.container_defs;
const seed = (container_defs = {}) => useSettingsStore.setState({
    scoreboards: { active: [1] },
    production: { container_defs, automations: {} },
});

// The test env's localStorage has no working methods (see rack.test.jsx), and
// the tab's selection and the jump from a source panel both live there.
const stored = new Map();
const fakeLocalStorage = {
    getItem: k => (stored.has(k) ? stored.get(k) : null),
    setItem: (k, v) => stored.set(k, String(v)),
    removeItem: k => stored.delete(k),
    clear: () => stored.clear(),
};

beforeEach(() => {
    stored.clear();
    vi.stubGlobal('localStorage', fakeLocalStorage);
    seed({ [C]: { name: 'Card', width: 380, height: 294, members: ['statscard'] } });
    useStateStore.setState({ production: {} });
    useObsStore.setState({ status: 'disconnected', sceneItems: {}, scenes: [] });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const ui = node => render(<MemoryRouter><TooltipProvider>{node}</TooltipProvider></MemoryRouter>);
// A container's row in the list; `aria-current` marks the one open.
const row = name => within(screen.getByRole('navigation', { name: 'Containers' }))
    .getByRole('button', { name: new RegExp(`^${name}`) });

describe('an empty tab', () => {
    it('leads with one press, and creating opens the new container', () => {
        seed();
        ui(<ContainersTab />);
        fireEvent.click(screen.getAllByRole('button', { name: /New container/ })[0]);
        fireEvent.change(screen.getByLabelText('Container name'), { target: { value: 'Lower Bar' } });
        fireEvent.click(screen.getByLabelText(/Stat Card/));
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        expect(defs()['lower-bar']).toMatchObject({ name: 'Lower Bar', members: ['statscard'] });
        // Straight into it: the roster and the rules are what comes next.
        expect(row('Lower Bar')).toHaveAttribute('aria-current', 'true');
        expect(screen.getByRole('listbox', { name: 'Members' })).toBeInTheDocument();
    });
});

describe('the new-container form', () => {
    // The name is prefilled, so the only thing Create waits for is a member.
    it('starts named and creates once a member is picked', () => {
        seed({ 'container-1': { name: 'Container 1', width: 380, height: 294, members: ['roster'] } });
        ui(<ContainersTab />);
        fireEvent.click(screen.getAllByRole('button', { name: /New container/ })[0]);
        expect(screen.getByLabelText('Container name')).toHaveValue('Container 2');
        const create = screen.getByRole('button', { name: 'Create' });
        expect(create).toBeDisabled();
        fireEvent.click(screen.getByLabelText(/Stat Card/));
        fireEvent.click(create);
        expect(defs()['container-2']).toMatchObject({ name: 'Container 2', members: ['statscard'] });
    });

    it('falls back to the default when the name is cleared', () => {
        seed();
        ui(<ContainersTab />);
        fireEvent.click(screen.getAllByRole('button', { name: /New container/ })[0]);
        fireEvent.change(screen.getByLabelText('Container name'), { target: { value: '  ' } });
        fireEvent.click(screen.getByLabelText(/Stat Card/));
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));
        expect(defs()['container-1']).toMatchObject({ name: 'Container 1' });
    });
});

describe('the list', () => {
    it('lists every container, the first open until another is picked', () => {
        seed({
            a: { name: 'Alpha', width: 380, height: 294, members: ['statscard'] },
            b: { name: 'Bravo', width: 380, height: 294, members: ['roster'] },
        });
        ui(<ContainersTab />);
        expect(row('Alpha')).toHaveAttribute('aria-current', 'true');
        fireEvent.click(row('Bravo'));
        expect(row('Alpha')).not.toHaveAttribute('aria-current');
        expect(row('Bravo')).toHaveAttribute('aria-current', 'true');
        expect(screen.getByLabelText('Container name')).toHaveValue('Bravo');
    });

    // Stored ids are resolved at read time: one naming a deleted container
    // falls back to the first rather than an empty pane.
    it('falls back to the first container when the stored one is gone', () => {
        stored.set(CONTAINER_TAB_KEY, JSON.stringify('gone'));
        ui(<ContainersTab />);
        expect(row('Card')).toHaveAttribute('aria-current', 'true');
    });

    it('says what it is showing, and why', () => {
        useStateStore.setState({ production: {
            feed: { container: { [C]: { element: 'statscard' } }, reason: { [C]: 'manual' } },
        } });
        ui(<ContainersTab />);
        expect(screen.getByText(/Stat Card · Pushed/)).toBeInTheDocument();
    });

    // A container kept for later is the point of the tab, so its absence from
    // OBS is said out loud — but only with OBS there to ask.
    it('marks a container no scene holds, only while OBS is connected', () => {
        ui(<ContainersTab />);
        expect(screen.queryByText('Not in OBS')).not.toBeInTheDocument();
        cleanup();
        useObsStore.setState({ status: 'connected', sceneItems: {}, scenes: ['Game'] });
        ui(<ContainersTab />);
        expect(within(row('Card')).getByText('Not in OBS')).toBeInTheDocument();
    });

    it('adds a source to a scene, hidden', async () => {
        const addBrowserSource = vi.fn(async ({ inputName, sceneName }) => ({ inputName, sceneName }));
        useObsStore.setState({ status: 'connected', sceneItems: {}, scenes: ['Game', 'Break'], addBrowserSource });
        ui(<ContainersTab />);
        fireEvent.change(screen.getByLabelText('Add to scene'), { target: { value: 'Break' } });
        await waitFor(() => expect(addBrowserSource).toHaveBeenCalled());
        expect(addBrowserSource.mock.calls[0][0]).toMatchObject({
            inputName: 'Card', sceneName: 'Break', width: 380, height: 294, enabled: false,
        });
        expect(addBrowserSource.mock.calls[0][0].url).toMatch(/container\.html\?container=card/);
    });
});

describe('the open container', () => {
    // The preview is the panel's subject: it draws the SELECTED member in the
    // container's own frame, and selecting another member redraws it.
    it('previews the selected member inside the container', () => {
        seed({ [C]: { name: 'Card', width: 452, height: 294, members: ['statscard', 'roster'] } });
        ui(<ContainersTab />);
        const frame = () => document.querySelector('iframe')?.getAttribute('src') ?? '';
        expect(frame()).toMatch(/container\.html\?container=card&preview=1&sample=1&feed=statscard/);
        fireEvent.click(screen.getByRole('option', { name: /Roster/ }));
        expect(screen.getByRole('option', { name: /Roster/ })).toHaveAttribute('aria-selected', 'true');
        expect(frame()).toMatch(/feed=roster/);
    });

    // Edit swaps the panel for the same picker a container is built with, the
    // current members already ticked; a pick that grows the container says so
    // beside Save.
    it('edits the roster in the picker, current members ticked', () => {
        ui(<ContainersTab />);
        fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
        expect(screen.getByLabelText('Stat Card')).toBeChecked();
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
        fireEvent.click(screen.getByLabelText('Roster'));
        expect(screen.getByText('380 × 294 → 452 × 294')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(defs()[C]).toMatchObject({ members: ['statscard', 'roster'], width: 452, height: 294 });
        // Back on the container, with the new member selected.
        expect(screen.getByRole('option', { name: /Roster/ })).toHaveAttribute('aria-selected', 'true');
    });

    // Unticking takes a member off — and says first how many rules go with it.
    it('takes a member off, naming the rules it takes along', () => {
        useSettingsStore.setState({
            production: {
                container_defs: { [C]: { name: 'Card', width: 452, height: 294, members: ['statscard', 'roster'] } },
                automations: { r1: { kind: 'when', event: 'batter_up', member: 'statscard', container: C, until: 7 } },
            },
        });
        ui(<ContainersTab />);
        fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
        // The footer stands down while editing: the picker is the whole panel.
        expect(screen.queryByRole('button', { name: /Delete container/ })).not.toBeInTheDocument();
        fireEvent.click(screen.getByLabelText('Stat Card'));
        expect(screen.getByText('1 rule removed')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(defs()[C].members).toEqual(['roster']);
        expect(useSettingsStore.getState().production.automations.r1).toBeUndefined();
    });
});

/*
 * Deleting a definition takes its feed, its resting occupant and every rule on
 * it (`detach`/`dropRules` in ./containers) — a larger blast radius than the
 * match delete, which has always confirmed. Never one click.
 */
/*
 * A member wears a LOOK in a container the way a source does on its URL — here
 * it is on the definition, because a member has no URL of its own. Offered only
 * once the element has a look to choose.
 */
describe('member looks', () => {
    it('picks the selected member\'s look, and offers none until one exists', () => {
        ui(<ContainersTab />);
        expect(screen.queryByRole('combobox', { name: 'Stat Card look' })).not.toBeInTheDocument();
        cleanup();
        useSettingsStore.setState({ overlays: { statscard: { looks: { kb: { name: 'Break', values: {} } } } } });
        ui(<ContainersTab />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Stat Card look' }), { target: { value: 'kb' } });
        expect(defs()[C].looks).toEqual({ statscard: 'kb' });
    });
});

describe('delete', () => {
    it('confirms first, and the first click deletes nothing', () => {
        ui(<ContainersTab />);
        fireEvent.click(screen.getByRole('button', { name: /Delete container/ }));
        expect(defs()[C]).toBeTruthy();
        expect(screen.getByText(/deletes its rules/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(defs()[C]).toBeFalsy();
    });
});

describe('the source panel', () => {
    it('operates the container and sends authoring to the tab', () => {
        render(
            <MemoryRouter>
                <TooltipProvider>
                    <Routes>
                        <Route path="/" element={<ContainerStage element={{ id: `container:${C}`, container: C }} placement={{ container: C }} />} />
                        <Route path="/containers" element={<p>containers tab</p>} />
                    </Routes>
                </TooltipProvider>
            </MemoryRouter>,
        );
        // Nothing that defines the container is on its source's panel.
        expect(screen.queryByText('Roster')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Delete container/ })).not.toBeInTheDocument();
        expect(within(screen.getByText('Stat Card').closest('[data-member]'))
            .getByRole('button', { name: 'Show' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Edit in Containers/ }));
        expect(JSON.parse(localStorage.getItem(CONTAINER_TAB_KEY))).toBe(C);
        expect(screen.getByText('containers tab')).toBeInTheDocument();
    });
});
