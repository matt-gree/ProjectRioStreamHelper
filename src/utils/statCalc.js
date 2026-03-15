/**
 * Stat derivation utilities — mirrors stats_tracker.py formulas.
 */

/** Editable batting stat keys (raw counts). */
export const BATTING_RAW_KEYS = [
    'at_bats', 'hits', 'singles', 'doubles', 'triples', 'homeruns',
    'sac_flys', 'strikeouts', 'walks_bb', 'walks_hbp', 'rbi',
];

/** Editable pitching stat keys (raw counts). */
export const PITCHING_RAW_KEYS = [
    'batters_faced', 'runs_allowed', 'earned_runs', 'walks_bb',
    'walks_hbp', 'hits_allowed', 'total_pitches', 'strikeouts_pitched',
    'outs_pitched',
];

/** Human-readable labels for batting stats. */
export const BATTING_LABELS = {
    at_bats: 'AB',
    hits: 'H',
    singles: '1B',
    doubles: '2B',
    triples: '3B',
    homeruns: 'HR',
    sac_flys: 'SF',
    strikeouts: 'SO',
    walks_bb: 'BB',
    walks_hbp: 'HBP',
    rbi: 'RBI',
};

/** Human-readable labels for pitching stats. */
export const PITCHING_LABELS = {
    batters_faced: 'BF',
    runs_allowed: 'RA',
    earned_runs: 'ER',
    walks_bb: 'BB',
    walks_hbp: 'HBP',
    hits_allowed: 'HA',
    total_pitches: 'TP',
    strikeouts_pitched: 'SO',
    outs_pitched: 'OP',
};

/**
 * Compute derived batting stats from raw counts.
 * @param {Object} raw - raw batting stat counts
 * @returns {{ avg: number, slg: number, obp: number, ops: number, so_pct: number }}
 */
export function deriveBatting(raw = {}) {
    const ab = raw.at_bats || 0;
    const hits = raw.hits || 0;
    const singles = raw.singles || 0;
    const doubles = raw.doubles || 0;
    const triples = raw.triples || 0;
    const hr = raw.homeruns || 0;
    const bb = raw.walks_bb || 0;
    const hbp = raw.walks_hbp || 0;
    const sf = raw.sac_flys || 0;
    const so = raw.strikeouts || 0;

    const avg = ab ? +(hits / ab).toFixed(3) : 0;
    const slg = ab ? +((singles + 2 * doubles + 3 * triples + 4 * hr) / ab).toFixed(3) : 0;
    const obpDenom = ab + bb + hbp + sf;
    const obp = obpDenom ? +((hits + bb + hbp) / obpDenom).toFixed(3) : 0;
    const ops = +(obp + slg).toFixed(3);
    const so_pct = ab ? +((so / ab) * 100).toFixed(1) : 0;

    return { avg, slg, obp, ops, so_pct };
}

/**
 * Compute derived pitching stats from raw counts.
 * @param {Object} raw - raw pitching stat counts
 * @returns {{ era: number, k_pct: number, opp_avg: number, ip: string }}
 */
export function derivePitching(raw = {}) {
    const outs = raw.outs_pitched || 0;
    const bf = raw.batters_faced || 0;
    const er = raw.earned_runs || 0;
    const so = raw.strikeouts_pitched || 0;
    const ha = raw.hits_allowed || 0;

    const era = outs ? +(27 * (er / outs)).toFixed(2) : 0;
    const k_pct = bf ? +(100 * so / bf).toFixed(1) : 0;
    const opp_avg = bf ? +(ha / bf).toFixed(3) : 0;
    const ip = `${Math.floor(outs / 3)}.${outs % 3}`;

    return { era, k_pct, opp_avg, ip };
}

/** Labels for derived batting stats. */
export const DERIVED_BATTING_LABELS = {
    avg: 'AVG', slg: 'SLG', obp: 'OBP', ops: 'OPS', so_pct: 'SO%',
};

/** Labels for derived pitching stats. */
export const DERIVED_PITCHING_LABELS = {
    era: 'ERA', k_pct: 'K%', opp_avg: 'OPP AVG', ip: 'IP',
};
