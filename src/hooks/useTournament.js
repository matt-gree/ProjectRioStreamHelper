import { useState, useCallback, useRef } from 'react';

const BASES = {
    startgg: '/api/v1/startgg',
    challonge: '/api/v1/challonge',
};

/**
 * Detect tournament source from URL.
 * Returns 'challonge' or 'startgg' (default).
 */
export function detectSource(url) {
    if (!url) return null;
    if (/challonge\.com/i.test(url)) return 'challonge';
    if (/start\.gg/i.test(url)) return 'startgg';
    // Fallback: if it looks like a start.gg slug
    if (/^tournament\//i.test(url)) return 'startgg';
    return null;
}

async function api(base, path, options = {}) {
    const resp = await fetch(`${base}${path}`, options);
    const data = await resp.json();
    if (!resp.ok && !data.error) {
        throw new Error(`Request failed: ${resp.status}`);
    }
    return data;
}

/**
 * Unified tournament hook that works with both start.gg and Challonge.
 *
 * Auto-detects the source from the URL passed to loadEvent().
 * All subsequent calls (fetchPhases, fetchSets, etc.) use the
 * same source that was detected on loadEvent.
 */
export default function useTournament() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const sourceRef = useRef(null);

    const wrap = useCallback(async (fn) => {
        setLoading(true);
        setError(null);
        try {
            const result = await fn();
            if (result?.error) {
                setError(result.error);
                return null;
            }
            return result;
        } catch (e) {
            setError(e.message);
            return null;
        } finally {
            setLoading(false);
        }
    }, []);

    const base = () => BASES[sourceRef.current] || BASES.startgg;

    const loadEvent = useCallback(async (url) => {
        const detected = detectSource(url);
        if (detected) sourceRef.current = detected;
        setLoading(true);
        setError(null);
        try {
            const data = await api(base(), `/load-event?url=${encodeURIComponent(url)}`, { method: 'POST' });
            if (data?.error) {
                setError(data.error);
                return { error: data.error };
            }
            return data;
        } catch (e) {
            setError(e.message);
            return { error: e.message };
        } finally {
            setLoading(false);
        }
    }, []);

    /** Restore source from a previously loaded bracket_link without re-fetching. */
    const setSource = useCallback((url) => {
        const detected = detectSource(url);
        if (detected) sourceRef.current = detected;
    }, []);

    const fetchPhases = useCallback(() => wrap(() =>
        api(base(), '/phases')
    ), [wrap]);

    const fetchSets = useCallback((page = 1, { phaseId = null, phaseGroupId = null, includeFinished = false } = {}) => wrap(() => {
        const params = new URLSearchParams({ page });
        if (phaseGroupId) params.set('phase_group_id', phaseGroupId);
        else if (phaseId) params.set('phase_id', phaseId);
        if (includeFinished) params.set('include_finished', 'true');
        return api(base(), `/sets?${params}`);
    }), [wrap]);

    const fetchSet = useCallback((setId) => wrap(() =>
        api(base(), `/set/${setId}`)
    ), [wrap]);

    const loadSet = useCallback((setId, scoreboardNumber = 1) => wrap(() =>
        api(base(), `/load-set?set_id=${setId}&scoreboard_number=${scoreboardNumber}`, { method: 'POST' })
    ), [wrap]);

    const fetchEntrants = useCallback((page = 1) => wrap(() =>
        api(base(), `/entrants?page=${page}`)
    ), [wrap]);

    const loadBracket = useCallback((phaseGroupId) => wrap(() =>
        api(base(), `/load-bracket?phase_group_id=${phaseGroupId}`, { method: 'POST' })
    ), [wrap]);

    const clearEvent = useCallback(async () => {
        // Clear both providers — the user might be switching sources or just
        // wiping state, and we don't always know which one is active.
        await Promise.allSettled([
            fetch(`${BASES.startgg}/clear`, { method: 'POST' }),
            fetch(`${BASES.challonge}/clear`, { method: 'POST' }),
        ]);
        sourceRef.current = null;
    }, []);

    return {
        loading,
        error,
        source: sourceRef.current,
        setSource,
        loadEvent,
        fetchPhases,
        fetchSets,
        fetchSet,
        loadSet,
        fetchEntrants,
        loadBracket,
        clearEvent,
    };
}
