import { create } from "zustand";
import { makeReq, jsonBody } from "../lib/api";
import { shrinkImage } from "../lib/image";

/*
 * Participant registry store — the streamer's local "address book".
 *
 * Fetched over plain REST (GET /api/v1/participants), NOT part of the State
 * socket store: overlays never read the directory. Picking a row in the UI
 * copies its display.* fields into score.{N}.player.{T}.* (resolve-by-copy),
 * which is what overlays actually read. See server/participants.py.
 *
 * Rows are shaped { id, book, logo, logoRev, identities:{rioName,startgg}, display:{...}, meta:{...} }.
 *
 * BOOKS (schema v2). Every row belongs to one book; `main` is the book every
 * install has. A book may be linked to a league (Rio game modes) —
 * `{ id, name, modes, community, count }` — and each person in it may carry a
 * logo, which goes on air beside them in that league's games. `books` is
 * loaded beside the rows because every surface that lists people wants to say
 * which book they are in.
 */

export const MAIN_BOOK = "main";

/** Where a person's league logo is served, "" when they have none. The rev
 *  in the query string is what makes a replaced file refetch. */
export const logoUrl = (row) => (row?.logo
    ? `/branding/leagues/${row.book || MAIN_BOOK}/${row.logo}?v=${row.logoRev ?? 0}`
    : "");

const req = makeReq("/api/v1/participants");

/* A file upload (multipart) with the server's `detail` as the error. */
async function postFile(path, file) {
    const body = new FormData();
    body.append("file", file);
    const resp = await fetch(`/api/v1/participants${path}`, { method: "POST", body });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data?.detail || `Request failed: ${resp.status}`);
    return data;
}

export const useParticipantsStore = create((set, get) => ({
    participants: [],
    books: [],
    loaded: false,
    loading: false,

    /** Fetch the full registry once (idempotent unless force). */
    load: async (force = false) => {
        if (get().loading) return;
        if (get().loaded && !force) return;
        set({ loading: true });
        try {
            const [rows, books] = await Promise.all([
                req("", { method: "GET" }),
                req("/books", { method: "GET" }).catch(() => []),
            ]);
            set({
                participants: Array.isArray(rows) ? rows : [],
                books: Array.isArray(books) ? books : [],
                loaded: true,
            });
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
        get().loadBooks().catch(() => {}); // a book's count moved
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
        get().loadBooks().catch(() => {});
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
    exportBook: async (bookId = MAIN_BOOK) => req(`/books/${bookId}/export`, { method: "GET" }),

    getById: (id) => get().participants.find(p => p.id === id) || null,

    // ----- books -----------------------------------------------------------

    /** Re-read the book list (names, leagues, counts). */
    loadBooks: async () => {
        const books = await req("/books", { method: "GET" });
        set({ books: Array.isArray(books) ? books : [] });
        return books;
    },

    createBook: async (partial) => {
        const book = await req("/books", { ...jsonBody(partial), method: "POST" });
        await get().loadBooks();
        return book;
    },

    updateBook: async (id, partial) => {
        const book = await req(`/books/${id}`, { ...jsonBody(partial), method: "PUT" });
        await get().loadBooks();
        return book;
    },

    /** Deletes the book AND its people — refetch both. */
    deleteBook: async (id) => {
        await req(`/books/${id}`, { method: "DELETE" });
        await get().load(true);
    },

    /** Replace one person's logo (scaled down first). Returns the row. */
    uploadLogo: async (id, file) => {
        const row = await postFile(`/${id}/logo`, await shrinkImage(file));
        set(s => ({ participants: s.participants.map(p => (p.id === id ? row : p)) }));
        return row;
    },

    removeLogo: async (id) => {
        const row = await req(`/${id}/logo`, { method: "DELETE" });
        set(s => ({ participants: s.participants.map(p => (p.id === id ? row : p)) }));
        return row;
    },

    // ----- Rio communities --------------------------------------------------

    /** Every Rio community name, fetched once per session. */
    communities: null,
    loadCommunities: async () => {
        if (get().communities) return get().communities;
        const names = await req("/communities", { method: "GET" });
        set({ communities: Array.isArray(names) ? names : [] });
        return get().communities;
    },

    /**
     * Bring a Rio community's players into a book. Additive: who is already
     * there is left alone. Returns { added, kept, found, source, modes }.
     */
    pullCommunity: async (bookId, community) => {
        const result = await req(`/books/${bookId}/community`, {
            ...jsonBody({ community }), method: "POST",
        });
        await get().load(true);
        return result;
    },

    /**
     * Attach a logo to each of many players at once — the bulk logo upload.
     * `items` = [{ file, player }] where `player` is a participant id in this
     * book, or a new Rio name to add as a person. One refetch at the end, not
     * one per logo.
     */
    attachLogos: async (bookId, items) => {
        const known = new Set(get().participants.filter(p => p.book === bookId).map(p => p.id));
        const failed = [];
        for (const it of items) {
            try {
                const player = (it.player || "").trim();
                if (!player) continue;
                let id = player;
                if (!known.has(player)) {
                    id = (await req("", {
                        ...jsonBody({ book: bookId, identities: { rioName: player }, display: { tag: player } }),
                        method: "POST",
                    })).id;
                    known.add(id);
                }
                await postFile(`/${id}/logo`, await shrinkImage(it.file));
            } catch (e) {
                failed.push(`${it.file?.name}: ${e.message}`);
            }
        }
        await get().load(true);
        return { done: items.filter(it => it.player).length - failed.length, failed };
    },

    /**
     * One book, whole, as the file a producer shares: a zip of `book.json` and
     * a `logos/` folder of the players' real image files. Returns a Blob.
     */
    exportShared: async (bookId) => {
        const resp = await fetch(`/api/v1/participants/books/${bookId}/export.zip`);
        if (!resp.ok) throw new Error(`Export failed: ${resp.status}`);
        return resp.blob();
    },

    /**
     * Open a book file (a `.prsh-book.zip`, or a JSON book) as a NEW book,
     * league and logos included. THE ONLY WAY A FILE GETS IN: there was a
     * second one until 2026-09-19 (`importBook`, `POST /import/file`) that
     * loaded a file into an existing book, merging or replacing, and it could
     * overwrite people the producer already kept. A scripted exact restore is
     * still `POST /participants/import`.
     */
    importShared: async (file) => {
        const result = await postFile("/books/import/file", file);
        await get().load(true);
        return result;
    },
}));
