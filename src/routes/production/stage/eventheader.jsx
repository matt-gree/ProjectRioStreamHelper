import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../../context/store';
import { Text } from '../../../components/ui/primitives';
import { DirectStage } from './generic';
import { OverlaySettingRows, useOverlaySettings } from './overlay-settings';

/*
 * Event Header stage — the two persistent bands (top: competition · location ·
 * dates; bottom: message · event · phase · round).
 *
 * Both bands and each field inside them are switches the producer flips live,
 * so the console owns them; the geometry knobs (offsets, band width, font
 * scale, separator) are set once per event and stay in Setup.
 *
 * A field also drops out automatically when its source text is blank, which is
 * invisible from a switch alone — so the field rows carry the live value as
 * their meta, and a blank one says so.
 */

const BAND_KEYS = ['showHeader', 'showFooter'];
const BG_KEY = 'bgStyle';
const FIELD_KEYS = ['showEvent', 'showLocation', 'showDates', 'showMessage', 'showPhase', 'showRound'];
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

            <div className="mt-1 flex flex-col gap-1.5 border-t border-border/60 pt-2">
                <EventHeaderBandRows os={os} />
                <OverlaySettingRows os={os} type="eventheader" keys={[BG_KEY]} />
            </div>

            <div className="mt-1 flex flex-col gap-1.5 border-t border-border/60 pt-2">
                <Text size="xs" className="label-display text-muted-foreground">Fields</Text>
                <OverlaySettingRows os={os} type="eventheader" keys={FIELD_KEYS} />
            </div>

            <Text size="xs" className="border-t border-border/60 pt-2 text-muted-foreground">
                {empties.length > 0 && (
                    <>A field with nothing behind it stays hidden however it's switched —{' '}
                        {empties.map(f => f.label).join(', ')}{' '}
                        {empties.length === 1 ? 'is' : 'are'} blank in Competition → Tournament info.{' '}</>
                )}
                Band offsets, width, font scale and the separator are set in Setup → Layouts.
            </Text>
        </>
    );
}
