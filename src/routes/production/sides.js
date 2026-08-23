/*
 * SIDE VOCABULARY — the one place the console decides what to call side 1 and
 * side 2.
 *
 * The MODEL has never been in doubt: state is `score.{N}.player.{T}`, sources
 * carry `?team=1|2`, a container's scope names `team`, and the glossary forbids
 * away/home outright. What drifted was the LABEL layer. Six surfaces
 * independently hard-coded "Left" and "Right" — the board desk's columns, the
 * side-reason line, the subject rows, the container scope control, the
 * controller's URL list and the match desk's draft cards — and a seventh spelt
 * the same fact "Team 2".
 *
 * Left/Right is not a fact about a side. It is a fact about ONE arrangement of
 * one scene. A vertically stacked layout, a mobile-shaped canvas, or a producer
 * who simply put side 2 on the left all make the word wrong, and a wrong word in
 * the board desk is worse than no word: a producer checking a mislabelled board
 * is comparing the panel against a screen, and the label is the thing they are
 * trusting.
 *
 * So the position is a PREFERENCE, the number is the truth, and the default is
 * the truth:
 *
 *   numeric  Side 1 / Side 2   — default, correct in every arrangement
 *   lr       Left / Right      — the shipped horizontal scoreboard
 *   tb       Top / Bottom      — a stacked or vertical canvas
 *
 * Paired, not free-form per side, so "Left / Bottom" is unrepresentable rather
 * than handled.
 *
 * Two forms, because English needs both and letting each call site improvise
 * the second one is how the drift started:
 *
 *   label(side)   sentence-initial and standalone — an eyebrow, a control, a
 *                 segmented option. "Side 1" · "Left" · "Top".
 *   phrase(side)  mid-sentence, already carrying its article — always reads
 *                 after "on" or "Draws". "side 1" · "the left side" ·
 *                 "the top side".
 *
 * WHAT DOES NOT BELONG HERE: geometry that happens to use the same words. The
 * container anchor menu (`Top left`/`Left`/…), the player-plates location
 * options and the legacy `?dir=left|right` variant all describe a position on a
 * canvas, not a side of a game, and must keep their literal words whatever this
 * is set to.
 *
 * The setting is SERVER settings (`production.side_labels`), not browser-local
 * workspace state: it describes how the broadcast is arranged, so a second
 * producer on a second machine has to see the same words. Authored in
 * Settings → Production.
 */

import { useMemo } from 'react';
import { useSettingsStore } from '../../context/store';

export const SIDE_LABEL_SETTING = 'production.side_labels';

export const DEFAULT_SIDE_LABELS = 'numeric';

const LABELS = {
    numeric: { 1: 'Side 1', 2: 'Side 2' },
    lr: { 1: 'Left', 2: 'Right' },
    tb: { 1: 'Top', 2: 'Bottom' },
};

const PHRASES = {
    numeric: { 1: 'side 1', 2: 'side 2' },
    lr: { 1: 'the left side', 2: 'the right side' },
    tb: { 1: 'the top side', 2: 'the bottom side' },
};

// The Settings control's options, built from the same table the labels come
// from so a mode can never be offered that nothing can spell.
export const SIDE_LABEL_MODES = Object.keys(LABELS).map(value => ({
    value,
    label: `${LABELS[value][1]} / ${LABELS[value][2]}`,
}));

// An unknown or missing mode is the default, never a crash: this reads a
// persisted settings value, and a hand-edited settings.json is a real thing.
const modeOf = (mode) => (LABELS[mode] ? mode : DEFAULT_SIDE_LABELS);

// Side 2 is side 2; everything else is side 1. Same coercion as `_scope_of`
// server-side and `useMemberScope` — a side arrives as a number, a numeric
// string or a state value that round-tripped through the socket.
const sideOf = (side) => (Number(side) === 2 ? 2 : 1);

export const sideLabel = (side, mode) => LABELS[modeOf(mode)][sideOf(side)];

export const sidePhrase = (side, mode) => PHRASES[modeOf(mode)][sideOf(side)];

/*
 * The hook every console surface uses. Returns both forms bound to the current
 * mode plus the mode itself, so a caller that has to pass the vocabulary into a
 * pure helper (`variantLabel`, `rowLabel`) has one thing to pass.
 */
export function useSideLabels() {
    const mode = modeOf(useSettingsStore(s => s?.production?.side_labels));
    return useMemo(() => ({
        mode,
        label: (side) => sideLabel(side, mode),
        phrase: (side) => sidePhrase(side, mode),
    }), [mode]);
}
