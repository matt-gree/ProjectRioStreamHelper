import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../../context/store';
import { Text } from '../../../components/ui/primitives';
import { LAYOUT_SETTINGS } from '../../layouts/designConstants';
import { DirectStage } from './generic';
import { OverlaySettingGroups, OverlaySettingRows, useOverlaySettings } from './overlay-settings';

/*
 * Event Header stage — the two persistent bands (top: competition · location ·
 * dates; bottom: message · event · phase · round).
 *
 * The panel is laid out as the OVERLAY is: top band, bottom band, then what
 * applies to both. Every one of its fourteen settings renders here, grouped by
 * the strip it changes (`group` in LAYOUT_SETTINGS.eventheader), so nothing
 * falls through to the stage's catch-all Style section.
 *
 * It used to be three sections sorted by control kind — bands, then fields, then
 * the numbers in Style — which put a band's own offset five rows below the
 * switch that turns that band on, and split the six field switches away from the
 * strip each one appears in. Both are the same mistake: grouping by what a
 * control IS rather than by what it CHANGES.
 *
 * A field also drops out automatically when its source text is blank, which is
 * invisible from a switch alone — the note at the foot says which.
 */

const BAND_KEYS = ['showHeader', 'showFooter'];
// Fields fed purely from tournamentInfo, so "on but blank" is knowable here.
// Phase and Round are deliberately absent: both fall back to the bound match,
// which this panel can't resolve without knowing the board.
const PREVIEWABLE = [
    { label: 'event name', from: 'name' },
    { label: 'location', from: 'location' },
    { label: 'dates', from: 'date' },
    { label: 'message', from: 'message' },
];

export function useEventHeader() {
    return useOverlaySettings('eventheader', 'eventheader', 'Event header');
}

// The bands' on/off pair — also the rail quick face.
export const EventHeaderBandRows = memo(function EventHeaderBandRows({ os }) {
    return <OverlaySettingRows os={os} type="eventheader" keys={BAND_KEYS} />;
});

export default function EventHeaderStage({ element }) {
    const os = useEventHeader();
    const info = useStateStore(useShallow(s => s?.tournamentInfo ?? {}));
    const empties = PREVIEWABLE.filter(f => !String(info?.[f.from] ?? '').trim());

    return (
        <>
            <DirectStage element={element} />

            <div className="mt-1 border-t border-border/60 pt-2">
                <OverlaySettingGroups os={os} type="eventheader" />
            </div>

            {empties.length > 0 && (
                <Text size="xs" className="border-t border-border/60 pt-2 text-muted-foreground">
                    A field with nothing behind it stays hidden however it's switched —{' '}
                    {empties.map(f => f.label).join(', ')}{' '}
                    {empties.length === 1 ? 'is' : 'are'} blank in Competition → Tournament info.
                </Text>
            )}
        </>
    );
}

// Everything, so the Style section renders nothing. A catch-all is for settings
// a body chose not to lead with; this body's grouping IS the whole panel, and a
// "Style" heading under it would be a fourth region the overlay does not have.
EventHeaderStage.surfacedKeys = LAYOUT_SETTINGS.eventheader.map(d => d.key);
