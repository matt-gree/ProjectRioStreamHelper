import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../context/store';
import { boardOfUrl } from '../../lib/obs-binding';
import { SubjectRow } from './kit';
import { resolveIntent } from './suggest';
import { isPickableFeed } from './elements';
import { useContainerDefs, useContainerOf } from './containers';
import { isFedPlacement } from './placements';
import { memberName, useFeedReason } from './automations';
import { bandLine, useBands, useFieldValues } from './eventheader';
import { useSideLabels } from './sides';

/*
 * THE SUBJECT — what an element is currently drawing.
 *
 * Every console surface answered "what can I do to this" and none answered
 * "what is this showing". `BindingNote` names the OBS source, the chip names
 * the scene role, the strip gives you Bind · Air · Push — all of it wiring. A
 * producer looking at a panel titled "Roster · Team 2" could not tell from the
 * console whether team 2 was the player they meant, and Rio reassigns
 * away/home every game, so "Team 2" is a position, not an identity.
 *
 * This module is the other half. One line per placement, resolved from live
 * state, rendered in three places that must agree:
 *
 *   - the STAGE, above the binding note: the panel's subject before its knobs.
 *   - the RAIL, as row one of the direct flavor's quick face: what turns a
 *     pinned card from a duplicate of the rack row's eye into something worth
 *     the space. (A fed card has no room — its content picker IS its subject.)
 *   - nowhere else. The rack row is a scannable list and already carries the
 *     board/variant detail; a second line per row would cost the density that
 *     makes it a monitor.
 *
 * IT IS NOT A NEW IDEA, it is five existing ones named. The hit visualizer's
 * latest-hit line, the matchup's fetched series, the bracket's drawing-phase
 * note and the capture desk's score were each a hand-rolled subject in a stage
 * body, in four different shapes, reachable from nowhere else. Those move here.
 *
 * DISPATCH IS BY COMPONENT, not by a map of hooks: a subject reads live state,
 * so choosing a resolver with `SUBJECTS[id](placement)` would be a conditional
 * hook call. Same shape as ELEMENT_QUICK_FACES and STAGE_BODIES for the same
 * reason.
 *
 * A subject is ALWAYS derived from live state, never from settings or from what
 * the producer last picked — except an element with a PICK, whose subject is the
 * standing intent and says so, in the tense of the row it is on: what Push would
 * show on a container slot, what the overlay is already drawing on the element's
 * own source (which renders that key itself). If you find yourself wanting to
 * show a configured value here, that is a stage row, not a subject.
 */

// ── shared readouts ─────────────────────────────────────────────────────────

/*
 * Which side is batting, mirrored from `_team_role` (server/automations.py) and
 * `RioData.getTeamRole` (public/layout/lib/rio-data.js).
 *
 * Third runtime, third copy — the two that exist are in Python and in a static
 * layout lib that `src/` has no import path to, so this is the same split the
 * scoreboard's blank-reason predicate already lives with. `subject.test.jsx`
 * pins it; if you change what decides the role, change all three.
 */
export function battingSide(homeTeam, halfInning) {
    const home = Number(homeTeam) === 1 ? 1 : 2;
    const away = home === 2 ? 1 : 2;
    return (halfInning || 'Top') === 'Top' ? away : home;
}

/*
 * The live game on one board: who, the score, and where in the game we are.
 *
 * Exported because the board DESK draws the same line about the same board
 * (./desks/board). One sentence with two homes is how the console's two board
 * surfaces would start disagreeing about what is on air.
 */
export const BoardGameSubject = memo(function BoardGameSubject({ board }) {
    const { label } = useSideLabels();
    const g = useStateStore(useShallow(s => {
        const b = s?.score?.[board];
        return {
            n1: b?.player?.[1]?.rioName || '',
            n2: b?.player?.[2]?.rioName || '',
            l: b?.score_left, r: b?.score_right,
            inning: b?.inning, half: b?.half_inning,
        };
    }));
    if (!g.n1 && !g.n2) {
        // Deliberately not amber: an unbound board is an ordinary resting state.
        // ReadinessNote is what escalates, and only once the source is on air
        // with nothing to draw.
        return <SubjectRow text="No game on this board yet" />;
    }
    const inning = g.inning != null
        ? `${(g.half || 'Top') === 'Top' ? 'Top' : 'Bot'} ${g.inning}`
        : null;
    return (
        <SubjectRow
            text={`${g.n1 || label(1)} ${g.l ?? 0}–${g.r ?? 0} ${g.n2 || label(2)}`}
            meta={inning}
        />
    );
});

// One side of one board: who is sitting there right now, and what they're
// playing. The answer a `?team=` source cannot give about itself.
const SideSubject = memo(function SideSubject({ board, team }) {
    const p = useStateStore(useShallow(s => {
        const side = s?.score?.[board]?.player?.[team];
        return { name: side?.rioName || '', msbTeam: side?.msb_team || '' };
    }));
    const { label } = useSideLabels();
    const where = label(team);
    if (!p.name) return <SubjectRow text={`${where} — nobody on this side yet`} />;
    return <SubjectRow text={`${where} — ${p.name}`} meta={p.msbTeam || null} />;
});

/*
 * A container-SCOPED member (Stat Card, Roster) drawing off its container's
 * frame of reference — the side the definition names, and whoever that side has
 * on the field. This is the panel that used to read "No content options yet.",
 * which described the absence of a picker rather than the presence of content.
 */
const ScopedMemberSubject = memo(function ScopedMemberSubject({ element, container }) {
    /*
     * Prefer the container this ROW belongs to over a lookup from the element.
     * A container-scoped member is the one kind that may sit on several rosters
     * — that exception is what makes a mirrored pair buildable — so
     * `useContainerOf` answers with whichever container it finds first, and on a
     * mirrored pair that is a coin flip between the two sides. The placement
     * knows which one it is nested under; take it.
     */
    const { phrase } = useSideLabels();
    const defs = useContainerDefs();
    const { def: found } = useContainerOf(element);
    const def = (container ? defs[container] : null) ?? found;
    const board = def?.scoreboard ?? 1;
    const team = def?.team ?? 1;
    const live = useStateStore(useShallow(s => {
        const b = s?.score?.[board];
        return {
            name: b?.player?.[team]?.rioName || '',
            batter: b?.batter || '', pitcher: b?.pitcher || '',
            home: b?.home_team, half: b?.half_inning,
        };
    }));
    if (!def) return null;
    if (!live.name) return <SubjectRow text={`Draws ${phrase(team)} — nobody there yet`} />;
    const batting = battingSide(live.home, live.half) === team;
    const who = batting ? live.batter : live.pitcher;
    return (
        <SubjectRow
            text={`Draws ${live.name} — ${batting ? 'at bat' : 'pitching'}`}
            meta={who || null}
        />
    );
});

/*
 * A whole-game element (the Game Summary) drawing off a board's CAPTURE.
 *
 * It has no pick — a summary is the whole game — so "nothing picked yet" is a
 * sentence about a control it doesn't have. What it can say is what it will
 * draw: the captured game, or that there isn't one yet. On a container the
 * question is still "what would Push put up", which is FedSubject's job; this
 * is the same fact asked of the element's own source.
 */
const CaptureSubject = memo(function CaptureSubject({ board = 1 }) {
    const pg = useStateStore(useShallow(s => {
        const p = s?.postgame?.[board];
        return {
            present: !!p?.present,
            n1: p?.player?.[1]?.rioName || '', s1: p?.player?.[1]?.score,
            n2: p?.player?.[2]?.rioName || '', s2: p?.player?.[2]?.score,
        };
    }));
    if (!pg.present) return <SubjectRow text="No captured game on this board yet" />;
    return (
        <SubjectRow
            text={`${pg.n1 || 'Side 1'} ${pg.s1 ?? 0}–${pg.s2 ?? 0} ${pg.n2 || 'Side 2'}`}
            meta="captured"
        />
    );
});

/*
 * A fed element's subject is its standing INTENT — what Push would put up —
 * because that is the only content question it can answer off the container.
 * `resolveIntent` is the same answer the picker, the Push slot and the preview
 * read, so the four cannot disagree about what is armed.
 */
const FedSubject = memo(function FedSubject({ element, board = 1, fed = true, pickable = true }) {
    const intent = useStateStore(useShallow(s => {
        const i = resolveIntent(s, element, board);
        return { name: i?.name || '', has: !!i?.element, suggested: !!i?.suggested };
    }));
    /*
     * The same pick, said in the tense of the row. On a container slot it is
     * what Push WOULD show; on the element's own source the overlay is reading
     * that key already, so the pick is simply what is drawn and "Push" would be
     * naming a verb this panel doesn't have.
     *
     * A SUGGESTION IS NOT A PICK, and only the direct row can tell them apart.
     * `resolveIntent` proposes when there is no memory, which is exactly right
     * for "what would Push show" — but the element's own source renders the
     * stored key, not the proposal, so "Showing Mario" beside a source drawing
     * nothing is the panel disagreeing with its own preview.
     */
    const what = intent.name || 'this game';
    if (!intent.has || (!fed && intent.suggested)) {
        /*
         * "Nothing armed" is only true of an element that has something to arm.
         * A whole-game push has no pick and `canPush` is true regardless, so
         * the honest line is what the button will do.
         */
        const nothing = fed
            ? (pickable ? 'Nothing armed yet' : 'Push shows this game')
            : 'Nothing picked yet';
        return (
            <SubjectRow
                text={nothing}
                meta={!fed && intent.has ? `${what} suggested` : null}
            />
        );
    }
    return (
        <SubjectRow
            text={fed ? `Push shows ${what}` : `Showing ${what}`}
            meta={intent.suggested ? 'suggested' : null}
        />
    );
});

/*
 * A container's subject is its occupant AND why — the engine mirrors the
 * deciding tier to `production.feed.reason.{id}` precisely so a surface can say
 * it, the same instinct as `side_reason`. Without the reason a producer
 * watching a card appear cannot tell their own Push from a rule firing, which
 * is the difference between "wait for it to clear" and "clear it yourself".
 */
const REASON_WORD = { manual: 'you pushed it', rule: 'automation', resting: 'resting' };

const ContainerSubject = memo(function ContainerSubject({ container, carrying }) {
    const reason = useFeedReason(container);
    if (!carrying) return <SubjectRow text="Empty — nothing fed" />;
    return (
        <SubjectRow
            text={`Carrying ${memberName(carrying)}`}
            meta={REASON_WORD[reason] || null}
        />
    );
});

// ── element-specific subjects ───────────────────────────────────────────────

// Lifted out of HitVisualizerStage, which rendered this as its own `HitSummary`.
const HitSubject = memo(function HitSubject({ board = 1 }) {
    const h = useStateStore(useShallow(s => {
        const hit = s?.score?.[board]?.hit;
        return {
            has: Array.isArray(hit?.path) && hit.path.length > 0,
            batter: hit?.batter || '', result: hit?.result || '',
            distance: hit?.distance, invalid: hit?.valid === false, warning: hit?.warning || '',
        };
    }));
    if (!h.has) return <SubjectRow text="No hit captured yet" />;
    const parts = [h.result, h.distance != null ? `${h.distance}m` : null].filter(Boolean);
    return (
        <SubjectRow
            text={`Latest: ${h.batter || '—'}`}
            meta={[...parts, h.invalid ? '⚠ sim diverges' : null].filter(Boolean).join(' · ')}
            tone={h.invalid ? 'warn' : undefined}
            title={h.invalid ? h.warning : undefined}
        />
    );
});

// Lifted out of MatchupStage's own trailing line. Stale = fetched for a
// different match than the one the panel has selected, which is worth amber:
// the band is on air showing the wrong pair.
const MatchupSubject = memo(function MatchupSubject() {
    const mu = useStateStore(useShallow(s => {
        const m = s?.matchup ?? {};
        return {
            present: !!m.present,
            n1: m.side1?.rioName || '', w1: m.side1?.wins ?? 0,
            n2: m.side2?.rioName || '', w2: m.side2?.wins ?? 0,
            games: m.totalGames ?? 0,
        };
    }));
    if (!mu.present) return <SubjectRow text="Nothing fetched yet" />;
    return (
        <SubjectRow
            text={`${mu.n1} ${mu.w1}–${mu.w2} ${mu.n2}`}
            meta={`${mu.games} game${mu.games === 1 ? '' : 's'}`}
        />
    );
});

// Lifted out of BracketStage. A bracket source on air with no phase loaded
// renders empty, which is the one case worth escalating.
const BRACKET_TYPES = {
    DOUBLE_ELIMINATION: 'Double elimination',
    SINGLE_ELIMINATION: 'Single elimination',
    ROUND_ROBIN: 'Round robin',
};

const BracketSubject = memo(function BracketSubject() {
    const b = useStateStore(useShallow(s => ({
        name: s?.bracket?.phaseName || '', type: s?.bracket?.type || '',
    })));
    if (!b.name) return <SubjectRow text="No bracket loaded — this renders empty" tone="warn" />;
    return <SubjectRow text={`Drawing ${b.name}`} meta={BRACKET_TYPES[b.type] || b.type || null} />;
});

const CommentarySubject = memo(function CommentarySubject() {
    const c = useStateStore(useShallow(s => {
        const slots = Array.isArray(s?.commentary?.slots) ? s.commentary.slots : [];
        return { total: slots.length, on: slots.filter(x => x?.visible !== false).length };
    }));
    if (!c.total) return <SubjectRow text="No commentators" />;
    return <SubjectRow text={`${c.on} on air`} meta={c.total > c.on ? `of ${c.total}` : null} />;
});

const PlatesSubject = memo(function PlatesSubject() {
    const p = useStateStore(useShallow(s => ({
        n1: s?.playerplates?.[1]?.name || '', n2: s?.playerplates?.[2]?.name || '',
        mode: s?.playerplates?.config?.mode || 'both',
    })));
    const names = p.mode === 'p2' ? [p.n2] : p.mode === 'p1' ? [p.n1] : [p.n1, p.n2];
    const shown = names.filter(Boolean);
    if (!shown.length) return <SubjectRow text="No plate names set" />;
    return <SubjectRow text={shown.join(' · ')} meta={p.mode === 'both' ? null : 'single'} />;
});

const ScheduleSubject = memo(function ScheduleSubject() {
    const q = useStateStore(useShallow(s => {
        const queue = Array.isArray(s?.schedule?.queue) ? s.schedule.queue : [];
        const next = queue.length ? s?.match?.[String(queue[0])] : null;
        const names = [next?.player?.[1]?.rioName, next?.player?.[2]?.rioName].filter(Boolean);
        return { count: queue.length, next: names.join(' vs ') };
    }));
    if (!q.count) return <SubjectRow text="Nothing queued" />;
    return <SubjectRow text={`${q.count} queued`} meta={q.next ? `next: ${q.next}` : null} />;
});

/*
 * `enabled` is the slot's own gate, not `visible` — the mount reads
 * `slots.filter(s => s.enabled && s.type)`, so a slot with a type and no enable
 * draws nothing. Counting the wrong field would have the subject claim five
 * segments on a blank band.
 */
const LowerThirdSubject = memo(function LowerThirdSubject() {
    const lt = useStateStore(useShallow(s => {
        const slots = s?.lowerthird?.slots ?? {};
        let filled = 0;
        let on = 0;
        for (let i = 1; i <= 5; i++) {
            const slot = slots?.[i] ?? slots?.[String(i)];
            if (!slot?.type) continue;
            filled += 1;
            if (slot.enabled) on += 1;
        }
        return { filled, on };
    }));
    if (!lt.filled) return <SubjectRow text="No segments set" />;
    return <SubjectRow text={`${lt.on} of ${lt.filled} segments on`} />;
});

/*
 * The Event Header draws two strips of event facts, and its panel could not say
 * one of them — fourteen switches over content the producer had to go to another
 * tab to see.
 *
 * WHAT IT REPORTS IS THE STATE SIDE ONLY: the competition facts each band has to
 * work with, not the composed line the mount will render. The switches, the
 * separator and the message are settings, and a subject reads live state (the
 * module note above) — a configured value belongs in the stage row that
 * configures it, which for the message is now the row right below this one. The
 * preview under the panel is what shows the two bands as they will air; this row
 * is what tells the producer whether there is anything behind them.
 *
 * `board` is the placement's, so Round is read from the board this source is
 * actually pointed at rather than assumed to be 1.
 */
/*
 * Both bands, as they will actually draw — through the shared band model
 * (../eventheader), not a second hardcoded order. The fields are arrangeable
 * and overridable now, so a subject reading `[name, location, date]` would be
 * confidently wrong the moment a producer moved one or typed over it.
 */
const EventHeaderSubject = memo(function EventHeaderSubject({ board }) {
    const { bands } = useBands();
    const values = useFieldValues(board);
    const top = bandLine(bands.header, values).join(' · ');
    const bottom = bandLine(bands.footer, values).join(' · ');
    if (!top && !bottom) {
        return <SubjectRow text="No competition loaded — both bands render empty" tone="warn" />;
    }
    // The top band is the subject; the bottom band trails as its qualifier —
    // one row, two strips, in the order they sit on the canvas.
    return <SubjectRow text={top || 'Nothing for the header band'} meta={bottom || null} />;
});

const SUBJECTS = {
    hitvisualizer: HitSubject,
    matchuphistory: MatchupSubject,
    bracket: BracketSubject,
    eventheader: EventHeaderSubject,
    commentary: CommentarySubject,
    playerplates: PlatesSubject,
    schedule: ScheduleSubject,
    lowerthird: LowerThirdSubject,
};

/*
 * The subject for one placement.
 *
 * Resolution runs most-specific first, then by SHAPE — a declared subject, then
 * container, then container-scoped member, then fed, then the two identity axes
 * (board, then team variant). An element matching none of them has no subject
 * worth a line and renders nothing rather than a placeholder: "—" in a row that
 * exists to carry information is worse than the row not being there.
 *
 * The board for a variant source is read off the SOURCE's own url, not the
 * placement: `?team=` layouts are unregistered and take `scope: 'board'` from
 * nobody, so the placement's board is null while the URL still carries the
 * `?scoreboard=` the overlay itself reads.
 */
export const Subject = memo(function Subject({ placement }) {
    const { element } = placement ?? {};
    if (!element) return null;

    /*
     * The URL fallback is the same rule the team-variant branch below relies on,
     * applied one branch earlier: an element can read `?scoreboard=` without
     * declaring `scope: 'board'`, so the placement's board is null while the
     * source still carries the one the overlay itself resolves. The Event Header
     * is exactly that — full-canvas chrome whose Round comes off a board.
     */
    const Declared = SUBJECTS[element.id];
    if (Declared) {
        return <Declared board={placement.board ?? boardOfUrl(placement.item?.url) ?? 1} />;
    }

    if (element.container) {
        return <ContainerSubject container={element.container} carrying={placement.carrying} />;
    }
    /*
     * `containerScoped` is gated on this row being a member's SLOT, because
     * Roster is both: a container member AND a direct element with its own
     * `?team=` source. A slot draws off the container's frame of reference; the
     * element's own source draws off its URL's, and an ungated check handed the
     * Roster's own source the container's side and drew the wrong one. The gate
     * used to be `flavor === 'fed'`, which said the same thing back when only a
     * fed element could row under a container — it can't any more (see
     * placementFlavor), and a member that owns a source rows both ways.
     */
    if (element.containerScoped && (isFedPlacement(placement) || element.flavor === 'fed')) {
        return <ScopedMemberSubject element={element} container={placement.slot} />;
    }
    /*
     * An element with a PICK has one wherever it is drawn: on a container the
     * pick is what Push would send, and on the element's own source it is what
     * the overlay is already reading (production.feed.last.{id} — the spotlight
     * layout renders exactly that key). One answer, two sentences.
     */
    if (element.feed) {
        const fed = isFedPlacement(placement);
        // A whole-game element on its OWN source has no pick to report, so the
        // intent line would be describing a control it doesn't have. On a
        // container it still answers "what would Push put up".
        if (!fed && !isPickableFeed(element)) {
            return <CaptureSubject board={boardOfUrl(placement.item?.url) ?? 1} />;
        }
        return (
            <FedSubject
                element={element} board={placement.board ?? 1}
                fed={fed} pickable={isPickableFeed(element)}
            />
        );
    }
    if (element.scope === 'board' && placement.board != null) {
        return <BoardGameSubject board={placement.board} />;
    }

    const team = placement.variant === 't1' ? 1 : placement.variant === 't2' ? 2 : null;
    if (team) return <SideSubject board={boardOfUrl(placement.item?.url) ?? 1} team={team} />;

    return null;
});

/*
 * There is deliberately no `hasSubject()`.
 *
 * The rail looks like it wants one — budget a row before rendering it — and a
 * first cut had one, which promptly disagreed with `Subject` over a Stat Card
 * on no roster: the predicate said "fed elements always have a subject", the
 * component correctly drew nothing, because a scoped member with no container
 * has no frame of reference to draw from. That is one fact with two homes, and
 * a predicate that cannot read the store can never be the second one.
 *
 * It is also unnecessary. A component rendering null produces no flex item, so
 * a card with no subject collapses to its single toggle with no gap and no
 * placeholder. The two-row cap is a budget, not a quota.
 */
