import { memo } from 'react';
import { X } from 'lucide-react';
import { Text } from '../../../components/ui/primitives';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { cn } from '../../../lib/utils';
import { StateChip } from './StateChip';
import { InlineSubjects, useDebouncedText } from './rows';

/*
 * A PANEL WHOSE NAME IS AUTHORED IS RENAMED WHERE IT IS NAMED.
 *
 * The board desk had a `Name` field in the LAST region of its body — under the
 * game, the pool and the capture, four regions below the title it sets, on the
 * one surface that already prints that name in 15px semibold at the top. A
 * producer looking to rename a board looks at the name; asking them to scroll
 * past everything the board is doing to find a labelled text field is the
 * console's longest distance between a value and its control.
 *
 * Only a panel whose title is genuinely a STORED, producer-authored string may
 * pass `onRename` — a board's alias, and nothing else so far. Every other title
 * on the stage is derived (an element's name, its board, its size), and an
 * element panel whose title took typing would be offering to rename a thing
 * that has no name of its own.
 *
 * It looks like the title until you touch it: no frame at rest, a border on
 * hover, the input treatment on focus. A field drawn as a field here would put
 * a form control where the panel's entry point is and make every panel that
 * cannot be renamed look like it lost one.
 *
 * WIDTH IS THE CONTENT'S, and it is measured by the BROWSER. An input has no
 * intrinsic content width, so the alternative is a fixed box with dead space to
 * the right of a short name — the "field that has lost its value" shape
 * `TextRow`'s `short` exists to avoid. `field-sizing: content` is the one answer
 * that cannot drift: a `ch` estimate was tried and came up ~5px short of the
 * ink, because `ch` is the width of a ZERO and this title is Rajdhani caps on
 * 0.08em of tracking — two font facts, neither of which a number in this file
 * can keep up with. `size` is the fallback for a browser without it (an
 * approximate character count, which is what `size` has always meant), and the
 * min/max keep an empty field a target and a long name from pushing the subject
 * off the rule.
 *
 * Debounced like `TextRow` — a rename is a settings round-trip and every surface
 * reading the alias (the rack row, the rail card, this title) would otherwise
 * redraw on the keystroke. Enter blurs, which commits; Escape is deliberately
 * not a revert, because the commit has usually already landed by then and a
 * half-undo is worse than none.
 */
const PanelTitleField = memo(function PanelTitleField({ value, placeholder, onChange }) {
    const [draft, type, commit] = useDebouncedText(value, onChange, 300);
    const shown = draft ?? '';
    const chars = (shown || placeholder || '').length;
    return (
        <input
            type="text"
            aria-label="Name"
            value={shown}
            placeholder={placeholder}
            onChange={(e) => type(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            size={Math.min(24, Math.max(8, chars + 1))}
            className={cn(
                'label-display min-w-[5rem] max-w-[16rem] shrink [field-sizing:content]',
                'rounded border border-transparent bg-transparent',
                'px-1 py-0.5 text-[0.9375rem] font-semibold text-foreground',
                'hover:border-border focus:border-ring focus:bg-input/30 focus:outline-none',
                // THE PLACEHOLDER IS THE TITLE, AT TITLE STRENGTH. `Scoreboard 4`
                // is what the board is called until someone calls it something
                // else, so drawing it at placeholder grey would grey out the
                // panel's entry point on every board nobody has renamed — which
                // is most of them — for an implementation detail about where the
                // string is stored.
                'placeholder:text-foreground',
            )}
        />
    );
});

// Panel frame for stage panels (and desk bodies): header = chip · name ·
// subject · primary action · pin · close (where applicable); body; optional
// footer. `subject` is the live "what is this showing" line (../subject),
// carried in the header rather than as the body's first row — see below.
// `pinnable={false}` is the quickFace: null case — the pin affordance does
// not render at all, an intentional and visible state per the contract.
export const PanelShell = memo(function PanelShell({
    state, title, titlePlaceholder, onRename, subject, meta, primaryAction,
    pinnable = true, pinned = false, onPinToggle,
    onClose, footer, children, className,
}) {
    return (
        <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card', className)}>
            <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-2.5">
                <StateChip state={state} />
                {/* A third type step, for the one thing on the panel that says
                    WHAT the panel is. The whole stage ran on text-sm and
                    text-xs — two sizes for five levels — so the title carried
                    no more weight than the source name beside it or the rows
                    below it, and a panel with nothing louder than its own
                    contents has no entry point. One step (15px against the
                    body's 12px), not a headline: this is a dense work surface
                    and the controls are why anyone is here. */}
                {onRename ? (
                    <PanelTitleField
                        value={title} placeholder={titlePlaceholder} onChange={onRename}
                    />
                ) : (
                    <Text truncate className="label-display min-w-0 text-[0.9375rem] font-semibold text-foreground">
                        {title}
                    </Text>
                )}
                {/*
                  * THE SUBJECT SITS BESIDE THE TITLE, not above the body.
                  *
                  * What this panel is, what it is currently showing, and what it
                  * is bound to are one thought, and they were three stacked
                  * lines — a 15px title, then a 12px subject, then a 12px
                  * binding note, each in its own grey. The header runs 36px tall
                  * with most of its width empty, so the two facts a producer
                  * glances at fit on the row that already exists.
                  *
                  * The hairline is a SEPARATOR, not a dot: the title composes
                  * its own coordinates with "·" (SCOREBOARD · TEST · SMALL), so
                  * another one here would read as a fourth coordinate rather
                  * than the seam between identity and live state.
                  */}
                {subject ? (
                    <>
                        <span aria-hidden className="h-3.5 w-px shrink-0 bg-border" />
                        <div className="min-w-0 flex-1"><InlineSubjects>{subject}</InlineSubjects></div>
                    </>
                ) : <div className="min-w-0 flex-1" />}
                {meta != null && <Text size="xs" span truncate dimmed className="min-w-0">{meta}</Text>}
                {primaryAction}
                {pinnable && (
                    <SimpleTooltip label={pinned ? 'Unpin from quick rail' : 'Pin to quick rail'}>
                        <button
                            type="button"
                            onClick={onPinToggle}
                            aria-pressed={pinned}
                            aria-label={pinned ? 'Unpin from quick rail' : 'Pin to quick rail'}
                            className={cn(
                                'shrink-0 text-sm leading-none transition-colors',
                                pinned ? 'text-rio-400' : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {pinned ? '◆' : '◇'}
                        </button>
                    </SimpleTooltip>
                )}
                {onClose && (
                    <button
                        type="button" onClick={onClose} aria-label="Close"
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                        <X size={14} />
                    </button>
                )}
            </header>
            {/* @container: stage bodies lay themselves out against the PANEL's
                width, not the viewport's. The same body is a single column on
                a rail-width card and a multi-column spread on a wide stage,
                without either surface knowing the page's breakpoints. */}
            <div className="@container flex min-h-0 flex-col gap-1.5 p-2.5">{children}</div>
            {footer && <footer className="border-t border-border/60 px-2.5 py-1.5">{footer}</footer>}
        </section>
    );
});
