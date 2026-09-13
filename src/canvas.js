/* =====================================================================
 * Canvas 渲染器 —— 用来导出高清图
 *
 * compose() 产出的是一份纯元素列表，屏幕上那版是用 DOM 画的。
 * 这里把同一份列表在 canvas 上再画一遍，就能任意倍率导出。
 * 两边必须保持一致，改了 render() 记得同步改这里。
 * ===================================================================== */

/* CSS 行盒模型：div 的行高是 fs*lh，文字在行盒里垂直居中，
   内容高度约 1.16em，基线在 ascent≈0.88em 处。 */
const ASC = 0.88, CONTENT = 1.16;

function loadImg(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('图片加载失败'));
    im.src = src;
  });
}

/* 把 clip-path: polygon(x% y%, ...) 翻成 canvas 路径 */
function clipPolygon(ctx, poly, w, h) {
  const pts = poly.replace(/^polygon\(|\)$/g, '').split(',').map(p => {
    const [a, b] = p.trim().split(/\s+/);
    return [parseFloat(a) / 100 * w, parseFloat(b) / 100 * h];
  });
  if (pts.length < 3) return;
  ctx.beginPath();
  pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.clip();
}

async function renderToCanvas(comp, P, scale = 1) {
  const { W, H, els } = comp;
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * scale);
  cv.height = Math.round(H * scale);
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);

  /* 先把要用的图全部加载好，canvas 画图是同步的 */
  const srcs = [...new Set(els.filter(e => e.k === 'img').map(e => e.src))];
  const imgs = {};
  await Promise.all(srcs.map(async s => { try { imgs[s] = await loadImg(s); } catch (e) {} }));

  for (const e of els) {
    if (e.k === 'rect') {
      ctx.save();
      ctx.globalAlpha = e.op ?? 1;
      ctx.fillStyle = e.fill;
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.restore();

    } else if (e.k === 'img') {
      const im = imgs[e.src];
      if (!im) continue;
      ctx.save();
      ctx.beginPath(); ctx.rect(e.x, e.y, e.w, e.h); ctx.clip();
      ctx.translate(e.x, e.y);
      if (e.mask) clipPolygon(ctx, e.mask, e.w, e.h);
      /* 分块：每块显示原图对应的一格，跟 background-position 的算法一致 */
      const cw = (e.w - e.gap * (e.cols - 1)) / e.cols;
      const ch = (e.h - e.gap * (e.rows - 1)) / e.rows;
      const sw = im.width / e.cols, sh = im.height / e.rows;
      for (let i = 0; i < e.cols; i++) for (let j = 0; j < e.rows; j++) {
        ctx.drawImage(im, i * sw, j * sh, sw, sh,
                      i * (cw + e.gap), j * (ch + e.gap), cw, ch);
      }
      ctx.restore();

    } else if (e.k === 'text') {
      ctx.save();
      if (e.rot) {
        ctx.translate(e.x, e.y);
        ctx.rotate(e.rot * Math.PI / 180);
        ctx.translate(-e.x, -e.y);
      }
      const align = e.align === 'array' ? 'left' : (e.align || 'left');
      ctx.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
      ctx.textBaseline = 'alphabetic';
      const ax = align === 'center' ? e.x + e.w / 2 : align === 'right' ? e.x + e.w : e.x;
      let top = e.y;
      for (const L of e.lines) {
        const box = L.fs * L.lh;
        ctx.font = `${L.weight || 400} ${L.fs}px ${L.font}`;
        ctx.letterSpacing = (L.ls || 0) + 'px';
        ctx.fillStyle = L.color;
        ctx.fillText(L.t, ax, top + (box - L.fs * CONTENT) / 2 + L.fs * ASC);
        top += box;
      }
      ctx.restore();

    } else if (e.k === 'curve') {
      ctx.save();
      ctx.font = `${e.fs}px ${e.font}`;
      ctx.fillStyle = e.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const chars = [...e.text];
      chars.forEach((ch, i) => {
        const t = chars.length === 1 ? 0.5 : i / (chars.length - 1);
        const x = e.x + t * e.w;
        const y = e.y + e.amp * Math.sin(t * Math.PI);
        const ang = Math.atan2(e.amp * Math.PI * Math.cos(t * Math.PI), e.w);
        ctx.save();
        ctx.translate(x, y); ctx.rotate(ang);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      });
      ctx.restore();

    } else if (e.k === 'shape') {
      ctx.save();
      ctx.globalAlpha = e.op ?? 1;
      ctx.fillStyle = e.fill; ctx.strokeStyle = e.fill;
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      if (e.kind === 'circle') {
        ctx.beginPath(); ctx.arc(cx, cy, e.w / 2, 0, Math.PI * 2); ctx.fill();
      } else if (e.kind === 'ring') {
        ctx.lineWidth = Math.max(1, e.w * 0.06);
        ctx.beginPath(); ctx.arc(cx, cy, e.w / 2 - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke();
      } else if (e.kind === 'tri') {
        ctx.beginPath();
        ctx.moveTo(cx, e.y); ctx.lineTo(e.x + e.w, e.y + e.h); ctx.lineTo(e.x, e.y + e.h);
        ctx.closePath(); ctx.fill();
      } else {
        ctx.fillRect(e.x, e.y, e.w, e.h);
      }
      ctx.restore();

    } else if (e.k === 'noise') {
      await paintNoise(ctx, W, H, e.freq, e.op, 'multiply');
    }
  }

  /* 纸纹 */
  if (P.layers.texture) {
    const freq = { 'W-0': 0.85, 'W-1': 0.35, 'W-2': 1.6 }[P.color.texture] ?? 0.85;
    await paintNoise(ctx, W, H, freq, P.color.textureStrength / 100 * 0.5, 'overlay');
  }

  /* 画面调色：跟 DOM 版的 CSS filter 对应 */
  if (P.color.enabled) {
    const out = document.createElement('canvas');
    out.width = cv.width; out.height = cv.height;
    const octx = out.getContext('2d');
    octx.filter = `contrast(${P.color.contrast}%) saturate(${P.color.saturate}%) brightness(${P.color.brightness}%)`;
    octx.drawImage(cv, 0, 0);
    return out;
  }
  return cv;
}

async function paintNoise(ctx, W, H, freq, alpha, blend) {
  try {
    const url = window.LotEngine.noiseURL(freq).slice(5, -2);   // 剥掉 url("...")
    const im = await loadImg(url);
    const pat = ctx.createPattern(im, 'repeat');
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = blend;
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  } catch (e) { /* 纹理画不出来就算了，不该拖垮导出 */ }
}

function canvasToBlob(cv) {
  return new Promise(res => cv.toBlob(res, 'image/png'));
}

window.LotCanvas = { renderToCanvas, canvasToBlob };
