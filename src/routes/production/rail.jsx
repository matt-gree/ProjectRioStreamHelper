import { memo, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../context/store';
import { Panel } from '../../components/ui/panel';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Text } from '../../components/ui/primitives';
import { cn } from '../../lib/utils';
import { ELEMENTS, isPinnable } from './elements';
import { QuickCard, chipState } from './kit';
import { elementBindings, useBindingScenes } from './bindings';
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

const RailCard = memo(function RailCard({
    entry, scenes, overrides, onOpen, onUnpin, drag,
}) {
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
    const bindings = elementBindings(entry.element, scenes, overrides[entry.id]);
    return (
        <QuickCard
            state={chipState(bindings)} bindings={bindings} title={entry.element.name}
            onOpen={onOpen} onUnpin={onUnpin} dragHandleProps={drag}
        >
            <QuickFace element={entry.element} bindings={bindings} />
        </QuickCard>
    );
});

const DESK_TITLES = { 'desk:capture': 'Capture', 'desk:bracket': 'Bracket' };

export const Rail = memo(function Rail({ pins, onReorder, onUnpin, onOpen }) {
    const scenes = useBindingScenes();
    const overrides = useSettingsStore(useShallow(s => s?.production?.overrides ?? {}));
    const [dragging, setDragging] = useState(null);

    // Pins may name an element that no longer exists (a renamed id, an older
    // build) — drop those rather than rendering an empty card.
    const entries = useMemo(() => pins.map((id) => {
        if (DESK_QUICK_FACES[id]) return { id, title: DESK_TITLES[id] ?? id };
        const element = ELEMENTS.find(e => e.id === id);
        return element && isPinnable(element) ? { id, element } : null;
    }).filter(Boolean), [pins]);

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
                                to keep its live controls here, in your own order, across every phase.
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
                                entry={entry} scenes={scenes} overrides={overrides}
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
