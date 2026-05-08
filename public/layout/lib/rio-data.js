/**
 * rio-data.js — Shared data helpers for MSB overlays.
 *
 * One source of truth for:
 *   - which team is batting vs pitching (getTeamRole)
 *   - captain-aware roster ordering (getRosterSlots)
 *   - per-character stat line selection (getStatsLine)
 *   - character icon URLs (charIconUrl)
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
    if (!name) return '';
    return `${OverlayBase.BASE_URL}/game_assets/msb/characterIcons/${encodeURIComponent(name)}.png`;
  }

  function roleIconUrl(role) {
    const file = role === 'batting' ? 'bat.png' : 'glove.png';
    return `${OverlayBase.BASE_URL}/game_assets/msb/gameIcons/${file}`;
  }

  function teamLogoUrl(teamName) {
    if (!teamName) return '';
    return `${OverlayBase.BASE_URL}/game_assets/msb/teamLogos/${encodeURIComponent(teamName)}.png`;
  }

  // ── Number formatting ────────────────────────────────────────────────────
  function fmt3(v) { return Number(v).toFixed(3); }
  function fmt2(v) { return Number(v).toFixed(2); }
  function fmt1(v) { return Number(v).toFixed(1); }

  // ── Source detection ─────────────────────────────────────────────────────
  function isHudSource(sb) {
    const type = deepGet(OverlayBase.settings, `scoreboards.sources.${sb}.type`, 'manual');
    return type === 'hud';
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
        const teamName = deepGet(player, 'msb_team') || '';
        if (teamName) {
          slots.push({ kind: 'teamLogo', imgUrl: teamLogoUrl(teamName) });
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
   *     stats: [{ label, value }, ...],   // display-ready
   *     gameLine: string,                  // current-game batting/pitching line
   *   }
   *
   * To add/remove/reorder stats, edit the arrays below. Every overlay that
   * loops over `result.stats` picks up the change automatically.
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
    if (charIndex < 0) return null;

    const statsObj = deepGet(state, `score.${sb}.stats.${team}.character.${charIndex}`);
    const b = statsObj?.batting ?? {};
    const p = statsObj?.pitching ?? {};

    let stats, gameLine;
    if (role === 'batting') {
      stats = [
        { label: 'AB',  value: b.at_bats ?? 0 },
        { label: 'AVG', value: fmt3(b.avg    ?? 0) },
        { label: 'SLG', value: fmt3(b.slg    ?? 0) },
        { label: 'SO%', value: fmt1(b.so_pct ?? 0) + '%' },
      ];
      gameLine = isHudSource(sb)
        ? (statsObj?.current_game?.batting_line ?? '')
        : '';
    } else {
      stats = [
        { label: 'ERA', value: fmt2(p.era     ?? 0) },
        { label: 'IP',  value: p.ip           ?? '0.0' },
        { label: 'K%',  value: fmt1(p.k_pct  ?? 0) + '%' },
        { label: 'AVG', value: fmt3(p.opp_avg ?? 0) },
      ];
      gameLine = isHudSource(sb)
        ? (statsObj?.current_game?.pitching_line ?? '')
        : '';
    }

    const isHud = isHudSource(sb);
    const bottomLabel = isHud && gameLine ? 'Game' : (isHud ? '' : 'Season Stats');

    return {
      charName,
      charIndex,
      charIconUrl: charIconUrl(charName),
      role,
      stats,
      gameLine,
      bottomLabel,
    };
  }

  window.RioData = {
    charIconUrl,
    roleIconUrl,
    teamLogoUrl,
    fmt1, fmt2, fmt3,
    isHudSource,
    getTeamRole,
    findCharIndex,
    getRosterSlots,
    getStatsLine,
  };
})();
