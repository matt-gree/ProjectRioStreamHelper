import { memo } from 'react';
import { Text } from '../../../components/ui/primitives';
import { ToggleRow, SelectRow } from '../kit';
import { setSourceVisibility, useDisplayedEnabled, useElementBindings } from '../bindings';
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

// Shown wherever an element's OBS source isn't in the program or preview
// scene: the controls would be lying, so say why instead.
export const Unbound = memo(function Unbound({ what = 'This overlay' }) {
    return (
        <Text size="xs" className="text-muted-foreground">
            {what} isn’t in the program or preview scene — add its browser source in OBS.
        </Text>
    );
});

// Plain direct element (e.g. scoreboard): one control, show/hide on air.
export const DirectStage = memo(function DirectStage({ element }) {
    const { primary } = useElementBindings(element);
    if (!primary) return <Unbound />;
    return (
        <SourceToggleRow
            label={primary.where === 'preview' ? 'Show in preview' : 'Show on air'}
            item={primary.item} sceneName={primary.scene}
        />
    );
});

// Which named shared container an element feeds, plus that container source's
// own on-air toggle when OBS has it — so the container can be revealed here.
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
            {binding ? (
                <SourceToggleRow
                    label={binding.where === 'preview' ? 'Container in preview' : 'Container on air'}
                    item={binding.item} sceneName={binding.scene}
                />
            ) : (
                <Unbound what="That container" />
            )}
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
