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
        fireEvent.click(screen.getByRole('switch')); // on -> off
        await waitFor(() => expect(setLayoutIntroDisabled).toHaveBeenCalledWith(
            '/layout/scoreboard1/scoreboard.html', true,
        ));
        expect(useSettingsStore.getState().overlays.scoreboard.disableIntro).toBe(true);
    });

    it('reads the stored preference — an off overlay shows the switch off', () => {
        useSettingsStore.setState({ overlays: { scoreboard: { disableIntro: true } } });
        ui(el());
        expect(screen.getByRole('switch')).not.toBeChecked();
    });
});
