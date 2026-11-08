// AIの推論の本体。Web Worker の中でも、画面側でも同じコードで動く(self.Transformers と self.AI_LABELS が前提)
(function (root) {
  const ORT_VERSION = '1.31.0-dev.20260914-8d85527a0';
  const VISION = 'Marqo/marqo-fashionSigLIP';
  const SEG = 'briaai/RMBG-1.4';
  const EXPECTED_BYTES = 106e6;
  const MAX_SIDE = 1024;
  const T = () => root.Transformers;
  let models = null;
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

  async function device() {
    try { if (root.navigator?.gpu && (await root.navigator.gpu.requestAdapter())) return 'webgpu'; } catch {}
    return 'wasm';
  }

  const status = () => root.AiCache.status();
  const sizeMB = () => root.AiCache.sizeMB();

  function prepare(onProgress = () => {}) {
    if (models) { onProgress(1); return Promise.resolve(); }
    if (loading) return loading;
    const files = {};
    let last = 0;
    const report = (p) => {
      if (p.status !== 'progress' || !p.total) return;
      files[p.file + p.name] = { loaded: p.loaded, total: p.total };
      const vals = Object.values(files);
      const loaded = vals.reduce((s, f) => s + f.loaded, 0);
      const total = Math.max(EXPECTED_BYTES, vals.reduce((s, f) => s + f.total, 0));
      const ratio = Math.min(0.99, loaded / total);
      if (ratio > last) { last = ratio; onProgress(ratio); }
    };
    loading = (async () => {
      await configure();
      const dev = await device();
      const tf = T();
      const opts = (dtype) => ({ dtype, device: dev, progress_callback: report });
      const visionProc = await tf.AutoProcessor.from_pretrained(VISION);
      const vision = await tf.SiglipVisionModel.from_pretrained(VISION, opts('q4'));
      const segProc = await tf.AutoProcessor.from_pretrained(SEG, {
        config: {
          do_normalize: true, do_pad: false, do_rescale: true, do_resize: true, image_mean: [0.5, 0.5, 0.5],
          feature_extractor_type: 'ImageFeatureExtractor', image_std: [1, 1, 1], resample: 2,
          rescale_factor: 0.00392156862745098, size: { width: 1024, height: 1024 },
        },
      });
      const seg = await tf.AutoModel.from_pretrained(SEG, { ...opts('q8'), config: { model_type: 'custom' } });
      models = { visionProc, vision, segProc, seg, device: dev };
      onProgress(1);
    })();
    loading.catch(() => {}).finally(() => { loading = null; });
    return loading;
  }

  async function remove() {
    models = null;
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

  const toBlob = (c, type) => (c.convertToBlob ? c.convertToBlob({ type }) : new Promise((r) => c.toBlob(r, type)));

  async function analyze(blob, onStep = () => {}) {
    await prepare();
    if (!labels) labels = root.AiMap.decodeLabels(root.AI_LABELS);
    const bm = await createImageBitmap(blob);
    const k = Math.min(1, MAX_SIDE / Math.max(bm.width, bm.height));
    const w = Math.max(1, Math.round(bm.width * k)), h = Math.max(1, Math.round(bm.height * k));

    // 1. 向き: 4方向で「最もはっきり何かの服に見える」向きを選ぶ
    onStep(1, '向きを判定しています');
    const small = Math.min(1, 336 / Math.max(w, h));
    const sw = Math.round(w * small), sh = Math.round(h * small);
    const vecs = {}, scores = {};
    for (const deg of [0, 90, 180, 270]) {
      vecs[deg] = await embed(rotated(bm, deg, sw, sh));
      const sims = labels.groups.type.map((e) => { let s = 0; for (let i = 0; i < e.vec.length; i++) s += e.vec[i] * vecs[deg][i]; return s; });
      scores[deg] = root.AiMap.rotationScore(sims);
    }
    const rotate = root.AiMap.pickRotation(scores);

    // 2. 切り抜き(直した向きで行い、形は元の向きに戻す)
    onStep(2, '背景を切り抜いています');
    const up = rotated(bm, rotate, w, h);
    const { pixel_values } = await models.segProc(toRaw(up));
    const { output } = await models.seg({ input: pixel_values });
    const [, , mh, mw] = output.dims;
    const m = canvas(mw, mh);
    const mx = m.getContext('2d');
    const img = mx.createImageData(mw, mh);
    for (let i = 0; i < mw * mh; i++) {
      const v = output.data[i] >= 0.5 ? 255 : 0;
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
    return { rotate, mask, ranks, method: 'ai', device: models.device };
  }

  // 向きと切り抜きは変えずに、種類などの判別だけを行う(手で修正した画像に使う)
  async function classify(blob) {
    await prepare();
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
