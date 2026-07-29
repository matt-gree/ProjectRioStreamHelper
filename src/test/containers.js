/*
 * The container definitions a console test runs against.
 *
 * Containers are producer-built config now (settings.production.container_defs),
 * so a component test has to say which containers exist before a fed element
 * has anywhere to be pushed — there is no implicit default any more, and that
 * absence is the point of the phase.
 *
 * These mirror the three the server seeds (server/settings.py). They are a
 * FIXTURE, not a second source of truth: the seed itself is pinned by
 * tests/unit/test_settings_containers.py, and what matters here is only that a
 * test starts from a rig that looks like a real one.
 */
export const SEEDED_CONTAINER_DEFS = {
    'callout-stage': {
        name: 'Callout Stage',
        width: 1920,
        height: 1080,
        members: ['postgamecallout', 'postgamevs'],
    },
    'stats-feed': {
        name: 'Stats Bar',
        width: 452,
        height: 118,
        members: ['stats'],
    },
    'split-screen': {
        name: 'Split-Screen',
        width: 1280,
        height: 720,
        members: ['hitvisualizer'],
    },
};

// Settings' `production` slice with the containers in place, spread-able over
// whatever else a test needs there.
export const withContainers = (production = {}) => ({
    container_defs: SEEDED_CONTAINER_DEFS,
    ...production,
});
