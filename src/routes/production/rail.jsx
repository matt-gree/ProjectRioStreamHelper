import { memo, useMemo, useState } from 'react';
import { Panel } from '../../components/ui/panel';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Text } from '../../components/ui/primitives';
import { cn } from '../../lib/utils';
import { isPinnable } from './elements';
import { MoveButtons } from './controls';
import { QuickCard, chipFor } from './kit';
import {
    resolvePlacement, useConsoleOffline, useConsolePlacements, useConsoleScenes,
    usePlacementLabel,
} from './sources/placements';
import { EyeAction } from './rack';
import { deskQuickFace, QuickFace } from './quickface';
import { boardOfDeskId, useActiveBoards, useBoardLabel } from './board/boards';
import { useContainerDefs } from './containers/containers';

/*
 * The quick rail — the console's right surface: the producer's own set of
 * cards for flying the broadcast (production-console-contract skill).
 *
 * Rules it must not break:
 *   - Membership is opt-in (pin ◆ in the rack or on the stage header).
 *   - Order is the producer's, kept verbatim: the rail NEVER auto-reorders,
 *     never re-sorts by state, never changes with the phase. A card's position
 *     is muscle memory mid-broadcast.
 *   - Each card is a header + the element's quick face, capped at two rows by
 *     QuickCard itself.
 *
 * Reordering is ▲/▼ buttons (the kit's MoveButtons, exactly as the list rows use
 * elsewhere), with pointer drag as an accelerator on top. The buttons are the
 * REAL control, not a fallback: HTML5 drag needs a mouse — it does not fire from
 * a keyboard, and it does not fire on touch at all — and this page is also
 * driven from a tablet at the venue. This file claimed the buttons for a long
 * time without having them, which left the one surface built for flying the
 * broadcast reorderable only by mouse.
 *
 * Both paths move a card past its VISIBLE neighbour and reorder `pins` by id.
 * They must not use the rendered index: `entries` drops pins that no longer
 * resolve, so one dead pin desynchronises entry indices from `pins` and an
 * index-based move reorders a different card than the producer pressed.
 */

/*
 * Board AND scene come from the PIN (../placements), so a card's chip, its
 * quick face and the rack row it was pinned from are the same placement by
 * construction. The Scorecard face is board-aware (it drives
 * overlays.scorecard.{N}.*) — a chip resolved at board 1 beside a face editing
 * board 2 would be one card disagreeing with itself, and the same is now true
 * of a card flying the Game scene's copy while showing the Break scene's state.
 */
/*
 * The header's control: the eye for the source this card flies. On a member's
 * SLOT that source is the CONTAINER's (a fed placement is its container's
 * source), so the eye shows and hides the container — what the switch row on
 * those cards did — while the face keeps the Push that is the slot's own verb.
 *
 * A sourceless card with OBS connected says so in the eye's place, because the
 * missing eye is otherwise the only sign; with OBS closed every card is
 * sourceless and the app's own banner has said it once already.
 */
const CardAction = memo(function CardAction({ placement }) {
    const offline = useConsoleOffline();
    if (placement.item) return <EyeAction placement={placement} namesScene />;
    if (offline) return null;
    return (
        <Text
            size="xs" span title="Not in any scene we can see."
            className="label-display shrink-0 text-muted-foreground"
        >
            NO SOURCE
        </Text>
    );
});

const ElementRailCard = memo(function ElementRailCard({
    placement, title, onOpen, onUnpin, move,
}) {
    const { element, board } = placement;
    return (
        <QuickCard
            state={chipFor(placement)} title={title}
            onOpen={onOpen} onUnpin={onUnpin} move={move}
            action={<CardAction placement={placement} />}
        >
            <QuickFace element={element} placement={placement} board={board} />
        </QuickCard>
    );
});

const RailCard = memo(function RailCard({ entry, onOpen, onUnpin, move }) {
    const DeskFace = deskQuickFace(entry.id);
    if (DeskFace) {
        return (
            <QuickCard
                state="desk" title={entry.title} onOpen={onOpen} onUnpin={onUnpin}
                move={move}
            >
                {/* Every desk face takes the id: a board's carries its board,
                    which is what lets one component serve every board. */}
                <DeskFace id={entry.id} />
            </QuickCard>
        );
    }
    return (
        <ElementRailCard
            placement={entry.placement} title={entry.title}
            onOpen={onOpen} onUnpin={onUnpin} move={move}
        />
    );
});

// Fixed desks with a rail-sized face. Empty today: Match is the only fixed
// desk and its authoring cannot compress to two rows, so every pinnable desk
// card is now a BOARD (titled from its alias, below).
const DESK_TITLES = {};

export const Rail = memo(function Rail({ pins, onReorder, onUnpin, onOpen }) {
    const scenes = useConsoleScenes();
    const placements = useConsolePlacements(scenes);
    const label = usePlacementLabel(placements);
    // A board desk's title is its alias, so a renamed board is renamed on the
    // rail too — a static title map cannot answer for a row the rig defines.
    const boardLabel = useBoardLabel();
    const active = useActiveBoards();
    // So a pinned container keeps its card when its source goes — resolution
    // synthesises the row from the definition (../placements).
    const defs = useContainerDefs();
    const [dragging, setDragging] = useState(null);

    // A pin is kept under the id it is STORED as (that's what reorder and unpin
    // act on) but rendered from the placement it currently resolves to — which
    // is how a pin written before scenes were the axis, or against a board or
    // scene since removed, still draws a working card. Pins naming a source that
    // no longer exists anywhere resolve to nothing and drop out.
    const entries = useMemo(() => pins.map((id) => {
        // A pin outlives the board it was made against, so a removed board's
        // card drops out exactly as a placement that no longer resolves does —
        // resolved at read time, never rewritten (the stored pin stays
        // removable).
        const sb = boardOfDeskId(id);
        if (sb != null) return active.includes(sb) ? { id, title: boardLabel(sb) } : null;
        if (deskQuickFace(id)) return { id, title: DESK_TITLES[id] ?? id };
        const placement = resolvePlacement(id, placements, defs);
        if (!placement || !isPinnable(placement.element)) return null;
        const { name, detail } = label(placement);
        return { id, placement, title: detail ? `${name} · ${detail}` : name };
    }).filter(Boolean), [pins, placements, label, boardLabel, active, defs]);

    // Reorder by pin ID. `pins` holds every stored pin; `entries` holds only the
    // ones that still resolve, so the two index differently the moment a pin goes
    // stale — see the note at the top of this file.
    const moveToId = (fromId, toId) => {
        const from = pins.indexOf(fromId);
        const to = pins.indexOf(toId);
        if (from < 0 || to < 0 || from === to) return;
        const next = pins.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        onReorder(next);
    };

    // Step a card past its visible neighbour — what the producer sees, rather
    // than past a stale pin that draws no card.
    const moveBy = (i, delta) => {
        const target = entries[i + delta];
        if (target) moveToId(entries[i].id, target.id);
    };

    /*
     * A SIDE COLUMN IS THE VIEWPORT'S, NOT THE ROW'S.
     *
     * The rack and the rail are both a fixed-height scroll box, and the height they
     * were given — `100vh - 13rem` — was reaching for a column that is always as
     * tall as the screen. Nothing ever pinned it there, so it was a viewport-sized
     * box anchored to the TOP OF THE DOCUMENT, inside a `h-full` panel stretched to
     * the grid ROW. Two different wrongs at once, and a tall stage shows both: the
     * panel's box ran the full 1397px of the row while its list stopped at 492,
     * leaving ~900px of empty card under it, and the whole column scrolled away
     * while the producer worked in the stage — so the rack, which is how you get to
     * anything, was off screen exactly when the panel you scrolled to see was on it.
     *
     * `sticky` is the missing half. The column now holds the space actually
     * BELOW it — `--console-h`, measured and published by the page, because a
     * sticky box is still in flow and a `100vh` one forces the whole document
     * taller than the window (see the long note in ../rack). Its list fills that
     * (`flex-1` over the panel's own height, never a second copy of that
     * arithmetic), and it stays put while the middle column scrolls under it.
     * `items-start` on the grid is what leaves it free to.
     *
     * ONLY WHILE IT IS ACTUALLY A SIDE COLUMN. Below the breakpoint that gives it
     * one, the grid is a single column and these are stacked blocks — a sticky
     * viewport-tall block there would pin one section over the whole screen and let
     * the rest slide under it. So the rack takes this at `lg` (where it first earns
     * a column) and the rail at `xl` (where it does), each matching the track it
     * appears in; stacked, both keep the old fixed box.
     *
     * BETWEEN `lg` AND `xl` THE RAIL SITS UNDER THE STAGE (column 2), never under
     * the rack: the rack is a sticky column there and would slide over anything
     * placed beneath it in its own column (../rack). It is a stacked block in
     * that range, so it sizes to its cards rather than holding a viewport-tall
     * box, and the cards flow in rail-width columns across the stage's width —
     * one 250px card stretched to a 900px track is a strip of empty chips.
     * Reading order is still pin order, so the producer's order survives.
     */
    return (
        <Panel
            title="Quick rail"
            className={cn(
                'flex flex-col h-[calc(100vh-13rem)]',
                'lg:col-start-2 lg:h-auto',
                'xl:col-start-3 xl:sticky xl:top-4 xl:h-[var(--console-h)]',
            )}
        >
            <ScrollArea className="min-h-0 flex-1">
                <div className={cn(
                    'flex flex-col gap-2 p-2',
                    'lg:grid lg:grid-cols-[repeat(auto-fill,minmax(236px,1fr))] lg:items-start',
                    // Back to a column at xl — and back to STRETCH: the grid's
                    // items-start otherwise survives into the column, and a
                    // card then sizes to its longest line (a hit's subject ran
                    // one to 314px in a 252px rail).
                    'xl:flex xl:items-stretch',
                )}
                >
                    {entries.length === 0 ? (
                        <div className="col-span-full rounded-lg border border-dashed border-border p-3">
                            <Text size="xs" className="text-muted-foreground">
                                Nothing pinned. Hit ◇ on any rack row — or on a stage panel’s header —
                                to keep its live controls here, in your own order, whatever scene
                                you’re working in.
                            </Text>
                        </div>
                    ) : entries.map((entry, i) => (
                        <div
                            key={entry.id}
                            draggable
                            onDragStart={() => setDragging(entry.id)}
                            onDragEnd={() => setDragging(null)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault();
                                if (dragging != null) moveToId(dragging, entry.id);
                                setDragging(null);
                            }}
                            // min-w-0: a grid item (the lg layout) otherwise holds its
                            // track open to its longest unbroken line.
                            className={cn('min-w-0 cursor-grab', dragging === entry.id && 'opacity-50')}
                        >
                            <RailCard
                                entry={entry}
                                onOpen={() => onOpen(entry.id)}
                                onUnpin={() => onUnpin(entry.id)}
                                move={(
                                    <MoveButtons
                                        canUp={i > 0} canDown={i < entries.length - 1}
                                        onUp={() => moveBy(i, -1)} onDown={() => moveBy(i, 1)}
                                        label={entry.title}
                                    />
                                )}
                            />
                        </div>
                    ))}
                </div>
            </ScrollArea>
        </Panel>
    );
});
