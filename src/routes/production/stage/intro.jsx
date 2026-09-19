import { memo, useCallback } from 'react';
import { Text } from '../../../components/ui/primitives';
import { SegmentedControl } from '../../../components/ui/segmented-control';
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

/* Both halves of what the deleted "On show" heading carried: WHEN the
 * setting applies, and — the part no heading ever said — that it reaches the
 * OBS SOURCE, not the preview sitting under it. */
const INTRO_TITLE = 'On: OBS reloads this source each time it is shown, so the intro plays. '
    + 'Off: the source stays loaded and nothing animates.';

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
    /*
     * A TIGHT INLINE PAIR — the label against its own control, and no row of
     * its own. Three things were wrong with what this was, and they compound:
     *
     * THE SECTION. A `KIT_SECTION` headed "On show" wrapping one control: a
     * section heads a GROUP, and with one member the heading is a second name
     * for the row under it.
     *
     * THE CONTROL. A `ToggleRow`'s switch marks ON with `bg-primary`, so the
     * loudest thing on a panel of set-once knobs, in the colour the console
     * keeps for on-air and destructive, was a preference. A lone `ToggleChip`
     * was tried in between and is worse: a chip says its state by its FILL, and
     * an unfilled chip alone is a 1px `border-border` outline (measured
     * `rgb(26,26,46)` here) around muted text, indistinguishable from a caption.
     * Fill-as-state needs a STRIP — the filled siblings are what make the empty
     * ones read as empty. A segmented pair NAMES both states, so it is legible
     * with nothing beside it and spends no colour to do it.
     *
     * THE LABEL COLUMN. Every kit row puts its label in `KIT_LABEL`, which on a
     * panel-width `@container` is 128px — right when there is a COLUMN of rows
     * to line up, and wrong for a lone row, where "Intro animation" ends around
     * 85px and its control starts at 128 with dead space between them. Nothing
     * here is in a column, so the label just sits against what it names.
     *
     * The row this ends up on is the overrides section's footer (see
     * ./index.jsx): two panel-level set-once controls that each had a
     * near-empty row to themselves now share one.
     */
    return (
        <div className="flex min-w-0 items-center gap-2" title={INTRO_TITLE}>
            <Text size="xs" span truncate className="min-w-0 text-muted-foreground">
                Intro animation
            </Text>
            <SegmentedControl
                size="xs"
                className="shrink-0"
                value={disabled ? 'off' : 'on'}
                onChange={(v) => onChange(v === 'on')}
                data={[{ label: 'On', value: 'on' }, { label: 'Off', value: 'off' }]}
            />
        </div>
    );
});
