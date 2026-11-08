// 画面から使うAIの窓口。http では Web Worker、file:// では画面側で動かす
(function (root) {
  let worker = null;
  let local = null;
  let seq = 0;
  const pending = new Map();

  function startWorker() {
    if (worker || local || location.protocol === 'file:' || typeof Worker === 'undefined') return worker;
    try {
      worker = new Worker('js/ai-worker.js');
      worker.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        if (e.data.kind === 'progress') p.onProgress?.(e.data);
        else { pending.delete(e.data.id); e.data.kind === 'done' ? p.resolve(e.data.result) : p.reject(new Error(e.data.message)); }
      };
      worker.onerror = () => { worker = null; };
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

  async function call(kind, payload, onProgress) {
    if (startWorker()) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject, onProgress });
        worker.postMessage({ id, kind, payload });
      });
    }
    const core = await useLocal();
    if (kind === 'prepare') return core.prepare((ratio) => onProgress?.({ ratio }));
    if (kind === 'analyze') return core.analyze(payload.blob, (step, label) => onProgress?.({ step, label }));
    if (kind === 'classify') return core.classify(payload.blob);
    if (kind === 'remove') return core.remove();
    if (kind === 'status') return core.status();
    if (kind === 'size') return core.sizeMB();
    throw new Error(kind);
  }

  // 状態の確認は、AIの部品を読み込まずに保存先だけを見る
  const status = () => root.AiCache.status().catch(() => 'unsupported');

  root.Ai = {
    status,
    prepare: (onProgress = () => {}) => call('prepare', null, (p) => onProgress(p.ratio)),
    analyze: (blob, onStep = () => {}) => call('analyze', { blob }, (p) => onStep(p.step, p.label)),
    classify: (blob) => call('classify', { blob }),
    remove: async () => {
      await call('remove');
      if (worker) { worker.terminate(); worker = null; }
    },
    sizeMB: () => call('size'),
    usesWorker: () => !!startWorker(),
  };
})(window);
