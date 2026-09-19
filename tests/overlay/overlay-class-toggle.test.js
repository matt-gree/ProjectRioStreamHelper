import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/*
 * `classList.toggle(name, force)` FLIPS the class when `force` is undefined —
 * the second argument is treated as "not passed", not as false. So an overlay
 * that writes `toggle('warn', a && b)` where `a` is undefined does not clear
 * the class: it inverts it on every render pass.
 *
 * The lower third shipped exactly that. `c.running` is absent on a countdown
 * the producer has configured but never started, `c.running && …` is therefore
 * undefined, and renderClocks runs on a 250ms interval — so a break clock
 * strobed on air, in the state it spends most of its life in. It looked like a
 * deliberate animation, which is why it survived.
 *
 * The mounts run in the browser, outside the vitest runtime, so this is a
 * source-level guard in the same shape as blank-reason.test.jsx: cheap, and it
 * covers the whole class of the bug rather than the one line that had it.
 */

const ROOT = 'public/layout';

function walk(dir) {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(p));
        else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
    return out;
}

// Safe forms, all of which can only ever produce a boolean:
//   !x  !!x  Boolean(x)  true/false  anything with a comparison operator
const SAFE = /^(!|Boolean\(|true\b|false\b)|[<>]|[=!]==/;

describe('overlay mounts never hand classList.toggle an undefined force', () => {
    const files = walk(ROOT);

    it('finds layout sources to scan', () => {
        expect(files.length).toBeGreaterThan(0);
    });

    for (const file of files) {
        const src = readFileSync(file, 'utf8');
        // Two-argument calls only — the one-argument form is an honest toggle.
        const calls = [...src.matchAll(/classList\.toggle\(([^;]*?)\);/g)]
            .map(m => m[1])
            .filter(args => args.includes(','))
            .map(args => args.slice(args.indexOf(',') + 1).trim());
        if (!calls.length) continue;

        it(`${file} coerces every force argument`, () => {
            for (const force of calls) {
                expect(SAFE.test(force), `classList.toggle(…, ${force}) in ${file}: `
                    + 'an undefined force makes toggle FLIP the class instead of clearing '
                    + 'it. Wrap it in !! (or compare) so it is always a boolean.')
                    .toBe(true);
            }
        });
    }
});
