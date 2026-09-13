/* =====================================================================
 * LotGo-like 版式抽卡引擎
 * 纯函数：(参数, 种子) -> 元素列表 -> DOM
 * 同样的参数 + 同样的种子 = 同一张图，所以「上一张 / 下一张」只存种子即可。
 * ===================================================================== */

/* ---------- 1. 种子随机数 ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  constructor(seed) { this.seed = seed >>> 0; this._f = mulberry32(this.seed); }
  next() { return this._f(); }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  /* 从数组里不重复抽 n 个 */
  sample(arr, n) { return this.shuffle(arr).slice(0, n); }
}

/* ---------- 2. 设计资产：色板 / 字体 / 文案池 ---------- */

const PALETTES = [
  { name: '牛皮纸', bg: '#d9c5a6', ink: '#2b2521', sub: '#6d5c47', accent: '#b0431d' },
  { name: '深林绿', bg: '#1d3b31', ink: '#e9e3d5', sub: '#8ea99b', accent: '#d9c5a6' },
  { name: '天空蓝', bg: '#8dbde2', ink: '#13202d', sub: '#3a5a75', accent: '#1a1a1a' },
  { name: '纸白',   bg: '#f2efe9', ink: '#16151a', sub: '#8b8981', accent: '#c3352a' },
  { name: '墨黑',   bg: '#111113', ink: '#f0ede6', sub: '#78766f', accent: '#37d195' },
  { name: '胭脂',   bg: '#e7dad2', ink: '#33201c', sub: '#8b6a60', accent: '#9b2a2a' },
  { name: '灰蓝',   bg: '#c3c8c9', ink: '#1f2426', sub: '#5f686a', accent: '#2f4858' },
  { name: '暖沙',   bg: '#e8dcc8', ink: '#25211c', sub: '#7b7062', accent: '#3f5d45' },
  { name: '夜青',   bg: '#16202b', ink: '#e4e8ea', sub: '#7b8b98', accent: '#e0a43c' },
];

const FONTS = {
  song:     { cjk: '"Songti SC","SimSun","Noto Serif SC",serif',                 lat: '"Times New Roman",Georgia,serif' },
  hei:      { cjk: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif', lat: 'Helvetica,Arial,sans-serif' },
  kai:      { cjk: '"Kaiti SC","STKaiti","KaiTi",serif',                         lat: 'Georgia,"Times New Roman",serif' },
  fangsong: { cjk: '"FangSong","STFangsong","Songti SC",serif',                  lat: 'Georgia,serif' },
  mono:     { cjk: '"PingFang SC",sans-serif',                                   lat: '"SF Mono",Menlo,Consolas,monospace' },
};

const COPY = {
  latTitle: ['VOID', 'SERENDIPITY', 'MARGIN', 'PROOF', 'DRIFT', 'ORDER', 'ECHO', 'GRAIN',
             'SLOW', 'INDEX', 'FOLD', 'TRACE', 'QUIET', 'BLANK', 'LAYER', 'STILL',
             'FIELD', 'MUTE', 'RE-READ', 'AFTERIMAGE'],
  latSub:   ['THOUGHT · EPIPHANY', 'MARGIN METHOD', 'LIGHT SHADOW SPACE', 'KEEP THIS PAGE',
             'NEW PAGE EACH CLICK', 'A QUIET STRUCTURE', 'NOTES ON WHITE SPACE',
             'ONE MORE DRAW', 'SET IN SILENCE', 'VOID IS ALSO VOICE'],
  cjkTitle: ['留白', '会排', '迁想妙得', '秩序与偶然', '无题', '光影之间', '负责点亮',
             '山高水长', '见字如面', '一期一会', '空山新雨', '观其大略', '纸上得来',
             '版式实验', '不必打稿'],
  cjkSub:   ['在结构中发现偶然', '你不用负责设计，你只负责点亮', '手指负责开抽，灵感负责登场',
             '网格换，字型换，图片重新排', '像盲盒，下一抽更好', '一条安静的线托住页面',
             '图片分块就出来了', '不用画框，不用打稿'],
  prose: [
    'The tool does not decide for you.\nIt gives you a beginning.\nThe rest is yours.',
    'Chance is not loss of control.\nIn order, something accidental\nkeeps growing.',
    '页面自己会排，\n不必费心，\n它自会交代。',
    'Each draw makes one world.\nThe page gives itself away.',
    '一行标题落在哪里，\n不必想半天，\n抽一次就知道了。',
  ],
  micro: ['LOTGO', 'FIG. 4', 'PLATE 02', 'NO.', 'SPECIMEN', 'DRAW', 'v1.10', 'PROOF',
          'TYPE / GRID / CHANCE', 'FOR DEMO ONLY'],
};

/* ---------- 3. 排版工具：让标题正好撑满栏宽 ---------- */
/* 这是整套东西「看起来像设计过」的关键：
   字号不是拍脑袋写死的，而是由「栏宽 ÷ 字数」反解出来的。 */
const ADV = { lat: 0.62, cjk: 1.0 };   // 没有 canvas 时的兜底估算（em/字）

function isCJK(s) { return /[㐀-鿿　-〿]/.test(s); }

let _mctx = null;
function measureAt100(text, fontCSS, weight = 400) {
  if (typeof document === 'undefined') return null;
  _mctx = _mctx || document.createElement('canvas').getContext('2d');
  _mctx.font = `${weight} 100px ${fontCSS}`;
  return _mctx.measureText(text).width / 100;   // 单位 em
}

/* 反解字号：让这行字（含字距）正好占满 boxW。
   CSS 的 letter-spacing 每个字后面都加一份，所以是 n 份不是 n-1 份。 */
function fitFontSize(text, boxW, tracking = 0, fontCSS = null, weight = 400) {
  const n = Math.max(1, [...text].length);
  let em = fontCSS ? measureAt100(text, fontCSS, weight) : null;
  if (!em) em = n * (isCJK(text) ? ADV.cjk : ADV.lat);
  return (boxW * 0.995) / (em + tracking * n);
}

/* ---------- 4. 骨架（版式母题） ----------
 * 每个母题把画框切成几个有名字的盒子，后面的内容按名字往里放。
 * 这一层等价于面板上的「网格与结构」。 */
const ARCHETYPES = {
  topHeavy(f, r) {
    const a = r.range(0.30, 0.44);
    const b = r.range(0.28, 0.40);
    return {
      hero: { x: f.x, y: f.y, w: f.w, h: f.h * a },
      body: { x: f.x, y: f.y + f.h * a, w: f.w, h: f.h * b },
      foot: { x: f.x, y: f.y + f.h * (a + b), w: f.w, h: f.h * (1 - a - b) },
    };
  },
  centerAxis(f, r) {
    const a = r.range(0.22, 0.34);
    return {
      body: { x: f.x, y: f.y, w: f.w, h: f.h * (0.5 - a / 2) },
      hero: { x: f.x, y: f.y + f.h * (0.5 - a / 2), w: f.w, h: f.h * a },
      foot: { x: f.x, y: f.y + f.h * (0.5 + a / 2), w: f.w, h: f.h * (0.5 - a / 2) },
    };
  },
  sidebar(f, r) {
    const s = r.range(0.22, 0.34), left = r.chance(0.5);
    const side = { x: left ? f.x : f.x + f.w * (1 - s), y: f.y, w: f.w * s, h: f.h };
    const main = { x: left ? f.x + f.w * s : f.x, y: f.y, w: f.w * (1 - s), h: f.h };
    const pad = main.w * 0.06;
    return {
      rail: side,
      hero: { x: main.x + pad, y: main.y, w: main.w - pad * 2, h: main.h * 0.34 },
      body: { x: main.x + pad, y: main.y + main.h * 0.34, w: main.w - pad * 2, h: main.h * 0.42 },
      foot: { x: main.x + pad, y: main.y + main.h * 0.76, w: main.w - pad * 2, h: main.h * 0.24 },
    };
  },
  bottomAnchor(f, r) {
    const a = r.range(0.24, 0.36);
    return {
      body: { x: f.x, y: f.y, w: f.w, h: f.h * (1 - a - 0.16) },
      foot: { x: f.x, y: f.y + f.h * (1 - a - 0.16), w: f.w, h: f.h * 0.16 },
      hero: { x: f.x, y: f.y + f.h * (1 - a), w: f.w, h: f.h * a },
    };
  },
  corner(f, r) {
    const w = r.range(0.48, 0.66), h = r.range(0.20, 0.30);
    const right = r.chance(0.5);
    return {
      hero: { x: right ? f.x + f.w * (1 - w) : f.x, y: f.y + f.h * (1 - h) - f.h * 0.06, w: f.w * w, h: f.h * h },
      body: { x: f.x, y: f.y, w: f.w, h: f.h * 0.52 },
      foot: { x: f.x, y: f.y + f.h * 0.56, w: f.w, h: f.h * 0.16 },
    };
  },
};

/* 占位避让：先记下已经放好的东西，新元素随机试若干次，挑不打架的位置。
   这是让随机版面「不糊」的最低成本手段。 */
function overlap(a, b, pad = 8) {
  return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x ||
           a.y + a.h + pad < b.y || b.y + b.h + pad < a.y);
}
function tryPlace(host, w, h, r, taken, tries = 28) {
  let best = null, bestScore = Infinity;
  for (let i = 0; i < tries; i++) {
    const c = { x: host.x + r.range(0, Math.max(0, host.w - w)),
                y: host.y + r.range(0, Math.max(0, host.h - h)), w, h };
    const hits = taken.filter(t => overlap(c, t)).length;
    if (hits === 0) return c;
    if (hits < bestScore) { bestScore = hits; best = c; }
  }
  return best;
}

/* 递归切割：撞色分区 / 随机切割 用的 guillotine */
function guillotine(box, depth, r, out = []) {
  if (depth <= 0 || box.w < 90 || box.h < 90) { out.push(box); return out; }
  const vertical = box.w > box.h ? r.chance(0.72) : r.chance(0.28);
  const t = r.range(0.28, 0.72);
  if (vertical) {
    guillotine({ x: box.x, y: box.y, w: box.w * t, h: box.h }, depth - 1, r, out);
    guillotine({ x: box.x + box.w * t, y: box.y, w: box.w * (1 - t), h: box.h }, depth - 1, r, out);
  } else {
    guillotine({ x: box.x, y: box.y, w: box.w, h: box.h * t }, depth - 1, r, out);
    guillotine({ x: box.x, y: box.y + box.h * t, w: box.w, h: box.h * (1 - t) }, depth - 1, r, out);
  }
  return out;
}

/* ---------- 5. 程序化「照片」：没有上传图时用它顶上 ---------- */
function proceduralImage(r, pal) {
  const seed = r.int(1, 9999);
  const a = pal.accent, b = pal.ink, c = pal.bg;
  const ang = r.int(0, 360);
  return `data:image/svg+xml;utf8,` + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">
      <defs>
        <linearGradient id="g" gradientTransform="rotate(${ang} .5 .5)">
          <stop offset="0" stop-color="${a}"/>
          <stop offset=".55" stop-color="${b}"/>
          <stop offset="1" stop-color="${c}"/>
        </linearGradient>
        <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="${(r.range(0.004,0.02)).toFixed(4)}"
          numOctaves="4" seed="${seed}"/><feColorMatrix type="saturate" values="0"/></filter>
      </defs>
      <rect width="600" height="800" fill="url(#g)"/>
      <rect width="600" height="800" filter="url(#n)" opacity=".55" style="mix-blend-mode:overlay"/>
    </svg>`);
}

/* ---------- 6. 主合成函数 ---------- */
function compose(P, seed, userImages = []) {
  const r = new Rng(seed);
  const W = 1080, H = 1512;
  const pal = P.palette ? PALETTES.find(p => p.name === P.palette) || r.pick(PALETTES) : r.pick(PALETTES);
  const fontKey = P.font && FONTS[P.font] ? P.font : r.pick(Object.keys(FONTS));
  const F = FONTS[fontKey];
  const exp = P.modes.experimental;

  /* 页边距：实验模式下允许更野的比例 */
  const base = r.pick([64, 88, 112, 140]);
  const m = Math.round(base * (exp ? r.range(0.55, 1.25) : 1) * (2 - P.grid.strength));
  const frame = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };

  const archKey = r.pick(Object.keys(ARCHETYPES));
  const box = ARCHETYPES[archKey](frame, r);

  const els = [];
  const taken = [];          // 已占据的版面区域
  const push = (layer, el) => { if (P.layers[layer] !== false) els.push({ layer, ...el }); };

  /* --- 底色 --- */
  push('bg', { k: 'rect', x: 0, y: 0, w: W, h: H, fill: pal.bg });

  /* --- 分区 / 撞色 / 切割 --- */
  if (P.layers.zone) {
    const depth = P.modes.randomCut ? r.int(2, 4) : r.int(1, 2);
    const cells = guillotine({ x: 0, y: 0, w: W, h: H }, depth, r);
    const tint = P.modes.clash ? [pal.accent, pal.ink, pal.sub] : [pal.sub, pal.accent];
    r.sample(cells, Math.max(1, Math.floor(cells.length * r.range(0.25, 0.5)))).forEach(c => {
      push('zone', { k: 'rect', ...c, fill: r.pick(tint), op: P.modes.clash ? 1 : r.range(0.10, 0.30) });
    });
  }

  /* --- 通栏色带 --- */
  if (P.layers.band) {
    const h = r.range(60, 190);
    const y = r.range(frame.y, frame.y + frame.h - h);
    push('band', { k: 'rect', x: 0, y, w: W, h, fill: P.modes.bandMask ? pal.ink : pal.accent, op: 0.92 });
  }

  /* --- 侧栏 --- */
  if (P.layers.sidebar && box.rail) {
    push('sidebar', { k: 'rect', ...box.rail, fill: pal.ink, op: 0.9 });
  }

  /* --- 窄缝 --- */
  if (P.layers.slit) {
    const n = r.int(2, 5);
    for (let i = 0; i < n; i++) {
      const w = r.range(3, 16);
      push('slit', { k: 'rect', x: r.range(0, W - w), y: 0, w, h: H, fill: pal.ink, op: r.range(0.08, 0.4) });
    }
  }

  /* --- 图片（含分块） --- */
  if (P.layers.image) {
    const host = r.chance(0.5) ? box.body : (box.hero || box.body);
    const iw = host.w * r.range(0.5, 1.0);
    const ih = host.h * r.range(0.55, 1.0);
    const src = userImages.length ? r.pick(userImages) : proceduralImage(r, pal);
    const sliced = !P.modes.rawImage && r.chance(0.55);
    push('image', {
      k: 'img', src,
      x: r.chance(0.5) ? host.x : host.x + host.w - iw,
      y: host.y + r.range(0, Math.max(0, host.h - ih)),
      w: iw, h: ih,
      cols: sliced ? r.int(2, 5) : 1,
      rows: sliced ? r.int(2, 6) : 1,
      gap: sliced ? r.range(2, 14) : 0,
      mask: P.modes.handMask ? handMask(r) : null,
    });
    const im = els[els.length - 1];
    if (im && im.k === 'img') taken.push({ x: im.x, y: im.y, w: im.w, h: im.h });
  }

  /* --- 标题组 --- */
  const align = P.type.align === 'random' ? r.pick(['left', 'right', 'center', 'array']) : P.type.align;
  const heroBox = box.hero;
  const titleScale = 1 + P.type.titleScale / 100;

  for (let g = 0; g < P.type.bigTitleGroups; g++) {
    const useCJK = r.chance(0.42);
    const text = useCJK ? r.pick(COPY.cjkTitle) : r.pick(COPY.latTitle);
    const tFont = useCJK ? F.cjk : F.lat;
    const tWeight = useCJK ? 400 : r.pick([300, 400, 700]);
    const track = useCJK ? r.range(0, 0.18) : r.range(-0.02, 0.14);
    const fit = fitFontSize(text, heroBox.w, track, tFont, tWeight);
    let fs = fit * titleScale;   // 0% = 正好撑满栏宽；调大就故意出血（参考原作的巨字裁切）
    if (P.type.lockSize) fs = Math.min(fs, heroBox.w / 5);
    const y = heroBox.y + g * (heroBox.h / P.type.bigTitleGroups);

    if (P.grid.mode === 'curve') {
      push('text', {
        k: 'curve', text, x: heroBox.x, y: y + heroBox.h * 0.3, w: heroBox.w,
        fs: fs * 0.5, amp: r.range(40, 150) * (r.chance(0.5) ? 1 : -1),
        font: tFont, color: pal.ink,
      });
    } else {
      push('text', {
        k: 'text', x: heroBox.x, y, w: heroBox.w, align,
        rot: P.grid.mode === 'skew' ? r.range(-7, 7) : 0,
        lines: [{ t: text, fs, ls: track * fs, lh: 0.92, font: tFont,
                  color: r.chance(0.15) ? pal.accent : pal.ink, weight: tWeight }],
      });
    }
    taken.push({ x: heroBox.x, y, w: heroBox.w, h: fs * 1.05 });
  }

  /* --- 小标题组 --- */
  const subBoxes = [box.body, box.foot, box.hero].filter(Boolean);
  for (let g = 0; g < P.type.subTitleGroups; g++) {
    const hostB = subBoxes[g % subBoxes.length];
    const useCJK = r.chance(0.5);
    const text = useCJK ? r.pick(COPY.cjkSub) : r.pick(COPY.latSub);
    const w = hostB.w * r.range(0.35, 0.8);
    const sFont = useCJK ? F.cjk : F.lat;
    const track = r.range(0, 0.26);
    const cap = fitFontSize(text, w, track, sFont);             // 上限：正好撑满栏宽
    const fs = Math.max(10, Math.min(cap, cap * (P.type.subRelSize / 100) * 3.4));
    const spot = tryPlace(hostB, w, fs * 1.6, r, taken) || { x: hostB.x, y: hostB.y };
    taken.push({ x: spot.x, y: spot.y, w, h: fs * 1.6 });
    push('text', {
      k: 'text', x: spot.x, y: spot.y,
      w, align: r.pick(['left', 'right']),
      rot: P.grid.mode === 'skew' ? r.range(-4, 4) : 0,
      lines: [{ t: text, fs, ls: fs * track, lh: 1.35,
                font: sFont, color: pal.sub, weight: 400 }],
    });
  }

  /* --- 散文诗 --- */
  for (let i = 0; i < P.type.proseCount; i++) {
    const hostB = r.pick(subBoxes);
    const block = r.pick(COPY.prose);
    const block0 = block.split('\n');
    let w = hostB.w * r.range(0.28, 0.5);
    let fs = 10 + (P.type.proseSize / 100) * 26;
    // 最长的一行不能超出栏宽
    fs = Math.min(fs, Math.min(...block0.map(t => fitFontSize(t, w, 0.04, isCJK(t) ? F.cjk : F.lat))));
    const h = block0.length * fs * 1.55;
    const spot = tryPlace(hostB, w, h, r, taken) || { x: hostB.x, y: hostB.y };
    taken.push({ x: spot.x, y: spot.y, w, h });
    push('text', {
      k: 'text', x: spot.x, y: spot.y, w,
      align: 'left', rot: P.grid.mode === 'skew' ? r.range(-3, 3) : 0,
      lines: block.split('\n').map(t => ({
        t, fs, ls: fs * 0.04, lh: 1.55,
        font: isCJK(t) ? F.cjk : F.lat, color: pal.sub, weight: 300,
      })),
    });
  }

  /* --- 线条 --- */
  if (P.layers.line) {
    const n = r.int(1, 4);
    for (let i = 0; i < n; i++) {
      const horiz = r.chance(0.7);
      const len = frame.w * r.range(0.18, 0.9);
      const th = r.pick([1, 1, 2, 3, 6]);
      push('line', horiz
        ? { k: 'rect', x: frame.x + r.range(0, frame.w - len), y: frame.y + r.range(0, frame.h), w: len, h: th, fill: pal.ink }
        : { k: 'rect', x: frame.x + r.range(0, frame.w), y: frame.y + r.range(0, frame.h * 0.5), w: th, h: frame.h * r.range(0.15, 0.5), fill: pal.ink });
    }
  }

  /* --- 图形 --- */
  if (P.layers.shape) {
    const n = r.int(1, exp ? 4 : 2);
    for (let i = 0; i < n; i++) {
      const s = r.range(24, 180);
      const kind = r.pick(['circle', 'ring', 'square', 'tri']);
      push('shape', {
        k: 'shape', kind, x: frame.x + r.range(-40, frame.w), y: frame.y + r.range(0, frame.h),
        w: s, h: s, fill: r.pick([pal.accent, pal.ink, pal.sub]), op: r.range(0.35, 1),
      });
    }
  }

  /* --- 刻度字 / 边角微型字 --- */
  if (P.type.tickType) {
    const corners = [
      { x: frame.x, y: frame.y - 26, a: 'left' },
      { x: frame.x, y: frame.y + frame.h + 10, a: 'left' },
      { x: frame.x, y: frame.y + frame.h + 10, a: 'right' },
    ];
    r.sample(corners, r.int(2, 3)).forEach(c => {
      push('text', {
        k: 'text', x: c.x, y: c.y, w: frame.w, align: c.a,
        lines: [{ t: r.pick(COPY.micro) + ' ' + String(seed % 1000).padStart(3, '0'),
                  fs: r.range(9, 13), ls: 2.4, lh: 1.4, font: FONTS.mono.lat, color: pal.sub, weight: 400 }],
      });
    });
  }

  /* --- 装饰：网格点 --- */
  if (P.layers.deco) {
    const cols = r.int(4, 10), rows = r.int(6, 16);
    for (let i = 1; i < cols; i++) for (let j = 1; j < rows; j++) {
      if (r.chance(0.82)) continue;
      push('deco', { k: 'shape', kind: 'circle', x: frame.x + (frame.w / cols) * i, y: frame.y + (frame.h / rows) * j, w: 4, h: 4, fill: pal.ink, op: 0.5 });
    }
  }

  /* --- 杂色噪点 --- */
  if (P.layers.noise) push('noise', { k: 'noise', freq: r.range(0.6, 1.4), op: r.range(0.04, 0.12) });

  return { W, H, els, pal, fontKey, archKey, seed, align, margin: m };
}

/* ---------- 7. 渲染 ---------- */
function render(board, comp, P) {
  board.innerHTML = '';
  board.style.width = comp.W + 'px';
  board.style.height = comp.H + 'px';

  const svgNS = 'http://www.w3.org/2000/svg';

  for (const e of comp.els) {
    if (e.k === 'rect') {
      const d = document.createElement('div');
      d.className = 'el';
      Object.assign(d.style, { left: e.x + 'px', top: e.y + 'px', width: e.w + 'px', height: e.h + 'px',
                               background: e.fill, opacity: e.op ?? 1 });
      board.appendChild(d);

    } else if (e.k === 'img') {
      const wrap = document.createElement('div');
      wrap.className = 'el img';
      Object.assign(wrap.style, { left: e.x + 'px', top: e.y + 'px', width: e.w + 'px', height: e.h + 'px' });
      if (e.mask) wrap.style.clipPath = e.mask;
      const cw = (e.w - e.gap * (e.cols - 1)) / e.cols;
      const ch = (e.h - e.gap * (e.rows - 1)) / e.rows;
      for (let i = 0; i < e.cols; i++) for (let j = 0; j < e.rows; j++) {
        const t = document.createElement('div');
        Object.assign(t.style, {
          position: 'absolute', left: i * (cw + e.gap) + 'px', top: j * (ch + e.gap) + 'px',
          width: cw + 'px', height: ch + 'px',
          backgroundImage: `url("${e.src}")`,
          backgroundSize: `${e.cols * 100}% ${e.rows * 100}%`,
          backgroundPosition: `${e.cols > 1 ? (i / (e.cols - 1)) * 100 : 50}% ${e.rows > 1 ? (j / (e.rows - 1)) * 100 : 50}%`,
        });
        wrap.appendChild(t);
      }
      board.appendChild(wrap);

    } else if (e.k === 'text') {
      const d = document.createElement('div');
      d.className = 'el txt';
      Object.assign(d.style, {
        left: e.x + 'px', top: e.y + 'px', width: e.w + 'px',
        textAlign: e.align === 'array' ? 'justify' : (e.align || 'left'),
        transform: e.rot ? `rotate(${e.rot}deg)` : '',
      });
      for (const L of e.lines) {
        const p = document.createElement('div');
        p.textContent = L.t;
        Object.assign(p.style, {
          fontSize: L.fs + 'px', letterSpacing: L.ls + 'px', lineHeight: L.lh,
          fontFamily: L.font, color: L.color, fontWeight: L.weight, whiteSpace: 'pre',
        });
        d.appendChild(p);
      }
      board.appendChild(d);

    } else if (e.k === 'curve') {
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'el');
      Object.assign(svg.style, { left: e.x + 'px', top: (e.y - Math.abs(e.amp) - e.fs) + 'px',
                                 width: e.w + 'px', height: (Math.abs(e.amp) * 2 + e.fs * 2) + 'px', overflow: 'visible' });
      const chars = [...e.text];
      const cy = Math.abs(e.amp) + e.fs;
      chars.forEach((ch, i) => {
        const t = chars.length === 1 ? 0.5 : i / (chars.length - 1);
        const x = t * e.w;
        const y = cy + e.amp * Math.sin(t * Math.PI);
        const ang = Math.atan2(e.amp * Math.PI * Math.cos(t * Math.PI), e.w) * 180 / Math.PI;
        const tx = document.createElementNS(svgNS, 'text');
        tx.setAttribute('x', x); tx.setAttribute('y', y);
        tx.setAttribute('transform', `rotate(${ang} ${x} ${y})`);
        tx.setAttribute('fill', e.color);
        tx.setAttribute('font-size', e.fs);
        tx.setAttribute('font-family', e.font);
        tx.setAttribute('text-anchor', 'middle');
        tx.textContent = ch;
        svg.appendChild(tx);
      });
      board.appendChild(svg);

    } else if (e.k === 'shape') {
      const d = document.createElement('div');
      d.className = 'el';
      Object.assign(d.style, { left: e.x + 'px', top: e.y + 'px', width: e.w + 'px', height: e.h + 'px', opacity: e.op });
      if (e.kind === 'circle') { d.style.background = e.fill; d.style.borderRadius = '50%'; }
      else if (e.kind === 'ring') { d.style.border = Math.max(1, e.w * 0.06) + 'px solid ' + e.fill; d.style.borderRadius = '50%'; }
      else if (e.kind === 'square') { d.style.background = e.fill; }
      else { d.style.background = e.fill; d.style.clipPath = 'polygon(50% 0,100% 100%,0 100%)'; }
      board.appendChild(d);

    } else if (e.k === 'noise') {
      const d = document.createElement('div');
      d.className = 'el';
      Object.assign(d.style, { left: 0, top: 0, width: '100%', height: '100%', opacity: e.op,
                               mixBlendMode: 'multiply', backgroundImage: noiseURL(e.freq) });
      board.appendChild(d);
    }
  }

  /* 纸张纹理（面板上的「纹理 W-x / 强度」） */
  if (P.layers.texture) {
    const t = document.createElement('div');
    t.className = 'el';
    const freq = { 'W-0': 0.85, 'W-1': 0.35, 'W-2': 1.6 }[P.color.texture] ?? 0.85;
    Object.assign(t.style, {
      left: 0, top: 0, width: '100%', height: '100%',
      opacity: P.color.textureStrength / 100 * 0.5,
      mixBlendMode: 'overlay', backgroundImage: noiseURL(freq), pointerEvents: 'none',
    });
    board.appendChild(t);
  }

  /* 画面调色：一条 CSS filter 搞定全图 */
  board.style.filter = P.color.enabled
    ? `contrast(${P.color.contrast}%) saturate(${P.color.saturate}%) brightness(${P.color.brightness}%)`
    : 'none';
}

function noiseURL(freq) {
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">
      <filter id="f"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="4"/>
      <feColorMatrix type="saturate" values="0"/></filter>
      <rect width="240" height="240" filter="url(#f)"/></svg>`)}")`;
}

function handMask(r) {
  const pts = [];
  for (let i = 0; i <= 12; i++) pts.push(`${(i / 12 * 100).toFixed(1)}% ${r.range(0, 6).toFixed(1)}%`);
  for (let i = 12; i >= 0; i--) pts.push(`${(i / 12 * 100).toFixed(1)}% ${(100 - r.range(0, 6)).toFixed(1)}%`);
  return `polygon(${pts.join(',')})`;
}

window.LotEngine = { Rng, compose, render, PALETTES, FONTS };
