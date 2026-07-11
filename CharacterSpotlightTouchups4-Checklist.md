# Character Spotlight Touchups 4 (Final Refinement) — Checklist

Source: `CharacterSPotlightTouchups4.md`. Status legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[d]` deferred (discussed).

Files: **M** = `public/layout/lib/postgame-callout-mount.js` · **R** = `rio-visualizer/web/renderer.js` (submodule working tree) · **S** = `server/postgame.py`.

## Home Run Camera
- [ ] (R) On stadium-mesh collision, hero cam settles gracefully at the point of impact — no continued downward pan implying flight beyond the stadium

## Short Hit Camera
- [ ] (R) Gentle cam shares the long-hit camera language: similar movement, more aggressive than current, slightly wider framing — consistency across all batted balls, deeper hits still more dramatic

## Batting Card Polish
- [ ] (M) Rethink batting card spacing: no dead reserved space before OBP/SLG appear; balanced both before and after the reveal
- [ ] (M) Four-digit SLG values (e.g. 1.000) no longer clip

## Camera Reset Animation
- [ ] (R+M) Animated return to the default viewing position after a hit concludes (no snap) — reads as part of the replay sequence

## Spray Chart Camera
- [ ] (R) Complete rethink: idle presentation camera — very slow continuous movement, large gradual motion, most of the field always visible, no tight zoom on clusters, home plate visible whenever practical; comfortable to loop indefinitely

## AB History
- [ ] (M) Rainbow/live highlight stops on the previous chip when the next AB begins — only the current AB carries active emphasis

## Team Logo
- [ ] (M) Background logo bigger + vertically centered behind the hero; reads as background graphic, recognizable but not competing

## Hit Contact
- [ ] (M) Nice/Sour contact listed on the AB chip (like Perfect) and in the hit frame stamp

## Final Review
- [ ] Holistic screenshot pass: intentional camera moves, smooth transitions, clear hierarchy, nothing placeholder-feeling
