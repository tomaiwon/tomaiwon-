/* =====================================================================
 * 控制面板 + 抽卡历史 + 预设保存
 * 面板状态 = 一个纯 JSON 对象；预设 = 这个对象的快照。
 * ===================================================================== */
const E = window.LotEngine;   // 两个文件共用全局作用域，这里不再解构，避免同名冲突

const DEFAULTS = () => ({
  layers: { bg: true, zone: false, line: true, noise: false, image: true, texture: true,
            text: true, deco: false, shape: true, slit: false, sidebar: false, band: false },
  modes:  { experimental: true, clash: false, randomCut: false,
            rawImage: false, handMask: false, bandMask: true },
  color:  { enabled: true, contrast: 100, saturate: 100, brightness: 100, texture: 'W-0', textureStrength: 49 },
  grid:   { strength: 1.0, mode: 'ortho' },
  type:   { titleScale: 0, microScale: 0, lockSize: false, tickType: true,
            bigTitleGroups: 1, subTitleGroups: 2, subRelSize: 27,
            align: 'random', proseCount: 2, proseSize: 25 },
  palette: null, font: null,
  size: { w: 1080, h: 1440, name: '3:4' },
  copy: { title: '', sub: '', prose: '' },
});

/* 常用出图尺寸 */
const SIZES = [
  { name: '3:4',  w: 1080, h: 1440, tip: '小红书' },
  { name: '2:3',  w: 1080, h: 1620, tip: '海报' },
  { name: '1:1',  w: 1080, h: 1080, tip: '方图' },
  { name: 'A4',   w: 1240, h: 1754, tip: '打印 150dpi' },
  { name: '9:16', w: 1080, h: 1920, tip: '手机' },
];

const BUILTIN = [
  { name: '新中式',   patch: { font: 'song',     palette: '牛皮纸', type: { align: 'center', subRelSize: 22 } } },
  { name: '理性宋骨', patch: { font: 'song',     palette: '纸白',   grid: { mode: 'ortho', strength: 1.2 } } },
  { name: '极简轻黑', patch: { font: 'hei',      palette: '纸白',   layers: { zone: false, shape: false, line: true } } },
  { name: '深绿留白', patch: { font: 'song',     palette: '深林绿', type: { proseCount: 1, bigTitleGroups: 1 } } },
  { name: '港式杂志', patch: { font: 'hei',      palette: '胭脂',   layers: { zone: true, band: true }, modes: { clash: true } } },
  { name: '日式书卷', patch: { font: 'fangsong', palette: '暖沙',   type: { align: 'right', subRelSize: 20 } } },
  { name: '等宽技术', patch: { font: 'mono',     palette: '墨黑',   layers: { deco: true, slit: true } } },
  { name: '诗人手稿', patch: { font: 'kai',      palette: '纸白',   type: { proseCount: 3, proseSize: 32 } } },
  { name: '庄重石刻', patch: { font: 'song',     palette: '夜青',   type: { titleScale: 18, align: 'center' } } },
  { name: '未来概念', patch: { font: 'hei',      palette: '天空蓝', grid: { mode: 'skew', strength: 1.4 }, layers: { shape: true, band: true } } },
  { name: '数学曲线', patch: { font: 'song',     palette: '灰蓝',   grid: { mode: 'curve', strength: 1 } } },
  { name: '老式报纸', patch: { font: 'song',     palette: '暖沙',   layers: { line: true, deco: true }, type: { subTitleGroups: 4, proseCount: 3 } } },
];

/* ---------- 状态 ---------- */
const state = {
  P: DEFAULTS(),
  history: [],
  cursor: -1,
  selected: new Set(),      // 多选预设：每次抽卡在选中的预设里随机取一个
  presets: [],              // 内置 + 用户保存
  images: [],
  favs: [],                 // 收藏：存种子 + 当时的全部参数
  locks: { pal: false, font: false, arch: false, copy: false },  // 锁住的不重抽
  last: null,               // 上一张实际用了什么，锁定时复用
};

const LOCK_LABELS = { pal: '配色', font: '字体', arch: '版式', copy: '文案' };

function loadFavs() {
  try { return JSON.parse(localStorage.getItem('lotgo.favs') || '[]'); }
  catch (e) { return []; }
}
function saveFavs() {
  try { localStorage.setItem('lotgo.favs', JSON.stringify(state.favs)); } catch (e) {}
}

const $ = s => document.querySelector(s);
const board = $('#board');

/* 深合并：预设的 patch 只覆盖它关心的字段 */
function merge(base, patch) {
  const out = structuredClone(base);
  for (const k in patch) {
    if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) {
      out[k] = { ...(out[k] || {}), ...patch[k] };
    } else out[k] = patch[k];
  }
  return out;
}

/* ---------- 抽卡 ---------- */
function draw(seed) {
  if (seed === undefined) {
    seed = (Math.random() * 4294967295) >>> 0;
    state.history = state.history.slice(0, state.cursor + 1);
    state.history.push(seed);
    state.cursor = state.history.length - 1;
  }
  const P = activeParams(seed);
  const comp = E.compose(P, seed, state.images);
  E.render(board, comp, P);
  state.last = { pal: comp.pal.name, font: comp.fontKey, arch: comp.archKey, copy: comp.usedCopy };
  $('#meta').textContent =
    `抽屉视觉 · #${String(seed).padStart(10, '0')} · ${comp.archKey} / ${comp.pal.name} / ${comp.fontKey}`;
  fitBoard();
}

function step(d) {
  const n = state.cursor + d;
  if (n < 0 || n >= state.history.length) return;
  state.cursor = n;
  draw(state.history[n]);
}

function fitBoard() {
  const stage = $('#stage');
  const SW = state.P.size.w, SH = state.P.size.h;
  // 容器高度算不出来时别给出负的缩放，否则画板会翻转并消失
  const k = Math.max(0.05, Math.min((stage.clientWidth - 48) / SW,
                                    (stage.clientHeight - 48) / SH));
  board.style.transform = `scale(${k})`;
}

/* ---------- 面板构建 ---------- */
const LAYER_LABELS = { bg: '底色', zone: '分区', line: '线条', noise: '杂', image: '图片', texture: '纹理',
                       text: '文本', deco: '装饰', shape: '图形', slit: '窄缝', sidebar: '边栏', band: '通栏' };
// 只列引擎真正会读的模式。卡片模式/AI分层在引擎里是 0 次调用，是假控件，已删。
const MODE_LABELS  = { experimental: '实验模式', clash: '撞色分区', randomCut: '随机切割',
                       rawImage: '原图模式', handMask: '手写蒙版', bandMask: '通栏蒙版' };

function loadUserPresets() {
  try { return JSON.parse(localStorage.getItem('lotgo.presets') || '[]'); }
  catch (e) { return []; }          // 隐私模式 / 禁用存储时直接退回内置预设
}

function buildPresets() {
  state.presets = [...BUILTIN, ...loadUserPresets()];
  const box = $('#presets');
  box.innerHTML = '';
  state.presets.forEach(p => {
    const b = document.createElement('button');
    b.className = 'preset' + (state.selected.has(p.name) ? ' on' : '');
    b.textContent = p.name;
    b.onclick = e => {
      if (e.shiftKey) {                       // shift = 加入多选池
        state.selected.has(p.name) ? state.selected.delete(p.name) : state.selected.add(p.name);
      } else {                                // 单击 = 直接套用这套参数
        state.selected.clear();
        state.P = merge(state.P, p.patch);
        syncPanel();
      }
      buildPresets();
      draw(state.history[state.cursor]);
    };
    box.appendChild(b);
  });
}

function buildChips() {
  const box = $('#layers'); box.innerHTML = '';
  for (const k in LAYER_LABELS) {
    const b = document.createElement('button');
    b.className = 'chip' + (state.P.layers[k] ? ' on' : '');
    b.textContent = LAYER_LABELS[k];
    b.onclick = () => { state.P.layers[k] = !state.P.layers[k]; buildChips(); draw(state.history[state.cursor]); };
    box.appendChild(b);
  }
  const mb = $('#modes'); mb.innerHTML = '';
  for (const k in MODE_LABELS) {
    const l = document.createElement('label');
    l.className = 'cb';
    l.innerHTML = `<input type="checkbox" ${state.P.modes[k] ? 'checked' : ''}><span>${MODE_LABELS[k]}</span>`;
    l.querySelector('input').onchange = e => { state.P.modes[k] = e.target.checked; draw(state.history[state.cursor]); };
    mb.appendChild(l);
  }
}

function bindRange(sel, path, fmt) {
  const el = $(sel), out = $(sel + '-out');
  const [a, b] = path.split('.');
  el.value = state.P[a][b];
  const upd = () => { out.textContent = fmt ? fmt(el.value) : el.value; };
  upd();
  el.oninput = () => { state.P[a][b] = parseFloat(el.value); upd(); draw(state.history[state.cursor]); };
}

function bindSeg(sel, path) {
  const [a, b] = path.split('.');
  $$(sel + ' button').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.v === String(state.P[a][b]));
    btn.onclick = () => {
      state.P[a][b] = btn.dataset.v;
      $$(sel + ' button').forEach(x => x.classList.toggle('on', x === btn));
      draw(state.history[state.cursor]);
    };
  });
}
const $$ = s => [...document.querySelectorAll(s)];

function syncPanel() {
  buildChips();
  ['#contrast', '#saturate', '#brightness', '#texStrength', '#gridStrength',
   '#titleScale', '#bigGroups', '#subGroups', '#subRel', '#proseCount', '#proseSize'].forEach(s => {
    const el = $(s); if (el && el.dataset.path) {
      const [a, b] = el.dataset.path.split('.');
      el.value = state.P[a][b];
      const out = $(s + '-out'); if (out) out.textContent = el.value;
    }
  });
  $$('#gridMode button').forEach(b => b.classList.toggle('on', b.dataset.v === state.P.grid.mode));
  $$('#align button').forEach(b => b.classList.toggle('on', b.dataset.v === state.P.type.align));
  $('#colorOn').checked = state.P.color.enabled;
  $('#lockSize').classList.toggle('on', state.P.type.lockSize);
  $('#tickType').checked = state.P.type.tickType;
}

/* ---------- 尺寸 ---------- */
function buildSizes() {
  const box = $('#sizes'); box.innerHTML = '';
  SIZES.forEach(z => {
    const b = document.createElement('button');
    b.className = 'chip' + (state.P.size.name === z.name ? ' on' : '');
    b.innerHTML = z.name + '<i>' + z.tip + '</i>';
    b.onclick = () => {
      state.P.size = { w: z.w, h: z.h, name: z.name };
      buildSizes(); draw(state.history[state.cursor]);
    };
    box.appendChild(b);
  });
}

/* ---------- 自定义文案 ---------- */
function bindCopy() {
  ['title', 'sub', 'prose'].forEach(k => {
    const el = $('#copy-' + k);
    el.value = state.P.copy[k];
    el.oninput = () => { state.P.copy[k] = el.value; draw(state.history[state.cursor]); };
  });
  $('#copy-clear').onclick = () => {
    state.P.copy = { title: '', sub: '', prose: '' };
    ['title', 'sub', 'prose'].forEach(k => { $('#copy-' + k).value = ''; });
    draw(state.history[state.cursor]);
  };
}

/* ---------- 导出 PNG ---------- */
let downloads = null;
if (window.claude && claude.use) {
  claude.use('downloads').then(d => {
    downloads = d;
    if (!d) $('#exportNote').textContent = '这个环境不能直接存文件，导出会在新窗口打开图片，长按/右键保存';
  }).catch(() => {});
}

async function exportPNG(scale) {
  const btn = $('#export' + scale);
  const old = btn.textContent;
  btn.textContent = '生成中…'; btn.disabled = true;
  try {
    const seed = state.history[state.cursor];
    const comp = E.compose(activeParams(seed), seed, state.images);
    const cv = await window.LotCanvas.renderToCanvas(comp, activeParams(seed), scale);
    const blob = await window.LotCanvas.canvasToBlob(cv);
    const name = `chouti-${state.P.size.name.replace(':', 'x')}-${seed}@${scale}x.png`;
    if (downloads) {
      await downloads.save({ filename: name, data: blob });
    } else {
      // 没有存文件能力时，开一张图让用户自己保存
      const url = URL.createObjectURL(blob);
      const w = window.open('', '_blank');
      if (w) w.document.write(`<title>${name}</title><body style="margin:0;background:#111">
        <img src="${url}" style="max-width:100%;display:block;margin:auto">`);
      else $('#exportNote').textContent = '浏览器拦截了新窗口，请允许弹窗后重试';
    }
  } catch (err) {
    if (!(err && err.code === 'declined')) $('#exportNote').textContent = '导出失败：' + (err.message || err.code || err);
  } finally {
    btn.textContent = old; btn.disabled = false;
  }
}

/* 当前生效的参数（把混抽命中的预设算进去），导出和预览必须用同一份 */
function activeParams(seed) {
  let P = state.P;
  if (state.selected.size) {
    const names = [...state.selected];
    const hit = names[Math.floor(new E.Rng(seed).next() * names.length)];
    const ps = state.presets.find(p => p.name === hit);
    if (ps) P = merge(P, ps.patch);
  }
  // 锁定：沿用上一张的对应部分，其余照常重抽
  const L = state.locks, last = state.last;
  if (last) {
    if (L.pal)  P = merge(P, { palette: last.pal });
    if (L.font) P = merge(P, { font: last.font });
    if (L.arch) P = merge(P, { lockArch: last.arch });
    if (L.copy) P = merge(P, { lockCopy: last.copy });
  }
  return P;
}

/* ---------- 连抽 12 张，自己挑 ---------- */
async function drawSheet() {
  const sheet = $('#sheet'), grid = $('#sheetGrid');
  sheet.hidden = false;
  grid.innerHTML = '<div class="sheetMsg">生成中…</div>';
  const seeds = Array.from({ length: 12 }, () => (Math.random() * 4294967295) >>> 0);
  grid.innerHTML = '';
  for (const sd of seeds) {
    const P = activeParams(sd);
    const comp = E.compose(P, sd, state.images);
    const cv = await window.LotCanvas.renderToCanvas(comp, P, 220 / state.P.size.w);
    const cell = document.createElement('button');
    cell.className = 'cell';
    cell.appendChild(cv);
    cell.onclick = () => {
      state.history = state.history.slice(0, state.cursor + 1);
      state.history.push(sd);
      state.cursor = state.history.length - 1;
      sheet.hidden = true;
      draw(sd);
    };
    grid.appendChild(cell);
  }
}

/* ---------- 锁定：抽卡机的核心手感 ----------
   锁住喜欢的那部分，只重抽其余。比给一墙滑杆有用得多。 */
function buildLocks() {
  const box = $('#locks'); box.innerHTML = '';
  for (const k in LOCK_LABELS) {
    const b = document.createElement('button');
    b.className = 'lock' + (state.locks[k] ? ' on' : '');
    b.textContent = (state.locks[k] ? '🔒' : '') + LOCK_LABELS[k];
    b.title = state.locks[k] ? '已锁定，抽卡时不变' : '点击锁定，之后抽卡保持不变';
    b.onclick = () => { state.locks[k] = !state.locks[k]; buildLocks(); };
    box.appendChild(b);
  }
}

/* ---------- 收藏 ---------- */
function buildFavs() {
  const box = $('#favs');
  box.innerHTML = '';
  if (!state.favs.length) { box.innerHTML = '<span class="dimnote">还没有收藏。抽到好的点 ♥</span>'; return; }
  state.favs.forEach((f, i) => {
    const b = document.createElement('button');
    b.className = 'fav';
    b.textContent = f.label;
    b.title = '点击恢复这张（含当时的全部参数）';
    b.onclick = () => {
      state.P = merge(DEFAULTS(), f.P);
      state.selected.clear();
      syncPanel(); buildSizes(); buildPresets(); bindCopy();
      state.history.push(f.seed); state.cursor = state.history.length - 1;
      draw(f.seed);
    };
    const x = document.createElement('span');
    x.className = 'x'; x.textContent = '×';
    x.onclick = ev => { ev.stopPropagation(); state.favs.splice(i, 1); saveFavs(); buildFavs(); };
    b.appendChild(x);
    box.appendChild(b);
  });
}

/* ---------- 启动 ---------- */
function init() {
  buildPresets();
  buildChips();

  bindRange('#contrast', 'color.contrast', v => v + '%');
  bindRange('#saturate', 'color.saturate', v => v + '%');
  bindRange('#brightness', 'color.brightness', v => v + '%');
  bindRange('#texStrength', 'color.textureStrength', v => v + '%');
  bindRange('#gridStrength', 'grid.strength', v => (+v).toFixed(1));
  bindRange('#titleScale', 'type.titleScale', v => v + '%');
  bindRange('#bigGroups', 'type.bigTitleGroups');
  bindRange('#subGroups', 'type.subTitleGroups');
  bindRange('#subRel', 'type.subRelSize', v => v + '%');
  bindRange('#proseCount', 'type.proseCount');
  bindRange('#proseSize', 'type.proseSize', v => v + '%');

  bindSeg('#gridMode', 'grid.mode');
  bindSeg('#align', 'type.align');

  $('#texSel').onchange = e => { state.P.color.texture = e.target.value; draw(state.history[state.cursor]); };
  $('#colorOn').onchange = e => { state.P.color.enabled = e.target.checked; draw(state.history[state.cursor]); };
  $('#tickType').onchange = e => { state.P.type.tickType = e.target.checked; draw(state.history[state.cursor]); };
  $('#lockSize').onclick = () => { state.P.type.lockSize = !state.P.type.lockSize; $('#lockSize').classList.toggle('on'); draw(state.history[state.cursor]); };

  $('#go').onclick = () => draw();
  $('#prev').onclick = () => step(-1);
  $('#next').onclick = () => step(1);
  $('#reset').onclick = () => { state.P = DEFAULTS(); state.selected.clear(); syncPanel(); buildPresets(); draw(state.history[state.cursor]); };

  /* 保存预设：把当前面板状态整包存进 localStorage，名字就叫「风格N」 */
  $('#save').onclick = () => {
    const user = loadUserPresets();
    const name = prompt('预设名', '风格' + (user.length + 1));
    if (!name) return;
    user.push({ name, patch: structuredClone(state.P) });
    try { localStorage.setItem('lotgo.presets', JSON.stringify(user)); }
    catch (e) { alert('这个环境不允许本地存储，预设只在本次有效'); }
    buildPresets();
  };

  buildSizes(); bindCopy(); buildLocks();
  state.favs = loadFavs(); buildFavs();

  $('#export1').onclick = () => exportPNG(1);
  $('#export2').onclick = () => exportPNG(2);
  $('#sheetBtn').onclick = () => drawSheet();
  $('#sheetClose').onclick = () => { $('#sheet').hidden = true; };
  $('#sheet').onclick = ev => { if (ev.target.id === 'sheet') $('#sheet').hidden = true; };

  $('#favBtn').onclick = () => {
    const seed = state.history[state.cursor];
    if (seed === undefined) return;
    if (state.favs.some(f => f.seed === seed)) return;
    state.favs.unshift({
      seed,
      label: state.P.size.name + ' · ' + String(seed).slice(0, 6),
      P: structuredClone(state.P),
    });
    state.favs = state.favs.slice(0, 40);
    saveFavs(); buildFavs();
  };

  $('#imgs').onchange = e => {
    state.images = [...e.target.files].map(f => URL.createObjectURL(f));
    draw(state.history[state.cursor]);
  };

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); draw(); }
    if (e.code === 'ArrowLeft') step(-1);
    if (e.code === 'ArrowRight') step(1);
    if (e.code === 'Escape') $('#sheet').hidden = true;
    if (e.key === 'e') exportPNG(2);
    if (e.key === 'f') $('#favBtn').click();
    if (e.key === 'g') drawSheet();
  });

  window.addEventListener('resize', fitBoard);
  draw();
}
init();
