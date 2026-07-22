import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/*
 * Phase 6b — a silent overlay must SAY why it's blank. An overlay with nothing
 * to draw hides itself, which is correct on air and indistinguishable from a
 * broken source everywhere else. `OverlayBase.setBlank(reason)` writes that
 * reason to `data-prsh-blank` and, in PREVIEW_MODE, paints it — so the stage's
 * preview column (which loads every source with `?preview=1`, see preview.jsx)
 * shows the producer why the picture is empty.
 *
 * The mounts run in the browser, outside the vitest runtime, so there is no
 * behavioural harness for them here. This is a source-level guard — the same
 * shape as the overlay-settings whitelist parity test — that pins the coverage
 * so a future refactor can't quietly drop a mount's blank reason and leave a
 * source that reads as broken. If a hide path stops calling setBlank, this
 * fails; if you retire a mount, drop its row.
 */
describe('blank-reason coverage — every silent mount says why (phase 6b)', () => {
    const mounts = [
        'scoreboard', 'matchup', 'ticker', 'lowerthird', 'playerplates',
        'commentary', 'postgame-callout', 'postgame-vs', 'stats-card',
    ];

    for (const name of mounts) {
        it(`${name}-mount.js calls OverlayBase.setBlank at its hide path`, () => {
            const src = readFileSync(`public/layout/lib/${name}-mount.js`, 'utf8');
            expect(src.includes('OverlayBase.setBlank('), name).toBe(true);
        });
    }
});
