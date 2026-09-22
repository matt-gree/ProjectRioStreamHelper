import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useSettingsStore } from '../../../context/store';
import { useObsStore } from '../../../context/obs';
import { IntroRow, introTypeFor } from './intro';

/*
 * The reveal-animation toggle, lifted from Setup onto the stage. It must (1)
 * render only for animated overlays, (2) store the preference under the layout
 * TYPE Setup used, and (3) rewrite already-added OBS sources in place.
 */

const el = (over = {}) => ({ id: 'scoreboard', url: '/layout/scoreboard1/scoreboard.html', ...over });

describe('introTypeFor — animated elements map to their layout type', () => {
    it('uses the element id where it matches the layout group', () => {
        expect(introTypeFor(el())).toBe('scoreboard');
        expect(introTypeFor(el({ id: 'lowerthird' }))).toBe('lowerthird');
    });

    // The one id≠type case: the Matchup History element is the `matchup` group.
    it('maps matchuphistory to the matchup layout type', () => {
        expect(introTypeFor(el({ id: 'matchuphistory' }))).toBe('matchup');
    });

    it('is null for a non-animated element, so IntroRow renders nothing', () => {
        expect(introTypeFor(el({ id: 'ticker' }))).toBe(null);
        expect(introTypeFor(el({ id: 'bracket' }))).toBe(null);
    });
});

describe('IntroRow', () => {
    const setLayoutIntroDisabled = vi.fn(() => Promise.resolve(1));

    beforeEach(() => {
        useSettingsStore.setState({ overlays: {} });
        useObsStore.setState({ setLayoutIntroDisabled });
        setLayoutIntroDisabled.mockClear();
    });
    afterEach(cleanup);

    const ui = (element) => render(
        <TooltipProvider><IntroRow element={element} /></TooltipProvider>,
    );

    it('renders nothing for a non-animated element', () => {
        const { container } = ui(el({ id: 'ticker' }));
        expect(container).toBeEmptyDOMElement();
    });

    it('turning intro off stores disableIntro under the layout type and rewrites OBS', async () => {
        ui(el());
        fireEvent.click(screen.getByRole('radio', { name: 'Off' })); // on -> off
        await waitFor(() => expect(setLayoutIntroDisabled).toHaveBeenCalledWith(
            '/layout/scoreboard1/scoreboard.html', true,
        ));
        expect(useSettingsStore.getState().overlays.scoreboard.disableIntro).toBe(true);
    });

    /*
     * A SEGMENTED PAIR, NOT A HEADED SECTION OF ONE SWITCH. Two things are
     * pinned here and they failed differently:
     *
     * the HEADING — a caps "On show" over a single row, a second name for the
     * only thing under it, on every animated element's panel; and
     *
     * the CONTROL — a switch marks ON with `bg-primary`, spending the console's
     * on-air colour on a preference, and a lone ToggleChip (tried in between)
     * marks OFF with a near-invisible outline that reads as a caption. Naming
     * both states is what makes this legible with no siblings beside it.
     */
    it('is a segmented pair, with no section heading over it', () => {
        ui(el());
        expect(screen.queryByText(/on show/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('switch')).not.toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'On' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByTitle(/reloads this source each time it is shown/)).toBeInTheDocument();
    });

    it('reads the stored preference — an off overlay shows the switch off', () => {
        useSettingsStore.setState({ overlays: { scoreboard: { disableIntro: true } } });
        ui(el());
        expect(screen.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
    });
});
