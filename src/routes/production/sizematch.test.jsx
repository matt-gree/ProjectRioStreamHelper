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
const CTRL = 'http://x/layout/controller/controller.html';
const PLAYERNAME = 'http://x/layout/scoreboard1/playername.html';

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
        expect(match).toHaveBeenCalledWith(expect.objectContaining({
            scene: 'Game', itemId: 1, modelScene: 'Game', modelItemId: 2,
        }));
    });

    // Both halves get the row, which is what makes "push" one rack click away
    // without ever giving a panel a button that edits another panel's source.
    it('pulls the other way from the other half', () => {
        pair();
        ui(<Stage selection="roster~t2@Game" />);
        fireEvent.click(screen.getByRole('button', { name: /Match Side 1/ }));
        expect(match).toHaveBeenCalledWith(expect.objectContaining({
            scene: 'Game', itemId: 2, modelScene: 'Game', modelItemId: 1,
        }));
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
     * THE CONTROLLER, which is a per-side pair like any other and gets the row
     * like any other — its ?team=1|2 follow sources are exactly the shape the
     * roster's are.
     */
    it('offers it to a controller pair', () => {
        obs({ Game: [item(1, 'Ctrl 1', `${CTRL}?team=1`), item(2, 'Ctrl 2', `${CTRL}?team=2`)] });
        ui(<Stage selection="controller~t1@Game" />);
        fireEvent.click(screen.getByRole('button', { name: /Match Side 2/ }));
        expect(match).toHaveBeenCalledWith(expect.objectContaining({
            scene: 'Game', itemId: 1, modelScene: 'Game', modelItemId: 2,
            // Fits its artwork to whatever viewport it is handed, so the drawn
            // size is the whole answer and its global input is left alone.
            matchRender: false,
        }));
    });

    /*
     * ...INCLUDING a pair that pins its ports, which is the case the controller
     * alone can be in. `?port=` names which physical pad a source reads
     * (the documented override in controller.html), and the two halves of a pair
     * are on different pads BY DEFINITION — so a flip that carried the port
     * through asked this pair to be something no pair can be, and the Controller
     * was the one per-side element whose panel offered nothing.
     */
    it('offers it to a pair that has pinned DIFFERENT ports', () => {
        obs({ Game: [
            item(1, 'Ctrl 1', `${CTRL}?team=1&port=1`),
            item(2, 'Ctrl 2', `${CTRL}?team=2&port=3`),
        ] });
        ui(<Stage selection="controller~t1.p1@Game" />);
        fireEvent.click(screen.getByRole('button', { name: /Match Side 2/ }));
        expect(match).toHaveBeenCalledWith(expect.objectContaining({
            scene: 'Game', itemId: 1, modelScene: 'Game', modelItemId: 2,
        }));
    });

    /*
     * But a port with NO side names no side. Two port-addressed sources are not
     * a pair the console can identify — a rig could have all four on screen —
     * and this row is never worth a guess about which one the producer meant.
     */
    it('renders nothing for port-only sources, which name no side', () => {
        obs({ Game: [item(1, 'Ctrl A', `${CTRL}?port=1`), item(2, 'Ctrl B', `${CTRL}?port=3`)] });
        ui(<Stage selection="controller~p1@Game" />);
        expect(screen.queryByRole('button', { name: /Match/ })).not.toBeInTheDocument();
    });

    /*
     * THE PLAYER NAME ASKS FOR BOTH SIZES.
     *
     * It is the one element that draws its type at a number of pixels the
     * producer typed, so the source's own RESOLUTION decides the name and the
     * item's transform only scales the result. Matching the transform alone put
     * this pair's boxes on each other and its names 18px apart — the arithmetic
     * is measured in ../../lib/obs-transform.test.js; this is the panel asking
     * for it, off the one `isScaleSensitive` list the rack's amber badge reads.
     *
     * `sourceName` travels with it because an OBS input is GLOBAL: the same
     * source in another scene has to be re-solved to keep the size it has.
     */
    it('matches the render resolution too, on the element drawn at an absolute size', () => {
        obs({ Game: [
            item(1, 'Name 1', `${PLAYERNAME}?scoreboard=1&team=1`),
            item(2, 'Name 2', `${PLAYERNAME}?scoreboard=1&team=2`),
        ] });
        ui(<Stage selection="playername~t1@Game" />);
        fireEvent.click(screen.getByRole('button', { name: /Match Side 2/ }));
        expect(match).toHaveBeenCalledWith(expect.objectContaining({
            scene: 'Game', itemId: 1, modelScene: 'Game', modelItemId: 2,
            matchRender: true, sourceName: 'Name 1',
        }));
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
