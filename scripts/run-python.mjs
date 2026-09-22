/*
 * Run a Python script with whichever interpreter this machine actually has.
 *
 * `prebuild` hardcoded `python3`, which does not exist on a stock Windows
 * install — so `npm run build` (and therefore `npm run setup:win`, whose last
 * step is a build) died on Windows at the one step that stamps the app's
 * version. The posix-only spelling was invisible on the maintainer's Mac and
 * in CI, and hit every Windows contributor on their first command.
 *
 * Order is deliberate: `python3` first because on macOS/Linux `python` may be
 * absent or still be Python 2; then `python`; then the `py` launcher, which is
 * what a default python.org install on Windows registers.
 */
import { spawnSync } from 'node:child_process';

const CANDIDATES = [
    ['python3', []],
    ['python', []],
    ['py', ['-3']],
];

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error('run-python: no script given');
    process.exit(2);
}

for (const [cmd, prefix] of CANDIDATES) {
    const probe = spawnSync(cmd, [...prefix, '--version'], { stdio: 'ignore', shell: false });
    if (probe.error || probe.status !== 0) continue;

    const run = spawnSync(cmd, [...prefix, ...args], { stdio: 'inherit', shell: false });
    process.exit(run.status ?? 1);
}

console.error(
    'run-python: no Python interpreter found. Tried: '
    + CANDIDATES.map(([c, p]) => [c, ...p].join(' ')).join(', ')
    + '\nInstall Python 3.12+ and make sure it is on your PATH.',
);
process.exit(1);
