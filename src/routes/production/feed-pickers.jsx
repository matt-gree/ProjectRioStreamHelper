import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../context/store';
import { Stack, Group, Text } from '../../components/ui/primitives';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { cn } from '../../lib/utils';
import { StagedDot } from './controls';
import { useFeedControl, useFeedSelect } from './feeds';
import { useContainerOf } from './containers';
import { resolveIntent } from './suggest';

// Stable empty intent — a fresh {} each render would defeat useShallow.
const NO_INTENT = Object.freeze({});

/*
 * Content pickers for the fed elements — picking IS feeding: the pick is
 * written (through the staging gateway) to production.feed.container.<id>,
 * which the shared container overlay renders.
 *
 * Each pickable element exposes its choices through a hook returning one
 * shape — { groups, value, choose, empty } — so the stage can render the full
 * picker and the rail card can render the same choices as a single kit row.
 * Before this, the rail could only re-push whatever the stage last picked,
 * which made a pinned Stats card useless on its own.
 */

/*
 * Which fed elements offer CHOICES, keyed by their `feed` kind — the options
 * hook each one exposes. Two consumers read it: the rail (which picker to
 * render as one row) and elements.js's PICKABLE_FEEDS (whether the source
 * strip's Push slot has anything to push before a pick has happened).
 * elements.test.js pins the two against each other.
 */
export const FEED_OPTION_HOOKS = {
    stats: useStatsFeedOptions,
    postgamecallout: usePostgameCalloutOptions,
};

// A rail-friendly flattening of grouped options: "Team — Character".
export function flattenGroups(groups) {
    return groups.flatMap(g => g.options.map(o => ({
        value: o.value,
        label: groups.length > 1 ? `${g.label} — ${o.label}` : o.label,
    })));
}

// Content picker for the 'stats' fed element: choose WHICH roster character's
// stats to put on the chosen shared container. Scoreboard 1 for now;
// multi-scoreboard is later.
export function useStatsFeedOptions(element, scoreboard = 1) {
    const { mine, staged, select, clear } = useFeedSelect(element, scoreboard);
    const players = useStateStore(s => s?.score?.[scoreboard]?.player);
    // The armed pick (intent) — what Push would air, and the live feed when this
    // element holds the container. Flattened for useShallow.
    const intent = useStateStore(useShallow(s => {
        const i = resolveIntent(s, element, scoreboard);
        return i ? { team: i.team, charIndex: i.charIndex, role: i.role || 'batting' } : NO_INTENT;
    }));

    // Build per-team option groups from the live roster (9 slots each).
    const teams = useMemo(() => {
        const out = [];
        for (const team of [1, 2]) {
            const p = players?.[team];
            const chars = [];
            for (let i = 0; i < 9; i++) {
                const name = p?.character?.[i]?.name;
                if (name) chars.push({ charIndex: i, name });
            }
            if (chars.length) {
                out.push({ team, label: p?.msb_team || p?.rioName || `Team ${team}`, chars });
            }
        }
        return out;
    }, [players]);

    const role = intent.role || 'batting';
    const selValue = intent.charIndex != null ? `${intent.team}:${intent.charIndex}` : '';

    const nameOf = (team, charIndex) =>
        teams.find(t => t.team === team)?.chars.find(c => c.charIndex === charIndex)?.name || 'stats';
    // Arms the pick; airs it only if this element already holds the container
    // (useFeedSelect). `name` rides along so a remembered pick can be
    // re-validated against the live roster before Push replays it — charIndex
    // alone goes stale when the game changes underneath it (suggest.js).
    const feed = (team, charIndex, r) =>
        select({ element: 'stats', scoreboard, team, charIndex, role: r, name: nameOf(team, charIndex) },
            `Feed stats: ${nameOf(team, charIndex)}`);
    const choose = (value) => {
        if (!value) { clear(); return; }
        const [team, charIndex] = value.split(':').map(Number);
        feed(team, charIndex, role);
    };
    const setRole = (r) => {
        if (!selValue) return;
        const [team, charIndex] = selValue.split(':').map(Number);
        feed(team, charIndex, r);
    };

    return {
        label: 'Content — whose stats to show',
        groups: teams.map(t => ({
            label: t.label,
            options: t.chars.map(c => ({ value: `${t.team}:${c.charIndex}`, label: c.name })),
        })),
        value: selValue, choose, staged, live: !!mine,
        role, setRole,
        empty: teams.length === 0
            ? `No roster in live state yet — start or load a game on scoreboard ${scoreboard}.`
            : null,
    };
}

export const StatsFeedPicker = memo(function StatsFeedPicker({ element, scoreboard = 1 }) {
    const o = useStatsFeedOptions(element, scoreboard);
    if (o.empty) return <Text size="sm" className="text-muted-foreground">{o.empty}</Text>;
    return (
        <Stack gap="xs">
            {/* "Nothing fed" only means something while on air — off air the
                select shows the armed pick, and a clear that isn't running would
                just snap back. */}
            <GroupedFeedSelect o={o} allowNone={o.live} />
            {o.value && (
                <SegmentedControl
                    data={[{ label: 'Batting', value: 'batting' }, { label: 'Pitching', value: 'pitching' }]}
                    value={o.role}
                    onChange={o.setRole}
                />
            )}
        </Stack>
    );
});

// The stage-width form of a grouped content picker: label + staged dot above a
// grouped select. Shared by every fed element that has choices.
const GroupedFeedSelect = memo(function GroupedFeedSelect({ o, allowNone = true }) {
    return (
        <label className="flex flex-col gap-1">
            <Group gap="xs" className="items-center">
                <Text size="xs" className="text-muted-foreground">{o.label}</Text>
                <StagedDot show={o.staged} />
            </Group>
            <select
                value={o.value}
                onChange={(e) => o.choose(e.target.value)}
                className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
            >
                {/* Kept when there is no selection at all, so the select has a
                    valid empty option to sit on rather than silently showing
                    the first character as if it were chosen. */}
                {(allowNone || !o.value) && <option value="">Nothing fed</option>}
                {o.groups.map(g => (
                    <optgroup key={g.label} label={g.label}>
                        {g.options.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </optgroup>
                ))}
            </select>
        </label>
    );
});

// Content picker for the 'postgamecallout' fed element: choose WHICH
// finished-game roster character gets the full-screen stat callout. Reads the
// capture at postgame.{N}.player.{T}.characters[].
export function usePostgameCalloutOptions(element, scoreboard = 1) {
    const { mine, staged, select, clear } = useFeedSelect(element, scoreboard);
    const present = useStateStore(s => s?.postgame?.[scoreboard]?.present);
    const players = useStateStore(useShallow(s => ({
        1: s?.postgame?.[scoreboard]?.player?.[1],
        2: s?.postgame?.[scoreboard]?.player?.[2],
    })));
    // The selection is the element's standing INTENT — the character Push would
    // air — not the container feed. Off the stage that's the last pick or a
    // suggestion; on the stage it equals the live feed (picking while mine
    // wrote both). Flattened to primitives so useShallow settles. See suggest.js.
    const intent = useStateStore(useShallow(s => {
        const i = resolveIntent(s, element, scoreboard);
        return i ? { team: i.team, charIndex: i.charIndex, suggested: !!i.suggested } : NO_INTENT;
    }));

    // Per-side option groups from the captured box score (9 roster slots each).
    const teams = useMemo(() => {
        const out = [];
        for (const team of [1, 2]) {
            const p = players?.[team];
            const chars = Array.isArray(p?.characters) ? p.characters : [];
            const opts = chars
                .map((c, i) => ({ charIndex: i, name: c?.name, isPitcher: c?.wasPitcher }))
                .filter(c => c.name);
            if (opts.length) out.push({ team, label: p?.rioName || `Side ${team}`, chars: opts });
        }
        return out;
    }, [players]);

    // The dropdown shows the intent whether or not this element is on air; the
    // label below says which. Intent equals the live feed when mine, so the two
    // never disagree.
    const selValue = intent.charIndex != null ? `${intent.team}:${intent.charIndex}` : '';

    const nameOf = (team, charIndex) =>
        teams.find(t => t.team === team)?.chars.find(c => c.charIndex === charIndex)?.name;
    const choose = (value) => {
        // Empty is only reachable while on air (allowNone below), where it means
        // take this off the stage — not un-pick.
        if (!value) { clear(); return; }
        const [team, charIndex] = value.split(':').map(Number);
        const name = nameOf(team, charIndex) || 'spotlight';
        // Arms the pick; airs it only if this element already holds the stage
        // (useFeedSelect). `name` rides along so the pick can be re-validated
        // against the next capture's roster (charIndex alone means nothing
        // across games).
        select({ element: 'postgamecallout', scoreboard, team, charIndex, name },
            `Feed spotlight: ${name}`);
    };

    return {
        label: 'Content — whose spotlight to show',
        groups: teams.map(t => ({
            label: t.label,
            options: t.chars.map(c => ({
                value: `${t.team}:${c.charIndex}`,
                label: `${c.name}${c.isPitcher ? ' (P)' : ''}`,
            })),
        })),
        value: selValue, choose, staged,
        live: !!mine,
        // True when the shown pick is this module's proposal rather than the
        // producer's own — the UI says so rather than implying they chose it.
        suggested: !mine && !!intent.suggested,
        selectedName: selValue
            ? nameOf(...selValue.split(':').map(Number)) || 'this character'
            : null,
        empty: (!present || teams.length === 0)
            ? `No captured game on scoreboard ${scoreboard} yet — capture a finished game first (the callout reads its box score).`
            : null,
    };
}

export const PostgameCalloutPicker = memo(function PostgameCalloutPicker({ element, scoreboard = 1 }) {
    const o = usePostgameCalloutOptions(element, scoreboard);
    if (o.empty) return <Text size="sm" className="text-muted-foreground">{o.empty}</Text>;
    return (
        <Stack gap="xs">
            {/* "Nothing fed" only means something while this element holds the
                stage. Off the stage the select shows the standing intent, and
                offering to clear a feed that isn't running would just snap the
                dropdown back to where it was. */}
            <GroupedFeedSelect o={o} allowNone={o.live} />
            {o.value && (
                <Text size="xs" className="text-muted-foreground">
                    {o.live
                        ? 'On the stage now — the spotlight plays once and holds on the spray'
                          + ' chart. Re-pick to swap the featured character.'
                        : o.suggested
                            ? `Suggested — ${o.selectedName} led the winning side in total bases.`
                              + ' Push to put the spotlight on the stage, or pick someone else.'
                            : `Not on the stage — Push shows ${o.selectedName}.`}
                </Text>
            )}
        </Stack>
    );
});

// Content control for the 'postgamevs' fed element (Game Summary): push the
// whole captured game — both sides — onto the shared Callout Stage. There is
// nothing to pick beyond the scoreboard: pushing writes
// production.feed.container.<id> = { element:'postgamevs', scoreboard } and
// the callout-stage container renders the player-vs-player summary from
// postgame.{N}.player.{T}.totals.
export const PostgameVsPicker = memo(function PostgameVsPicker({ element, scoreboard = 1 }) {
    const { container } = useContainerOf(element);
    const { value: selection, staged } = useFeedControl(container);
    const pg = useStateStore(useShallow(s => {
        const p = s?.postgame?.[scoreboard];
        return {
            present: p?.present, winnerSide: p?.meta?.winnerSide,
            n1: p?.player?.[1]?.rioName, s1: p?.player?.[1]?.score,
            n2: p?.player?.[2]?.rioName, s2: p?.player?.[2]?.score,
            hasTotals: !!p?.player?.[1]?.totals,
        };
    }));

    const mine = selection && selection.element === 'postgamevs'
        && (selection.scoreboard == null || selection.scoreboard === scoreboard);
    const occupiedByOther = selection && !mine;

    if (!pg.present) {
        return (
            <Text size="sm" className="text-muted-foreground">
                No captured game on scoreboard {scoreboard} yet — capture a finished game first
                (the summary reads its box score).
            </Text>
        );
    }

    return (
        <Stack gap="xs">
            <Group gap="xs" className="items-center">
                <Text size="sm" className="text-foreground">
                    <span className={cn(pg.winnerSide === 1 && 'font-bold')}>{pg.n1 || 'Side 1'}</span> {pg.s1 ?? 0}
                    <span className="mx-1 text-muted-foreground">–</span>
                    {pg.s2 ?? 0} <span className={cn(pg.winnerSide === 2 && 'font-bold')}>{pg.n2 || 'Side 2'}</span>
                </Text>
                <StagedDot show={staged} />
            </Group>
            {occupiedByOther && (
                <Text size="xs" className="text-muted-foreground">
                    Push replaces what the stage is showing.
                </Text>
            )}
            {!pg.hasTotals && (
                <Text size="xs" className="text-muted-foreground">
                    Older capture without side totals — re-capture to include Stars Won.
                </Text>
            )}
            {mine && (
                <Text size="xs" className="text-muted-foreground">
                    Show the callout-stage source on air; Clear hands the stage back.
                </Text>
            )}
        </Stack>
    );
});
