import { memo, useCallback } from 'react';
import { Text } from '../../../components/ui/primitives';
import { ToggleRow } from '../kit';
import { useSettingsStore } from '../../../context/store';
import { useObsStore } from '../../../context/obs';
import { notifications } from '../../../lib/notify';

/*
 * The reveal-animation toggle — an OBS *source behaviour* the producer sets per
 * layout, lifted out of Setup onto the stage.
 *
 * An animated PRSH overlay plays an intro on show. That only reads cleanly if
 * OBS reloads the browser source on every show (shutdown=true), so the reveal
 * starts from a blank frame instead of a retained full-alpha texture (the
 * eye-toggle stutter). Turning the intro OFF flips that: the source stays
 * resident (shutdown=false) and nothing animates — what a persistent always-on
 * overlay wants. obs.jsx (`desiredShutdown`) reconciles the OBS property from
 * the URL's `?intro=` param; this toggle owns the preference and the rewrite.
 *
 * The preference is stored under the layout TYPE (overlays.{type}.disableIntro),
 * the same key Setup wrote — so a preference set before this moved still reads
 * here. Type tracks the layout filename group, which is the element id for all
 * of these except Matchup History, whose layout group is `matchup`.
 *
 * Not staged: unlike a content change, this rewrites OBS source configuration
 * (URL + shutdown) imperatively via setLayoutIntroDisabled, which the staging
 * gateway can't defer as a single unit. Keeping the preference write and the
 * OBS rewrite atomic and immediate — the same way the Add picker adds a source
 * now — is more honest than staging only half of the pair.
 */
export const ANIMATED_ELEMENT_TYPES = {
    scoreboard: 'scoreboard',
    scorecard: 'scorecard',
    lowerthird: 'lowerthird',
    commentary: 'commentary',
    playerplates: 'playerplates',
    hitvisualizer: 'hitvisualizer',
    matchuphistory: 'matchup',
};

export const introTypeFor = (element) => ANIMATED_ELEMENT_TYPES[element?.id] ?? null;

export const IntroRow = memo(function IntroRow({ element }) {
    const type = introTypeFor(element);
    const disabled = useSettingsStore(s => !!(type && s?.overlays?.[type]?.disableIntro));
    const setItem = useSettingsStore(s => s.setItem);

    const onChange = useCallback(async (animOn) => {
        if (!type || !element?.url) return;
        const off = !animOn;
        setItem(`overlays.${type}.disableIntro`, off);
        // element.url is a query-less layout path already, so it IS the pathname
        // setLayoutIntroDisabled matches every size/team/board variant against.
        try {
            const path = new URL(element.url, window.location.origin).pathname;
            const n = await useObsStore.getState().setLayoutIntroDisabled(path, off);
            if (n) notifications.show({
                message: `Intro animation ${off ? 'off' : 'on'} — updated ${n} OBS source${n > 1 ? 's' : ''}`,
                color: 'green',
            });
        } catch { /* OBS offline or source gone — the preference still persists */ }
    }, [type, element?.url, setItem]);

    if (!type) return null;
    return (
        <div className="mt-1 flex flex-col gap-1.5 border-t border-border/60 pt-2">
            <Text size="xs" className="label-display text-muted-foreground">On show</Text>
            <ToggleRow label="Intro animation" checked={!disabled} onChange={onChange} />
            <Text size="xs" className="text-muted-foreground">
                {disabled
                    ? 'Off — the source stays resident in OBS (no reload on show).'
                    : 'On — the source reloads on show for a clean reveal from a blank frame.'}
            </Text>
        </div>
    );
});
