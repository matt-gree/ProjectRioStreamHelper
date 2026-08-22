/*
 * Instances — which ONE of several sources of the same overlay a row commands.
 *
 * An element is a TYPE ("Scoreboard"). An instance is one of that type on the
 * broadcast ("Scoreboard on board 2", "Stats for team 1"). For most elements
 * the two are the same thing, but an overlay that reads a query param is
 * URL-scoped: two sources carrying different values are two independent things
 * with their own source, their own air state and their own settings.
 *
 * TWO AXES, and they are not symmetrical:
 *
 *   board    ?scoreboard=N — declared on the element (`scope: 'board'`) and the
 *                            only axis with a documented DEFAULT: a source with
 *                            no param IS board 1. Keeps a bare-number suffix.
 *   variant  ?team= ?size= ?dir= ?port= — read straight off the URL for ANY
 *                            element, registered or not. These are the layout
 *                            catalog's own variant axes (layouts.py expands
 *                            each into a separate catalog row), so a producer
 *                            picking "Stats — Team 2" has already chosen one.
 *
 * The variant axis is not optional bookkeeping, and it is deliberately not
 * gated on registration. An UNREGISTERED team-variant layout rows through
 * `genericElement`, which keys on the PATHNAME — and left at that, team 1's and
 * team 2's sources produce the same id. Two rows with one identity means
 * duplicate React keys in the rack and a stage that drives whichever `find()`
 * reached first: the left-team panel toggling the right-team source. That is the
 * exact bug board-aware binding fixed, one axis over. Registering an element
 * does not change the answer — Stats, Roster, Controller, Player Name and Team
 * Logo are all registered and all read their ?team= straight off the URL here,
 * which is what keeps their left/right sources two rows.
 *
 * Feed-scoped elements deliberately get neither. Their container is
 * board-agnostic and the board rides in the pushed payload — see the "two board
 * mechanisms" note in elements.js. Conflating the two is how multiplicity ends
 * up feeling bolted on.
 *
 * The scene is the third term, and it lives in ./placements — which is also
 * where discovery now happens. This module used to build the instance list by
 * taking the boards a producer had DECLARED (scoreboards.active) union the ones
 * DISCOVERED in OBS, so that a configured-but-unsourced board still got a rack
 * row to bind from. The rack lists only what is really in a scene now, and the
 * Add picker is how a source comes into being, so the declared half has no
 * reader left; what survives here is the id grammar the rest of the console
 * keys on.
 */

const ORIGIN = typeof window !== 'undefined' && window.location
    ? window.location.origin
    : 'http://localhost';

/*
 * The params that make two sources of the same overlay two different things,
 * with the one-letter tag each contributes to an id and how it reads in the
 * rack. Mirrors DISTINGUISHING_PARAMS in lib/obs-binding.js, which answers the
 * same question for MATCHING; the labels mirror the variant tables in
 * server/api/v1/layouts.py, which is what the producer picked from.
 *
 * `scoreboard` is deliberately absent — it is the board axis above, and giving
 * it a tag here would produce two spellings of one fact.
 */
const VARIANT_PARAMS = [
    ['team', 't', (v) => `Team ${v}`],
    ['size', 'z', (v) => ({ s: 'Small', m: 'Medium', l: 'Large' }[v] ?? String(v).toUpperCase())],
    // `dir` outlives the only layout that ever offered it (the 4-cam scorecard,
    // deleted with the full-scene group). Kept because it costs nothing and it
    // is what keeps a producer's leftover ?dir=left / ?dir=right sources two
    // rows instead of two rows sharing one id.
    ['dir', 'd', (v) => ({ left: 'Point Left', right: 'Point Right' }[v] ?? v)],
    ['port', 'p', (v) => `Port ${v}`],
];

/*
 * `~` separates the variant from the rest of an id. It appears in neither half
 * it divides: element ids are plain identifiers, the board suffix is digits,
 * and layout pathnames don't carry it. Scene names may contain anything, but
 * ./placements appends the scene AFTER this, and splits on its own separator
 * first — so the variant is always read out of an already-narrowed string.
 */
export const VARIANT_SEP = '~';

export const withVariant = (base, variant) => (variant ? `${base}${VARIANT_SEP}${variant}` : base);

/*
 * The SLOT separator — an element's place on a container's roster.
 *
 * A container member that also owns a dedicated source is two rows: its own
 * source, and its slot on the container that can stand it up instead. Both are
 * placements of the same element, so the bare element id can only spell one of
 * them — and the pair collided the moment the post-game callouts stopped being
 * fed-only (duplicate React keys in the rack, and a panel driving whichever
 * `find()` reached first, which is the same bug the board and variant axes
 * exist to prevent).
 *
 * `+` appears in neither half it divides: element ids are plain identifiers and
 * a container id is a slug (`containerIdFor`), which strips it. Read out before
 * the board and variant axes, so `stats+stats-bar` is still the `stats` element.
 */
export const SLOT_SEP = '+';

export const slotInstanceId = (elementId, container) =>
    (container ? `${elementId}${SLOT_SEP}${container}` : elementId);

// The variant tag a source URL earns, e.g. 't2', 'zs', 't1.zl'. Empty when the
// URL names none — which is every overlay that has only one of itself.
export function variantOf(url) {
    let u;
    try { u = new URL(url || '', ORIGIN); } catch { return ''; }
    const parts = [];
    for (const [param, tag] of VARIANT_PARAMS) {
        const v = u.searchParams.get(param);
        if (v) parts.push(`${tag}${v}`);
    }
    return parts.join('.');
}

/*
 * The variant tag for one param/value ('size','s' → 'zs'). The catalog tier
 * builds rows for variants no source exists for yet, and this keeps it from
 * hand-spelling the one-letter tags that VARIANT_PARAMS already owns.
 */
export function variantTagFor(param, value) {
    const entry = VARIANT_PARAMS.find(([p]) => p === param);
    return entry && value != null ? `${entry[1]}${value}` : '';
}

/*
 * The inverse of `variantOf`: the query params a variant tag stands for
 * ('zs' → [['size','s']]).
 *
 * Online a variant is READ off a source that already exists, so nothing ever
 * needed to go the other way. The catalog tier has no source to read — it is
 * the list of what a producer could create — so it has to be able to WRITE the
 * variant it is offering back into a URL. One table serves both directions,
 * which is what stops "Small" in the rack from meaning something different to
 * the URL that Copy hands over.
 */
export function variantParams(variant) {
    if (!variant) return [];
    const out = [];
    for (const part of String(variant).split('.')) {
        const entry = VARIANT_PARAMS.find(([, tag]) => part.startsWith(tag));
        if (entry) out.push([entry[0], part.slice(entry[1].length)]);
    }
    return out;
}

/*
 * How a variant reads when its siblings are on screen with it — including the
 * DEFAULT one, which has no tag to read a name off.
 *
 * The default size deliberately carries no variant tag: a source with no ?size=
 * is exactly that size, so its instance id is the bare `scoreboard:1` and must
 * stay that way (see catalogPlacements). But a row list of "Scoreboard · B1",
 * "Scoreboard · B1 · Small", "Scoreboard · B1 · Medium" then offers a small, a
 * medium and an unnamed one — Large exists and nothing says so, which is the
 * "smaller ones read as the big one with pieces missing" problem back in the
 * labels. The Add picker has always named it ("Scoreboard — Large", from the
 * layouts API), so the row it created disagreed with the row that created it.
 *
 * The name comes off the element's own size table. Nothing about the id changes:
 * this is what the row SAYS, not what it is.
 */
export function variantLabelFor(element, variant) {
    if (variant) return variantLabel(variant);
    return element?.sizes?.find(s => s.default)?.label ?? null;
}

// How a variant reads in the rack ('t2' → "Team 2"). Null when there is
// nothing to say, so a caller can drop the slot rather than print an empty one.
export function variantLabel(variant) {
    if (!variant) return null;
    const out = [];
    for (const part of String(variant).split('.')) {
        const entry = VARIANT_PARAMS.find(([, tag]) => part.startsWith(tag));
        if (entry) out.push(entry[2](part.slice(entry[1].length)));
    }
    return out.length ? out.join(' · ') : null;
}

/*
 * The instance half of a row id: `scoreboard:2`, `stats~t1`, `scoreboard:1~zs`,
 * or plain `lowerthird` for an element with only one of itself. ./placements
 * appends `@{scene}` to make it a full row id.
 *
 * Desk ids ('desk:match', 'desk:board:2') share the colon, and they must not be
 * parsed as instances — a desk is not an element, so nothing about it is a type
 * plus a board even when it ends in a board number. `parseInstanceId` guards on
 * the prefix for that reason; see the note there.
 */
export function instanceId(element, board, url) {
    if (!element) return null;
    const base = element.scope === 'board' && board != null
        ? `${element.id}:${board}`
        : element.id;
    return withVariant(base, variantOf(url));
}

/*
 * The desk namespace. A desk id is OPAQUE here: it names a content workflow,
 * not an element on a board, so it must come back whole.
 *
 * This used to hold by accident. The rule was "the board suffix is always
 * digits, so a desk name must not be numeric" — but the head of the pattern
 * below is greedy, so ANY id ending in digits splits: `desk:board:2` parsed as
 * element `desk:board` on board 2, and the stage would then look up an element
 * that does not exist instead of the desk the producer clicked. Boards are desks
 * now, and their ids carry a board number, so the documented rule needs to be a
 * real one.
 */
export const DESK_PREFIX = 'desk:';

export function parseInstanceId(id) {
    const s = String(id ?? '');
    const cut = s.indexOf(VARIANT_SEP);
    const base = cut < 0 ? s : s.slice(0, cut);
    const variant = cut < 0 ? null : s.slice(cut + 1) || null;
    if (base.startsWith(DESK_PREFIX)) return { elementId: base, board: null, variant };
    // The slot comes off FIRST: a container slot is the element, on a
    // container, and everything below answers questions about the element.
    const slotCut = base.indexOf(SLOT_SEP);
    const slot = slotCut < 0 ? null : base.slice(slotCut + 1) || null;
    const head = slotCut < 0 ? base : base.slice(0, slotCut);
    const m = /^(.+):(\d+)$/.exec(head);
    return m
        ? { elementId: m[1], board: Number(m[2]), variant, slot }
        : { elementId: head || null, board: null, variant, slot };
}
