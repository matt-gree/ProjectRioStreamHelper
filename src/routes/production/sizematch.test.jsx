import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore } from '../../context/store';
import { useObsStore } from '../../context/obs';
import { commitPending, useStagingStore } from '../../context/staging';
import { Stage } from './stage';
import { withContainers } from '../../test/containers';

/*
 * Matching a per-side pair's OBS size, from the stage panel of one half.
 *
 * The rule under test is the one the row exists to keep: the panel resizes ITS
 * OWN source to the sibling's, and never the other way round.
 */

const item = (id, sourceName, url, enabled = false) =>
    ({ id, sourceName, url, enabled, inputKind: 'browser_source', isGroup: false, isPrsh: true });

const ROSTER = 'http://x/layout/scoreboard1/roster.html';
const LOGO = 'http://x/layout/scoreboard1/teamlogo.html';

const obs = (sceneItems, extra = {}) => useObsStore.setState({
    status: 'connected',
    programScene: Object.keys(sceneItems)[0] ?? null,
    scenes: Object.keys(sceneItems),
    mirroredScenes: Object.keys(sceneItems),
    sceneItems,
    ...extra,
});

let match;
beforeEach(() => {
    useSettingsStore.setState({ production: withContainers() });
    match = vi.fn(() => Promise.resolve({ width: 226, height: 70 }));
    useObsStore.setState({ matchSceneItemSize: match });
});
afterEach(() => {
    cleanup();
    useStagingStore.getState().discardAll();
    useObsStore.setState({
        status: 'disconnected', studioMode: false, programScene: null,
        previewScene: null, sceneItems: {}, scenes: [], mirroredScenes: [],
    });
});

const ui = (node) => render(<TooltipProvider>{node}</TooltipProvider>);

const pair = (scene = 'Game') => obs({
    [scene]: [
        item(1, 'Roster 1', `${ROSTER}?team=1`),
        item(2, 'Roster 2', `${ROSTER}?team=2`),
    ],
});

describe('matching a pair’s size', () => {
    it('offers the other side by name, and resizes only this panel’s source', () => {
        pair();
        ui(<Stage selection="roster~t1@Game" />);
        fireEvent.click(screen.getByRole('button', { name: /Match Side 2/ }));
        expect(match).toHaveBeenCalledWith({
            scene: 'Game', itemId: 1, modelScene: 'Game', modelItemId: 2,
        });
    });

    // Both halves get the row, which is what makes "push" one rack click away
    // without ever giving a panel a button that edits another panel's source.
    it('pulls the other way from the other half', () => {
        pair();
        ui(<Stage selection="roster~t2@Game" />);
        fireEvent.click(screen.getByRole('button', { name: /Match Side 1/ }));
        expect(match).toHaveBeenCalledWith({
            scene: 'Game', itemId: 2, modelScene: 'Game', modelItemId: 1,
        });
    });

    // The side vocabulary is a producer setting, and a control that names a side
    // has to say what every other console surface says.
    it('names the side in the producer’s vocabulary', () => {
        useSettingsStore.setState({ production: { ...withContainers(), side_labels: 'lr' } });
        pair();
        ui(<Stage selection="roster~t1@Game" />);
        expect(screen.getByRole('button', { name: /Match Right/ })).toBeInTheDocument();
    });

    /*
     * A pair is placed PER SCENE — side 1 and side 2 sit at their own sizes in
     * Game and at different ones in Break. Reaching across scenes would offer to
     * size a source against one the producer isn't looking at.
     */
    it('does not reach into another scene for the other side', () => {
        obs({
            Game: [item(1, 'Roster 1', `${ROSTER}?team=1`)],
            Break: [item(2, 'Roster 2', `${ROSTER}?team=2`)],
        });
        ui(<Stage selection="roster~t1@Game" />);
        expect(screen.queryByRole('button', { name: /Match/ })).not.toBeInTheDocument();
    });

    // The situation it serves is "both are placed". A single-sided element has
    // nothing to match, and a disabled button saying so would sit on every
    // Roster, Team Logo and Player Name panel in the console.
    it('renders nothing when only one side is placed', () => {
        obs({ Game: [item(1, 'Team Logo 1', `${LOGO}?team=1`)] });
        ui(<Stage selection="teamlogo~t1@Game" />);
        expect(screen.queryByRole('button', { name: /Match/ })).not.toBeInTheDocument();
    });

    // An element that doesn't come in sides never sees the row.
    it('renders nothing for an element with no side', () => {
        obs({ Game: [item(1, 'Lower Third', 'http://x/layout/lowerthird/lowerthird.html')] });
        ui(<Stage selection="lowerthird@Game" />);
        expect(screen.queryByRole('button', { name: /Match/ })).not.toBeInTheDocument();
    });

    /*
     * A resize reaches the broadcast, so confirm mode holds it like every other
     * OBS write on this page — and the read happens at COMMIT, so the producer
     * can keep nudging the model before going live.
     */
    it('stages under confirm mode and fires on commit', async () => {
        useSettingsStore.setState({
            production: { ...withContainers(), confirm: { enabled: true } },
        });
        pair();
        ui(<Stage selection="roster~t1@Game" />);
        fireEvent.click(screen.getByRole('button', { name: /Match Side 2/ }));
        expect(match).not.toHaveBeenCalled();
        expect(useStagingStore.getState().order).toEqual(['obs:size:Game:1']);
        await commitPending();
        expect(match).toHaveBeenCalledTimes(1);
    });
});
