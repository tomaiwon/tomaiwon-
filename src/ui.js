/* =====================================================================
 * 面板：以「复杂度」为主轴，其余都是它的修饰
 * ===================================================================== */
const E = window.LotEngine;

const DEFAULTS = () => ({
  density: 14,              // 默认从极简起步
  accentBudget: 1,          // 强调色全图只许出现几次
  duotone: true,            // 图片压进页面色系
  duotoneAmount: 100,
  imgBlend: 'normal',       // 图片与页面的混合方式
  titleScale: 0,
  tickType: true,
  gridMode: 'ortho',
  texture: 'W-0', textureStrength: 40,
  colorOn: true, contrast: 100, saturate: 100, brightness: 100,
  palette: null, font: null,
  layers: { bg: true, zone: true, line: true, image: true, texture: true,
            text: true, deco: true, shape: true },
});

/* 预设按复杂度从低到高排，方便看出这条轴 */
const BUILTIN = [
  { name: '纯粹留白', patch: { density: 5,  font: 'song',     palette: '暖沙',   accentBudget: 0 } },
  { name: '极简轻黑', patch: { density: 8,  font: 'hei',      palette: '纸白',   accentBudget: 0 } },
  { name: '深绿留白', patch: { density: 12, font: 'song',     palette: '深林绿' } },
  { name: '庄重石刻', patch: { density: 18, font: 'song',     palette: '夜青' } },
  { name: '理性宋骨', patch: { density: 24, font: 'song',     palette: '纸白' } },
  { name: '日式书卷', patch: { density: 28, font: 'fangsong', palette: '暖沙' } },
  { name: '编辑排版', patch: { density: 45, font: 'song',     palette: '牛皮纸' } },
  { name: '未来概念', patch: { density: 50, font: 'hei',      palette: '天空蓝', gridMode: 'skew' } },
  { name: '等宽技术', patch: { density: 56, font: 'mono',     palette: '墨黑' } },
  { name: '老式报纸', patch: { density: 64, font: 'song',     palette: '暖沙',   accentBudget: 0 } },
  { name: '港式杂志', patch: { density: 72, font: 'hei',      palette: '胭脂',   accentBudget: 2 } },
  { name: '满版实验', patch: { density: 92, font: 'hei',      palette: '墨黑',   accentBudget: 2 } },
];

const state = { P: DEFAULTS(), history: [], cursor: -1, selected: new Set(), presets: [], images: [] };
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const board = $('#board');

function merge(base, patch) {
  const out = structuredClone(base);
  for (const k in patch) {
    if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]))
      out[k] = { ...(out[k] || {}), ...patch[k] };
    else out[k] = patch[k];
  }
  return out;
}

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
    const hit = names[Math.floor(new E.Rng(seed).next() * names.length)];
    const ps = state.presets.find(p => p.name === hit);
    if (ps) P = merge(P, ps.patch);
  }
  const comp = E.compose(P, seed, state.images);
  E.render(board, comp, P);
  $('#meta').textContent =
    `#${String(seed).padStart(10, '0')} · 复杂度 ${comp.density} · 主角=${comp.hero === 'image' ? '图' : '字'}` +
    ` · 焦点 ${comp.focal.ay}-${comp.focal.ax} · ${comp.pal.name}/${comp.fontKey} · 强调色用了 ${comp.accentUsed} 次`;
  fitBoard();
}
const redraw = () => draw(state.history[state.cursor]);

function step(d) {
  const n = state.cursor + d;
  if (n < 0 || n >= state.history.length) return;
  state.cursor = n; draw(state.history[n]);
}

function fitBoard() {
  const st = $('#stage');
  const k = Math.min((st.clientWidth - 48) / 1080, (st.clientHeight - 48) / 1512);
  board.style.transform = `scale(${k})`;
}

const LAYER_LABELS = { bg: '底色', zone: '分区', line: '线条', image: '图片',
                       texture: '纹理', text: '文本', deco: '装饰', shape: '图形' };

function buildPresets() {
  state.presets = [...BUILTIN, ...JSON.parse(localStorage.getItem('lotgo.presets') || '[]')];
  const box = $('#presets'); box.innerHTML = '';
  state.presets.forEach(p => {
    const b = document.createElement('button');
    b.className = 'preset' + (state.selected.has(p.name) ? ' on' : '');
    b.textContent = p.name;
    b.title = '复杂度 ' + (p.patch.density ?? '-');
    b.onclick = ev => {
      if (ev.shiftKey) state.selected.has(p.name) ? state.selected.delete(p.name) : state.selected.add(p.name);
      else { state.selected.clear(); state.P = merge(state.P, p.patch); syncPanel(); }
      buildPresets(); redraw();
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
    b.onclick = () => { state.P.layers[k] = !state.P.layers[k]; buildChips(); redraw(); };
    box.appendChild(b);
  }
}

const FMT = { density: v => v, accentBudget: v => v + ' 次', contrast: v => v + '%', saturate: v => v + '%',
              brightness: v => v + '%', textureStrength: v => v + '%', duotoneAmount: v => v + '%',
              titleScale: v => (v > 0 ? '+' : '') + v + '%' };

function bindRanges() {
  $$('input[type=range][data-key]').forEach(el => {
    const key = el.dataset.key;
    el.value = state.P[key];
    const out = $('#' + key + '-out');
    const upd = () => { if (out) out.textContent = (FMT[key] || (v => v))(el.value); };
    upd();
    el.oninput = () => { state.P[key] = parseFloat(el.value); upd(); redraw(); };
  });
}

function bindSegs() {
  $$('.seg[data-key]').forEach(seg => {
    const key = seg.dataset.key;
    seg.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.v === String(state.P[key]));
      btn.onclick = () => {
        state.P[key] = btn.dataset.v;
        seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === btn));
        redraw();
      };
    });
  });
}

function syncPanel() {
  buildChips();
  $$('input[type=range][data-key]').forEach(el => {
    el.value = state.P[el.dataset.key];
    const out = $('#' + el.dataset.key + '-out');
    if (out) out.textContent = (FMT[el.dataset.key] || (v => v))(el.value);
  });
  $$('.seg[data-key]').forEach(seg =>
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(state.P[seg.dataset.key]))));
  $('#colorOn').checked = state.P.colorOn;
  $('#duotone').checked = state.P.duotone;
  $('#tickType').checked = state.P.tickType;
  $('#texSel').value = state.P.texture;
  $$('.seg[data-key=imgBlend] button').forEach(b => b.classList.toggle('on', b.dataset.v === state.P.imgBlend));
}

function init() {
  buildPresets(); buildChips(); bindRanges(); bindSegs();

  $('#texSel').onchange   = e => { state.P.texture = e.target.value; redraw(); };
  $('#colorOn').onchange  = e => { state.P.colorOn = e.target.checked; redraw(); };
  $('#duotone').onchange  = e => { state.P.duotone = e.target.checked; redraw(); };
  $('#tickType').onchange = e => { state.P.tickType = e.target.checked; redraw(); };

  $('#go').onclick   = () => draw();
  $('#prev').onclick = () => step(-1);
  $('#next').onclick = () => step(1);
  $('#reset').onclick = () => { state.P = DEFAULTS(); state.selected.clear(); syncPanel(); buildPresets(); redraw(); };

  $('#save').onclick = () => {
    const user = JSON.parse(localStorage.getItem('lotgo.presets') || '[]');
    const name = prompt('预设名', '风格' + (user.length + 1));
    if (!name) return;
    user.push({ name, patch: structuredClone(state.P) });
    localStorage.setItem('lotgo.presets', JSON.stringify(user));
    buildPresets();
  };

  $('#imgs').onchange = e => {
    state.images = [...e.target.files].map(f => URL.createObjectURL(f));
    redraw();
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
