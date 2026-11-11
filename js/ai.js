// 画面から使うAIの窓口。http では Web Worker、file:// では画面側で動かす
(function (root) {
  let worker = null;
  let local = null;
  let seq = 0;
  const pending = new Map();
  const SLOW_KINDS = ['analyze', 'classify']; // 時間の上限を付ける処理

  // 計算部分が落ちたとき・止めたとき: 待っている処理をすべて失敗にして、次は作り直す
  function dropWorker(message, code) {
    const w = worker;
    worker = null;
    try { w?.terminate(); } catch {}
    for (const [id, p] of pending) { pending.delete(id); clearTimeout(p.timer); p.reject(Object.assign(new Error(message), { code })); }
  }

  function startWorker() {
    if (worker || local || location.protocol === 'file:' || typeof Worker === 'undefined') return worker;
    try {
      const w = new Worker('js/ai-worker.js');
      w.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        if (e.data.kind === 'progress') p.onProgress?.(e.data);
        else { pending.delete(e.data.id); clearTimeout(p.timer); e.data.kind === 'done' ? p.resolve(e.data.result) : p.reject(new Error(e.data.message)); }
      };
      w.onerror = (e) => { e?.preventDefault?.(); if (worker === w) dropWorker('AIの計算が止まりました', 'crash'); };
      worker = w;
    } catch { worker = null; }
    return worker;
  }

  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`${src} を読み込めませんでした`));
    document.head.appendChild(s);
  });

  async function useLocal() {
    if (!local) {
      local = (async () => {
        if (!root.Transformers) await loadScript('vendor/transformers/transformers.iife.js');
        if (!root.AI_LABELS) await loadScript('data/labels.js');
        if (!root.AiCore) await loadScript('js/ai-core.js');
        return root.AiCore;
      })();
    }
    return local;
  }

  const timeoutError = () => Object.assign(new Error(`${Math.round(api.timeoutMs / 1000)}秒以内に終わらなかったため、処理を止めました(時間の上限)`), { code: 'timeout' });

  async function call(kind, payload = {}, onProgress) {
    payload = { ...payload, mode: api.mode };
    if (startWorker()) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        const p = { resolve, reject, onProgress, timer: null };
        // 上限を超えたら計算部分ごと止める(止めないと裏で動き続けてメモリを使う)
        if (SLOW_KINDS.includes(kind)) p.timer = setTimeout(() => { if (pending.has(id)) dropWorker(timeoutError().message, 'timeout'); }, api.timeoutMs);
        pending.set(id, p);
        worker.postMessage({ id, kind, payload });
      });
    }
    const core = await useLocal();
    const run = () => {
      if (kind === 'prepare') return core.prepare(payload.mode, (ratio) => onProgress?.({ ratio }));
      if (kind === 'analyze') return core.analyze(payload.blob, payload.mode, (step, label) => onProgress?.({ step, label }));
      if (kind === 'classify') return core.classify(payload.blob, payload.mode);
      if (kind === 'remove') return core.remove();
      if (kind === 'size') return core.sizeMB();
      throw new Error(kind);
    };
    if (!SLOW_KINDS.includes(kind)) return run();
    // 画面側で動かすときは止められないが、待つのはやめて次に進む
    let timer;
    return Promise.race([run(), new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError()), api.timeoutMs); })]).finally(() => clearTimeout(timer));
  }

  const api = {
    mode: 'high', // 'light' または 'high'。アプリが端末に合わせて決める
    timeoutMs: 60000,
    // 状態の確認は、AIの部品を読み込まずに保存先だけを見る
    status: () => root.AiCache.status(api.mode).catch(() => 'unsupported'),
    prepare: (onProgress = () => {}) => call('prepare', {}, (p) => onProgress(p.ratio)),
    analyze: (blob, onStep = () => {}) => call('analyze', { blob }, (p) => onStep(p.step, p.label)),
    classify: (blob) => call('classify', { blob }),
    remove: async () => {
      await call('remove');
      if (worker) dropWorker('AIを削除しました', 'removed');
    },
    sizeMB: () => call('size'),
    usesWorker: () => !!startWorker(),
  };
  root.Ai = api;
})(window);
