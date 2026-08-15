import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore, useSettingsStore } from '../../context/store';
import { usePending } from '../../context/staging';
import { stageSettingsSet } from './controls';

/*
 * The Event Header's two bands, as the console reads them.
 *
 * A band is an ORDERED LIST of fields — `overlays.eventheader.bands.{header,
 * footer}`, each entry `{id, on, text}`, drawn left→right. Position is the
 * producer's; the SOURCE behind each id is ours. `text` overrides that source
 * ("Winners Final" over a start.gg round name) and blank falls back to it, which
 * makes `message` nothing special: it is the entry with no source, so its own
 * text is all it ever draws.
 *
 * This module exists because TWO console surfaces answer the same question —
 * the stage panel's ribbons and the rack/rail subject row — and a band's
 * contents was hardcoded in both, in two different orders, before it was
 * arrangeable at all. The server owns the same census in EVENTHEADER_FIELDS
 * (server/settings.py), which migrates and heals the stored lists; the two are
 * pinned against each other in eventheader.test.jsx.
 */

export const BANDS = [
    { band: 'header', label: 'Top band', master: 'showHeader', offset: 'headerOffsetY' },
    { band: 'footer', label: 'Bottom band', master: 'showFooter', offset: 'footerOffsetY' },
];

/*
 * `where` is the producer-facing answer to "why is this field blank", so it
 * names the surface that fills it rather than the state key. A field with no
 * `where` has no source at all and is filled by typing in it — which is the
 * whole of what the message field is.
 */
export const FIELDS = {
    competition: { label: 'Competition', where: 'Competition → Tournament info' },
    location: { label: 'Location', where: 'Competition → Tournament info' },
    dates: { label: 'Dates', where: 'Competition → Tournament info' },
    event: { label: 'Event', where: 'the loaded start.gg event' },
    phase: { label: 'Phase', where: 'the bound match, else Competition' },
    round: { label: 'Round', where: 'the bound match' },
    message: { label: 'Message', where: null },
};

export const DEFAULT_BANDS = {
    header: ['competition', 'location', 'dates'],
    footer: ['message', 'event', 'phase', 'round'],
};

const SETTING_KEY = 'overlays.eventheader.bands';

const entry = (id, on = true, text = '') => ({ id, on, text });

/*
 * Normalised, and normalised the same way the server heals: known ids only, no
 * duplicates, anything missing appended to its default band. The client repeats
 * the heal rather than trusting it because a band is read on every render and a
 * settings file is hand-editable — an unknown id here would be a segment with no
 * label, and a missing one a field the panel could never reach.
 */
export function normalizeBands(raw) {
    const out = {};
    const seen = new Set();
    for (const { band } of BANDS) {
        out[band] = [];
        for (const e of Array.isArray(raw?.[band]) ? raw[band] : []) {
            const id = e?.id;
            if (!FIELDS[id] || seen.has(id)) continue;
            seen.add(id);
            out[band].push(entry(id, e.on !== false, String(e.text ?? '')));
        }
    }
    for (const [band, ids] of Object.entries(DEFAULT_BANDS)) {
        for (const id of ids) {
            if (seen.has(id)) continue;
            seen.add(id);
            out[band].push(entry(id));
        }
    }
    return out;
}

/*
 * The bands as they stand, staged value winning — and one `set` that writes the
 * whole object.
 *
 * Both bands go under ONE settings key on purpose. An arrangement is a single
 * fact: moving a field across bands changes two arrays at once, and two staged
 * entries for one move could be confirmed apart, leaving the field in both
 * bands or in neither.
 */
export function useBands() {
    const raw = useSettingsStore(useShallow(s => s?.overlays?.eventheader?.bands ?? null));
    const pending = usePending(`settings:${SETTING_KEY}`);
    const bands = normalizeBands(pending ? pending.value : raw);
    const set = useCallback(
        (next, label) => stageSettingsSet(SETTING_KEY, next, `Event header: ${label}`),
        [],
    );
    return { bands, set, staged: !!pending };
}

/*
 * What each field draws with no override — the app-side twin of `fieldSource`
 * in eventheader.html. Both read the same state; keep them in step.
 *
 * The board is the one the SOURCE's url names (no param means board 1, the
 * documented default), because the Event Header is full-canvas chrome and is
 * deliberately not `scope: 'board'` — the board decides only which fixture
 * Round and Phase come from.
 */
export function useFieldValues(board = 1) {
    return useStateStore(useShallow(s => {
        const info = s?.tournamentInfo ?? {};
        const matchId = s?.score?.[board]?.match;
        const match = matchId != null && matchId !== '' ? s?.match?.[String(matchId)] : null;
        return {
            competition: info.name || '',
            event: info.event_name || info.name || '',
            location: info.location || '',
            dates: info.date || '',
            phase: match?.phase || info.phase || '',
            round: s?.score?.[board]?.phase || '',
            message: '',
        };
    }));
}

// One field's drawn value: its override, else its source. Blank means the field
// is absent from the band — not a gap in it (the overlay filters the same way).
export const fieldValue = (e, values) => String(e?.text || '').trim() || values[e?.id] || '';

// What a band will actually draw, in order. The subject row's whole job, and
// the ribbon's per-segment summary is one element of it.
export const bandLine = (entries, values) =>
    entries.filter(e => e.on).map(e => fieldValue(e, values)).filter(Boolean);
