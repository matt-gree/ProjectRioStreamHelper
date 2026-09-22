// postgame-callout-chips.js — Character Spotlight AB-ticker chip subsystem:
// result-code metadata, the swing-tag / contact-quality readers shared with
// the theater's result stamp, and the per-chip markup builder. Consumed by
// both the ticker (progressive, one chip per PA as the walkthrough reaches
// it — see playAb in postgame-callout-theater.js) and its no-GSAP fallback
// (chipSnapAll).

// small HTML-escape shared by every string this element injects via
// innerHTML (chip text, plate identity, result stamps).
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Final-result code → ticker abbreviation / stamp text / flavor.
export const RESULT_META = {
  1: { abbr: 'K',   stamp: 'STRIKEOUT',   neg: true },
  2: { abbr: 'BB',  stamp: 'WALK' },
  3: { abbr: 'HBP', stamp: 'HIT BY PITCH' },
  // Rio's contact-out subtype labels (caught / line out / foul catch) are
  // unreliable — every contact out reads simply OUT.
  4: { abbr: 'OUT', stamp: 'OUT',         neg: true },
  5: { abbr: 'OUT', stamp: 'OUT',         neg: true },
  6: { abbr: 'OUT', stamp: 'OUT',         neg: true },
  7: { abbr: '1B',  stamp: 'SINGLE',      hit: true },
  8: { abbr: '2B',  stamp: 'DOUBLE',      hit: true },
  9: { abbr: '3B',  stamp: 'TRIPLE',      hit: true },
  10: { abbr: 'HR', stamp: 'HOME RUN',    hit: true },
  11: { abbr: 'E',  stamp: 'ERROR' },
  12: { abbr: 'E',  stamp: 'CHEM ERROR' },
  13: { abbr: 'BNT', stamp: 'BUNT' },
  14: { abbr: 'SF', stamp: 'SAC FLY' },
  15: { abbr: 'DP', stamp: 'DOUBLE PLAY', neg: true },
  16: { abbr: 'OUT', stamp: 'OUT',        neg: true },
};
// Codes that do NOT count as an official at-bat (walks, HBP, sac fly).
export const NON_AB_CODES = new Set([2, 3, 14]);
export const ORDINALS = ['', '1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH',
  '9TH', '10TH', '11TH', '12TH', '13TH', '14TH', '15TH'];

// Result detail bits for a ticker chip: distance / RBI / star swing for
// balls that mattered, the fielder it went to for plain outs, the count a
// strikeout ended on. All distances render in feet (recorded data is
// metric). Rendered as stacked rows beside the result abbreviation — the
// chip has vertical room where it has no horizontal room.
function chipDetail(ab) {
  const meta = RESULT_META[ab.resultCode] || {};
  const bits = [];
  if (ab.contact && meta.hit) bits.push(`${Math.round(ab.contact.distance * 3.28084)}ft`);
  if (ab.rbi) bits.push(`${ab.rbi} RBI`);
  if (ab.swing === 'Star') bits.push('★ SWING');
  if (!bits.length && ab.fielder && ab.fielder.position) bits.push(`TO ${ab.fielder.position}`);
  if (!bits.length && ab.resultCode === 1) bits.push(`ON ${ab.before.balls}-${ab.before.strikes}`);
  return bits.slice(0, 2);
}

// Compact swing-type tag shared by the AB chips and the hit-summary stamp:
// Charge swings show their meter % — undercharged as a plain fraction, full
// as "100%", overcharged as "+N%" over the top (the meter's over-hold
// amount, i.e. chargePct - 100).
export function swingTag(ab) {
  const type = (ab.swingInfo && ab.swingInfo.type) || ab.swing;
  if (!type || type === 'None') return '';
  if (type === 'Charge') {
    const pct = ab.swingInfo ? ab.swingInfo.chargePct : null;
    if (pct == null) return 'CHARGE';
    if (pct < 100) return `CHARGE ${pct}%`;
    if (pct === 100) return 'CHARGE 100%';
    return `CHARGE +${pct - 100}%`;
  }
  if (type === 'Slap') return 'SLAP';
  if (type === 'Star') return 'STAR';
  return String(type).toUpperCase();
}

// One AB chip's markup — built once (all data is known up front) but only
// inserted into the ticker DOM when the walkthrough reaches that PA (see
// playAb / chipSnapAll), so the ticker builds progressively instead of
// pre-rendering everything dimmed.
export function chipMarkup(ab, i) {
  const meta = RESULT_META[ab.resultCode] || { abbr: '?' };
  // Rio's "Result of AB" reads plain "Out" for a fielder's choice (batter
  // safe, a different runner forced out) same as any contact out — the
  // server derives the distinction from the runner blocks and flags it
  // additively (fieldersChoice) rather than a separate resultCode.
  const abbr = ab.fieldersChoice ? 'FC' : meta.abbr;
  const tag = swingTag(ab);
  // contact quality gives every ball in play its context — it owns the
  // detail line's left slot (the play detail moved up beside the result);
  // same three-tier vocabulary as the stamp. No contact (K/BB/HBP) reads a
  // dimmed NONE so every chip keeps the same vertical rhythm.
  const quality = contactQuality(ab) || ['none', 'NONE'];
  const starsBits = ab.starsUsed > 0 ? '★'.repeat(Math.min(ab.starsUsed, 6)) : '';
  const info = (tag || starsBits) ? `<div class="info">
      ${tag ? `<span class="swingtag">${escapeHtml(tag)}</span>` : ''}
      ${starsBits ? `<span class="starsused">${starsBits}</span>` : ''}
    </div>` : '';
  return `<div class="cs-abchip" id="cs-ab-${i}">
    <div class="top">
      <span>${ab.halfInning ? '▼' : '▲'}${ORDINALS[ab.inning] || ab.inning}</span>
      <span>${ab.before.outs} OUT</span>
    </div>
    <div class="res">
      <span class="abbr">${abbr}</span>
      <span class="dtxt">${chipDetail(ab).map((b) => `<span>${escapeHtml(b)}</span>`).join('')}</span>
    </div>
    <div class="det"><span class="ctag ${quality[0]}">${quality[1]}</span></div>
    ${info}
  </div>`;
}

// Contact quality from the recorded contact-type name. The stat files label
// it inconsistently across games — "Nice - Left", "Right Nice", "Perfect" —
// so match the keyword anywhere rather than a fixed prefix.
export function contactQuality(ab) {
  const ctype = String((ab.contact && ab.contact.typeName) || '');
  if (/perfect/i.test(ctype)) return ['perf', 'PERFECT'];
  if (/nice/i.test(ctype)) return ['nice', 'NICE'];
  if (/sour/i.test(ctype)) return ['', 'SOUR'];
  return null;
}
