import { useState, useCallback } from 'react';

const BASE = '/api/v1/startgg';

async function api(path, options = {}) {
    const resp = await fetch(`${BASE}${path}`, options);
    const data = await resp.json();
    if (!resp.ok && !data.error) {
        throw new Error(`Request failed: ${resp.status}`);
    }
    return data;
}

export default function useStartGG() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

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

    const loadEvent = useCallback((url) => wrap(() =>
        api(`/load-event?url=${encodeURIComponent(url)}`, { method: 'POST' })
    ), [wrap]);

    const fetchPhases = useCallback(() => wrap(() =>
        api('/phases')
    ), [wrap]);

    const fetchSets = useCallback((page = 1, { phaseId = null, phaseGroupId = null, includeFinished = false } = {}) => wrap(() => {
        const params = new URLSearchParams({ page });
        if (phaseGroupId) params.set('phase_group_id', phaseGroupId);
        else if (phaseId) params.set('phase_id', phaseId);
        if (includeFinished) params.set('include_finished', 'true');
        return api(`/sets?${params}`);
    }), [wrap]);

    const fetchSet = useCallback((setId) => wrap(() =>
        api(`/set/${setId}`)
    ), [wrap]);

    const loadSet = useCallback((setId, scoreboardNumber = 1) => wrap(() =>
        api(`/load-set?set_id=${setId}&scoreboard_number=${scoreboardNumber}`, { method: 'POST' })
    ), [wrap]);

    const fetchEntrants = useCallback((page = 1) => wrap(() =>
        api(`/entrants?page=${page}`)
    ), [wrap]);

    const loadBracket = useCallback((phaseGroupId) => wrap(() =>
        api(`/load-bracket?phase_group_id=${phaseGroupId}`, { method: 'POST' })
    ), [wrap]);

    return {
        loading,
        error,
        loadEvent,
        fetchPhases,
        fetchSets,
        fetchSet,
        loadSet,
        fetchEntrants,
        loadBracket,
    };
}
