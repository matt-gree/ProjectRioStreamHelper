import { describe, expect, it } from 'vitest';
import { urlForBoard } from './boardswitch';

describe('urlForBoard', () => {
    it('rewrites an existing ?scoreboard= and keeps every other param', () => {
        expect(urlForBoard('http://localhost:5260/layout/scoreboard1/scoreboard.html?scoreboard=1&size=s&intro=0', 2))
            .toBe('http://localhost:5260/layout/scoreboard1/scoreboard.html?scoreboard=2&size=s&intro=0');
    });
    it('adds it to a source that relied on the board-1 default', () => {
        expect(urlForBoard('http://localhost:5260/layout/scorecard/scorecard.html', 3))
            .toBe('http://localhost:5260/layout/scorecard/scorecard.html?scoreboard=3');
    });
});
