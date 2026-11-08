// 服の種類・気分・色の定義
(function (root) {
  const CATEGORIES = [
    { id: 'top', label: 'トップス' },
    { id: 'bottom', label: 'ボトムス' },
    { id: 'dress', label: 'ワンピース' },
    { id: 'outer', label: 'アウター' },
    { id: 'shoes', label: '靴' },
    { id: 'acc', label: '小物' },
  ];

  // warmth: 1(薄手)〜5(厚手) の初期値
  // cm: 実物のおおよその大きさ。服は丈、靴・小物は長い辺(コラージュで大きさをそろえるのに使う)
  const TYPES = [
    { id: 'tshirt', cm: 70, cat: 'top', label: '半袖Tシャツ', warmth: 1, styles: ['casual', 'sporty'] },
    { id: 'polo', cm: 70, cat: 'top', label: 'ポロシャツ', warmth: 1, styles: ['casual', 'clean'] },
    { id: 'tank', cm: 62, cat: 'top', label: 'ノースリーブ', warmth: 1, styles: ['casual', 'soft'] },
    { id: 'longtee', cm: 68, cat: 'top', label: '長袖カットソー', warmth: 2, styles: ['casual', 'relax'] },
    { id: 'shirt', cm: 76, cat: 'top', label: 'シャツ', warmth: 2, styles: ['clean', 'casual'] },
    { id: 'blouse', cm: 62, cat: 'top', label: 'ブラウス', warmth: 2, styles: ['soft', 'clean'] },
    { id: 'sweat', cm: 66, cat: 'top', label: 'スウェット', warmth: 3, styles: ['casual', 'relax', 'sporty'] },
    { id: 'hoodie', cm: 70, cat: 'top', label: 'パーカー', warmth: 3, styles: ['casual', 'relax', 'sporty'] },
    { id: 'knit', cm: 66, cat: 'top', label: 'ニット', warmth: 3, styles: ['clean', 'relax', 'soft'] },
    { id: 'turtleneck', cm: 64, cat: 'top', label: 'タートルネック', warmth: 3, styles: ['clean', 'mode'] },

    { id: 'slacks', cm: 102, cat: 'bottom', label: 'スラックス', warmth: 2, styles: ['clean', 'mode'] },
    { id: 'chino', cm: 100, cat: 'bottom', label: 'チノパン', warmth: 2, styles: ['casual', 'clean'] },
    { id: 'jeans', cm: 102, cat: 'bottom', label: 'デニム', warmth: 2, styles: ['casual'], pattern: 'denim' },
    { id: 'wide', cm: 100, cat: 'bottom', label: 'ワイドパンツ', warmth: 2, styles: ['relax', 'mode', 'soft'] },
    { id: 'jogger', cm: 98, cat: 'bottom', label: 'スウェットパンツ', warmth: 2, styles: ['relax', 'sporty'] },
    { id: 'shorts', cm: 50, cat: 'bottom', label: 'ショートパンツ', warmth: 1, styles: ['casual', 'sporty'] },
    { id: 'miniskirt', cm: 42, cat: 'bottom', label: 'ミニスカート', warmth: 1, styles: ['casual', 'soft'] },
    { id: 'flareskirt', cm: 62, cat: 'bottom', label: 'ひざ丈スカート', warmth: 2, styles: ['soft', 'clean'] },
    { id: 'longskirt', cm: 88, cat: 'bottom', label: 'ロングスカート', warmth: 2, styles: ['soft', 'clean', 'relax'] },

    { id: 'dressSleeveless', cm: 100, cat: 'dress', label: 'ノースリーブワンピース', warmth: 2, styles: ['soft', 'casual'] },
    { id: 'dressShort', cm: 100, cat: 'dress', label: '半袖ワンピース', warmth: 3, styles: ['soft', 'casual'] },
    { id: 'dressLong', cm: 115, cat: 'dress', label: '長袖ワンピース', warmth: 4, styles: ['soft', 'clean'] },

    { id: 'cardigan', cm: 66, cat: 'outer', label: 'カーディガン', warmth: 2, styles: ['soft', 'relax', 'clean'] },
    { id: 'denimjk', cm: 62, cat: 'outer', label: 'デニムジャケット', warmth: 2, styles: ['casual'], pattern: 'denim' },
    { id: 'jacket', cm: 74, cat: 'outer', label: 'テーラードジャケット', warmth: 3, styles: ['clean', 'mode'] },
    { id: 'blouson', cm: 62, cat: 'outer', label: 'ブルゾン', warmth: 3, styles: ['casual', 'sporty', 'mode'] },
    { id: 'trench', cm: 110, cat: 'outer', label: 'トレンチコート', warmth: 3, styles: ['clean', 'mode'], rainOK: true },
    { id: 'coat', cm: 105, cat: 'outer', label: 'ウールコート', warmth: 4, styles: ['clean', 'mode'] },
    { id: 'down', cm: 72, cat: 'outer', label: 'ダウンジャケット', warmth: 5, styles: ['casual', 'sporty'], rainOK: true },

    { id: 'sneakers', cm: 28, cat: 'shoes', label: 'スニーカー', warmth: 0, styles: ['casual', 'sporty', 'relax'] },
    { id: 'loafers', cm: 28, cat: 'shoes', label: '革靴・ローファー', warmth: 0, styles: ['clean', 'mode'] },
    { id: 'boots', cm: 30, cat: 'shoes', label: 'ブーツ', warmth: 0, styles: ['mode', 'casual', 'clean'], rainOK: true },
    { id: 'sandals', cm: 26, cat: 'shoes', label: 'サンダル', warmth: 0, styles: ['casual', 'relax'] },
    { id: 'pumps', cm: 24, cat: 'shoes', label: 'パンプス', warmth: 0, styles: ['clean', 'soft', 'mode'] },
    { id: 'rainshoes', cm: 30, cat: 'shoes', label: 'レインシューズ', warmth: 0, styles: ['casual', 'sporty'], rainOK: true },

    { id: 'cap', cm: 25, cat: 'acc', slot: 'hat', label: 'キャップ', warmth: 0, styles: ['casual', 'sporty'] },
    { id: 'beanie', cm: 22, cat: 'acc', slot: 'hat', label: 'ニット帽', warmth: 0, styles: ['casual', 'relax'] },
    { id: 'scarf', cm: 60, cat: 'acc', slot: 'scarf', label: 'マフラー', warmth: 0, styles: ['clean', 'soft', 'casual'] },
    { id: 'bag', cm: 38, cat: 'acc', slot: 'bag', label: 'バッグ', warmth: 0, styles: ['clean', 'casual', 'soft', 'mode'] },
  ];

  const STYLES = [
    { id: 'casual', label: 'カジュアル' },
    { id: 'clean', label: 'きれいめ' },
    { id: 'relax', label: 'リラックス' },
    { id: 'sporty', label: 'スポーティ' },
    { id: 'mode', label: 'モード' },
    { id: 'soft', label: 'やわらかい' },
  ];

  const PATTERNS = [
    { id: 'plain', label: '無地' },
    { id: 'stripe', label: 'ストライプ' },
    { id: 'border', label: 'ボーダー' },
    { id: 'check', label: 'チェック' },
    { id: 'dot', label: 'ドット' },
    { id: 'floral', label: '花柄' },
    { id: 'denim', label: 'デニム地' },
  ];

  const MOODS = [
    { id: 'relax', label: 'ゆったり', note: '力を抜いて過ごしたい', styles: ['relax', 'casual'], palette: 'soft' },
    { id: 'clean', label: 'きちんと', note: '整えて出かけたい', styles: ['clean'], palette: 'neutral' },
    { id: 'bright', label: '元気に', note: '色で気分を上げたい', styles: ['casual', 'sporty'], palette: 'vivid' },
    { id: 'calm', label: '落ち着いて', note: '静かにまとめたい', styles: ['clean', 'relax'], palette: 'dark' },
    { id: 'mode', label: 'おしゃれ', note: '少し攻めてみたい', styles: ['mode'], palette: 'contrast' },
    { id: 'soft', label: 'やさしく', note: '柔らかい雰囲気で', styles: ['soft'], palette: 'pastel' },
    { id: 'active', label: '動きやすく', note: 'よく歩く・動く日に', styles: ['sporty', 'casual'], palette: 'any' },
  ];

  const COLORS = [
    { name: '白', hex: '#f7f5f0' }, { name: 'アイボリー', hex: '#ece4d2' }, { name: 'ベージュ', hex: '#d3bd9b' },
    { name: 'グレー', hex: '#a3a3a0' }, { name: 'チャコール', hex: '#4c4d50' }, { name: '黒', hex: '#26262a' },
    { name: 'ネイビー', hex: '#27365a' }, { name: '青', hex: '#3c6fb4' }, { name: '水色', hex: '#a9cbe4' },
    { name: '緑', hex: '#3f7a57' }, { name: 'カーキ', hex: '#6e6c47' }, { name: 'ミント', hex: '#b6dccb' },
    { name: '茶', hex: '#6f4a33' }, { name: 'キャメル', hex: '#b98a55' }, { name: 'テラコッタ', hex: '#b9603f' },
    { name: '赤', hex: '#bb3238' }, { name: 'ボルドー', hex: '#6d2333' }, { name: 'ピンク', hex: '#e7aebb' },
    { name: 'オレンジ', hex: '#e08a3c' }, { name: '黄', hex: '#e8c84b' }, { name: '紫', hex: '#6f5a9c' },
    { name: 'ラベンダー', hex: '#c6bbdf' },
  ];

  const typeById = Object.fromEntries(TYPES.map((t) => [t.id, t]));

  function nearestColorName(hex) {
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [r, g, b] = rgb(hex);
    let best = COLORS[0], bd = Infinity;
    for (const c of COLORS) {
      const [cr, cg, cb] = rgb(c.hex);
      const rm = (r + cr) / 2;
      const d = (2 + rm / 256) * (r - cr) ** 2 + 4 * (g - cg) ** 2 + (2 + (255 - rm) / 256) * (b - cb) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best.name;
  }

  const api = { CATEGORIES, TYPES, STYLES, PATTERNS, MOODS, COLORS, typeById, nearestColorName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Catalog = api;
})(typeof window !== 'undefined' ? window : globalThis);
