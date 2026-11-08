// 画像の手動修正(回転・左右反転・トリミング・切り抜きのブラシ)
(function (root) {
  const MAX_HISTORY = 30;
  const SIZES = { s: 12, m: 28, l: 56 }; // ブラシの太さ(画面上のpx)
  const ZOOM_MIN = 1, ZOOM_MAX = 4;
  const clone = (e) => ({ rotate: e?.rotate || 0, flip: !!e?.flip, crop: e?.crop ? { ...e.crop } : null });
  const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

  // 回転・反転にあわせてトリミングの枠も動かす(枠は変換後の画像に対する割合)
  function rotateCrop(c, deg) {
    if (!c) return null;
    if (deg === 90) return { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w };
    if (deg === 180) return { x: 1 - (c.x + c.w), y: 1 - (c.y + c.h), w: c.w, h: c.h };
    if (deg === 270) return { x: c.y, y: 1 - (c.x + c.w), w: c.h, h: c.w };
    return { ...c };
  }
  const flipCrop = (c) => (c ? { ...c, x: 1 - (c.x + c.w) } : null);

  // 指やマウスの追跡。追跡できない場合(合成した操作など)でも処理は続ける
  const capture = (el, id) => { try { el.setPointerCapture(id); } catch {} };
  let active = null; // 開いている修正画面を閉じる関数

  function open({ photo, edit, mask }) {
    if (active) active(); // 前の修正画面が残っていれば、キャンセルとして閉じる
    return new Promise(async (resolve) => {
      const img = await Photo.load(photo);
      const W = img.naturalWidth, H = img.naturalHeight;
      // 切り抜きの形は、元の写真の座標で「服=不透明、背景=透明」の画像として持つ
      const maskC = canvas(W, H);
      const mctx = maskC.getContext('2d', { willReadFrequently: true });
      if (mask) {
        const m = await Photo.load(mask);
        const tmp = canvas(W, H);
        const t = tmp.getContext('2d', { willReadFrequently: true });
        t.drawImage(m, 0, 0, W, H);
        const d = t.getImageData(0, 0, W, H);
        for (let i = 0; i < d.data.length; i += 4) { const v = d.data[i] >= 128 ? 255 : 0; d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; d.data[i + 3] = v; }
        mctx.putImageData(d, 0, 0);
      } else {
        mctx.fillStyle = '#fff';
        mctx.fillRect(0, 0, W, H);
      }
      const readMask = () => {
        const d = mctx.getImageData(0, 0, W, H).data;
        const a = new Uint8Array(W * H);
        for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
        return a;
      };
      const writeMask = (a) => {
        const d = mctx.createImageData(W, H);
        for (let i = 0; i < a.length; i++) { d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = 255; d.data[i * 4 + 3] = a[i]; }
        mctx.putImageData(d, 0, 0);
      };

      const st = { edit: clone(edit), tool: 'view', size: 'm', zoom: 1, bg: 'checker', maskDirty: false };
      const initial = { edit: clone(edit), mask: readMask() };
      let current = initial.mask;
      const past = [], future = [];

      const dlg = document.getElementById('editor') || document.body.appendChild(Object.assign(document.createElement('dialog'), { id: 'editor', className: 'editor' }));
      dlg.setAttribute('aria-labelledby', 'editor-title');
      const T = (tool, label, extra = '') => `<button type="button" class="ed-btn" data-tool="${tool}" ${extra}>${label}</button>`;
      dlg.innerHTML = `<div class="ed-head"><h2 id="editor-title">画像を修正</h2><div class="ed-head-btns">${T('cancel', 'キャンセル')}${T('save', '保存', 'data-primary')}</div></div>
        <div class="ed-stage" data-bg="checker"><div class="ed-wrap"><canvas class="ed-canvas" aria-label="修正中の画像"></canvas><div class="ed-crop-layer" hidden><div class="crop-rect">
          ${['nw', 'ne', 'sw', 'se'].map((c) => `<div class="crop-handle" data-corner="${c}" aria-hidden="true"></div>`).join('')}</div></div></div></div>
        <div class="ed-tools">
          <div class="ed-group" role="group" aria-label="向きと範囲">${T('rotate-left', '左90°')}${T('rotate-right', '右90°')}${T('flip', '左右反転')}${T('crop', 'トリミング', 'aria-pressed="false"')}</div>
          <div class="ed-group" role="group" aria-label="切り抜きの修正">${T('erase', '消す', 'aria-pressed="false"')}${T('restore', '戻す', 'aria-pressed="false"')}<span class="ed-label" aria-hidden="true">太さ</span>${T('size-s', '小', 'aria-pressed="false" aria-label="ブラシ 小"')}${T('size-m', '中', 'aria-pressed="true" aria-label="ブラシ 中"')}${T('size-l', '大', 'aria-pressed="false" aria-label="ブラシ 大"')}</div>
          <div class="ed-group" role="group" aria-label="表示">${T('zoom-out', '−', 'aria-label="縮小"')}${T('zoom-in', '+', 'aria-label="拡大"')}<span class="ed-label" aria-hidden="true">背景</span>${T('bg-checker', '市松', 'aria-pressed="true" aria-label="背景 市松模様"')}${T('bg-white', '白', 'aria-pressed="false" aria-label="背景 白"')}${T('bg-dark', '濃い色', 'aria-pressed="false" aria-label="背景 濃い色"')}</div>
          <div class="ed-group" role="group" aria-label="取り消し">${T('undo', '1つ戻す')}${T('redo', 'やり直す')}${T('reset', '最初の状態に戻す')}</div>
        </div>`;
      const $ = (s) => dlg.querySelector(s);
      const stage = $('.ed-stage'), cv = $('.ed-canvas'), cropLayer = $('.ed-crop-layer'), rect = $('.crop-rect');
      const btn = (t) => dlg.querySelector(`[data-tool="${t}"]`);

      // ---- 表示 ----
      let fit = 1, viewW = 1, viewH = 1, tw = 1, th = 1;
      function render() {
        const e = st.edit;
        const full = { rotate: e.rotate, flip: e.flip, crop: null };
        const tPhoto = Photo.transformCanvas(img, full, Infinity);
        const tMask = Photo.transformCanvas(maskC, full, Infinity, W, H, null);
        tw = tPhoto.width; th = tPhoto.height;
        const comp = canvas(tw, th);
        const cx = comp.getContext('2d');
        cx.drawImage(tMask, 0, 0);
        cx.globalCompositeOperation = 'source-in';
        cx.drawImage(tPhoto, 0, 0);
        const cropping = st.tool === 'crop';
        const c = !cropping && e.crop ? e.crop : { x: 0, y: 0, w: 1, h: 1 };
        viewW = Math.max(1, Math.round(c.w * tw));
        viewH = Math.max(1, Math.round(c.h * th));
        cv.width = viewW;
        cv.height = viewH;
        const g = cv.getContext('2d');
        if (cropping) { g.globalAlpha = 0.35; g.drawImage(tPhoto, 0, 0); g.globalAlpha = 1; }
        g.drawImage(comp, Math.round(c.x * tw), Math.round(c.y * th), viewW, viewH, 0, 0, viewW, viewH);
        const box = stage.getBoundingClientRect();
        fit = Math.min((box.width - 24) / viewW, (box.height - 24) / viewH) || 1;
        const cssW = Math.max(40, viewW * fit * st.zoom), cssH = Math.max(40, viewH * fit * st.zoom);
        cv.style.width = `${cssW}px`;
        cv.style.height = `${cssH}px`;
        cropLayer.hidden = !cropping;
        cropLayer.style.width = `${cssW}px`;
        cropLayer.style.height = `${cssH}px`;
        if (cropping) {
          const k = e.crop || { x: 0, y: 0, w: 1, h: 1 };
          Object.assign(rect.style, { left: `${k.x * 100}%`, top: `${k.y * 100}%`, width: `${k.w * 100}%`, height: `${k.h * 100}%` });
        }
        stage.dataset.rotate = String(e.rotate);
        stage.dataset.bg = st.bg;
        for (const t of ['erase', 'restore', 'crop']) btn(t).setAttribute('aria-pressed', String(st.tool === t));
        for (const s of ['s', 'm', 'l']) btn(`size-${s}`).setAttribute('aria-pressed', String(st.size === s));
        for (const b of ['checker', 'white', 'dark']) btn(`bg-${b}`).setAttribute('aria-pressed', String(st.bg === b));
        btn('undo').disabled = !past.length;
        btn('redo').disabled = !future.length;
        btn('zoom-in').disabled = st.zoom >= ZOOM_MAX;
        btn('zoom-out').disabled = st.zoom <= ZOOM_MIN;
        cv.style.cursor = st.tool === 'erase' || st.tool === 'restore' ? 'crosshair' : 'default';
      }

      // ---- 履歴 ----
      function push() {
        past.push({ edit: clone(st.edit), mask: current });
        if (past.length > MAX_HISTORY) past.shift();
        future.length = 0;
      }
      function apply(entry) {
        st.edit = clone(entry.edit);
        if (entry.mask !== current) { writeMask(entry.mask); current = entry.mask; st.maskDirty = true; }
      }
      const undo = () => { if (!past.length) return; future.push({ edit: clone(st.edit), mask: current }); apply(past.pop()); render(); };
      const redo = () => { if (!future.length) return; past.push({ edit: clone(st.edit), mask: current }); apply(future.pop()); render(); };

      // ---- 操作 ----
      // 反転した後は回転の向きが逆に見えるので、見た目どおりに回るよう符号を変える
      const rotateBy = (deg) => { push(); const d = st.edit.flip ? -deg : deg; st.edit.rotate = (st.edit.rotate + d + 360) % 360; st.edit.crop = rotateCrop(st.edit.crop, (deg + 360) % 360); render(); };
      const flip = () => { push(); st.edit.flip = !st.edit.flip; st.edit.crop = flipCrop(st.edit.crop); render(); };
      const setZoom = (z) => { st.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)); render(); };

      // 画面上の位置 → 元の写真の座標
      function toPhoto(clientX, clientY) {
        const r = cv.getBoundingClientRect();
        const fx = (clientX - r.left) / r.width, fy = (clientY - r.top) / r.height;
        const c = st.edit.crop || { x: 0, y: 0, w: 1, h: 1 };
        let x = (c.x + fx * c.w) * tw, y = (c.y + fy * c.h) * th;
        if (st.edit.flip) x = tw - x;
        switch (st.edit.rotate) {
          case 90: return [y, H - x];
          case 180: return [W - x, H - y];
          case 270: return [W - y, x];
          default: return [x, y];
        }
      }

      let drawing = null;
      const pointers = new Map();
      let pinch = null;
      function strokeTo(clientX, clientY) {
        const [x, y] = toPhoto(clientX, clientY);
        const r = cv.getBoundingClientRect();
        const radius = (SIZES[st.size] / 2) * (viewW / r.width);
        mctx.save();
        mctx.globalCompositeOperation = st.tool === 'erase' ? 'destination-out' : 'source-over';
        mctx.strokeStyle = mctx.fillStyle = '#fff';
        mctx.lineWidth = radius * 2;
        mctx.lineCap = mctx.lineJoin = 'round';
        mctx.beginPath();
        const [px, py] = drawing.last || [x, y];
        mctx.moveTo(px, py);
        mctx.lineTo(x, y);
        mctx.stroke();
        mctx.beginPath();
        mctx.arc(x, y, radius, 0, Math.PI * 2);
        mctx.fill();
        mctx.restore();
        drawing.last = [x, y];
        render();
      }
      cv.addEventListener('pointerdown', (e) => {
        pointers.set(e.pointerId, [e.clientX, e.clientY]);
        if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: st.zoom }; drawing = null; return; }
        if (st.tool !== 'erase' && st.tool !== 'restore') return;
        e.preventDefault();
        capture(cv, e.pointerId);
        push();
        drawing = { last: null };
        strokeTo(e.clientX, e.clientY);
      });
      cv.addEventListener('pointermove', (e) => {
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
        if (pinch && pointers.size === 2) { const [a, b] = [...pointers.values()]; setZoom(pinch.zoom * (Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d)); return; }
        if (drawing) strokeTo(e.clientX, e.clientY);
      });
      const endStroke = (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        if (!drawing) return;
        drawing = null;
        current = readMask();
        st.maskDirty = true;
        render();
      };
      cv.addEventListener('pointerup', endStroke);
      cv.addEventListener('pointercancel', endStroke);

      // トリミングの四隅
      let dragCrop = null;
      rect.querySelectorAll('.crop-handle').forEach((h) => {
        h.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); capture(h, e.pointerId); push(); dragCrop = { corner: h.dataset.corner }; });
        h.addEventListener('pointermove', (e) => {
          if (!dragCrop) return;
          const r = cropLayer.getBoundingClientRect();
          const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
          const c = st.edit.crop || { x: 0, y: 0, w: 1, h: 1 };
          let x1 = c.x, y1 = c.y, x2 = c.x + c.w, y2 = c.y + c.h;
          const MIN = 0.05;
          if (dragCrop.corner.includes('w')) x1 = Math.min(fx, x2 - MIN); else x2 = Math.max(fx, x1 + MIN);
          if (dragCrop.corner.includes('n')) y1 = Math.min(fy, y2 - MIN); else y2 = Math.max(fy, y1 + MIN);
          st.edit.crop = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
          render();
        });
        const end = () => {
          if (!dragCrop) return;
          dragCrop = null;
          const c = st.edit.crop;
          if (c && c.x <= 0.001 && c.y <= 0.001 && c.w >= 0.999 && c.h >= 0.999) st.edit.crop = null;
          render();
        };
        h.addEventListener('pointerup', end);
        h.addEventListener('pointercancel', end);
      });

      function maskBlob() {
        const out = canvas(W, H);
        const o = out.getContext('2d');
        o.fillStyle = '#000';
        o.fillRect(0, 0, W, H);
        o.drawImage(maskC, 0, 0);
        return Photo.toBlob(out, 'image/png');
      }

      let done = false;
      async function finish(save) {
        if (done) return;
        done = true;
        active = null;
        dlg.removeEventListener('keydown', onKey);
        let result = null;
        if (save) result = { edit: clone(st.edit), mask: mask || st.maskDirty ? await maskBlob() : null };
        if (dlg.open) dlg.close();
        dlg.innerHTML = ''; // 閉じた画面のボタンが残らないようにする
        dlg.onclick = null;
        resolve(result);
      }

      dlg.onclick = (e) => {
        const b = e.target.closest('[data-tool]');
        if (!b || b.disabled) return;
        const t = b.dataset.tool;
        if (t === 'cancel') return finish(false);
        if (t === 'save') return finish(true);
        if (t === 'rotate-left') return rotateBy(-90);
        if (t === 'rotate-right') return rotateBy(90);
        if (t === 'flip') return flip();
        if (t === 'crop' || t === 'erase' || t === 'restore') { st.tool = st.tool === t ? 'view' : t; return render(); }
        if (t.startsWith('size-')) { st.size = t.slice(5); if (st.tool !== 'erase' && st.tool !== 'restore') st.tool = 'erase'; return render(); }
        if (t.startsWith('bg-')) { st.bg = t.slice(3); return render(); }
        if (t === 'zoom-in') return setZoom(st.zoom + 0.5);
        if (t === 'zoom-out') return setZoom(st.zoom - 0.5);
        if (t === 'undo') return undo();
        if (t === 'redo') return redo();
        if (t === 'reset') { push(); apply(initial); return render(); }
      };
      function onKey(e) {
        const mod = e.metaKey || e.ctrlKey;
        if (e.key === 'Escape') { e.preventDefault(); return finish(false); }
        if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
        if (mod) return;
        if (e.key === 'r' || e.key === 'R') { e.preventDefault(); return rotateBy(e.shiftKey ? -90 : 90); }
        if (e.key === 'h' || e.key === 'H') { e.preventDefault(); return flip(); }
      }
      dlg.addEventListener('keydown', onKey);
      active = () => finish(false);
      dlg.oncancel = (e) => { e.preventDefault(); finish(false); };
      if (!dlg.open) dlg.showModal();
      requestAnimationFrame(render);
      render();
    });
  }

  root.Editor = { open, rotateCrop, flipCrop };
})(window);
