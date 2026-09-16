/*
 * The board-game lifecycle is derived in TWO runtimes, from one table.
 *
 * `boardLifecycle` here and `lifecycle_of` in server/boards.py answer the same
 * question — is a feed actually driving this board — for the console's chips and
 * the server's projector respectively. They share a BEHAVIOUR rather than a
 * literal, so the cases live in tests/fixtures/board_lifecycle.json and both
 * suites read them; see tests/unit/test_board_lifecycle_parity.py, which also
 * guards that this file still reads the table.
 */
import { describe, expect, it } from 'vitest';

import { boardLifecycle, isStaleBoard, STALE_LIFECYCLES } from './boards';
import table from '../../../tests/fixtures/board_lifecycle.json';

// The server's `lifecycle_of` is keyword-only and fully defaulted so a case can
// name just the inputs it is about; this maps that table's snake_case onto the
// object this side takes.
const call = (input) => boardLifecycle({
    gameId: input.game_id ?? null,
    gameOver: 'game_over' in input ? input.game_over : null,
    gameCompleted: 'game_completed' in input ? input.game_completed : null,
    liveFollowing: 'live_following' in input ? input.live_following : null,
    captured: input.captured ?? false,
    restored: input.restored ?? false,
});

describe('boardLifecycle — the shared case table', () => {
    for (const c of table.cases) {
        it(c.why, () => {
            expect(call(c.in)).toBe(c.out);
        });
    }
});

describe('isStaleBoard', () => {
    for (const lifecycle of table.stale.true) {
        it(`${lifecycle} has stopped being a game in progress`, () => {
            expect(isStaleBoard(lifecycle)).toBe(true);
        });
    }
    for (const lifecycle of table.stale.false) {
        it(`${lifecycle} is not stale`, () => {
            expect(isStaleBoard(lifecycle)).toBe(false);
        });
    }
    it('exports the list the table pins, so the two cannot drift', () => {
        expect([...STALE_LIFECYCLES].sort()).toEqual([...table.stale.true].sort());
    });
});
