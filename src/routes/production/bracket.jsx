import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../context/store';
import { Text } from '../../components/ui/primitives';
import { notifications } from '../../lib/notify';
import { SelectRow } from './kit';

/*
 * Which phase of the loaded start.gg event the bracket overlays draw.
 *
 * Loading a phase group writes the whole bracket structure to State (bracket.*)
 * for every bracket consumer to render — ONE loaded phase, app-wide. This module
 * is that publish, shared by the two surfaces that offer it: the bracket source's
 * stage (./stage/bracket) and the lower-third's bracket slot
 * (./stage/lowerthird). Sharing the hook is what keeps them from disagreeing
 * about what is loaded.
 *
 * There is no Bracket desk. It was a third surface for these same two controls,
 * and a permanent rack row for a workflow that only matters when a consumer is
 * on air — see ./stage/bracket for the full reasoning.
 *
 * Deep authoring still belongs to the Competition tab — that's where an event is
 * loaded in the first place. This only picks which phase of it is on screen, and
 * re-pulls when start.gg moves on.
 */

async function post(url) {
    const r = await fetch(url, { method: 'POST' });
    if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.detail || `HTTP ${r.status}`);
    }
    return r.json().catch(() => ({}));
}

// Shared by the bracket source's stage and the lower-third's bracket slot, so
// the two surfaces can never disagree about what's loaded.
export function useBracketDesk() {
    const bracket = useStateStore(useShallow(s => s?.bracket ?? {}));
    const [phases, setPhases] = useState(null); // null = still fetching
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let alive = true;
        fetch('/api/v1/startgg/phases')
            .then(r => (r.ok ? r.json() : []))
            .then(p => { if (alive) setPhases(Array.isArray(p) ? p : []); })
            .catch(() => { if (alive) setPhases([]); });
        return () => { alive = false; };
    }, []);

    // Flatten phases to their groups: a phase with one group reads as the phase
    // name, a pooled phase names the pool too.
    const options = useMemo(() => (phases || []).flatMap(p => (p.phaseGroups || []).map(g => ({
        value: String(g.id),
        label: (p.phaseGroups || []).length > 1
            ? `${p.name} — ${g.displayIdentifier || g.id}`
            : (p.name || String(g.id)),
    }))), [phases]);

    const load = useCallback(async (id) => {
        if (!id) return;
        setBusy(true);
        try {
            await post(`/api/v1/startgg/load-bracket?phase_group_id=${id}`);
        } catch (e) {
            notifications.show({ message: `Bracket load failed: ${e?.message || e}`, color: 'red' });
        } finally {
            setBusy(false);
        }
    }, []);

    return {
        phases, options, busy, load,
        loaded: !!bracket?.phaseName,
        phaseName: bracket?.phaseName || '',
        phaseGroupId: bracket?.phaseGroupId ?? null,
        type: bracket?.type || '',
        // Re-pull the phase that's already on screen — the common move when
        // start.gg has advanced since it was loaded.
        refresh: useCallback(() => {
            if (bracket?.phaseGroupId != null) load(bracket.phaseGroupId);
        }, [bracket?.phaseGroupId, load]),
    };
}

// The picker itself. Both surfaces render this one — a bracket source's stage
// and a lower-third bracket slot are two views of the same loaded phase.
export const BracketPhasePicker = memo(function BracketPhasePicker({ desk, label = 'Phase' }) {
    const d = desk;
    if (d.phases !== null && d.options.length === 0) {
        return (
            <Text size="xs" className="text-muted-foreground">
                No start.gg event loaded — load one on the Competition tab.
            </Text>
        );
    }
    return (
        <SelectRow
            label={label}
            value={d.phaseGroupId != null ? String(d.phaseGroupId) : ''}
            onChange={d.load}
            disabled={d.busy || d.phases === null}
            placeholder={d.phases === null ? 'Loading phases…' : 'Pick a phase…'}
            options={d.options}
        />
    );
});
