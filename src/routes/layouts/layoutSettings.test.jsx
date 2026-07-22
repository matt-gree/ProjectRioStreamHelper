import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore } from '../../context/store';
import { LayoutSettingsPanel } from './layoutSettings';

beforeEach(() => {
    useSettingsStore.setState({ overlays: {} });
});
afterEach(() => cleanup());

const ui = (props) =>
    render(<TooltipProvider><LayoutSettingsPanel {...props} /></TooltipProvider>);

// The board-scoped elements (scorecard, scoreboard) store settings per board so
// two sources on different boards stay independent; the team-variant types that
// ride the same Setup "scoreboard" mode (roster, stats) share one global leaf.
// These pin that split — flip it and two boards silently share a scoreboard's
// look, or a roster invents a per-board setting nobody reads.
describe('LayoutSettingsPanel per-board writes', () => {
    it('writes the scoreboard per board when a board tab is selected', () => {
        ui({ layoutType: 'scoreboard', scoreboardId: '2' });
        fireEvent.click(screen.getByText('Show ELO'));
        expect(useSettingsStore.getState()?.overlays?.scoreboard?.[2]?.showElo).toBe(false);
        // Board 1 is untouched — the whole point of per-board.
        expect(useSettingsStore.getState()?.overlays?.scoreboard?.[1]).toBeUndefined();
        // And no legacy global leaf is written.
        expect(useSettingsStore.getState()?.overlays?.scoreboard?.showElo).toBeUndefined();
    });

    it('reads a legacy global leaf as the fallback until the board overrides it', () => {
        useSettingsStore.setState({ overlays: { scoreboard: { showElo: false } } });
        ui({ layoutType: 'scoreboard', scoreboardId: '2' });
        // The switch reflects the global (false) since board 2 has no override yet.
        const eloSwitch = screen.getByText('Show ELO').closest('label').querySelector('button[role="switch"]');
        expect(eloSwitch.getAttribute('aria-checked')).toBe('false');
    });

    it('keeps a team-variant type in the same mode global (not per board)', () => {
        ui({ layoutType: 'roster', scoreboardId: '2' });
        fireEvent.click(screen.getByText('Show Team Logo'));
        expect(useSettingsStore.getState()?.overlays?.roster?.showTeamLogo).toBe(false);
        expect(useSettingsStore.getState()?.overlays?.roster?.[2]).toBeUndefined();
    });
});
