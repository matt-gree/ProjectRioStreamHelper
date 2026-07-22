/*
 * What a fed element WOULD show — the standing intent behind Push.
 *
 * A shared container holds exactly one occupant, so pushing the Game Summary
 * onto the Callout Stage overwrites `production.feed.container.callout-stage`
 * and the Character Spotlight's pick goes with it. Coming back to the spotlight
 * then found nothing selected, and its Push slot had nothing to push — the
 * producer had to re-pick a character they had already chosen.
 *
 * Two things fix that, and they compose into ONE answer both the picker and the
 * Push slot read (`resolveIntent`), so the dropdown can never disagree with what
 * the button does:
 *
 *   1. MEMORY — every feed write also records itself at
 *      `production.feed.last.{element}` (see useFeedControl). Handing the
 *      container to someone else no longer erases the pick.
 *   2. SUGGESTION — with no usable memory, propose something worth showing
 *      rather than nothing.
 *
 * Memory is validated, never trusted: `charIndex` is an index into ONE game's
 * captured roster, so a pick remembered across a new capture would point at a
 * different character. Each payload carries the character's `name` and the
 * validator re-reads it from live state; a mismatch discards the memory and
 * falls back to the suggestion. This is why memory can outlive a game safely.
 */

// ── total bases ─────────────────────────────────────────────────────────────

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Total bases from a captured batting block (postgame_stats.batting_block).
 *
 * Prefers the singles form. Falls back to the algebraically identical
 * `hits + 2B + 2·3B + 3·HR` (hits = 1B+2B+3B+HR) so a capture written before
 * `singles` existed still ranks correctly instead of scoring everyone 0.
 */
export function totalBases(batting) {
    if (!batting) return 0;
    const d = num(batting.doubles), t = num(batting.triples), hr = num(batting.homeruns);
    return batting.singles == null
        ? num(batting.hits) + d + 2 * t + 3 * hr
        : num(batting.singles) + 2 * d + 3 * t + 4 * hr;
}

/**
 * Which side won a captured game: the capture's own verdict first, then the
 * per-side flag, then the score. Returns 1 | 2 | null.
 */
export function winningSide(pg) {
    const meta = Number(pg?.meta?.winnerSide);
    if (meta === 1 || meta === 2) return meta;
    if (pg?.player?.[1]?.isWinner) return 1;
    if (pg?.player?.[2]?.isWinner) return 2;
    const s1 = pg?.player?.[1]?.score, s2 = pg?.player?.[2]?.score;
    if (Number.isFinite(s1) && Number.isFinite(s2) && s1 !== s2) return s1 > s2 ? 1 : 2;
    return null;
}

/*
 * The opening suggestion: the winning side's biggest bat.
 *
 * Total bases rather than hits or average because it is the one counting stat
 * that separates a three-single game from a three-homer one, which is the
 * difference between a spotlight worth cutting to and a dull one. Ties break on
 * homeruns, then RBI, then roster order — deterministic, so the same capture
 * always suggests the same character.
 *
 * Scoped to the WINNER because a losing player's big day is a story the
 * producer chooses, not one to volunteer. Sides are only pooled when the
 * capture can't say who won (a tie, or a malformed capture) — better to suggest
 * the game's best line than nothing.
 *
 * Deliberately the floor, not the ceiling: pitching gems, star-chance heroics
 * and series context all deserve a say. Add them as further rankers here so
 * every surface keeps reading one answer.
 */
export function spotlightSuggestion(state, scoreboard = 1) {
    const pg = state?.postgame?.[scoreboard];
    if (!pg?.present) return null;

    const side = winningSide(pg);
    const sides = side ? [side] : [1, 2];

    let best = null;
    for (const team of sides) {
        const chars = pg?.player?.[team]?.characters;
        if (!Array.isArray(chars)) continue;
        chars.forEach((c, charIndex) => {
            if (!c?.name) return;
            const b = c.batting;
            const cand = {
                team, charIndex, name: c.name,
                tb: totalBases(b), hr: num(b?.homeruns), rbi: num(b?.rbi),
            };
            if (!best
                || cand.tb > best.tb
                || (cand.tb === best.tb && cand.hr > best.hr)
                || (cand.tb === best.tb && cand.hr === best.hr && cand.rbi > best.rbi)) {
                best = cand;
            }
        });
    }
    if (!best) return null;
    return {
        element: 'postgamecallout', scoreboard,
        team: best.team, charIndex: best.charIndex, name: best.name,
        // Marks the payload as proposed rather than chosen, so a surface can
        // say "suggested" instead of implying the producer picked it.
        suggested: true,
    };
}

// ── memory validation ───────────────────────────────────────────────────────

// A remembered pick still names the same character in the CURRENT capture.
function spotlightValid(state, p) {
    const chars = state?.postgame?.[p?.scoreboard ?? 1]?.player?.[p?.team]?.characters;
    return !!p?.name && Array.isArray(chars) && chars[p?.charIndex]?.name === p.name;
}

// Same test against the LIVE roster for the stats element.
function statsValid(state, p) {
    const name = state?.score?.[p?.scoreboard ?? 1]?.player?.[p?.team]
        ?.character?.[p?.charIndex]?.name;
    return !!p?.name && name === p.name;
}

/*
 * Per-feed intent rules. A feed with no entry has no memory validation and no
 * suggestion — its remembered payload is replayed as-is, which is right for a
 * whole-game push like the Game Summary (nothing in it can go stale).
 */
export const FEED_INTENT = {
    postgamecallout: { valid: spotlightValid, suggest: spotlightSuggestion },
    stats: { valid: statsValid },
};

/**
 * What Push would put on the container for this element, or null.
 * Memory first (it is the producer's own choice), suggestion second.
 *
 * Returns a flat, directly-pushable feed payload — call it inside a
 * `useShallow` selector and it re-renders only when the answer really changes.
 */
export function resolveIntent(state, element, scoreboard = 1) {
    if (!element) return null;
    const spec = FEED_INTENT[element.feed];
    const last = state?.production?.feed?.last?.[element.id];
    if (last && (!spec?.valid || spec.valid(state, last))) return last;
    return spec?.suggest ? spec.suggest(state, scoreboard) : null;
}
