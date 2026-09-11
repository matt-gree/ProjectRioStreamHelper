import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../context/store';
import { Stack, Group, Text } from '../../components/ui/primitives';
import { Combobox } from '../../components/ui/combobox';
import { useAssetUrls } from '../../lib/assets';
import { cn } from '../../lib/utils';
import { StagedDot } from './controls';
import { useFeedControl, useFeedSelect } from './feeds';
import { useContainerOf } from './containers';
import { resolveIntent } from './suggest';
import { FieldRow, StatusLine } from './kit';

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
 * which made a pinned card useless on its own.
 */

/*
 * Which fed elements offer CHOICES, keyed by their `feed` kind — the options
 * hook each one exposes. Two consumers read it: the rail (which picker to
 * render as one row) and elements.js's PICKABLE_FEEDS (whether the source
 * strip's Push slot has anything to push before a pick has happened).
 * elements.test.js pins the two against each other.
 */
export const FEED_OPTION_HOOKS = {
    postgamecallout: usePostgameCalloutOptions,
};

/*
 * A rail-friendly flattening of grouped options: "Team — Character · line".
 *
 * The rail card is a 252px column with a native select in it, which has no
 * second line and no sprite to give an option — so everything an option knows
 * has to fold back into the one string. The stage's picker takes the same
 * options apart again (../components/ui/combobox `detail`), which is why they
 * are carried as fields rather than pre-composed by the hook.
 */
export function flattenGroups(groups) {
    return groups.flatMap(g => g.options.map(o => ({
        value: o.value,
        label: (groups.length > 1 ? `${g.label} — ${o.label}` : o.label)
            + (o.detail ? ` · ${o.detail}` : ''),
    })));
}

/*
 * THE STAGE-WIDTH CONTENT PICKER, and the whole readout with it.
 *
 * It was a native `<select>` of eighteen bare-ish names with a line under it
 * saying "SHOWING Bowser" — which is the control's own value, restated in grey
 * an inch below the control. A closed picker already says what is picked; the
 * only reason a caption was carrying it is that the picker was too thin to be
 * worth reading, so the fix is the picker, not a second copy of its value.
 *
 * So: search, the character's own sprite, and its line at the plate on the
 * option itself (the shared Combobox's `image` + `detail`). Both survive into
 * the closed trigger, which is what lets the caption go — and the sprite is
 * what makes a nine-deep roster scannable at all, because a producer knows the
 * face before they have read the name.
 *
 * WHAT IS NOT HERE IS ANY READOUT AT ALL — not the tense (is this on the
 * stage, or is it what Push would put there) and not "this is our suggestion,
 * nobody has picked yet". Both of those are the PANEL's subject, which says
 * them in the header of this very panel: "Push shows Boo · suggested"
 * (../subject `FedSubject`). The console has one home for "what is this
 * showing", and this row is a control.
 *
 * The suggestion marker is the one worth naming, because it is the one with a
 * real argument for living here: a value on a closed picker reads as chosen,
 * and the picker cannot say otherwise about itself. It is still a second copy
 * of a word the header already carries an inch away, in the same panel, and a
 * second copy is exactly what this pass is removing.
 */
const GroupedFeedSelect = memo(function GroupedFeedSelect({ o, allowNone = true }) {
    const data = useMemo(() => o.groups.flatMap(g => g.options.map(opt => ({
        value: opt.value,
        label: opt.label,
        detail: opt.detail,
        image: opt.image,
        // One group is no grouping: a heading over the only section on a
        // single-sided capture is a label for the list as a whole.
        group: o.groups.length > 1 ? g.label : undefined,
    }))), [o.groups]);
    return (
        <FieldRow label={o.label} staged={o.staged}>
            <Combobox
                data={data}
                value={o.value || null}
                onChange={(v) => o.choose(v || '')}
                // Clearing is only offered where it MEANS something — on air it
                // takes this off the stage. Off air there is no feed to clear,
                // so an × could only snap the picker back to where it was.
                clearable={allowNone}
                clearLabel="Take this off the stage"
                // The two sides are PEERS of a known size — nine roster slots
                // each — and the choice is made by comparing them, so they sit
                // side by side and the list is tall enough to finish both.
                // Stacked, a producer scrolls past one whole team to reach the
                // other and can never see the two days at once.
                columns
                className="h-7 min-w-0 flex-1 bg-card"
                placeholder="Nothing fed"
                searchPlaceholder="Search characters…"
                nothingFound="No characters in this capture"
            />
            <StagedDot show={o.staged} />
        </FieldRow>
    );
});

/*
 * WHAT THIS CHARACTER DID AT THE PLATE, in one line, on the option itself.
 *
 * The list used to be nine bare names per side, which asks a producer to
 * remember a box score they are standing next to — the whole reason to
 * spotlight someone is what they did, and the dropdown said nothing about it.
 *
 * BATTING, FOR EVERYONE, PITCHERS INCLUDED. The callout is a batting graphic:
 * its AB Theater replays every plate appearance and holds on the spray chart,
 * and the pitching box beside it is a static panel at final numbers ("the
 * walkthrough narrates the batting story, not these" — postgame-callout-mount).
 * So a pitcher's ERA answers a question this picker is not asking. Describing
 * the one pitcher by their outing also broke the LIST: nine rows measured the
 * same way can be scanned for the best day at the plate, and eight-plus-one
 * cannot — and total bases, the metric behind the suggestion this dropdown
 * opens on, ranks pitchers as batters too. `(P)` still marks them, which is
 * context for a short line rather than a different kind of line.
 *
 * `batting.line` IS THE WHOLE LINE. `format_batting_line`
 * (server/rio/pyrio/stat_formatters.py) already appends every non-zero count
 * stat in a fixed order — HR, 3B, 2B, BB, HBP, RBI, SB — with the count elided
 * at one, so Bowser's line is "1-for-3, HR, 3 RBI" and not "1-for-3". Appending
 * HR and RBI to it printed both twice ("1-for-3, HR, 3 RBI, 1 HR, 3 RBI"), and
 * the reason it was not obvious is worth keeping: the sample capture's first
 * character is a 4-for-5 with no extras, so the bare form is the only one that
 * shows up in a fixture — and the unit test asserted a hand-written `line`
 * beside separate `homeruns`/`rbi` fields, a combination the server cannot
 * produce. The test encoded the bug.
 *
 * So this reads and does not rewrite. It also gets a better convention for
 * free: "HR" rather than "1 HR", and the doubles, walks and steals a hand-rolled
 * summary was dropping.
 */
export function characterSummary(c) {
    const b = c?.batting;
    if (!b) return '';
    // The one fallback, and deliberately only the H-for-AB stem: it is a
    // compatibility floor for a capture written before `line` existed, not a
    // second formatter that can drift from the server's.
    if (b.line) return b.line;
    return b.at_bats != null ? `${Number(b.hits) || 0}-for-${b.at_bats}` : '';
}

// Content picker for the 'postgamecallout' fed element: choose WHICH
// finished-game roster character gets the full-screen stat callout. Reads the
// capture at postgame.{N}.player.{T}.characters[].
export function usePostgameCalloutOptions(element, scoreboard = 1) {
    const { mine, staged, select, clear } = useFeedSelect(element, scoreboard);
    // Cache-busted through the assets store, so a pack dropped in while the
    // console is open shows up without a reload (../../lib/assets).
    const { charIcon } = useAssetUrls();
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
                .map((c, i) => ({
                    charIndex: i, name: c?.name, isPitcher: c?.wasPitcher,
                    summary: characterSummary(c),
                }))
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
        // The dropdown below lists characters; an apposition explaining that
        // it lists characters is a label explaining its own control.
        label: 'Content',
        /*
         * AN OPTION IS THREE FIELDS, NOT ONE STRING. The name is what is
         * scanned for, the sprite is what is recognised before the name is
         * read, and the batting line is what the choice is actually made on —
         * and each surface composes them differently: the stage's picker draws
         * all three (icon · name over line), the rail's native select can only
         * fold them back into one label (flattenGroups above). Composed here,
         * the rail's version would be the only one and the stage could not take
         * it apart again.
         */
        groups: teams.map(t => ({
            label: t.label,
            options: t.chars.map(c => ({
                value: `${t.team}:${c.charIndex}`,
                // `(P)` is context for a short line, not a different KIND of
                // line — every option is measured as a batter, pitchers
                // included, or a nine-row list stops being scannable for the
                // one thing it is scanned for (see characterSummary).
                label: `${c.name}${c.isPitcher ? ' (P)' : ''}`,
                detail: c.summary || null,
                // undefined for a character the MSB pack has no id for; the
                // picker leaves the space and draws nothing.
                image: charIcon(c.name),
            })),
        })),
        value: selValue, choose, staged,
        live: !!mine,
        // True when the shown pick is this module's proposal rather than the
        // producer's own — the UI says so rather than implying they chose it.
        suggested: !mine && !!intent.suggested,
        empty: (!present || teams.length === 0)
            ? `No captured game on scoreboard ${scoreboard} yet — capture a finished game first (the callout reads its box score).`
            : null,
    };
}

/*
 * `fed` is which ROW this picker is on, and it has never changed the pick — a
 * pick writes the element's standing intent either way (useFeedSelect), and
 * that one key is both what Push sends to a container and what the element's
 * own source renders. What it used to change was a caption under the dropdown,
 * one of five: SHOWING / ON STAGE / PUSH SHOWS / SUGGESTED (×2), each followed
 * by the character's name.
 *
 * ALL FIVE ARE GONE, and they went for two different reasons.
 *
 * The NAME was the control's own value, printed again a row below the control
 * — and now that the picker carries a sprite and a batting line, its closed
 * trigger says more than the caption did.
 *
 * The TENSE — is this on the stage, or is it what Push would put there — is the
 * panel's SUBJECT, which the header of this very panel already draws and which
 * is the console's one home for "what is this showing" (../subject). A body row
 * saying it again is a second opinion that can only ever agree or be a bug.
 *
 * The one fact neither of those covers is that nothing has been picked at all
 * and the value on screen is our proposal. That is a state, so it is an
 * indicator on the control (GroupedFeedSelect), not a sentence under it.
 */
export const PostgameCalloutPicker = memo(function PostgameCalloutPicker({
    element, scoreboard = 1, fed = true,
}) {
    const o = usePostgameCalloutOptions(element, scoreboard);
    if (o.empty) return <Text size="sm" className="text-muted-foreground">{o.empty}</Text>;
    // Clearing only means something while this element holds the stage, where
    // it takes the callout off it. Off the stage the picker shows the standing
    // intent and there is no feed to clear.
    return <GroupedFeedSelect o={o} allowNone={fed && o.live} />;
});

// Content control for the 'postgamevs' fed element (Game Summary): push the
// whole captured game — both sides — onto the shared Callout Stage. There is
// nothing to pick beyond the scoreboard: pushing writes
// production.feed.container.<id> = { element:'postgamevs', scoreboard } and
// the callout-stage container renders the player-vs-player summary from
// postgame.{N}.player.{T}.totals.
export const PostgameVsPicker = memo(function PostgameVsPicker({
    element, scoreboard = 1, fed = true,
}) {
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
            {/* The captured game — but only where the panel isn't already
                saying it. On the element's own source the SUBJECT is this
                score (a whole-game element has no pick to report instead), and
                printing it twice an inch apart is the noise a subject row was
                supposed to remove. On a container slot the subject is "Push
                shows this game", so the score belongs here. */}
            {/*
              * THE SCORE LINE IS WHAT THIS SOURCE DRAWS, so it renders on BOTH
              * rows. It was gated on `fed`, which left the element's own panel
              * with no readout at all and a sentence apologising for the
              * missing picker in its place — "there is nothing to pick. The eye
              * puts it on air", a caption for the rack's own icon. The absence
              * of a dropdown is not a thing to explain; the captured game is.
              */}
            {(
                <Group gap="xs" className="items-center">
                    <Text size="sm" className="text-foreground">
                        <span className={cn(pg.winnerSide === 1 && 'font-bold')}>{pg.n1 || 'Side 1'}</span> {pg.s1 ?? 0}
                        <span className="mx-1 text-muted-foreground">–</span>
                        {pg.s2 ?? 0} <span className={cn(pg.winnerSide === 2 && 'font-bold')}>{pg.n2 || 'Side 2'}</span>
                    </Text>
                    <StagedDot show={staged} />
                </Group>
            )}
            {/* A real consequence, not an instruction: the stage is occupied by
                something else, so Push evicts it. Said on the eyebrow that
                names the state rather than as a line under the button. */}
            {fed && occupiedByOther && (
                <StatusLine
                    label="STAGE BUSY"
                    title="Another member is on the callout stage. Push replaces what it is showing."
                />
            )}
            {!pg.hasTotals && (
                <StatusLine
                    tone="warn"
                    label="NO TOTALS"
                    title="This capture predates side totals — re-capture the game to include Stars Won."
                />
            )}


        </Stack>
    );
});
