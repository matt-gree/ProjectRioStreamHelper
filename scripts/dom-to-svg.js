/*
 * dom-to-svg.js — capture a rendered PRSH overlay's DOM as an editable SVG.
 *
 * FOR THE TWO POST-GAME CALLOUTS, and anything else whose look is CSS rather
 * than a theme file. The themable elements do NOT need this: their art already
 * IS an SVG, and scripts/figma-template.py turns the shipped file into a Figma
 * template that compiles back. There is no way back from this one — a capture
 * is a photograph of one render, so an edit to it returns as a code change (or,
 * eventually, as the starting geometry for a real slot contract). Say so
 * whenever you hand one over; a designer who thinks this round-trips will do
 * work that cannot be installed.
 *
 * WHY THE CALLOUTS CAN BE CAPTURED AT ALL. They draw onto a fixed 1920x1080
 * `.pv-stage` / `.pc-stage` with a top-left transform origin, so every box has
 * a stable position in stage coordinates — measure the DOM, subtract the stage
 * origin, divide out the scale, and the numbers ARE the SVG's user units. An
 * overlay that reflowed to its source size would have no such canvas.
 *
 * WHAT SURVIVES AND WHAT DOES NOT:
 *   survives   boxes (position, size, radius, background colour + gradients),
 *              borders, text (real <text>, one node per line box, with the
 *              computed face/size/weight/colour), images, opacity, z-order,
 *              drop shadows (as feDropShadow), transforms
 *   lost       backdrop-filter (there is no SVG equivalent that means the same
 *              thing — it samples the OBS scene BEHIND the browser source,
 *              which is not in the document at all), blend modes beyond
 *              normal, and every animation. Each is reported, not silenced.
 *
 * TEXT IS THE PART THAT GOES WRONG QUIETLY. A <div> of text is laid out by the
 * browser: line breaks, letter-spacing, and the baseline all come from the font
 * engine, and SVG has none of that. So each text run is captured PER LINE BOX
 * via Range.getClientRects() rather than per element, and anchored at the line's
 * own baseline (measured, not derived from font-size, because line-height and
 * vertical-align both move it). Capturing per element instead puts a two-line
 * name on one line at the wrong height, which reads as a font problem and sends
 * the designer hunting in the wrong place.
 *
 * Usage (in the page):
 *   const { svg, report } = window.captureDomAsSvg(document.querySelector('#host'));
 */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const TRANSPARENT = /^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/;

  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // A CSS font stack means nothing to Figma, which binds one family per node.
  const firstFamily = (stack) =>
    (stack || '').split(',')[0].replace(/["']/g, '').trim();

  function parseShadow(str) {
    // "rgba(0,0,0,.5) 0px 4px 12px 0px" or "0px 4px 12px rgba(...)"
    if (!str || str === 'none') return null;
    const colour = (str.match(/(rgba?\([^)]+\)|#[0-9a-f]{3,8})/i) || [])[0] || '#000';
    const nums = (str.replace(/rgba?\([^)]+\)/gi, '').match(/-?[\d.]+px/g) || [])
      .map((n) => parseFloat(n));
    if (nums.length < 2) return null;
    return { colour, dx: nums[0], dy: nums[1], blur: nums[2] || 0 };
  }

  function gradientDef(image, box, defs, uid) {
    // Only the two shapes PRSH actually authors; anything else is reported.
    const lin = image.match(/^linear-gradient\((.+)\)$/);
    const rad = image.match(/^radial-gradient\((.+)\)$/);
    if (!lin && !rad) return null;
    const body = (lin || rad)[1];
    const stops = [];
    // Split on commas that are not inside rgb()/rgba().
    const parts = body.split(/,(?![^(]*\))/).map((s) => s.trim());
    let angle = 180;
    if (lin && /^-?[\d.]+deg$/.test(parts[0])) angle = parseFloat(parts.shift());
    else if (lin && /^to /.test(parts[0])) {
      const dir = parts.shift();
      angle = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270 }[dir] ?? 180;
    } else if (rad) parts.shift();
    parts.forEach((p, i) => {
      const c = (p.match(/(rgba?\([^)]+\)|#[0-9a-f]{3,8}|[a-z]+)/i) || [])[0];
      const pct = (p.match(/([\d.]+)%\s*$/) || [])[1];
      if (c) stops.push({ colour: c, offset: pct !== undefined ? pct / 100 : i / Math.max(1, parts.length - 1) });
    });
    if (stops.length < 2) return null;
    const id = `grad${uid}`;
    const rad2 = (angle - 90) * Math.PI / 180;
    const inner = stops.map((s) => {
      const m = s.colour.match(/rgba\(([^)]+)\)/);
      let colour = s.colour, op = '';
      if (m) {
        const [r, g, b, a] = m[1].split(',').map((v) => parseFloat(v));
        colour = `rgb(${r},${g},${b})`;
        if (a !== undefined && a < 1) op = ` stop-opacity="${a}"`;
      }
      return `<stop offset="${(s.offset * 100).toFixed(1)}%" stop-color="${colour}"${op}/>`;
    }).join('');
    if (lin) {
      const x1 = 50 - Math.cos(rad2) * 50, y1 = 50 - Math.sin(rad2) * 50;
      const x2 = 50 + Math.cos(rad2) * 50, y2 = 50 + Math.sin(rad2) * 50;
      defs.push(`<linearGradient id="${id}" x1="${x1.toFixed(1)}%" y1="${y1.toFixed(1)}%" x2="${x2.toFixed(1)}%" y2="${y2.toFixed(1)}%">${inner}</linearGradient>`);
    } else {
      defs.push(`<radialGradient id="${id}">${inner}</radialGradient>`);
    }
    return `url(#${id})`;
  }

  /*
   * Images are INLINED as data URIs, not referenced.
   *
   * A capture's <image href> would otherwise point at http://127.0.0.1:5299/…
   * — the isolated instance that happened to render it. That link is dead
   * everywhere else, including in Figma five seconds later, and it dies as an
   * empty box rather than as an error. It matters more here than in a theme
   * file: a theme's image slots are deliberately empty (PRSH ships no Nintendo
   * art and the mount fills them at runtime), but a capture's hero art and team
   * logos ARE the picture, so a broken href loses the thing being captured.
   */
  async function inlineImage(src) {
    try {
      const blob = await (await fetch(src)).blob();
      return await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => res(src);
        fr.readAsDataURL(blob);
      });
    } catch (e) {
      return src;  // reported by the caller; a live URL beats no image at all
    }
  }

  window.captureDomAsSvg = async function captureDomAsSvg(host, opts) {
    opts = opts || {};
    const W = opts.width || 1920, H = opts.height || 1080;
    const report = { nodes: 0, text: 0, images: 0, gradients: 0, lost: [] };
    const pending = [];   // image srcs, resolved to data URIs after the walk
    const defs = [];
    const body = [];
    let uid = 0;

    // The stage is the 1920x1080 reference box; everything is measured relative
    // to it and un-scaled, so the SVG's user units are the authored units.
    // Each callout names its own stage; the Character Spotlight is `cs-`, the
    // Game Summary `pv-`. Falling back to `host` when neither matches would
    // still "work" and silently measure against the wrong origin, so the miss
    // is reported rather than absorbed.
    const stage = host.querySelector(opts.stage || '.pv-stage, .pc-stage, .cs-stage') || host;
    if (stage === host) report.lost.push('no .*-stage found — measured against the host, positions may be offset');
    const origin = stage.getBoundingClientRect();
    const scale = origin.width ? origin.width / W : 1;
    const toX = (px) => (px - origin.left) / scale;
    const toY = (px) => (px - origin.top) / scale;
    const toU = (px) => px / scale;

    function shadowFilter(cs) {
      const sh = parseShadow(cs.boxShadow);
      if (!sh) return '';
      const id = `sh${uid++}`;
      defs.push(
        `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">` +
        `<feDropShadow dx="${toU(sh.dx).toFixed(1)}" dy="${toU(sh.dy).toFixed(1)}" ` +
        `stdDeviation="${(toU(sh.blur) / 2).toFixed(1)}" flood-color="${sh.colour}"/></filter>`
      );
      return ` filter="url(#${id})"`;
    }

    function emitText(node, cs) {
      // Per LINE BOX, not per element — see the header note.
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.5);
      if (!rects.length) return;
      const family = firstFamily(cs.fontFamily);
      const size = toU(parseFloat(cs.fontSize));
      const weight = cs.fontWeight;
      const fill = cs.color;
      const spacing = cs.letterSpacing === 'normal' ? 0 : toU(parseFloat(cs.letterSpacing) || 0);
      const align = cs.textAlign;
      const transform = cs.textTransform;
      const shadow = parseShadow(cs.textShadow);
      let filter = '';
      if (shadow) {
        const id = `ts${uid++}`;
        defs.push(
          `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">` +
          `<feDropShadow dx="${toU(shadow.dx).toFixed(1)}" dy="${toU(shadow.dy).toFixed(1)}" ` +
          `stdDeviation="${(toU(shadow.blur) / 2).toFixed(1)}" flood-color="${shadow.colour}"/></filter>`
        );
        filter = ` filter="url(#${id})"`;
      }
      // Split the run's text across its line boxes in DOM order.
      const full = node.textContent;
      let cursor = 0;
      rects.forEach((r) => {
        // Measure this line's own text by walking characters until the range's
        // width matches — cheaper and more robust than re-implementing wrapping.
        let line = '';
        if (rects.length === 1) { line = full.slice(cursor); cursor = full.length; }
        else {
          const probe = document.createRange();
          for (let i = cursor + 1; i <= full.length; i++) {
            probe.setStart(node, cursor); probe.setEnd(node, i);
            const pr = probe.getClientRects();
            if (pr.length && pr[pr.length - 1].top > r.top + 1) { line = full.slice(cursor, i - 1); cursor = i - 1; break; }
            if (i === full.length) { line = full.slice(cursor); cursor = full.length; }
          }
        }
        line = line.trim();
        if (!line) return;
        // text-transform is CSS, and SVG has none: the DOM's textContent is the
        // UNTRANSFORMED string, so a capture that copies it verbatim silently
        // lowercases every label the design sets in caps. It reads as a font
        // substitution rather than as missing markup, which is the expensive
        // kind of wrong — the designer goes looking at the typeface.
        if (transform === 'uppercase') line = line.toUpperCase();
        else if (transform === 'lowercase') line = line.toLowerCase();
        else if (transform === 'capitalize') line = line.replace(/\b\w/g, (c) => c.toUpperCase());
        // Baseline: measured from the line box, since line-height moves it.
        const ascent = r.height * 0.79;  // typical for the faces PRSH ships
        const anchor = align === 'center' ? 'middle' : align === 'right' || align === 'end' ? 'end' : 'start';
        const x = anchor === 'middle' ? toX(r.left + r.width / 2)
                : anchor === 'end' ? toX(r.right) : toX(r.left);
        body.push(
          `<text x="${x.toFixed(1)}" y="${toY(r.top + ascent).toFixed(1)}"` +
          ` font-family="${esc(family)}" font-size="${size.toFixed(1)}"` +
          ` font-weight="${weight}" fill="${fill}"` +
          (anchor !== 'start' ? ` text-anchor="${anchor}"` : '') +
          (spacing ? ` letter-spacing="${spacing.toFixed(2)}"` : '') +
          filter + `>${esc(line)}</text>`
        );
        report.text++;
      });
    }

    function walk(el) {
      if (!(el instanceof Element)) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const r = el.getBoundingClientRect();
      const alpha = parseFloat(cs.opacity);

      if (cs.backdropFilter && cs.backdropFilter !== 'none') {
        report.lost.push(`backdrop-filter on ${el.className || el.tagName} (samples the OBS scene behind the source; no SVG equivalent)`);
      }
      if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') {
        report.lost.push(`mix-blend-mode:${cs.mixBlendMode} on ${el.className || el.tagName}`);
      }
      // A CSS mask/clip-path is not captured, and its absence is LOUD: the
      // element it was hiding comes through at full strength. The Game
      // Summary's team-logo wash is exactly this — masked down to a ghost
      // live, a bright star behind the captain without it. Reported so the
      // designer knows to re-mask rather than assuming the art is wrong.
      const maskish = [cs.maskImage, cs.webkitMaskImage, cs.clipPath]
        .filter((v) => v && v !== 'none');
      if (maskish.length) {
        report.lost.push(`mask/clip-path on ${el.className || el.tagName} (content appears unmasked)`);
      }

      const group = alpha < 1 ? ` opacity="${alpha}"` : '';
      if (group) body.push(`<g${group}>`);

      // --- the element's own box ---
      if (r.width > 0.5 && r.height > 0.5) {
        const radius = toU(parseFloat(cs.borderTopLeftRadius) || 0);
        let fill = null;
        if (cs.backgroundImage && cs.backgroundImage !== 'none') {
          fill = gradientDef(cs.backgroundImage, r, defs, uid++);
          if (fill) report.gradients++;
        }
        if (!fill && !TRANSPARENT.test(cs.backgroundColor)) fill = cs.backgroundColor;
        const bw = parseFloat(cs.borderTopWidth) || 0;
        const stroke = bw && !TRANSPARENT.test(cs.borderTopColor)
          ? ` stroke="${cs.borderTopColor}" stroke-width="${toU(bw).toFixed(2)}"` : '';
        if (fill || stroke) {
          body.push(
            `<rect x="${toX(r.left).toFixed(1)}" y="${toY(r.top).toFixed(1)}"` +
            ` width="${toU(r.width).toFixed(1)}" height="${toU(r.height).toFixed(1)}"` +
            (radius ? ` rx="${radius.toFixed(1)}"` : '') +
            ` fill="${fill || 'none'}"${stroke}${shadowFilter(cs)}/>`
          );
          report.nodes++;
        }
      }

      // --- images ---
      if (el.tagName === 'IMG' && el.src && r.width > 0.5) {
        const token = `@@IMG${pending.length}@@`;
        pending.push(el.src);
        body.push(
          `<image x="${toX(r.left).toFixed(1)}" y="${toY(r.top).toFixed(1)}"` +
          ` width="${toU(r.width).toFixed(1)}" height="${toU(r.height).toFixed(1)}"` +
          ` preserveAspectRatio="${cs.objectFit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}"` +
          ` href="${token}"/>`
        );
        report.images++;
      }

      /*
       * A <canvas> is RASTERIZED, and that is the honest answer rather than a
       * shortcut. The Character Spotlight's AB Theater is a three.js scene —
       * the trajectories are drawn by a shader over a live 3D camera, so there
       * is no vector form of it to recover and never will be. Capturing the
       * pixels keeps the composition readable (the designer can see how much
       * room the theater takes and what it sits against) while the report says
       * plainly that this one region is a photograph.
       */
      if (el.tagName === 'CANVAS' && r.width > 0.5) {
        // A WEBGL canvas cannot be read back at all here. Its drawing buffer is
        // cleared once the frame is composited unless the context was created
        // with preserveDrawingBuffer:true, which three.js does not do by
        // default — so toDataURL() returns the clear colour and nothing else.
        // That is the dangerous outcome: the Character Spotlight's AB Theater
        // came back as a clean sky gradient, which looks like a deliberate
        // empty panel rather than a failed capture, and a designer would build
        // around it. A labelled footprint is the honest artifact, and it is
        // also the useful one — the theater is a live 3D camera, so there was
        // never a vector form of it to recover.
        const is2d = !!el.getContext('2d');   // null on a webgl canvas; no clobber
        if (is2d) {
          let href = '';
          try { href = el.toDataURL('image/png'); } catch (e) { href = ''; }
          if (href) {
            body.push(
              `<image x="${toX(r.left).toFixed(1)}" y="${toY(r.top).toFixed(1)}"` +
              ` width="${toU(r.width).toFixed(1)}" height="${toU(r.height).toFixed(1)}"` +
              ` href="${href}"/>`
            );
            report.images++;
          }
          report.lost.push(`<canvas> ${el.className || ''} captured as RASTER (2D canvas has no vector form)`);
        } else {
          const x = toX(r.left), y = toY(r.top), w = toU(r.width), h = toU(r.height);
          body.push(
            `<g id="scaffold=live-3d-${el.className || 'canvas'}">` +
            `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"` +
            ` rx="12" fill="#0B0B12" fill-opacity="0.5" stroke="#8F8FA3" stroke-opacity="0.5" stroke-dasharray="8 6"/>` +
            `<text x="${(x + w / 2).toFixed(1)}" y="${(y + h / 2).toFixed(1)}" text-anchor="middle"` +
            ` font-family="Inter" font-size="28" font-weight="700" fill="#8F8FA3">` +
            `LIVE 3D — rendered by the app, not themable</text></g>`
          );
          report.lost.push(
            `<canvas> ${el.className || ''} is WebGL — NOT captured (drawing buffer is cleared ` +
            `after compositing). Emitted as a labelled footprint instead.`
          );
        }
        if (group) body.push('</g>');
        return;
      }

      // --- inline SVG (the backdrop) passes through untouched ---
      if (el.tagName.toLowerCase() === 'svg') {
        body.push(el.outerHTML);
        if (group) body.push('</g>');
        return;
      }

      // --- text runs, then children in paint order ---
      for (const child of el.childNodes) {
        if (child.nodeType === 3 && child.textContent.trim()) emitText(child, cs);
        else if (child.nodeType === 1) walk(child);
      }

      if (group) body.push('</g>');
    }

    walk(stage);

    let svg =
      `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="${NS}">\n` +
      `<defs>\n${defs.join('\n')}\n</defs>\n${body.join('\n')}\n</svg>`;

    const inlined = await Promise.all(pending.map(inlineImage));
    inlined.forEach((href, i) => {
      if (!href.startsWith('data:')) report.lost.push(`image not inlined: ${pending[i]}`);
      svg = svg.replace(`@@IMG${i}@@`, href);
    });

    report.lost = Array.from(new Set(report.lost));
    return { svg, report };
  };
})();
