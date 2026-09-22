/**
 * Stadium vocabulary for the app UI.
 *
 * Geometry (outlines, fielder/base/runner positions) is NOT here: the hit
 * overlay fetches it per stadium from `/api/v1/visualizer/stadium/{name}`,
 * which serves pyrio's own data. A second copy in JS could only ever drift
 * from that source, so this file carries the picker options and nothing else.
 */

// Stadium selector options (display name → data key)
export const STADIUM_OPTIONS = [
    { value: 'mario_stadium',  label: 'Mario Stadium' },
    { value: 'bowser_castle',  label: 'Bowser Castle' },
    { value: 'wario_palace',   label: 'Wario Palace' },
    { value: 'yoshi_park',     label: 'Yoshi Park' },
    { value: 'peach_garden',   label: 'Peach Garden' },
    { value: 'dk_jungle',      label: 'DK Jungle' },
    { value: 'toy_field',      label: 'Toy Field' },
];
