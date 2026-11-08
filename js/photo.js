// 写真の縮小、背景の切り抜き、色と生地の読み取り
(function (root) {
  const WORK = 480; // 判定に使う大きさ
  const JAG_LIMIT = 3.8; // 輪郭の複雑さの上限
  // gradient: 隣の点との差の許容 / distance: 背景色との差の許容
  const LEVELS = {
    gentle: { gradient: 3, distance: 10 },
    normal: { gradient: 4.5, distance: 18 },
    strong: { gradient: 8.5, distance: 32 },
  };

  async function load(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  function toCanvas(img, maxSide) {
    const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    const k = Math.min(1, maxSide / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k));
    c.height = Math.max(1, Math.round(sh * k));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  const toBlob = (canvas, type, q) => new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を変換できませんでした'))), type, q);
  });

  // sRGB → Lab(色の差を人の見え方に近づける)
  function toLab(data, count) {
    const lab = new Float32Array(count * 3);
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const table = new Float32Array(256);
    for (let i = 0; i < 256; i++) table[i] = lin(i);
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    for (let i = 0; i < count; i++) {
      const r = table[data[i * 4]], g = table[data[i * 4 + 1]], b = table[data[i * 4 + 2]];
      const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505);
      const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089);
      lab[i * 3] = 116 * y - 16;
      lab[i * 3 + 1] = 500 * (x - y);
      lab[i * 3 + 2] = 200 * (y - z);
    }
    return lab;
  }

  // 影は明るさだけが変わるので、明るさの差は少し軽く数える
  function labDist(a, i, b, j) {
    const dl = (a[i] - b[j]) * 0.8, da = a[i + 1] - b[j + 1], db = a[i + 2] - b[j + 2];
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  // 隣どうしの差。境目を見つけるので、明るさもそのまま数える
  function edgeDist(a, i, j) {
    const dl = a[i] - a[j], da = a[i + 1] - a[j + 1], db = a[i + 2] - a[j + 2];
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  // 背景色を推定する。服が写真の端にかかることがあるので、四隅の色を基準にする
  function borderClusters(lab, w, h) {
    const idx = [];
    for (let x = 0; x < w; x += 2) idx.push(x, x + (h - 1) * w);
    for (let y = 0; y < h; y += 2) idx.push(y * w, y * w + w - 1);
    const size = Math.max(4, Math.round(Math.min(w, h) * 0.05));
    const corners = [];
    for (let y = 0; y < size; y += 2) {
      for (let x = 0; x < size; x += 2) {
        corners.push(y * w + x, y * w + (w - 1 - x), (h - 1 - y) * w + x, (h - 1 - y) * w + (w - 1 - x));
      }
    }
    const group = (points) => {
      const clusters = [];
      for (const p of points) {
        const o = p * 3;
        let hit = null;
        for (const c of clusters) if (labDist(lab, o, c.v, 0) < 14) { hit = c; break; }
        if (hit) {
          hit.n++;
          for (let k = 0; k < 3; k++) hit.v[k] += (lab[o + k] - hit.v[k]) / hit.n;
        } else {
          clusters.push({ n: 1, v: Float32Array.from([lab[o], lab[o + 1], lab[o + 2]]) });
        }
      }
      return clusters;
    };
    const fromCorners = group(corners).filter((c) => c.n >= corners.length * 0.2);
    const fromBorder = group(idx).filter((c) => c.n >= idx.length * 0.3 && !fromCorners.some((f) => labDist(c.v, 0, f.v, 0) < 14));
    return { clusters: [...fromCorners, ...fromBorder].slice(0, 4), border: idx };
  }

  function erode(mask, w, h, r) {
    let cur = mask;
    for (let t = 0; t < r; t++) {
      const out = new Uint8Array(w * h);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          out[i] = cur[i] && cur[i - 1] && cur[i + 1] && cur[i - w] && cur[i + w] ? 1 : 0;
        }
      }
      cur = out;
    }
    return cur;
  }

  function dilate(mask, w, h, r) {
    let cur = mask;
    for (let t = 0; t < r; t++) {
      const out = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          out[i] = cur[i] || (x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) || (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w]) ? 1 : 0;
        }
      }
      cur = out;
    }
    return cur;
  }

  function components(mask, w, h) {
    const label = new Int32Array(w * h);
    const sizes = [0];
    const stack = [];
    for (let s = 0; s < mask.length; s++) {
      if (!mask[s] || label[s]) continue;
      const id = sizes.length;
      let size = 0;
      label[s] = id;
      stack.push(s);
      while (stack.length) {
        const i = stack.pop();
        size++;
        const x = i % w;
        if (x > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = id; stack.push(i - 1); }
        if (x < w - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = id; stack.push(i + 1); }
        if (i >= w && mask[i - w] && !label[i - w]) { label[i - w] = id; stack.push(i - w); }
        if (i < w * (h - 1) && mask[i + w] && !label[i + w]) { label[i + w] = id; stack.push(i + w); }
      }
      sizes.push(size);
    }
    return { label, sizes };
  }

  // 服の内側の明るい部分(白い靴底など)が背景とつながって抜けるのを防ぐ。
  // 細いすき間をふさいだ状態で周囲から塗り直し、外とつながらない部分は服に戻す
  function sealInterior(mask, w, h) {
    const count = w * h;
    const closed = erode(dilate(mask, w, h, 8), w, h, 8);
    const outside = new Uint8Array(count);
    const queue = new Int32Array(count);
    let head = 0, tail = 0;
    const seed = (i) => { if (!closed[i] && !outside[i]) { outside[i] = 1; queue[tail++] = i; } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      if (x > 0) seed(i - 1);
      if (x < w - 1) seed(i + 1);
      if (i >= w) seed(i - w);
      if (i < count - w) seed(i + w);
    }
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i++) out[i] = outside[i] ? 0 : 1;
    return out;
  }

  // 輪郭の複雑さ。円が1で、切り抜きに失敗すると大きくなる
  function jaggedness(mask, w, h, area) {
    let perimeter = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (mask[i] && !(mask[i - 1] && mask[i + 1] && mask[i - w] && mask[i + w])) perimeter++;
      }
    }
    return (perimeter * perimeter) / (4 * Math.PI * Math.max(1, area));
  }

  // 写真の周囲からつながる背景を塗りつぶし、残りを服とみなす
  function segment(small, level) {
    const { gradient, distance } = LEVELS[level] || LEVELS.normal;
    const w = small.width, h = small.height, count = w * h;
    const { data } = small.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
    const lab = toLab(data, count);
    const { clusters, border } = borderClusters(lab, w, h);
    if (!clusters.length) return { ok: false, reason: 'busy-background' };

    const nearBg = (i) => {
      const o = i * 3;
      for (const c of clusters) if (labDist(lab, o, c.v, 0) < distance) return true;
      return false;
    };
    const bg = new Uint8Array(count);
    const queue = new Int32Array(count);
    let head = 0, tail = 0;
    for (const p of border) {
      if (!bg[p] && nearBg(p)) { bg[p] = 1; queue[tail++] = p; }
    }
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const visit = (j) => {
        if (bg[j]) return;
        if (edgeDist(lab, i * 3, j * 3) < gradient && nearBg(j)) { bg[j] = 1; queue[tail++] = j; }
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i < count - w) visit(i + w);
    }

    let mask = new Uint8Array(count);
    for (let i = 0; i < count; i++) mask[i] = bg[i] ? 0 : 1;
    // 細いハンガーや細かいノイズを除く
    mask = dilate(erode(mask, w, h, 2), w, h, 2);
    mask = sealInterior(mask, w, h);

    const { label, sizes } = components(mask, w, h);
    const largest = Math.max(0, ...sizes);
    if (!largest) return { ok: false, reason: 'nothing-found' };
    let kept = 0;
    for (const size of sizes) if (size >= largest * 0.2) kept++;
    let fg = 0, minX = w, minY = h, maxX = 0, maxY = 0, edge = 0;
    const clean = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      if (!label[i] || sizes[label[i]] < largest * 0.2) continue; // 靴の左右のように大きな塊は両方残す
      clean[i] = 1;
      fg++;
      const x = i % w, y = (i - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x <= 2 || y <= 2 || x >= w - 3 || y >= h - 3) edge++;
    }
    const coverage = fg / count;
    const perimeter = 2 * (w + h);
    const edgeRatio = edge / perimeter / 3;
    const box = { minX, minY, maxX, maxY };
    const boxFill = fg / Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
    // 背景と服の色が近い、背景が複雑、などで失敗した結果は使わない
    const jag = jaggedness(clean, w, h, fg);
    const ok = coverage >= 0.05 && coverage <= 0.9 && edgeRatio < 0.3 && boxFill > 0.42 && kept <= 3 && jag < JAG_LIMIT;
    return { ok, mask: clean, box, coverage, edgeRatio, boxFill, jag, kept, data, w, h, lab, reason: ok ? null : 'low-quality' };
  }

  // 代表色: 服の部分だけを見て、中央に近い色を重く数える
  function dominantFromMask(seg) {
    const { mask, data, w, h, box } = seg;
    const bins = new Map();
    const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
    const rx = Math.max(1, (box.maxX - box.minX) / 2), ry = Math.max(1, (box.maxY - box.minY) / 2);
    for (let y = box.minY; y <= box.maxY; y += 2) {
      for (let x = box.minX; x <= box.maxX; x += 2) {
        const i = y * w + x;
        if (!mask[i]) continue;
        const o = i * 4;
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const weight = Math.max(0.1, 1 - (dx * dx + dy * dy) * 0.5);
        const key = (data[o] >> 4 << 8) | (data[o + 1] >> 4 << 4) | (data[o + 2] >> 4);
        const b = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        b.n += weight; b.r += data[o] * weight; b.g += data[o + 1] * weight; b.b += data[o + 2] * weight;
        bins.set(key, b);
      }
    }
    const top = [...bins.values()].sort((a, b) => b.n - a.n)[0];
    return top ? rgbHex(top.r / top.n, top.g / top.n, top.b / top.n) : null;
  }

  const rgbHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

  // 切り抜きなしのときの代表色: 周囲の色を除き、中央を重く数える
  function dominantFromCenter(small) {
    const w = small.width, h = small.height;
    const { data } = small.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
    const bins = new Map();
    for (let y = Math.floor(h * 0.2); y < h * 0.8; y += 2) {
      for (let x = Math.floor(w * 0.2); x < w * 0.8; x += 2) {
        const o = (y * w + x) * 4;
        const key = (data[o] >> 4 << 8) | (data[o + 1] >> 4 << 4) | (data[o + 2] >> 4);
        const b = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        b.n++; b.r += data[o]; b.g += data[o + 1]; b.b += data[o + 2];
        bins.set(key, b);
      }
    }
    const top = [...bins.values()].sort((a, b) => b.n - a.n)[0];
    return top ? rgbHex(top.r / top.n, top.g / top.n, top.b / top.n) : '#a3a3a0';
  }

  // 切り抜き画像(透過)を作る
  function makeCutout(large, seg) {
    const scale = large.width / seg.w;
    const smooth = erode(seg.mask, seg.w, seg.h, 1); // 背景色のふちを残さない
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = seg.w;
    maskCanvas.height = seg.h;
    const mctx = maskCanvas.getContext('2d');
    const img = mctx.createImageData(seg.w, seg.h);
    for (let i = 0; i < smooth.length; i++) { img.data[i * 4 + 3] = smooth[i] ? 255 : 0; }
    mctx.putImageData(img, 0, 0);

    const m = 4;
    const sx = Math.max(0, Math.floor((seg.box.minX - m) * scale)), sy = Math.max(0, Math.floor((seg.box.minY - m) * scale));
    const ex = Math.min(large.width, Math.ceil((seg.box.maxX + m) * scale)), ey = Math.min(large.height, Math.ceil((seg.box.maxY + m) * scale));
    const out = document.createElement('canvas');
    out.width = ex - sx;
    out.height = ey - sy;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(maskCanvas, -sx, -sy, large.width, large.height);
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(large, -sx, -sy);
    return out;
  }

  // 生地の写真: 服の中央から正方形を切り出し、継ぎ目が出ないように反転して並べる
  function makeTexture(large, seg) {
    let cx, cy, side;
    const scale = seg ? large.width / seg.w : 1;
    if (seg?.ok) {
      const { mask, w, box } = seg;
      cx = Math.round((box.minX + box.maxX) / 2);
      cy = Math.round(box.minY + (box.maxY - box.minY) * 0.55);
      side = Math.round(Math.min(box.maxX - box.minX, box.maxY - box.minY) * 0.13);
      // 正方形が服の中に収まるまで小さくする
      const inside = (s) => {
        let hit = 0, total = 0;
        for (let y = cy - s; y <= cy + s; y += 2) for (let x = cx - s; x <= cx + s; x += 2) { total++; if (mask[y * w + x]) hit++; }
        return total && hit / total > 0.97;
      };
      while (side > 8 && !inside(side)) side -= 2;
      if (side <= 8) return null;
    } else {
      cx = large.width / 2; cy = large.height / 2; side = Math.min(large.width, large.height) * 0.1; // large 基準
    }
    const S = 128;
    const sx = (cx - side) * scale, sy = (cy - side) * scale, ss = side * 2 * scale;
    const tile = document.createElement('canvas');
    tile.width = tile.height = S;
    const tctx = tile.getContext('2d', { willReadFrequently: true });
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(large, sx, sy, ss, ss, 0, 0, S, S);

    // 無地なら生地の写真は使わない(しわやムラが目立つだけのため)
    const { data } = tctx.getImageData(0, 0, S, S);
    let sum = 0, sq = 0;
    const n = S * S;
    for (let i = 0; i < n; i++) {
      const l = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      sum += l; sq += l * l;
    }
    const std = Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2));
    if (std < 9) return null;

    const out = document.createElement('canvas');
    out.width = out.height = S * 2;
    const octx = out.getContext('2d');
    for (const [fx, fy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      octx.save();
      octx.translate(fx < 0 ? S * 2 : 0, fy < 0 ? S * 2 : 0);
      octx.scale(fx, fy);
      octx.drawImage(tile, 0, 0);
      octx.restore();
    }
    return out;
  }

  const NO_EDIT = { rotate: 0, flip: false, crop: null };
  const sourceOf = async (x) => (x instanceof Blob ? load(x) : x);

  // 回転 → 左右反転 → トリミング の順に変換する。base は描画の基準の大きさ(形を写真に合わせるとき用)
  function transformCanvas(src, edit = NO_EDIT, maxSide = 1000, baseW, baseH, fill = '#fff') {
    const sw = baseW || src.naturalWidth || src.width, sh = baseH || src.naturalHeight || src.height;
    const k = Math.min(1, maxSide / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    const rot = (((edit?.rotate || 0) % 360) + 360) % 360;
    const swap = rot === 90 || rot === 270;
    const c = document.createElement('canvas');
    c.width = swap ? h : w;
    c.height = swap ? w : h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, c.width, c.height);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(c.width / 2, c.height / 2);
    if (edit?.flip) ctx.scale(-1, 1);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(src, -w / 2, -h / 2, w, h);
    const crop = edit?.crop;
    if (!crop) return c;
    const cx = Math.round(crop.x * c.width), cy = Math.round(crop.y * c.height);
    const cw = Math.max(1, Math.round(crop.w * c.width)), ch = Math.max(1, Math.round(crop.h * c.height));
    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    const octx = out.getContext('2d', { willReadFrequently: true });
    octx.drawImage(c, cx, cy, cw, ch, 0, 0, cw, ch);
    return out;
  }

  async function transform(source, edit = NO_EDIT, maxSide = 1000) {
    return transformCanvas(await sourceOf(source), edit, maxSide);
  }

  // 白黒の形の画像から、切り抜き処理に使う形式を作る
  function segFromMask(smallPhoto, smallMask) {
    const w = smallPhoto.width, h = smallPhoto.height;
    const { data } = smallPhoto.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
    const md = smallMask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    let fg = 0, minX = w, minY = h, maxX = 0, maxY = 0;
    for (let i = 0; i < mask.length; i++) {
      if (md[i * 4] < 128) continue;
      mask[i] = 1;
      fg++;
      const x = i % w, y = (i - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { ok: fg > w * h * 0.005, mask, box: { minX, minY, maxX, maxY }, data, w, h };
  }

  // 元の写真 + 修正内容 + 形 から、切り抜き・サムネイル・生地・色を作る
  async function compose(photoBlob, { edit = NO_EDIT, mask = null } = {}) {
    const img = await load(photoBlob);
    const large = transformCanvas(img, edit, 1000);
    const small = transformCanvas(img, edit, WORK);
    const thumbCanvas = transformCanvas(img, edit, 360);
    let seg = { ok: false };
    if (mask) {
      const m = await load(mask);
      const iw = img.naturalWidth, ih = img.naturalHeight;
      seg = segFromMask(small, transformCanvas(m, edit, WORK, iw, ih));
    }
    let cutout = null, cutW = 0, cutH = 0;
    if (seg.ok) {
      const c = makeCutout(large, seg);
      cutW = c.width;
      cutH = c.height;
      cutout = await toBlob(c, 'image/webp', 0.86);
    }
    const tex = makeTexture(large, seg.ok ? seg : null);
    return {
      cutout, cutW, cutH, cutoutOK: !!seg.ok,
      photoAspect: large.width / large.height, // 写真のまま表示するときの縦横比(コラージュで使う)
      thumb: await toBlob(thumbCanvas, 'image/jpeg', 0.8),
      texture: tex ? await toBlob(tex, 'image/jpeg', 0.82) : null,
      color: (seg.ok ? dominantFromMask(seg) : null) || dominantFromCenter(small),
    };
  }

  // 自作の切り抜きで、元の写真の座標の形(白黒PNG)を作る。失敗時は null
  async function fallbackMask(photoBlob, level = 'normal') {
    if (level === 'off') return null;
    const small = toCanvas(await load(photoBlob), WORK);
    let seg = segment(small, level);
    if (!seg.ok && level === 'normal') seg = segment(small, 'gentle'); // 服と背景が近い写真は弱めでもう一度
    if (!seg.ok) return null;
    return maskToBlob(seg.mask, seg.w, seg.h);
  }

  function maskToBlob(mask, w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < mask.length; i++) {
      const v = mask[i] ? 255 : 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toBlob(c, 'image/png');
  }

  // 保存済みの写真から作り直す(切り抜きの強さの変更、古いデータの移行)
  async function reanalyze(photoBlob, level = 'normal', edit = NO_EDIT) {
    const mask = await fallbackMask(photoBlob, level);
    return { ...(await compose(photoBlob, { edit, mask })), mask, edit, cutoutLevel: level, analyzed: 1 };
  }

  // 選んだ写真を保存用の大きさの JPEG にする
  async function normalize(file) {
    return toBlob(toCanvas(await load(file), 1000), 'image/jpeg', 0.82);
  }

  async function process(file) {
    const img = await load(file);
    const photo = await toBlob(toCanvas(img, 1000), 'image/jpeg', 0.82);
    return { photo, ...(await reanalyze(photo, 'normal')) };
  }

  const blobToDataURL = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  async function dataURLToBlob(url) {
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(url || '')) return null;
    return (await fetch(url)).blob();
  }

  root.Photo = { process, normalize, reanalyze, transform, transformCanvas, compose, fallbackMask, maskToBlob, load, toBlob, NO_EDIT, blobToDataURL, dataURLToBlob };
})(window);
