// Control metrics for the production console kit. One rhythm: a 28px (h-7)
// control row — every kit row is min-h-7 and every control inside sizes to it.
//
// KIT_INPUT is the console-standard compact input. KIT_FIELD (32px, desk
// forms) and KIT_INPUT_FLOW (content-height, the lower-third editors) are the
// two legacy shapes still referenced by pre-console faces in production.jsx;
// they collapse into KIT_INPUT as those faces migrate to stage bodies
// (production-console-plan slices 4–5).

export const KIT_INPUT = 'h-7 w-full rounded-md border border-border bg-card px-2 text-xs text-foreground';

/*
 * A NUMBER FIELD ON TOP OF THAT — the spinners OFF, the figures tabular.
 *
 * Native `type="number"` arrows are a click target sitting inside a field whose
 * value goes to air, and they hit whenever a producer double- or triple-clicks
 * to select what is in the box: a triple-click on the rotation interval took it
 * from 30 to 28 before anything was typed. They are also 16px of chrome inside a
 * 28px control, so the number they decorate has less room than the arrows do.
 * `NumberInput` (../../../components/ui/number-input) has always dropped them;
 * this is the kit saying the same thing, so a console number field looks and
 * behaves the same wherever it is drawn.
 *
 * `tabular-nums` for the reason every changing value in this console carries it:
 * proportional digits reflow the field as the number ticks.
 */
export const KIT_NUMBER = '[appearance:textfield] tabular-nums '
    + '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

/*
 * The label column beside a field. 64px is right on a 252px rail card and a
 * 278px rack row — and it was the ONLY width, so on the stage, where a panel is
 * three or four times that, the same column clipped "Bottom Offset" to
 * "Bottom O…" while ~800px sat empty to the right of the input. The container
 * query measures the PANEL (PanelShell's body is the `@container`), so the
 * narrow surfaces, which are not containers at all, never match it and keep 64.
 */
export const KIT_LABEL = 'w-16 shrink-0 @lg:w-32';
export const KIT_INPUT_FLOW = 'w-full rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground';
export const KIT_FIELD = 'h-8 rounded-md border border-border bg-card px-2 text-sm text-foreground';

/*
 * A STAGE-PANEL SECTION. Seven files had this string typed out, which is how a
 * body ends up with six sections ruled one way and a seventh ruled another.
 *
 * The `first:` resets are the rule the copies all got wrong: a divider
 * SEPARATES SIBLINGS, and the first section has nothing above it to be
 * separated from — so its rule landed a few pixels under the panel header's
 * own, with a dead strip between the two that reads as an empty section. It
 * only became visible once the body stopped opening with a subject row, which
 * is the giveaway that the rule was never the section's to draw.
 */
export const KIT_SECTION = 'mt-1 flex flex-col gap-1.5 border-t border-border/60 pt-2 '
    + 'first:mt-0 first:border-t-0 first:pt-0';
