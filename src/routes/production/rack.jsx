import { memo, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
    Eye, EyeOff, ChevronDown, ChevronRight, Plus, Circle, CircleDot, Trash2, TriangleAlert,
} from 'lucide-react';
import { useObsStore, useMirrorScene } from '../../context/obs';
import { useStateStore } from '../../context/store';
import { Panel } from '../../components/ui/panel';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Button } from '../../components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '../../components/ui/popover';
import { Text } from '../../components/ui/primitives';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import { cn } from '../../lib/utils';
import { usePersistentState } from '../../hooks/usePersistentState';
import { ELEMENTS, isPinnable } from './elements';
import {
    isFedPlacement, placementTarget, stretchOfPlacement, togglePin as togglePinIn, useConsoleOffline,
    useConsolePlacements, useConsoleScenes, usePlacementLabel,
} from './placements';
import { GameStageChip, StateChip, chipFor } from './kit';
import {
    removeSourceFromScene, setSourceVisibility, useDisplayedEnabled, useOtherScenesWith,
    useRemovalStaged,
} from './bindings';
import { useContainerPush } from './feeds';
import { useWaitingCount } from './queue';
import { useMemberScope } from './containers';
import { boardDeskId, useActiveBoards, useBoardLabel, useBoardLifecycle } from './boards';
import { useBoardDeskRow, BOARD_TAG_TITLE } from './desks/board';
import { notifications } from '../../lib/notify';

/*
 * The rack — the console's left surface (production-console-contract skill):
 * a monitor + selector for everything the producer can put on the broadcast.
 *
 *   Boards → Desk → Program scene → Preview scene → every other scene (lazy)
 *
 * SCENES ARE THE GROUPING AXIS. The rack used to sort by a "phase" the producer
 * picked from a segmented control — Draft / Live / Post-game / Break — which was
 * PRSH guessing at the shape of a show. OBS's scene list is the producer
 * STATING it, it is already the thing they cut between, and it groups by the
 * only fact that decides whether a source is reaching air.
 *
 * Rows are PLACEMENTS (./placements): one row per source per scene, so the same
 * overlay in Game and in Break is two rows with their own air state and their
 * own eye — which is the point, since staging the Break scene before cutting to
 * it means toggling that copy and not this one.
 *
 * Only what is actually IN a scene is listed. There are no rows for things
 * nobody has added: those were six dead "—" lines pretending to be a catalog,
 * and the Add button in each section header is the honest version of them.
 *
 * Selection + rail membership are per-producer-browser workspace layout
 * (usePersistentState), not broadcast config. A null rail means "never
 * touched" — the quick rail seeds its first-run default from that.
 */

export const SELECTION_KEY = 'prsh.ui.production.selection';
export const RAIL_KEY = 'prsh.ui.production.rail';
export const OPEN_SCENES_KEY = 'prsh.ui.production.scenes';
export const SHUT_TIERS_KEY = 'prsh.ui.production.tiers';

export function useRackSelection() {
    return usePersistentState(SELECTION_KEY, 'desk:match', v => typeof v === 'string');
}

export function useRailPins() {
    return usePersistentState(RAIL_KEY, null, v => v === null || Array.isArray(v));
}

// Which off-air scene sections the producer has expanded. Persisted because
// expanding is also what MIRRORS the scene — a producer who set up their Break
// section should find it live on the next load, not collapsed again.
export function useOpenScenes() {
    return usePersistentState(OPEN_SCENES_KEY, [], v => Array.isArray(v));
}

/*
 * Which permanent tiers the producer has collapsed — and note it tracks the SHUT
 * ones, the inverse of useOpenScenes above.
 *
 * A scene section defaults closed because there can be a dozen of them and
 * opening one is also what asks OBS to mirror it. The two tiers at the top of
 * the rack are neither: there are exactly two, they cost nothing to draw, and
 * they are where the producer starts. So the empty list — a producer who has
 * never touched a chevron — has to mean BOTH OPEN, which means storing what was
 * closed rather than what was opened.
 */
export function useShutTiers() {
    return usePersistentState(SHUT_TIERS_KEY, [], v => Array.isArray(v));
}

// First-run seed: an empty rail undersells the surface, so a producer who has
// never pinned anything starts with the two cards nearly every stream uses.
// `null` (never touched) is deliberately distinct from `[]` (emptied on
// purpose) — only the former seeds. Stored in pre-scene form on purpose: they
// resolve to wherever those sources actually are (./placements).
export const RAIL_SEED = ['scoreboard', 'statsbar'];

export function seededRail(rail) {
    if (rail !== null && rail !== undefined) return rail;
    return RAIL_SEED.filter(id => ELEMENTS.some(e => e.id === id && isPinnable(e)));
}

// The row's inline quick action: the visibility eye, staged through the
// confirm-to-live buffer like everywhere else. Also the rail card's (../rail),
// which is why it can NAME ITS SCENE: a rack row sits under its scene's header,
// a rail card does not, and the same overlay can be pinned from two scenes.
export const EyeAction = memo(function EyeAction({ placement, namesScene = false }) {
    const { enabled, staged } = useDisplayedEnabled(placement?.scene, placement?.item);
    if (!placement) return null;
    const Icon = enabled ? Eye : EyeOff;
    const verb = enabled ? 'Hide' : 'Show';
    const what = namesScene && placement.scene ? `${verb} in ${placement.scene}` : `${verb} source`;
    return (
        <SimpleTooltip label={staged ? 'Staged — goes live on confirm' : what}>
            <button
                type="button"
                onClick={() => setSourceVisibility(placement.scene, placement.item, !enabled)}
                aria-pressed={enabled}
                aria-label={what}
                className={cn(
                    'shrink-0 transition-colors',
                    staged ? 'text-amber-400' : enabled ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
            >
                <Icon size={13} />
            </button>
        </SimpleTooltip>
    );
});

/*
 * A fed row's quick action — a RADIO, not an eye.
 *
 * The eye belongs to the container above it, which owns the source. What a fed
 * row decides is whether ITS content is the one the container is carrying, and
 * because a container holds exactly one feed, its siblings are alternatives
 * rather than independent switches. A filled dot is that fact; two eyes were the
 * old lie.
 *
 * IT DRIVES THE ROW'S CONTAINER, not whichever roster claims the element. The
 * lookup was the default here while every other surface (the source strip, the
 * rail's quick faces) passed the placement's, and it broke the shipped mirrored
 * pair: Roster and Stat Card sit on `roster-stats-1` AND `roster-stats-2`, so
 * both of the right-hand container's rows fed the LEFT one — and the row's chip,
 * which reads `placement.mine`, disagreed with its own radio.
 */
const FeedAction = memo(function FeedAction({ placement }) {
    const { scoreboard } = useMemberScope(placement.element, placement.slot);
    const { mine, staged, canPush, toggle } =
        useContainerPush(placement.element, scoreboard, placement.slot);
    const Icon = mine ? CircleDot : Circle;
    const disabled = !mine && !canPush;
    return (
        <SimpleTooltip label={
            staged ? 'Staged — goes live on confirm'
                : mine ? 'On the container — click to clear it'
                    : canPush ? 'Put this on the container'
                        : 'Pick content in the panel first'
        }>
            <button
                type="button" onClick={toggle} disabled={disabled}
                aria-pressed={mine} aria-label={mine ? 'Clear from container' : 'Put on container'}
                className={cn(
                    'shrink-0 transition-colors disabled:opacity-30',
                    staged ? 'text-amber-400' : mine ? 'text-rio-300' : 'text-muted-foreground hover:text-foreground',
                )}
            >
                <Icon size={13} />
            </button>
        </SimpleTooltip>
    );
});

const PinToggle = memo(function PinToggle({ pinned, onToggle }) {
    return (
        <SimpleTooltip label={pinned ? 'Unpin from quick rail' : 'Pin to quick rail'}>
            <button
                type="button" onClick={onToggle} aria-pressed={pinned}
                aria-label={pinned ? 'Unpin from quick rail' : 'Pin to quick rail'}
                className={cn(
                    // Full-strength when unpinned, like PanelShell's copy of this
                    // control: the dimmed variant this used to carry put the
                    // console's most-repeated glyph (once per rack row) under the
                    // 3:1 floor for UI components, and "which rows are already
                    // pinned" is exactly the scan it exists to serve. The pinned
                    // state is distinguished by colour, not by the other being faint.
                    'shrink-0 text-xs leading-none transition-colors',
                    pinned ? 'text-rio-400' : 'text-muted-foreground hover:text-foreground',
                )}
            >
                {pinned ? '◆' : '◇'}
            </button>
        </SimpleTooltip>
    );
});

/*
 * A row's remove — the counterpart to its section's +.
 *
 * DRAWN AT REST, not on hover. The first version faded it in on `group-hover`,
 * which is the reflex for a destructive control on a row you click all night —
 * and it reproduced the bug it was written to fix. This affordance exists because
 * a producer could not FIND how to remove a board; an invisible control is
 * findable only by sweeping the mouse over the thing you want gone, which is not
 * a discovery path. It is muted at rest and turns destructive on hover, which is
 * the same bargain the pin diamond already takes one glyph to the left.
 *
 * It sits after the pin: the rarest thing on the row, and the one you least want
 * to hit reaching for something else. The confirm states the CONSEQUENCE rather
 * than asking whether you are sure — what a board takes with it is the thing
 * worth a second look, not the click.
 */
const RowRemove = memo(function RowRemove({
    label, note, onRemove, disabled, disabledHint, staged,
}) {
    const [open, setOpen] = useState(false);
    const trigger = (
        <button
            type="button" disabled={disabled}
            aria-label={label}
            title={disabled ? disabledHint : staged ? 'Staged — goes live on confirm' : label}
            className={cn(
                'shrink-0 transition-colors',
                disabled
                    ? 'cursor-not-allowed text-muted-foreground/40'
                    // Amber is the console's staged tone everywhere else (the
                    // eye, the feed radio); a row whose removal is waiting on
                    // the commit says so in the same colour.
                    : staged
                        ? 'text-amber-400'
                        : 'text-muted-foreground/70 hover:text-destructive',
                open && !staged && 'text-destructive',
            )}
        >
            <Trash2 size={12} />
        </button>
    );
    // A disabled trigger must not open a popover asking about something that
    // can't happen; the title is the whole answer in that state.
    if (disabled) return trigger;
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent align="end" className="w-60">
                <div className="flex flex-col gap-1.5">
                    <Text size="sm" className="text-foreground">{label}?</Text>
                    <Text size="xs" className="text-muted-foreground">{note}</Text>
                    <div className="flex justify-end gap-1.5">
                        <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button
                            size="xs" variant="destructive"
                            onClick={() => { setOpen(false); onRemove(); }}
                        >
                            Remove
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
});

/*
 * A scene row's remove — the counterpart to its section's +, and the same
 * treatment the BOARDS tier already gives its rows.
 *
 * ONLY ON A ROW THAT OWNS ITS SOURCE. A fed row's `item` is the CONTAINER's
 * scene item (../placements: the members nest under one source), so a trash
 * there would delete the container out from under every member on its roster
 * while appearing to remove one of them. Roster membership is edited on the
 * container's stage panel; this button removes sources from scenes and nothing
 * else.
 *
 * The confirm states the CONSEQUENCE, which for this action is entirely a
 * question of whether another scene still holds the source: if one does, this
 * costs nothing and Add to OBS is not even needed to undo it. If none does,
 * OBS releases the input and the transform the producer set by hand goes with
 * it — that is the sentence worth stopping for, and the only one.
 */
const PlacementRemove = memo(function PlacementRemove({ placement, name }) {
    const { scenes, complete } = useOtherScenesWith(placement.item?.sourceName, placement.scene);
    const staged = useRemovalStaged(placement.scene, placement.item);
    // A fed row keeps the COLUMN so the pin diamonds stay in one line down the
    // rack — an empty cell, not a missing one.
    if (!placement.item || isFedPlacement(placement)) {
        return <span aria-hidden className="w-3 shrink-0" />;
    }
    const note = scenes.length
        ? `The source stays in ${scenes.length === 1 ? scenes[0] : `${scenes.length} other scenes`}.`
        : complete
            ? 'This is its only scene — its size and position in OBS go with it. '
                + 'Adding it back creates a fresh copy.'
            : 'If no other scene uses it, its size and position in OBS go with it.';
    return (
        <RowRemove
            label={`Remove ${name} from ${placement.scene}`}
            note={note}
            staged={staged}
            onRemove={() => removeSourceFromScene(placement.scene, placement.item)}
        />
    );
});

/*
 * "OBS is scaling this source."
 *
 * The one fault the rack can see that OBS never mentions. A browser source
 * renders at its own resolution and the scene item then scales that finished
 * texture, so dragging a handle — the obvious gesture for resizing — resamples
 * pixels instead of re-rendering the page, and nothing in either program says a
 * word. EITHER DIRECTION counts: enlarging softens, and at any factor an
 * element with absolute type (the Player Name) is drawing a size other than the
 * one the producer set.
 *
 * AMBER, and the row's one exception to a colourless right-hand column. The tag
 * beside it is deliberately grey because it says what a row IS; this says
 * something is WRONG with it, which is the meaning amber carries everywhere
 * else in the console — "you'd want to know before this is on air". It cannot
 * be confused with the chip's air states: those are emerald and sky, and they
 * are on the other end of the row.
 *
 * Not a button. It marks the row; selecting the row opens the panel that
 * carries the fix (stage/resolution.jsx), which is the same path every other
 * thing wrong with a source takes.
 */
const StretchBadge = memo(function StretchBadge({ factor, cropped }) {
    return (
        <span
            title={`This source is being drawn at ${factor.toFixed(1)}× the resolution it `
                + `renders at, so OBS is resampling it rather than showing it. `
                + (cropped
                    ? 'It is cropped, so the fix is its size in OBS Properties.'
                    : 'Open this row to redraw it at true size.')}
            className="label-display ml-auto flex shrink-0 items-center gap-1 text-[10px] tracking-wider text-amber-300"
        >
            <TriangleAlert size={10} className="shrink-0" />
            {factor.toFixed(1)}×
        </span>
    );
});

// One rack row. Rows relocate as OBS state changes.
const RackRow = memo(function RackRow({
    state, name, meta, tag, tagTitle, badge, dimmed, selected, onSelect, quickAction,
    pinnable, pinned, onPinToggle, nested, rowAction, stretch, cropped,
}) {
    return (
        <div
            // Rows are identified by name + board meta, and several board-scoped
            // elements carry the SAME meta ("Scoreboard 1") — so a text query
            // can't address a row on its own. Same affordance as
            // data-rack-section / data-chip-state.
            data-rack-row={name}
            data-rack-nested={nested ? '' : undefined}
            className={cn(
                'group flex h-8 items-center gap-2 rounded-md px-2',
                selected ? 'bg-secondary/70' : 'hover:bg-secondary/40',
                dimmed && !selected && 'opacity-60',
                // A fed row is a choice WITHIN the source above it, not a source
                // of its own; the rule carries that without spending a word.
                nested && 'ml-3 rounded-l-none border-l border-border/60 pl-2',
            )}
        >
            <StateChip state={state} />
            <button type="button" onClick={onSelect} className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left">
                <Text size="xs" span truncate className="min-w-0 text-foreground">{name}</Text>
                {meta != null && <Text size="xs" span truncate dimmed className="min-w-0">{meta}</Text>}
                {/* A TYPE tag, not a status: it says what the row IS, and it is
                    the same for as long as the producer leaves it that way. So it
                    is deliberately colourless — the rack's hues are spoken for
                    (emerald AIR, sky PVW, rio DESK) and a green HUD tag beside a
                    green chip would read as a second air state. Right-aligned so
                    the tags line up into a column a producer can scan down
                    without reading the names. */}
                {tag && (
                    <span
                        title={tagTitle}
                        className="label-display ml-auto shrink-0 text-[10px] tracking-wider text-muted-foreground/80"
                    >
                        {tag}
                    </span>
                )}
                {/* After the tag, so a stretched row keeps its type tag AND the
                    warning — the `ml-auto` on whichever comes first pushes the
                    pair right together. */}
                {stretch ? <StretchBadge factor={stretch} cropped={cropped} /> : null}
                {/* A lifecycle badge, which is neither the TYPE tag above nor a
                    source status: it says where the row's GAME is up to. Only a
                    board row has one, and only when there is a game — ../kit
                    GameStageChip renders nothing otherwise, so this is unguarded
                    on purpose. */}
                {badge}
            </button>
            {quickAction}
            {pinnable && <PinToggle pinned={pinned} onToggle={onPinToggle} />}
            {rowAction}
        </div>
    );
});

function SectionHeader({ label, accent, count, onToggle, open, action }) {
    const Chevron = open ? ChevronDown : ChevronRight;
    const inner = (
        <>
            <Text size="xs" span truncate className={cn('label-display min-w-0 tracking-wider', accent ?? 'text-muted-foreground')}>
                {label}
            </Text>
            {count != null && <Text size="xs" span dimmed>{count}</Text>}
            {onToggle && <Chevron size={12} className="shrink-0 text-muted-foreground" />}
        </>
    );
    return (
        <div className="flex items-center gap-1.5 px-2 pt-2 pb-0.5">
            {onToggle
                ? (
                    <button
                        type="button" onClick={onToggle} aria-expanded={open}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                        {inner}
                    </button>
                )
                : <div className="flex min-w-0 flex-1 items-center gap-1.5">{inner}</div>}
            {action}
        </div>
    );
}

/*
 * Match desk meta: WHAT IS LEFT TO PUT ON A BOARD.
 *
 * It used to be the lowest-id match's id and series score — `M1 · 0–0` — which
 * named a fixture nobody asked about (the first one ever authored, decided
 * weeks ago on a long-running rig) and quoted a number that is 0–0 all night on
 * the Bo1 almost every night is. The row said nothing a producer could act on.
 *
 * The desk is the top row of the rack now, and this is what a producer opens the
 * app to read: how much of tonight is still ahead. `all played` is the whole
 * cold-start answer in two words — every fixture is decided, so the night that is
 * still on screen is last night's and the next thing to do is author a card.
 *
 * `none waiting` is kept apart from it because they are different situations:
 * fixtures exist and are undecided, but each is on a board, out of its order, or
 * held back by its stage — which the Match desk's own stage control explains per
 * fixture. Collapsing the two would have the rack say "all played" over a match
 * that is live right now.
 */
function useMatchDeskMeta() {
    const waiting = useWaitingCount();
    const { total, allDecided } = useStateStore(useShallow(s => {
        const matches = s?.match ?? {};
        const ids = Object.keys(matches).filter(k => /^\d+$/.test(k));
        return {
            total: ids.length,
            allDecided: ids.every(id => {
                const d = matches[id]?.decided;
                return d === 1 || d === 2 || d === '1' || d === '2';
            }),
        };
    }));
    if (!total) return { meta: 'no matches', idle: true };
    if (waiting) return { meta: `${waiting} waiting`, idle: false };
    // Never dimmed: "all played" is the one meta here that is a prompt to act.
    return { meta: allDecided ? 'all played' : 'none waiting', idle: false };
}

/*
 * The desk tier — content workflows that feed the broadcast but aren't on it.
 * Permanent rows with live meta, dimmed when idle, selectable like any row.
 *
 * One entry per desk: the page maps the same ids to bodies (production.jsx)
 * and quick faces (quickface.jsx). `pinnable: false` means the desk has no
 * face that fits the two-row cap — Match's controls can't be compressed that
 * far, so it is deliberately not pinnable.
 *
 * ALWAYS RACKED. Desks used to appear one at a time, keyed to the phase they
 * belonged to, and that rule always needed a special case (Live owns no desk, so
 * the section stood empty) — the tell that desks were never phase-shaped. A
 * producer fixes a fixture whenever they need to, not when a selector says so.
 *
 * WHAT A DESK IS, stated because two rows that weren't one used to sit here: a
 * GLOBAL workflow with no other home. Capture failed the first half — everything
 * it did was scoped to one board, down to a Board picker on a console whose rack
 * already asks which board you mean — so it is a region on the board panel
 * (../postgame). Bracket failed the second: both its consumers already carried
 * its picker, so it moved onto the source that draws it (../stage/bracket).
 * Match is what's left, and Match is the shape.
 */
export const DESKS = [
    { id: 'desk:match', name: 'Match', useMeta: useMatchDeskMeta, pinnable: false },
];

/*
 * The rig — one row per board, DERIVED from `scoreboards.active`, which is
 * finally the online reader that settings key never had. (`instances.js` used to
 * union the declared boards into source discovery for the same reason, and lost
 * that reader when rows became source-derived.)
 *
 * A board is a desk in every way that matters to the stage — it feeds the
 * broadcast and is never on it (see ../boards) — but it is NOT a fixed workflow,
 * and that is why it rows in a section of its own rather than above Match with a
 * shared header. Membership is the difference: there is exactly one Match desk
 * forever, while the rig has one to three boards that the producer adds and
 * removes. Racked together, the section's + could only ever add one of the two
 * kinds under it, and a header whose control applies to half its rows is a header
 * that lies.
 *
 * BOARDS USED TO COME FIRST, on the argument that they are the rig — "the
 * fixture, the capture and the bracket all act ON a board". Two thirds of that
 * argument has since left the tier: Capture is a region on the board panel and
 * Bracket moved onto the source that draws it, so what it really said was that
 * the Match desk acts on a board, which is true of every desk there could be.
 *
 * Match reads first now because that is the order the work happens in: a night is
 * authored before any board matters, and the fixtures outlive every game that
 * plays under them. It also puts the one row that can say how much of tonight is
 * left (`useMatchDeskMeta` — `3 waiting`, `all played`) at the top of the surface
 * the app opens onto, which is the whole cold-start readout.
 *
 * They still keep separate sections — see the paragraph above this one for why.
 * Bounded, permanent, one row each: the treatment matches are deliberately NOT
 * given, since matches accumulate all night and belong in a list inside one row.
 */
export function useRigRows() {
    const boards = useActiveBoards();
    const label = useBoardLabel();
    return useMemo(
        () => boards.map(sb => ({ id: boardDeskId(sb), board: sb, name: label(sb) })),
        [boards, label],
    );
}

// A row that takes its meta from the desk's own hook. Boards use the sibling
// below instead of a `useMeta` closure per board: choosing which hook to call by
// looking at the row would be a conditional hook call, so the choice is made by
// COMPONENT (same rule as SUBJECTS and STAGE_BODIES).
const DeskRow = memo(function DeskRow({ desk, selection, onSelect, pinned, onPinToggle }) {
    const { meta, idle } = desk.useMeta();
    return (
        <RackRow
            state="desk" name={desk.name} meta={meta} dimmed={idle}
            selected={selection === desk.id} onSelect={() => onSelect(desk.id)}
            pinnable={desk.pinnable !== false}
            pinned={pinned.has(desk.id)}
            onPinToggle={() => onPinToggle(desk.id)}
        />
    );
});

const BoardDeskRow = memo(function BoardDeskRow({
    desk, selection, onSelect, pinned, onPinToggle, canRemove,
}) {
    // A board row is its NAME and its TYPE. The game summary that used to ride
    // beside it did not fit the row and is stated at full length on the board's
    // own panel (see useBoardDeskRow).
    const { tag, idle } = useBoardDeskRow(desk.board);
    /*
     * WHERE THE GAME IS UP TO, on the surface the producer actually lands on.
     *
     * The rack is the first thing the app opens onto, and a board row said only
     * its name and its type — so a board holding last night's finished game was
     * indistinguishable from one mid-inning without opening the panel. The desk
     * has drawn this chip all along; moving it here costs one component and is
     * the whole of the cold-start readout.
     */
    const lifecycle = useBoardLifecycle(desk.board);
    const restoredAt = useStateStore(s => s?.score?.[desk.board]?.restored_at);
    return (
        <RackRow
            state="desk" name={desk.name} meta={null} dimmed={idle}
            tag={tag} tagTitle={BOARD_TAG_TITLE[tag]}
            badge={<GameStageChip lifecycle={lifecycle} at={restoredAt} />}
            selected={selection === desk.id} onSelect={() => onSelect(desk.id)}
            pinnable
            pinned={pinned.has(desk.id)}
            onPinToggle={() => onPinToggle(desk.id)}
            rowAction={(
                <RowRemove
                    label={`Remove ${desk.name}`}
                    note={`Its binding and pool go with it. Overlays pointed at `
                        + `?scoreboard=${desk.board} will have nothing to draw.`}
                    onRemove={() => removeScoreboard(desk.board)}
                    disabled={!canRemove}
                    disabledHint="The rig always keeps one board"
                />
            )}
        />
    );
});

/*
 * RIG MEMBERSHIP IS THE SECTION'S. How many boards exist is one question, asked
 * and answered in one place: the + in the BOARDS header adds, the trash on a row
 * removes, and the board's own stage panel owns everything else about it (its
 * name, its wiring, its game state).
 *
 * Remove used to live on that panel, and a producer could not find it — which is
 * the predictable result of putting the verb that ends a row's existence inside
 * the row, four scrolls down, rather than next to the + that started it. Adding
 * it here without taking it off the panel would have left two ways to do one
 * thing, which is the duplication boards became desks to end.
 */
async function addScoreboard() {
    try {
        const r = await fetch('/api/v1/scoreboards', { method: 'POST' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
        notifications.show({ message: `Add scoreboard: ${e?.message || e}`, color: 'red' });
    }
}

async function removeScoreboard(sb) {
    try {
        const r = await fetch(`/api/v1/scoreboards/${sb}`, { method: 'DELETE' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
        notifications.show({ message: `Remove scoreboard: ${e?.message || e}`, color: 'red' });
    }
}

const RigSection = memo(function RigSection({
    open, onToggle, selection, onSelect, pinned, onPinToggle,
}) {
    const rows = useRigRows();
    const [adding, setAdding] = useState(false);
    const add = async () => {
        setAdding(true);
        try { await addScoreboard(); } finally { setAdding(false); }
    };
    return (
        <div data-rack-section="rig" className="rounded-md bg-rio-500/5 pb-1">
            <SectionHeader
                label="BOARDS" accent="text-rio-400" count={rows.length}
                open={open} onToggle={onToggle}
                // Same rule as a scene's +: no adding into a section you can't
                // see the result in.
                action={open
                    ? <AddButton scene={null} onAdd={adding ? undefined : add} label="Add a scoreboard" />
                    : null}
            />
            {open && rows.map(desk => (
                <BoardDeskRow
                    key={desk.id} desk={desk} selection={selection}
                    onSelect={onSelect} pinned={pinned} onPinToggle={onPinToggle}
                    canRemove={rows.length > 1}
                />
            ))}
        </div>
    );
});

const DeskSection = memo(function DeskSection({
    open, onToggle, selection, onSelect, pinned, onPinToggle,
}) {
    return (
        <div data-rack-section="desk" className="rounded-md bg-rio-500/5 pb-1">
            <SectionHeader label="DESK" accent="text-rio-400" open={open} onToggle={onToggle} />
            {open && DESKS.map(desk => (
                <DeskRow
                    key={desk.id} desk={desk} selection={selection}
                    onSelect={onSelect} pinned={pinned} onPinToggle={onPinToggle}
                />
            ))}
        </div>
    );
});

const ROLE_META = {
    program: { tag: 'PROGRAM', accent: 'text-emerald-400' },
    preview: { tag: 'PREVIEW', accent: 'text-sky-400' },
    other: { tag: null, accent: 'text-muted-foreground' },
};

// `scene` is null in the catalog tier (no OBS, so no scene to add into) — the
// picker still opens there for its Copy URL and its container builder, both of
// which are OBS-independent.
const AddButton = memo(function AddButton({ scene, onAdd, label }) {
    if (!onAdd) return null;
    // The accessible name stays free of typographic quotes; the tooltip is where
    // the scene name gets dressed.
    return (
        <SimpleTooltip label={label ?? `Add an overlay to “${scene}”`}>
            <button
                type="button" onClick={() => onAdd(scene ?? null)}
                aria-label={label ?? `Add an overlay to ${scene}`}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
                <Plus size={13} />
            </button>
        </SimpleTooltip>
    );
});

/*
 * The CATALOG tier — the rack with no OBS to mirror (./placements
 * `catalogPlacements`).
 *
 * One section, no scenes, because with OBS closed there are none to group by:
 * every element PRSH can configure, plus the producer's containers with their
 * members nested under them exactly as they nest on air. It is a selector rather
 * than a monitor, which is the honest half of the rack's job when there is
 * nothing to monitor.
 *
 * NO EYE ON THESE ROWS. There is no scene item to show or hide, and a dead
 * control is worse than an absent one. A fed row keeps its radio: choosing what
 * occupies a container is a STATE write and works with nothing connected — the
 * overlay renders it whether it is hosted by OBS or a browser window.
 */
const CatalogSection = memo(function CatalogSection({
    rows, selection, onSelect, pinned, onPinToggle, onAdd, label,
}) {
    return (
        <div data-rack-section="catalog">
            <SectionHeader
                label="ELEMENTS" count={rows.length}
                action={<AddButton onAdd={onAdd} label="Copy an overlay URL, or build a container" />}
            />
            {rows.map((p) => {
                const { name, detail } = label(p);
                return (
                    <RackRow
                        key={p.id} state={chipFor(p)} name={name} meta={detail}
                        nested={!!p.parent}
                        selected={selection === p.id} onSelect={() => onSelect(p.id)}
                        quickAction={p.slot ? <FeedAction placement={p} /> : null}
                        pinnable={isPinnable(p.element)} pinned={pinned.has(p.id)}
                        onPinToggle={() => onPinToggle(p.id)}
                    />
                );
            })}
        </div>
    );
});

/*
 * One scene's rows.
 *
 * Program and preview are always open and eagerly mirrored. Every other scene
 * is collapsed until the producer expands it, and expanding is what asks the
 * store to mirror it (obs.jsx `mirrorScene`) — hence the hook taking the scene
 * only while open. Once mirrored it stays live for the connection, so a Break
 * section the producer has opened keeps updating while they work in Game.
 */
const SceneSection = memo(function SceneSection({
    scene, rows, open, onToggle, selection, onSelect, pinned, onPinToggle, onAdd, label,
}) {
    const { loading } = useMirrorScene(open ? scene.scene : null);
    const meta = ROLE_META[scene.where] ?? ROLE_META.other;
    const collapsible = scene.where === 'other';

    return (
        <div data-rack-section={scene.scene}>
            <SectionHeader
                label={meta.tag ? `${meta.tag} · ${scene.scene}` : scene.scene}
                accent={meta.accent}
                count={open && rows.length ? rows.length : null}
                open={open}
                onToggle={collapsible ? onToggle : undefined}
                action={open ? <AddButton scene={scene.scene} onAdd={onAdd} /> : null}
            />
            {open && (loading
                ? <Text size="xs" dimmed className="px-2">Reading scene…</Text>
                : rows.length
                    ? rows.map((p) => {
                        const { name, detail } = label(p);
                        /*
                         * `parent` and `slot` are two different questions and the
                         * row asks both. INDENT is about the list — is there a row
                         * above me I hang off — while the RADIO is about the
                         * placement: a member's slot pushes, an own source shows
                         * and hides (`isFedPlacement`, ../placements). They travel
                         * together on a row either builder made, and part company
                         * on one resolved from a stored id.
                         */
                        return (
                            <RackRow
                                key={p.id} state={chipFor(p)} name={name} meta={detail}
                                nested={!!p.parent}
                                selected={selection === p.id} onSelect={() => onSelect(p.id)}
                                quickAction={p.slot
                                    ? <FeedAction placement={p} />
                                    : <EyeAction placement={p} />}
                                pinnable={isPinnable(p.element)} pinned={pinned.has(p.id)}
                                onPinToggle={() => onPinToggle(p.id)}
                                rowAction={<PlacementRemove placement={p} name={name} />}
                                stretch={stretchOfPlacement(p)} cropped={p.item?.cropped}
                            />
                        );
                    })
                    : <Text size="xs" dimmed className="px-2">No PRSH overlays here yet.</Text>
            )}
        </div>
    );
});

// Selection and rail pins are owned by the page when the console is assembled
// (one copy shared with the stage and the rail); the internal hooks are the
// standalone fallback so a Rack still works — and still persists — on its own.
/*
 * THE YELL.
 *
 * A stretched source is invisible in OBS and easy to miss on a row in a
 * collapsed scene, so the count comes to the top of the rack where a producer
 * cannot work around it — and it leads to the fix rather than just complaining:
 * pressing it selects the offending row, which opens the panel with the redraw
 * on it.
 *
 * NOT an app-wide banner, and that is a considered limit rather than timidity.
 * The two banners at the app root (sample data on air, a match identity
 * conflict) both mean the broadcast is showing THE WRONG THING — the wrong
 * players, canned content — and a producer must not be able to change tabs away
 * from either. A scaled source is showing the right thing at the wrong
 * fidelity: real, worth fixing, survivable for a whole show, and visible on
 * every surface a producer builds scenes on. Spending the loudest register on
 * it would teach them to scroll past the register, which costs the two that
 * matter.
 *
 * Counted over PLACEMENTS rather than scene items so it agrees exactly with the
 * rows below it: only PRSH's own sources, only in mirrored scenes, fed rows
 * folded into the container they belong to.
 */
const StretchNotice = memo(function StretchNotice({ placements, onSelect }) {
    const stretched = useMemo(
        () => placements.filter(p => stretchOfPlacement(p)),
        [placements],
    );
    if (!stretched.length) return null;

    const one = stretched.length === 1 ? stretched[0] : null;
    return (
        <button
            type="button"
            data-rack-stretch={stretched.length}
            onClick={() => onSelect(stretched[0].id)}
            className="mb-1 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-950/40 px-2 py-1.5 text-left hover:bg-amber-950/60"
        >
            <TriangleAlert size={13} className="shrink-0 text-amber-400" />
            <Text size="xs" className="min-w-0 text-amber-100/90">
                {one
                    ? `OBS is scaling ${one.item?.sourceName ?? 'a source'} — it is not being drawn at true size.`
                    : `OBS is scaling ${stretched.length} sources — they are not being drawn at true size.`}
            </Text>
        </button>
    );
});

export const Rack = memo(function Rack({
    selection: selectionProp, onSelect, pins: pinsProp, onPinToggle, onAdd,
}) {
    const status = useObsStore(s => s.status);
    const offline = useConsoleOffline();
    const scenes = useConsoleScenes();
    const placements = useConsolePlacements(scenes);
    const label = usePlacementLabel(placements);
    const [ownSelection, setOwnSelection] = useRackSelection();
    const [ownRail, setOwnRail] = useRailPins();
    const [openScenes, setOpenScenes] = useOpenScenes();
    const [shutTiers, setShutTiers] = useShutTiers();

    const selection = selectionProp ?? ownSelection;
    const setSelection = onSelect ?? setOwnSelection;
    const pins = pinsProp ?? seededRail(ownRail);
    const togglePin = onPinToggle ?? ((id) => setOwnRail(prev => togglePinIn(seededRail(prev), id, placements)));

    // Pins are compared by what they RESOLVE to, so a pin stored as the bare
    // `scoreboard` still lights the ◆ on the row it renders as.
    const pinned = useMemo(
        () => new Set(pins.map(p => placementTarget(p, placements))),
        [pins, placements],
    );

    const byScene = useMemo(() => {
        const m = new Map();
        for (const p of placements) {
            if (!m.has(p.scene)) m.set(p.scene, []);
            m.get(p.scene).push(p);
        }
        return m;
    }, [placements]);

    const toggleScene = (name) => setOpenScenes(prev => (
        (prev ?? []).includes(name)
            ? (prev ?? []).filter(s => s !== name)
            : [...(prev ?? []), name]
    ));

    const shut = new Set(shutTiers ?? []);
    const toggleTier = (tier) => setShutTiers(prev => (
        (prev ?? []).includes(tier)
            ? (prev ?? []).filter(t => t !== tier)
            : [...(prev ?? []), tier]
    ));

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
     * `sticky` is the missing half. The column now holds the viewport (less a
     * margin), its list fills it (`flex-1` over the panel's own height, never a
     * second copy of that arithmetic), and it stays put while the middle column
     * scrolls under it. `items-start` on the grid is what leaves it free to.
     *
     * ONLY WHILE IT IS ACTUALLY A SIDE COLUMN. Below the breakpoint that gives it
     * one, the grid is a single column and these are stacked blocks — a sticky
     * viewport-tall block there would pin one section over the whole screen and let
     * the rest slide under it. So the rack takes this at `lg` (where it first earns
     * a column) and the rail at `xl` (where it does), each matching the track it
     * appears in; stacked, both keep the old fixed box.
     *
     * `lg:row-span-2` is what makes that column the rack's ALONE. Between `lg`
     * and `xl` the grid has two columns and the rail wraps to a second row; a
     * sticky box is bounded by the whole GRID, not its own cell, so with the
     * rail auto-placed under it in column 1 the pinned rack slid down over the
     * rail's cards as the page scrolled. The rail goes under the STAGE there
     * (../rail), and the rack spans both rows of its column.
     */
    return (
        <Panel
            title="Rack"
            className={cn(
                'flex flex-col h-[calc(100vh-13rem)]',
                'lg:sticky lg:top-4 lg:row-span-2 lg:h-[calc(100vh-2rem)]',
            )}
        >
            <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-1 p-2">
                    <StretchNotice placements={placements} onSelect={setSelection} />
                    {/* MATCH FIRST. See DESKS for why the order flipped. */}
                    <DeskSection
                        open={!shut.has('desk')} onToggle={() => toggleTier('desk')}
                        selection={selection} onSelect={setSelection}
                        pinned={pinned} onPinToggle={togglePin}
                    />
                    <RigSection
                        open={!shut.has('rig')} onToggle={() => toggleTier('rig')}
                        selection={selection} onSelect={setSelection}
                        pinned={pinned} onPinToggle={togglePin}
                    />
                    {offline
                        ? (
                            <CatalogSection
                                rows={placements}
                                selection={selection} onSelect={setSelection}
                                pinned={pinned} onPinToggle={togglePin}
                                onAdd={onAdd} label={label}
                            />
                        )
                        : scenes.map(sc => (
                            <SceneSection
                                key={sc.scene} scene={sc} rows={byScene.get(sc.scene) ?? []}
                                open={sc.where !== 'other' || (openScenes ?? []).includes(sc.scene)}
                                onToggle={() => toggleScene(sc.scene)}
                                selection={selection} onSelect={setSelection}
                                pinned={pinned} onPinToggle={togglePin}
                                onAdd={onAdd} label={label}
                            />
                        ))}
                    {status !== 'connected' && (
                        <Text size="xs" dimmed className="px-2 pt-2">
                            {status === 'connecting'
                                ? 'Connecting to OBS…'
                                : 'OBS not connected, so this is everything PRSH can configure rather than '
                                  + 'what’s in your scenes. Authoring, previews and container feeds all work; '
                                  + 'showing and hiding needs OBS. Use + to copy a source URL. To connect: '
                                  + 'enable the WebSocket server in OBS (Tools → WebSocket Server Settings), '
                                  + 'then set it up on the Connections tab.'}
                        </Text>
                    )}
                </div>
            </ScrollArea>
        </Panel>
    );
});
