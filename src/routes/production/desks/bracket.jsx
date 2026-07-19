import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { RefreshCw } from 'lucide-react';
import { useStateStore } from '../../../context/store';
import { Text } from '../../../components/ui/primitives';
import { notifications } from '../../../lib/notify';
import { ActionRow, SelectRow } from '../kit';

/*
 * Bracket desk — feeds the broadcast but is never on it.
 *
 * Loading a phase group writes the whole bracket structure to State (bracket.*)
 * for the bracket overlays to render; the desk owns that workflow so the
 * bracket element's stage and the lower-third's bracket slot can both defer to
 * one place instead of each growing a phase picker.
 *
 * Deep authoring still belongs to the Competition tab — that's where an event
 * is loaded in the first place. This desk only picks WHICH phase of the loaded
 * event is on screen, and re-pulls it when start.gg moves on.
 *
 * Loads are momentary: they fetch and publish immediately rather than staging,
 * same as the Competition tab's own selector and every other "fire now" action.
 */

async function post(url) {
    const r = await fetch(url, { method: 'POST' });
    if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.detail || `HTTP ${r.status}`);
    }
    return r.json().catch(() => ({}));
}

// Shared by the desk body and the bracket element's stage, so the two surfaces
// can never disagree about what's loaded.
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

// The picker on its own — reused by the lower-third's bracket slot, which shows
// the same loaded phase.
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

// Rack meta: what a producer needs to know without opening the desk.
export function bracketDeskMeta(desk) {
    return desk.loaded ? desk.phaseName : 'nothing loaded';
}

export default function BracketDesk() {
    const d = useBracketDesk();
    return (
        <>
            <BracketPhasePicker desk={d} />
            <ActionRow actions={[
                {
                    label: d.busy ? 'Loading…' : 'Refresh',
                    icon: RefreshCw,
                    disabled: d.busy || d.phaseGroupId == null,
                    title: 'Re-pull this phase from start.gg',
                    onClick: d.refresh,
                },
            ]} />

            <Text size="xs" className="border-t border-border/60 pt-2 text-muted-foreground">
                {d.loaded
                    ? <>Showing <b>{d.phaseName}</b>. Every bracket source renders this phase — refresh after results land on start.gg.</>
                    : <>Pick a phase to publish it to the bracket overlays. Events are loaded on the Competition tab.</>}
            </Text>
        </>
    );
}
