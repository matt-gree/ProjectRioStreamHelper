# PRSH Release TODO — Working Checklist

Priority order. Correctness/stability before polish. Check off as completed.

**Audited against the code 2026-07-28.** Items 9, 10 and 12 were finished but
left unticked; 8 is partial and its target layout is ambiguous. Still genuinely
open: **7** (Stats Plate), **8** (completed-game info), **11** (Player Plates),
and **6**'s visual sign-off. Separately, the Production console has still never
been run against a live OBS — that is not an item here, but it gates the
release.

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

### 5. Event Header Layout  ✅
- Font: ITC Korinna
- Top row (center, 1263×47px): Event, Location, Dates
- Bottom row (center, 1263×44px): Message, Bracket, Phase, Round
- [x] Center all text
- [x] Skip blank fields, re-center remaining
- [x] Hook into Competition tab
- [x] Add editable Message field to Competition settings

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

### 7. Stats Plate Redesign  ⬜ (not started)
Redesign using existing Plum glass design language.
- [ ] Increase height to ~2 rows
- [ ] Larger typography in the extra space
- [ ] Improve readability, keep visual style
- Current: `stats.html` is still 452×118, a single `stats-row` (`stats-mount.js`);
  `design/default/stats.svg` has a matching `viewBox="0 0 452 118"`. A height
  change is a theme re-author across every package, not just a mount edit.

---

## Priority 3 — Scorecards

### 8. Medium Scorecard (Completed Games)  ◑ (partial)
For completed games, modify lower info section.
- [x] Stadium and game mode surface on the completed cluster — Scorecard binds
      `stadium` + `mode` (`scorecard-mount.js`, `prettyStadium`/`stats_tag`);
      the medium Scoreboard's `row-final` carries `meta-main` (stadium ·
      innings) + `meta-date` (`scoreboard-mount.js`)
- [ ] Game Length and Date/Time — no game-length field anywhere; date is on the
      Scoreboard's meta line only, not the Scorecard
- [ ] Elo still renders (`elo{1,2}-group`, gated on the `showElo` toggle) — the
      item asked for it to be *replaced*, not made optional
- [ ] Stack team/player names vertically for larger type
- [ ] If team logo unavailable, show captain's character portrait —
      `teamLogoUrl()` has no fallback; roster order deliberately doesn't
      reorder for the captain
- ⚠ **Ambiguous which layout this is.** The completed-game cluster carrying Elo
  lives in `scoreboard-mount.js` (the medium *Scoreboard*), not the Scorecard.
  Resolve before building.

### 9. Simple 4-Cam Scorecard  ✅
New scorecard type for 4-camera broadcasts.
- [x] Player names stacked vertically (both teams stacked, no score)
- [x] Team logos
- [x] Directional arrow — a URL variant, not a live toggle: `?dir=left` (default)
      / `?dir=right` mirrors arrow, logos and text alignment, because a 4-cam
      layout places several of these and each needs its own aim
- [x] Readability / scorecard-family consistency — fixed slice26 look (plum
      glass + lime/teal side bars + slice-ramp arrow), self-scales to any source
      size. Native 480×176.
- Files: `public/layout/scorecard/fourcam.html`, `?dir=` variant expansion in
  `server/api/v1/layouts.py`

---

## Priority 4 — Broadcast Polish

### 10. Matchup History  ✅
- [x] First meeting → collapse the lower region (cards + divider), leaving the
      top summary, and swap the full band background for a compact one
- [x] Unchanged when previous meetings exist
- Files: `matchup-mount.js` (`hasHistory` gate)
- Note: themes **opt in** via `history`/`history-container` groups and a
  `band-compact` background. All slots are optional — a theme without them keeps
  its full band with empty cards, exactly as before. Re-author per package.
- Commit: `9564f05`

### 11. Player Plates  ⬜ (not started)
- [ ] Match Commentary Plates styling/layout/animation
- [ ] Complete remaining production-readiness polish
- Current: untouched since the element landed in `6427168`.

### 12. Schedule Element  ✅
- [x] Queue upcoming matches — `schedule.queue` is an ordered list of match ids
      in State; the queue never copies fixture data, so a fixture edit
      re-renders with no projector
- [x] Display queued matches on screen — `public/layout/schedule/schedule.html`,
      with live / decided row states and `scheduledAt` free text
- [x] Stacked vertically
- Files: `server/schedule.py`, `server/api/v1/schedule.py`,
  `src/routes/production/stage/schedule.jsx` (queue authoring on the stage)
- Commit: `30613a9`
- ⚠ Gap: no cap on rows — the layout renders the whole queue, so a long queue
  overflows the 1080 canvas. "Up to 4" was a minimum, never an enforced limit.
</content>
</invoke>
