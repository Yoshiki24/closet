// 天気(Open-Meteo: APIキー不要)
(function (root) {
  const LABELS = {
    0: '快晴', 1: '晴れ', 2: '晴れ時々くもり', 3: 'くもり', 45: '霧', 48: '霧', 51: '弱い霧雨', 53: '霧雨', 55: '強い霧雨',
    56: '着氷性の霧雨', 57: '着氷性の霧雨', 61: '小雨', 63: '雨', 65: '強い雨', 66: '着氷性の雨', 67: '着氷性の雨',
    71: '小雪', 73: '雪', 75: '大雪', 77: '雪', 80: 'にわか雨', 81: 'にわか雨', 82: '激しいにわか雨',
    85: 'にわか雪', 86: '強いにわか雪', 95: '雷雨', 96: '雷雨', 99: '激しい雷雨',
  };

  function kind(code) {
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
    if (code <= 1) return 'sun';
    return 'cloud';
  }

  async function forecast(lat, lon) {
    const q = new URLSearchParams({
      latitude: lat, longitude: lon, timezone: 'auto', forecast_days: 7, wind_speed_unit: 'ms',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max',
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
    if (!res.ok) throw new Error(`天気を取得できませんでした(${res.status})`);
    const d = (await res.json()).daily;
    return d.time.map((date, i) => ({
      date,
      code: d.weather_code[i],
      tMax: d.temperature_2m_max[i],
      tMin: d.temperature_2m_min[i],
      feelMax: d.apparent_temperature_max[i],
      feelMin: d.apparent_temperature_min[i],
      precipProb: d.precipitation_probability_max[i] ?? 0,
      precipSum: d.precipitation_sum[i] ?? 0,
      windMax: d.wind_speed_10m_max[i] ?? 0,
    }));
  }

  // 日本語の短い地名(宇部・東京など)はそのままだと見つからないことがあるので、市・都などを補って探す
  async function searchPlace(name) {
    const tryNames = [name];
    if (!/[市区町村都府県]$/.test(name) && /[^\x00-\x7F]/.test(name)) tryNames.push(`${name}市`, `${name}都`, `${name}府`, `${name}県`);
    const found = new Map();
    for (const q of tryNames) {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=6&language=ja&name=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('場所を検索できませんでした');
      const { results = [] } = await res.json();
      for (const r of results) found.set(r.id, r);
      if ([...found.values()].some((r) => r.country_code === 'JP')) break;
    }
    return [...found.values()]
      .sort((a, b) => (b.country_code === 'JP') - (a.country_code === 'JP'))
      .map((r) => ({ name: r.name, admin: r.admin1 || r.country || '', lat: r.latitude, lon: r.longitude }));
  }

  root.Weather = { forecast, searchPlace, kind, label: (code) => LABELS[code] || '—' };
})(window);
