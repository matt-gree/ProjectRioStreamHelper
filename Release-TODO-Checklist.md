# PRSH Release TODO — Working Checklist

Priority order. Correctness/stability before polish. Check off as completed.

---

## Priority 1 — Bugs & Correctness

### 1. Separate Scorecard Settings  ✅ (build-green, OBS-unverified)
Scorecard settings now stored per scoreboard under `overlays.scorecard.{N}.*`; legacy flat `overlays.scorecard.*` kept as non-destructive fallback.
- [x] Settings persist per scoreboard (`overlays.scorecard.{N}.*`)
- [x] Editing one scoreboard's scorecard settings doesn't affect others (Layouts tab writes per active scoreboard sub-tab)
- [x] Existing scoreboards keep working — mount reads per-SB then falls back to legacy global
- Files: `scorecard-mount.js` (scGet helper + NS), `overlay-base.js` (`applyDesignSettings(type, nsKey)`), `layouts.jsx` (`LayoutSettingsPanel` per-SB), `scorecard.html` (preview seeds), `designConstants.js`
- ⚠ Edge: "removing" a style-override on one SB won't override a legacy *global* pin (rare; toggles unaffected)

### 2. Phase Text (Scorecard)  ✅ (build-green, OBS-unverified)
- [x] Phase field defaults to blank string
- [x] Auto-sources from assigned match (`score.{N}.phase`); manual `phaseText` overrides
- [x] No match phase + no manual text → blank, field hidden (no empty placeholder), stack closes gap
- Files: `scorecard-mount.js` (matchPhase/manualPhase resolve), `designConstants.js` (description)

---

## Priority 2 — Core Broadcast UI

### 3. (Completed — skip to 4)  ✅

### 4. HTML Player Overlay  ✅ (OBS-verified)
- [x] Player 1 text left aligned (`body[data-team="1"]` → flex-start)
- [x] Player 2 text right aligned (`body[data-team="2"]` → flex-end)
- [x] Display player tags above player names (address-book prefix → `score.{N}.player.{T}.team`, `--accent` colored, hidden when empty)
- Files: `public/layout/scoreboard1/playername.html` (column layout, tag line, `accentColor` added to meta whitelist)

### 5. Event Header Layout  ⬜
- Font: ITC Korinna
- Top row (center, 1263×47px): Event, Location, Dates
- Bottom row (center, 1263×44px): Message, Bracket, Phase, Round
- [ ] Center all text
- [ ] Skip blank fields, re-center remaining
- [ ] Hook into Competition tab
- [ ] Add editable Message field to Competition settings

### 6. Lower Third  ⬜ (built, slice26; pending user visual validation)
When a match is assigned, auto-include match metadata: Competition Phase, Round.
- [x] `match` slot auto-surfaces a joined `Competition Phase · Round` line from the bound match (`phase` · `label`)
- [x] Only display fields with values — single joined line, blanks skipped
- [x] Omit unavailable fields without empty space — line + backing card hide entirely when the match carries none
- [x] Competition Phase: `match.phase`, falling back to tournament-wide `tournamentInfo.phase`
- [x] slice26: meta is its own bottom **full-width row** with an `lt-well` backing card (mount toggles `meta-card` opacity with the text)
- [x] Editable Competition-phase input in both the Match tab (`MatchPanel`) and Production draft bar (`MatchAccordion`); round label input clarified/relabeled
- [x] Graceful no-captain: name slides into the sprite's reserved space (no gap) when no captain is selected
- Files: `lowerthird-mount.js` (meta bind + `meta-card` toggle + `reflowSideName`), `user_data/design_packages/slice26/lowerthird.svg` (bottom meta row + card), `design/{default,classic}/lowerthird.svg`, `MatchPanel.jsx` + `production.jsx` (phase inputs), `server/api/v1/match.py` + `server/match.py` (`phase` on payload + default), `preview/lowerthird_sample.json`, `design/README.md`
- ⚠ **Restart the backend** — `phase` on `MatchPayload` is a Python change; the running server still rejects it (silently drops the edit) until reload
- ⚠ Static asset — hard-refresh the OBS source + the Layouts/Production preview iframe (Cmd/Ctrl+Shift+R) to drop the cached pre-edit SVG

### 7. Stats Plate Redesign  ⬜
Redesign using existing Plum glass design language.
- [ ] Increase height to ~2 rows
- [ ] Larger typography in the extra space
- [ ] Improve readability, keep visual style

---

## Priority 3 — Scorecards

### 8. Medium Scorecard (Completed Games)  ⬜
For completed games, modify lower info section.
- [ ] Replace Elo with: Game Mode, Stadium, Game Length, Date/Time
- [ ] Stack team/player names vertically for larger type
- [ ] If team logo unavailable, show captain's character portrait

### 9. Simple 4-Cam Scorecard  ⬜
New scorecard type for 4-camera broadcasts.
- [ ] Player names stacked vertically
- [ ] Team logos
- [ ] Directional arrow (left or right)
- [ ] Prioritize readability; consistent with scorecard family

---

## Priority 4 — Broadcast Polish

### 10. Matchup History  ⬜
- [ ] First meeting → collapse Matchup History section (no empty area)
- [ ] Unchanged when previous meetings exist

### 11. Player Plates  ⬜
- [ ] Match Commentary Plates styling/layout/animation
- [ ] Complete remaining production-readiness polish

### 12. Schedule Element  ⬜
- [ ] Queue upcoming matches
- [ ] Display queued matches on screen
- [ ] Support up to 4 simultaneously, stacked vertically
</content>
</invoke>
