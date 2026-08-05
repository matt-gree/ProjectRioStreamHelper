// postgame-callout-theater.js — Character Spotlight AB walkthrough + spray
// finale: the embedded RioVisualizer plumbing, the per-AB sequencer
// (transition card -> situate -> flight/no-flight -> chip land -> stamp ->
// runner/odometer resolution), and the intro/finale bookends. Owns its own
// run-cancellation token (`runSeq`) and the currently-playing GSAP timeline
// (`beatTl`) so a new show (or a hide) can cleanly cut off an in-flight one.
//
// createTheater({ stage }) returns the sequencer's public surface:
//   ensureRenderer()  — (re)create the HitRenderer bound to #cs-viewport/#cs-labels
//   startShow(ctx)    — play the whole walkthrough for ctx (fire-and-forget)
//   stopShow()        — cancel any in-flight walkthrough (element hidden)
//   dispose()         — stopShow() + tear down the renderer
//
// `stage` is the mount's single `.cs-stage` DOM node, captured once — the
// orchestrator rebuilds its innerHTML per show (buildDom) but never replaces
// the node itself, so holding the reference across shows is safe.
//
// See CHARACTER-SPOTLIGHT.md section 5 for the choreography rationale and
// section 6 for the renderer/camera contract.

import { ensureGsap } from './gsap-loader.js';
import { HitRenderer } from '/rio-visualizer/renderer.js';
import { RESULT_META, NON_AB_CODES, ORDINALS, escapeHtml, swingTag, contactQuality, chipMarkup } from './postgame-callout-chips.js';

const BEAT = {
  transIn: 0.28,    // band morphs into the between-AB transition card
  transHold: 0.95,  // the big "9TH INNING · 2 OUTS" card holds (theater resets under it)
  transOut: 0.28,   // card morphs back into the scoreboard band
  situate: 0.25,    // breath between the bar reveal and the pitch firing
  stampHold: 1.45,  // result stamp + runner movement dwell before the next PA
  shortHold: 0.5,   // extra landed dwell for short balls in play
  hrStampHold: 2.2, // home runs earn a longer dwell
  noFlight: 0.8,    // dim-theater beat length for K / BB / HBP
  finaleHold: 0.9,  // pause before the spray chart fires
};

const BASE_XY = { 0: [66, 118], 1: [118, 66], 2: [66, 14], 3: [14, 66], 4: [66, 118] };

export function createTheater({ stage }) {
  let renderer = null;       // HitRenderer, created with the theater DOM
  let loadedStadium = null;
  let runSeq = 0;            // cancels an in-flight walkthrough
  let beatTl = null;         // the currently-running GSAP timeline

  // ── theater / renderer plumbing ──────────────────────────────────────────

  function ensureRenderer() {
    const viewport = stage.querySelector('#cs-viewport');
    const labels = stage.querySelector('#cs-labels');
    if (renderer) { try { renderer.dispose(); } catch { /* ignore */ } }
    renderer = new HitRenderer({ viewport, labels, orbit: false, cinematic: true, fixedCam: true, viewMode: 'stream' });
    loadedStadium = null;
  }

  async function loadStadium(name) {
    if (!name || name === loadedStadium || !renderer) return;
    try {
      const resp = await fetch(`${OverlayBase.BASE_URL}/api/v1/visualizer/stadium/${encodeURIComponent(name)}`);
      if (!resp.ok) { console.warn('[charspotlight] stadium fetch failed', name, resp.status); return; }
      const json = await resp.json();
      // fixedCam mode locks the broadcast framing as part of setStadium, so
      // the field is on-camera from the first frame.
      if (renderer) { renderer.setStadium(name, json); loadedStadium = name; }
    } catch (e) {
      console.warn('[charspotlight] stadium fetch error', e.message);
    }
  }

  // Landing-marker semantics for the renderer: red X for outs (incl. a sac
  // fly's caught ball), circle for anything that landed safe (hits, errors,
  // bunts); home runs get the celebratory gradient-crawl trail.
  const OUT_CODES = new Set([4, 5, 6, 14, 15, 16]);
  const HR_CODE = 10;
  // "Deep fly" hero-camera threshold: chosen so a routine can-of-corn fly out
  // stays on the follow cam while anything that had real distance or hang
  // time — long outs, doubles/triples off the wall, not just home runs —
  // earns the hero treatment. 85m carry (~279ft) or a 30m apex (~98ft) both
  // qualify; either is well beyond a lazy fly ball in this game's field
  // scale.
  const DEEP_FLY_DISTANCE_M = 85;
  const DEEP_FLY_HEIGHT_M = 30;
  function isDeepFly(ab) {
    if (!ab.contact) return false;
    return (Number(ab.contact.distance) || 0) >= DEEP_FLY_DISTANCE_M
      || (Number(ab.contact.maxHeight) || 0) >= DEEP_FLY_HEIGHT_M;
  }
  function cameraFor(ab) {
    // home runs / deep flies get the full hero crane; EVERY other ball in
    // play gets the same crane at infield scale ('gentle') — the camera
    // always travels onto the field with the play. The pan-only follow cam
    // is never used here: mid-range hits on it read as "just a rotate from
    // behind home" against the hero treatment.
    return (ab.resultCode === HR_CODE || isDeepFly(ab)) ? 'hero' : 'gentle';
  }
  const abPath = (ab) => ({
    points: ab.contact.path,
    final: ab.contact.landing,
    out: OUT_CODES.has(ab.resultCode),
    hr: ab.resultCode === HR_CODE,
    star: ab.swing === 'Star',
  });

  // Fill the end-of-game FINAL card: names, box-score lines (from the
  // side-level totals), winner text-mark, stadium context.
  function fillFinalCard(ctx) {
    const q = (s) => stage.querySelector(s);
    const bxLine = (t) => {
      if (!t) return '';
      const bits = [`${t.hits ?? 0} H`, `${t.homeruns ?? 0} HR`];
      if (Number(t.stars_won) > 0) bits.push(`${t.stars_won} ★`);
      return bits.join(' · ');
    };
    const p1Score = ctx.p1?.score ?? 0, p2Score = ctx.p2?.score ?? 0;
    for (const [sel, p, score, won] of [
      ['#cs-final-s1', ctx.p1, p1Score, p1Score > p2Score],
      ['#cs-final-s2', ctx.p2, p2Score, p2Score > p1Score],
    ]) {
      const el = q(sel);
      el.querySelector('.n').textContent = p?.rioName || '';
      el.querySelector('.r').textContent = score;
      el.querySelector('.bx').textContent = bxLine(p?.totals);
      el.querySelector('.wtag').textContent = won ? 'Winner' : '';
      // !! by house rule: an undefined force makes toggle flip rather than
      // clear (overlay-class-toggle.test.js). `won` is a comparison today, but
      // the safety has to be visible at the call site, not two lines up.
      el.classList.toggle('win', !!won);
    }
    q('#cs-final-ctx').textContent = ctx.stadium || '';
  }

  // ── situation panel ───────────────────────────────────────────────────────

  function setSituation(ab, ctx) {
    const q = (s) => stage.querySelector(s);
    const half = ab.halfInning ? '▼' : '▲';
    const ord = ORDINALS[ab.inning] || ab.inning;
    q('#cs-diamond-inn').textContent = `${half} ${ord}`;
    q('#cs-count').textContent = `${ab.before.balls}-${ab.before.strikes}`;
    const icon = q('#cs-pitcher-icon');
    icon.innerHTML = ab.pitcher ? OverlayBase.charImg(ab.pitcher, 'picon', 48) : '';
    q('#cs-pitcher').textContent = ab.pitcher || '—';
    q('#cs-r1').textContent = ab.before.score['1'] ?? 0;
    q('#cs-r2').textContent = ab.before.score['2'] ?? 0;
    const dots = q('#cs-outdots').children;
    for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i < ab.before.outs);
    // our side's star stock
    const stars = Number(ab.before.stars[String(ctx.side)]) || 0;
    stage.querySelectorAll('#cs-starrow .st').forEach((el, i) => el.classList.toggle('on', i < stars));
    q('#cs-stars').classList.toggle('active', !!ab.before.starChance);
    // runner dots at their starting bases (batter's dot appears on movement)
    const g = q('#cs-runners');
    g.innerHTML = '';
    for (const r of ab.runners) {
      if (r.base === 0) continue;
      const [x, y] = BASE_XY[r.base] || [66, 66];
      g.insertAdjacentHTML('beforeend',
        `<circle class="runner" data-base="${r.base}" cx="${x}" cy="${y}" r="9"></circle>`);
    }
  }

  // Animate the play's runner movements + after-state (returns the timeline).
  function animateResolution(gsap, ab, ctx) {
    const q = (s) => stage.querySelector(s);
    const t = gsap.timeline();
    const g = q('#cs-runners');

    for (const r of ab.runners) {
      let dot = r.base === 0 ? null : g.querySelector(`.runner[data-base="${r.base}"]`);
      if (!dot && !r.out && r.resultBase != null && r.resultBase !== r.base) {
        // batter becomes a runner
        const [x, y] = BASE_XY[0];
        g.insertAdjacentHTML('beforeend', `<circle class="runner" data-base="0" cx="${x}" cy="${y}" r="9"></circle>`);
        dot = g.lastElementChild;
      }
      if (!dot) continue;
      if (r.out) {
        t.to(dot, { attr: { r: 12 }, fill: '#ff4d5e', opacity: 0, duration: 0.45, ease: 'power2.in' }, 0);
        continue;
      }
      const from = r.base, to = r.resultBase;
      if (to == null || to === from) continue;
      // walk base to base so the dot travels the diamond, not through it
      let pos = 0.05;
      for (let b = from + 1; b <= Math.min(to, 4); b++) {
        const [x, y] = BASE_XY[b];
        t.to(dot, { attr: { cx: x, cy: y }, duration: 0.2, ease: 'power1.inOut' }, pos);
        pos += 0.2;
      }
      if (r.scored) {
        t.to(dot, { attr: { r: 14 }, opacity: 0, duration: 0.4, ease: 'power2.out' }, pos);
      }
    }
    // outs dots + score odometers land with the movement
    t.add(() => {
      const dots = q('#cs-outdots').children;
      for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i < Math.min(ab.after.outs, 2));
      q('#cs-r1').textContent = ab.after.score['1'] ?? 0;
      q('#cs-r2').textContent = ab.after.score['2'] ?? 0;
    }, 0.35);
    const scored = (Number(ab.after.score[String(ctx.side)]) || 0) - (Number(ab.before.score[String(ctx.side)]) || 0);
    if (scored > 0) {
      const el = ctx.side === 1 ? q('#cs-r1') : q('#cs-r2');
      t.fromTo(el, { scale: 1.5, transformOrigin: 'center' }, { scale: 1, duration: 0.5, ease: 'back.out(2)' }, 0.35);
    }
    return t;
  }

  // ── between-AB transition + end-of-game final card ───────────────────────

  // Morphs the live bar into a big centered "9TH INNING · 2 OUTS" card —
  // makes each new plate appearance easy to follow instead of numbers just
  // ticking over mid-frame.
  function showTransitionCard(gsap, ab) {
    const q = (s) => stage.querySelector(s);
    const bar = q('#cs-barcontent'), card = q('#cs-transcard');
    const half = ab.halfInning ? '▼ BOTTOM' : '▲ TOP';
    q('#cs-trans-inn').textContent = `${half} ${ORDINALS[ab.inning] || ab.inning}`;
    q('#cs-trans-outs').textContent = `${ab.before.outs} OUT${ab.before.outs === 1 ? '' : 'S'}`;
    const t = gsap.timeline();
    t.to(bar, { autoAlpha: 0, scale: 0.94, duration: BEAT.transIn, ease: 'power2.in' }, 0);
    t.fromTo(card, { autoAlpha: 0, scale: 0.82 }, { autoAlpha: 1, scale: 1, duration: BEAT.transIn, ease: 'back.out(1.7)' }, 0.04);
    return t;
  }

  function hideTransitionCard(gsap) {
    const q = (s) => stage.querySelector(s);
    const bar = q('#cs-barcontent'), card = q('#cs-transcard');
    const t = gsap.timeline();
    t.to(card, { autoAlpha: 0, scale: 0.86, duration: BEAT.transOut, ease: 'power2.in' }, 0);
    t.fromTo(bar, { autoAlpha: 0, scale: 0.94 }, { autoAlpha: 1, scale: 1, duration: BEAT.transOut, ease: 'power2.out' }, 0.04);
    return t;
  }

  // ── stamps & odometers ────────────────────────────────────────────────────

  function bumpStat(gsap, t, id, delta = 1, pos = 0) {
    const el = stage.querySelector(id);
    if (!el || !delta) return;
    t.add(() => { el.textContent = String((parseInt(el.textContent, 10) || 0) + delta); }, pos);
    t.fromTo(el, { scale: 1.45, transformOrigin: 'center', color: '#fff' },
      { scale: 1, clearProps: 'color', duration: 0.45, ease: 'back.out(2)' }, pos);
  }

  function setHab(gsap, t, hits, abs, pos = 0) {
    const el = stage.querySelector('#cs-hab');
    if (!el) return;
    t.add(() => { el.textContent = `${hits}-${abs}`; }, pos);
    t.fromTo(el, { scale: 1.12, transformOrigin: 'left center' },
      { scale: 1, duration: 0.4, ease: 'power2.out' }, pos);
  }

  function stampFor(ab, ctx) {
    const meta = RESULT_META[ab.resultCode] || { stamp: String(ab.result || '').toUpperCase() };
    // Same additive distinction as chipMarkup — the landing marker / camera
    // keep the OUT treatment (OUT_CODES still keys off resultCode, which
    // stays 4: a force out really was recorded on the play), only the stamp
    // text changes so the batter reaching base doesn't read as a strict out.
    const stampMain = ab.fieldersChoice ? "FIELDER'S CHOICE" : meta.stamp;
    const subs = [];
    const f = ab.fielder || {};
    if (meta.neg && f.action === 'Walljump') subs.push(['rob', 'WALL JUMP · ' + (f.character || '').toUpperCase()]);
    else if (meta.neg && f.action === 'Sliding') subs.push(['rob', 'SLIDING CATCH · ' + (f.character || '').toUpperCase()]);
    if (f.bobble && f.bobble !== 'None') subs.push(['', 'BOBBLE']);
    // contact quality reads on every ball in play, one vocabulary: Perfect
    // keeps its white marquee chip, Nice/Sour take the standard chip (the
    // recorded names carry a side word — "Nice - Left" / "Right Nice",
    // format varies by game — that says nothing on broadcast, so only the
    // quality keyword survives; see contactQuality)
    const quality = contactQuality(ab);
    if (quality) subs.push([quality[0] === 'perf' ? 'perf' : '', `${quality[1]} CONTACT`]);
    if (ab.contact && meta.hit) subs.push(['', `${Math.round(ab.contact.distance * 3.28084)}ft`]);
    if (ab.swing === 'Star') {
      subs.push(['rob', ab.contact && ab.contact.fiveStar ? '5★ STAR SWING' : 'STAR SWING']);
    } else {
      const tag = swingTag(ab);
      if (tag) subs.push(['', tag]);
    }
    if (ab.starChanceOutcome) {
      subs.push([ab.starChanceOutcome === 'won' ? 'clutch' : '', `STAR CHANCE ${ab.starChanceOutcome.toUpperCase()}`]);
    }
    // clutch heat: runs scored on the play / lead change
    const s = String(ctx.side), o = String(3 - ctx.side);
    const before = (ab.before.score[s] || 0) - (ab.before.score[o] || 0);
    const after = (ab.after.score[s] || 0) - (ab.after.score[o] || 0);
    const scored = (ab.after.score[s] || 0) - (ab.before.score[s] || 0);
    if (scored > 0) {
      const label = before <= 0 && after > 0 ? `GO-AHEAD · +${scored}` : `+${scored} RUN${scored > 1 ? 'S' : ''}`;
      subs.push(['clutch', label]);
    }
    return { main: stampMain, neg: !!meta.neg, hr: ab.resultCode === HR_CODE, subs };
  }

  function showStamp(gsap, stamp) {
    const el = stage.querySelector('#cs-stamp');
    el.className = `cs-stamp${stamp.neg ? ' neg' : ''}${stamp.hr ? ' hr' : ''}`;
    el.innerHTML = `<div class="main">${escapeHtml(stamp.main)}</div>
      ${stamp.subs.length ? `<div class="subs">${stamp.subs.map(([cls, txt]) =>
        `<span class="sub ${cls}">${escapeHtml(txt)}</span>`).join('')}</div>` : ''}`;
    const t = gsap.timeline();
    t.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.12 }, 0);
    t.fromTo(el.querySelector('.main'), { scale: 1.7 }, { scale: 1, duration: 0.38, ease: 'power3.out' }, 0);
    const subs = el.querySelectorAll('.sub');
    if (subs.length) t.fromTo(subs, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, stagger: 0.07 }, 0.22);
    return t;
  }

  function hideStamp(gsap) {
    const el = stage.querySelector('#cs-stamp');
    return gsap.to(el, { opacity: 0, duration: 0.25 });
  }

  // ── the show ──────────────────────────────────────────────────────────────

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  function killBeat() { if (beatTl) { try { beatTl.kill(); } catch { /* ignore */ } beatTl = null; } }

  function introTimeline(gsap, ctx) {
    const q = (s) => stage.querySelector(s);
    const qa = (s) => stage.querySelectorAll(s);
    const t = gsap.timeline({ defaults: { ease: 'power3.out' } });
    const fromSide = ctx.side === 1 ? 'inset(0% 0% 0% 100%)' : 'inset(0% 100% 0% 0%)';
    t.fromTo(q('.cs-backdrop'), { clipPath: fromSide }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.65, ease: 'power4.inOut' });
    t.fromTo(q('.cs-plate'), { x: -60, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.5 }, '-=0.3');
    t.fromTo(q('.cs-plate .rail'), { scaleY: 0 }, { scaleY: 1, duration: 0.4 }, '<+=0.1');
    qa('.cs-statzone .cs-box').forEach((box, i) => {
      t.fromTo(box, { y: 28, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.42 }, i === 0 ? '-=0.2' : '<+=0.09');
    });
    t.fromTo(q('.cs-hero'), { y: 40, autoAlpha: 0, scale: 1.04 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.7, ease: 'power2.out' }, '-=0.25');
    t.fromTo(q('.cs-theater'), { scaleX: 0.001, autoAlpha: 0, transformOrigin: ctx.side === 1 ? 'left center' : 'right center' },
      { scaleX: 1, autoAlpha: 1, duration: 0.6, ease: 'power4.out' }, '-=0.5');
    t.fromTo(q('.cs-situation'), { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45 }, '-=0.3');
    return t;
  }

  // Lock every panel to its final box-score numbers (finale + snap fallback).
  function lockFinals(gsap, ctx) {
    const b = ctx?.char?.batting || {};
    const habEl = stage.querySelector('#cs-hab');
    if (habEl) habEl.textContent = `${b.hits ?? 0}-${b.at_bats ?? 0}`;
    stage.querySelectorAll('[data-final]').forEach((el) => {
      const v = Number(el.getAttribute('data-final')) || 0;
      const fmt = el.getAttribute('data-fmt');
      const render = (x) => { el.textContent = fmt === 'f2' ? x.toFixed(2) : String(Math.round(x)); };
      if (!gsap) { render(v); return; }
      const cur = parseFloat(el.textContent) || 0;
      if (cur === v) return;
      const proxy = { v: cur };
      gsap.to(proxy, { v, duration: 0.7, ease: 'power1.out', onUpdate: () => render(proxy.v) });
    });
    const sh = stage.querySelector('#cs-sh'), ss = stage.querySelector('#cs-ss');
    if (sh) sh.textContent = String(b.star_hits ?? 0);
    if (ss) ss.textContent = String(b.star_swings ?? 0);
  }

  // OBP/SLG stay collapsed through the walkthrough (rates are a finished-
  // story stat); the finale animates them open and the neighboring stats
  // slide over to make room instead of popping.
  function revealRates(gsap) {
    const rates = stage.querySelectorAll('.cs-batcard .rate');
    if (!rates.length) return;
    if (!gsap) {
      rates.forEach((el) => { el.style.maxWidth = 'none'; el.style.opacity = '1'; el.style.padding = '0 8px'; });
      return;
    }
    // max-width 130 leaves room for a four-digit SLG (1.000) at full size;
    // the padding animates in with it so the spacing matches the other minis
    gsap.to(rates, { maxWidth: 130, opacity: 1, paddingLeft: 8, paddingRight: 8, duration: 0.65, ease: 'power2.inOut', stagger: 0.12 });
  }

  async function playAb(gsap, ab, i, ctx, my) {
    const alive = () => runSeq === my;
    const q = (s) => stage.querySelector(s);
    const meta = RESULT_META[ab.resultCode] || {};

    // the previous chip's live emphasis retires the moment the next
    // at-bat begins — only the current AB ever carries the live ring
    stage.querySelectorAll('.cs-abchip.live').forEach((el) => el.classList.remove('live'));
    // the inning transition card establishes the new at-bat FIRST — the bar
    // morphs into it and the situation updates underneath while hidden. The
    // theater empties now and the camera GLIDES back to the broadcast pose
    // (clearHit's animated return), so the reset reads as part of the replay
    // sequence rather than a technical snap.
    beatTl = showTransitionCard(gsap, ab);
    if (renderer) renderer.clearHit({ animate: true });
    // a lingering strikeout dim also lifts under the card when a flight is coming
    if (ab.contact) gsap.to(q('#cs-dim'), { opacity: 0, duration: 0.35 });
    await sleep((BEAT.transIn + BEAT.transHold) * 1000);
    if (!alive()) return;
    setSituation(ab, ctx);
    beatTl = hideTransitionCard(gsap);
    await sleep((BEAT.transOut + BEAT.situate) * 1000);
    if (!alive()) return;

    let flightMs = 0;
    if (ab.contact && Array.isArray(ab.contact.path) && ab.contact.path.length && renderer) {
      // the flight — exact recorded arc, plays once; home runs and deep
      // flies get the hero cam (contact hold + crane), everything else the
      // follow cam
      gsap.to(q('#cs-dim'), { opacity: 0, duration: 0.2 });
      renderer.setHit({ paths: [abPath(ab)], random_points: [], fielders: [] },
        { camera: cameraFor(ab), batterHand: ctx.char.battingHand });
      flightMs = (ab.contact.path.length / 60) * 1000 + 150;
      if (ab.starsUsed > 0) {
        // every star the PA consumed visibly spends from the meter
        const lit = stage.querySelectorAll('#cs-starrow .st.on');
        for (let s = 0; s < Math.min(ab.starsUsed, lit.length); s++) {
          const el = lit[lit.length - 1 - s];
          gsap.to(el, { scale: 2.2, opacity: 0, transformOrigin: 'center', duration: 0.6, delay: s * 0.12, ease: 'power2.out', onComplete: () => { el.classList.remove('on'); el.style.cssText = ''; } });
        }
      }
      if (/perfect/i.test(String(ab.contact.typeName || ''))) {
        gsap.fromTo(q('#cs-flash'), { opacity: 0.85, scale: 0.85 }, { opacity: 0, scale: 1.25, duration: 0.55, ease: 'power2.out' });
      }
      await sleep(flightMs);
      if (!alive()) return;
    } else {
      // no ball in flight (K / BB / HBP) — the theater was cleared under the
      // transition card; dim it for the stamp
      gsap.to(q('#cs-dim'), { opacity: 1, duration: 0.3 });
      await sleep(BEAT.noFlight * 1000);
      if (!alive()) return;
    }

    // the result is now known — the AB chip lands in the ticker with it
    // (synchronized with the ball landing / the play concluding)
    q('#cs-ticker').insertAdjacentHTML('beforeend', chipMarkup(ab, i));
    const chip = q(`#cs-ab-${i}`);
    if (chip) {
      if (meta.hit) chip.classList.add('hit');
      if (ab.resultCode === HR_CODE) chip.classList.add('hr');
      chip.classList.add('live');
      gsap.fromTo(chip, { opacity: 0, y: 18, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: 'power2.out' });
    }

    // result stamp + runner movement + stats build
    beatTl = gsap.timeline();
    beatTl.add(showStamp(gsap, stampFor(ab, ctx)), 0);
    beatTl.add(animateResolution(gsap, ab, ctx), 0.15);
    if (!NON_AB_CODES.has(ab.resultCode) && ab.resultCode !== 13) ctx.runAb += 1;
    if (meta.hit) ctx.runHits += 1;
    setHab(gsap, beatTl, ctx.runHits, ctx.runAb, 0.2);
    if (ab.rbi) bumpStat(gsap, beatTl, '#cs-rbi', ab.rbi, 0.25);
    // a home run is the one PA where the batter's own run scores in-frame;
    // runs scored as a baserunner true up with lockFinals at the finale
    if (ab.resultCode === HR_CODE) bumpStat(gsap, beatTl, '#cs-runs', 1, 0.3);
    // whole-PA star accounting: ★ Spent moves by the cost-weighted total the
    // server derived (foul star swings and captain-eligible 2★ costs
    // included) so the card always agrees with the chip
    if (ab.starsUsed > 0) bumpStat(gsap, beatTl, '#cs-ss', ab.starsUsed, 0.2);
    if (ab.swing === 'Star' && meta.hit) bumpStat(gsap, beatTl, '#cs-sh', 1, 0.25);
    // shorter balls in play settle with a longer landed pause — the gentle
    // camera + extra beat keeps rapid-fire ground-ball PAs followable. The
    // renderer knows when it used the gentle shot and recommends the dwell.
    const recMs = (flightMs > 0 && renderer && typeof renderer.recommendedHoldMs === 'function')
      ? renderer.recommendedHoldMs() : null;
    const hold = ab.resultCode === HR_CODE ? BEAT.hrStampHold
      : recMs != null ? recMs / 1000
      : BEAT.stampHold + (flightMs > 0 && !isDeepFly(ab) ? BEAT.shortHold : 0);
    await sleep(hold * 1000);
    if (!alive()) return;
    hideStamp(gsap);
  }

  async function finale(gsap, ctx, my) {
    const alive = () => runSeq === my;
    const q = (s) => stage.querySelector(s);
    await sleep(BEAT.finaleHold * 1000);
    if (!alive()) return;

    stage.querySelectorAll('.cs-abchip.live').forEach((el) => el.classList.remove('live'));
    gsap.to(q('#cs-dim'), { opacity: 0, duration: 0.3 });
    q('#cs-runners').innerHTML = '';

    // the bar retires into a FINAL-score presentation — winner emphasized,
    // per-side box-score lines — instead of lingering as a stale in-game
    // scoreboard
    fillFinalCard(ctx);

    const bar = q('#cs-barcontent'), finalCard = q('#cs-finalcard');
    const t0 = gsap.timeline();
    t0.to(bar, { autoAlpha: 0, scale: 0.94, duration: 0.35, ease: 'power2.in' }, 0);
    t0.fromTo(finalCard, { autoAlpha: 0, scale: 0.85 }, { autoAlpha: 1, scale: 1, duration: 0.55, ease: 'back.out(1.5)' }, 0.15);

    // the spray chart: every recorded flight fires at once and holds
    const paths = ctx.abs.filter((a) => a.contact && a.contact.path?.length).map(abPath);
    if (paths.length && renderer) {
      renderer.setHit({ paths, random_points: [], fielders: [] }, { spray: true, batterHand: ctx.char.battingHand });
      gsap.fromTo(q('#cs-finalebanner'), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, delay: 0.4 });
    }
    lockFinals(gsap, ctx); // batting counters true up; H-AB locks to the box score
    revealRates(gsap); // OBP/SLG open up; neighbors animate over to make room
    gsap.fromTo(q('#cs-box-bat .hab .v'), { scale: 1.15, transformOrigin: 'left center' }, { scale: 1, duration: 0.6, ease: 'back.out(1.6)' });
  }

  async function startShow(ctx) {
    const my = ++runSeq;
    killBeat();
    const gsap = await ensureGsap();
    if (runSeq !== my) return;

    if (!gsap) {
      // no-GSAP fallback: everything snaps to its final state, spray +
      // FINAL card included
      lockFinals(null, ctx);
      revealRates(null);
      chipSnapAll(ctx);
      const q = (s) => stage.querySelector(s);
      fillFinalCard(ctx);
      q('#cs-barcontent').style.opacity = '0';
      q('#cs-finalcard').style.opacity = '1';
      if (renderer) {
        await loadStadium(ctx.stadium);
        const paths = ctx.abs.filter((a) => a.contact && a.contact.path?.length).map(abPath);
        if (paths.length && runSeq === my) renderer.setHit({ paths, random_points: [], fielders: [] }, { spray: true, batterHand: ctx.char.battingHand });
      }
      return;
    }

    ctx.runHits = 0;
    ctx.runAb = 0;
    const stadiumReady = loadStadium(ctx.stadium); // fetch while the intro plays
    beatTl = introTimeline(gsap, ctx);
    await sleep(beatTl.duration() * 1000 - 300);
    if (runSeq !== my) return;
    await stadiumReady;
    if (runSeq !== my) return;

    for (let i = 0; i < ctx.abs.length; i++) {
      // chips insert themselves (result-styled) inside playAb, the moment
      // each result lands; the newest stays "live" until the next one does
      await playAb(gsap, ctx.abs[i], i, ctx, my);
      if (runSeq !== my) return;
    }
    await finale(gsap, ctx, my);
  }

  function chipSnapAll(ctx) {
    const ticker = stage.querySelector('#cs-ticker');
    if (!ticker) return;
    ticker.innerHTML = ctx.abs.map((ab, i) => chipMarkup(ab, i)).join('');
    ctx.abs.forEach((ab, i) => {
      const chip = stage.querySelector(`#cs-ab-${i}`);
      const meta = RESULT_META[ab.resultCode] || {};
      if (!chip) return;
      if (meta.hit) chip.classList.add('hit');
      if (ab.resultCode === HR_CODE) chip.classList.add('hr');
    });
  }

  function stopShow() { runSeq++; killBeat(); }

  function dispose() {
    stopShow();
    if (renderer) { try { renderer.dispose(); } catch { /* ignore */ } renderer = null; }
  }

  return { ensureRenderer, startShow, stopShow, dispose };
}
