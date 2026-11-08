// コーディネートのイラスト(SVG)を組み立てる
(function (root) {
  const CX = 160;
  const Y = { neck: 104, sh: 118, chest: 165, waist: 222, hip: 268, crotch: 302, knee: 428, ankle: 572, foot: 598 };
  const BODY = {
    him: { S: 52, chest: 42, waist: 36, hip: 38, thigh: 20, knee: 14.5, ankle: 9.5, legX: 19, armA: 13, armB: 10.5, armC: 8, neck: 11.5 },
    her: { S: 41, chest: 33, waist: 26, hip: 40, thigh: 20, knee: 12.5, ankle: 7.5, legX: 19, armA: 10, armB: 8, armC: 6, neck: 8.5 },
  };
  const SKIN = '#ecd3bf', SKIN_LINE = '#cdac94', HAIR = '#2f2925';
  const PLACEHOLDER = '#e4e0d8';
  let uid = 0;

  const safe = (hex) => (/^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#999999');
  const n = (v) => Math.round(v * 10) / 10;
  const P = (x, y) => [n(x), n(y)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function mix(hex, target, amt) {
    const c = (h, i) => parseInt(h.slice(i, i + 2), 16);
    const out = [1, 3, 5].map((i) => Math.round(c(hex, i) + (c(target, i) - c(hex, i)) * amt));
    return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  function lum(hex) {
    const c = (i) => parseInt(hex.slice(i, i + 2), 16) / 255;
    return 0.299 * c(1) + 0.587 * c(3) + 0.114 * c(5);
  }

  // 点列をなめらかにつなぐ(Catmull-Rom)
  function curve(pts, move) {
    let d = (move ? 'M' : 'L') + pts[0].join(' ');
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${p2.join(' ')}`;
    }
    return d;
  }
  const mirror = (pts) => pts.map(([x, y]) => [n(2 * CX - x), y]);

  // 色と柄
  class Paint {
    constructor() { this.defs = []; this.id = `f${++uid}`; this.seq = 0; this.cache = {}; }
    of(item) {
      const base = item.placeholder ? PLACEHOLDER : safe(item.color);
      const pattern = item.pattern || 'plain';
      const texture = !item.placeholder && /^blob:[\w:/.%-]+$/.test(item.textureUrl || '') ? item.textureUrl : null;
      const line = item.placeholder ? '#b5b0a5' : mix(base, '#1a1714', lum(base) > 0.75 ? 0.32 : 0.42);
      const key = base + pattern + (texture || '');
      if (this.cache[key]) return { fill: this.cache[key], line, base, dashed: !!item.placeholder };
      let fill = base;
      if (texture) {
        // 実物の生地の写真で塗る
        const pid = `${this.id}p${++this.seq}`;
        this.defs.push(`<pattern id="${pid}" width="72" height="72" patternUnits="userSpaceOnUse"><rect width="72" height="72" fill="${base}"/><image href="${esc(texture)}" width="72" height="72" preserveAspectRatio="none"/></pattern>`);
        fill = `url(#${pid})`;
      } else if (!item.placeholder && pattern !== 'plain') {
        const pid = `${this.id}p${++this.seq}`;
        const tone = lum(base) > 0.55 ? mix(base, '#23201c', 0.42) : mix(base, '#ffffff', 0.55);
        const bg = `<rect width="100%" height="100%" fill="${base}"/>`;
        const shapes = {
          stripe: [11, 11, `<rect width="3" height="11" fill="${tone}"/>`],
          border: [12, 12, `<rect width="12" height="4" fill="${tone}"/>`],
          check: [18, 18, `<rect width="7" height="18" fill="${tone}" opacity=".45"/><rect width="18" height="7" fill="${tone}" opacity=".45"/>`],
          dot: [12, 12, `<circle cx="3" cy="3" r="1.7" fill="${tone}"/><circle cx="9" cy="9" r="1.7" fill="${tone}"/>`],
          floral: [24, 24, `<g fill="${tone}"><circle cx="6" cy="3.6" r="1.8"/><circle cx="8.4" cy="6" r="1.8"/><circle cx="6" cy="8.4" r="1.8"/><circle cx="3.6" cy="6" r="1.8"/><circle cx="18" cy="15.6" r="1.8"/><circle cx="20.4" cy="18" r="1.8"/><circle cx="18" cy="20.4" r="1.8"/><circle cx="15.6" cy="18" r="1.8"/></g>`],
          denim: [5, 5, `<path d="M0 5L5 0" stroke="${mix(base, '#ffffff', 0.22)}" stroke-width="1"/>`],
        };
        const sh = shapes[pattern];
        if (sh) {
          this.defs.push(`<pattern id="${pid}" width="${sh[0]}" height="${sh[1]}" patternUnits="userSpaceOnUse">${bg}${sh[2]}</pattern>`);
          fill = `url(#${pid})`;
        }
      }
      this.cache[key] = fill;
      return { fill, line, base, dashed: !!item.placeholder };
    }
  }

  function shape(d, p, extra = '') {
    const dash = p.dashed ? ' stroke-dasharray="4 3"' : '';
    return `<path d="${d}" fill="${p.fill}" stroke="${p.line}" stroke-width="1.3" stroke-linejoin="round"${dash} ${extra}/>`;
  }
  const line = (d, color, w = 1, op = 1) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"/>`;
  const fold = (d) => line(d, '#000', 1.1, 0.13);
  const glow = (d) => line(d, '#fff', 1.2, 0.2);

  // ---- からだ ----
  function armPoints(g, s, t, pad) {
    const A = [CX + s * (g.S - 5), 126], B = [CX + s * (g.S + 10), 226], C = [CX + s * (g.S + 15), 312];
    const lerp = (a, b, k) => a + (b - a) * k;
    const at = (v) => (v <= 0.55
      ? { x: lerp(A[0], B[0], v / 0.55), y: lerp(A[1], B[1], v / 0.55), w: lerp(g.armA, g.armB, v / 0.55) + pad }
      : { x: lerp(B[0], C[0], (v - 0.55) / 0.45), y: lerp(B[1], C[1], (v - 0.55) / 0.45), w: lerp(g.armB, g.armC, (v - 0.55) / 0.45) + pad });
    const e = at(t);
    const outer = [P(CX + s * (g.S - 8), 114 - pad * 0.3), P(A[0] + s * (g.armA + pad), A[1])];
    const inner = [P(e.x - s * e.w, e.y)];
    if (t > 0.6) { outer.push(P(B[0] + s * (g.armB + pad), B[1])); inner.push(P(B[0] - s * (g.armB + pad), B[1])); }
    outer.push(P(e.x + s * e.w, e.y));
    inner.push(P(A[0] - s * (g.armA + pad) * 0.5, 168));
    return { d: curve(outer, true) + curve(inner, false) + 'Z', end: e };
  }

  function legs(g) {
    return pantsPath(g, { hem: Y.ankle, hemW: g.ankle, kneeW: g.knee, thighW: g.thigh, shift: 0 });
  }

  function pantsPath(g, { hem, hemW, kneeW, thighW, shift = 0 }) {
    const xc = CX - g.legX - shift;
    const outer = [P(CX - g.waist - 0.5, Y.waist), P(CX - g.hip - 1.5, Y.hip), P(xc - thighW, 335)];
    if (hem > Y.knee) outer.push(P(xc - kneeW, Y.knee));
    outer.push(P(xc - hemW, hem));
    const innerX = (x) => Math.min(x, CX - 1);
    const inner = [P(innerX(xc + hemW), hem)];
    if (hem > Y.knee) inner.push(P(innerX(xc + kneeW), Y.knee));
    inner.push(P(CX - 0.5, Y.crotch));
    const left = curve(outer, true) + curve(inner, false);
    const right = curve(mirror(inner).reverse(), false) + curve(mirror(outer).reverse(), false);
    return left + right + 'Z';
  }

  function body(g) {
    let s = '';
    s += `<path d="${legs(g)}" fill="${SKIN}" stroke="${SKIN_LINE}" stroke-width="1"/>`;
    return s;
  }

  function arms(g) {
    let s = '';
    for (const side of [-1, 1]) {
      const { d, end } = armPoints(g, side, 1, 0);
      s += `<path d="${d}" fill="${SKIN}" stroke="${SKIN_LINE}" stroke-width="1"/>`;
      s += `<ellipse cx="${n(end.x + side * 0.5)}" cy="${n(end.y + 10)}" rx="${n(g.armC + 0.5)}" ry="12" fill="${SKIN}" stroke="${SKIN_LINE}" stroke-width="1"/>`;
    }
    return s;
  }

  function neckSkin(g) {
    const w = g.neck;
    return `<path d="M${CX - w} 78L${CX - w} 100Q${CX - w - 1} 108 ${CX - w - 12} 112L${CX + w + 12} 112Q${CX + w + 1} 108 ${CX + w} 100L${CX + w} 78Z" fill="${SKIN}" stroke="${SKIN_LINE}" stroke-width="1"/>`;
  }

  function hairBack(gender) {
    if (gender === 'her') return `<path d="M${CX - 29} 54C${CX - 33} 92 ${CX - 36} 122 ${CX - 30} 148Q${CX} 160 ${CX + 30} 148C${CX + 36} 122 ${CX + 33} 92 ${CX + 29} 54C${CX + 24} 22 ${CX - 24} 22 ${CX - 29} 54Z" fill="${HAIR}"/>`;
    return '';
  }

  function head(gender) {
    let s = `<ellipse cx="${CX}" cy="60" rx="${gender === 'him' ? 24.5 : 23}" ry="${gender === 'him' ? 30 : 29}" fill="${SKIN}" stroke="${SKIN_LINE}" stroke-width="1"/>`;
    if (gender === 'her') {
      s += `<path d="M${CX - 25} 60C${CX - 30} 30 ${CX - 10} 23 ${CX + 2} 26C${CX + 20} 26 ${CX + 30} 38 ${CX + 25} 62C${CX + 21} 50 ${CX + 12} 42 ${CX + 2} 40C${CX - 6} 48 ${CX - 18} 50 ${CX - 25} 60Z" fill="${HAIR}"/>`;
    } else {
      s += `<path d="M${CX - 25} 55C${CX - 29} 28 ${CX - 12} 22 ${CX + 2} 24C${CX + 22} 24 ${CX + 29} 36 ${CX + 25} 55C${CX + 22} 46 ${CX + 18} 41 ${CX + 11} 40C${CX + 2} 44 ${CX - 12} 43 ${CX - 18} 41C${CX - 22} 44 ${CX - 24} 48 ${CX - 25} 55Z" fill="${HAIR}"/>`;
    }
    return s;
  }

  // ---- トップス ----
  function torsoPath(g, { hem, hemHalf, loose = 0, neckW = 14, neckD = 9, pad = 0, vneck = false, shoulderNarrow = 0 }) {
    const w = g.S + pad - shoulderNarrow;
    const side = [P(CX - w, Y.sh), P(CX - g.chest - loose, Y.chest), P(CX - g.waist - loose * 1.3, Y.waist)];
    if (hem > Y.waist + 28) side.push(P(CX - Math.max(g.waist + loose, hemHalf - 2), Math.min(Y.hip, hem - 10)));
    side.push(P(CX - hemHalf, hem));
    const start = `M${CX - neckW} ${Y.neck}Q${n(CX - w * 0.62)} ${Y.neck + 4} ${n(CX - w)} ${Y.sh}`;
    const close = `Q${n(CX + w * 0.62)} ${Y.neck + 4} ${CX + neckW} ${Y.neck}` +
      (vneck ? `L${CX} ${Y.neck + neckD * 3}Z` : `Q${CX} ${Y.neck + neckD * 2} ${CX - neckW} ${Y.neck}Z`);
    return start + curve(side, false).replace(/^L[^C]*/, '') + curve(mirror(side).reverse(), false) + close;
  }

  const TOPS = {
    tshirt: { sleeve: 0.3, hem: 276, loose: 3, hemExtra: 4 },
    polo: { sleeve: 0.3, hem: 276, loose: 3, hemExtra: 4, collar: 'polo' },
    tank: { sleeve: 0, hem: 270, loose: 0, hemExtra: 2, neckW: 12, neckD: 12, narrow: 7 },
    longtee: { sleeve: 1, hem: 276, loose: 2, hemExtra: 3 },
    shirt: { sleeve: 1, hem: 284, loose: 3, hemExtra: 4, collar: 'shirt', vneck: true, neckD: 5, cuff: 'shirt' },
    blouse: { sleeve: 1, hem: 268, loose: 4, hemExtra: 5, sleevePad: 2, vneck: true, neckD: 6, soft: true },
    sweat: { sleeve: 1, hem: 280, loose: 6, hemExtra: 4, rib: true, sleevePad: 2.5, neckW: 13, neckD: 7 },
    hoodie: { sleeve: 1, hem: 284, loose: 7, hemExtra: 4, rib: true, sleevePad: 3, hood: true },
    knit: { sleeve: 1, hem: 280, loose: 5, hemExtra: 4, rib: true, sleevePad: 2, knit: true, neckW: 13, neckD: 6 },
    turtleneck: { sleeve: 1, hem: 276, loose: 2, hemExtra: 3, rib: true, sleevePad: 1, turtle: true, neckW: 10, neckD: 2 },
  };

  function drawSleeves(g, p, t, pad, opts = {}) {
    if (t <= 0) return '';
    let s = '';
    for (const side of [-1, 1]) {
      const { d, end } = armPoints(g, side, t, pad);
      s += shape(d, p);
      if (t >= 0.9) {
        const y = end.y;
        if (opts.rib) s += line(`M${n(end.x - end.w)} ${y - 9}L${n(end.x + end.w)} ${y - 9}`, p.line, 1, 0.8);
        if (opts.cuff) s += line(`M${n(end.x - end.w)} ${y - 13}L${n(end.x + end.w)} ${y - 13}`, p.line, 1, 0.8);
      }
      s += fold(`M${n(end.x - side * 3)} ${n(Math.min(end.y - 12, 232))}Q${n(end.x + side * 2)} ${n(Math.min(end.y - 24, 222))} ${n(end.x - side)} ${n(Math.min(end.y - 34, 212))}`);
    }
    return s;
  }

  function drawTop(g, item, paint) {
    const c = TOPS[item.type] || TOPS.longtee;
    const p = paint.of(item);
    const hemHalf = Math.max(g.hip, g.waist) + (c.hemExtra || 0);
    let s = '';
    if (c.hood) {
      s += shape(`M${CX - 30} 112C${CX - 40} 82 ${CX - 22} 74 ${CX} 74C${CX + 22} 74 ${CX + 40} 82 ${CX + 30} 112Z`, p);
    }
    s += drawSleeves(g, p, c.sleeve, c.sleevePad || 0.8, { rib: c.rib, cuff: c.cuff });
    const d = torsoPath(g, { hem: c.hem, hemHalf, loose: c.loose, neckW: c.neckW || 14, neckD: c.neckD ?? 9, vneck: c.vneck, shoulderNarrow: c.narrow || 0 });
    s += shape(d, p);
    s += fold(`M${CX - g.waist + 2} ${Y.waist - 8}Q${CX - 8} ${Y.waist + 2} ${CX - 2} ${Y.waist + 22}`);
    s += fold(`M${CX + g.waist - 2} ${Y.waist + 6}Q${CX + 10} ${Y.waist + 12} ${CX + 5} ${Y.waist + 34}`);
    if (c.rib) {
      s += line(`M${CX - hemHalf + 1} ${c.hem - 11}L${CX + hemHalf - 1} ${c.hem - 11}`, p.line, 1, 0.75);
      for (let x = CX - hemHalf + 6; x < CX + hemHalf; x += 7) s += line(`M${x} ${c.hem - 10}L${x} ${c.hem - 1}`, p.line, 0.7, 0.4);
    }
    if (c.knit) {
      for (let y = 140; y < c.hem - 16; y += 18) s += line(`M${CX - g.chest + 8} ${y}Q${CX} ${y + 5} ${CX + g.chest - 8} ${y}`, '#000', 0.7, 0.07);
    }
    if (c.neckD != null && !c.vneck && !c.hood && !c.turtle && item.type !== 'tank') {
      const w = (c.neckW || 14), de = (c.neckD ?? 9) * 2;
      s += line(`M${CX - w - 2} ${Y.neck + 1}Q${CX} ${Y.neck + de + 3} ${CX + w + 2} ${Y.neck + 1}`, p.line, 1.1, 0.7);
    }
    if (c.collar) {
      const inner = lum(p.base) > 0.5 ? mix(p.base, '#000000', 0.04) : mix(p.base, '#ffffff', 0.08);
      const collar = (side) => `M${CX + side * 15} ${Y.neck - 3}L${CX + side * 1} ${Y.neck + 16}L${CX + side * 21} ${Y.neck + 18}Z`;
      for (const side of [-1, 1]) s += `<path d="${collar(side)}" fill="${inner}" stroke="${p.line}" stroke-width="1.2" stroke-linejoin="round"/>`;
      const count = c.collar === 'polo' ? 2 : 6;
      const span = c.collar === 'polo' ? 14 : 26;
      for (let i = 0; i < count; i++) s += `<circle cx="${CX}" cy="${Y.neck + 26 + i * span}" r="1.6" fill="${p.line}"/>`;
      if (c.collar === 'shirt') s += line(`M${CX} ${Y.neck + 16}L${CX} ${c.hem}`, p.line, 0.9, 0.55);
    }
    if (c.hood) {
      s += line(`M${CX - 8} 124L${CX - 9} 156M${CX + 8} 124L${CX + 9} 156`, mix(p.base, lum(p.base) > 0.5 ? '#000000' : '#ffffff', 0.5), 1.4);
      s += line(`M${CX - 14} ${Y.neck}Q${CX} ${Y.neck + 26} ${CX + 14} ${Y.neck}`, p.line, 1.3, 0.8);
      s += line(`M${CX - 30} 262L${CX - 22} 232L${CX + 22} 232L${CX + 30} 262`, p.line, 1, 0.65);
    }
    if (c.turtle) {
      s += shape(`M${CX - g.neck - 2} 84Q${CX} 92 ${CX + g.neck + 2} 84L${CX + g.neck + 5} 112Q${CX} 120 ${CX - g.neck - 5} 112Z`, p);
      s += line(`M${CX - g.neck - 3} 96Q${CX} 104 ${CX + g.neck + 3} 96`, p.line, 0.8, 0.5);
    }
    return s;
  }

  // ---- ボトムス ----
  const PANTS = {
    slacks: { hem: 566, hemW: 13, kneeW: 15.5, thighW: 21, crease: true },
    chino: { hem: 566, hemW: 12.5, kneeW: 15.5, thighW: 21.5, pockets: true },
    jeans: { hem: 568, hemW: 12.5, kneeW: 15, thighW: 21, pockets: true, seams: true },
    wide: { hem: 572, hemW: 28, kneeW: 23, thighW: 24, shift: 4, wide: true },
    jogger: { hem: 556, hemW: 10, kneeW: 17, thighW: 23, cuff: true, drawstring: true },
    shorts: { hem: 390, hemW: 22, kneeW: 22, thighW: 22 },
  };
  const SKIRTS = {
    miniskirt: { hem: 362, half: 56 },
    flareskirt: { hem: 440, half: 64 },
    longskirt: { hem: 556, half: 72 },
  };

  function drawBottom(g, item, paint) {
    const p = paint.of(item);
    if (SKIRTS[item.type]) {
      const c = SKIRTS[item.type];
      const side = [P(CX - g.waist, Y.waist), P(CX - g.hip - 3, Y.hip - 6), P(CX - c.half, c.hem)];
      const waves = [];
      const steps = 6;
      for (let i = 0; i <= steps; i++) waves.push(P(CX - c.half + (i * 2 * c.half) / steps, c.hem + (i % 2 ? 4 : 0)));
      let d = curve(side, true) + curve(waves, false) + curve(mirror(side).reverse(), false) + 'Z';
      let s = shape(d, p);
      for (const k of [-0.62, -0.25, 0.22, 0.6]) {
        s += fold(`M${n(CX + k * g.waist)} ${Y.waist + 14}Q${n(CX + k * c.half * 0.8)} ${n((Y.waist + c.hem) / 2)} ${n(CX + k * c.half)} ${c.hem - 4}`);
      }
      s += line(`M${CX - g.waist} ${Y.waist + 8}L${CX + g.waist} ${Y.waist + 8}`, p.line, 1, 0.7);
      return s;
    }
    const c = PANTS[item.type] || PANTS.chino;
    let s = shape(pantsPath(g, { hem: c.hem, hemW: c.hemW, kneeW: c.kneeW, thighW: c.thighW, shift: c.shift || 0 }), p);
    s += line(`M${CX - g.waist} ${Y.waist + 8}L${CX + g.waist} ${Y.waist + 8}`, p.line, 1, 0.7);
    s += line(`M${CX} ${Y.waist + 8}L${CX} ${Y.crotch - 4}`, p.line, 0.9, 0.5);
    const xc = CX - g.legX - (c.shift || 0);
    if (c.crease) {
      s += fold(`M${xc} 310L${xc} ${c.hem - 2}`);
      s += fold(`M${2 * CX - xc} 310L${2 * CX - xc} ${c.hem - 2}`);
    }
    if (c.pockets) {
      s += line(`M${CX - g.hip + 3} ${Y.hip - 26}Q${CX - g.hip + 18} ${Y.hip - 24} ${CX - g.hip + 20} ${Y.waist + 8}`, p.line, 0.9, 0.55);
      s += line(`M${CX + g.hip - 3} ${Y.hip - 26}Q${CX + g.hip - 18} ${Y.hip - 24} ${CX + g.hip - 20} ${Y.waist + 8}`, p.line, 0.9, 0.55);
    }
    if (c.seams) {
      const st = mix(p.base, '#e0b676', 0.75);
      s += line(`M${xc - c.hemW + 2} ${c.hem - 7}L${xc + c.hemW - 2} ${c.hem - 7}`, st, 0.9, 0.9);
      s += line(`M${2 * CX - xc - c.hemW + 2} ${c.hem - 7}L${2 * CX - xc + c.hemW - 2} ${c.hem - 7}`, st, 0.9, 0.9);
      s += glow(`M${xc - 3} 350Q${xc - 5} 400 ${xc - 2} 450`);
      s += glow(`M${2 * CX - xc + 3} 350Q${2 * CX - xc + 5} 400 ${2 * CX - xc + 2} 450`);
    }
    if (c.cuff) {
      s += line(`M${xc - c.hemW} ${c.hem - 12}L${xc + c.hemW} ${c.hem - 12}`, p.line, 1, 0.8);
      s += line(`M${2 * CX - xc - c.hemW} ${c.hem - 12}L${2 * CX - xc + c.hemW} ${c.hem - 12}`, p.line, 1, 0.8);
    }
    if (c.drawstring) s += line(`M${CX - 4} ${Y.waist + 9}L${CX - 7} ${Y.waist + 30}M${CX + 4} ${Y.waist + 9}L${CX + 7} ${Y.waist + 30}`, p.line, 1, 0.75);
    if (c.wide) {
      s += fold(`M${xc - 10} 360Q${xc - 14} 460 ${xc - 18} ${c.hem - 2}`);
      s += fold(`M${2 * CX - xc + 10} 360Q${2 * CX - xc + 14} 460 ${2 * CX - xc + 18} ${c.hem - 2}`);
    }
    return s;
  }

  // ---- ワンピース ----
  const DRESSES = {
    dressSleeveless: { sleeve: 0, hem: 440, half: 66, narrow: 7, neckW: 12, neckD: 11 },
    dressShort: { sleeve: 0.3, hem: 460, half: 68, neckW: 14, neckD: 8 },
    dressLong: { sleeve: 1, hem: 540, half: 72, neckW: 13, neckD: 6, sleevePad: 1.5 },
  };

  function drawDress(g, item, paint) {
    const c = DRESSES[item.type] || DRESSES.dressShort;
    const p = paint.of(item);
    let s = drawSleeves(g, p, c.sleeve, c.sleevePad || 1);
    const w = g.S - (c.narrow || 0);
    const side = [P(CX - w, Y.sh), P(CX - g.chest - 1, Y.chest), P(CX - g.waist - 1, Y.waist), P(CX - g.hip - 6, Y.hip + 6), P(CX - c.half, c.hem)];
    const waves = [];
    for (let i = 0; i <= 8; i++) waves.push(P(CX - c.half + (i * 2 * c.half) / 8, c.hem + (i % 2 ? 4 : 0)));
    const d = `M${CX - c.neckW} ${Y.neck}Q${n(CX - w * 0.62)} ${Y.neck + 4} ${n(CX - w)} ${Y.sh}` +
      curve(side, false).replace(/^L[^C]*/, '') + curve(waves, false) + curve(mirror(side).reverse(), false) +
      `Q${n(CX + w * 0.62)} ${Y.neck + 4} ${CX + c.neckW} ${Y.neck}Q${CX} ${Y.neck + c.neckD * 2} ${CX - c.neckW} ${Y.neck}Z`;
    s += shape(d, p);
    s += line(`M${CX - g.waist - 1} ${Y.waist}Q${CX} ${Y.waist + 5} ${CX + g.waist + 1} ${Y.waist}`, p.line, 1, 0.55);
    for (const k of [-0.62, -0.22, 0.24, 0.62]) {
      s += fold(`M${n(CX + k * g.waist)} ${Y.waist + 10}Q${n(CX + k * c.half * 0.8)} ${n((Y.waist + c.hem) / 2)} ${n(CX + k * c.half)} ${c.hem - 4}`);
    }
    return s;
  }

  // ---- アウター ----
  const OUTERS = {
    cardigan: { hem: 318, extra: 8, gapTop: 7, gapBottom: 12, pad: 2.5, buttons: true },
    denimjk: { hem: 276, extra: 5, gapTop: 7, gapBottom: 16, pad: 3, chest: true, collar: true, band: true },
    jacket: { hem: 322, extra: 8, gapTop: 6, gapBottom: 20, pad: 3, lapel: true, pockets: true },
    blouson: { hem: 272, extra: 6, gapTop: 7, gapBottom: 8, pad: 4.5, rib: true, collar: true, zip: true },
    trench: { hem: 460, extra: 18, gapTop: 6, gapBottom: 20, pad: 3.5, lapel: true, belt: true },
    coat: { hem: 470, extra: 16, gapTop: 7, gapBottom: 18, pad: 4, lapel: true, pockets: true },
    down: { hem: 320, extra: 9, gapTop: 5, gapBottom: 7, pad: 7, quilt: true, collar: true, zip: true },
  };

  function panelPath(g, s, c) {
    const pad = c.pad;
    const hemHalf = Math.max(g.hip, g.waist) + c.extra;
    const side = [
      P(CX + s * (g.S + pad), Y.sh - 1),
      P(CX + s * (g.chest + pad + 2), Y.chest),
      P(CX + s * (g.waist + pad + 4), Y.waist),
    ];
    if (c.hem > Y.hip + 8) side.push(P(CX + s * (Math.max(g.hip, g.waist) + pad + 2), Y.hip));
    side.push(P(CX + s * hemHalf, c.hem));
    return `M${CX + s * 12} ${Y.neck - 1}Q${n(CX + s * (g.S + pad) * 0.62)} ${Y.neck + 3} ${n(CX + s * (g.S + pad))} ${Y.sh - 1}` +
      curve(side, false).replace(/^L[^C]*/, '') +
      `L${CX + s * c.gapBottom} ${c.hem}L${CX + s * c.gapTop} 196L${CX + s * 5} 128Z`;
  }

  function drawOuter(g, item, paint) {
    const c = OUTERS[item.type] || OUTERS.jacket;
    const p = paint.of(item);
    let s = drawSleeves(g, p, 1, c.pad, { rib: c.rib, cuff: item.type === 'denimjk' });
    const hemHalf = Math.max(g.hip, g.waist) + c.extra;
    for (const side of [-1, 1]) s += shape(panelPath(g, side, c), p);
    if (c.lapel) {
      const light = lum(p.base) > 0.5 ? mix(p.base, '#000000', 0.06) : mix(p.base, '#ffffff', 0.1);
      for (const side of [-1, 1]) {
        s += `<path d="M${CX + side * 12} ${Y.neck - 2}L${CX + side * 27} 122L${CX + side * 21} 136L${CX + side * 27} 146L${CX + side * 8} 196L${CX + side * 5} 128Z" fill="${light}" stroke="${p.line}" stroke-width="1.2" stroke-linejoin="round"/>`;
      }
    }
    if (c.collar) {
      for (const side of [-1, 1]) s += shape(`M${CX + side * 12} ${Y.neck - 6}L${CX + side * 29} ${Y.neck + 6}L${CX + side * 12} ${Y.neck + 20}L${CX + side * 5} ${Y.neck + 10}Z`, p);
    }
    if (c.pockets) {
      for (const side of [-1, 1]) s += line(`M${CX + side * (g.waist - 8)} ${Y.hip + 8}L${CX + side * (g.waist + 12)} ${Y.hip + 8}`, p.line, 1.3, 0.7);
    }
    if (c.chest) {
      const st = mix(p.base, '#e0b676', 0.7);
      for (const side of [-1, 1]) {
        s += `<rect x="${n(side < 0 ? CX - 34 : CX + 12)}" y="146" width="22" height="20" rx="2" fill="none" stroke="${st}" stroke-width="0.9"/>`;
        s += line(`M${CX + side * 9} 142L${CX + side * (g.chest + 4)} 142`, st, 0.9, 0.9);
      }
    }
    if (c.band || c.rib) {
      const band = c.rib ? 11 : 12;
      s += line(`M${CX - hemHalf + 1} ${c.hem - band}L${CX - c.gapBottom} ${c.hem - band}M${CX + c.gapBottom} ${c.hem - band}L${CX + hemHalf - 1} ${c.hem - band}`, p.line, 1, 0.75);
    }
    if (c.buttons) {
      for (let i = 0; i < 4; i++) s += `<circle cx="${CX - 10 - i * 0.7}" cy="${200 + i * 28}" r="2" fill="${p.line}"/>`;
    }
    if (c.zip) {
      s += line(`M${CX - c.gapTop} 196L${CX - c.gapBottom} ${c.hem}M${CX + c.gapTop} 196L${CX + c.gapBottom} ${c.hem}`, p.line, 1.3, 0.55);
    }
    if (c.belt) {
      const bw = g.waist + c.pad + 4;
      for (const side of [-1, 1]) s += shape(`M${CX + side * c.gapTop} ${Y.waist - 6}L${CX + side * (bw + 1)} ${Y.waist - 6}L${CX + side * (bw + 1)} ${Y.waist + 6}L${CX + side * c.gapTop} ${Y.waist + 6}Z`, p);
      s += `<rect x="${CX - 22}" y="${Y.waist - 8}" width="14" height="16" rx="2" fill="none" stroke="${p.line}" stroke-width="1.4"/>`;
    }
    if (c.quilt) {
      for (let y = 152; y < c.hem - 6; y += 28) {
        for (const side of [-1, 1]) s += line(`M${CX + side * (c.gapTop + 1)} ${y}L${CX + side * (g.waist + c.pad + 6)} ${y}`, p.line, 1, 0.42);
      }
      for (const side of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
          const y = 158 + k * 40;
          const x = CX + side * (g.S + 4 + k * 3.8);
          s += line(`M${n(x - 12)} ${y}L${n(x + 12)} ${y}`, p.line, 0.9, 0.38);
        }
      }
    } else if (item.type !== 'denimjk') {
      for (const side of [-1, 1]) s += fold(`M${CX + side * (g.waist + 4)} ${Y.waist + 20}Q${CX + side * (g.waist - 4)} ${Y.waist + 60} ${CX + side * (hemHalf - 10)} ${c.hem - 8}`);
    }
    return s;
  }

  // ---- 靴 ----
  function drawShoes(g, item, paint) {
    const p = paint.of(item);
    let s = '';
    for (const side of [-1, 1]) {
      const fx = CX + side * (g.legX + 2);
      const w = g.ankle + 3.5;
      const toe = fx + side * 3;
      const footer = `M${fx - w} 566C${fx - w - 2} 584 ${toe - w - 1} 598 ${toe} 600C${toe + w + 1} 598 ${fx + w + 2} 584 ${fx + w} 566Z`;
      switch (item.type) {
        case 'loafers':
          s += shape(footer, p);
          s += line(`M${fx - w + 3} 582Q${toe} 588 ${fx + w - 3} 582`, p.line, 1, 0.7);
          break;
        case 'boots':
        case 'rainshoes': {
          const top = item.type === 'boots' ? 498 : 520;
          s += shape(`M${fx - g.ankle - 6} ${top}C${fx - g.ankle - 6} 540 ${fx - w - 1} 570 ${fx - w - 2} 582C${fx - w} 596 ${toe - w} 600 ${toe} 601C${toe + w} 600 ${fx + w} 596 ${fx + w + 2} 582C${fx + w + 1} 570 ${fx + g.ankle + 6} 540 ${fx + g.ankle + 6} ${top}Z`, p);
          s += line(`M${fx - g.ankle - 6} ${top + 8}L${fx + g.ankle + 6} ${top + 8}`, p.line, 0.9, 0.5);
          s += `<path d="M${toe - w} 596Q${toe} 604 ${toe + w} 596L${toe + w - 2} 603L${toe - w + 2} 603Z" fill="${p.line}"/>`;
          break;
        }
        case 'sandals':
          s += `<path d="M${fx - g.ankle} 560C${fx - w} 578 ${toe - w} 598 ${toe} 600C${toe + w} 598 ${fx + w} 578 ${fx + g.ankle} 560Z" fill="${SKIN}" stroke="${SKIN_LINE}" stroke-width="1"/>`;
          s += line(`M${fx - w + 1} 576Q${fx} 582 ${fx + w - 1} 576`, p.base, 4.5);
          s += line(`M${fx - w + 3} 588Q${toe} 592 ${fx + w - 3} 588`, p.base, 4);
          s += `<path d="M${toe - w} 596Q${toe} 604 ${toe + w} 596L${toe + w - 1} 603L${toe - w + 1} 603Z" fill="${p.base}" stroke="${p.line}" stroke-width="0.8"/>`;
          break;
        case 'pumps':
          s += `<path d="M${fx - w + 3} 562C${fx - w} 582 ${toe - 5} 604 ${toe} 606C${toe + 5} 604 ${fx + w} 582 ${fx + w - 3} 562Z" fill="${SKIN}" stroke="${SKIN_LINE}" stroke-width="1"/>`;
          s += shape(`M${fx - w + 1} 578C${fx - w + 3} 590 ${toe - 6} 606 ${toe} 608C${toe + 6} 606 ${fx + w - 3} 590 ${fx + w - 1} 578Q${toe} 592 ${fx - w + 1} 578Z`, p);
          break;
        default: { // スニーカー
          s += shape(footer, p);
          const soleColor = item.placeholder ? '#f2efe9' : '#f7f5ef';
          s += `<path d="M${fx - w - 1} 584C${fx - w} 594 ${toe - w} 599 ${toe} 601C${toe + w} 599 ${fx + w} 594 ${fx + w + 1} 584Q${toe} 596 ${fx - w - 1} 584Z" fill="${soleColor}" stroke="${p.line}" stroke-width="1"/>`;
          for (let k = 0; k < 3; k++) s += line(`M${fx - 5} ${570 + k * 5}L${fx + 5} ${570 + k * 5}`, lum(p.base) > 0.7 ? p.line : '#fff', 1, 0.8);
        }
      }
    }
    return s;
  }

  // ---- 小物 ----
  function drawScarf(g, item, paint) {
    const p = paint.of(item);
    let s = shape(`M${CX - g.neck - 11} 88C${CX - g.neck - 18} 104 ${CX - g.neck - 14} 122 ${CX - 6} 126C${CX + 8} 128 ${CX + g.neck + 18} 118 ${CX + g.neck + 11} 88Q${CX} 104 ${CX - g.neck - 11} 88Z`, p);
    s += shape(`M${CX - 14} 118L${CX - 22} 204L${CX - 4} 206L${CX + 3} 122Z`, p);
    s += line(`M${CX - 21} 193L${CX - 4} 195`, p.line, 0.9, 0.6);
    s += line(`M${CX - g.neck - 8} 104Q${CX} 116 ${CX + g.neck + 8} 104`, p.line, 0.9, 0.5);
    return s;
  }

  function drawHat(gender, item, paint) {
    const p = paint.of(item);
    if (item.type === 'beanie') {
      let s = shape(`M${CX - 26} 50C${CX - 28} 16 ${CX + 28} 16 ${CX + 26} 50Q${CX} 42 ${CX - 26} 50Z`, p);
      s += shape(`M${CX - 27} 42Q${CX} 34 ${CX + 27} 42L${CX + 27} 54Q${CX} 46 ${CX - 27} 54Z`, p);
      for (let x = CX - 22; x <= CX + 22; x += 7) s += line(`M${x} 41L${x} 50`, p.line, 0.7, 0.45);
      return s;
    }
    let s = shape(`M${CX - 26} 46C${CX - 28} 15 ${CX + 28} 15 ${CX + 26} 46Q${CX} 38 ${CX - 26} 46Z`, p);
    s += shape(`M${CX - 25} 43Q${CX} 34 ${CX + 25} 43Q${CX + 32} 50 ${CX + 22} 53Q${CX} 44 ${CX - 22} 53Q${CX - 32} 50 ${CX - 25} 43Z`, p);
    s += `<circle cx="${CX}" cy="20" r="2" fill="${p.line}"/>`;
    return s;
  }

  function drawBag(g, item, paint) {
    const p = paint.of(item);
    const x = CX - g.S - 54, y = 296;
    const wrist = CX - g.S - 15;
    let s = line(`M${x + 12} ${y + 2}C${x + 16} ${y - 34} ${wrist + 10} ${y - 34} ${wrist + 2} ${y + 14}`, p.line, 2.2);
    s += line(`M${x + 34} ${y + 2}C${x + 30} ${y - 26} ${wrist} ${y - 26} ${wrist - 3} ${y + 12}`, p.line, 2.2);
    s += shape(`M${x} ${y}L${x + 46} ${y}L${x + 50} ${y + 56}Q${x + 23} ${y + 61} ${x - 4} ${y + 56}Z`, p);
    s += line(`M${x + 3} ${y + 12}L${x + 43} ${y + 12}`, p.line, 0.8, 0.5);
    return s;
  }

  function drawUmbrella(g) {
    const x = CX + g.S + 16;
    const top = 318;
    let s = line(`M${x} ${top - 12}L${x} ${top + 8}`, '#3c3a36', 2.6);
    s += `<path d="M${x - 8} ${top + 8}C${x - 6} ${top + 70} ${x - 3} ${top + 170} ${x} ${top + 262}C${x + 3} ${top + 170} ${x + 6} ${top + 70} ${x + 8} ${top + 8}Z" fill="#4c6377" stroke="#2e3e4d" stroke-width="1.2"/>`;
    s += line(`M${x - 3} ${top + 40}L${x + 3} ${top + 52}L${x - 2} ${top + 66}`, '#2e3e4d', 0.8, 0.5);
    return s;
  }

  // ---- 背景 ----
  const BACKDROPS = { sun: '#f3e8cf', cloud: '#e9e7e1', rain: '#dbe3e6', snow: '#e8edf1', none: '#efece5' };
  function backdrop(weather) {
    let s = `<rect width="320" height="630" fill="${BACKDROPS[weather] || BACKDROPS.none}"/>`;
    if (weather === 'sun') s += `<circle cx="262" cy="74" r="34" fill="#f2c96a" opacity=".7"/>`;
    if (weather === 'cloud' || weather === 'rain' || weather === 'snow') {
      const c = weather === 'rain' ? '#c3ced3' : '#fbfaf7';
      s += `<path d="M212 92a22 22 0 0 1 8-42a30 30 0 0 1 56-6a24 24 0 0 1 16 48Z" fill="${c}" opacity=".85"/>`;
    }
    if (weather === 'rain') {
      for (let i = 0; i < 22; i++) {
        const x = 16 + ((i * 53) % 296), y = 110 + ((i * 97) % 450);
        s += `<path d="M${x} ${y}l-5 15" stroke="#8ea6b3" stroke-width="1.5" stroke-linecap="round" opacity=".55"/>`;
      }
    }
    if (weather === 'snow') {
      for (let i = 0; i < 26; i++) {
        const x = 14 + ((i * 53) % 296), y = 100 + ((i * 89) % 480);
        s += `<circle cx="${x}" cy="${y}" r="${2 + (i % 3)}" fill="#fff"/>`;
      }
    }
    s += `<ellipse cx="160" cy="606" rx="82" ry="9" fill="#000" opacity=".08"/>`;
    return s;
  }

  // ---- 全身イラスト ----
  function render({ gender = 'him', look = {}, weather = 'none', umbrella = false, label = '', showBackdrop = true } = {}) {
    const g = BODY[gender] || BODY.him;
    const paint = new Paint();
    const shoes = look.shoes || { placeholder: true, type: 'sneakers' };
    let bottom = look.bottom, top = look.top;
    if (!look.dress) {
      if (!bottom) bottom = { placeholder: true, type: 'chino' };
      if (!top) top = { placeholder: true, type: 'longtee' };
    }
    const inner = [
      showBackdrop ? backdrop(weather) : '',
      hairBack(gender),
      body(g),
      drawShoes(g, shoes, paint),
      arms(g),
      neckSkin(g),
      look.dress ? drawDress(g, look.dress, paint) : drawBottom(g, bottom, paint) + drawTop(g, top, paint),
      look.outer ? drawOuter(g, look.outer, paint) : '',
      look.scarf ? drawScarf(g, look.scarf, paint) : '',
      head(gender),
      look.hat ? drawHat(gender, look.hat, paint) : '',
      look.bag ? drawBag(g, look.bag, paint) : '',
      umbrella ? drawUmbrella(g) : '',
    ].join('');
    const aria = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
    return `<svg class="figure" viewBox="0 0 320 630" xmlns="http://www.w3.org/2000/svg" ${aria}><defs>${paint.defs.join('')}</defs>${inner}</svg>`;
  }

  // ---- 写真のない服のサムネイル ----
  const VIEW = {
    top: '40 74 240 250', bottom: '60 205 200 380', dress: '40 80 240 480', outer: '30 80 260 410',
    shoes: '100 490 120 125', hat: '110 8 100 60', scarf: '100 74 120 140', bag: '30 250 110 120',
  };
  function drawThumb(item, gender, slot) {
    const g = BODY[gender] || BODY.him;
    const paint = new Paint();
    const draw = {
      top: () => drawTop(g, item, paint),
      bottom: () => drawBottom(g, item, paint),
      dress: () => drawDress(g, item, paint),
      outer: () => drawOuter(g, item, paint),
      shoes: () => drawShoes(g, item, paint),
      hat: () => drawHat(gender, item, paint),
      scarf: () => drawScarf(g, item, paint),
      bag: () => drawBag(g, item, paint),
    }[slot];
    return draw ? { body: draw(), defs: paint.defs.join('') } : null;
  }

  // 描いた服の実際の範囲。服の形は種類で決まるので、人と種類ごとに一度だけ測る
  const fitCache = new Map();
  function fitView(item, gender, slot) {
    const key = `${gender}|${slot}|${item.type}`;
    if (fitCache.has(key)) return fitCache.get(key);
    if (typeof document === 'undefined' || !document.body) return null;
    const d = drawThumb({ type: item.type, color: '#888888', pattern: 'plain' }, gender, slot);
    if (!d) return null;
    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    tmp.setAttribute('style', 'position:absolute;left:-10000px;top:0;width:10px;height:10px;visibility:hidden');
    tmp.innerHTML = d.body;
    document.body.appendChild(tmp);
    let view = null;
    try {
      const bb = tmp.getBBox();
      if (bb.width > 0 && bb.height > 0) view = [bb.x - 2, bb.y - 2, bb.width + 4, bb.height + 4].map((v) => Math.round(v * 10) / 10);
    } catch {}
    tmp.remove();
    fitCache.set(key, view);
    return view;
  }

  // fit: true なら、余白を除いて服の範囲だけを表示する(コラージュで大きさをそろえるため)
  function thumb(item, gender, slot, { fit = false } = {}) {
    const d = drawThumb(item, gender, slot);
    if (!d) return '';
    const view = (fit && fitView(item, gender, slot)?.join(' ')) || VIEW[slot];
    return `<svg class="thumb-svg" viewBox="${view}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>${d.defs}</defs>${d.body}</svg>`;
  }

  function thumbAspect(slot, item, gender) {
    const v = (item && fitView(item, gender, slot)) || (VIEW[slot] || '0 0 1 1').split(' ').map(Number);
    return v[2] / v[3];
  }
  const api = { render, thumb, thumbAspect, backdropColor: (w) => BACKDROPS[w] || BACKDROPS.none };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Figure = api;
})(typeof window !== 'undefined' ? window : globalThis);
