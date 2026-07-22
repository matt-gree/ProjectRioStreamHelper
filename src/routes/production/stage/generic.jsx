import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../../context/store';
import { Text } from '../../../components/ui/primitives';
import { ToggleRow, SelectRow } from '../kit';
import { setSourceVisibility, useDisplayedEnabled } from '../bindings';
import {
    defaultContainerFor, useContainerBinding, useContainerTarget, useSharedContainers,
} from '../feeds';
import { PostgameCalloutPicker, PostgameVsPicker, StatsFeedPicker } from '../feed-pickers';

/*
 * The two stage bodies every element gets for free from its flavor:
 * DirectStage (show/hide its dedicated source) and FedStage (pick content +
 * the shared container it feeds). Richer elements replace these with their own
 * file in this folder; both stay the floor.
 */

// A source visibility toggle in kit-row form — the staging gateway lives in
// setSourceVisibility, so this row is presentational like the rest of the kit.
export const SourceToggleRow = memo(function SourceToggleRow({ label, item, sceneName }) {
    const { enabled, staged } = useDisplayedEnabled(sceneName, item);
    return (
        <ToggleRow
            label={label} checked={enabled} staged={staged}
            onChange={(v) => setSourceVisibility(sceneName, item, v)}
        />
    );
});

// Where an element's source stands, for the body of a panel whose only
// transport control is now the header strip. Replaces the old dead-end prose
// ("add its browser source in OBS") — the strip's Bind slot does that, so what
// is left to say here is WHICH source answers to this panel.
export const BindingNote = memo(function BindingNote({ binding, what = 'This overlay' }) {
    // A sourceless placement is truthy but drives nothing — "has an item" is
    // what makes something a binding, here and in the preview column.
    if (!binding?.item) {
        return (
            <Text size="xs" className="text-muted-foreground">
                {what} isn’t in any scene we can see — add it from the header, or
                with the + beside a scene in the rack.
            </Text>
        );
    }
    // Name the scene rather than its role. With scenes as the grouping axis
    // "the program scene" is a fact the producer already has from the section
    // header, and the scene's own name is what they need when the same overlay
    // sits in three of them.
    return (
        <Text size="xs" className="text-muted-foreground">
            Driving <span className="text-foreground">{binding.item.sourceName}</span> in{' '}
            <span className="text-foreground">{binding.scene}</span>
            {binding.where === 'program' ? ' — the program scene.'
                : binding.where === 'preview' ? ' — studio preview.' : '.'}
        </Text>
    );
});

/*
 * "It's on air and still blank" — the failure that reads as a broken overlay.
 *
 * A board-scoped overlay hides itself when it has no player names, which is
 * right on air and silent everywhere else. The mount says why in its own
 * console (OverlayBase.setBlank), but a producer is looking at THIS panel, not
 * the browser source's dev tools.
 *
 * The predicate is duplicated from `blankReason` in scoreboard-mount.js — two
 * runtimes, no shared module between `public/layout/lib` and `src/`. Both sides
 * name the other; `generic.test.jsx` pins the state keys. If you change what
 * makes a board renderable, change both.
 */
export const ReadinessNote = memo(function ReadinessNote({ element, board }) {
    const players = useStateStore(useShallow(s => {
        const p = s?.score?.[board]?.player;
        return [p?.[1]?.rioName || '', p?.[2]?.rioName || ''];
    }));
    if (element.scope !== 'board' || board == null) return null;
    if (players[0] || players[1]) return null;
    return (
        <Text size="xs" className="text-amber-500/90">
            Nothing to draw: scoreboard {board} has no player names yet, so this
            overlay hides itself. Project Rio fills teams and scores from the
            roster before it knows who is playing — a stale HUD file looks
            exactly like this.
        </Text>
    );
});

// Plain direct element (e.g. scoreboard): its one control — show/hide — lives
// in the header strip, so the body is left saying what the panel is wired to.
export const DirectStage = memo(function DirectStage({ element, board, placement }) {
    return (
        <>
            <BindingNote binding={placement} />
            <ReadinessNote element={element} board={board} />
            {element.generic && (
                <Text size="xs" className="text-muted-foreground">
                    This layout has no console controls — the rack can show and hide
                    it, and its style settings live on the Setup tab.
                </Text>
            )}
        </>
    );
});

// Which named shared container an element feeds. The container's own on-air
// toggle used to sit here too; it is the header strip's Air slot now, since for
// a fed element the container IS the source the panel commands.
export const ContainerTarget = memo(function ContainerTarget({ element }) {
    const containers = useSharedContainers();
    const { container, setContainer } = useContainerTarget(element.id, defaultContainerFor(element));
    const binding = useContainerBinding(container);
    return (
        <>
            <SelectRow
                label="Feed into" value={container} onChange={setContainer}
                options={containers.length ? containers.map(c => ({ label: c.name, value: c.id })) : [container]}
            />
            <BindingNote binding={binding} what="That container" />
        </>
    );
});

// Fed element: the content decision (what to push) over the target config.
export const FedStage = memo(function FedStage({ element }) {
    const picker = element.feed === 'stats' ? <StatsFeedPicker element={element} />
        : element.feed === 'postgamecallout' ? <PostgameCalloutPicker element={element} />
            : element.feed === 'postgamevs' ? <PostgameVsPicker element={element} />
                : <Text size="xs" className="text-muted-foreground">No content options yet.</Text>;
    return (
        <>
            {picker}
            <div className="mt-1 flex flex-col gap-1.5 border-t border-border/60 pt-2">
                <ContainerTarget element={element} />
            </div>
        </>
    );
});
