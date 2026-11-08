// 画面の制御
(function () {
  const { CATEGORIES, TYPES, STYLES, PATTERNS, MOODS, COLORS, typeById, nearestColorName } = Catalog;
  const $ = (sel, el = document) => el.querySelector(sel);
  const app = $('#app'), sheet = $('#sheet'), confirmBox = $('#confirm'), toastEl = $('#toast');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : '#a3a3a0');
  const pad2 = (v) => String(v).padStart(2, '0');
  const localDate = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const fmtDate = (iso) => { const d = new Date(`${iso}T00:00:00`); return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`; };

  const DEFAULT_PLACE = { name: '山口市', admin: '山口県', lat: 34.18333, lon: 131.46667 };
  const DEFAULT_PROFILES = {
    him: { name: '男性', adjust: 0 },
    her: { name: '女性', adjust: 0 },
  };
  const SLOTS = [
    { key: 'outer', label: 'アウター', cat: 'outer' },
    { key: 'top', label: 'トップス', cat: 'top' },
    { key: 'dress', label: 'ワンピース', cat: 'dress' },
    { key: 'bottom', label: 'ボトムス', cat: 'bottom' },
    { key: 'shoes', label: '靴', cat: 'shoes' },
    { key: 'hat', label: '帽子', cat: 'acc' },
    { key: 'scarf', label: 'マフラー', cat: 'acc' },
    { key: 'bag', label: 'バッグ', cat: 'acc' },
  ];

  const state = {
    owner: 'him', tab: 'today', profiles: DEFAULT_PROFILES, place: DEFAULT_PLACE,
    items: [], looks: [], forecast: [], forecastFetched: null, weatherError: null, weatherLoading: false,
    date: localDate(), mood: 'relax', seed: 1, proposal: null, manual: null, manualOpen: false,
    category: 'all', logMode: 'worn', urls: new Map(), queue: [], moods: {}, artMode: null,
    lockOwner: null, // この端末を使う人を固定するとき 'him' / 'her'
    aiStatus: 'none', aiAsked: false, aiProgress: null, procToken: 0, prefetch: null,
  };

  // ---- 共通部品 ----
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  function confirmDialog(message, okLabel = '削除する') {
    return new Promise((resolve) => {
      confirmBox.innerHTML = `<p>${esc(message)}</p><div class="btn-row"><button class="btn" value="no" type="button">やめる</button><button class="btn primary" value="ok" type="button">${esc(okLabel)}</button></div>`;
      confirmBox.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        confirmBox.close();
        resolve(b.value === 'ok');
      }));
      confirmBox.oncancel = () => resolve(false);
      confirmBox.showModal();
    });
  }

  function blobUrl(item, field) {
    const blob = item[field];
    if (!blob) return null;
    const key = `${item.id}:${field}`;
    if (!state.urls.has(key)) state.urls.set(key, URL.createObjectURL(blob));
    return state.urls.get(key);
  }
  function forgetUrl(id) {
    for (const field of ['thumb', 'photo', 'cutout', 'texture']) {
      const key = `${id}:${field}`;
      const u = state.urls.get(key);
      if (u) { URL.revokeObjectURL(u); state.urls.delete(key); }
    }
  }
  function picHTML(item) {
    if (item.cutoutOK && item.cutout) return `<img class="is-cut" src="${blobUrl(item, 'cutout')}" alt="" loading="lazy">`;
    const url = blobUrl(item, 'thumb');
    if (url) return `<img src="${url}" alt="" loading="lazy">`;
    return Figure.thumb(item, state.owner, Recommend.slotOf(item));
  }

  // 提案の絵: 写真コラージュ、または実物の生地で塗ったイラスト
  const textured = (it) => {
    const cat = typeById[it.type]?.cat;
    const useFabric = it.useTexture === true && ['top', 'bottom', 'dress', 'outer'].includes(cat);
    return { ...it, textureUrl: useFabric ? blobUrl(it, 'texture') : null };
  };
  const artMode = () => state.artMode || (state.items.some((i) => i.photo) ? 'collage' : 'illust');

  // aspect(幅/高さ)は、コラージュで実物の大きさの比にそろえるために使う
  function collagePiece(it) {
    const alt = esc(itemName(it));
    const slot = Recommend.slotOf(it);
    if (it.cutoutOK && it.cutout) return { kind: 'cut', aspect: it.cutW && it.cutH ? it.cutW / it.cutH : 1, html: `<img src="${blobUrl(it, 'cutout')}" alt="${alt}">` };
    if (it.photo) return { kind: 'rect', aspect: it.photoAspect || 0.75, html: `<img src="${blobUrl(it, 'photo')}" alt="${alt}">` };
    return { kind: 'draw', aspect: Figure.thumbAspect(slot, it, state.owner), html: Figure.thumb(it, state.owner, slot, { fit: true }) };
  }

  function lookArt(items, { weather, umbrella, label }) {
    if (artMode() === 'collage') {
      const icon = WEATHER_ICONS[weather] ? `<svg class="collage-weather" viewBox="0 0 48 48" aria-hidden="true">${WEATHER_ICONS[weather]}</svg>` : '';
      return Collage.render(items, { piece: collagePiece, label, extra: icon });
    }
    const look = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, textured(v)]));
    return Figure.render({ gender: state.owner, look, weather, umbrella, label });
  }
  const typeLabel = (it) => typeById[it.type]?.label || '';
  const itemName = (it) => it.name || `${it.colorName || ''}の${typeLabel(it)}`;
  const byId = (id) => state.items.find((i) => i.id === id);

  const wornLooks = () => state.looks.filter((l) => l.kind === 'worn').sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const wearInfo = () => {
    const count = {}, last = {};
    for (const l of wornLooks()) {
      for (const id of Object.values(l.items)) {
        count[id] = (count[id] || 0) + 1;
        if (!last[id] || last[id] < l.date) last[id] = l.date;
      }
    }
    return { count, last };
  };

  // ---- 天気 ----
  function weatherForDate() {
    if (state.manual) return state.manual;
    return state.forecast.find((d) => d.date === state.date) || null;
  }

  function placeKey() { return `${state.place.lat},${state.place.lon}`; }

  async function loadWeather(force) {
    const cached = await DB.getMeta('forecast', null);
    const today = localDate();
    if (cached?.place === placeKey() && cached.days?.length) {
      state.forecast = cached.days;
      state.forecastFetched = cached.fetchedAt;
      if (!force && Date.now() - cached.fetchedAt < 3 * 3600 * 1000 && cached.days.some((d) => d.date === today)) return;
    }
    state.weatherLoading = true;
    state.weatherError = null;
    if (state.tab === 'today') render();
    try {
      const days = await Weather.forecast(state.place.lat, state.place.lon);
      state.forecast = days;
      state.forecastFetched = Date.now();
      await DB.setMeta('forecast', { place: placeKey(), days, fetchedAt: state.forecastFetched });
    } catch (err) {
      console.warn(err);
      state.weatherError = '天気を取得できませんでした。通信を確認するか、気温を手入力してください。';
      if (!state.forecast.some((d) => d.date === state.date)) state.manualOpen = true;
    } finally {
      state.weatherLoading = false;
      refreshProposal();
    }
  }

  const WEATHER_ICONS = {
    sun: '<circle cx="24" cy="24" r="10" fill="#e8b84a"/><g stroke="#e8b84a" stroke-width="3" stroke-linecap="round"><path d="M24 4v6M24 38v6M4 24h6M38 24h6M10 10l4 4M34 34l4 4M38 10l-4 4M14 34l-4 4"/></g>',
    cloud: '<path d="M14 36a9 9 0 0 1-1-18 12 12 0 0 1 23 3 7.5 7.5 0 0 1-1 15Z" fill="#b5b2aa"/>',
    rain: '<path d="M14 28a8 8 0 0 1-1-16 11 11 0 0 1 21 3 6.5 6.5 0 0 1-1 13Z" fill="#94a0a8"/><g stroke="#5a84a0" stroke-width="3" stroke-linecap="round"><path d="M16 33l-2 7M25 33l-2 7M34 33l-2 7"/></g>',
    snow: '<path d="M14 28a8 8 0 0 1-1-16 11 11 0 0 1 21 3 6.5 6.5 0 0 1-1 13Z" fill="#aab3ba"/><g fill="#7fa0b8"><circle cx="16" cy="36" r="2.5"/><circle cx="25" cy="39" r="2.5"/><circle cx="33" cy="35" r="2.5"/></g>',
  };

  // ---- 提案 ----
  function context() {
    const { last } = wearInfo();
    return {
      weather: weatherForDate(), mood: state.mood, seed: state.seed, date: state.date,
      adjust: state.profiles[state.owner].adjust || 0, lastWorn: last,
    };
  }

  function refreshProposal() {
    const w = weatherForDate();
    state.proposal = w ? Recommend.recommend(state.items, context()) : null;
    if (state.tab === 'today') render();
  }

  function weatherKind(w) {
    if (w.manualKind) return w.manualKind;
    return Weather.kind(w.code);
  }

  // ---- 描画: ヘッダー ----
  function render() {
    document.body.dataset.owner = state.owner;
    const p = state.profiles;
    const tabs = [['today', '今日のコーデ'], ['closet', 'クローゼット'], ['log', '記録'], ['settings', '設定']];
    const view = { today: viewToday, closet: viewCloset, log: viewLog, settings: viewSettings }[state.tab]();
    app.innerHTML = `
      <header class="top"><div class="wrap top-inner">
        <div class="brand">Closet</div>
        ${state.lockOwner
          ? `<div class="who"><span class="who-fixed" title="この端末は${esc(p[state.lockOwner].name)}専用です(設定で変更できます)">${esc(p[state.lockOwner].name)}</span></div>`
          : `<div class="who" role="group" aria-label="使う人を選ぶ">
          ${['him', 'her'].map((o) => `<button data-act="owner" data-id="${o}" aria-pressed="${state.owner === o}">${esc(p[o].name)}</button>`).join('')}
        </div>`}
        <nav class="tabs" aria-label="メニュー">
          ${tabs.map(([id, label]) => `<button data-act="tab" data-id="${id}" ${state.tab === id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}
        </nav>
      </div></header>
      <main class="wrap">${view}</main>`;
  }

  // ---- 描画: 今日 ----
  function viewToday() {
    const p = state.profiles[state.owner];
    if (!state.items.length) {
      return `<div class="card empty">
        <h2>${esc(p.name)}のクローゼットはまだ空です</h2>
        <p class="muted">服の写真を登録すると、天気と気分に合わせたコーデを提案します。</p>
        <div class="btn-row">
          <button class="btn primary" data-act="tab" data-id="closet">写真を登録する</button>
          <button class="btn" data-act="sample">サンプルの服で試す</button>
        </div></div>`;
    }
    return `<section class="today-head">
      ${weatherCard()}
      <div class="card">
        <h2 class="section-title">今日の気分は?</h2>
        <div class="chips" role="group" aria-label="気分">
          ${MOODS.map((m) => `<button class="chip" data-act="mood" data-id="${m.id}" aria-pressed="${state.mood === m.id}">${m.label}</button>`).join('')}
        </div>
        <p class="mood-note">${esc(MOODS.find((m) => m.id === state.mood).note)}</p>
      </div>
    </section>
    ${proposalsHTML()}`;
  }

  function weatherCard() {
    const w = weatherForDate();
    const upcoming = state.forecast.filter((d) => d.date >= localDate());
    const dates = upcoming.slice(0, 7).map((d, i) => {
      const label = d.date === localDate() ? '今日' : i === 1 && upcoming[0].date === localDate() ? '明日' : fmtDate(d.date);
      return `<button class="chip" data-act="date" data-id="${d.date}" aria-pressed="${!state.manual && d.date === state.date}">${label}</button>`;
    }).join('');
    let main = '';
    if (w) {
      const kind = weatherKind(w);
      const facts = [];
      if (!state.manual) facts.push(`降水確率 ${Math.round(w.precipProb)}%`, `最大風速 ${Math.round(w.windMax)}m/s`);
      facts.push(`体感 ${Math.round(w.feelMin)}〜${Math.round(w.feelMax)}℃`);
      main = `<div class="weather-main">
          <svg class="w-icon" viewBox="0 0 48 48" aria-hidden="true">${WEATHER_ICONS[kind]}</svg>
          <div><div class="w-temp">${Math.round(w.tMax)}℃<small>/ ${Math.round(w.tMin)}℃</small></div>
          <div class="muted small">${state.manual ? '手入力の天気' : Weather.label(w.code)}</div></div>
        </div>
        <div class="w-facts">${facts.map((f) => `<span>${f}</span>`).join('')}</div>`;
    } else if (state.weatherLoading) {
      main = '<p class="muted">天気を取得しています…</p>';
    } else {
      main = '<p class="muted">この日の天気がありません。気温を手入力してください。</p>';
    }
    return `<div class="card">
      <div class="place-line">
        <span class="muted">${esc(state.place.name)}${state.place.admin ? `(${esc(state.place.admin)})` : ''}</span>
        <span><button class="linklike" data-act="tab" data-id="settings">場所を変える</button></span>
      </div>
      ${dates ? `<div class="chips dates" role="group" aria-label="日付">${dates}</div>` : ''}
      ${main}
      ${state.weatherError ? `<p class="small" style="color:var(--warn);margin:8px 0 0">${esc(state.weatherError)}</p>` : ''}
      <div class="small" style="margin-top:6px"><button class="linklike" data-act="toggle-manual" aria-expanded="${state.manualOpen}">${state.manualOpen ? '手入力を閉じる' : '気温を手入力する'}</button></div>
      ${state.manualOpen ? manualForm() : ''}
    </div>`;
  }

  function manualForm() {
    const m = state.manual || { tMax: 20, manualKind: 'sun' };
    return `<div class="manual">
      <label><span>日中の気温</span><input type="range" id="manual-temp" min="-5" max="38" value="${Math.round(m.tMax)}"><output id="manual-temp-out">${Math.round(m.tMax)}℃</output></label>
      <div class="chips" role="group" aria-label="手入力の天気">
        ${[['sun', '晴れ'], ['cloud', 'くもり'], ['rain', '雨'], ['snow', '雪']].map(([id, label]) => `<button class="chip" data-act="manual-kind" data-id="${id}" aria-pressed="${m.manualKind === id}">${label}</button>`).join('')}
      </div>
      <div class="btn-row">
        <button class="btn" data-act="manual-apply">この条件で提案</button>
        ${state.manual ? '<button class="btn" data-act="manual-clear">予報に戻す</button>' : ''}
      </div></div>`;
  }

  function proposalsHTML() {
    const pr = state.proposal;
    if (!pr) return '';
    if (!pr.looks.length) {
      const msg = pr.missing.length
        ? `コーデを組むには、${pr.missing.join('と')}の登録が必要です。`
        : '今の条件に合う組み合わせが見つかりませんでした。お休み中の服を戻すか、服を追加してください。';
      return `<div class="card empty"><h2>もう少し服を登録しましょう</h2><p class="muted">${esc(msg)}</p>
        <div class="btn-row"><button class="btn primary" data-act="tab" data-id="closet">クローゼットを開く</button></div></div>`;
    }
    const w = weatherForDate();
    const dateTitle = state.manual ? '手入力の天気' : state.date === localDate() ? '今日' : fmtDate(state.date);
    return `<div class="looks-head">
        <h2 class="section-title" style="margin:0">${esc(dateTitle)}の提案<span class="muted small" style="font-family:var(--sans);font-weight:400;margin-left:8px">体感 約${Math.round(pr.cond.feel)}℃ で計算</span></h2>
        <div class="art-switch">
          <div class="chips" role="group" aria-label="提案の見せ方">
            <button class="chip" data-act="art" data-id="collage" aria-pressed="${artMode() === 'collage'}">写真コラージュ</button>
            <button class="chip" data-act="art" data-id="illust" aria-pressed="${artMode() === 'illust'}">イラスト</button>
          </div>
          <button class="btn" data-act="reshuffle">別の提案を見る</button>
        </div>
      </div>
      <div class="looks">${pr.looks.map((l, i) => lookCard(l, i, w)).join('')}</div>`;
  }

  function lookCard(look, idx, w) {
    const kind = weatherKind(w);
    const cond = Recommend.conditions(w, state.profiles[state.owner].adjust || 0);
    const list = SLOTS.filter((s) => look.items[s.key]);
    const names = list.map((s) => itemName(look.items[s.key])).join('、');
    const art = lookArt(look.items, { weather: kind, umbrella: cond.rainy && !cond.snowy, label: `コーデ${idx + 1}: ${names}` });
    const swappable = SLOTS.filter((s) => {
      if (s.key === 'dress') return !!look.items.dress;
      if (s.key === 'top' || s.key === 'bottom') return !look.items.dress;
      return true;
    });
    const rows = swappable.map((s) => {
      const it = look.items[s.key];
      if (!it) {
        return '';
      }
      return `<button class="piece" data-act="swap" data-look="${idx}" data-slot="${s.key}">
        <span class="pic">${picHTML(it)}</span>
        <span class="piece-name">${esc(itemName(it))}<small>${s.label}</small></span>
        <span class="swap">入れ替え</span></button>`;
    }).join('');
    const addable = swappable.filter((s) => !look.items[s.key] && state.items.some((x) => Recommend.slotOf(x) === s.key));
    const adds = addable.map((s) => `<button class="chip" data-act="swap" data-look="${idx}" data-slot="${s.key}">＋ ${s.label}</button>`).join('');
    const worn = state.looks.some((l) => l.kind === 'worn' && l.date === logDate() && sameItems(l.items, look.items));
    return `<article class="look">
      <div class="look-art" style="background:${Figure.backdropColor(kind)}">${art}<span class="look-no">No.${idx + 1}</span></div>
      <div class="look-body">
        ${look.reasons.length ? `<ul class="reasons">${look.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        ${look.warnings.length ? `<ul class="warns">${look.warnings.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        ${cond.rainy ? `<ul class="warns" style="background:#e4ecf0;color:#3d5a6c"><li>${cond.snowy ? '雪の予報です。滑りにくい靴で' : '雨の予報です。傘を忘れずに'}</li></ul>` : ''}
        <div class="pieces">${rows}</div>
        ${adds ? `<div class="add-slots">${adds}</div>` : ''}
        <div class="look-actions">
          <button class="btn ${worn ? 'worn' : 'primary'}" data-act="wear" data-look="${idx}" ${worn ? 'disabled' : ''}>${worn ? '記録しました' : 'これを着る'}</button>
          <button class="btn" data-act="save-look" data-look="${idx}">保存</button>
        </div>
      </div></article>`;
  }

  const logDate = () => (state.manual ? localDate() : state.date);
  const idMap = (items) => Object.fromEntries(Object.entries(items).filter(([, v]) => v).map(([k, v]) => [k, v.id]));
  function sameItems(saved, items) {
    const a = idMap(items);
    const ka = Object.keys(a), kb = Object.keys(saved);
    return ka.length === kb.length && ka.every((k) => saved[k] === a[k]);
  }

  // ---- 描画: クローゼット ----
  function viewCloset() {
    const p = state.profiles[state.owner];
    const filters = [{ id: 'all', label: 'すべて' }, ...CATEGORIES];
    const counts = {};
    for (const it of state.items) { const c = typeById[it.type]?.cat; counts[c] = (counts[c] || 0) + 1; }
    const list = state.items.filter((it) => state.category === 'all' || typeById[it.type]?.cat === state.category)
      .sort((a, b) => b.createdAt - a.createdAt);
    const { count } = wearInfo();
    const grid = list.map((it) => `<button class="item ${it.resting ? 'resting' : ''}" data-act="edit" data-id="${esc(it.id)}">
        <div class="item-pic">${picHTML(it)}${it.resting ? '<span class="badge">お休み中</span>' : it.sample ? '<span class="badge">サンプル</span>' : ''}</div>
        <div class="item-text">
          <div class="item-name">${esc(itemName(it))}</div>
          <div class="item-sub"><span class="dot" style="background:${safeColor(it.color)}"></span>${esc(typeLabel(it))} ・ ${count[it.id] || 0}回</div>
        </div></button>`).join('');
    return `<div class="closet-head">
        <div><h1>${esc(p.name)}のクローゼット</h1><div class="muted small">${state.items.length}点を登録中(もう1人の服とは別に管理しています)</div></div>
        <div class="btn-row">
          <button class="btn primary" data-act="pick-camera">カメラで撮影</button>
          <button class="btn" data-act="pick-library">写真から追加</button>
          <button class="btn" data-act="add-blank">写真なしで追加</button>
        </div>
      </div>
      <div class="chips" role="group" aria-label="種類で絞り込む">
        ${filters.map((f) => `<button class="chip" data-act="category" data-id="${f.id}" aria-pressed="${state.category === f.id}">${f.label}${f.id !== 'all' && counts[f.id] ? ` ${counts[f.id]}` : ''}</button>`).join('')}
      </div>
      ${list.length ? `<div class="grid">${grid}</div>` : `<div class="card empty" style="margin-top:16px"><h2>まだ服がありません</h2>
        <p class="muted">無地の床や壁の前に服を広げて、服だけを撮ると、きれいに切り抜けます。</p>
        ${state.items.length ? '' : '<div class="btn-row"><button class="btn" data-act="sample">サンプルの服で試す</button></div>'}</div>`}`;
  }

  // ---- 描画: 記録 ----
  function viewLog() {
    const mode = state.logMode;
    const list = mode === 'worn' ? wornLooks() : state.looks.filter((l) => l.kind === 'saved').sort((a, b) => b.createdAt - a.createdAt);
    const cards = list.map((l) => {
      const look = {};
      for (const [slot, id] of Object.entries(l.items)) { const it = byId(id); if (it) look[slot] = it; }
      const names = SLOTS.filter((s) => look[s.key]).map((s) => itemName(look[s.key]));
      const missing = Object.keys(l.items).length - Object.keys(look).length;
      const mood = MOODS.find((m) => m.id === l.mood)?.label;
      const sub = [l.weather ? `${Math.round(l.weather.tMax)}/${Math.round(l.weather.tMin)}℃` : '', mood].filter(Boolean).join(' ・ ');
      return `<article class="log">
        <div class="log-art" style="background:${Figure.backdropColor(l.weather?.kind || 'none')}">${lookArt(look, { weather: l.weather?.kind || 'none', label: names.join('、') })}</div>
        <div><h3>${esc(fmtDate(l.date))}</h3>
          <div class="muted small">${esc(sub)}</div>
          <ul>${names.map((x) => `<li>${esc(x)}</li>`).join('')}${missing ? `<li>(削除した服 ${missing}点)</li>` : ''}</ul>
          <button class="linklike small" data-act="delete-look" data-id="${esc(l.id)}">削除</button>
        </div></article>`;
    }).join('');
    return `<div class="closet-head"><h1>記録</h1></div>
      <div class="chips" role="group" aria-label="記録の種類">
        <button class="chip" data-act="log-mode" data-id="worn" aria-pressed="${mode === 'worn'}">着た服</button>
        <button class="chip" data-act="log-mode" data-id="saved" aria-pressed="${mode === 'saved'}">保存したコーデ</button>
      </div>
      ${list.length ? `<div class="log-grid">${cards}</div>` : `<div class="card empty" style="margin-top:16px"><p class="muted">${mode === 'worn' ? '提案から「これを着る」を押すと、ここに残ります。最近着た服は、次の提案で控えめになります。' : '提案から「保存」を押すと、ここに残ります。'}</p></div>`}`;
  }

  // ---- 描画: 設定 ----
  function viewSettings() {
    const o = state.owner, p = state.profiles;
    const samples = state.items.filter((i) => i.sample).length;
    const adj = p[o].adjust || 0;
    return `<div class="settings">
      <section class="card"><h2>この端末を使う人</h2>
        <p class="small muted" style="margin:0 0 10px">スマホを1人で使うときは固定すると、もう1人の側に間違って登録することを防げます。固定はこの端末だけの設定です。</p>
        <div class="chips" role="group" aria-label="この端末を使う人">
          ${[['none', '切り替えて使う'], ['him', `${esc(p.him.name)}専用`], ['her', `${esc(p.her.name)}専用`]].map(([id, label]) => `<button class="chip" data-act="lock" data-id="${id}" aria-pressed="${(state.lockOwner || 'none') === id}">${label}</button>`).join('')}
        </div>
      </section>
      <section class="card"><h2>使う人の名前</h2>
        <div class="form-row"><label for="name-him">男性の方</label><input class="input" id="name-him" maxlength="12" value="${esc(p.him.name)}"></div>
        <div class="form-row"><label for="name-her">女性の方</label><input class="input" id="name-her" maxlength="12" value="${esc(p.her.name)}"></div>
      </section>
      <section class="card"><h2>${esc(p[o].name)}の暑がり・寒がり</h2>
        <div class="range-row"><span class="small muted">暑がり</span><input type="range" id="adjust" min="-4" max="4" step="1" value="${adj}" aria-label="暑がり・寒がりの調整"><span class="small muted">寒がり</span></div>
        <p class="small muted" id="adjust-text" style="margin:6px 0 0">${adjustText(adj)}</p>
      </section>
      <section class="card"><h2>天気を見る場所</h2>
        <p class="small" style="margin:0 0 8px">現在: ${esc(state.place.name)}${state.place.admin ? `(${esc(state.place.admin)})` : ''}</p>
        <form id="place-form" class="btn-row"><input class="input" style="flex:1;min-width:180px" id="place-q" placeholder="例: 宇部市" aria-label="市区町村名"><button class="btn" type="submit">検索</button></form>
        <div id="place-results"></div>
      </section>
      ${aiSettingsHTML()}
      <section class="card"><h2>バックアップ</h2>
        <p class="small muted" style="margin:0 0 10px">写真と記録はこのブラウザの中だけに保存され、外部には送りません。ブラウザのデータを消すと失われるので、ときどき保存してください。別の端末へ移すときにも使えます。</p>
        <div class="btn-row">
          <button class="btn" data-act="backup" data-id="${o}">${esc(p[o].name)}の分を保存</button>
          ${state.lockOwner ? '' : '<button class="btn" data-act="backup" data-id="all">2人分を保存</button>'}
          <button class="btn" data-act="restore">ファイルから復元</button>
        </div>
      </section>
      ${samples ? `<section class="card"><h2>サンプルの服</h2><p class="small muted" style="margin:0 0 10px">${esc(p[o].name)}のクローゼットにサンプルが${samples}点あります。</p><button class="btn danger" data-act="remove-samples">サンプルを削除</button></section>` : `<section class="card"><h2>サンプルの服</h2><p class="small muted" style="margin:0 0 10px">操作を試すための服を、${esc(p[o].name)}のクローゼットに追加できます。あとでまとめて削除できます。</p><button class="btn" data-act="sample">サンプルを追加</button></section>`}
    </div>`;
  }

  function aiSettingsHTML() {
    const st = state.aiStatus;
    let body;
    if (state.aiProgress !== null) {
      body = `<p class="small" style="margin:0 0 8px" role="status">AIを準備しています ${Math.round(state.aiProgress * 100)}%</p>${progressBar(state.aiProgress)}`;
    } else if (st === 'ready') {
      body = `<p class="small" style="margin:0 0 10px">準備済み${state.aiSize ? `(${state.aiSize}MB)` : ''}。写真の向き・背景の切り抜き・種類などの判別を、この端末の中で行います。</p>
        <button class="btn danger" data-act="ai-remove">AIを削除</button>`;
    } else if (st === 'unsupported') {
      body = '<p class="small muted" style="margin:0">このブラウザでは使えません。簡易の切り抜きと手での入力で登録できます。</p>';
    } else {
      body = `<p class="small muted" style="margin:0 0 10px">写真の向きと背景の切り抜きを自動で直し、種類・色・柄などを判別して入力します。写真は外部に送りません。初回だけ約110MBを取得します。</p>
        <button class="btn" data-act="ai-prepare">AIを準備する</button>`;
    }
    return `<section class="card"><h2>写真のAI</h2>${body}</section>`;
  }

  const progressBar = (r) => `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(r * 100)}"><span style="width:${Math.round(r * 100)}%"></span></div>`;

  function adjustText(v) {
    if (!v) return '標準(予報の体感温度のまま)';
    return v > 0 ? `寒がり: 予報より${v}℃低く感じる前提で提案します` : `暑がり: 予報より${-v}℃高く感じる前提で提案します`;
  }

  // ---- 服の登録・編集 ----
  function newDraft(fromPhoto) {
    const defaultType = 'tshirt';
    const t = typeById[defaultType];
    return {
      id: uid(), owner: state.owner, createdAt: Date.now(), type: defaultType, name: '',
      color: fromPhoto?.color ? safeColor(fromPhoto.color) : '#a3a3a0', pattern: 'plain', warmth: t.warmth, styles: [...t.styles],
      rainOK: false, resting: false, photo: fromPhoto?.photo || null, thumb: fromPhoto?.thumb || null, isNew: true,
      cutout: fromPhoto?.cutout || null, cutoutOK: !!fromPhoto?.cutoutOK, cutoutLevel: fromPhoto?.cutoutLevel || 'normal',
      cutW: fromPhoto?.cutW || 0, cutH: fromPhoto?.cutH || 0, texture: fromPhoto?.texture || null,
      analyzed: fromPhoto?.analyzed || 0, useTexture: false,
      edit: fromPhoto?.edit || { ...Photo.NO_EDIT }, mask: fromPhoto?.mask || null, ai: fromPhoto?.ai || null, touched: [],
    };
  }

  const CHECK_FIELDS = ['type', 'pattern', 'warmth', 'styles'];

  // 写真1枚を処理する。AIが準備済みならAI、だめなら自作の切り抜き
  async function processPhoto(file, onStep = () => {}) {
    const photo = await Photo.normalize(file);
    if (state.aiStatus === 'ready') {
      try {
        const r = await Ai.analyze(photo, onStep);
        const edit = { ...Photo.NO_EDIT, rotate: r.rotate };
        const composed = await Photo.compose(photo, { edit, mask: r.mask });
        const values = AiMap.toFormValues(r.ranks);
        return {
          photo, ...composed, mask: r.mask, edit, cutoutLevel: 'ai', analyzed: 1, values,
          ai: { version: 1, method: 'ai', typeTop: values.typeTop, patternTop: r.ranks.pattern.slice(0, 3).map((x) => ({ pattern: x.id, score: x.score })), confident: values.confident },
          notice: { rotated: r.rotate !== 0, text: 'AIで切り抜きました' },
        };
      } catch (err) {
        console.warn(err);
        const fb = await Photo.reanalyze(photo, 'normal');
        return { photo, ...fb, ai: { version: 1, method: 'fallback' }, notice: { text: 'AIが使えないため、簡易の切り抜きで登録します' } };
      }
    }
    onStep(2, '背景を切り抜いています');
    const fb = await Photo.reanalyze(photo, 'normal');
    return { photo, ...fb, ai: { version: 1, method: 'fallback' }, notice: { text: 'AIを使わず、簡易の切り抜きで登録します(AIは設定から準備できます)' } };
  }

  function draftFromResult(result) {
    let d = newDraft(result);
    d.notice = result.notice || null;
    d.unsure = [];
    if (result.values) {
      d = mergeTypeDefaults(d, result.values);
      d.unsure = CHECK_FIELDS.filter((f) => !result.values.confident[f]);
    }
    return d;
  }

  function mergeTypeDefaults(d, values) {
    const out = AiMap.mergeIntoDraft(d, { ...values, color: d.color }, d.touched || []);
    out.notice = d.notice;
    out.unsure = d.unsure;
    return out;
  }

  function showProgress(text, ratio = null) {
    sheet.innerHTML = `<div class="sheet-head"><h2 id="sheet-title">写真を読み込んでいます</h2><button class="close" data-act="close-sheet" aria-label="閉じる">×</button></div>
      <div class="sheet-body proc"><p role="status">${esc(text)}</p>${ratio === null ? '<div class="progress busy"><span></span></div>' : progressBar(ratio)}</div>`;
    if (!sheet.open) sheet.showModal();
  }

  function askPrepare() {
    return new Promise((resolve) => {
      confirmBox.innerHTML = `<p><strong>AIを準備します(約110MB・初回だけ)</strong></p>
        <p class="small muted">写真の向きと背景の切り抜きを自動で直し、種類・色・柄などを判別して入力します。写真は外部に送りません。Wi-Fiでの準備をおすすめします。</p>
        <div class="btn-row"><button class="btn" type="button" data-act="ai-later">あとで</button><button class="btn primary" type="button" data-act="ai-prepare">準備する</button></div>`;
      confirmBox.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { confirmBox.close(); resolve(b.dataset.act === 'ai-prepare' ? 'prepare' : 'later'); }));
      confirmBox.oncancel = () => resolve('later');
      confirmBox.showModal();
    });
  }

  async function prepareAi(onProgress) {
    await Ai.prepare(onProgress);
    state.aiStatus = await Ai.status();
    state.aiSize = await Ai.sizeMB().catch(() => 0);
  }

  let draft = null;
  let draftUrls = [];
  const draftUrl = (blob) => { const u = URL.createObjectURL(blob); draftUrls.push(u); return u; };
  function clearDraftUrls() { draftUrls.forEach((u) => URL.revokeObjectURL(u)); draftUrls = []; }

  function openItemForm(item) {
    clearDraftUrls();
    draft = { ...item, touched: [...(item.touched || [])], unsure: [...(item.unsure || [])], edit: item.edit || { ...Photo.NO_EDIT } };
    const groups = CATEGORIES.map((c) => `<optgroup label="${c.label}">${TYPES.filter((t) => t.cat === c.id).map((t) => `<option value="${t.id}" ${draft.type === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}</optgroup>`).join('');
    const remaining = state.queue.length;
    sheet.innerHTML = `<div class="sheet-head"><h2 id="sheet-title">${draft.isNew ? '服を登録' : '服を編集'}${remaining ? `(あと${remaining}枚)` : ''}</h2><button class="close" data-act="close-sheet" aria-label="閉じる">×</button></div>
      <form class="sheet-body item-form" id="item-form">
        ${draft.notice ? `<p class="ai-note" id="ai-note" role="status">${draft.notice.rotated ? '向きを直しました <button type="button" class="linklike" data-act="undo-rotate">元に戻す</button>。' : ''}${esc(draft.notice.text || '')}</p>` : ''}
        <div class="preview">
          ${draft.photo ? `<div class="preview-box checker" id="cut-preview"></div>
          <div class="chips cut-levels" role="group" aria-label="背景の切り抜き">
            ${[...(state.aiStatus === 'ready' ? [['ai', 'AIで切り抜き直す']] : []), ['normal', '簡易 標準'], ['gentle', '弱め'], ['strong', '強め'], ['off', '写真のまま']].map(([id, label]) => `<button type="button" class="chip" data-level="${id}" aria-pressed="false">${label}</button>`).join('')}
          </div>
          <p class="cut-note" id="cut-note" hidden></p>
          <button type="button" class="btn" data-act="open-editor">画像を修正</button>` : ''}
          <div class="preview-box" id="illust-preview" aria-label="イラストでの見え方"></div>
          <div class="small muted" style="text-align:center">イラスト表示ではこの色と形で描きます</div>
          <label class="check small" id="f-fabric-row" hidden><input type="checkbox" id="f-fabric" ${draft.useTexture === true ? 'checked' : ''}> イラストに実物の柄を使う(細かい柄の服向け)</label>
        </div>
        <div>
          <div class="form-row"><label for="f-type">種類 ${checkBadge('type')}</label><select class="input" id="f-type">${groups}</select>
            ${candidatesHTML()}</div>
          <div class="form-row"><label for="f-name">名前(空欄なら色と種類から自動で付けます)</label><input class="input" id="f-name" maxlength="40" value="${esc(draft.name)}"></div>
          <div class="form-row"><span class="label">色${draft.photo && draft.isNew ? '(写真から判定しました。違えば選び直してください)' : ''}</span>
            <div class="swatches" id="f-colors">
              ${COLORS.map((c) => `<button type="button" class="swatch" data-color="${c.hex}" style="background:${c.hex}" title="${c.name}" aria-label="${c.name}" aria-pressed="false"></button>`).join('')}
              <input type="color" class="color-input" id="f-color" value="${safeColor(draft.color)}" aria-label="色を自由に選ぶ">
            </div>
          </div>
          <div class="form-row"><span class="label">柄 ${checkBadge('pattern')}</span>
            <div class="chips" id="f-patterns">${PATTERNS.map((x) => `<button type="button" class="chip" data-pattern="${x.id}" aria-pressed="${draft.pattern === x.id}">${x.label}</button>`).join('')}</div>
          </div>
          <div class="form-row"><label for="f-warmth">厚さ・暖かさ: <span id="f-warmth-text"></span> ${checkBadge('warmth')}</label>
            <input type="range" id="f-warmth" min="0" max="5" step="1" value="${draft.warmth}" style="accent-color:var(--accent)"></div>
          <div class="form-row"><span class="label">テイスト(気分との相性に使います) ${checkBadge('styles')}</span>
            <div class="chips" id="f-styles">${STYLES.map((x) => `<button type="button" class="chip" data-style="${x.id}" aria-pressed="${draft.styles.includes(x.id)}">${x.label}</button>`).join('')}</div>
          </div>
          <label class="check"><input type="checkbox" id="f-rain" ${draft.rainOK ? 'checked' : ''}> 雨でも使いやすい</label>
          <label class="check"><input type="checkbox" id="f-rest" ${draft.resting ? 'checked' : ''}> お休み中(洗濯・クリーニングなど。提案に出さない)</label>
          <div class="form-actions" style="margin-top:14px">
            ${draft.isNew ? '<span></span>' : '<button type="button" class="btn danger" data-act="delete-item">削除</button>'}
            <div class="btn-row">
              <span class="need-check-note" id="need-check" hidden>確認が必要な項目があります</span>
              ${remaining ? '<button type="button" class="btn" data-act="skip-photo">この写真を飛ばす</button>' : ''}
              <button type="submit" class="btn primary">${remaining ? '保存して次へ' : '保存'}</button>
            </div>
          </div>
        </div>
      </form>`;
    updateCutPreview();
    updateForm();
    refreshChecks();
    if (!sheet.open) sheet.showModal();
  }

  const checkBadge = (f) => `<span class="need-check" data-check="${f}" hidden>確認してください</span>`;

  function candidatesHTML() {
    const top = draft.ai?.typeTop;
    if (!top || top.length < 2 || !draft.isNew) return '';
    return `<div class="cands" role="group" aria-label="ほかの候補"><span class="small muted">ほかの候補:</span>
      ${top.slice(1, 3).map((c) => typeById[c.type] ? `<button type="button" class="chip cand" data-cand="${c.type}" aria-pressed="${draft.type === c.type}">${typeById[c.type].label}</button>` : '').join('')}</div>`;
  }

  function refreshChecks() {
    const unsure = draft?.unsure || [];
    sheet.querySelectorAll('[data-check]').forEach((el) => { el.hidden = !unsure.includes(el.dataset.check); });
    const note = $('#need-check');
    if (note) note.hidden = !unsure.length;
  }

  // 利用者が手で変えた項目を記録し、あとでAIが上書きしないようにする
  function touch(field) {
    if (!draft) return;
    if (!draft.touched.includes(field)) draft.touched.push(field);
    draft.unsure = (draft.unsure || []).filter((f) => f !== field);
    refreshChecks();
  }

  function updateCutPreview() {
    const box = $('#cut-preview');
    if (!box) return;
    const cut = draft.cutoutOK && draft.cutout;
    box.innerHTML = `<img src="${draftUrl(cut ? draft.cutout : draft.thumb || draft.photo)}" alt="コラージュでの見え方">`;
    box.dataset.rotate = String(draft.edit?.rotate || 0);
    sheet.querySelectorAll('[data-level]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === (draft.cutoutLevel || 'normal'))));
    const note = $('#cut-note');
    const failed = !cut && draft.cutoutLevel !== 'off';
    note.hidden = !failed;
    note.textContent = failed ? 'うまく切り抜けなかったので、写真のまま使います。無地の床や壁の前で服だけを撮ると、きれいに切り抜けます。白っぽい服は濃い色の布の上がおすすめです。' : '';
    const row = $('#f-fabric-row');
    if (row) row.hidden = !draft.texture;
  }

  async function changeCutLevel(level) {
    if (!draft?.photo) return;
    if (level === 'ai') return redoWithAi();
    const id = draft.id;
    const result = await Photo.reanalyze(draft.photo, level, draft.edit);
    if (draft?.id !== id) return;
    const { color, ...rest } = result;
    Object.assign(draft, rest);
    if (draft.isNew && !draft.touched.includes('color') && color) draft.color = safeColor(color);
    updateCutPreview();
    updateForm();
  }

  // 編集画面の「AIで切り抜き直す」。登録済みの服は、画像だけを作り直す
  async function redoWithAi() {
    const id = draft.id;
    const note = $('#ai-note') || Object.assign(document.createElement('p'), { id: 'ai-note', className: 'ai-note' });
    if (!note.isConnected) $('#item-form').prepend(note);
    note.textContent = 'AIで処理しています…';
    try {
      const r = await Ai.analyze(draft.photo, (step, label) => { note.textContent = `${step}/3 ${label}`; });
      if (draft?.id !== id) return;
      const untouched = !draft.edit || (draft.edit.rotate === 0 && !draft.edit.flip && !draft.edit.crop);
      const edit = untouched ? { ...Photo.NO_EDIT, rotate: r.rotate } : draft.edit;
      const { color, ...composed } = await Photo.compose(draft.photo, { edit, mask: r.mask });
      Object.assign(draft, composed, { mask: r.mask, edit, cutoutLevel: 'ai', analyzed: 1 });
      const values = AiMap.toFormValues(r.ranks);
      draft.ai = { version: 1, method: 'ai', typeTop: values.typeTop, confident: values.confident };
      if (draft.isNew) {
        Object.assign(draft, mergeTypeDefaults(draft, values));
        if (!draft.touched.includes('color')) draft.color = safeColor(color);
        draft.unsure = CHECK_FIELDS.filter((f) => !values.confident[f] && !draft.touched.includes(f));
      }
      draft.notice = { rotated: untouched && r.rotate !== 0, text: 'AIで切り抜きました' };
    } catch (err) {
      console.warn(err);
      draft.notice = { text: 'AIが使えないため、切り抜きは変えていません' };
    }
    openItemForm(draft);
  }

  // 手動の修正画面。保存したら書き出し直し、色と(手で選んでいなければ)種類を判定し直す
  async function editImage() {
    if (!draft?.photo) return;
    const id = draft.id;
    const r = await Editor.open({ photo: draft.photo, edit: draft.edit, mask: draft.mask });
    if (!r || draft?.id !== id) return;
    const { color, ...composed } = await Photo.compose(draft.photo, { edit: r.edit, mask: r.mask });
    if (draft?.id !== id) return;
    Object.assign(draft, composed, { edit: r.edit, mask: r.mask, cutoutLevel: 'manual' });
    if (!draft.touched.includes('color')) draft.color = safeColor(color);
    // 登録済みの服は、以前の版で手で変えた記録がないことがあるため、種類などは変えない
    if (state.aiStatus === 'ready' && draft.isNew && !draft.touched.includes('type')) {
      try {
        const img = await Photo.transform(draft.photo, r.edit, 1000);
        const ranks = await Ai.classify(await Photo.toBlob(img, 'image/jpeg', 0.9));
        if (draft?.id !== id) return;
        const values = AiMap.toFormValues(ranks);
        Object.assign(draft, mergeTypeDefaults(draft, values));
        draft.ai = { ...(draft.ai || {}), version: 1, method: 'ai', typeTop: values.typeTop, confident: values.confident };
        draft.unsure = CHECK_FIELDS.filter((f) => !values.confident[f] && !draft.touched.includes(f));
      } catch (err) { console.warn(err); }
    }
    draft.notice = { text: '画像を修正しました' };
    openItemForm(draft);
  }

  async function undoRotate() {
    const id = draft.id;
    const edit = { ...draft.edit, rotate: 0 };
    const { color, ...composed } = await Photo.compose(draft.photo, { edit, mask: draft.mask });
    if (draft?.id !== id) return;
    Object.assign(draft, composed, { edit });
    if (draft.isNew && !draft.touched.includes('color')) draft.color = safeColor(color);
    draft.notice = { ...draft.notice, rotated: false };
    openItemForm(draft);
  }

  function updateForm() {
    const fabric = draft.useTexture === true && draft.texture ? draftUrl(draft.texture) : null;
    $('#illust-preview').innerHTML = Figure.thumb({ ...draft, textureUrl: fabric }, state.owner, Recommend.slotOf(draft));
    const text = draft.warmth >= 5 ? 'とても厚手' : ['なし(靴・小物)', '薄手', 'やや薄手', '普通', 'やや厚手'][draft.warmth];
    $('#f-warmth-text').textContent = text;
    sheet.querySelectorAll('[data-color]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === draft.color)));
    $('#f-color').value = safeColor(draft.color);
  }

  function onTypeChange(type) {
    const prev = typeById[draft.type], t = typeById[type];
    draft.type = type;
    // 初期値のままの項目だけ、新しい種類の初期値に合わせる
    if (draft.warmth === prev.warmth) draft.warmth = t.warmth;
    if (sameList(draft.styles, prev.styles)) draft.styles = [...t.styles];
    if (draft.rainOK === !!prev.rainOK) draft.rainOK = !!t.rainOK;
    if (t.pattern && draft.pattern === 'plain') draft.pattern = t.pattern;
    if (!t.pattern && prev.pattern && draft.pattern === prev.pattern) draft.pattern = 'plain';
    $('#f-warmth').value = draft.warmth;
    $('#f-rain').checked = draft.rainOK;
    sheet.querySelectorAll('[data-style]').forEach((b) => b.setAttribute('aria-pressed', String(draft.styles.includes(b.dataset.style))));
    sheet.querySelectorAll('[data-pattern]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pattern === draft.pattern)));
    updateForm();
  }
  const sameList = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

  function closeSheet() {
    state.procToken++;
    state.prefetch = null;
    clearDraftUrls();
    if (sheet.open) sheet.close();
    draft = null;
    state.queue = [];
  }

  async function saveDraft() {
    if (state.saving || !draft) return; // 二重に押しても1回だけ保存する
    state.saving = true;
    try { await saveDraftOnce(); } finally { state.saving = false; }
  }

  async function saveDraftOnce() {
    const item = { ...draft, name: $('#f-name').value.trim(), colorName: nearestColorName(safeColor(draft.color)) };
    item.color = safeColor(item.color);
    item.rainOK = $('#f-rain').checked;
    item.resting = $('#f-rest').checked;
    const fabric = $('#f-fabric');
    if (fabric) item.useTexture = fabric.checked;
    const isNew = item.isNew;
    delete item.isNew;
    delete item.colorTouched;
    delete item.unsure;
    delete item.notice;
    delete item.values;
    await DB.put('items', item);
    forgetUrl(item.id);
    const idx = state.items.findIndex((i) => i.id === item.id);
    if (idx >= 0) state.items[idx] = item; else state.items.push(item);
    toast(`${itemName(item)}を${isNew ? '登録' : '更新'}しました`);
    afterItemsChanged();
    await nextQueuedOrClose();
  }

  async function nextQueuedOrClose() {
    const next = state.queue.shift();
    if (!next) { closeSheet(); return; }
    const pre = state.prefetch && state.prefetch.file === next && state.prefetch.owner === state.owner ? state.prefetch.promise : null;
    state.prefetch = null;
    await openPhoto(next, pre);
  }

  // 表示中の写真を入力している間に、次の写真を裏で処理しておく(Worker で動くときだけ)
  function startPrefetch() {
    if (!state.queue.length || state.prefetch || !Ai.usesWorker()) return;
    const file = state.queue[0];
    const promise = processPhoto(file);
    promise.catch(() => {});
    state.prefetch = { file, owner: state.owner, promise };
  }

  async function openPhoto(file, pre = null) {
    const token = ++state.procToken;
    const owner = state.owner;
    try {
      showProgress(pre ? '次の写真を準備しています' : '写真を読み込んでいます');
      const result = await (pre || processPhoto(file, (step, label) => { if (token === state.procToken) showProgress(`${step}/3 ${label}`); }));
      if (token !== state.procToken || owner !== state.owner) return; // 閉じた、または人を切り替えた
      openItemForm(draftFromResult(result));
      startPrefetch();
    } catch (err) {
      console.warn(err);
      if (token !== state.procToken) return;
      toast('この写真は読み込めませんでした');
      await nextQueuedOrClose();
    }
  }

  async function addPhotos(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/') || !f.type);
    if (!list.length) return;
    state.aiStatus = await Ai.status();
    if (state.aiStatus === 'none' && !state.aiAsked) {
      state.aiAsked = true;
      if ((await askPrepare()) === 'prepare') {
        try {
          showProgress('AIを準備しています 0%', 0);
          await prepareAi((r) => showProgress(`AIを準備しています ${Math.round(r * 100)}%`, r));
        } catch (err) {
          console.warn(err);
          state.aiStatus = 'failed';
        }
      }
    }
    state.queue = list.slice(1);
    state.prefetch = null;
    await openPhoto(list[0]);
    if (state.aiStatus === 'failed') state.aiStatus = await Ai.status();
  }

  function afterItemsChanged() {
    refreshProposal();
    if (state.tab !== 'today') render();
  }

  // ---- 入れ替え ----
  function openSwap(lookIdx, slotKey) {
    const look = state.proposal.looks[lookIdx];
    const slot = SLOTS.find((s) => s.key === slotKey);
    const list = state.items.filter((it) => Recommend.slotOf(it) === slotKey);
    const ctx = context();
    const cond = Recommend.conditions(ctx.weather, ctx.adjust);
    const scored = list.map((it) => {
      const trial = { ...look.items, [slotKey]: it };
      return { it, s: Recommend.evaluate(trial, ctx).score, ng: Recommend.hardNG(it, cond) };
    }).sort((a, b) => (a.ng - b.ng) || (b.s - a.s));
    const optional = !['top', 'bottom', 'dress'].includes(slotKey);
    sheet.innerHTML = `<div class="sheet-head"><h2 id="sheet-title">${slot.label}を選ぶ</h2><button class="close" data-act="close-sheet" aria-label="閉じる">×</button></div>
      <div class="sheet-body">
        <p class="small muted choice-note">合わせやすい順に並べています。</p>
        <div class="choices">
          ${optional ? `<button class="item" data-act="swap-pick" data-look="${lookIdx}" data-slot="${slotKey}" data-id=""><div class="item-pic choice-none">なし</div><div class="item-text"><div class="item-name">合わせない</div></div></button>` : ''}
          ${scored.map(({ it, ng }) => `<button class="item ${it.resting ? 'resting' : ''}" data-act="swap-pick" data-look="${lookIdx}" data-slot="${slotKey}" data-id="${esc(it.id)}">
            <div class="item-pic">${picHTML(it)}${it.resting ? '<span class="badge">お休み中</span>' : ng ? '<span class="badge">気温に合わない</span>' : ''}</div>
            <div class="item-text"><div class="item-name">${esc(itemName(it))}</div><div class="item-sub">${esc(typeLabel(it))}</div></div></button>`).join('')}
        </div>
      </div>`;
    if (!sheet.open) sheet.showModal();
  }

  function applySwap(lookIdx, slotKey, id) {
    const look = state.proposal.looks[lookIdx];
    const items = { ...look.items };
    if (id) items[slotKey] = byId(id); else delete items[slotKey];
    const ev = Recommend.evaluate(items, context());
    state.proposal.looks[lookIdx] = { items, score: ev.score, reasons: ev.reasons, warnings: ev.warnings };
    closeSheet();
    render();
  }

  // ---- コーデの保存 ----
  async function storeLook(idx, kind) {
    const look = state.proposal.looks[idx];
    const w = weatherForDate();
    const rec = {
      id: uid(), owner: state.owner, kind, date: logDate(), createdAt: Date.now(), mood: state.mood,
      items: idMap(look.items),
      weather: { tMax: w.tMax, tMin: w.tMin, kind: weatherKind(w) },
    };
    await DB.put('looks', rec);
    state.looks.push(rec);
    toast(kind === 'worn' ? `${fmtDate(rec.date)}のコーデとして記録しました` : 'コーデを保存しました');
    render();
  }

  // ---- サンプル ----
  async function addSamples() {
    const now = Date.now();
    let i = 0;
    for (const [type, name, color, pattern] of Samples[state.owner]) {
      const t = typeById[type];
      const item = {
        id: uid(), owner: state.owner, createdAt: now - i++, type, name, color, colorName: nearestColorName(color),
        pattern: pattern || t.pattern || 'plain', warmth: t.warmth, styles: [...t.styles], rainOK: !!t.rainOK, resting: false,
        photo: null, thumb: null, sample: true,
      };
      await DB.put('items', item);
      state.items.push(item);
    }
    toast('サンプルの服を追加しました');
    state.tab = 'today';
    refreshProposal();
  }

  async function removeSamples() {
    const list = state.items.filter((i) => i.sample);
    for (const it of list) await DB.remove('items', it.id);
    state.items = state.items.filter((i) => !i.sample);
    toast('サンプルを削除しました');
    afterItemsChanged();
    render();
  }

  // ---- バックアップ ----
  async function backup(scope) {
    toast('バックアップを作成しています…');
    const items = (await DB.all('items')).filter((i) => scope === 'all' || i.owner === scope);
    const looks = (await DB.all('looks')).filter((l) => scope === 'all' || l.owner === scope);
    const outItems = [];
    for (const it of items) {
      const copy = { ...it };
      copy.photo = it.photo ? await Photo.blobToDataURL(it.photo) : null;
      copy.thumb = it.thumb ? await Photo.blobToDataURL(it.thumb) : null;
      copy.cutout = it.cutout ? await Photo.blobToDataURL(it.cutout) : null;
      copy.texture = it.texture ? await Photo.blobToDataURL(it.texture) : null;
      copy.mask = it.mask ? await Photo.blobToDataURL(it.mask) : null;
      outItems.push(copy);
    }
    const data = { app: 'closet', version: 1, exportedAt: new Date().toISOString(), scope, profiles: state.profiles, items: outItems, looks };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `closet-${scope === 'all' ? 'all' : scope}-${localDate()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`${outItems.length}点をバックアップしました`);
  }

  const OWNER_OK = (o) => o === 'him' || o === 'her';
  const TOUCH_FIELDS = ['type', 'color', 'pattern', 'warmth', 'styles', 'rainOK'];
  const CUT_LEVELS = ['ai', 'manual', 'normal', 'gentle', 'strong', 'off'];
  const unit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

  // バックアップの修正内容を検証する。不正なら「修正なし」
  function safeEdit(e) {
    const rotate = [0, 90, 180, 270].includes(e?.rotate) ? e.rotate : 0;
    const flip = e?.flip === true;
    const c = e?.crop;
    const crop = c && unit(c.x) && unit(c.y) && unit(c.w) && unit(c.h) && c.w > 0 && c.h > 0 && c.x + c.w <= 1.0001 && c.y + c.h <= 1.0001 ? { x: c.x, y: c.y, w: c.w, h: c.h } : null;
    return { rotate, flip, crop };
  }

  function safeAi(a) {
    if (!a || typeof a !== 'object') return null;
    const score = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
    return {
      version: Number(a.version) || 1,
      method: a.method === 'ai' ? 'ai' : 'fallback',
      typeTop: Array.isArray(a.typeTop) ? a.typeTop.filter((t) => typeById[t?.type]).slice(0, 3).map((t) => ({ type: t.type, score: score(t.score) })) : [],
    };
  }

  const pngOnly = (url) => (/^data:image\/png;base64,/.test(url || '') ? Photo.dataURLToBlob(url) : null);

  async function restore(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch { toast('ファイルを読み込めませんでした'); return; }
    if (data?.app !== 'closet' || !Array.isArray(data.items)) { toast('このアプリのバックアップではありません'); return; }
    const ok = await confirmDialog(describeBackup(data), '取り込む');
    if (!ok) return;
    const existing = new Set((await DB.all('items')).map((i) => i.id));
    const result = { him: { added: 0, updated: 0, looks: 0 }, her: { added: 0, updated: 0, looks: 0 }, skipped: 0 };
    for (const raw of data.items) {
      if (!OWNER_OK(raw.owner) || !typeById[raw.type] || typeof raw.id !== 'string') { result.skipped++; continue; }
      result[raw.owner][existing.has(raw.id) ? 'updated' : 'added']++;
      await DB.put('items', {
        id: raw.id, owner: raw.owner, createdAt: Number(raw.createdAt) || Date.now(), type: raw.type,
        name: String(raw.name || '').slice(0, 40), color: safeColor(raw.color), colorName: nearestColorName(safeColor(raw.color)),
        pattern: PATTERNS.some((p) => p.id === raw.pattern) ? raw.pattern : 'plain',
        warmth: Math.min(5, Math.max(0, Number(raw.warmth) || 0)),
        styles: Array.isArray(raw.styles) ? raw.styles.filter((s) => STYLES.some((x) => x.id === s)) : [],
        rainOK: !!raw.rainOK, resting: !!raw.resting, sample: !!raw.sample,
        photo: await Photo.dataURLToBlob(raw.photo), thumb: await Photo.dataURLToBlob(raw.thumb),
        cutout: await Photo.dataURLToBlob(raw.cutout), texture: await Photo.dataURLToBlob(raw.texture),
        cutoutOK: !!raw.cutoutOK, cutoutLevel: CUT_LEVELS.includes(raw.cutoutLevel) ? raw.cutoutLevel : 'normal',
        cutW: Number(raw.cutW) || 0, cutH: Number(raw.cutH) || 0, photoAspect: Number(raw.photoAspect) > 0.1 && Number(raw.photoAspect) < 10 ? Number(raw.photoAspect) : 0, analyzed: raw.analyzed ? 1 : 0, useTexture: raw.useTexture === true,
        edit: safeEdit(raw.edit), mask: await pngOnly(raw.mask), ai: safeAi(raw.ai),
        touched: Array.isArray(raw.touched) ? raw.touched.filter((f) => TOUCH_FIELDS.includes(f)) : [],
      });
      forgetUrl(raw.id);
    }
    for (const raw of Array.isArray(data.looks) ? data.looks : []) {
      if (!OWNER_OK(raw.owner) || typeof raw.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date) || typeof raw.items !== 'object' || !raw.items) continue;
      const kind = raw.kind === 'saved' ? 'saved' : 'worn';
      result[raw.owner].looks++;
      await DB.put('looks', {
        id: raw.id, owner: raw.owner, kind, date: raw.date, createdAt: Number(raw.createdAt) || Date.now(),
        mood: MOODS.some((m) => m.id === raw.mood) ? raw.mood : null,
        items: Object.fromEntries(Object.entries(raw.items).filter(([k, v]) => SLOTS.some((s) => s.key === k) && typeof v === 'string')),
        weather: raw.weather ? { tMax: Number(raw.weather.tMax) || 0, tMin: Number(raw.weather.tMin) || 0, kind: ['sun', 'cloud', 'rain', 'snow'].includes(raw.weather.kind) ? raw.weather.kind : 'none' } : null,
      });
    }
    await loadOwner();
    refreshProposal();
    render();
    await showImportResult(result);
  }

  // 取り込む前の確認: だれの分か、いつ保存したか、何点あるか
  function describeBackup(data) {
    const who = data.scope === 'him' || data.scope === 'her' ? `${state.profiles[data.scope].name}の分` : data.scope === 'all' ? '2人分' : 'バックアップ';
    const d = new Date(data.exportedAt || '');
    const when = Number.isNaN(d.getTime()) ? '' : `(${d.getMonth() + 1}/${d.getDate()}に保存)`;
    const looks = Array.isArray(data.looks) ? data.looks : [];
    const lines = ['him', 'her'].map((o) => {
      const items = data.items.filter((i) => i?.owner === o).length;
      const ls = looks.filter((l) => l?.owner === o).length;
      return items || ls ? `${state.profiles[o].name}: 服${items}点・記録${ls}件` : '';
    }).filter(Boolean);
    return `${who}${when}を取り込みます。${lines.join(' / ')}。同じ服は、ファイルの内容で上書きされます。`;
  }

  function showImportResult(r) {
    return new Promise((resolve) => {
      const line = (o) => {
        const x = r[o];
        if (!x.added && !x.updated && !x.looks) return '';
        const parts = [x.added ? `新しく${x.added}点` : '', x.updated ? `更新${x.updated}点` : '', x.looks ? `記録${x.looks}件` : ''].filter(Boolean);
        return `<li>${esc(state.profiles[o].name)}: ${parts.join('・')}</li>`;
      };
      const lines = ['him', 'her'].map(line).filter(Boolean).join('') || '<li>取り込める服はありませんでした</li>';
      confirmBox.innerHTML = `<p><strong>取り込みました</strong></p><ul class="import-result">${lines}${r.skipped ? `<li class="muted">読み込めなかった服 ${r.skipped}点</li>` : ''}</ul>
        <div class="btn-row"><button class="btn primary" type="button">閉じる</button></div>`;
      confirmBox.querySelector('button').addEventListener('click', () => { confirmBox.close(); resolve(); });
      confirmBox.oncancel = () => resolve();
      confirmBox.showModal();
    });
  }

  // ---- 切り替え ----
  async function loadOwner() {
    state.items = await DB.byOwner('items', state.owner);
    state.looks = await DB.byOwner('looks', state.owner);
    for (const key of [...state.urls.keys()]) { URL.revokeObjectURL(state.urls.get(key)); state.urls.delete(key); }
    migratePhotos(state.owner);
  }

  // 以前の版で登録した写真から、切り抜きと生地を作る(色は変えない)
  async function migratePhotos(owner) {
    const todo = state.items.filter((i) => i.photo && !i.analyzed);
    if (!todo.length) return;
    toast('登録済みの写真を切り抜いています…');
    for (const it of todo) {
      let result = { analyzed: 1, cutoutOK: false };
      try {
        const { color, ...rest } = await Photo.reanalyze(it.photo, 'normal');
        result = rest;
      } catch (err) { console.warn(err); }
      const updated = { ...it, ...result };
      await DB.put('items', updated);
      if (state.owner !== owner) return;
      const idx = state.items.findIndex((x) => x.id === it.id);
      if (idx >= 0) state.items[idx] = updated;
    }
    refreshProposal();
    render();
  }

  async function switchOwner(owner) {
    if (owner === state.owner || (state.lockOwner && owner !== state.lockOwner)) return;
    state.moods[state.owner] = state.mood;
    // 処理中・入力中の写真は、元の人の分として扱わない
    if (sheet.open) closeSheet(); else { state.procToken++; state.prefetch = null; state.queue = []; }
    state.owner = owner;
    state.mood = state.moods[owner] || 'relax';
    await DB.setMeta('owner', owner);
    await loadOwner();
    state.seed = 1;
    refreshProposal();
    render();
  }

  // ---- イベント ----
  document.addEventListener('click', async (e) => {
    if (e.target === sheet) { closeSheet(); return; }
    const el = e.target.closest('[data-act], [data-color], [data-pattern], [data-style], [data-level], [data-cand]');
    if (!el) return;
    if (el.dataset.level) { await changeCutLevel(el.dataset.level); return; }
    if (el.dataset.color) { draft.color = el.dataset.color; touch('color'); updateForm(); return; }
    if (el.dataset.cand) {
      const t = el.dataset.cand;
      $('#f-type').value = t;
      onTypeChange(t);
      touch('type');
      sheet.querySelectorAll('.cand').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cand === t)));
      return;
    }
    if (el.dataset.pattern) {
      draft.pattern = el.dataset.pattern;
      touch('pattern');
      sheet.querySelectorAll('[data-pattern]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      updateForm();
      return;
    }
    if (el.dataset.style) {
      const s = el.dataset.style;
      draft.styles = draft.styles.includes(s) ? draft.styles.filter((x) => x !== s) : [...draft.styles, s];
      touch('styles');
      el.setAttribute('aria-pressed', String(draft.styles.includes(s)));
      return;
    }
    const { act, id } = el.dataset;
    const look = Number(el.dataset.look);
    switch (act) {
      case 'owner': await switchOwner(id); break;
      case 'lock': {
        const lock = id === 'him' || id === 'her' ? id : null;
        if (lock && lock !== state.owner) await switchOwner(lock);
        state.lockOwner = lock;
        await DB.setMeta('lockOwner', lock);
        toast(lock ? `この端末を${state.profiles[lock].name}専用にしました` : '切り替えて使えるようにしました');
        render();
        break;
      }
      case 'tab':
        state.tab = id;
        render();
        window.scrollTo(0, 0);
        break;
      case 'mood': state.mood = id; state.seed = 1; refreshProposal(); break;
      case 'date': state.date = id; state.manual = null; state.seed = 1; refreshProposal(); break;
      case 'reshuffle': state.seed += 1; refreshProposal(); break;
      case 'art': state.artMode = id; await DB.setMeta('artMode', id); render(); break;
      case 'toggle-manual': state.manualOpen = !state.manualOpen; render(); break;
      case 'manual-kind': {
        const temp = Number($('#manual-temp').value);
        state.manualDraftKind = id;
        applyManual(temp, id);
        break;
      }
      case 'manual-apply': applyManual(Number($('#manual-temp').value), state.manual?.manualKind || state.manualDraftKind || 'sun'); break;
      case 'manual-clear': state.manual = null; refreshProposal(); break;
      case 'swap': openSwap(look, el.dataset.slot); break;
      case 'swap-pick': applySwap(look, el.dataset.slot, id); break;
      case 'wear': await storeLook(look, 'worn'); break;
      case 'save-look': await storeLook(look, 'saved'); break;
      case 'category': state.category = id; render(); break;
      case 'log-mode': state.logMode = id; render(); break;
      case 'pick-camera': $('#file-camera').click(); break;
      case 'pick-library': $('#file-library').click(); break;
      case 'add-blank': openItemForm(newDraft()); break;
      case 'edit': openItemForm(byId(id)); break;
      case 'close-sheet': closeSheet(); break;
      case 'undo-rotate': await undoRotate(); break;
      case 'open-editor': await editImage(); break;
      case 'ai-prepare':
        if (el.closest('#confirm')) break; // 登録時の確認ダイアログは askPrepare で扱う
        state.aiProgress = 0;
        render();
        try {
          let shown = -1;
          await prepareAi((r) => { const pct = Math.round(r * 100); if (pct !== shown) { shown = pct; state.aiProgress = r; if (state.tab === 'settings') render(); } });
          toast('AIを準備しました');
        } catch (err) {
          console.warn(err);
          toast('AIを準備できませんでした。通信を確認してください');
        }
        state.aiProgress = null;
        render();
        break;
      case 'ai-remove':
        if (!(await confirmDialog('AIのモデルをこの端末から削除します。次に使うときは、もう一度取得が必要です。'))) return;
        await Ai.remove();
        state.aiStatus = await Ai.status();
        render();
        break;
      case 'skip-photo':
        if (state.saving) break;
        state.saving = true;
        try { await nextQueuedOrClose(); } finally { state.saving = false; }
        break;
      case 'delete-item': {
        const it = draft;
        const q = state.queue;
        if (!(await confirmDialog(`「${itemName(it)}」を削除します。記録からも消えます。`))) return;
        state.queue = q;
        await DB.remove('items', it.id);
        forgetUrl(it.id);
        state.items = state.items.filter((x) => x.id !== it.id);
        closeSheet();
        toast('削除しました');
        afterItemsChanged();
        break;
      }
      case 'delete-look':
        if (!(await confirmDialog('この記録を削除します。'))) return;
        await DB.remove('looks', id);
        state.looks = state.looks.filter((l) => l.id !== id);
        render();
        refreshProposal();
        break;
      case 'sample': await addSamples(); break;
      case 'remove-samples':
        if (await confirmDialog('サンプルの服をすべて削除します。')) await removeSamples();
        break;
      case 'backup': await backup(id); break;
      case 'restore': $('#file-backup').click(); break;
      case 'pick-place': await setPlace(JSON.parse(el.dataset.place)); break;
    }
  });

  function applyManual(temp, kind) {
    const rain = kind === 'rain' || kind === 'snow';
    state.manual = {
      tMax: temp, tMin: temp - 6, feelMax: temp, feelMin: temp - 6, precipProb: rain ? 90 : 0, precipSum: rain ? 5 : 0,
      windMax: 2, code: kind === 'snow' ? 73 : rain ? 63 : kind === 'cloud' ? 3 : 1, manualKind: kind,
    };
    state.seed = 1;
    refreshProposal();
  }

  async function setPlace(place) {
    state.place = place;
    await DB.setMeta('place', place);
    state.forecast = [];
    state.date = localDate();
    toast(`${place.name}の天気を使います`);
    render();
    await loadWeather(true);
    render();
  }

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'manual-temp') $('#manual-temp-out').textContent = `${t.value}℃`;
    if (t.id === 'f-warmth') { draft.warmth = Number(t.value); touch('warmth'); updateForm(); }
    if (t.id === 'f-name' && draft) draft.name = t.value;
    if (t.id === 'f-color') { draft.color = t.value; touch('color'); updateForm(); }
    if (t.id === 'adjust') $('#adjust-text').textContent = adjustText(Number(t.value));
  });

  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'f-type') { onTypeChange(t.value); touch('type'); sheet.querySelectorAll('.cand').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cand === t.value))); }
    if (t.id === 'f-rain') { draft.rainOK = t.checked; touch('rainOK'); }
    if (t.id === 'f-rest' && draft) draft.resting = t.checked;
    if (t.id === 'f-fabric') { draft.useTexture = t.checked; updateForm(); }
    if (t.id === 'file-camera' || t.id === 'file-library') {
      const files = [...t.files];
      t.value = '';
      if (state.tab !== 'closet') { state.tab = 'closet'; render(); }
      await addPhotos(files);
    }
    if (t.id === 'file-backup') {
      const f = t.files[0];
      t.value = '';
      if (f) await restore(f);
    }
    if (t.id === 'adjust') {
      state.profiles = { ...state.profiles, [state.owner]: { ...state.profiles[state.owner], adjust: Number(t.value) } };
      await DB.setMeta('profiles', state.profiles);
      refreshProposal();
    }
    if (t.id === 'name-him' || t.id === 'name-her') {
      const who = t.id.slice(5);
      state.profiles = { ...state.profiles, [who]: { ...state.profiles[who], name: t.value.trim() || DEFAULT_PROFILES[who].name } };
      await DB.setMeta('profiles', state.profiles);
      render();
    }
  });

  document.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (e.target.id === 'item-form') {
      await saveDraft();
    } else if (e.target.id === 'place-form') {
      const q = $('#place-q').value.trim();
      const box = $('#place-results');
      if (!q) return;
      box.innerHTML = '<p class="small muted">検索中…</p>';
      try {
        const results = await Weather.searchPlace(q);
        box.innerHTML = results.length
          ? results.map((r) => `<button class="search-result" data-act="pick-place" data-place="${esc(JSON.stringify(r))}">${esc(r.name)}<span class="muted small"> ${esc(r.admin)}</span></button>`).join('')
          : '<p class="small muted">見つかりませんでした。「宇部市」のように市区町村名で試してください。</p>';
      } catch {
        box.innerHTML = '<p class="small" style="color:var(--warn)">検索できませんでした。通信を確認してください。</p>';
      }
    }
  });

  sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });

  // ---- 起動 ----
  async function start() {
    state.owner = await DB.getMeta('owner', 'him');
    state.lockOwner = await DB.getMeta('lockOwner', null);
    if (state.lockOwner === 'him' || state.lockOwner === 'her') state.owner = state.lockOwner; else state.lockOwner = null;
    state.place = await DB.getMeta('place', DEFAULT_PLACE);
    state.artMode = await DB.getMeta('artMode', null);
    const saved = await DB.getMeta('profiles', null);
    if (saved) state.profiles = { him: { ...DEFAULT_PROFILES.him, ...saved.him }, her: { ...DEFAULT_PROFILES.her, ...saved.her } };
    await loadOwner();
    state.aiStatus = await Ai.status().catch(() => 'unsupported');
    if (state.aiStatus === 'ready') state.aiSize = await Ai.sizeMB().catch(() => 0);
    render();
    await loadWeather(false);
    refreshProposal();
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  start().catch((err) => {
    console.error(err);
    app.innerHTML = `<div class="wrap" style="padding:40px 20px"><div class="card"><h2>起動できませんでした</h2><p>このブラウザではデータを保存できないようです。プライベートブラウズを解除するか、別のブラウザで開いてください。</p></div></div>`;
  });
})();
