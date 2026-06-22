import { describe, it, expect } from 'vitest';
import { deriveBatting, derivePitching } from './statCalc';

describe('deriveBatting', () => {
    it('returns all zeros for empty input', () => {
        expect(deriveBatting()).toEqual({ avg: 0, slg: 0, obp: 0, ops: 0, so_pct: 0 });
    });

    it('computes a full line correctly', () => {
        const raw = {
            at_bats: 10, hits: 3, singles: 1, doubles: 1, triples: 0, homeruns: 1,
            walks_bb: 2, walks_hbp: 0, sac_flys: 1, strikeouts: 4,
        };
        const out = deriveBatting(raw);
        expect(out.avg).toBe(0.3);                 // 3/10
        expect(out.slg).toBe(0.7);                 // (1 + 2 + 0 + 4)/10
        expect(out.obp).toBe(0.385);               // (3+2+0)/(10+2+0+1)
        expect(out.ops).toBe(1.085);               // obp + slg
        expect(out.so_pct).toBe(40.0);             // (4/10)*100
    });

    it('avoids divide-by-zero when at_bats is 0', () => {
        const out = deriveBatting({ at_bats: 0, hits: 0, walks_bb: 0 });
        expect(out.avg).toBe(0);
        expect(out.slg).toBe(0);
        expect(out.so_pct).toBe(0);
    });

    it('still computes OBP from walks when at_bats is 0', () => {
        // obpDenom = ab + bb + hbp + sf — nonzero even with no at-bats.
        const out = deriveBatting({ at_bats: 0, hits: 0, walks_bb: 2 });
        expect(out.obp).toBe(1); // (0+2+0)/2
    });

    it('rounds AVG to 3 decimals', () => {
        // 1/3 = 0.333...
        expect(deriveBatting({ at_bats: 3, hits: 1 }).avg).toBe(0.333);
    });
});

describe('derivePitching', () => {
    it('returns zeros / 0.0 IP for empty input', () => {
        expect(derivePitching()).toEqual({ era: 0, k_pct: 0, opp_avg: 0, ip: '0.0' });
    });

    it('computes a full line correctly', () => {
        const raw = {
            outs_pitched: 18, batters_faced: 24, earned_runs: 3,
            strikeouts_pitched: 8, hits_allowed: 5,
        };
        const out = derivePitching(raw);
        expect(out.era).toBe(4.5);        // 27 * (3/18)
        expect(out.k_pct).toBe(33.3);     // 100 * 8/24
        expect(out.opp_avg).toBe(0.208);  // 5/24
        expect(out.ip).toBe('6.0');       // floor(18/3).(18%3)
    });

    it('formats partial innings as outs', () => {
        expect(derivePitching({ outs_pitched: 20 }).ip).toBe('6.2'); // floor(20/3)=6, 20%3=2
        expect(derivePitching({ outs_pitched: 1 }).ip).toBe('0.1');
    });

    it('avoids divide-by-zero with no outs', () => {
        const out = derivePitching({ outs_pitched: 0, earned_runs: 5 });
        expect(out.era).toBe(0);
        expect(out.ip).toBe('0.0');
    });
});
