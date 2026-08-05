import { memo, useMemo, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { Group, Stack, Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover';
import { IconToggle, ListRow, TextRow } from '../kit';
import {
    CONTAINER_MEMBERS, fitsContainer, isSharedMember, useContainerActions,
    useContainerDefs,
} from '../containers';
import { BindingNote } from './generic';
import AutomationSection from './automation';

/*
 * A container's stage panel — where a container is BUILT.
 *
 * The container is one OBS source that hosts whichever of its members the
 * producer feeds it, so this panel owns the two things that make it what it is:
 * its name, and its member roster. Membership used to be a "Feed into" select
 * on each fed element, i.e. one relationship stored in as many places as it had
 * ends. It is a roster here, and the elements read it.
 *
 * MEMBERS ARE MUTUALLY EXCLUSIVE, and that is the definition rather than
 * advice: `production.feed.container.{id}` holds exactly one occupant, so
 * sharing a container is what "these two never appear at once" means. Checking
 * an element that another container already holds MOVES it, and the roster says
 * so before the click rather than after — except for a container-SCOPED member
 * (a roster, a stat card), which has no content of its own to be in two places
 * at once and is added rather than moved. That exception is what makes a
 * mirrored pair buildable here instead of only by hand: two containers, the
 * same two members, opposite sides.
 *
 * The size is fixed at creation and not editable here. It is the size of the
 * largest member (smaller ones center and are never scaled — PRSH has no
 * scaling system, OBS does placement), and changing it after the OBS source
 * exists would leave the source at its old dimensions with nothing to say so.
 * Making a second container and re-pointing is the honest path.
 */

/*
 * Which OTHER containers hold each member, so a row can say what checking it
 * would take the element away from — or, for a shared member, who else is
 * already drawing it.
 */
function useHolders(defs) {
    return useMemo(() => {
        const out = {};
        for (const def of Object.values(defs)) {
            for (const m of def.members || []) (out[m] ??= []).push(def);
        }
        return out;
    }, [defs]);
}

const MemberRow = memo(function MemberRow({ element, def, holders, carrying, setMember }) {
    const on = (holders || []).some(h => h.id === def.id);
    const others = (holders || []).filter(h => h.id !== def.id);
    // A shared member is ADDED, not moved: several containers legitimately draw
    // it, because it has no content of its own to be in two places at once.
    const shared = isSharedMember(element);
    const elsewhere = others.length > 0;
    const otherNames = others.map(h => h.name).join(', ');
    const smaller = element.width < def.width || element.height < def.height;
    return (
        <ListRow
            dot={carrying ? 'bg-emerald-400' : on ? 'bg-foreground/30' : 'bg-transparent'}
            name={element.name}
            meta={[
                carrying ? 'on the container' : null,
                // Say where it would come FROM, since checking is a move —
                // unless it is shared, where nothing moves and the other
                // containers are context rather than a warning.
                elsewhere ? `${shared ? 'also on' : 'held by'} ${otherNames}` : null,
                // Centering is the one size relaxation, so name it where the
                // producer decides — not as a surprise on air.
                on && smaller ? `${element.width} × ${element.height} · centered` : null,
            ].filter(Boolean).join(' · ') || null}
            controls={(
                <IconToggle
                    icon={Check} offIcon={Plus} on={on}
                    label={on
                        ? `Remove ${element.name} from this container`
                        : elsewhere && !shared
                            ? `Move ${element.name} here from ${otherNames}`
                            : `Add ${element.name} to this container`}
                    onClick={() => setMember(def.id, element.id, !on)}
                />
            )}
        />
    );
});

export default function ContainerStage({ element, placement }) {
    const id = element.container ?? placement?.container;
    const defs = useContainerDefs();
    const def = id ? defs[id] : null;
    const holders = useHolders(defs);
    const { rename, remove, setMember } = useContainerActions();
    const [confirmDel, setConfirmDel] = useState(false);

    /*
     * A source pointing at a container with no definition — a pre-2.0 named
     * shell, or one the producer deleted while its source was still in a scene.
     * It still renders whatever is fed to it, so the row and the Air slot are
     * honest; what it has no answer for is the roster.
     */
    if (!def) {
        return (
            <>
                <BindingNote binding={placement} what="This container" />
                <Text size="xs" className="text-amber-500/90">
                    No definition for “{id}”. The source still renders whatever is
                    fed to it, but nothing can be added to it until a container by
                    that name exists — build one with the + beside a scene and
                    point this source at it.
                </Text>
            </>
        );
    }

    const candidates = CONTAINER_MEMBERS.filter(el => fitsContainer(el, def.width, def.height));

    return (
        <>
            <BindingNote binding={placement} what="This container" />
            <TextRow
                label="Name" value={def.name} placeholder={def.id}
                onChange={(v) => rename(def.id, v)}
            />
            <Text size="xs" className="text-muted-foreground">
                {def.width} × {def.height} — fixed at creation, since the OBS source
                is already that size. Members this size fill it; smaller ones center.
            </Text>

            <div className="mt-1 flex flex-col gap-1 border-t border-border/60 pt-2">
                <Text size="xs" className="text-muted-foreground">
                    Members — one at a time on screen, so anything sharing this
                    container can never be up together.
                </Text>
                {candidates.length === 0 ? (
                    <Text size="xs" className="text-muted-foreground">
                        Nothing fits {def.width} × {def.height}. A member must be the
                        container’s size or smaller — there is no scaling.
                    </Text>
                ) : candidates.map(el => (
                    <MemberRow
                        key={el.id}
                        element={el} def={def}
                        holders={holders[el.id]}
                        carrying={placement?.carrying === el.id}
                        setMember={setMember}
                    />
                ))}
            </div>

            <AutomationSection def={def} />

            {/* Two-step, the same Popover confirm the Match desk uses on its own
                delete — and this one has the LARGER blast radius: removing a
                definition takes its feed, its resting occupant and every
                automation rule that drove one of its members (`detach`/`dropRules`
                in ../containers). A producer who has wired a container up cannot
                rebuild that from the undo they don't have. */}
            <div className="mt-1 flex min-h-7 items-center border-t border-border/60 pt-2">
                <Popover open={confirmDel} onOpenChange={setConfirmDel}>
                    <PopoverTrigger asChild>
                        <Button size="xs" variant="destructive" className="h-7 min-w-0 flex-1">
                            <Trash2 />
                            <span className="truncate">Delete container</span>
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-60">
                        <Stack gap="xs">
                            <Text size="sm" className="text-foreground">Delete “{def.name || def.id}”?</Text>
                            {/* Deleting the definition does NOT delete the OBS
                                source — the console never removes a source the
                                producer watched appear. */}
                            <Text size="xs" className="text-muted-foreground">
                                Clears its feed and drops its members’ automation rules.
                                The OBS source stays — delete that in OBS.
                            </Text>
                            <Group gap="xs" className="justify-end">
                                <Button size="xs" variant="ghost" onClick={() => setConfirmDel(false)}>Cancel</Button>
                                <Button size="xs" variant="destructive" onClick={() => remove(def.id)}>Delete</Button>
                            </Group>
                        </Stack>
                    </PopoverContent>
                </Popover>
            </div>
        </>
    );
}
