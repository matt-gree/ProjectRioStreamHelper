import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../../context/store';
import { Text } from '../../../components/ui/primitives';
import { StatusLine, ToggleRow, KIT_SECTION } from '../kit';
import { setSourceVisibility, useDisplayedEnabled } from '../board/bindings';
import { useContainerOf, useMemberScope } from '../containers/containers';
import { boardOfUrl } from '../../../lib/obs-binding';
import { PostgameCalloutPicker, PostgameVsPicker } from '../containers/feed-pickers';

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
            label={label} checked={enabled} staged={staged} spread
            onChange={(v) => setSourceVisibility(sceneName, item, v)}
        />
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
    /*
     * THE EYEBROW IS THE CONSEQUENCE, THE VALUE IS THE CAUSE. What makes this
     * worth amber is not that a state key is empty — it is that a source which
     * looks fine in the rack is putting nothing on the broadcast. Said in that
     * order it is legible without being read; the Rio detail behind it (why a
     * board can carry teams and scores and still have no names) is what the
     * expansion is for.
     */
    return (
        <StatusLine
            tone="warn"
            label="BLANK ON AIR"
            title={`Project Rio fills teams and scores from the roster before it knows who is playing, so a stale HUD file looks exactly like this. The overlay hides itself rather than drawing a half-filled card.`}
        >
            No player names on board {board}
        </StatusLine>
    );
});

/*
 * The element's CONTENT control, wherever the element is drawn.
 *
 * A pick writes the standing intent (`production.feed.last.{id}`), and that one
 * key is read by two things: a container, when Push sends it there, and the
 * element's OWN source, which renders it directly (see
 * public/layout/postgame/spotlight.html). So the picker belongs on both panels
 * — `fed` only changes the sentence under it, never the pick.
 *
 * Without this, a direct spotlight source could be bound and shown and never
 * told whose spotlight to draw, which is the same dead end as a Push with no
 * container: a panel that can see the problem and not fix it.
 *
 * `scoreboard` is the frame of reference the pick is made in, and it is a PROP
 * because the two rows answer it differently: a container slot takes the
 * container's scope (../containers/containers `useMemberScope`), the element's own source
 * takes the board its URL names. It used to default to 1 in each picker, so a
 * container scoped to board 2 listed board 1's roster and armed a board-1 pick
 * that Push then sent into it.
 */
export const FeedContentPicker = memo(function FeedContentPicker({
    element, fed = true, scoreboard = 1,
}) {
    if (element.feed === 'postgamecallout') {
        return <PostgameCalloutPicker element={element} fed={fed} scoreboard={scoreboard} />;
    }
    if (element.feed === 'postgamevs') {
        return <PostgameVsPicker element={element} fed={fed} scoreboard={scoreboard} />;
    }
    // A member with no picker is NOT unfinished. A container-scoped one (Stat
    // Card) draws whoever its container's scope has on the field, so there is
    // nothing to choose and the panel's SUBJECT already says what it will be.
    return null;
});

/*
 * Plain direct element (e.g. scoreboard): its one control — show/hide — lives
 * in the header strip, and WHICH source the panel drives is the header's too
 * (its meta slot), so the body carries only what the header cannot: an
 * element's PICK, because on its own source the pick is the content, and a
 * readiness warning.
 *
 * A BODY THAT WRAPS THIS STILL FORWARDS `placement` — the pick reads the board
 * off the source's own URL.
 */
export const DirectStage = memo(function DirectStage({ element, board, placement }) {
    // The element's OWN source draws the board its URL names. A feed element
    // takes no `scope: 'board'` (the two post-game callouts are full-canvas), so
    // the placement's board is null while the source still carries the
    // `?scoreboard=` the overlay itself reads — same read as ../subject.
    const own = board ?? boardOfUrl(placement?.item?.url) ?? 1;
    return (
        <>
            {element.feed && (
                <FeedContentPicker element={element} fed={false} scoreboard={own} />
            )}
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
 * A fed element with NO container to be pushed into — the one state a slot's
 * header cannot show, because there is no slot. Under a container the header
 * already names the container's source, so this says nothing there.
 */
export const ContainerHostNote = memo(function ContainerHostNote({ element, container: on }) {
    const own = useContainerOf(element);
    if (on ?? own.container) return null;
    return (
        <Text size="xs" className="text-amber-500/90">
            No container holds {element.name} yet, so there is nowhere to push it.
            Add it to one on the Containers tab.
        </Text>
    );
});

/*
 * Fed element: the content decision (what to push) over the target config.
 *
 * An element with no picker is NOT an unfinished one. A container-scoped member
 * (Stat Card) has nothing to choose — it draws whoever the container's own scope
 * has on the field — so the honest thing to render is what it will draw, which
 * the panel's SUBJECT already says (../subject), and nothing here. "No content
 * options yet" described the absence of a control and read as a missing feature.
 */
export const FedStage = memo(function FedStage({ element, placement }) {
    // The container's frame of reference, taken from the ROW's container — a
    // scoped member sits on several rosters, so a lookup from the element is a
    // coin flip between a mirrored pair's two sides.
    const { scoreboard } = useMemberScope(element, placement?.slot);
    return (
        <>
            <FeedContentPicker element={element} scoreboard={scoreboard} />
            <div className={KIT_SECTION}>
                <ContainerHostNote element={element} container={placement?.slot} />
            </div>
        </>
    );
});
