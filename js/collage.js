// 手持ちの服の写真を、平置きの写真のように並べる。服の大きさは実物の比に合わせる
(function (root) {
  const C = typeof require !== 'undefined' ? require('./catalog.js') : root.Catalog;
  const MIN_SMALL = 12; // 靴・小物の最小の大きさ(枠の高さに対する%)。実寸どおりだと小さすぎて見分けにくいため
  const PAD = 4; // 枠の余白(幅に対する%)
  const RECT_GARMENT = 0.8; // 切り抜けない写真は、写真の高さの8割が服とみなす
  const SMALL = ['shoes', 'bag', 'hat', 'scarf'];
  const Z = { bottom: 1, outer: 2, dress: 2, top: 3, shoes: 5, bag: 5, hat: 5, scarf: 5 };
  const ROT = { shoes: -4, bag: 3, hat: 4, scarf: -4 };

  // 実寸(cm)の箱。服は丈、靴・小物は長い辺を基準にする
  function sizeOf(slot, p) {
    const real = C.typeById[p.type]?.cm || 60;
    const a = p.aspect > 0 ? p.aspect : 1;
    if (SMALL.includes(slot)) return a >= 1 ? { w: real, h: real / a } : { w: real * a, h: real };
    const h = p.kind === 'rect' ? real / RECT_GARMENT : real;
    return { w: h * a, h };
  }

  // 実寸の座標(cm、下向きが+)で並べる
  function arrange(items, size) {
    const b = {};
    const put = (slot, x, y) => { b[slot] = { x, y, ...size[slot] }; };
    if (items.dress) {
      put('dress', 0, 0);
    } else {
      if (items.top) put('top', 0, 0);
      if (items.bottom) {
        const t = b.top;
        // トップスの裾にボトムスの上端を少し重ねる
        const y = t ? t.h * 0.85 : 0;
        const cx = t ? t.x + t.w / 2 : 0;
        put('bottom', cx - size.bottom.w / 2, y);
      }
    }
    const upper = b.dress || b.top || b.bottom;
    const lower = b.dress || b.bottom || b.top;
    // 枠は縦長なので、上着はトップスの後ろに重ね、小物はメインの服の上下の角に寄せて横に広げない
    if (items.outer) put('outer', upper.x - size.outer.w * 0.4, upper.y + upper.h * 0.06);
    const bottomY = lower.y + lower.h;
    if (items.shoes) put('shoes', lower.x + lower.w * 0.6, bottomY - size.shoes.h * 0.25);
    if (items.bag) put('bag', lower.x - size.bag.w * 0.45, bottomY - size.bag.h * 0.55);
    if (items.hat) put('hat', upper.x + upper.w - size.hat.w * 0.45, upper.y - size.hat.h * 0.55);
    if (items.scarf) put('scarf', upper.x + upper.w - size.scarf.w * 0.35, upper.y + upper.h * 0.35);
    return b;
  }

  function layout(items, frameAspect = 0.65) {
    const H = 100 / frameAspect; // 幅=100 としたときの枠の高さ
    const size = {};
    for (const [slot, p] of Object.entries(items)) if (p) size[slot] = sizeOf(slot, p);
    let boxes = {}, s = 1;
    for (let pass = 0; pass < 4; pass++) {
      boxes = arrange(items, size);
      const all = Object.values(boxes);
      const minX = Math.min(...all.map((r) => r.x)), maxX = Math.max(...all.map((r) => r.x + r.w));
      const minY = Math.min(...all.map((r) => r.y)), maxY = Math.max(...all.map((r) => r.y + r.h));
      s = Math.min((100 - PAD * 2) / (maxX - minX), (H - PAD * 2) / (maxY - minY));
      const ox = (100 - (maxX - minX) * s) / 2 - minX * s, oy = (H - (maxY - minY) * s) / 2 - minY * s;
      for (const r of all) { r.x = r.x * s + ox; r.y = r.y * s + oy; r.w *= s; r.h *= s; }
      // 小さすぎる靴・小物を大きくして、並べ直す
      const minLong = (MIN_SMALL / 100) * H;
      let grew = false;
      for (const slot of SMALL) {
        const r = boxes[slot];
        if (!r) continue;
        const long = Math.max(r.w, r.h);
        if (long < minLong - 1e-6) { const k = minLong / long; size[slot] = { w: size[slot].w * k, h: size[slot].h * k }; grew = true; }
      }
      if (!grew) break;
    }
    const out = {};
    for (const [slot, r] of Object.entries(boxes)) {
      out[slot] = { l: r.x, t: (r.y / H) * 100, w: r.w, h: (r.h / H) * 100, z: Z[slot] || 4, ...(ROT[slot] ? { r: ROT[slot] } : {}) };
    }
    return out;
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // piece(item) は { kind: 'cut' | 'rect' | 'draw', html, aspect(幅/高さ) } を返す
  function render(items, { piece, label = '', extra = '', frameAspect = 0.65 }) {
    const pieces = {}, entries = {};
    for (const [slot, it] of Object.entries(items)) {
      if (!it) continue;
      pieces[slot] = piece(it, slot);
      entries[slot] = { type: it.type, kind: pieces[slot].kind, aspect: pieces[slot].aspect };
    }
    const pos = layout(entries, frameAspect);
    const parts = Object.keys(pos).map((slot) => {
      const p = pos[slot];
      const f = (v) => v.toFixed(2);
      const rotate = p.r ? `transform:rotate(${p.r}deg);` : '';
      return `<div class="cp ${pieces[slot].kind}" style="left:${f(p.l)}%;top:${f(p.t)}%;width:${f(p.w)}%;height:${f(p.h)}%;z-index:${p.z};${rotate}">${pieces[slot].html}</div>`;
    });
    // extra(天気のアイコンなど)は枠の外、カードの角に置く
    return `${extra}<div class="collage" role="img" aria-label="${esc(label)}">${parts.join('')}</div>`;
  }

  const api = { render, layout, MIN_SMALL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Collage = api;
})(typeof window !== 'undefined' ? window : globalThis);
