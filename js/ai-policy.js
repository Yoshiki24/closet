// 写真のAIの動かし方を決める(画面に依存しない)。重い端末で止まらないようにするための決まり
(function (root) {
  const VISION = ['Marqo/marqo-fashionSigLIP', 'onnx/vision_model_q4.onnx'];
  const SEG = {
    light: ['BritishWerewolf/U-2-Netp', 'onnx/model.onnx'], // 4.6MB・Apache-2.0。軽いが、服と背景の色が近い写真は苦手
    high: ['briaai/RMBG-1.4', 'onnx/model_quantized.onnx'], // 44MB・非商用。きれいだが重い
  };
  const MB = { light: 66, high: 106 };
  const SKIP_ROTATION = 0.5; // 軽量モードで、0°の自信がこれ以上なら残り3方向を調べない
  const LIGHT_FAILURE_LIMIT = 2; // 軽量モードでこの回数止まった端末ではAIを止める
  const STEPS = ['AIの読み込み', '向きの判定', '背景の切り抜き', '種類の判別'];

  function isMobile(nav = {}) {
    if (nav.userAgentData && typeof nav.userAgentData.mobile === 'boolean' && nav.userAgentData.mobile) return true;
    const ua = String(nav.userAgent || '');
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
    return /Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1; // パソコン表示の iPad
  }

  const effectiveMode = (setting, env) => (setting === 'light' || setting === 'high' ? setting : env.mobile ? 'light' : 'high');
  const requiredFiles = (mode) => [VISION, SEG[mode] || SEG.high];
  const downloadMB = (mode) => MB[mode] || MB.high;
  // 切り抜きは WebGPU でも速くならず、メモリだけが増える(Mac 実測)ので常に WASM
  const devices = (mode, hasGpu) => ({ vision: mode === 'high' && hasGpu ? 'webgpu' : 'wasm', seg: 'wasm' });

  function afterFailure({ mode, lightFailures = 0 }) {
    if (mode !== 'light') return { setting: 'light', lightFailures, blocked: false };
    const n = lightFailures + 1;
    return { setting: 'light', lightFailures: n, blocked: n >= LIGHT_FAILURE_LIMIT };
  }

  const skipRotation = (score0, mode) => mode === 'light' && score0 >= SKIP_ROTATION;

  function parseInflight(text) {
    try {
      const v = JSON.parse(text);
      if (!v || ![0, 1, 2, 3].includes(v.step) || !['light', 'high'].includes(v.mode)) return null;
      return v;
    } catch { return null; }
  }

  const stepLabel = (step) => STEPS[step] || '処理';

  // 端末に重すぎた兆候か(時間切れ・計算部分の停止・アプリが閉じた)。ほかのエラーでは軽くしない
  const isOverload = (err) => !!err && ['timeout', 'crash', 'closed'].includes(err.code);

  const api = { isOverload, isMobile, effectiveMode, requiredFiles, downloadMB, devices, afterFailure, skipRotation, parseInflight, stepLabel, SEG, VISION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AiPolicy = api;
})(typeof self !== 'undefined' ? self : globalThis);
