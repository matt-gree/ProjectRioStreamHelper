// mount-utils.js — tiny shared helpers duplicated (byte-for-byte) across the
// SVG-theme-engine mounts before this module existed. Kept intentionally
// small: these are primitives every `slots`-based mount needs, not a general
// dumping ground. See rio-data.js for URL/data helpers and reveal-gate.js for
// the show/hide + reveal-sequencing helpers.

// Count-dot / base "off" fill shared by Scoreboard and Scorecard.
export const DOT_OFF = 'rgba(255,255,255,0.08)';

// Set a theme engine slot's fill to `color` when on, DOT_OFF when off.
// No-ops when the theme doesn't declare the slot.
export function dot(engine, name, on, color) {
  const el = engine.slots[name];
  if (el) el.style.fill = on ? color : DOT_OFF;
}

// Probe-load an image URL before committing it to a theme engine slot, so a
// 404 (missing asset pack file) never leaves a broken-image icon on air —
// it falls back to an optional sibling slot (e.g. a default mark) instead.
// `isDisposed` is a () => bool so the mount can cancel a stale probe after
// dispose() or a theme swap replaces the slot element out from under it.
export function bindImageProbe(engine, isDisposed, slotName, url, fallbackSlot) {
  const el = engine.slots[slotName];
  if (!el) return;
  if (!url) {
    engine.setImage(slotName, '');
    if (fallbackSlot && engine.slots[fallbackSlot]) engine.slots[fallbackSlot].setAttribute('opacity', '1');
    return;
  }
  const img = new Image();
  img.onload = () => {
    if (isDisposed() || el !== engine.slots[slotName]) return;
    engine.setImage(slotName, url);
    if (fallbackSlot && engine.slots[fallbackSlot]) engine.slots[fallbackSlot].setAttribute('opacity', '0');
  };
  img.onerror = () => {
    if (isDisposed() || el !== engine.slots[slotName]) return;
    engine.setImage(slotName, '');
    if (fallbackSlot && engine.slots[fallbackSlot]) engine.slots[fallbackSlot].setAttribute('opacity', '1');
  };
  img.src = url;
}
