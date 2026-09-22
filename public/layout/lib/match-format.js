/*
 * WHAT A MATCH'S FORMAT IS CALLED, and how many games it can hold.
 *
 * ONE FIELD, `format.bestOf`. A doubleheader is `bestOf: 2` — not a new kind of
 * fixture, and deliberately not a second field to keep in sync with the first.
 * The clinch arithmetic every caller already runs (`bestOf // 2 + 1`, a simple
 * majority) gives 2 for a DH, which is exactly right: you take a doubleheader by
 * winning BOTH games, and a 1-1 split has no winner and never decides. That is
 * the difference between a DH and a Bo3, and it falls out of the same sum.
 *
 * So the only thing a DH needs that the model didn't already have is its NAME.
 * `Bo2` is the arithmetic's name for it and nobody's word for it — "best of two"
 * describes a thing that cannot exist — so no surface may print it.
 *
 * THE OVERLAY RUNTIME OWNS THIS AND THE CONSOLE IMPORTS IT (the same shape as
 * container-members.js and spotlight-intent.js): the schedule card and the Match
 * desk both name a format, and a label that disagrees between the broadcast and
 * the panel that set it is the drift a shared module exists to prevent.
 *
 * `bestOf` is authored by hand on the Match desk. start.gg never produces a 2 —
 * `apply_startgg_set` bumps an even `totalGames` to the next odd number so a
 * bracket set is always decidable — so a DH is always something a producer
 * deliberately set up.
 */

// The formats a producer can pick, in the order they are offered. Bo1 first
// because it is what nearly every night is; DH second because a doubleheader is
// the common repeat, and the longer series after it.
export const FORMATS = [1, 2, 3, 5, 7];

/** Wins needed to take the match. A DH needs both; a Bo3 needs two of three. */
export function gamesToWin(bestOf) {
    const n = Number(bestOf) || 1;
    return Math.floor(n / 2) + 1;
}

/**
 * The producer's name for a format. `short` is the chip/plate form; the long
 * form is for a sentence or a tooltip.
 *
 * A Bo1 has no name worth printing — it is the default and the absence of a
 * series — so callers decide what stands in its place (the schedule plate uses
 * "VS", the console prints nothing).
 */
export function formatLabel(bestOf, { long = false } = {}) {
    const n = Number(bestOf) || 1;
    if (n <= 1) return '';
    if (n === 2) return long ? 'doubleheader' : 'DH';
    return long ? `best of ${n}` : `Bo${n}`;
}

/**
 * IS THIS FIXTURE OUT OF GAMES? — a different question from "who won it", and
 * the doubleheader is what forces them apart.
 *
 * `decided` is the record of a WINNER, and for every odd format that is also the
 * record of the end: somebody always clinches. **A DOUBLEHEADER IS COMPLETE
 * AFTER TWO GAMES HOWEVER THEY FALL** — a 1-1 split is over and nobody took it —
 * so a surface that asks `decided` to mean "finished" leaves a split fixture
 * bound to its board, offering no handover, and sitting on the Upcoming card
 * forever.
 *
 * A Bo1 at 0-0 is NOT complete: its game may have ended without crediting (a
 * quit game reports no winner), and the fixture still has its game to give.
 */
export function matchComplete(bestOf, w1, w2, decided) {
    if (decided === 1 || decided === 2 || decided === '1' || decided === '2') return true;
    const total = Number(bestOf) || 1;
    return (Number(w1) || 0) + (Number(w2) || 0) >= total;
}

/** A finished fixture nobody won — only an even format can produce one. */
export function isSplit(bestOf, w1, w2, decided) {
    return matchComplete(bestOf, w1, w2, decided)
        && !(decided === 1 || decided === 2 || decided === '1' || decided === '2');
}

/**
 * CAN ANOTHER GAME FOLLOW UNDER THIS FIXTURE? The question the take stands down
 * for, and the one place a DH differs from every other format.
 *
 * It was `bestOf > 1 && !decided`, which is right for an odd format — somebody
 * always clinches, so `decided` is the end — and wrong for a doubleheader, where
 * a **1-1 split is complete and never decides**. Left alone, a split DH would
 * stand the take down for the rest of the night on a fixture with no games left
 * to play. Counting the games the format holds answers both.
 *
 * A Bo1 is false at 0-0, which is the carve-out that matters most often: its
 * game ending IS the fixture ending, and gating its take on a credit that may
 * not have landed is what hid the producer's next press.
 */
export function seriesContinues(bestOf, w1, w2, decided) {
    const total = Number(bestOf) || 1;
    if (total <= 1 || decided) return false;
    return (Number(w1) || 0) + (Number(w2) || 0) < total;
}
