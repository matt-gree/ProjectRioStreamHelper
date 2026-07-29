import { memo, useMemo } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { Text } from '../../../components/ui/primitives';
import { ActionRow, IconToggle, ListRow, TextRow } from '../kit';
import {
    CONTAINER_MEMBERS, fitsContainer, useContainerActions, useContainerDefs,
} from '../containers';
import { BindingNote } from './generic';

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
 * so before the click rather than after.
 *
 * The size is fixed at creation and not editable here. It is the size of the
 * largest member (smaller ones center and are never scaled — PRSH has no
 * scaling system, OBS does placement), and changing it after the OBS source
 * exists would leave the source at its old dimensions with nothing to say so.
 * Making a second container and re-pointing is the honest path.
 */

// Which container currently holds each member, so a row can say what checking
// it would take the element away from.
function useHolders(defs) {
    return useMemo(() => {
        const out = {};
        for (const def of Object.values(defs)) {
            for (const m of def.members || []) out[m] = def.id;
        }
        return out;
    }, [defs]);
}

const MemberRow = memo(function MemberRow({ element, def, holder, holderName, carrying, setMember }) {
    const on = holder === def.id;
    const elsewhere = !!holder && !on;
    const smaller = element.width < def.width || element.height < def.height;
    return (
        <ListRow
            dot={carrying ? 'bg-emerald-400' : on ? 'bg-foreground/30' : 'bg-transparent'}
            name={element.name}
            meta={[
                carrying ? 'on the container' : null,
                // Say where it would come FROM, since checking is a move.
                elsewhere ? `held by ${holderName}` : null,
                // Centering is the one size relaxation, so name it where the
                // producer decides — not as a surprise on air.
                on && smaller ? `${element.width} × ${element.height} · centered` : null,
            ].filter(Boolean).join(' · ') || null}
            controls={(
                <IconToggle
                    icon={Check} offIcon={Plus} on={on}
                    label={on
                        ? `Remove ${element.name} from this container`
                        : elsewhere
                            ? `Move ${element.name} here from ${holderName}`
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
                        holder={holders[el.id]}
                        holderName={defs[holders[el.id]]?.name || holders[el.id]}
                        carrying={placement?.carrying === el.id}
                        setMember={setMember}
                    />
                ))}
            </div>

            <div className="mt-1 border-t border-border/60 pt-2">
                <ActionRow
                    actions={[{
                        label: 'Delete container', icon: Trash2, variant: 'destructive',
                        onClick: () => remove(def.id),
                        // Deleting the definition does NOT delete the OBS source
                        // — the console never removes a source the producer
                        // watched appear. It clears the feed and stops offering
                        // the container; the source is theirs to remove.
                        title: 'Removes the definition and clears its feed. The OBS source stays — delete it in OBS.',
                    }]}
                />
            </div>
        </>
    );
}
