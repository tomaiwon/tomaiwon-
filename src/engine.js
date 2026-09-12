/* =====================================================================
 * 版式抽卡引擎 v2
 *
 * v1 的毛病：64 处各自独立的随机，谁也不知道谁。结果就是散。
 * v2 改成三条主线，全部是「推导」而不是「各自抽」：
 *
 *   1) 复杂度 density(0-100)  ——  一个维度决定画面上有多少东西
 *   2) 显著性阶梯 role        ——  先定谁是主角，再由角色推出字号和颜色
 *   3) 焦点锚定 focal         ——  主角先落位，其余元素全部对齐主角推出来
 *
 * 强调色是有预算的：全图只许出现一次。
 * ===================================================================== */

/* ---------- 种子随机 ---------- */
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
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  sample(arr, n) { return this.shuffle(arr).slice(0, n); }
}

/* ---------- 颜色：亮度 / 对比度 / 混色 ----------
 * 这一段是「哪里醒目」的数学基础。醒目 = 跟底色的对比度高。 */
function hex2rgb(h) {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function rgb2hex(c) { return '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join(''); }
function relLum(hex) {
  const [r, g, b] = hex2rgb(hex).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(a, b) {
  const l1 = relLum(a), l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function mix(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return rgb2hex([0, 1, 2].map(i => A[i] + (B[i] - A[i]) * t));
}
/* 在给定底色上，取 ink / bg 里对比更强的那个，保证一定读得出来 */
function legibleOn(bg, ink, page) {
  return contrastRatio(bg, ink) >= contrastRatio(bg, page) ? ink : page;
}

/* ---------- 显著性阶梯 ----------
 * 全图只有一个主角。第二位明显退后，其余全部是背景噪音级别。
 * 数值是「往 ink 方向混多少」，0.18 就是很轻的灰。 */
const LADDER = {
  hero:    { ink: 1.00, size: null },   // 字号由栏宽反解，不走这里
  second:  { ink: 0.62, size: 0.034 },  // size 是相对页宽
  support: { ink: 0.38, size: 0.019 },
  whisper: { ink: 0.22, size: 0.0105 },
};

/* ---------- 资产 ---------- */
const PALETTES = [
  { name: '牛皮纸', bg: '#d9c5a6', ink: '#2b2521', accent: '#b0431d' },
  { name: '深林绿', bg: '#1d3b31', ink: '#e9e3d5', accent: '#c98a3a' },
  { name: '天空蓝', bg: '#8dbde2', ink: '#13202d', accent: '#c5361f' },
  { name: '纸白',   bg: '#f2efe9', ink: '#16151a', accent: '#c3352a' },
  { name: '墨黑',   bg: '#111113', ink: '#f0ede6', accent: '#37d195' },
  { name: '胭脂',   bg: '#e7dad2', ink: '#33201c', accent: '#9b2a2a' },
  { name: '灰蓝',   bg: '#c3c8c9', ink: '#1f2426', accent: '#2f4858' },
  { name: '暖沙',   bg: '#e8dcc8', ink: '#25211c', accent: '#3f5d45' },
  { name: '夜青',   bg: '#16202b', ink: '#e4e8ea', accent: '#e0a43c' },
];

const FONTS = {
  song:     { cjk: '"Songti SC","SimSun","Noto Serif SC",serif',                    lat: '"Times New Roman",Georgia,serif' },
  hei:      { cjk: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif', lat: 'Helvetica,Arial,sans-serif' },
  kai:      { cjk: '"Kaiti SC","STKaiti","KaiTi",serif',                            lat: 'Georgia,"Times New Roman",serif' },
  fangsong: { cjk: '"FangSong","STFangsong","Songti SC",serif',                     lat: 'Georgia,serif' },
  mono:     { cjk: '"PingFang SC",sans-serif',                                      lat: '"SF Mono",Menlo,Consolas,monospace' },
};

const COPY = {
  latTitle: ['VOID', 'SERENDIPITY', 'MARGIN', 'PROOF', 'DRIFT', 'ORDER', 'ECHO', 'GRAIN', 'SLOW',
             'INDEX', 'FOLD', 'TRACE', 'QUIET', 'BLANK', 'LAYER', 'STILL', 'FIELD', 'AFTERIMAGE'],
  latSub:   ['THOUGHT · EPIPHANY', 'MARGIN METHOD', 'LIGHT SHADOW SPACE', 'KEEP THIS PAGE',
             'NEW PAGE EACH CLICK', 'A QUIET STRUCTURE', 'NOTES ON WHITE SPACE', 'SET IN SILENCE'],
  cjkTitle: ['留白', '会排', '迁想妙得', '秩序与偶然', '无题', '光影之间', '山高水长',
             '见字如面', '一期一会', '空山新雨', '观其大略', '纸上得来'],
  cjkSub:   ['在结构中发现偶然', '你不用负责设计，你只负责点亮', '一条安静的线托住页面',
             '网格换，字型换，图片重新排', '像盲盒，下一抽更好', '不用画框，不用打稿'],
  prose: [
    'The tool does not decide for you.\nIt gives you a beginning.\nThe rest is yours.',
    'Chance is not loss of control.\nIn order, something accidental\nkeeps growing.',
    '页面自己会排，\n不必费心，\n它自会交代。',
    '一行标题落在哪里，\n抽一次就知道了。',
  ],
  whisper: ['LOTGO', 'FIG. 4', 'PLATE 02', 'SPECIMEN', 'TYPE / GRID / CHANCE', 'PROOF'],
};

/* ---------- 字号反解：让一行字正好撑满栏宽 ---------- */
const ADV = { lat: 0.62, cjk: 1.0 };
function isCJK(s) { return /[㐀-鿿　-〿]/.test(s); }
let _mctx = null;
function measureAt100(text, fontCSS, weight = 400) {
  if (typeof document === 'undefined') return null;
  _mctx = _mctx || document.createElement('canvas').getContext('2d');
  _mctx.font = `${weight} 100px ${fontCSS}`;
  return _mctx.measureText(text).width / 100;
}
function fitFontSize(text, boxW, tracking = 0, fontCSS = null, weight = 400) {
  const n = Math.max(1, [...text].length);
  let em = fontCSS ? measureAt100(text, fontCSS, weight) : null;
  if (!em) em = n * (isCJK(text) ? ADV.cjk : ADV.lat);
  return (boxW * 0.995) / (em + tracking * n);
}

/* ---------- 复杂度：一个维度决定画面上有多少东西 ----------
 * 极简不是「少放几个」，而是「边距更大、只留主角」。 */
function budget(d, r) {
  const L = (a, b) => a + (b - a) * (d / 100);
  return {
    marginRatio: L(0.155, 0.055),              // 极简 = 大边距，这是极简的命
    subs:    d < 12 ? 0 : d < 38 ? 1 : d < 66 ? 2 : 3,
    prose:   d < 26 ? 0 : d < 54 ? 1 : 2,
    rules:   d < 18 ? 0 : d < 44 ? 1 : d < 72 ? 2 : 4,
    marks:   d < 58 ? 0 : d < 82 ? 1 : r.int(2, 3),   // 图形要到很繁复才出场
    zones:   d < 74 ? 0 : 1,
    deco:    d < 88 ? 0 : 1,
    imageP:  d < 16 ? 0.15 : d < 46 ? 0.6 : 0.88,
    sliceP:  d < 42 ? 0 : L(0, 0.6),
    whispers: d < 10 ? 1 : d < 50 ? 2 : 3,
  };
}

/* ---------- 焦点：主角落在哪 ----------
 * 不是均匀随机，是从几个经得起看的位置里挑。 */
const FOCALS = [
  { ax: 'left',   ay: 'top' },
  { ax: 'left',   ay: 'bottom' },
  { ax: 'left',   ay: 'middle' },
  { ax: 'right',  ay: 'bottom' },
  { ax: 'center', ay: 'middle' },
  { ax: 'right',  ay: 'top' },
];

/* ---------- 递归切割（只有高复杂度才用） ---------- */
function guillotine(box, depth, r, out = []) {
  if (depth <= 0 || box.w < 120 || box.h < 120) { out.push(box); return out; }
  const vertical = box.w > box.h ? r.chance(0.72) : r.chance(0.28);
  const t = r.range(0.3, 0.7);
  if (vertical) {
    guillotine({ x: box.x, y: box.y, w: box.w * t, h: box.h }, depth - 1, r, out);
    guillotine({ x: box.x + box.w * t, y: box.y, w: box.w * (1 - t), h: box.h }, depth - 1, r, out);
  } else {
    guillotine({ x: box.x, y: box.y, w: box.w, h: box.h * t }, depth - 1, r, out);
    guillotine({ x: box.x, y: box.y + box.h * t, w: box.w, h: box.h * (1 - t) }, depth - 1, r, out);
  }
  return out;
}

/* ---------- 占位避让 ---------- */
function overlap(a, b, pad = 14) {
  return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x ||
           a.y + a.h + pad < b.y || b.y + b.h + pad < a.y);
}
function tryPlace(host, w, h, r, taken, tries = 30) {
  let best = null, bestHits = Infinity;
  for (let i = 0; i < tries; i++) {
    const c = { x: host.x + r.range(0, Math.max(0, host.w - w)),
                y: host.y + r.range(0, Math.max(0, host.h - h)), w, h };
    const hits = taken.filter(t => overlap(c, t)).length;
    if (!hits) return c;
    if (hits < bestHits) { bestHits = hits; best = c; }
  }
  return best;
}

/* ---------- 程序化占位图 ---------- */
function proceduralImage(r) {
  const seed = r.int(1, 9999);
  const ang = r.int(0, 360);
  const f = r.range(0.0015, 0.005).toFixed(4);   // 低频 = 大块的明暗，而不是细噪点
  const oct = r.int(2, 3);
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">
      <defs>
        <linearGradient id="g" gradientTransform="rotate(${ang} .5 .5)">
          <stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="#9a9a9a"/>
          <stop offset="1" stop-color="#1a1a1a"/>
        </linearGradient>
        <filter id="n" color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="${f}" numOctaves="${oct}" seed="${seed}"/>
          <feColorMatrix type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="table" tableValues="0 .85"/></feComponentTransfer>
        </filter>
      </defs>
      <rect width="600" height="800" fill="url(#g)"/>
      <rect width="600" height="800" filter="url(#n)" opacity=".7" style="mix-blend-mode:overlay"/>
     </svg>`);
}

/* =====================================================================
 * 主合成
 * ===================================================================== */
function compose(P, seed, userImages = []) {
  const r = new Rng(seed);
  const W = 1080, H = 1512;

  const pal = PALETTES.find(p => p.name === P.palette) || r.pick(PALETTES);
  const fontKey = (P.font && FONTS[P.font]) ? P.font : r.pick(Object.keys(FONTS));
  const F = FONTS[fontKey];

  const d = P.density;
  const B = budget(d, r);
  const m = Math.round(W * B.marginRatio);
  const frame = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };

  /* 颜色阶梯：由底色和墨色推导，不再随机取 */
  const tone = k => mix(pal.bg, pal.ink, LADDER[k].ink);
  const size = k => W * LADDER[k].size;

  /* 强调色预算：全图最多一次 */
  let accentLeft = P.accentBudget;
  const useAccent = () => (accentLeft > 0 ? (accentLeft--, pal.accent) : null);

  const els = [];
  const taken = [];
  const push = (layer, el) => { if (P.layers[layer] !== false) els.push({ layer, ...el }); };

  push('bg', { k: 'rect', x: 0, y: 0, w: W, h: H, fill: pal.bg });

  /* --- 分区（只有很繁复才出现） --- */
  if (B.zones && P.layers.zone) {
    const cells = guillotine({ x: 0, y: 0, w: W, h: H }, r.int(2, 3), r);
    r.sample(cells, r.int(1, 2)).forEach(c =>
      push('zone', { k: 'rect', ...c, fill: mix(pal.bg, pal.ink, r.range(0.06, 0.16)) }));
  }

  /* =================================================================
   * 主角先落位：可能是「字」，也可能是「图」
   * ================================================================= */
  const focal = r.pick(FOCALS);
  const heroIsImage = P.layers.image && r.next() < B.imageP && r.chance(0.38);
  const heroW = frame.w * (focal.ax === 'center' ? 1 : r.range(0.72, 1));
  const heroX = focal.ax === 'right' ? frame.x + frame.w - heroW
              : focal.ax === 'center' ? frame.x + (frame.w - heroW) / 2
              : frame.x;

  /* 标题文本先定，字号由栏宽反解 */
  const tCJK = r.chance(0.4);
  const titleText = tCJK ? r.pick(COPY.cjkTitle) : r.pick(COPY.latTitle);
  const tFont = tCJK ? F.cjk : F.lat;
  const tWeight = tCJK ? 400 : r.pick([300, 400, 700]);
  const track = tCJK ? r.range(0, 0.16) : r.range(-0.02, 0.12);

  let heroBox, titleBox, imgBox = null;

  if (heroIsImage) {
    /* 图当主角：图占大块，标题退到 second 级别 */
    const ih = frame.h * r.range(0.38, 0.56);
    const iy = focal.ay === 'top' ? frame.y
             : focal.ay === 'bottom' ? frame.y + frame.h - ih
             : frame.y + (frame.h - ih) / 2;
    imgBox = { x: heroX, y: iy, w: heroW, h: ih };
    heroBox = imgBox;
    const tw = frame.w * r.range(0.45, 0.8);
    const ts = fitFontSize(titleText, tw, track, tFont, tWeight) * 0.5;
    titleBox = { x: heroX, y: iy + ih + ts * 0.9, w: tw, h: ts * 1.15, fs: ts, role: 'second' };
    if (titleBox.y + titleBox.h > frame.y + frame.h) titleBox.y = iy - ts * 1.6;
  } else {
    /* 字当主角：撑满栏宽 */
    const fs = fitFontSize(titleText, heroW, track, tFont, tWeight) * (1 + P.titleScale / 100);
    const th = fs * 1.02;
    const ty = focal.ay === 'top' ? frame.y
             : focal.ay === 'bottom' ? frame.y + frame.h - th
             : frame.y + (frame.h - th) * r.range(0.35, 0.6);
    titleBox = { x: heroX, y: ty, w: heroW, h: th, fs, role: 'hero' };
    heroBox = titleBox;
  }

  /* 标题上色：主角拿最高对比，强调色只在这里花掉（或留给一个小记号） */
  const titleColor = titleBox.role === 'hero'
    ? (r.chance(0.35) ? (useAccent() || pal.ink) : pal.ink)
    : tone('second');

  push('text', {
    k: 'text', x: titleBox.x, y: titleBox.y, w: titleBox.w,
    align: focal.ax === 'right' ? 'right' : focal.ax === 'center' ? 'center' : 'left',
    rot: P.gridMode === 'skew' ? r.range(-5, 5) : 0,
    lines: [{ t: titleText, fs: titleBox.fs, ls: track * titleBox.fs, lh: 0.95,
              font: tFont, color: titleColor, weight: tWeight }],
  });
  taken.push({ x: titleBox.x, y: titleBox.y, w: titleBox.w, h: titleBox.h });

  /* --- 图片（非主角时也可能出现） --- */
  if (!imgBox && P.layers.image && r.next() < B.imageP) {
    const iw = frame.w * r.range(0.3, 0.62);
    const ih = frame.h * r.range(0.16, 0.34);
    const spot = tryPlace(frame, iw, ih, r, taken);
    if (spot) imgBox = { ...spot, w: iw, h: ih };
  }
  if (imgBox && P.layers.image) {
    const sliced = r.next() < B.sliceP;
    push('image', {
      k: 'img', src: userImages.length ? r.pick(userImages) : proceduralImage(r),
      ...imgBox,
      cols: sliced ? r.int(2, 5) : 1,
      rows: sliced ? r.int(2, 5) : 1,
      gap: sliced ? r.range(3, 12) : 0,
      /* 图像处理：双色调把照片压进页面色系，图文才是一套东西 */
      duo: P.duotone ? { dark: pal.ink, light: pal.bg, amount: P.duotoneAmount / 100 } : null,
      blend: P.imgBlend || 'normal',
    });
    taken.push(imgBox);
  }

  /* =================================================================
   * 其余元素：全部对齐主角推出来，不再各自随机
   * ================================================================= */
  const edgeX = focal.ax === 'right' ? heroBox.x + heroBox.w : heroBox.x;   // 跟主角同一条边
  const alignRight = focal.ax === 'right';

  /* --- 小标题 --- */
  for (let i = 0; i < B.subs; i++) {
    const cjk = r.chance(0.5);
    const text = cjk ? r.pick(COPY.cjkSub) : r.pick(COPY.latSub);
    const sFont = cjk ? F.cjk : F.lat;
    const fs = Math.min(size('support') * r.range(0.9, 1.5), fitFontSize(text, frame.w * 0.62, 0.1, sFont));
    const w = frame.w * r.range(0.42, 0.72);
    const x = alignRight ? edgeX - w : edgeX;
    /* 先试贴着主角上下方；不行再在版心里找 */
    const cands = [heroBox.y + heroBox.h + fs * r.range(1.2, 2.6), heroBox.y - fs * r.range(2.2, 3.4)];
    let spot = null;
    for (const y of r.shuffle(cands)) {
      const c = { x, y, w, h: fs * 1.5 };
      if (y > frame.y && y + c.h < frame.y + frame.h && !taken.some(t => overlap(c, t))) { spot = c; break; }
    }
    spot = spot || tryPlace(frame, w, fs * 1.5, r, taken);
    if (!spot) continue;
    taken.push(spot);
    push('text', {
      k: 'text', x: spot.x, y: spot.y, w, align: alignRight ? 'right' : 'left',
      lines: [{ t: text, fs, ls: fs * r.range(0.02, 0.2), lh: 1.35,
                font: sFont, color: tone('support'), weight: 400 }],
    });
  }

  /* --- 散文诗 --- */
  const usedProse = new Set();
  for (let i = 0; i < B.prose; i++) {
    const pool = COPY.prose.filter(p => !usedProse.has(p));
    if (!pool.length) break;
    const block = r.pick(pool); usedProse.add(block);
    const lines = block.split('\n');
    const w = frame.w * r.range(0.26, 0.42);
    let fs = size('whisper') * r.range(1.2, 1.8);
    fs = Math.min(fs, ...lines.map(t => fitFontSize(t, w, 0.03, isCJK(t) ? F.cjk : F.lat)));
    const h = lines.length * fs * 1.6;
    const x = alignRight ? edgeX - w : edgeX;
    const c0 = { x, y: heroBox.y + heroBox.h + size('second') * r.range(2, 5), w, h };
    const spot = (c0.y + h < frame.y + frame.h && !taken.some(t => overlap(c0, t)))
      ? c0 : tryPlace(frame, w, h, r, taken);
    if (!spot) continue;
    taken.push(spot);
    push('text', {
      k: 'text', x: spot.x, y: spot.y, w, align: 'left',
      lines: lines.map(t => ({ t, fs, ls: fs * 0.03, lh: 1.6,
        font: isCJK(t) ? F.cjk : F.lat, color: tone('whisper'), weight: 300 })),
    });
  }

  /* --- 线条：对齐主角的边，长度也从主角来 --- */
  for (let i = 0; i < B.rules; i++) {
    const len = heroBox.w * r.pick([1, 1, 0.62, 0.38]);
    const x = alignRight ? edgeX - len : edgeX;
    const y = r.chance(0.6) ? heroBox.y + heroBox.h + r.range(20, 120)
                            : heroBox.y - r.range(20, 120);
    if (y < frame.y || y > frame.y + frame.h) continue;
    push('line', { k: 'rect', x, y, w: len, h: r.pick([1, 1, 2, 3]), fill: tone('support') });
  }

  /* --- 图形：只在高复杂度出现，而且锚在主角的角上，不再是彩色纸屑 --- */
  for (let i = 0; i < B.marks; i++) {
    const s = size('second') * r.range(0.6, 1.6);
    const anchorX = alignRight ? heroBox.x - s * 1.6 : heroBox.x + heroBox.w + s * 0.6;
    const x = Math.max(frame.x, Math.min(frame.x + frame.w - s, anchorX));
    const y = heroBox.y + heroBox.h * r.range(0, 1) - s / 2;
    const c = { x, y, w: s, h: s };
    if (taken.some(t => overlap(c, t, 4))) continue;
    push('shape', { k: 'shape', kind: r.pick(['circle', 'ring', 'square']), ...c,
                    fill: i === 0 ? (useAccent() || tone('support')) : tone('support'), op: 1 });
  }

  /* --- 刻度字：钉在版心四角 --- */
  if (P.tickType) {
    const spots = [
      { x: frame.x, y: frame.y - size('whisper') * 2.2, a: 'left' },
      { x: frame.x, y: frame.y + frame.h + size('whisper'), a: 'left' },
      { x: frame.x, y: frame.y + frame.h + size('whisper'), a: 'right' },
    ];
    r.sample(spots, Math.min(B.whispers, 3)).forEach(s => {
      push('text', {
        k: 'text', x: s.x, y: s.y, w: frame.w, align: s.a,
        lines: [{ t: r.pick(COPY.whisper) + ' ' + String(seed % 1000).padStart(3, '0'),
                  fs: size('whisper'), ls: 2.4, lh: 1.4,
                  font: FONTS.mono.lat, color: tone('whisper'), weight: 400 }],
      });
    });
  }

  /* --- 装饰网点 --- */
  if (B.deco && P.layers.deco) {
    const cols = r.int(5, 9), rows = r.int(8, 14);
    for (let i = 1; i < cols; i++) for (let j = 1; j < rows; j++) {
      if (r.chance(0.85)) continue;
      push('deco', { k: 'shape', kind: 'circle', x: frame.x + frame.w / cols * i,
                     y: frame.y + frame.h / rows * j, w: 4, h: 4, fill: tone('whisper'), op: 1 });
    }
  }

  return { W, H, els, pal, fontKey, seed, density: d, focal,
           hero: heroIsImage ? 'image' : 'title', accentUsed: P.accentBudget - accentLeft };
}

/* =====================================================================
 * 渲染
 * ===================================================================== */
function render(board, comp, P) {
  board.innerHTML = '';
  board.style.width = comp.W + 'px';
  board.style.height = comp.H + 'px';
  const svgNS = 'http://www.w3.org/2000/svg';
  let duoId = 0;

  for (const e of comp.els) {
    if (e.k === 'rect') {
      const dv = document.createElement('div');
      dv.className = 'el';
      Object.assign(dv.style, { left: e.x + 'px', top: e.y + 'px', width: e.w + 'px',
                                height: e.h + 'px', background: e.fill, opacity: e.op ?? 1 });
      board.appendChild(dv);

    } else if (e.k === 'img') {
      const wrap = document.createElement('div');
      wrap.className = 'el img';
      Object.assign(wrap.style, { left: e.x + 'px', top: e.y + 'px', width: e.w + 'px', height: e.h + 'px',
                                  mixBlendMode: e.blend === 'normal' ? '' : e.blend });
      /* 双色调：先去色，再把明暗映射到页面的墨色与底色之间 */
      if (e.duo) {
        const id = 'duo' + (duoId++);
        const [dr, dg, db] = hex2rgb(e.duo.dark).map(v => v / 255);
        const [lr, lg, lb] = hex2rgb(e.duo.light).map(v => v / 255);
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', 0); svg.setAttribute('height', 0);
        svg.style.position = 'absolute';
        svg.innerHTML =
          `<filter id="${id}" color-interpolation-filters="sRGB">
             <feColorMatrix type="matrix" values="
               .2126 .7152 .0722 0 0  .2126 .7152 .0722 0 0  .2126 .7152 .0722 0 0  0 0 0 1 0"/>
             <feComponentTransfer>
               <feFuncR type="table" tableValues="${dr} ${lr}"/>
               <feFuncG type="table" tableValues="${dg} ${lg}"/>
               <feFuncB type="table" tableValues="${db} ${lb}"/>
             </feComponentTransfer>
           </filter>`;
        board.appendChild(svg);
        wrap.style.filter = `url(#${id})`;
        wrap.style.opacity = 0.35 + 0.65 * e.duo.amount;
      }
      const cw = (e.w - e.gap * (e.cols - 1)) / e.cols;
      const ch = (e.h - e.gap * (e.rows - 1)) / e.rows;
      for (let i = 0; i < e.cols; i++) for (let j = 0; j < e.rows; j++) {
        const t = document.createElement('div');
        Object.assign(t.style, {
          position: 'absolute', left: i * (cw + e.gap) + 'px', top: j * (ch + e.gap) + 'px',
          width: cw + 'px', height: ch + 'px',
          backgroundImage: `url("${e.src}")`,
          backgroundSize: `${e.cols * 100}% ${e.rows * 100}%`,
          backgroundPosition: `${e.cols > 1 ? i / (e.cols - 1) * 100 : 50}% ${e.rows > 1 ? j / (e.rows - 1) * 100 : 50}%`,
        });
        wrap.appendChild(t);
      }
      board.appendChild(wrap);

    } else if (e.k === 'text') {
      const dv = document.createElement('div');
      dv.className = 'el txt';
      Object.assign(dv.style, { left: e.x + 'px', top: e.y + 'px', width: e.w + 'px',
        textAlign: e.align || 'left', transform: e.rot ? `rotate(${e.rot}deg)` : '' });
      for (const L of e.lines) {
        const p = document.createElement('div');
        p.textContent = L.t;
        Object.assign(p.style, { fontSize: L.fs + 'px', letterSpacing: L.ls + 'px', lineHeight: L.lh,
          fontFamily: L.font, color: L.color, fontWeight: L.weight, whiteSpace: 'pre' });
        dv.appendChild(p);
      }
      board.appendChild(dv);

    } else if (e.k === 'shape') {
      const dv = document.createElement('div');
      dv.className = 'el';
      Object.assign(dv.style, { left: e.x + 'px', top: e.y + 'px', width: e.w + 'px',
                                height: e.h + 'px', opacity: e.op ?? 1 });
      if (e.kind === 'circle') { dv.style.background = e.fill; dv.style.borderRadius = '50%'; }
      else if (e.kind === 'ring') { dv.style.border = Math.max(1, e.w * 0.07) + 'px solid ' + e.fill; dv.style.borderRadius = '50%'; }
      else dv.style.background = e.fill;
      board.appendChild(dv);
    }
  }

  if (P.layers.texture) {
    const t = document.createElement('div');
    t.className = 'el';
    const freq = { 'W-0': 0.85, 'W-1': 0.35, 'W-2': 1.6 }[P.texture] ?? 0.85;
    Object.assign(t.style, { left: 0, top: 0, width: '100%', height: '100%',
      opacity: P.textureStrength / 100 * 0.45, mixBlendMode: 'overlay',
      backgroundImage: noiseURL(freq), pointerEvents: 'none' });
    board.appendChild(t);
  }

  board.style.filter = P.colorOn
    ? `contrast(${P.contrast}%) saturate(${P.saturate}%) brightness(${P.brightness}%)` : 'none';
}

function noiseURL(freq) {
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">
      <filter id="f"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="4"/>
      <feColorMatrix type="saturate" values="0"/></filter>
      <rect width="240" height="240" filter="url(#f)"/></svg>`)}")`;
}

window.LotEngine = { Rng, compose, render, PALETTES, FONTS, contrastRatio, relLum, mix };
