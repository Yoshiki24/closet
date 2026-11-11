// AIの計算を画面とは別に動かす(http で開いたとき)
importScripts('../vendor/transformers/transformers.iife.js', '../data/labels.js', 'catalog.js', 'ai-map.js', 'ai-policy.js', 'ai-cache.js', 'ai-core.js');

let chain = Promise.resolve();
self.onmessage = (e) => {
  const { id, kind, payload } = e.data;
  const run = async () => {
    try {
      let result;
      if (kind === 'prepare') result = await AiCore.prepare(payload.mode, (ratio) => self.postMessage({ id, kind: 'progress', ratio }));
      else if (kind === 'analyze') result = await AiCore.analyze(payload.blob, payload.mode, (step, label) => self.postMessage({ id, kind: 'progress', step, label }));
      else if (kind === 'classify') result = await AiCore.classify(payload.blob, payload.mode);
      else if (kind === 'remove') result = await AiCore.remove();
      else if (kind === 'status') result = await AiCore.status(payload.mode);
      else if (kind === 'size') result = await AiCore.sizeMB();
      self.postMessage({ id, kind: 'done', result });
    } catch (err) {
      self.postMessage({ id, kind: 'error', message: String(err?.message || err) });
    }
  };
  // 準備・状態の確認は待たせず、推論は1枚ずつ順番に行う
  if (kind === 'analyze' || kind === 'classify') chain = chain.then(run); else run();
};
