import { create } from "zustand";
import { makeReq, jsonBody } from "../lib/api";

/*
 * Participant registry store — the streamer's local "address book".
 *
 * Fetched over plain REST (GET /api/v1/participants), NOT part of the State
 * socket store: overlays never read the directory. Picking a row in the UI
 * copies its display.* fields into score.{N}.player.{T}.* (resolve-by-copy),
 * which is what overlays actually read. See server/participants.py.
 *
 * Rows are shaped { id, identities:{rioName,startgg}, display:{...}, meta:{...} }.
 */

const req = makeReq("/api/v1/participants");

export const useParticipantsStore = create((set, get) => ({
    participants: [],
    loaded: false,
    loading: false,

    /** Fetch the full registry once (idempotent unless force). */
    load: async (force = false) => {
        if (get().loading) return;
        if (get().loaded && !force) return;
        set({ loading: true });
        try {
            const rows = await req("", { method: "GET" });
            set({ participants: Array.isArray(rows) ? rows : [], loaded: true });
        } catch {
            set({ loaded: true }); // don't wedge the UI; empty registry is valid
        } finally {
            set({ loading: false });
        }
    },

    /** Create a row from a partial { identities?, display? } body. Returns the row. */
    create: async (partial) => {
        const row = await req("", { ...jsonBody(partial), method: "POST" });
        set(s => ({ participants: [...s.participants, row] }));
        return row;
    },

    /** Merge-update a row. Returns the updated row. */
    update: async (id, partial) => {
        const row = await req(`/${id}`, { ...jsonBody(partial), method: "PUT" });
        set(s => ({ participants: s.participants.map(p => (p.id === id ? row : p)) }));
        return row;
    },

    /** Delete a row by id. */
    remove: async (id) => {
        await req(`/${id}`, { method: "DELETE" });
        set(s => ({ participants: s.participants.filter(p => p.id !== id) }));
    },

    /**
     * Import parsed start.gg players into the registry (D1: explicit only).
     * Pass one player for a per-row add, or many for "Import all". The server
     * de-dupes; we merge returned rows by id (replace existing, append new).
     * Returns { imported, rows }.
     */
    importStartGG: async (players) => {
        const result = await req("/import/startgg", {
            ...jsonBody({ players: players ?? [] }),
            method: "POST",
        });
        const rows = Array.isArray(result?.rows) ? result.rows : [];
        if (rows.length) {
            set(s => {
                const byId = new Map(s.participants.map(p => [p.id, p]));
                for (const row of rows) byId.set(row.id, row);
                return { participants: Array.from(byId.values()) };
            });
        }
        return result;
    },

    /** Fetch the full address book in backup shape ({version, exportedAt, participants}). */
    exportBook: async () => req("/export", { method: "GET" }),

    /**
     * Restore an address-book backup. Accepts the Export object or a bare rows
     * array. Merges by default (non-destructive); replace=true wipes first.
     * Refetches so the store reflects the server's authoritative de-dupe.
     * Returns { imported, created, updated }.
     */
    importBook: async (parsed, replace = false) => {
        const rows = Array.isArray(parsed) ? parsed
            : Array.isArray(parsed?.participants) ? parsed.participants
            : null;
        if (!rows) throw new Error("Not a valid address-book export.");
        const result = await req("/import", {
            ...jsonBody({ participants: rows, replace }),
            method: "POST",
        });
        await get().load(true);
        return result;
    },

    getById: (id) => get().participants.find(p => p.id === id) || null,
}));
