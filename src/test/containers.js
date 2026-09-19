/*
 * The container definitions a console test runs against.
 *
 * Containers are producer-built config now (settings.production.container_defs),
 * so a component test has to say which containers exist before a fed element
 * has anywhere to be pushed — there is no implicit default any more, and that
 * absence is the point of the phase.
 *
 * The server seeds none (server/settings.py). These are a sample rig — the four
 * containers early pre-releases shipped with — so a test starts from something
 * that looks like a real producer's setup.
 */
export const SAMPLE_CONTAINER_DEFS = {
    'callout-stage': {
        name: 'Callout Stage',
        width: 1920,
        height: 1080,
        members: ['postgamecallout', 'postgamevs'],
    },
    'split-screen': {
        name: 'Split-Screen',
        width: 1280,
        height: 720,
        members: ['hitvisualizer'],
    },
    // The mirrored pair that replaces the Roster + Stats element: one container
    // per side, resting on that side's roster with its stat card able to flash
    // over it. They share both members, which is the shared-member exception —
    // neither carries content of its own, so neither has a push destination to
    // be ambiguous about.
    'roster-stats-1': {
        name: 'Roster + Stats — Side 1',
        width: 452,
        height: 240,
        members: ['roster', 'statscard'],
        resting: 'roster',
        scope: { scoreboard: 1, team: 1 },
    },
    'roster-stats-2': {
        name: 'Roster + Stats — Side 2',
        width: 452,
        height: 240,
        members: ['roster', 'statscard'],
        resting: 'roster',
        scope: { scoreboard: 1, team: 2 },
    },
};

// Settings' `production` slice with the containers in place, spread-able over
// whatever else a test needs there.
export const withContainers = (production = {}) => ({
    container_defs: SAMPLE_CONTAINER_DEFS,
    ...production,
});
