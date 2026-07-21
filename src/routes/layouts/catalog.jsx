import { memo, useState, useMemo } from 'react';
import { Stack, Text } from '../../components/ui/primitives';
import { Collapsible, CollapsibleContent } from '../../components/ui/collapsible';
import { itemClass } from './shared';
import { useLayoutBinding, BindingDot, CopyIconButton } from './binding';

const LayoutItem = memo(function LayoutItem({ item, selected, onSelect, activeTab }) {
    const copyUrl = useMemo(() => {
        try {
            const u = new URL(item.url);
            u.searchParams.set('scoreboard', activeTab);
            return u.toString();
        } catch { return item.url; }
    }, [item.url, activeTab]);

    const binding = useLayoutBinding(copyUrl);

    return (
        <button type="button" onClick={() => onSelect(item)} className={itemClass(selected?.url === item.url)}>
            <div className="flex flex-nowrap items-center justify-between gap-1">
                <div className="min-w-0 flex-1">
                    <Text size="sm" truncate>
                        {item.sizeVariant
                            ? `${item.sizeLabel} (${item.sizeVariant.toUpperCase()})`
                            : item.name}
                    </Text>
                    {item.width && item.height && (
                        <Text size="xs" dimmed>{item.width} x {item.height}</Text>
                    )}
                </div>
                <BindingDot binding={binding} />
                <CopyIconButton value={copyUrl} />
            </div>
        </button>
    );
});

// Order in which team layouts appear in the two-column section
const TEAM_LAYOUT_ORDER = ['roster', 'stats', 'rosterstats', 'teamlogo', 'playername'];

// Layout types that play a reveal animation when their OBS source is shown.
// Only these expose the "Intro animation" toggle (turning it off makes the
// source resident instead of reloading on show — see obs.jsx desiredShutdown).
const ANIMATED_TYPES = new Set([
    'scoreboard', 'scorecard', 'lowerthird', 'matchup', 'commentary', 'playerplates', 'hitvisualizer',
]);

const LayoutList = memo(function LayoutList({ layouts, selected, onSelect, activeTab }) {
    const [expandedGroups, setExpandedGroups] = useState({});

    if (layouts.length === 0) {
        return (
            <Text size="sm" dimmed>
                No layouts found for this scoreboard.
            </Text>
        );
    }

    const sizeVariantLayouts = layouts.filter(l => l.sizeVariant);
    const teamLayouts = layouts.filter(l => l.team != null);
    const otherLayouts = layouts.filter(l => !l.sizeVariant && l.team == null);

    const groups = {};
    for (const item of sizeVariantLayouts) {
        const key = `${item.group}/${item.parentName}`;
        if (!groups[key]) groups[key] = { parentName: item.parentName, items: [] };
        groups[key].items.push(item);
    }

    const toggleGroup = (key) => {
        setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const isGroupActive = (items) => items.some(i => i.url === selected?.url);

    const team1 = TEAM_LAYOUT_ORDER.map(t => teamLayouts.find(l => l.type === t && l.team === 1)).filter(Boolean);
    const team2 = TEAM_LAYOUT_ORDER.map(t => teamLayouts.find(l => l.type === t && l.team === 2)).filter(Boolean);

    return (
        <Stack gap="xs">
            {Object.entries(groups).map(([key, { parentName, items }]) => {
                const open = expandedGroups[key] || isGroupActive(items);
                return (
                    <div key={key}>
                        <button type="button" onClick={() => toggleGroup(key)} className={itemClass(isGroupActive(items))}>
                            <div className="flex flex-nowrap items-center justify-between">
                                <Text size="sm" fw={600}>{parentName}</Text>
                                <Text size="xs" dimmed>
                                    {open ? '▴' : '▾'} {items.length} sizes
                                </Text>
                            </div>
                        </button>
                        <Collapsible open={open}>
                            <CollapsibleContent>
                                <Stack gap="xs" className="pl-3 pt-1">
                                    {items.map((item) => (
                                        <LayoutItem key={item.url} item={item} selected={selected} onSelect={onSelect} activeTab={activeTab} />
                                    ))}
                                </Stack>
                            </CollapsibleContent>
                        </Collapsible>
                    </div>
                );
            })}

            {otherLayouts.length > 0 && (
                <Stack gap="xs">
                    {otherLayouts.map((item) => (
                        <LayoutItem key={item.url} item={item} selected={selected} onSelect={onSelect} activeTab={activeTab} />
                    ))}
                </Stack>
            )}

            {(team1.length > 0 || team2.length > 0) && (
                <div className="mt-1 border-t border-border pt-2">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <Text size="xs" fw={600} dimmed className="mb-1 uppercase tracking-wide">Team 1</Text>
                            <Stack gap="xs">
                                {team1.map((item) => (
                                    <LayoutItem key={item.url} item={item} selected={selected} onSelect={onSelect} activeTab={activeTab} />
                                ))}
                            </Stack>
                        </div>
                        <div>
                            <Text size="xs" fw={600} dimmed className="mb-1 uppercase tracking-wide">Team 2</Text>
                            <Stack gap="xs">
                                {team2.map((item) => (
                                    <LayoutItem key={item.url} item={item} selected={selected} onSelect={onSelect} activeTab={activeTab} />
                                ))}
                            </Stack>
                        </div>
                    </div>
                </div>
            )}
        </Stack>
    );
});

export { LayoutItem, ANIMATED_TYPES, LayoutList };
