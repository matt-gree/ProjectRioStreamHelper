/*
 * spotlight-intent.js — WHICH character the Character Spotlight is about.
 *
 * ONE STATEMENT OF THE RULE, IN BOTH RUNTIMES. The console's picker (which says
 * who is spotlighted, and whose Push airs them) and the element's own OBS source
 * (which draws them) are two programs reading one piece of state, and they were
 * reading it differently:
 *
 *   console   memory, VALIDATED against the current capture, else the suggestion
 *   overlay   `production.feed.last.postgamecallout`, raw
 *
 * A `charIndex` is an index into ONE game's captured roster, so the moment the
 * next game was captured the raw read pointed at whoever now sits in that slot.
 * The panel said "Suggested — Yoshi", the source drew the previous game's pick
 * by position, and spotlight.html's own comment promised the two "can never
 * disagree about who is being spotlighted". They disagreed on every game after
 * the first.
 *
 * So the rule lives here, in the overlay runtime, dependency-free, and
 * `src/routes/production/suggest.js` imports it — the same shape as
 * `container-members.js`, which the console imports rather than keeping a
 * second copy of. A parity TEST would only prove two implementations agreed on
 * the cases someone thought to write down; there is one implementation instead.
 *
 * State is read NESTED (`state.postgame[N].player[T]`), which is what both
 * runtimes hold: OverlayBase.deepSet builds nested objects out of the dotted
 * keys on the wire, and the console's store is nested too.
 */

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

/**
 * A remembered pick still names the same character in the CURRENT capture.
 *
 * By NAME at that index, never the index alone: the index is the only thing
 * stored and it means nothing across games. A Bo3 where both sides keep their
 * rosters will validate — the producer's choice survives, which is the point —
 * while a new matchup discards it.
 */
export function spotlightValid(state, p) {
    const chars = state?.postgame?.[p?.scoreboard ?? 1]?.player?.[p?.team]?.characters;
    return !!p?.name && Array.isArray(chars) && chars[p?.charIndex]?.name === p.name;
}

/**
 * The standing intent: the producer's own pick when it still means something,
 * otherwise what this module would propose. `last` is
 * `production.feed.last.postgamecallout` — passed in rather than read here, so a
 * caller that has already narrowed it (a per-board source) keeps control.
 *
 * A memory made on ANOTHER BOARD is not this board's answer. There is one
 * spotlight memory app-wide but a capture per board, so a `?scoreboard=2`
 * source validating board 1's pick against board 2's roster is the same
 * cross-game slot confusion one axis over — it would draw whoever happens to
 * sit at that index in the other game.
 */
export function resolveSpotlight(state, scoreboard = 1, last = null) {
    const sameBoard = last && Number(last.scoreboard ?? scoreboard) === Number(scoreboard);
    if (sameBoard && spotlightValid(state, last)) return last;
    return spotlightSuggestion(state, scoreboard);
}
