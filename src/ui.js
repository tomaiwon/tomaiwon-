/* =====================================================================
 * 控制面板 + 抽卡历史 + 预设保存
 * 面板状态 = 一个纯 JSON 对象；预设 = 这个对象的快照。
 * ===================================================================== */
const E = window.LotEngine;   // 两个文件共用全局作用域，这里不再解构，避免同名冲突

const DEFAULTS = () => ({
  layers: { bg: true, zone: false, line: true, noise: false, image: true, texture: true,
            text: true, deco: false, shape: true, slit: false, sidebar: false, band: false },
  modes:  { experimental: true, card: false, clash: false, randomCut: false,
            rawImage: false, aiLayer: false, handMask: false, bandMask: true },
  color:  { enabled: true, contrast: 100, saturate: 100, brightness: 100, texture: 'W-0', textureStrength: 49 },
  grid:   { strength: 1.0, mode: 'ortho' },
  type:   { titleScale: 0, microScale: 0, lockSize: false, tickType: true,
            bigTitleGroups: 1, subTitleGroups: 2, subRelSize: 27,
            align: 'random', proseCount: 2, proseSize: 25 },
  palette: null, font: null,
});

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
};

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
  let P = state.P;
  if (state.selected.size) {
    const names = [...state.selected];
    const pick = names[Math.floor(new E.Rng(seed).next() * names.length)];
    const ps = state.presets.find(p => p.name === pick);
    if (ps) P = merge(P, ps.patch);
  }
  const comp = E.compose(P, seed, state.images);
  E.render(board, comp, P);
  $('#meta').textContent =
    `在结构中发现偶然 · LotGo-like · #${String(seed).padStart(10, '0')} · ${comp.archKey} / ${comp.pal.name} / ${comp.fontKey}`;
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
  const k = Math.min((stage.clientWidth - 48) / 1080, (stage.clientHeight - 48) / 1512);
  board.style.transform = `scale(${k})`;
}

/* ---------- 面板构建 ---------- */
const LAYER_LABELS = { bg: '底色', zone: '分区', line: '线条', noise: '杂', image: '图片', texture: '纹理',
                       text: '文本', deco: '装饰', shape: '图形', slit: '窄缝', sidebar: '边栏', band: '通栏' };
const MODE_LABELS  = { experimental: '实验模式', card: '卡片模式', clash: '撞色分区', randomCut: '随机切割',
                       rawImage: '原图模式', aiLayer: 'AI分层', handMask: '手写蒙版', bandMask: '通栏蒙版' };

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

  $('#imgs').onchange = e => {
    state.images = [...e.target.files].map(f => URL.createObjectURL(f));
    draw(state.history[state.cursor]);
  };

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); draw(); }
    if (e.code === 'ArrowLeft') step(-1);
    if (e.code === 'ArrowRight') step(1);
  });

  window.addEventListener('resize', fitBoard);
  draw();
}
init();
