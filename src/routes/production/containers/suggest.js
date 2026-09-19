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
 *
 * THE SPOTLIGHT'S OWN RULES LIVE IN THE OVERLAY RUNTIME
 * (`public/layout/lib/spotlight-intent.js`) and are imported here, the same way
 * the console imports `container-members.js`. They are not console rules: the
 * element's dedicated OBS source has to answer "which character" identically,
 * and when it had its own answer — the raw memory, unvalidated — the panel and
 * the broadcast named different characters on every game after the first. One
 * implementation, not two kept in step by a parity test.
 */

import {
    resolveSpotlight, spotlightSuggestion, spotlightValid, totalBases, winningSide,
} from '../../../../public/layout/lib/spotlight-intent.js';

// Re-exported: this module is the console's door to the intent rules, and its
// callers should not each have to know which side of the runtime split a given
// one lives on.
export { resolveSpotlight, spotlightSuggestion, spotlightValid, totalBases, winningSide };

/*
 * Per-feed intent rules — ONE resolver per feed kind, or none.
 *
 * A feed with no entry replays its remembered payload as-is, which is right for
 * a whole-game push like the Game Summary: nothing in it can go stale.
 *
 * One function rather than the `valid` + `suggest` pair this replaced. That
 * pair spelled the fallback order HERE, which meant the overlay runtime could
 * only share the rules by re-spelling it — and the composition (validate, then
 * fall back) is the half that was actually wrong on the broadcast, not either
 * piece. Whatever a feed's resolver decides is what every surface shows.
 */
export const FEED_INTENT = {
    postgamecallout: { resolve: resolveSpotlight },
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
    const last = state?.production?.feed?.last?.[element.id] ?? null;
    const resolve = FEED_INTENT[element.feed]?.resolve;
    return resolve ? resolve(state, scoreboard, last) : last;
}
