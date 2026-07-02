/*
 * Production staging — the confirm-to-live buffer.
 *
 * When Settings → Production → "Confirm changes before going live" is on,
 * element mutations made on the Production page do NOT hit live state / OBS
 * immediately. They are staged here as pending entries and only executed when
 * the producer commits — via the configured hotkey or the Go Live button on
 * the pending bar. With the setting off, stageOrRun() is a pass-through and
 * the page behaves exactly as before.
 *
 * An entry is keyed by the logical control it came from (e.g. one OBS
 * source's visibility, one container's feed, one lowerthird field), so
 * re-editing the same control REPLACES its pending entry instead of queueing
 * duplicates. Commit executes entries in the order they were first staged —
 * the order the producer made the changes.
 *
 * What stages: state writes, OBS source visibility, feed picks, the
 * commentary desk. What never stages (momentary "fire now" actions): scene
 * switches, Take, hit replay/spotlight, clock start/pause/reset, post-game
 * capture.
 */
import { create } from "zustand";
import { useSettingsStore } from "./store";
import { notifications } from "../lib/notify";

export const useStagingStore = create((set, get) => ({
    // key → { key, label, value, run }
    pending: {},
    // keys in first-staged order (commit order)
    order: [],

    stage(entry) {
        set((s) => ({
            pending: { ...s.pending, [entry.key]: entry },
            order: s.order.includes(entry.key) ? s.order : [...s.order, entry.key],
        }));
    },

    discard(key) {
        set((s) => {
            if (!(key in s.pending)) return {};
            const pending = { ...s.pending };
            delete pending[key];
            return { pending, order: s.order.filter((k) => k !== key) };
        });
    },

    discardAll() {
        set({ pending: {}, order: [] });
    },

    // Execute every pending entry in stage order. Entries are cleared up
    // front (a failed action shouldn't stay staged and silently re-fire on the
    // next commit); failures are reported, not retried.
    async commit() {
        const { pending, order } = get();
        const entries = order.map((k) => pending[k]).filter(Boolean);
        if (entries.length === 0) return { ran: 0, errors: [] };
        set({ pending: {}, order: [] });
        const errors = [];
        for (const e of entries) {
            try {
                await e.run();
            } catch (err) {
                errors.push(`${e.label}: ${err?.message || err}`);
            }
        }
        return { ran: entries.length - errors.length, errors };
    },
}));

export function confirmModeEnabled() {
    return !!useSettingsStore.getState()?.production?.confirm?.enabled;
}

/**
 * The single mutation gateway for Production-page element controls.
 *
 * Confirm mode off → run() executes now (errors toast). On → the change is
 * staged under `key`; `value` is what pending-aware controls display; `label`
 * is what the pending bar lists. Passing `liveValue` lets a control that was
 * staged back to its current live value drop out of the buffer entirely
 * (toggling a switch twice leaves nothing pending).
 */
export function stageOrRun({ key, label, value, liveValue, run }) {
    if (!confirmModeEnabled()) {
        const toast = (e) => notifications.show({ message: `${label}: ${e?.message || e}`, color: "red" });
        try {
            const r = run();
            if (r && typeof r.then === "function") r.catch(toast);
        } catch (e) {
            toast(e);
        }
        return;
    }
    if (liveValue !== undefined && Object.is(value, liveValue)) {
        useStagingStore.getState().discard(key);
        return;
    }
    useStagingStore.getState().stage({ key, label, value, run });
}

/**
 * The pending entry for a control key, or undefined. Controls render
 * `entry ? entry.value : liveValue` so the producer sees what is staged
 * (a staged value may legitimately be null — e.g. "clear this feed" — which
 * is why the whole entry is returned rather than just its value).
 */
export function usePending(key) {
    return useStagingStore((s) => s.pending[key]);
}

/** Commit the buffer and toast the outcome. Shared by hotkey + Go Live. */
export async function commitPending() {
    const { ran, errors } = await useStagingStore.getState().commit();
    if (ran === 0 && errors.length === 0) return;
    if (errors.length) {
        notifications.show({
            message: `Went live with ${ran} change${ran === 1 ? "" : "s"}; ${errors.length} failed — ${errors.join("; ")}`,
            color: "red",
        });
    } else {
        notifications.show({ message: `${ran} change${ran === 1 ? "" : "s"} live.`, color: "green" });
    }
}

// ── Hotkey helpers ─────────────────────────────────────────────────────────
// A hotkey is stored as a display string like "F9" or "Ctrl+Shift+Enter":
// modifiers in Ctrl/Meta/Alt/Shift order, then the key (single characters
// uppercased, "Space" for the space bar). Capture and match go through the
// same comboFromEvent so they can never disagree.

const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "Shift"]);

export function comboFromEvent(e) {
    if (MODIFIER_KEYS.has(e.key)) return null; // a bare modifier is not a combo
    const parts = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.metaKey) parts.push("Meta");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    let k = e.key === " " ? "Space" : e.key;
    if (k.length === 1) k = k.toUpperCase();
    parts.push(k);
    return parts.join("+");
}

export function eventMatchesHotkey(e, hotkey) {
    if (!hotkey) return false;
    const combo = comboFromEvent(e);
    return !!combo && combo.toLowerCase() === String(hotkey).toLowerCase();
}
