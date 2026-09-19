import { HALF_INNINGS } from '../../../data/msb';

// Layout constants and helpers shared by the board desk's regions (./desk).

export const halfInningOptions = HALF_INNINGS.map(h => ({ value: h, label: h }));

/*
 * THE BOARD IS MIRRORED: side 1 down one column, the shared frame (runs, count,
 * inning) in the middle, side 2 down the other, with side 2's contents reversed
 * and outer-aligned so each column runs outward from the score the way a
 * scoreboard does.
 *
 * The MIRRORING is what makes a producer's check a glance instead of a
 * translation step. The WORDS "left" and "right" were doing that job too, and
 * they were the half that could be wrong: they describe one arrangement of one
 * scene, and a stacked canvas (or a producer who simply put side 2 on the left)
 * turns the panel into a lie about the exact thing it was opened to check. The
 * column position carries the geometry; the eyebrow now carries the side, in
 * whatever vocabulary the producer picked (../sides).
 */
export const BOARD_GRID = 'grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-x-3';

export const EYEBROW = 'label-display text-[10px] text-muted-foreground';

// Coerce state (which round-trips through the socket as strings sometimes).
export const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

/*
 * A control the feed owns: it takes no input and looks no different. The shared
 * primitives all carry `disabled:opacity-50` (and a not-allowed cursor), which is
 * right for a control that is unavailable and wrong for one that is simply not
 * yours to type in — see `feedLive`.
 */
export const FEED_OWNED = 'disabled:opacity-100 disabled:cursor-default';
