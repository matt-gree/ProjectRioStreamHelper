import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../../context/store';
import { Text } from '../../../components/ui/primitives';
import { ToggleRow } from '../kit';
import { setSourceVisibility, useDisplayedEnabled } from '../bindings';
import { useContainerBinding } from '../feeds';
import { useContainerOf } from '../containers';
import { useConsoleOffline } from '../placements';
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
    const offline = useConsoleOffline();
    // A sourceless placement is truthy but drives nothing — "has an item" is
    // what makes something a binding, here and in the preview column.
    if (!binding?.item) {
        /*
         * With OBS closed, "isn't in any scene we can see" is true but useless —
         * and the two ways out it named (the header's Bind, a scene's +) are both
         * gone, since neither exists without a connection. Say what IS available:
         * the panel works, and the header hands over the URL.
         */
        return (
            <Text size="xs" className="text-muted-foreground">
                {offline
                    ? `OBS isn’t connected, so PRSH can’t see your scenes. Everything on this
                       panel still works — Copy URL in the header gives you the source to paste
                       in by hand.`.replace(/\s+/g, ' ')
                    : `${what} isn’t in any scene we can see — add it from the header, or with
                       the + beside a scene in the rack.`.replace(/\s+/g, ' ')}
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
 * right on air and silent everywhere else. Every silent mount now names its own
 * blank reason via `OverlayBase.setBlank`, and the stage preview column loads
 * each source with `?preview=1`, so that reason paints right below this body
 * (phase 6b; `blank-reason.test.jsx` pins the coverage).
 *
 * Scoreboard is the one element that ALSO mirrors the reason into the panel
 * body here, because a scoreboard's DirectStage shows only its binding — no
 * player state — so the note carries information the body otherwise lacks. That
 * makes the predicate live in two runtimes with no shared module between
 * `public/layout/lib` and `src/`: `generic.test.jsx` pins the state keys and
 * `blankReason` in scoreboard-mount.js names this. If you change what makes a
 * board renderable, change both.
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
                    it. It’s a PRSH source the registry doesn’t know, so it has no
                    style settings of its own.
                </Text>
            )}
        </>
    );
});

/*
 * Which container hosts this element — stated, not chosen.
 *
 * Membership lives on the CONTAINER now (its roster is the relationship), so
 * this is a read of it rather than the old per-element "Feed into" select. Two
 * places storing one relationship is how these drift; the edit belongs where
 * the data does, which is the container's own panel, and the link goes there.
 *
 * An element on no roster is a real state, not an error — it just has nowhere
 * to be pushed, which the Push slot also reports by disabling. Say what to do
 * about it rather than leaving a blank row.
 */
export const ContainerHostNote = memo(function ContainerHostNote({ element }) {
    const { container, def } = useContainerOf(element);
    const binding = useContainerBinding(container);
    if (!container) {
        return (
            <Text size="xs" className="text-amber-500/90">
                No container holds {element.name} yet, so there is nowhere to push
                it. Add it to a container’s members from that container’s panel —
                or make one with the + in the rack.
            </Text>
        );
    }
    return (
        <>
            <Text size="xs" className="text-muted-foreground">
                Fed into <span className="text-foreground">{def?.name || container}</span>
                {def?.width && def?.height ? ` · ${def.width} × ${def.height}` : ''} — edit
                its members on that container’s panel.
            </Text>
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
                <ContainerHostNote element={element} />
            </div>
        </>
    );
});
