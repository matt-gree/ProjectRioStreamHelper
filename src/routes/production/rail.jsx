import { memo, useMemo, useState } from 'react';
import { Panel } from '../../components/ui/panel';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Text } from '../../components/ui/primitives';
import { cn } from '../../lib/utils';
import { isPinnable } from './elements';
import { QuickCard, chipFor } from './kit';
import {
    resolvePlacement, useConsolePlacements, useConsoleScenes, usePlacementLabel,
} from './placements';
import { DESK_QUICK_FACES, QuickFace } from './quickface';

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
 * Drag ordering is pointer-based (HTML5 drag) with the ▲/▼ fallback that the
 * list rows use elsewhere, since the page is also driven from a tablet.
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
    placement, title, onOpen, onUnpin, drag,
}) {
    const { element, board } = placement;
    return (
        <QuickCard
            state={chipFor(placement)} title={title}
            onOpen={onOpen} onUnpin={onUnpin} dragHandleProps={drag}
        >
            <QuickFace element={element} placement={placement} board={board} />
        </QuickCard>
    );
});

const RailCard = memo(function RailCard({ entry, onOpen, onUnpin, drag }) {
    const DeskFace = DESK_QUICK_FACES[entry.id];
    if (DeskFace) {
        return (
            <QuickCard
                state="desk" title={entry.title} onOpen={onOpen} onUnpin={onUnpin}
                dragHandleProps={drag}
            >
                <DeskFace />
            </QuickCard>
        );
    }
    return (
        <ElementRailCard
            placement={entry.placement} title={entry.title}
            onOpen={onOpen} onUnpin={onUnpin} drag={drag}
        />
    );
});

const DESK_TITLES = { 'desk:capture': 'Capture', 'desk:bracket': 'Bracket' };

export const Rail = memo(function Rail({ pins, onReorder, onUnpin, onOpen }) {
    const scenes = useConsoleScenes();
    const placements = useConsolePlacements(scenes);
    const label = usePlacementLabel(placements);
    const [dragging, setDragging] = useState(null);

    // A pin is kept under the id it is STORED as (that's what reorder and unpin
    // act on) but rendered from the placement it currently resolves to — which
    // is how a pin written before scenes were the axis, or against a board or
    // scene since removed, still draws a working card. Pins naming a source that
    // no longer exists anywhere resolve to nothing and drop out.
    const entries = useMemo(() => pins.map((id) => {
        if (DESK_QUICK_FACES[id]) return { id, title: DESK_TITLES[id] ?? id };
        const placement = resolvePlacement(id, placements);
        if (!placement || !isPinnable(placement.element)) return null;
        const { name, detail } = label(placement);
        return { id, placement, title: detail ? `${name} · ${detail}` : name };
    }).filter(Boolean), [pins, placements, label]);

    const moveTo = (from, to) => {
        if (from === to || from < 0 || to < 0 || from >= pins.length || to >= pins.length) return;
        const next = pins.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        onReorder(next);
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
                            onDragStart={() => setDragging(i)}
                            onDragEnd={() => setDragging(null)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault();
                                if (dragging != null) moveTo(dragging, i);
                                setDragging(null);
                            }}
                            className={cn('cursor-grab', dragging === i && 'opacity-50')}
                        >
                            <RailCard
                                entry={entry}
                                onOpen={() => onOpen(entry.id)}
                                onUnpin={() => onUnpin(entry.id)}
                            />
                        </div>
                    ))}
                </div>
            </ScrollArea>
        </Panel>
    );
});
