// AIの推論の本体。Web Worker の中でも、画面側でも同じコードで動く(self.Transformers と self.AI_LABELS が前提)
(function (root) {
  const ORT_VERSION = '1.31.0-dev.20260914-8d85527a0';
  const VISION = root.AiPolicy.VISION[0];
  const SEG = { light: root.AiPolicy.SEG.light[0], high: root.AiPolicy.SEG.high[0] };
  const MAX_SIDE = 1024;
  const LIGHT_SIZE = 320; // 軽量モデルの入力の大きさ
  const IMAGENET = { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] };
  const T = () => root.Transformers;
  let models = null; // { mode, ... }
  let loading = null;
  let labels = null;

  // ORT の補助ファイルの置き場所。同梱の wasm があればそれを使い、なければ(公開版・file://)jsDelivr の同じ版を使う
  async function configure() {
    const env = T().env;
    env.allowLocalModels = false;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = root.AiCache.cache;
    const loc = root.location;
    const cdn = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
    const local = new URL(loc.pathname.includes('/js/') ? '../vendor/transformers/' : 'vendor/transformers/', loc.href).href;
    let useLocal = false;
    if (loc.protocol !== 'file:') {
      try { useLocal = (await fetch(`${local}ort-wasm-simd-threaded.asyncify.wasm`, { method: 'HEAD' })).ok; } catch {}
    }
    env.backends.onnx.wasm.wasmPaths = useLocal ? local : cdn;
  }

  async function hasGpu() {
    try { return !!(root.navigator?.gpu && (await root.navigator.gpu.requestAdapter())); } catch { return false; }
  }

  const status = (mode) => root.AiCache.status(mode);
  const sizeMB = () => root.AiCache.sizeMB();

  // 別のモードのモデルを読み込んでいたら解放する(メモリを空ける)
  async function release() {
    if (!models) return;
    const m = models;
    models = null;
    for (const k of ['vision', 'seg']) { try { await m[k]?.dispose?.(); } catch {} }
  }

  function prepare(mode = 'high', onProgress = () => {}) {
    if (models && models.mode === mode) { onProgress(1); return Promise.resolve(); }
    if (loading) return loading.then(() => prepare(mode, onProgress));
    const expected = root.AiPolicy.downloadMB(mode) * 1e6;
    const files = {};
    let last = 0;
    const report = (p) => {
      if (p.status !== 'progress' || !p.total) return;
      files[p.file + p.name] = { loaded: p.loaded, total: p.total };
      const vals = Object.values(files);
      const loaded = vals.reduce((s, f) => s + f.loaded, 0);
      const total = Math.max(expected, vals.reduce((s, f) => s + f.total, 0));
      const ratio = Math.min(0.99, loaded / total);
      if (ratio > last) { last = ratio; onProgress(ratio); }
    };
    loading = (async () => {
      await release();
      await configure();
      const dev = root.AiPolicy.devices(mode, await hasGpu());
      const tf = T();
      const visionProc = await tf.AutoProcessor.from_pretrained(VISION);
      const vision = await tf.SiglipVisionModel.from_pretrained(VISION, { dtype: 'q4', device: dev.vision, progress_callback: report });
      let segProc = null;
      if (mode === 'high') {
        segProc = await tf.AutoProcessor.from_pretrained(SEG.high, {
          config: {
            do_normalize: true, do_pad: false, do_rescale: true, do_resize: true, image_mean: [0.5, 0.5, 0.5],
            feature_extractor_type: 'ImageFeatureExtractor', image_std: [1, 1, 1], resample: 2,
            rescale_factor: 0.00392156862745098, size: { width: 1024, height: 1024 },
          },
        });
      }
      const seg = await tf.AutoModel.from_pretrained(SEG[mode], { dtype: mode === 'high' ? 'q8' : 'fp32', device: dev.seg, progress_callback: report, config: { model_type: 'custom' } });
      models = { mode, visionProc, vision, segProc, seg, device: dev };
      await root.AiCache.prune(mode).catch(() => {});
      onProgress(1);
    })();
    loading.catch(() => {}).finally(() => { loading = null; });
    return loading;
  }

  async function remove() {
    await release();
    await root.AiCache.clear();
  }

  // ---- 画像 ----
  const canvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));

  function rotated(src, deg, w, h) {
    const swap = deg === 90 || deg === 270;
    const c = canvas(swap ? h : w, swap ? w : h);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    x.translate(c.width / 2, c.height / 2);
    x.rotate((deg * Math.PI) / 180);
    x.drawImage(src, -w / 2, -h / 2, w, h);
    return c;
  }

  const toRaw = (c) => new (T().RawImage)(c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data, c.width, c.height, 4);

  async function embed(c) {
    const { image_embeds } = await models.vision(await models.visionProc(toRaw(c)));
    const v = image_embeds.data;
    let n = 0;
    for (let i = 0; i < v.length; i++) n += v[i] * v[i];
    n = Math.sqrt(n);
    return Float32Array.from(v, (x) => x / n);
  }

  // 軽量モデルの前処理: 320×320 に縮め、ImageNet の平均・標準偏差でそろえる
  function lightInput(c) {
    const s = canvas(LIGHT_SIZE, LIGHT_SIZE);
    const x = s.getContext('2d', { willReadFrequently: true });
    x.drawImage(c, 0, 0, LIGHT_SIZE, LIGHT_SIZE);
    const d = x.getImageData(0, 0, LIGHT_SIZE, LIGHT_SIZE).data;
    const n = LIGHT_SIZE * LIGHT_SIZE;
    const out = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) out[k * n + i] = (d[i * 4 + k] / 255 - IMAGENET.mean[k]) / IMAGENET.std[k];
    return new (T().Tensor)('float32', out, [1, 3, LIGHT_SIZE, LIGHT_SIZE]);
  }

  // 切り抜きの形(0〜1)を返す
  async function segment(up) {
    if (models.mode === 'high') {
      const { pixel_values } = await models.segProc(toRaw(up));
      const { output } = await models.seg({ input: pixel_values });
      return { data: output.data, dims: output.dims, min: 0, max: 1 };
    }
    const name = models.seg.sessions?.model?.inputNames?.[0] || 'input.1';
    const res = await models.seg({ [name]: lightInput(up) });
    const out = Object.values(res)[0]; // 最初の出力が、全体をまとめた結果
    let min = Infinity, max = -Infinity;
    const data = out.data;
    const n = out.dims[out.dims.length - 1] * out.dims[out.dims.length - 2];
    for (let i = 0; i < n; i++) { if (data[i] < min) min = data[i]; if (data[i] > max) max = data[i]; }
    return { data, dims: out.dims, min, max };
  }

  const toBlob = (c, type) => (c.convertToBlob ? c.convertToBlob({ type }) : new Promise((r) => c.toBlob(r, type)));

  async function analyze(blob, mode = 'high', onStep = () => {}) {
    onStep(0, 'AIを読み込んでいます');
    await prepare(mode);
    if (!labels) labels = root.AiMap.decodeLabels(root.AI_LABELS);
    const bm = await createImageBitmap(blob);
    const k = Math.min(1, MAX_SIDE / Math.max(bm.width, bm.height));
    const w = Math.max(1, Math.round(bm.width * k)), h = Math.max(1, Math.round(bm.height * k));

    // 1. 向き: 4方向で「最もはっきり何かの服に見える」向きを選ぶ
    onStep(1, '向きを判定しています');
    const small = Math.min(1, 336 / Math.max(w, h));
    const sw = Math.round(w * small), sh = Math.round(h * small);
    const vecs = {}, scores = {};
    const look = async (deg) => {
      vecs[deg] = await embed(rotated(bm, deg, sw, sh));
      const sims = labels.groups.type.map((e) => { let s = 0; for (let i = 0; i < e.vec.length; i++) s += e.vec[i] * vecs[deg][i]; return s; });
      scores[deg] = root.AiMap.rotationScore(sims);
    };
    await look(0);
    // 軽量モードで、そのままの向きではっきり服に見えるなら、残りの3方向は調べない
    let rotate = 0;
    if (!root.AiPolicy.skipRotation(scores[0], mode)) {
      for (const deg of [90, 180, 270]) await look(deg);
      rotate = root.AiMap.pickRotation(scores);
    }

    // 2. 切り抜き(直した向きで行い、形は元の向きに戻す)
    onStep(2, '背景を切り抜いています');
    const up = rotated(bm, rotate, w, h);
    const out = await segment(up);
    const mh = out.dims[out.dims.length - 2], mw = out.dims[out.dims.length - 1];
    const m = canvas(mw, mh);
    const mx = m.getContext('2d');
    const img = mx.createImageData(mw, mh);
    const span = out.max - out.min || 1;
    for (let i = 0; i < mw * mh; i++) {
      const v = (out.data[i] - out.min) / span >= 0.5 ? 255 : 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    mx.putImageData(img, 0, 0);
    const back = rotated(m, (360 - rotate) % 360, up.width, up.height); // 元の写真の向き・縦横比に戻す
    const mask = await toBlob(back, 'image/png');

    // 3. 判別
    onStep(3, '種類を判別しています');
    const vec = vecs[rotate];
    const ranks = {};
    for (const g of ['type', 'pattern', 'material', 'style']) ranks[g] = root.AiMap.rank(vec, labels.groups[g]);
    bm.close?.();
    return { rotate, mask, ranks, method: 'ai', device: models.device, mode: models.mode };
  }

  // 向きと切り抜きは変えずに、種類などの判別だけを行う(手で修正した画像に使う)
  async function classify(blob, mode = 'high') {
    await prepare(mode);
    if (!labels) labels = root.AiMap.decodeLabels(root.AI_LABELS);
    const bm = await createImageBitmap(blob);
    const k = Math.min(1, 336 / Math.max(bm.width, bm.height));
    const vec = await embed(rotated(bm, 0, Math.max(1, Math.round(bm.width * k)), Math.max(1, Math.round(bm.height * k))));
    bm.close?.();
    const ranks = {};
    for (const g of ['type', 'pattern', 'material', 'style']) ranks[g] = root.AiMap.rank(vec, labels.groups[g]);
    return ranks;
  }

  root.AiCore = { status, sizeMB, prepare, remove, analyze, classify };
})(typeof self !== 'undefined' ? self : window);
