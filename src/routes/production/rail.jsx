import { memo, useMemo, useState } from 'react';
import { Panel } from '../../components/ui/panel';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Text } from '../../components/ui/primitives';
import { cn } from '../../lib/utils';
import { isPinnable } from './elements';
import { MoveButtons } from './controls';
import { QuickCard, chipFor } from './kit';
import {
    resolvePlacement, useConsolePlacements, useConsoleScenes, usePlacementLabel,
} from './placements';
import { deskQuickFace, QuickFace } from './quickface';
import { boardOfDeskId, useActiveBoards, useBoardLabel } from './boards';

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
const ElementRailCard = memo(function ElementRailCard({
    placement, title, onOpen, onUnpin, move,
}) {
    const { element, board } = placement;
    return (
        <QuickCard
            state={chipFor(placement)} title={title}
            onOpen={onOpen} onUnpin={onUnpin} move={move}
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
        const placement = resolvePlacement(id, placements);
        if (!placement || !isPinnable(placement.element)) return null;
        const { name, detail } = label(placement);
        return { id, placement, title: detail ? `${name} · ${detail}` : name };
    }).filter(Boolean), [pins, placements, label, boardLabel, active]);

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

    return (
        <Panel title="Quick rail" className="h-full">
            <ScrollArea className="h-[calc(100vh-13rem)]">
                <div className="flex flex-col gap-2 p-2">
                    {entries.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border p-3">
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
                            className={cn('cursor-grab', dragging === entry.id && 'opacity-50')}
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
