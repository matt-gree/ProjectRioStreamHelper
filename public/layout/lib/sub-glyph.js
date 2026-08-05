// sub-glyph.js — which mark, if any, a sub-plate drawer wears.
//
// Shared by commentary-mount.js and playerplates-mount.js, which carry the same
// drawer: one address-book value, and — when the value alone can't say what it
// is — a small platform mark at the drawer's right end.
//
// WHY A MARK AND NOT A LABEL. The drawer used to print the field's NAME in gold
// caps above its value. That name is a thing the producer needs in the app,
// where they're choosing between nine address-book fields; on the stream the
// value has already said it. "he/him" is a pronoun, "Mario" is a main, and
// neither is improved by a caption. The one case the value genuinely can't
// carry is a bare handle — "@mattgree" is not self-evidently a Twitter handle —
// so exactly that case gets a mark, and everything else gets the whole drawer.
//
// The theme owns the artwork: these are `<symbol>` ids a design package
// declares (see public/design/default/commentary.svg). A package that doesn't
// declare one simply shows no badge for that field — the mounts check the
// symbol exists before binding it, so a partial package degrades to plain text
// rather than to a broken reference.

// Address-book subField → the theme symbol id that stands for it. Keys are the
// server's field names (SUBFIELD_LABELS in server/commentary.py).
export const SUB_GLYPHS = {
  twitter: 'sub-glyph-x',
  youtube: 'sub-glyph-youtube',
  rioName: 'rio-mark',
};

// What the drawer's own atmosphere is made of when the field isn't a platform:
// the house mark, same as the plate above it.
export const FALLBACK_GLYPH = 'rio-mark';

// Player Plates' MANUAL source has no subField — the producer types both the
// label and the value — so fall back to reading the label they typed. Only the
// obvious spellings; a label we don't recognise is not an error, it's a field
// that wears no mark.
const BY_LABEL = {
  twitter: 'twitter', x: 'twitter', 'twitter/x': 'twitter', 'x/twitter': 'twitter',
  youtube: 'youtube', yt: 'youtube',
  rio: 'rioName', 'rio name': 'rioName', rioname: 'rioName',
};

/** The SUB_GLYPHS key for a slot, or '' if it wears no mark. */
export function glyphKeyFor(subField, subLabel) {
  if (subField && SUB_GLYPHS[subField]) return subField;
  const t = String(subLabel || '').trim().toLowerCase();
  return BY_LABEL[t] || '';
}

/** Point a `<use>` at a symbol, both attribute forms (Safari/OBS still want xlink). */
export function setHref(el, id) {
  if (!el) return;
  el.setAttribute('href', id);
  el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', id);
}
