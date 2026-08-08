import { memo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Check, Copy, Eye, EyeOff, Plus } from 'lucide-react';
import { useObsStore } from '../../context/obs';
import { Button } from '../../components/ui/button';
import { CopyButton } from '../../components/ui/copy-button';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import { notifications } from '../../lib/notify';
import { IconToggle } from './kit';
import {
    absoluteOverlayUrl, instanceUrl, placementDims, setSourceVisibility, useDisplayedEnabled,
} from './bindings';
import { sizeOptionFor } from './elements';
import { useActiveBoards } from './boards';
import { useContainerPush } from './feeds';
import { useContainerOf, useSharedContainers } from './containers';
import { StagedDot } from './controls';

/*
 * The source strip — the OBS transport contract every stage panel wears in its
 * header (production-console-contract skill).
 *
 * THREE SLOTS, ALWAYS THIS ORDER, ALWAYS THIS PLACE:
 *
 *     [ BIND ]   [ AIR ]   [ PUSH ]
 *      add to     show/     hand content to the
 *      OBS        hide      shared container (fed only)
 *
 * It sits immediately right of the panel's state chip, and the two read the
 * SAME binding: the chip says what the source is doing, the strip is the verb
 * set for doing something about it. They cannot disagree.
 *
 * Slots are progressive, not conditional-by-element: an unbound element shows
 * only Bind, because Air and Push would have nothing to act on. Once bound,
 * Bind retires and Air appears. This is why the old dead-end prose ("add its
 * browser source in OBS") is gone — the panel that told you what to do now
 * does it.
 *
 * WHICH SOURCE the strip acts on follows flavor, and this is the whole reason
 * one strip can serve both:
 *   direct → the element's own dedicated source.
 *   fed    → the SHARED CONTAINER it feeds. "On air" for a fed element has
 *            never meant anything else, and Push is the slot that distinguishes
 *            its content from the container carrying it.
 *
 * The strip is a STAGE surface. Rail cards keep their quick face (visibility as
 * row one) — a QuickCard header is 8px shorter and already spoken for. Both
 * route through the same hooks, so the two surfaces stay honest.
 */

// Where a newly-added source should land: the studio preview scene when Studio
// Mode is on (that is what preview is FOR — build it off-air, then Take), else
// the program scene.
function useAddTargetScene() {
    return useObsStore(useShallow(s => (
        s.studioMode && s.previewScene ? s.previewScene : s.programScene
    )));
}

// What Bind would create for this element: its own layout for a direct
// element, and for a fed one the source of the container whose roster names it
// — sized and named from the definition, since that is the only place a
// container's name and native size live.
function useBindTarget(element, board, placement) {
    const containers = useSharedContainers();
    const boards = useActiveBoards();
    const { container } = useContainerOf(element);
    const variant = placement?.variant ?? '';
    if (element.flavor === 'direct') {
        // Board-scoped: create the source for the board the panel is pointed at.
        // Suffix the name only on a multi-board rig — otherwise the producer
        // gets two identically-named sources they can tell apart only by opening
        // the URL, and on a single-board rig a "1" that means nothing.
        const suffix = element.scope === 'board' && board != null && boards.length > 1;
        // A size variant is a different canvas AND a different source, so it
        // earns its own name — two browser sources both called "Scoreboard"
        // that differ only by dimensions is the thing a producer can't undo
        // later without opening each one.
        const size = sizeOptionFor(element, variant);
        const base = size ? `${element.name} ${size.label}` : element.name;
        const dims = placementDims({ element, variant });
        return {
            inputName: suffix ? `${base} ${board}` : base,
            url: instanceUrl(element, board, variant),
            width: dims.width,
            height: dims.height,
        };
    }
    const entry = containers.find(c => c.id === container);
    return {
        inputName: entry?.name || element.name,
        url: entry?.url || element.url,
        width: entry?.width || element.width,
        height: entry?.height || element.height,
    };
}

/*
 * Slot 1 — Bind. Only while the element has no source we can see.
 *
 * Adds HIDDEN (enabled: false). Adding a source is setup, and setup must never
 * be the thing that puts something on the broadcast — the Air switch beside it
 * is the one deliberate act that does. (The old Setup layout browser added
 * VISIBLE, because it was a setup surface with nothing live to disturb; it's
 * gone now, and every console add path is hidden.)
 */
const BindSlot = memo(function BindSlot({ element, board, placement }) {
    const status = useObsStore(s => s.status);
    const scene = useAddTargetScene();
    const target = useBindTarget(element, board, placement);
    const [adding, setAdding] = useState(false);

    /*
     * With no OBS, hand over the URL instead of saying no.
     *
     * The slot used to read a flat "OBS offline", which is a dead end in the one
     * place the panel exists to act — and it was wrong about the situation: a
     * producer whose OBS is on another machine, or who is using another app
     * entirely, needs exactly this string and nothing else. Same builder Bind
     * uses, so what they paste is what Add would have created. (The Add picker's
     * Copy URL is the same escape hatch, one surface over.)
     */
    if (status !== 'connected') {
        return (
            <CopyButton value={absoluteOverlayUrl(target.url)}>
                {({ copied, copy }) => (
                    <SimpleTooltip label={
                        copied
                            ? 'Copied — paste it into a browser source'
                            : `Copy this overlay’s URL (${target.width}×${target.height}) — OBS isn’t connected`
                    }>
                        <Button size="xs" variant="secondary" onClick={copy} className="shrink-0">
                            {copied
                                ? <><Check size={11} className="mr-0.5" /> Copied</>
                                : <><Copy size={11} className="mr-0.5" /> Copy URL</>}
                        </Button>
                    </SimpleTooltip>
                )}
            </CopyButton>
        );
    }

    const add = async () => {
        setAdding(true);
        try {
            const res = await useObsStore.getState().addBrowserSource({
                ...target, sceneName: scene, enabled: false,
            });
            notifications.show({
                message: `Added “${res.inputName}” to ${res.sceneName} — hidden. Flip it on when you're ready.`,
                color: 'green',
            });
        } catch (e) {
            notifications.show({ message: e?.message || 'Failed to add to OBS', color: 'red' });
        }
        setAdding(false);
    };

    return (
        <SimpleTooltip label={scene ? `Add to “${scene}”, hidden` : 'No scene to add into'}>
            <Button
                size="xs" variant="secondary" onClick={add} disabled={adding || !scene}
                className="shrink-0"
            >
                <Plus size={11} className="mr-0.5" />
                {adding ? 'Adding…' : 'Add to OBS'}
            </Button>
        </SimpleTooltip>
    );
});

/*
 * Slot 2 — Air. Show/hide, staging-aware exactly as the body row it replaces
 * was (setSourceVisibility owns the gateway).
 *
 * An eye, not a switch. A switch is a chunky two-state track that wants a label
 * to its left, and this strip has no room for one — it would be the loudest
 * thing in a 36px header that already states its status in the chip. The kit's
 * IconToggle is the console's existing on/off idiom and reads at a glance:
 * open eye = visible, struck eye = hidden. Its engaged tone is rio, not
 * emerald, so the ONLY emerald in the header stays the AIR chip.
 */
const AirSlot = memo(function AirSlot({ binding }) {
    const { enabled, staged } = useDisplayedEnabled(binding.scene, binding.item);
    // Say WHERE, because with scenes as the grouping axis the same overlay can
    // be a row in three of them and "on air" is true of at most one.
    const where = binding.where === 'program' ? 'on air'
        : binding.where === 'preview' ? 'in preview'
            : `in ${binding.scene}`;
    return (
        <>
            <StagedDot show={staged} />
            <IconToggle
                icon={Eye} offIcon={EyeOff} on={enabled}
                label={`${enabled ? 'Hide' : 'Show'} ${binding.item.sourceName} ${where}`}
                onClick={() => setSourceVisibility(binding.scene, binding.item, !enabled)}
            />
        </>
    );
});

/*
 * Slot 3 — Push (fed elements only). Whether THIS element's content is the one
 * the shared container is carrying.
 *
 * Deliberately uniform across fed elements, including the pickable ones where
 * "picking IS feeding": there the slot reads Clear once something is fed, and a
 * disabled Push before anything ever has been. A slot that appears and vanishes
 * per element is the mishmash this contract exists to end — one that stays put
 * and goes honestly grey is not.
 */
const PushSlot = memo(function PushSlot({ element }) {
    const { mine, staged, canPush, toggle } = useContainerPush(element);
    return (
        <>
            <StagedDot show={staged} />
            <SimpleTooltip label={
                mine ? 'Take this off the container'
                    : canPush ? 'Put this on the container'
                        : 'Pick content in the panel first'
            }>
                <span className="shrink-0">
                    <Button
                        size="xs" variant={mine ? 'ghost' : 'default'}
                        disabled={!mine && !canPush} onClick={toggle}
                    >
                        {mine ? 'Clear' : 'Push'}
                    </Button>
                </span>
            </SimpleTooltip>
        </>
    );
});

/*
 * The strip. Pass as PanelShell's `primaryAction`.
 *
 * The source it commands is the SELECTED PLACEMENT's — this element, in this
 * scene — handed down rather than re-resolved here, which is what stops the
 * header from toggling one scene's copy while the row the producer clicked
 * meant another's. For a fed element the placement is the shared container it
 * feeds, exactly as before: "on air" for a fed element has never meant anything
 * else, and Push is the slot that distinguishes its content from the container
 * carrying it.
 *
 * Bind still renders when there is no placement. With unbound rack rows gone
 * that is no longer the fresh-rig case (the rack's + is), but it remains the
 * live one: delete a shared container's source while its fed element is on the
 * stage and this is the panel that puts it back.
 *
 * Desks render nothing here: they have no OBS source (chip DESK), and letting a
 * desk's own actions colonise this slot would cost the strip the one thing that
 * makes it scannable — that its position always means the same three verbs.
 */
export const SourceStrip = memo(function SourceStrip({ element, board, placement }) {
    const direct = element.flavor === 'direct';
    return (
        <div className="flex shrink-0 items-center gap-1.5">
            {placement?.item
                ? <AirSlot binding={placement} />
                : <BindSlot element={element} board={board} placement={placement} />}
            {!direct && <PushSlot element={element} />}
        </div>
    );
});
