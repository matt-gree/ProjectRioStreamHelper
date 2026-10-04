import { memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import { KIT_SECTION } from '../kit';
import {
    CONTAINER_MEMBERS, CONTAINERS_PATH, useCarrying, useContainerDefs, useContainerTabSelection,
} from '../containers/containers';
import { useContainerAutomations, useFeedReason } from '../containers/automations';
import { useContainerPush } from '../containers/feeds';

/*
 * A container's SOURCE panel — the row a producer flies.
 *
 * It carries what is touched on air: show a member now, hold what a rule put
 * up, hand the container back. Everything that DEFINES the container — name,
 * roster, position, scope, rules, delete — is on the Containers tab
 * (src/routes/containers + ../containers/editor), because a definition outlives
 * every source of it. Authored in one place, flown in another.
 */

const membersOf = def => (def.members || [])
    .map(m => CONTAINER_MEMBERS.find(el => el.id === m))
    .filter(Boolean);

// On the container now — the one green thing on a row.
function CarryDot({ on }) {
    return (
        <span className={cn('size-1.5 shrink-0 rounded-full', on ? 'bg-emerald-400' : 'bg-foreground/25')}
            title={on ? 'On the container now' : undefined} />
    );
}

/*
 * THE MANUAL PICK — one button per roster row.
 *
 * `Show` puts this member on the container NOW, as a producer's push: the
 * rules pause until it is handed back, exactly as a Push from the member's own
 * rack row does (it is the same `useContainerPush`, landing in THIS container).
 * Two jobs, one control: lining a member up (it has to be on the container for
 * the preview below to draw it where its position puts it) and overriding the
 * rules on air. While the producer holds it, the button reads `Hand back` —
 * clearing is what returns a container to its rules; there is no Resume verb.
 *
 * A member a RULE is showing reads `Hold`: pressing it pins that member by
 * hand. Offering `Hand back` there would clear a feed the engine immediately
 * puts back, a press that visibly does nothing.
 */
const ShowButton = memo(function ShowButton({ element, def }) {
    const { feed, mine, staged, canPush, toggle, setFeed } = useContainerPush(element, def.scoreboard, def.id);
    const reason = useFeedReason(def.id);
    const held = mine && reason === 'manual';
    // A rule's member is HELD by writing what is already up as the producer's:
    // any feed write the engine did not make is a push.
    const onClick = held ? toggle : mine ? () => setFeed(feed, `Hold ${element.name} on ${def.name}`) : toggle;
    return (
        <Button
            size="xs" variant={held ? 'secondary' : 'ghost'}
            disabled={!canPush}
            title={!canPush ? `Pick what ${element.name} shows on its own row first`
                : held ? 'Give the container back to its rules'
                    : mine ? 'A rule put this up — hold it here by hand'
                        : `Put ${element.name} on the container now; the rules pause until you hand back`}
            onClick={onClick}
            className={cn('h-6 shrink-0', staged && 'text-amber-400')}
        >
            {held ? 'Hand back' : mine ? 'Hold' : 'Show'}
        </Button>
    );
});

/*
 * The on-air half: one row per member with the manual pick, and the way to the
 * Containers tab. Nothing here changes what the container IS.
 */
const OnAirRow = memo(function OnAirRow({ element, def, carrying }) {
    return (
        <div data-member={element.id} className="flex min-h-7 items-center gap-2 rounded-md px-1.5 hover:bg-accent/40">
            <CarryDot on={carrying} />
            <Text size="xs" span truncate className="min-w-0 flex-1 text-foreground">{element.name}</Text>
            <ShowButton element={element} def={def} />
        </div>
    );
});

export default function ContainerStage({ element, placement }) {
    const id = element.container ?? placement?.container;
    const defs = useContainerDefs();
    const def = id ? defs[id] : null;
    const carrying = useCarrying(id);
    const rules = useContainerAutomations(id);
    const openOnTab = useOpenOnContainersTab();

    /*
     * A source pointing at a container with no definition — a pre-2.0 named
     * shell, or one the producer deleted while its source was still in a scene.
     * It still renders whatever is fed to it, so the row and the Air slot are
     * honest; what it has no answer for is the roster.
     */
    if (!def) {
        return (
            <>
                <Text size="xs" className="text-amber-500/90">
                    No definition for “{id}”. The source still renders whatever is
                    fed to it, but nothing can be added to it until a container by
                    that name exists — build one on the Containers tab and point
                    this source at it.
                </Text>
            </>
        );
    }

    const members = membersOf(def);

    return (
        <>
            <div className={KIT_SECTION}>
                {members.length === 0 && (
                    <Text size="xs" dimmed className="px-1.5">Nothing on it yet.</Text>
                )}
                {members.map(el => (
                    <OnAirRow key={el.id} element={el} def={def} carrying={(placement?.carrying ?? carrying) === el.id} />
                ))}
            </div>

            <div className={cn(KIT_SECTION, 'flex-row items-center')}>
                <Text size="xs" span dimmed className="min-w-0 flex-1 truncate">
                    {summaryLine(def, members, rules.length)}
                </Text>
                <Button size="xs" variant="ghost" className="shrink-0" onClick={() => openOnTab(def.id)}>
                    Edit in Containers <ArrowRight />
                </Button>
            </div>
        </>
    );
}

// The definition in one line, for the source panel that no longer edits it.
function summaryLine(def, members, n) {
    return [
        `${members.length} ${members.length === 1 ? 'member' : 'members'}`,
        n ? `${n} ${n === 1 ? 'rule' : 'rules'}` : 'no rules',
        `${def.width} × ${def.height}`,
    ].join(' · ');
}

/*
 * Send the producer to this container on the Containers tab: select it there
 * (a browser-local key the tab reads on mount), then go.
 */
export function useOpenOnContainersTab() {
    const [, setSelected] = useContainerTabSelection();
    const navigate = useNavigate();
    return useCallback((id) => { setSelected(id); navigate(CONTAINERS_PATH); }, [setSelected, navigate]);
}
