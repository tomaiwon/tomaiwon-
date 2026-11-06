"""把两张 2 倍渲染图（覆盖设计坐标 y −56..720）切成页面用的三张 PNG，并记下摆放位置。

  python3 slice.py <front.png> <back.png> <输出目录>

  body.png   机身：纸带窗口 x194–450、y134 以下挖空；电路板那块也挖掉（单独一张）
  pcb.png    电路板：单独一张，窄屏时 layout() 给 #pcb 挂渐隐遮罩，只作用在它身上
  cables.png 线缆（后层）
  placement.json  每张图在设计坐标里的 x / y / 宽 / 高
"""
import sys, os, json, numpy as np, cv2
from PIL import Image
front_p, back_p, out = sys.argv[1:4]
S, Y0 = 2, -56
def load(p):
    im = cv2.imread(p, cv2.IMREAD_UNCHANGED)
    if im.dtype == np.uint16: im = np.round(im.astype(np.float32) / 257.0)
    return cv2.cvtColor(np.clip(im, 0, 255).astype(np.uint8), cv2.COLOR_BGRA2RGBA)
row = lambda y: int(round((y - Y0) * S)); col = lambda x: int(round(x * S))
def bbox(a, pad=2):
    ys, xs = np.nonzero(a[..., 3] > 0)
    y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + 1 + pad)
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + 1 + pad)
    y0 -= y0 % 2; x0 -= x0 % 2; y1 += y1 % 2; x1 += x1 % 2           # 对齐到整设计 px
    return x0, y0, x1, y1
def save(name, a, x0px, y0px):
    a = a.copy(); a[a[..., 3] == 0, :3] = 0
    p = os.path.join(out, name + '.png'); Image.fromarray(a).save(p, optimize=True)
    pl = dict(x=x0px / S, y=Y0 + y0px / S, w=a.shape[1] / S, h=a.shape[0] / S)
    print(f'{name:6s}', pl, f'{os.path.getsize(p) / 1024:.0f} KB'); return pl
os.makedirs(out, exist_ok=True)
F, B = load(front_p), load(back_p)
F[row(134):, col(194):col(450)] = 0                                   # 纸带窗口
PX0, PX1, PY1 = 162, 482, 88                                          # 电路板那块（左右侧墙在 152–161 / 483–492，不重叠）
pcb = F[:row(PY1), col(PX0):col(PX1)].copy()
body = F.copy(); body[:row(PY1), col(PX0):col(PX1)] = 0; body[:row(0)] = 0
P = {}
x0, y0, x1, y1 = bbox(pcb); P['pcb'] = save('pcb', pcb[y0:y1, x0:x1], col(PX0) + x0, y0)
x0, y0, x1, y1 = bbox(body); P['body'] = save('body', body[y0:y1, x0:x1], x0, y0)
x0, y0, x1, y1 = bbox(B); P['cables'] = save('cables', B[y0:y1, x0:x1], x0, y0)
json.dump(P, open(os.path.join(out, 'placement.json'), 'w'), indent=1)
