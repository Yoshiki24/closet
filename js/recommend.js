// コーディネート提案のロジック(画面に依存しない)
(function (root) {
  const C = typeof require !== 'undefined' ? require('./catalog.js') : root.Catalog;
  const typeOf = (it) => C.typeById[it.type] || {};
  const slotOf = (it) => {
    const t = typeOf(it);
    return t.cat === 'acc' ? t.slot : t.cat;
  };

  // ---- 色 ----
  function hsl(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return { h, s, l };
  }

  // 白黒グレーに加え、ネイビー・ベージュ・カーキ系も「合わせやすい色」として扱う
  function isNeutral(hex) {
    const { h, s, l } = hsl(hex);
    if (s < 0.18 || l < 0.16 || l > 0.92) return true;
    if (h >= 200 && h <= 250 && l < 0.34) return true;
    if (h >= 20 && h <= 60 && s < 0.55 && l > 0.5) return true;
    if (h >= 35 && h <= 80 && s < 0.3) return true;
    return false;
  }

  const hueDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

  function harmony(colors) {
    const accents = colors.filter((c) => !isNeutral(c)).map(hsl);
    if (accents.length === 0) return { s: 8, text: '落ち着いた色でまとめたベーシックな配色' };
    const hues = accents.map((a) => a.h);
    const spread = Math.max(...hues.flatMap((a) => hues.map((b) => hueDiff(a, b))));
    if (spread <= 30) return { s: 14, text: accents.length === 1 ? '定番色に1色を効かせた配色' : '同系色でつないだまとまりのある配色' };
    if (accents.length === 2 && spread >= 150) return { s: 5, text: '反対色を合わせたメリハリのある配色' };
    if (accents.length === 2 && spread <= 60) return { s: 8, text: '近い色どうしでなじませた配色' };
    return { s: accents.length >= 3 ? -14 : -7, text: null };
  }

  function paletteFit(hex, palette) {
    const { s, l } = hsl(hex);
    switch (palette) {
      case 'neutral': return isNeutral(hex) ? 4 : -2;
      case 'vivid': return s > 0.45 && l > 0.25 && l < 0.8 ? 7 : isNeutral(hex) ? 0 : 2;
      case 'dark': return l < 0.45 && s < 0.55 ? 5 : isNeutral(hex) ? 2 : -4;
      case 'contrast': return l < 0.22 || l > 0.85 ? 4 : s > 0.55 ? 2 : -1;
      case 'pastel': return l > 0.65 ? 5 : l < 0.25 ? -3 : 0;
      case 'soft': return s < 0.5 && l > 0.35 ? 3 : l < 0.2 ? -1 : 0;
      default: return 0;
    }
  }

  // ---- 天気 → 条件 ----
  const TARGET_POINTS = [[-5, 11], [0, 10], [4, 9], [8, 8], [12, 7], [16, 6], [20, 4.5], [24, 3], [28, 2], [35, 2]];

  function targetWarmth(feel) {
    if (feel <= TARGET_POINTS[0][0]) return TARGET_POINTS[0][1];
    for (let i = 1; i < TARGET_POINTS.length; i++) {
      const [x1, y1] = TARGET_POINTS[i], [x0, y0] = TARGET_POINTS[i - 1];
      if (feel <= x1) return y0 + ((y1 - y0) * (feel - x0)) / (x1 - x0);
    }
    return 2;
  }

  function conditions(w, adjust = 0) {
    const feelMax = w.feelMax ?? w.tMax, feelMin = w.feelMin ?? w.tMin;
    // 日中に重みを置いた体感温度。adjust>0 は寒がり(低めに感じる)
    const feel = feelMin * 0.35 + feelMax * 0.65 - adjust;
    const snowy = [71, 73, 75, 77, 85, 86].includes(w.code);
    return {
      feel,
      target: targetWarmth(feel),
      rainy: (w.precipProb ?? 0) >= 50 || (w.precipSum ?? 0) >= 1 || snowy,
      snowy,
      windy: (w.windMax ?? 0) >= 9,
      swing: w.tMax - w.tMin >= 10,
      tMin: w.tMin,
    };
  }

  // ---- 1点ごとの評価 ----
  function hardNG(it, cond) {
    const t = it.type, w = it.warmth, f = cond.feel;
    const cat = typeOf(it).cat;
    if (cat === 'outer' && f >= 24) return true;
    if (cat === 'outer' && w >= 4 && f >= 14) return true;
    if (cat === 'top' && w >= 3 && f >= 26) return true;
    if (cat === 'top' && w <= 1 && f < 8) return true;
    if (cat === 'dress' && w >= 4 && f >= 24) return true;
    if (cat === 'dress' && w <= 2 && f < 14) return true;
    if (t === 'shorts' && f < 15) return true;
    if (t === 'miniskirt' && f < 10) return true;
    if (t === 'sandals' && (f < 17 || cond.snowy)) return true;
    if (t === 'pumps' && cond.snowy) return true;
    if (t === 'boots' && f > 24) return true;
    return false;
  }

  function itemScore(it, cond, mood, ctx) {
    let s = 0;
    const type = typeOf(it);
    const styles = it.styles?.length ? it.styles : type.styles || [];
    const overlap = styles.filter((x) => mood?.styles.includes(x)).length;
    s += overlap ? 7 + overlap * 2 : -3;
    if (mood) s += paletteFit(it.color, mood.palette);

    if (cond.rainy) {
      if (it.type === 'sandals') s -= 18;
      if (it.type === 'rainshoes') s += 12;
      if (['shoes', 'outer'].includes(type.cat) && it.rainOK) s += 8;
      if (it.type === 'longskirt' || it.type === 'wide') s -= 7;
      if (type.cat === 'bottom' && hsl(it.color).l > 0.8) s -= 7;
    } else if (it.type === 'rainshoes') s -= 12;
    if (cond.snowy && type.cat === 'shoes') s += it.rainOK ? 12 : -14;
    if (cond.windy && ['miniskirt', 'flareskirt', 'cap'].includes(it.type)) s -= 7;

    // 最近着たものは少し控える
    const last = ctx.lastWorn?.[it.id];
    if (last && ctx.date) {
      const days = Math.round((Date.parse(ctx.date) - Date.parse(last)) / 86400000);
      if (days >= 0 && days <= 1) s -= 16;
      else if (days >= 0 && days <= 3) s -= 8;
      else if (days >= 0 && days <= 7) s -= 3;
    } else if (!last) s += 1.5;
    return s;
  }

  // ---- 組み合わせの評価 ----
  function evaluate(look, ctx) {
    const cond = conditions(ctx.weather, ctx.adjust);
    const mood = C.MOODS.find((m) => m.id === ctx.mood);
    const main = ['top', 'bottom', 'dress', 'outer', 'shoes'].map((k) => look[k]).filter(Boolean);
    const clothes = ['top', 'bottom', 'dress', 'outer'].map((k) => look[k]).filter(Boolean);
    let s = main.reduce((sum, it) => sum + itemScore(it, cond, mood, ctx), 0);
    const reasons = [], warnings = [];

    // 暖かさ
    const total = clothes.reduce((sum, it) => sum + (Number(it.warmth) || 0), 0);
    const diff = total - cond.target;
    s -= diff * diff * 5;
    const feelText = `体感およそ${Math.round(cond.feel)}℃`;
    if (Math.abs(diff) <= 1.5) reasons.push(`${feelText}にちょうどいい厚さ`);
    else if (diff > 0) warnings.push(`${feelText}には少し暑いかもしれません`);
    else warnings.push(`${feelText}には少し寒いかもしれません`);

    // アウター
    if (!look.outer && cond.feel < 14) { s -= 40; warnings.push('上着があると安心です(合うアウターが未登録かもしれません)'); }
    if (!look.outer && cond.feel < 18 && cond.swing) s -= 8;
    if (look.outer && cond.feel >= 22) s -= 15;
    if (look.outer && cond.feel < 7 && look.outer.warmth <= 3) s -= 25; // 真冬に薄い上着は避ける
    if (look.outer && cond.feel < 11 && look.outer.warmth <= 2) s -= 12;
    if (cond.swing && look.outer && cond.feel < 22) reasons.push(`朝晩は${Math.round(cond.tMin)}℃まで下がるので羽織りを活用`);
    else if (cond.swing && !look.outer) warnings.push(`朝晩は${Math.round(cond.tMin)}℃まで下がります。薄手の羽織りがあると安心`);

    // 半袖+厚手アウターのような差が大きい組み合わせは避ける
    if (look.top && look.outer && typeOf(look.top).warmth <= 1 && look.outer.warmth >= 4) s -= 12;

    // 色
    const colors = main.map((it) => it.color);
    const h = harmony(colors);
    s += h.s;
    if (h.text) reasons.push(h.text);
    const upper = look.top || look.dress, lower = look.bottom;
    if (upper && lower) {
      const dl = Math.abs(hsl(upper.color).l - hsl(lower.color).l);
      s += dl > 0.25 ? 3 : dl < 0.06 ? -3 : 0;
    }

    // 柄は1点まで
    const patterned = clothes.filter((it) => it.pattern && !['plain', 'denim'].includes(it.pattern));
    if (patterned.length > 1) s -= 14;
    else if (patterned.length === 1) reasons.push('柄は1点に絞ってすっきり');

    // テイストのまとまり
    const lists = main.map((it) => (it.styles?.length ? it.styles : typeOf(it).styles || []));
    const allTags = new Set(lists.flat());
    let bestShare = 0;
    for (const tag of allTags) bestShare = Math.max(bestShare, lists.filter((l) => l.includes(tag)).length);
    s += (bestShare / Math.max(1, main.length)) * 8;
    if (look.shoes?.type === 'sneakers' && look.top?.type === 'shirt' && look.bottom?.type === 'slacks') s += 2;
    if (look.shoes?.type === 'loafers' && look.bottom?.type === 'jogger') s -= 8;
    if (look.shoes?.type === 'pumps' && look.bottom?.type === 'jogger') s -= 10;

    // 気分
    if (mood) {
      const hit = main.filter((it) => {
        const st = it.styles?.length ? it.styles : typeOf(it).styles || [];
        return st.some((x) => mood.styles.includes(x));
      }).length;
      if (hit >= Math.ceil(main.length / 2)) reasons.push(`「${mood.label}」の気分に合うアイテムが中心`);
    }

    // 天気
    if (cond.rainy) {
      const rainItems = main.filter((it) => it.rainOK && ['shoes', 'outer'].includes(typeOf(it).cat));
      if (rainItems.length) reasons.push(`${cond.snowy ? '雪' : '雨'}でも安心な${typeOf(rainItems[0]).label}`);
      if (look.shoes?.type === 'sandals') warnings.push('雨の日のサンダルは足元がぬれます');
    }
    if (cond.windy && (look.bottom?.type === 'miniskirt' || look.bottom?.type === 'flareskirt')) {
      warnings.push('風が強いのでスカートの裾に注意');
    }
    return { score: s, reasons: reasons.slice(0, 4), warnings, total, target: cond.target, feel: cond.feel };
  }

  // 同じ条件でも「別の提案」で結果が変わるようにする、再現性のある乱数
  function rng(seed) {
    let x = (seed * 2654435761) >>> 0 || 1;
    return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  }

  function pickAccessories(look, pool, cond, ctx, rand) {
    const out = {};
    const colors = ['top', 'bottom', 'dress', 'outer', 'shoes'].map((k) => look[k]?.color).filter(Boolean);
    const best = (items) => {
      let top = null, ts = -Infinity;
      for (const it of items) {
        const s = harmony([...colors, it.color]).s + rand() * 6;
        if (s > ts) { ts = s; top = it; }
      }
      return top;
    };
    if (cond.feel < 10 && pool.scarf.length) out.scarf = best(pool.scarf);
    const hats = pool.hat.filter((h) => (h.type === 'beanie' ? cond.feel < 10 : cond.feel >= 10 && !cond.windy && !cond.rainy));
    if (hats.length && rand() > 0.45) out.hat = best(hats);
    if (pool.bag.length) out.bag = best(pool.bag);
    return out;
  }

  function recommend(allItems, ctx) {
    const cond = conditions(ctx.weather, ctx.adjust);
    const mood = C.MOODS.find((m) => m.id === ctx.mood);
    const rand = rng((ctx.seed ?? 1) + 1);
    const ready = allItems.filter((it) => !it.resting);
    const pool = { top: [], bottom: [], dress: [], outer: [], shoes: [], hat: [], scarf: [], bag: [] };
    for (const it of ready) { const k = slotOf(it); if (pool[k]) pool[k].push(it); }
    const fallbackUsed = [];

    const ranked = (slot, limit) => {
      let list = pool[slot].filter((it) => !hardNG(it, cond));
      if (!list.length && pool[slot].length && ['top', 'bottom'].includes(slot)) {
        list = pool[slot];
        fallbackUsed.push(slot);
      }
      return list
        .map((it) => ({ it, s: itemScore(it, cond, mood, ctx) + rand() * 8 }))
        .sort((a, b) => b.s - a.s)
        .slice(0, limit)
        .map((x) => x.it);
    };

    const tops = ranked('top', 12), bottoms = ranked('bottom', 12), dresses = ranked('dress', 8);
    const outers = ranked('outer', 8), shoes = ranked('shoes', 8);
    const missing = [];
    if (!pool.top.length && !pool.dress.length) missing.push('トップス');
    if (!pool.bottom.length && !pool.dress.length) missing.push('ボトムス');
    if ((!tops.length || !bottoms.length) && !dresses.length) {
      return { looks: [], missing, cond, shortage: !missing.length };
    }

    const bases = [];
    for (const top of tops) for (const bottom of bottoms) bases.push({ top, bottom });
    for (const dress of dresses) bases.push({ dress });
    const outerOpts = [null, ...outers];
    const shoeOpts = shoes.length ? shoes : [null];

    const combos = [];
    for (const base of bases) {
      for (const outer of outerOpts) {
        for (const shoe of shoeOpts) {
          const look = { ...base };
          if (outer) look.outer = outer;
          if (shoe) look.shoes = shoe;
          const ev = evaluate(look, ctx);
          combos.push({ look, ev, rank: ev.score + rand() * 7 });
        }
      }
    }
    combos.sort((a, b) => b.rank - a.rank);

    // 似た提案が並ばないように選ぶ
    const count = ctx.count ?? 3;
    const picked = [];
    const ids = (l) => ['top', 'bottom', 'dress', 'outer', 'shoes'].map((k) => l[k]?.id).filter(Boolean);
    const differs = (a, b, need) => {
      const ib = new Set(ids(b));
      return ids(a).filter((x) => !ib.has(x)).length >= need;
    };
    for (const need of [2, 1]) {
      for (const c of combos) {
        if (picked.length >= count) break;
        if (picked.every((p) => differs(c.look, p.look, need))) picked.push(c);
      }
    }

    const looks = picked.map(({ look, ev }) => {
      const full = { ...look, ...pickAccessories(look, pool, cond, ctx, rand) };
      const warnings = [...ev.warnings];
      if (fallbackUsed.length) warnings.unshift('今日の気温に合う服が足りないため、手持ちの中で近いものを選びました');
      return { items: full, score: ev.score, reasons: ev.reasons, warnings };
    });
    return { looks, missing, cond, shortage: false };
  }

  const api = { recommend, evaluate, conditions, targetWarmth, harmony, isNeutral, hsl, slotOf, hardNG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Recommend = api;
})(typeof window !== 'undefined' ? window : globalThis);
