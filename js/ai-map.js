// AIの判別結果(点数)から、登録画面の入力値を決める(画面に依存しない)
(function (root) {
  const C = typeof require !== 'undefined' ? require('./catalog.js') : root.Catalog;

  const CONFIDENT_TOP = 0.45; // 1位の確率がこれ以上
  const CONFIDENT_MARGIN = 0.15; // かつ1位と2位の差がこれ以上
  const MATERIAL_MIN = 0.3; // 素材で厚さを補正する最低の確率
  const STYLE_MIN = 0.25; // テイストに加える最低の確率
  const ROTATION_MARGIN = 0.1; // 0° を優先する幅(正しい向きの写真を誤って回さないことを優先)
  const ROTATION_TEMP = 50; // 向きの判定で、類似度を確率に変えるときの倍率
  const SCALE = 100; // 類似度を確率に変えるときの倍率

  function decodeLabels(json) {
    const toVec = (b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Float32Array(bytes.buffer);
    };
    const groups = {};
    for (const [name, list] of Object.entries(json.groups)) groups[name] = list.map((e) => ({ id: e.id, vec: toVec(e.emb) }));
    return { dim: json.dim, groups };
  }

  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

  function softmax(values) {
    const max = Math.max(...values);
    const ex = values.map((v) => Math.exp((v - max) * SCALE));
    const sum = ex.reduce((a, b) => a + b, 0);
    return ex.map((v) => v / sum);
  }

  function rank(imageVec, entries) {
    const probs = softmax(entries.map((e) => dot(imageVec, e.vec)));
    return entries.map((e, i) => ({ id: e.id, score: probs[i] })).sort((a, b) => b.score - a.score);
  }

  const isConfident = (list) => !!list?.length && list[0].score >= CONFIDENT_TOP && list[0].score - (list[1]?.score ?? 0) >= CONFIDENT_MARGIN;

  function toFormValues(ranks) {
    const type = ranks.type[0].id;
    const t = C.typeById[type];
    let warmth = t.warmth;
    const material = ranks.material?.[0];
    if (material && material.score >= MATERIAL_MIN) {
      if (['knit', 'wool', 'down'].includes(material.id)) warmth += 1;
      if (material.id === 'thin') warmth -= 1;
    }
    warmth = Math.max(0, Math.min(5, warmth));
    const styles = [...t.styles];
    for (const s of (ranks.style || []).slice(0, 2)) if (s.score >= STYLE_MIN && !styles.includes(s.id)) styles.push(s.id);
    const typeOK = isConfident(ranks.type);
    return {
      type,
      typeTop: ranks.type.slice(0, 3).map((x) => ({ type: x.id, score: x.score })),
      pattern: ranks.pattern?.[0]?.id || t.pattern || 'plain',
      warmth,
      styles,
      rainOK: !!t.rainOK,
      confident: { type: typeOK, pattern: isConfident(ranks.pattern), warmth: typeOK, styles: typeOK },
    };
  }

  const FIELDS = ['type', 'color', 'pattern', 'warmth', 'styles', 'rainOK'];
  const FROM_TYPE = ['warmth', 'styles', 'rainOK']; // 種類の初期値から決まる項目
  function mergeIntoDraft(draft, values, touched = []) {
    const out = { ...draft };
    // 種類を手で選んだときは、その種類から決まる項目もAIの値で上書きしない
    const keep = touched.includes('type') ? [...touched, ...FROM_TYPE] : touched;
    for (const f of FIELDS) if (values[f] !== undefined && !keep.includes(f)) out[f] = Array.isArray(values[f]) ? [...values[f]] : values[f];
    return out;
  }

  // ある向きの「服としてのはっきり度」= 最も近い種類の確率
  function rotationScore(sims) {
    const max = Math.max(...sims);
    let z = 0;
    for (const v of sims) z += Math.exp((v - max) * ROTATION_TEMP);
    return 1 / z;
  }

  function pickRotation(scores) {
    let best = 0;
    for (const deg of [90, 180, 270]) if (scores[deg] > scores[best]) best = deg;
    return scores[best] - scores[0] <= ROTATION_MARGIN ? 0 : best;
  }

  const api = { decodeLabels, rank, softmax, toFormValues, mergeIntoDraft, pickRotation, rotationScore, CONFIDENT_TOP, CONFIDENT_MARGIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AiMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
