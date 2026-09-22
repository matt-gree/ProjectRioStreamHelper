/**
 * rio-data.js — Shared data helpers for MSB overlays.
 *
 * One source of truth for:
 *   - which team is batting vs pitching (getTeamRole)
 *   - captain-aware roster ordering (getRosterSlots)
 *   - per-character stat line selection (getStatsLine)
 *   - character icon URLs (charIconUrl) and the captain fallback a logo
 *     well uses when a side has no team logo (captainIconUrl)
 *
 * Overlays own their own DOM + CSS. This file owns the *logic*: change
 * captain detection, add a new stat, swap which icon marks batting, etc.
 * in one place and every overlay that loops over the returned data picks
 * it up automatically.
 *
 * Load order: after overlay-base.js (depends on OverlayBase.deepGet and
 * OverlayBase.BASE_URL).
 */
(function () {
  const { deepGet } = OverlayBase;

  // ── URL helpers ──────────────────────────────────────────────────────────
  function charIconUrl(name) {
    const id = OverlayBase.charId(name);
    if (id === undefined) return '';
    return `${OverlayBase.BASE_URL}/game_assets/msb/characterIcons/${id}.png`;
  }

  function roleIconUrl(role) {
    const file = role === 'batting' ? 'bat.png' : 'glove.png';
    return `${OverlayBase.BASE_URL}/game_assets/msb/gameIcons/${file}`;
  }

  function teamLogoUrl(teamName) {
    const id = OverlayBase.teamId(teamName);
    if (id === undefined) return '';
    return `${OverlayBase.BASE_URL}/game_assets/msb/teamLogos/${id}.png`;
  }

  /*
   * A side's LEAGUE logo — set by server/league_logos.py when the board's
   * game is played in a league an address book is linked to, and the player
   * carries a logo in that book. It outranks the MSB team logo in every logo well:
   * in a league game the team a player represents is the league's, and the
   * MSB team is only what their captain happens to imply. "" when none.
   */
  function leagueLogoUrl(state, sb, team) {
    const path = deepGet(state, `score.${sb}.player.${team}.league_logo`, '');
    return path ? `${OverlayBase.BASE_URL}${path}` : '';
  }

  // ── Number formatting ────────────────────────────────────────────────────
  /*
   * A rate to three places, written the way baseball writes one: no leading
   * zero below 1 (".417"), and the whole number kept once there is one
   * ("1.667"). AVG, SLG and opponent AVG all read this way on a scoreboard, and
   * the Character Spotlight has always formatted them like this
   * (postgame-callout-mount.js) — this is the same convention reaching the stat
   * cards, not a new one.
   *
   * It buys real room as well as correctness: a leading zero is a whole glyph
   * in the widest cell on the 2x2 stat card, where three of the four values are
   * rates and the neighbouring column is one grid divider away.
   */
  function fmt3(v) { return Number(v).toFixed(3).replace(/^0\./, '.'); }
  function fmt2(v) { return Number(v).toFixed(2); }
  function fmt1(v) { return Number(v).toFixed(1); }
  function fmt0(v) { return Number(v).toFixed(0); }

  // ── Transport detection ──────────────────────────────────────────────────
  /*
   * Which transport a board carries. DERIVED, never picked — the same rule the
   * server derives it by (server/bindings.py `transport`): board 1 carries the
   * local HUD iff the global project_rio.hud_enabled toggle is on, and every
   * other board is API.
   *
   * This used to read `scoreboards.sources.{sb}.type === 'hud'`, a settings key
   * that the binding model retired: it is a read-only migration fallback that
   * nothing writes any more, so it sits frozen at whatever it was before the
   * migration ('manual' on a board that has carried the HUD ever since). The
   * cost was silent and specific — every HUD-only field went dark while the
   * card still rendered. `current_game.batting_line` / `pitching_line` are only
   * offered on a HUD board, so the stat card's game line never populated and
   * its bottomLabel fell through to the API caption ("Tournament Stats") on a
   * live HUD game.
   */
  function isHudSource(sb) {
    return Number(sb) === 1 &&
      !!deepGet(OverlayBase.settings, 'project_rio.hud_enabled', true);
  }

  // ── Role detection ───────────────────────────────────────────────────────
  /** Which side is `team` on this half-inning? 'batting' or 'pitching'. */
  function getTeamRole(state, sb, team) {
    const homeTeam = Number(deepGet(state, `score.${sb}.home_team`) ?? 2);
    const halfInning = deepGet(state, `score.${sb}.half_inning`) ?? 'Top';
    const awayTeam = homeTeam === 2 ? 1 : 2;
    const battingTeam = halfInning === 'Top' ? awayTeam : homeTeam;
    return battingTeam === team ? 'batting' : 'pitching';
  }

  /*
   * The side's CAPTAIN icon — what a logo well falls back to when the side has
   * no team logo to draw. Every element that draws one faces the same empty
   * well: a completed record with no MSB team assigned, a fixture bound before
   * a game, an asset pack that is missing that one file. The Scoreboard and the
   * Scorecard both answer it, so the answer is here rather than twice.
   *
   * By INDEX, because that is what a captain is in a Rio record
   * (`rio_captainIndex` into the same 9-slot roster the band draws). A side
   * with no captain index has no captain — it returns nothing rather than
   * guessing slot 0, which is `getRosterSlots`'s rule for ORDERING a full band
   * and the wrong one for naming a single icon.
   */
  function captainIconUrl(state, sb, team) {
    const idx = deepGet(state, `score.${sb}.player.${team}.rio_captainIndex`, null);
    if (idx == null || idx < 0 || idx > 8) return '';
    const name = deepGet(state, `score.${sb}.player.${team}.character.${idx}.name`, '');
    return name ? charIconUrl(name) : '';
  }

  /** Index of `charName` in team's 9-character roster, or -1. */
  function findCharIndex(state, sb, team, charName) {
    if (!charName) return -1;
    for (let i = 0; i < 9; i++) {
      const n = deepGet(state, `score.${sb}.player.${team}.character.${i}.name`);
      if (n === charName) return i;
    }
    return -1;
  }

  // ── Roster slots ─────────────────────────────────────────────────────────
  /**
   * Ordered slots for rendering a roster. Each slot is:
   *   { kind: 'captain' | 'char' | 'role', name, imgUrl, role? }
   *
   * Captain (if any) is emitted first. If no explicit captain, slot 0 is
   * treated as the captain slot. A trailing 'role' slot (bat/glove icon)
   * is included when opts.includeRole is true AND the roster has at least
   * one character.
   */
  function getRosterSlots(state, sb, team, opts = {}) {
    const { includeRole = true } = opts;
    const player = deepGet(state, `score.${sb}.player.${team}`);
    if (!player) return [];

    const captainIndex = player.rio_captainIndex;
    const hasCaptain = captainIndex != null && captainIndex >= 0 && captainIndex <= 8;

    const slots = [];

    if (hasCaptain) {
      const char = deepGet(player, `character.${captainIndex}`) ?? {};
      const name = char.name || '';
      slots.push({ kind: 'captain', name, imgUrl: charIconUrl(name), isStarred: !!char.is_starred });
    }

    for (let i = 0; i < 9; i++) {
      if (hasCaptain && i === captainIndex) continue;
      const char = deepGet(player, `character.${i}`) ?? {};
      const name = char.name || '';
      const kind = (!hasCaptain && i === 0) ? 'captain' : 'char';
      slots.push({ kind, name, imgUrl: charIconUrl(name), isStarred: !!char.is_starred });
    }

    const hasAnyChar = slots.some(s => s.name);
    if (hasAnyChar) {
      if (includeRole) {
        const role = getTeamRole(state, sb, team);
        slots.push({ kind: 'role', role, imgUrl: roleIconUrl(role) });
      }
      if (opts.includeTeamLogo) {
        const league = leagueLogoUrl(state, sb, team);
        const teamName = deepGet(player, 'msb_team') || '';
        if (league || teamName) {
          slots.push({ kind: 'teamLogo', imgUrl: league || teamLogoUrl(teamName) });
        }
      }
    }

    return slots;
  }

  // ── Stats line ───────────────────────────────────────────────────────────
  /**
   * Stats for the character currently batting/pitching for `team`, or null
   * if there's no active character or they aren't on the roster.
   *
   * Returns:
   *   {
   *     charName, charIndex, charIconUrl,
   *     role: 'batting' | 'pitching',
   *     stats: [{ label, value, width }, ...],  // display-ready; see below
   *     gameLine: string,                  // current-game batting/pitching line
   *   }
   *
   * To add/remove/reorder stats, edit the arrays below. Every overlay that
   * loops over `result.stats` picks up the change automatically.
   *
   * == `width` IS HOW MANY CHARACTERS THE CATEGORY NEEDS AT ITS WIDEST ========
   * A stat is not a generic number: AB is an integer and AVG is a rate with a
   * leading dot, so giving them the same column makes a two-digit AB float in a
   * cell built for ".429". `width` is what lets a card divide its band in the
   * ratio the numbers actually need (`layoutStatCells`, mount-utils.js), and
   * these are MAXIMA rather than typical widths — a cell wide enough for the
   * worst case never auto-fits, and a value that suddenly renders smaller than
   * the three beside it is worse on air than a slightly roomier column.
   *
   * The maxima are the reason the PRECISION here is what it is. A percentage
   * carried to a tenth is six characters at "100.0%" and an ERA to a hundredth
   * is five at "12.00"; at those budgets the numerals have to come down to
   * about 28px on a 452-wide bar to fit. Whole percents and one decimal of ERA
   * hold them at 30 with nothing auto-fitting in either stat set. (Baseball
   * writes ERA to two decimals; this is a deliberate departure, made for a
   * broadcast card read at a glance from across a room rather than a box
   * score.) A format change here therefore moves `width` with it.
   */
  function getStatsLine(state, sb, team) {
    const role = getTeamRole(state, sb, team);
    const charName = role === 'batting'
      ? (deepGet(state, `score.${sb}.batter`) || '')
      : (deepGet(state, `score.${sb}.pitcher`) || '');
    if (!charName) return null;

    const rosterIdx = role === 'batting'
      ? deepGet(state, `score.${sb}.batter_roster_index`)
      : deepGet(state, `score.${sb}.pitcher_roster_index`);
    const charIndex = (rosterIdx != null && rosterIdx >= 0)
      ? rosterIdx
      : findCharIndex(state, sb, team, charName);
    return buildStatsLine(state, sb, team, charName, charIndex, role);
  }

  /**
   * Stats for an explicitly chosen roster character — the producer "fed"
   * content path. Unlike getStatsLine, this ignores who is currently
   * batting/pitching; `team` + `charIndex` come from the producer's pick and
   * `role` ('batting' | 'pitching') selects which stat set to show.
   * Returns null if the slot is empty.
   */
  function getStatsLineForChar(state, sb, team, charIndex, role = 'batting') {
    if (charIndex == null || charIndex < 0) return null;
    const charName =
      deepGet(state, `score.${sb}.player.${team}.character.${charIndex}.name`) ||
      deepGet(state, `score.${sb}.stats.${team}.character.${charIndex}.name`) || '';
    if (!charName) return null;
    return buildStatsLine(state, sb, team, charName, charIndex, role);
  }

  // Shared builder for both the auto (current batter/pitcher) and fed
  // (producer-chosen character) stats lines. `charName`/`charIndex`/`role`
  // are already resolved by the caller.
  function buildStatsLine(state, sb, team, charName, charIndex, role) {
    if (!charName || charIndex == null || charIndex < 0) return null;

    const statsObj = deepGet(state, `score.${sb}.stats.${team}.character.${charIndex}`);
    const b = statsObj?.batting ?? {};
    const p = statsObj?.pitching ?? {};

    let stats, gameLine;
    if (role === 'batting') {
      stats = [
        { label: 'AB',  value: b.at_bats ?? 0,             width: 3 },  // "132"
        { label: 'AVG', value: fmt3(b.avg    ?? 0),        width: 5 },  // "1.000"
        { label: 'SLG', value: fmt3(b.slg    ?? 0),        width: 5 },  // "1.500"
        { label: 'SO%', value: fmt0(b.so_pct ?? 0) + '%',  width: 4 },  // "100%"
      ];
      gameLine = isHudSource(sb)
        ? (statsObj?.current_game?.batting_line ?? '')
        : '';
    } else {
      stats = [
        { label: 'IP',  value: p.ip           ?? '0.0',    width: 5 },  // "128.1"
        { label: 'ERA', value: fmt1(p.era     ?? 0),       width: 4 },  // "12.0"
        { label: 'K%',  value: fmt0(p.k_pct   ?? 0) + '%', width: 4 },  // "100%"
        { label: 'AVG', value: fmt3(p.opp_avg ?? 0),       width: 5 },  // "1.000"
      ];
      gameLine = isHudSource(sb)
        ? (statsObj?.current_game?.pitching_line ?? '')
        : '';
    }

    const isHud = isHudSource(sb);
    const bottomLabel = isHud && gameLine ? 'Game' : (isHud ? '' : 'Tournament Stats');

    return {
      charName,
      charIndex,
      charIconUrl: charIconUrl(charName),
      role,
      stats,
      gameLine,
      bottomLabel,
      gameMode: gameMode(state, sb),
    };
  }

  /*
   * The game mode these stats are FOR, by name — "Stars On Showdown XXI",
   * "Mario Baseball (Base Game + QoL)".
   *
   * It arrives by two different roads depending on transport, which is why this
   * is a helper and not a state read at the call site: an API game carries the
   * mode on the game record (`score.{sb}.game_mode`), while a HUD game carries
   * only a numeric TagSetID that the server resolves to a name and stores on the
   * board's binding (`scoreboards.binding.{sb}.stats_tag`, written by
   * provider._apply_hud_game_mode). Board-scoped either way, so a card on board
   * 2 names board 2's mode.
   *
   * A PRODUCER'S PICK OUTRANKS BOTH. `stats_tag_manual` marks the tag as an
   * override rather than the feed's answer (server/bindings.py sync_stats_tag),
   * and an override that loses on air is not an override — same rule as
   * `player.{T}.rioName_override` winning over the feed's `rioName`. Without the
   * flag this fell through to the game record, so a producer correcting a
   * mislabelled mode watched the overlay keep the wrong one.
   *
   * Returns '' when neither is known — a caller building a caption out of this
   * should hide the caption rather than print a bare "Stats".
   */
  function gameMode(state, sb) {
    const tag = deepGet(OverlayBase.settings, `scoreboards.binding.${sb}.stats_tag`, '');
    const manual = deepGet(OverlayBase.settings, `scoreboards.binding.${sb}.stats_tag_manual`, false);
    if (manual && tag) return tag;
    return deepGet(state, `score.${sb}.game_mode`, '') || tag || '';
  }

  window.RioData = {
    charIconUrl,
    roleIconUrl,
    teamLogoUrl,
    leagueLogoUrl,
    fmt1, fmt2, fmt3,
    isHudSource,
    gameMode,
    getTeamRole,
    findCharIndex,
    captainIconUrl,
    getRosterSlots,
    getStatsLine,
    getStatsLineForChar,
  };
})();
