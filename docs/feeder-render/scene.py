"""出片机 · Blender 场景（无头运行，Blender 4.5 + Cycles）

  Blender -b --factory-startup -P scene.py -- --tex <masks.py 的输出目录> --pass front|back --scale 2 --samples 512 --out x.png

  --pass front  机身（辊子、轴承、侧架、电机、折片、电路板）；线缆对相机隐身，但照样投影、被反射
  --pass back   线缆；机身对相机隐身
  整条流水线（遮罩 → 渲染 → 切图 → 嵌进 feeder.html → 回归）见 docs/FEEDER.md 第 6 节。

坐标：Blender X = 设计坐标 x，Z = −设计坐标 y，Y = 纵深（正 = 远离相机）。
正交相机看 +Y，1 单位 = 设计坐标 1px。画面覆盖 x 0..575、y −56..720（多出的 56 是电路板在窄屏会露出来的上沿）。
部件坐标全部取自 docs/FEEDER.md 第 3 节 / feeder.html 里的 SVG。
"""
import bpy, bmesh, math, sys, os, argparse, re
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--tex', required=True)
ap.add_argument('--pass', dest='pss', default='front')
ap.add_argument('--samples', type=int, default=96)          # 定稿用 512
ap.add_argument('--scale', type=float, default=1.0)         # 定稿用 2（2 倍图）
ap.add_argument('--out', default='')
ap.add_argument('--save', default='')
ap.add_argument('--region', default='')                     # x0,y0,x1,y1（设计坐标）只渲一块，调参用
ap.add_argument('--env', default='')       # key=value,... overrides for quick tuning
A = ap.parse_args(argv)

TAU = math.tau
FRAME = (0, -56, 575, 720)
# 环境（线性亮度 vs 仰角）。正面这张表几乎就是参考里抛光轴承那一列的亮度反推出来的（轴承最接近镜面）
# 主光不在无穷远：一块柔光箱放在机器前方 500px、上方，轴承看它是仰角 15°–48°，电机（低 160px）看它是 34°–56°，
# 这正是参考里两者高光位置差的那一截。柔光箱以外的方向由下面这张世界表给。
FRONT = [(-90, .035), (-55, .045), (-41, .07), (-31, .10), (-22, .21), (-12, .39), (-3, .6), (6, .7), (16, .8), (30, .9),
         (45, 1.0), (55, 1.0), (65, .66), (77, .28), (89, .12)]
BACK = [(-90, .07), (-10, .07), (3, .12), (12, .45), (28, .45), (40, .1), (90, .12)]
SOFTBOX = dict(depth=-500, x0=-1500, x1=2100, ramp=[(-632, .9), (-407, 1.5), (-40, 1.45), (50, 1.05), (100, .75), (140, .45)])
SIDECARD = dict(x=-700, d0=-700, d1=300, y0=-300, y1=600, strength=0.7)
ENV = dict(left=0.12, strength=1.0)        # left：左边的环境比右边亮一点（参考里右侧背光）
for kv in filter(None, A.env.split(',')):
    k, v = kv.split('='); ENV[k] = float(v)

# ───────────────────────── scene reset ─────────────────────────
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
for c in list(bpy.data.collections): bpy.data.collections.remove(c)
sc = bpy.context.scene


def coll(name):
    c = bpy.data.collections.new(name); sc.collection.children.link(c); return c


BODY, CABLE, HELP = coll('body'), coll('cables'), coll('helpers')


def link(nt, a, b): nt.links.new(a, b)


def sock(node, ident, out=False):
    return next(s for s in (node.outputs if out else node.inputs) if s.identifier == ident)


# ───────────────────────── materials ─────────────────────────
IMG = {}


def mask(nt, name):
    """design-space planar projection along Y of a Chromium-rasterised mask (white = mark)"""
    if name not in IMG:
        im = bpy.data.images.load(os.path.join(A.tex, name + '.png'))
        im.colorspace_settings.name = 'Non-Color'; IMG[name] = im
    N = nt.nodes
    geo = N.new('ShaderNodeNewGeometry'); sep = N.new('ShaderNodeSeparateXYZ')
    link(nt, geo.outputs['Position'], sep.inputs[0])
    x0, y0, x1, y1 = FRAME; w, h = x1 - x0, y1 - y0
    u = N.new('ShaderNodeMath'); u.operation = 'MULTIPLY_ADD'
    link(nt, sep.outputs['X'], u.inputs[0]); u.inputs[1].default_value = 1 / w; u.inputs[2].default_value = -x0 / w
    v = N.new('ShaderNodeMath'); v.operation = 'MULTIPLY_ADD'
    link(nt, sep.outputs['Z'], v.inputs[0]); v.inputs[1].default_value = 1 / h; v.inputs[2].default_value = y1 / h
    cb = N.new('ShaderNodeCombineXYZ')
    link(nt, u.outputs[0], cb.inputs['X']); link(nt, v.outputs[0], cb.inputs['Y'])
    t = N.new('ShaderNodeTexImage'); t.image = IMG[name]; t.extension = 'CLIP'; t.interpolation = 'Cubic'
    link(nt, cb.outputs[0], t.inputs['Vector'])
    return t.outputs['Color']


def mixc(nt, fac, a, b):
    m = nt.nodes.new('ShaderNodeMix'); m.data_type = 'RGBA'
    if isinstance(fac, float): m.inputs[0].default_value = fac
    else: link(nt, fac, m.inputs[0])
    for ident, val in (('A_Color', a), ('B_Color', b)):
        s = sock(m, ident)
        if isinstance(val, tuple): s.default_value = (*val, 1) if len(val) == 3 else val
        else: link(nt, val, s)
    return sock(m, 'Result_Color', out=True)


def mat(name, base, metal=0.0, rough=0.4, coat=0.0, coat_rough=0.08, spec=0.5,
        brush=None, brush_amt=0.0, brush_bump=0.06, engrave=None, eng_dark=0.45, eng_depth=0.55,
        layers=(), emission=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; N = nt.nodes
    bsdf = next(n for n in N if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Coat Weight'].default_value = coat
    bsdf.inputs['Coat Roughness'].default_value = coat_rough
    bsdf.inputs['Specular IOR Level'].default_value = spec
    color = (*base, 1)
    normal = None; rough_s = None
    if brush:
        geo = N.new('ShaderNodeNewGeometry'); mp = N.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = {'x': (0.012, 1.6, 1.6), 'z': (1.6, 1.6, 0.012), 'r': (0.5, 0.5, 0.5)}[brush]
        link(nt, geo.outputs['Position'], mp.inputs['Vector'])
        nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 1.0
        nz.inputs['Detail'].default_value = 8; nz.inputs['Roughness'].default_value = 0.62
        link(nt, mp.outputs['Vector'], nz.inputs['Vector'])
        ma = N.new('ShaderNodeMath'); ma.operation = 'MULTIPLY_ADD'
        link(nt, nz.outputs['Fac'], ma.inputs[0]); ma.inputs[1].default_value = brush_amt
        ma.inputs[2].default_value = rough - brush_amt * 0.5
        rough_s = ma.outputs[0]
        bp = N.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = brush_bump; bp.inputs['Distance'].default_value = 0.4
        link(nt, nz.outputs['Fac'], bp.inputs['Height']); normal = bp.outputs['Normal']
    col_s = None
    if engrave:
        E = mask(nt, engrave)
        b2 = N.new('ShaderNodeBump'); b2.invert = True
        b2.inputs['Strength'].default_value = 1.0; b2.inputs['Distance'].default_value = eng_depth
        link(nt, E, b2.inputs['Height'])
        if normal: link(nt, normal, b2.inputs['Normal'])
        normal = b2.outputs['Normal']
        col_s = mixc(nt, E, base, tuple(c * eng_dark for c in base))
        r2 = N.new('ShaderNodeMath'); r2.operation = 'MULTIPLY_ADD'
        link(nt, E, r2.inputs[0]); r2.inputs[1].default_value = 0.22
        if rough_s: link(nt, rough_s, r2.inputs[2])
        else: r2.inputs[2].default_value = rough
        rough_s = r2.outputs[0]
    # extra printed / raised layers: (mask, colour, bump_height, rough)
    for lm, lcol, lb, lr in layers:
        E = mask(nt, lm)
        col_s = mixc(nt, E, col_s if col_s else base, lcol)
        if lb:
            b3 = N.new('ShaderNodeBump'); b3.inputs['Strength'].default_value = 1.0; b3.inputs['Distance'].default_value = lb
            link(nt, E, b3.inputs['Height'])
            if normal: link(nt, normal, b3.inputs['Normal'])
            normal = b3.outputs['Normal']
        if lr is not None:
            mr = N.new('ShaderNodeMix'); mr.data_type = 'FLOAT'
            link(nt, E, mr.inputs[0])
            if rough_s: link(nt, rough_s, sock(mr, 'A_Float'))
            else: sock(mr, 'A_Float').default_value = rough
            sock(mr, 'B_Float').default_value = lr
            rough_s = sock(mr, 'Result_Float', out=True)
    if col_s: link(nt, col_s, bsdf.inputs['Base Color'])
    else: bsdf.inputs['Base Color'].default_value = color
    if rough_s: link(nt, rough_s, bsdf.inputs['Roughness'])
    if normal: link(nt, normal, bsdf.inputs['Normal'])
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission[0], 1); bsdf.inputs['Emission Strength'].default_value = emission[1]
    return m


M = {}
M['motor'] = mat('motor', (0.70, 0.70, 0.685), metal=1, rough=0.38, brush='r', brush_amt=0.07, engrave='engrave', eng_dark=0.25, eng_depth=0.7)
M['roller'] = mat('roller', (0.70, 0.70, 0.684), metal=1, rough=0.4, brush='x', brush_amt=0.10, brush_bump=0.1, engrave='engrave', eng_dark=0.5, eng_depth=0.45)
M['bearing'] = mat('bearing', (0.63, 0.63, 0.62), metal=1, rough=0.10, brush='x', brush_amt=0.04, brush_bump=0.02)
M['frame'] = mat('frame', (0.28, 0.282, 0.275), metal=1, rough=0.42, brush='z', brush_amt=0.12, brush_bump=0.12, engrave='engrave', eng_dark=0.4, eng_depth=0.4)
# 右侧架背光（参考：左板 ~116、右板 ~104）
M['frameR'] = mat('frameR', (0.245, 0.247, 0.24), metal=1, rough=0.42, brush='z', brush_amt=0.12, brush_bump=0.12, engrave='engrave', eng_dark=0.4, eng_depth=0.4)
M['wall'] = mat('wall', (0.5, 0.5, 0.49), metal=1, rough=0.3, brush='z', brush_amt=0.1, brush_bump=0.1)
M['steel'] = mat('steel', (0.62, 0.62, 0.61), metal=1, rough=0.2, engrave='engrave', eng_dark=0.3)
M['darkmetal'] = mat('darkmetal', (0.07, 0.07, 0.068), metal=1, rough=0.38)
M['interior'] = mat('interior', (0.03, 0.03, 0.028), rough=0.7)
M['backplate'] = mat('backplate', (0.62, 0.61, 0.6), rough=0.85)
M['guide'] = mat('guide', (0.018, 0.018, 0.017), rough=0.55)
M['paper'] = mat('paper', (0.0, 0.0, 0.0), rough=0.9, spec=0.0, emission=((1.0, 0.995, 0.985), 0.40))   # 两面一样亮的反光板
M['pcb'] = mat('pcb', (0.004, 0.21, 0.175), rough=0.45, spec=0.25, coat=0.05, coat_rough=0.2,
               layers=(('traces', (0.03, 0.14, 0.125), 0.35, None), ('silk', (0.82, 0.84, 0.82), 0.12, 0.6)))
M['epoxy'] = mat('epoxy', (0.014, 0.014, 0.014), rough=0.5, spec=0.4)
M['blackplastic'] = mat('blackplastic', (0.012, 0.012, 0.012), rough=0.42)
M['tin'] = mat('tin', (0.78, 0.78, 0.76), metal=1, rough=0.22)
M['alu'] = mat('alu', (0.78, 0.78, 0.77), metal=1, rough=0.2, brush='r', brush_amt=0.05,
               layers=(('capprint', (0.06, 0.06, 0.058), 0.0, 0.5),))
M['ceramic'] = mat('ceramic', (0.75, 0.74, 0.7), rough=0.5)
M['smdgray'] = mat('smdgray', (0.5, 0.5, 0.48), rough=0.45)
M['crystal'] = mat('crystal', (0.035, 0.022, 0.016), rough=0.4)
M['rubber'] = mat('rubber', (0.012, 0.012, 0.012), rough=0.36, coat=0.25, coat_rough=0.25)
M['wire_gray'] = mat('wire_gray', (0.085, 0.085, 0.082), rough=0.3, coat=0.9, coat_rough=0.08)
M['wire_dgray'] = mat('wire_dgray', (0.035, 0.035, 0.034), rough=0.3, coat=0.9, coat_rough=0.08)
M['wire_lgray'] = mat('wire_lgray', (0.14, 0.14, 0.135), rough=0.3, coat=0.9, coat_rough=0.08)
M['wire_red'] = mat('wire_red', (0.62, 0.03, 0.02), rough=0.3, coat=0.9, coat_rough=0.08)
M['wire_black'] = mat('wire_black', (0.01, 0.01, 0.01), rough=0.3, coat=0.9, coat_rough=0.08)
M['terminal'] = mat('terminal', (0.72, 0.72, 0.69), rough=0.45)
M['grommet'] = mat('grommet', (0.07, 0.07, 0.068), rough=0.55)


# ───────────────────────── geometry helpers ─────────────────────────
def put(name, data, m, col):
    o = bpy.data.objects.new(name, data); col.objects.link(o)
    if m: data.materials.append(m)
    return o


def arc(cx, cy, r, a0, a1, n=8):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def lpt(axis, c, a, r, th):
    if axis == 'X': return (a, c[1] - r * math.cos(th), -c[0] + r * math.sin(th))
    if axis == 'Y': return (c[0] + r * math.cos(th), a, -c[1] + r * math.sin(th))
    return (c[0] + r * math.cos(th), c[1] - r * math.sin(th), -a)            # 'Z': a = design y


def lathe(name, prof, c, axis='X', segs=160, m=None, col=BODY, sharp=32, rot0=0.0):
    """surface of revolution. prof = [(a, r)], must start and end at r = 0.
    X axis: c = (design y, depth); Y axis (toward camera): c = (x, y), a = depth; Z axis: c = (x, depth), a = design y"""
    bm = bmesh.new(); rings = []
    for a, r in prof:
        if r < 1e-6: rings.append([bm.verts.new(lpt(axis, c, a, 0, 0))])
        else: rings.append([bm.verts.new(lpt(axis, c, a, r, rot0 + TAU * k / segs)) for k in range(segs)])
    for R0, R1 in zip(rings, rings[1:]):
        if len(R0) == 1 and len(R1) == 1: continue
        for k in range(segs):
            k1 = (k + 1) % segs
            if len(R0) == 1: bm.faces.new((R0[0], R1[k], R1[k1]))
            elif len(R1) == 1: bm.faces.new((R0[k], R0[k1], R1[0]))
            else: bm.faces.new((R0[k], R0[k1], R1[k1], R1[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(sharp))
    return put(name, me, m, col)


def rrect(x0, y0, x1, y1, r=0.8, n=4, cr=None):
    tl, tr, br, bl = cr if cr else (r, r, r, r)
    pts = []
    pts += arc(x0 + tl, y0 + tl, tl, 180, 270, n) if tl else [(x0, y0)]
    pts += arc(x1 - tr, y0 + tr, tr, 270, 360, n) if tr else [(x1, y0)]
    pts += arc(x1 - br, y1 - br, br, 0, 90, n) if br else [(x1, y1)]
    pts += arc(x0 + bl, y1 - bl, bl, 90, 180, n) if bl else [(x0, y1)]
    out = []
    for p in pts:
        if not out or (abs(out[-1][0] - p[0]) > 1e-6 or abs(out[-1][1] - p[1]) > 1e-6): out.append(p)
    return out


def circle(cx, cy, r, n=72):
    return [(cx + r * math.cos(TAU * i / n), cy + r * math.sin(TAU * i / n)) for i in range(n)]


def slab(name, loops, d0, d1, bevel=0.0, bres=4, m=None, col=BODY, smooth=True):
    """outline(s) in design x/y (inner loops = holes) extruded along depth d0..d1, edges rounded by `bevel`"""
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '2D'; cu.fill_mode = 'BOTH'
    for loop in loops:
        sp = cu.splines.new('POLY'); sp.points.add(len(loop) - 1)
        for i, (x, y) in enumerate(loop): sp.points[i].co = (x, -y, 0, 1)
        sp.use_cyclic_u = True; sp.use_smooth = smooth
    cu.extrude = max(0.0, (d1 - d0) / 2 - bevel)
    cu.bevel_depth = bevel; cu.bevel_resolution = bres; cu.offset = -bevel if bevel else 0.0
    o = put(name, cu, m, col)
    o.rotation_euler = (math.pi / 2, 0, 0); o.location = (0, (d0 + d1) / 2, 0)
    return o


def path_pts(d):
    t = re.findall(r'[MC]|-?\d*\.?\d+', d); i = 0; segs = []; cur = None
    while i < len(t):
        if t[i] == 'M': cur = (float(t[i + 1]), float(t[i + 2])); i += 3; start = cur
        elif t[i] == 'C' or segs or cur:
            if t[i] == 'C': i += 1
            c1 = (float(t[i]), float(t[i + 1])); c2 = (float(t[i + 2]), float(t[i + 3])); p = (float(t[i + 4]), float(t[i + 5]))
            segs.append((cur, c1, c2, p)); cur = p; i += 6
    return start, segs


def cable(name, d, r, depth, m, col=CABLE):
    """SVG cubic path → bezier tube. depth: number or list per anchor point"""
    start, segs = path_pts(d)
    anchors = [start] + [s[3] for s in segs]
    dep = depth if isinstance(depth, (list, tuple)) else [depth] * len(anchors)
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = r; cu.bevel_resolution = 6; cu.use_fill_caps = True; cu.resolution_u = 24
    sp = cu.splines.new('BEZIER'); sp.bezier_points.add(len(anchors) - 1)
    V = lambda p, dd: Vector((p[0], dd, -p[1]))
    for i, a in enumerate(anchors):
        bp = sp.bezier_points[i]; bp.co = V(a, dep[i]); bp.handle_left_type = bp.handle_right_type = 'FREE'
    for i, (p0, c1, c2, p3) in enumerate(segs):
        sp.bezier_points[i].handle_right = V(c1, dep[i] * 2 / 3 + dep[i + 1] / 3)
        sp.bezier_points[i + 1].handle_left = V(c2, dep[i] / 3 + dep[i + 1] * 2 / 3)
    b0, b1 = sp.bezier_points[0], sp.bezier_points[-1]
    b0.handle_left = b0.co * 2 - b0.handle_right
    b1.handle_right = b1.co * 2 - b1.handle_left
    sp.use_smooth = True
    return put(name, cu, m, col)


def dome(name, cx, cy, rx, ry, rz, depth, m, col=BODY):
    """half-ellipsoid sitting on a surface at `depth`, bulging toward the camera by rz"""
    prof = [(depth + 0.0, 0.0)] + [(depth - rz * math.sin(math.radians(t)), math.cos(math.radians(t))) for t in range(0, 91, 6)]
    o = lathe(name, prof, (cx, cy), axis='Y', segs=64, m=m, col=col, sharp=80)
    # unit radius profile → scale in x / z around centre
    for v in o.data.vertices:
        v.co.x = cx + (v.co.x - cx) * rx
        v.co.z = -cy + (v.co.z + cy) * ry
    return o


def mirror(o, name, axis_x=322.0, col=BODY):
    """copy of a body part mirrored at x = 322 (the SVG does matrix(-1 0 0 1 644 0))"""
    c = o.copy(); c.data = o.data.copy(); c.name = name; col.objects.link(c)
    c.scale.x *= -1; c.location.x = 2 * axis_x - c.location.x
    return c


# ───────────────────────── 机身 ─────────────────────────
# 纵深（Y，负 = 朝相机）：侧墙前沿 −43、正面板前面 −40、辊子/轴承轴心 −15、电机轴心 +35、左立柱 +45、
# 电路板前面 −47.5、柔光箱 −500。前视图里看不出纵深，但它决定谁挡谁的反光（标定过程见 docs/FEEDER.md 第 6 节）
FR = -40.0           # flange front face

# 侧墙：前视轮廓 = SVG #wallP，往纵深拉伸成一块很深的钣金
wallP = ([(156.5, 71.5)] + arc(156.5, 76.0, 4.5, 270, 360, 6)[1:] + [(161, 470), (171.5, 470), (171.5, 476.5), (164.8, 487.4)]
         + [(162.8, 489.4), (159.4, 489.7)] + [(155.5, 488.6), (153.0, 485.5), (152, 478)] + arc(156.5, 76.0, 4.5, 180, 270, 6))
wallL = slab('wallL', [wallP], -43, 150, bevel=3.2, bres=5, m=M['wall'])
# 正面板（向内折的翻边）+ 倒角孔
flangeL = slab('flangeL', [rrect(159.5, 171.0, 194, 470.5, 1.2), circle(176, 418, 6.6)], FR, FR + 9, bevel=2.3, m=M['frame'])
lipL = lathe('lipL', [(159.5, 0), (159.5, 3.6), (160, 4.1), (193.5, 4.1), (194, 3.6), (194, 0)], (474.0, FR + 4.4), m=M['frame'])
# 面板后面的暗腔（孔里看到的就是它）
cavL = slab('cavL', [rrect(160, 172, 200, 470, 1)], FR + 9.5, FR + 30, m=M['interior'])
# 上方：y134–150 透空看到后板，y149–172 暗槽，导纸块
slab('backplate', [rrect(156, 113, 488, 176, 1)], 40, 46, m=M['backplate'])
slab('trough', [rrect(158, 149, 486, 172, 0.6)], FR + 6, 30, bevel=0.6, m=M['interior'])
guideL = slab('guideL', [rrect(183, 136.5, 194, 149, 1.0)], FR + 6, 10, bevel=0.6, m=M['guide'])

# 右侧架 = 镜像
for o, n in ((wallL, 'wallR'), (flangeL, 'flangeR'), (lipL, 'lipR'), (cavL, 'cavR'), (guideL, 'guideR')):
    c = mirror(o, n)
    if n in ('flangeR', 'lipR'): c.data.materials[0] = M['frameR']

# 辊子：拉丝不锈钢管 x158–492，r 21.5，中心 y113.5
RX, RY = -15.0, 113.5
roller = lathe('roller', [(158, 0), (158, 20.3), (158.8, 21.5),
                          (163.0, 21.5), (163.5, 20.8), (164.2, 20.8), (164.6, 21.5),
                          (479.4, 21.5), (479.8, 20.8), (480.5, 20.8), (481.0, 21.5),
                          (491.2, 21.5), (492, 20.3), (492, 0)], (RY, RX), segs=192, m=M['roller'])

# 轴承（侧看）x113–152.5，r 40，中心 y113：两侧亮边 + 中间抛光钢
BY = 113.0
prof = [(113, 0), (113, 36.5)] + [(113 + 3.5 - 3.5 * math.cos(math.radians(t)), 36.5 + 3.5 * math.sin(math.radians(t))) for t in range(15, 91, 15)]
prof += [(118.6, 40), (120.0, 38.6), (120.2, 37.3), (145.3, 37.3), (145.5, 38.6), (146.9, 40)]
prof += [(152.5 - 3.5 + 3.5 * math.sin(math.radians(t)), 36.5 + 3.5 * math.cos(math.radians(t))) for t in range(0, 91, 15)] + [(152.5, 0)]
lathe('bearing', prof, (BY, RX), segs=192, m=M['bearing'])
# 轴头 x105–115
lathe('axleL', [(105, 0), (105, 6.5)] + [(105 + 3 - 3 * math.cos(math.radians(t)), 6.5 + 3 * math.sin(math.radians(t))) for t in range(15, 91, 15)] + [(115, 9.5), (115, 0)],
      (111.5, RX), segs=96, m=M['steel'])
# 右端轴头螺母 x491.6–500（六角，平面朝前）
lathe('nutR', [(491.6, 0), (491.6, 9.6), (492.5, 10.8), (499.1, 10.8), (500, 9.6), (500, 0)], (111.5, RX), segs=6, rot0=math.pi / 6, m=M['steel'], sharp=20)
# 两侧墙上的铆钉
dome('rivetL', 156.6, 143, 2.4, 5.0, 1.6, -43, M['steel'])
dome('rivetR', 487.4, 143, 2.4, 5.0, 1.6, -43, M['steel'])

# 面板上的螺丝（十字在 engrave 遮罩里）
dome('screwL', 168, 190, 4.3, 4.3, 1.9, FR, M['steel'])
dome('screwR', 476, 188, 4.3, 4.3, 1.9, FR, M['steel'])
# 右板小立柱 x470–483 y203–219（竖放的小圆柱，一半嵌在板里）
lathe('studR', [(203, 0), (203, 3.6)] + [(203 + 3 - 3 * math.cos(math.radians(t)), 3.6 + 2.9 * math.sin(math.radians(t))) for t in range(15, 91, 15)]
      + [(216, 6.5)] + [(216 + 3 * math.sin(math.radians(t)), 3.6 + 2.9 * math.cos(math.radians(t))) for t in range(15, 91, 15)] + [(219, 0)],
      (476.5, FR - 1.0), axis='Z', segs=96, m=M['steel'])

# 左立柱（侧看，轴朝左）x124–153，y171–201
lathe('studL', [(124, 0), (124, 10.5)] + [(124 + 4.5 - 4.5 * math.cos(math.radians(t)), 10.5 + 4.5 * math.sin(math.radians(t))) for t in range(15, 91, 15)]
      + [(130.2, 15), (130.6, 14.2), (131.0, 15), (146.2, 15), (146.6, 14.0), (147.2, 15.3), (153, 15.3), (153, 0)],
      (186, 45), segs=128, m=M['steel'])

# 电机：横放的罐 x63–147，r 75，中心 y297；左端圆角 r23；端盖接缝 x86.5；右端两道法兰线
MY, MD = 297.0, 35.0
prof = [(63, 0), (63, 52)] + [(86 - 23 * math.cos(math.radians(t)), 52 + 23 * math.sin(math.radians(t))) for t in range(4, 91, 4)]
prof += [(86.2, 75), (86.4, 74.0), (86.9, 74.0), (87.1, 75),
         (137.2, 75), (137.4, 74.2), (137.9, 74.2), (138.1, 75),
         (141.2, 75), (141.4, 74.2), (141.9, 74.2), (142.1, 75), (146.4, 75), (147, 74.2), (147, 0)]
lathe('motor', prof, (MY, MD), segs=256, m=M['motor'])
lathe('motorShaft', [(57.2, 0), (57.2, 6.5)] + [(57.2 + 3.5 - 3.5 * math.cos(math.radians(t)), 6.5 + 4 * math.sin(math.radians(t))) for t in range(15, 91, 15)] + [(64, 10.5), (64, 0)],
      (294, MD), segs=96, m=M['steel'])
lathe('motorMount', [(144, 0), (144, 69), (153, 69), (153, 0)], (MY, MD), segs=160, m=M['darkmetal'])
lathe('motorMountRing', [(146.0, 0), (146.0, 69.4), (147.4, 69.4), (147.4, 0)], (MY, MD), segs=160, m=M['steel'])
# 卡扣折片 x158.5–173.5 y271–321，带竖槽
slab('tab', [rrect(158.5, 271, 173.5, 321, 0.6, cr=(0.6, 3.5, 3.5, 0.6)), rrect(163, 278, 168.2, 314, 2.4)], -46.5, -43, bevel=0.9, m=M['frame'])
slab('tabSlot', [rrect(162.6, 277.6, 168.6, 314.4, 2.4)], -44.6, -43.2, m=M['interior'])

# ───────────────────────── 电路板 ─────────────────────────
PF = -47.5                      # board front face：板子在辊子前上方，挡住辊子上沿的反光（参考里辊子上沿比轴承同角度暗）
slab('pcb', [rrect(175, -50, 475, 82, 0, cr=(0, 0, 6, 6)), circle(466, 49, 7.0), circle(240, 69, 6.6)], PF, PF + 6, bevel=0.9, m=M['pcb'])
# 芯片（两个定位坑是上层挖的洞）+ 下沿一排引脚
slab('chip', [rrect(298, -50, 456, 34, 2.4)], PF - 10, PF, bevel=1.2, m=M['epoxy'])
slab('chipTop', [rrect(298, -50, 456, 34, 2.4), circle(326, 12, 6.4), circle(431, 12, 6.4)], PF - 12.5, PF - 9.5, bevel=1.0, m=M['epoxy'])
for i in range(16):
    x = 304.5 + i * 9.4
    slab(f'pin{i}', [rrect(x, 27.8, x + 4.4, 31.2, 0.6)], PF - 13.4, PF - 12.0, bevel=0.35, bres=2, m=M['tin'])
# 两排母座
for j, (x0, n) in enumerate(((292, 8), (388, 6))):
    w = n * 11.2 + 2
    holes = [rrect(x0 + 2.2 + i * 11.2, 66.4, x0 + 10 + i * 11.2, 74.8, 0.4) for i in range(n)]
    slab(f'hdr{j}', [rrect(x0, 64, x0 + w, 77.5, 1.2)] + holes, PF - 11, PF - 2, bevel=0.6, m=M['blackplastic'])
    slab(f'hdrBack{j}', [rrect(x0 + 1, 65, x0 + w - 1, 76.5, 0.5)], PF - 2.2, PF, m=M['blackplastic'])
# 电源座 + 金属套 + 小针
slab('jack', [rrect(167, 20, 229, 64, 3.0)], PF - 40, PF, bevel=3.0, m=M['blackplastic'])
lathe('jackRing', [(229, 0), (229, 16.2), (229.6, 17), (234.4, 17), (235, 16.2), (235, 0)], (42, PF - 20), segs=96, m=M['steel'])
slab('jackPin', [rrect(235, 37, 242, 43, 1)], PF - 23, PF - 17, bevel=1, m=M['tin'])
# 电解电容（俯视）
for nm, cx in (('capA', 255), ('capB', 285)):
    prof = [(PF + 0.5, 0), (PF + 0.5, 14), (PF - 26, 14)] + [(PF - 26 - 2.4 * math.sin(math.radians(t)), 11.6 + 2.4 * math.cos(math.radians(t))) for t in range(10, 91, 10)] + [(PF - 28.4, 0)]
    lathe(nm, prof, (cx, 40), axis='Y', segs=128, m=M['alu'], sharp=40)
lathe('capS', [(PF + 0.5, 0), (PF + 0.5, 6), (PF - 9, 6)] + [(PF - 9 - 1.4 * math.sin(math.radians(t)), 4.6 + 1.4 * math.cos(math.radians(t))) for t in range(15, 91, 15)] + [(PF - 10.4, 0)],
      (214, 70), axis='Y', segs=64, m=M['alu'], sharp=40)
dome('domeS', 192, 70, 3.6, 3.6, 2.4, PF, M['tin'])
# 晶振 / 贴片
slab('xtal', [rrect(268.9, 63, 281.1, 72, 0.6)], PF - 4, PF, bevel=0.6, m=M['crystal'])
slab('xtalL', [rrect(265.5, 63, 268.9, 72, 1)], PF - 4.4, PF, bevel=0.8, m=M['tin'])
slab('xtalR', [rrect(281.1, 63, 284.5, 72, 1)], PF - 4.4, PF, bevel=0.8, m=M['tin'])
slab('smd1', [rrect(187, -2, 197, 9, 1)], PF - 3, PF, bevel=0.6, m=M['ceramic'])
slab('reg', [rrect(201, -6, 213, 16, 2.5)], PF - 5, PF, bevel=1.0, m=M['blackplastic'])
slab('smd2', [rrect(216, 0, 228, 7, 1)], PF - 2.4, PF, bevel=0.5, m=M['smdgray'])
slab('smd3', [rrect(216, 9, 228, 15, 1)], PF - 2.4, PF, bevel=0.5, m=M['smdgray'])
for i, (x, y) in enumerate(((257, 6), (263, 6), (272, 6), (278, 6), (257, 14), (278, 14))):
    slab(f'tiny{i}', [rrect(x, y, x + 3.4, y + 3.4, 0.4)], PF - 1.8, PF, bevel=0.3, bres=2, m=M['blackplastic'])
slab('ledBase', [rrect(440, 54.5, 447, 58.5, 1)], PF - 1.6, PF, bevel=0.3, bres=2, m=M['crystal'])

# ───────────────────────── 线缆（后层） ─────────────────────────
cable('wA', 'M4 -110C3 -70 3.4 -50 4 -30C2 70 40 150 100 196C118 208 136 214 158 216', 5.0, 70, M['rubber'])
cable('wBk', 'M117 368C115 410 123 448 158 457', 2.8, 50, M['wire_black'])
cable('wRd', 'M126 368C125 404 131 436 158 447', 2.8, 47, M['wire_red'])
BUNDLE = [('w4', 'M488 183C512 183 531 212 531 262C531 304 507 330 501 352C496 370 508 386 512 405C515 421 505 435 488 441', M['wire_gray'], 2.7),
          ('w3', 'M488 177C516 175 537 207 537 257C537 300 517 333 505 353C496 368 516 383 516 404C516 425 511 441 488 447', M['wire_dgray'], 2.7),
          ('wR', 'M488 190C514 190 526 206 526 240C526 290 518 322 509 348C501 371 520 389 519 408C518 424 508 432 488 433', M['wire_red'], 2.6),
          ('w5', 'M506 216C516 232 520 250 520 270C520 304 510 330 507 352C503 372 525 392 521 412C518 428 507 433 488 436', M['wire_lgray'], 2.7),
          ('w2', 'M488 171C521 166 543 202 543 253C543 298 525 327 510 350C498 370 511 383 524 402C535 421 522 445 488 453', M['wire_dgray'], 2.7),
          ('w1', 'M488 165C526 158 549 196 549 248C549 300 530 330 513 352C501 368 503 386 520 404C533 419 528 447 488 459', M['wire_gray'], 2.7)]
for i, (n, d, m, r) in enumerate(BUNDLE):
    up, lo = 34 - 3.4 * i, 34 - 3.4 * (5 - i)        # 上圈和下圈前后顺序相反 = 绞了一下
    cable(n, d, r, [up, up, 26, lo, lo], m)
cable('wT', 'M484 207C488 207 492 207 496 207', 2.7, 18, M['wire_lgray'])
slab('terminal', [rrect(495, 202, 508, 216, 1.6)], 9, 25, bevel=1.2, m=M['terminal'], col=CABLE)
slab('termTop', [rrect(495.6, 202.6, 507.4, 206, 1)], 8.2, 9.5, bevel=0.4, m=M['tin'], col=CABLE)
slab('grommet', [rrect(489, 369, 499, 385, 4)], 14, 30, bevel=2.5, m=M['grommet'], col=CABLE)

# 纸：只给反光和反射用，相机看不见
paper = slab('paperProxy', [rrect(194, 115, 450, 760, 0.5)], -51, -50, m=M['paper'], col=HELP)
paper.visible_camera = False; paper.visible_shadow = False

# ───────────────────────── 灯：柔光箱 + 左侧反光板（相机看不见）─────────────────────────
def emitter(name, quad, strength=1.0, yramp=None):
    me = bpy.data.meshes.new(name); me.from_pydata([Vector(v) for v in quad], [], [(0, 1, 2, 3)])
    em = bpy.data.materials.new(name); em.use_nodes = True; nt = em.node_tree; N = nt.nodes
    for n in list(N): N.remove(n)
    es = N.new('ShaderNodeEmission'); out = N.new('ShaderNodeOutputMaterial'); link(nt, es.outputs[0], out.inputs['Surface'])
    es.inputs['Color'].default_value = (1.0, 0.995, 0.985, 1)
    if yramp:
        geo = N.new('ShaderNodeNewGeometry'); sp = N.new('ShaderNodeSeparateXYZ'); link(nt, geo.outputs['Position'], sp.inputs[0])
        neg = N.new('ShaderNodeMath'); neg.operation = 'MULTIPLY'; link(nt, sp.outputs['Z'], neg.inputs[0]); neg.inputs[1].default_value = -1
        y0, y1 = yramp[0][0], yramp[-1][0]
        mr = N.new('ShaderNodeMapRange'); link(nt, neg.outputs[0], mr.inputs['Value'])
        mr.inputs['From Min'].default_value = y0; mr.inputs['From Max'].default_value = y1
        cr = N.new('ShaderNodeValToRGB'); link(nt, mr.outputs['Result'], cr.inputs['Fac']); el = cr.color_ramp.elements
        while len(el) > 1: el.remove(el[-1])
        el[0].position = 0; el[0].color = (yramp[0][1],) * 3 + (1,)
        for yy, v in yramp[1:]:
            e = el.new((yy - y0) / (y1 - y0)); e.color = (v, v, v, 1)
        sep_ = N.new('ShaderNodeSeparateColor'); link(nt, cr.outputs['Color'], sep_.inputs[0])
        link(nt, sep_.outputs[0], es.inputs['Strength'])
    else:
        es.inputs['Strength'].default_value = strength
    me.materials.append(em)
    o = bpy.data.objects.new(name, me); HELP.objects.link(o); o.visible_camera = False
    return o


SB = SOFTBOX
emitter('softbox', [(SB['x0'], SB['depth'], -SB['ramp'][0][0]), (SB['x1'], SB['depth'], -SB['ramp'][0][0]),
                    (SB['x1'], SB['depth'], -SB['ramp'][-1][0]), (SB['x0'], SB['depth'], -SB['ramp'][-1][0])], yramp=SB['ramp'])
SC_ = SIDECARD
emitter('sidecard', [(SC_['x'], SC_['d0'], -SC_['y0']), (SC_['x'], SC_['d1'], -SC_['y0']),
                     (SC_['x'], SC_['d1'], -SC_['y1']), (SC_['x'], SC_['d0'], -SC_['y1'])], strength=SC_['strength'])

# ───────────────────────── world / camera / render ─────────────────────────
wd = bpy.data.worlds.new('studio'); sc.world = wd; wd.use_nodes = True
nt = wd.node_tree; N = nt.nodes
for n in list(N): N.remove(n)
tc = N.new('ShaderNodeTexCoord'); nrm = N.new('ShaderNodeVectorMath'); nrm.operation = 'NORMALIZE'
link(nt, tc.outputs['Generated'], nrm.inputs[0])
sep = N.new('ShaderNodeSeparateXYZ'); link(nt, nrm.outputs[0], sep.inputs[0])


def ramp(points, z_sock):
    mr = N.new('ShaderNodeMapRange'); link(nt, z_sock, mr.inputs['Value'])
    mr.inputs['From Min'].default_value = -1; mr.inputs['From Max'].default_value = 1
    cr = N.new('ShaderNodeValToRGB'); link(nt, mr.outputs['Result'], cr.inputs['Fac'])
    el = cr.color_ramp.elements
    while len(el) > 1: el.remove(el[-1])
    pts = sorted(((math.sin(math.radians(e)) + 1) / 2, v) for e, v in points)
    el[0].position = pts[0][0]; el[0].color = (pts[0][1],) * 3 + (1,)
    for p, v in pts[1:]:
        e = el.new(p); e.color = (v, v, v, 1)
    return cr.outputs['Color']


E = ENV
front = ramp(FRONT, sep.outputs['Z'])
back = ramp(BACK, sep.outputs['Z'])
wf = N.new('ShaderNodeMapRange'); link(nt, sep.outputs['Y'], wf.inputs['Value']); wf.interpolation_type = 'SMOOTHSTEP'
wf.inputs['From Min'].default_value = 0.25; wf.inputs['From Max'].default_value = -0.45
mixw = N.new('ShaderNodeMix'); mixw.data_type = 'RGBA'
link(nt, wf.outputs['Result'], mixw.inputs[0]); link(nt, back, sock(mixw, 'A_Color')); link(nt, front, sock(mixw, 'B_Color'))
lr = N.new('ShaderNodeMapRange'); link(nt, sep.outputs['X'], lr.inputs['Value'])
lr.inputs['From Min'].default_value = -1; lr.inputs['From Max'].default_value = 1
lr.inputs['To Min'].default_value = 1 + E['left']; lr.inputs['To Max'].default_value = 1 - E['left']
bg = N.new('ShaderNodeBackground'); link(nt, sock(mixw, 'Result_Color', out=True), bg.inputs['Color'])
mul = N.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; link(nt, lr.outputs['Result'], mul.inputs[0]); mul.inputs[1].default_value = E['strength']
link(nt, mul.outputs[0], bg.inputs['Strength'])
wo = N.new('ShaderNodeOutputWorld'); link(nt, bg.outputs[0], wo.inputs['Surface'])

cd = bpy.data.cameras.new('cam'); cd.type = 'ORTHO'; cd.ortho_scale = FRAME[3] - FRAME[1]
cd.clip_start = 1; cd.clip_end = 20000
cam = bpy.data.objects.new('cam', cd); HELP.objects.link(cam)
cam.location = ((FRAME[0] + FRAME[2]) / 2, -5000, -(FRAME[1] + FRAME[3]) / 2); cam.rotation_euler = (math.pi / 2, 0, 0)
sc.camera = cam
r = sc.render
r.resolution_x = round((FRAME[2] - FRAME[0]) * A.scale); r.resolution_y = round((FRAME[3] - FRAME[1]) * A.scale); r.resolution_percentage = 100
r.film_transparent = True
r.image_settings.file_format = 'PNG'; r.image_settings.color_mode = 'RGBA'; r.image_settings.color_depth = '16'
sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
try: r.engine = 'CYCLES'
except TypeError as e: print('engine', e)
cy = sc.cycles
prefs = bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for dv in prefs.devices: dv.use = True
    cy.device = 'GPU'
except Exception as e: print('gpu', e)
cy.samples = A.samples; cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.01
cy.use_denoising = True
try: cy.denoiser = 'OPENIMAGEDENOISE'
except Exception: pass
cy.max_bounces = 10; cy.glossy_bounces = 6; cy.diffuse_bounces = 4; cy.transparent_max_bounces = 8
cy.caustics_reflective = False; cy.caustics_refractive = False; cy.blur_glossy = 0.5
wd.cycles.sampling_method = 'MANUAL'; wd.cycles.sample_map_resolution = 1024
if A.region:
    x0, y0, x1, y1 = map(float, A.region.split(','))
    W_, H_ = FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]
    r.use_border = True; r.use_crop_to_border = False
    r.border_min_x = (x0 - FRAME[0]) / W_; r.border_max_x = (x1 - FRAME[0]) / W_
    r.border_min_y = 1 - (y1 - FRAME[1]) / H_; r.border_max_y = 1 - (y0 - FRAME[1]) / H_

for o in BODY.all_objects: o.visible_camera = (A.pss == 'front')
for o in CABLE.all_objects: o.visible_camera = (A.pss == 'back')

if A.save: bpy.ops.wm.save_as_mainfile(filepath=A.save)
if A.out:
    r.filepath = A.out
    bpy.ops.render.render(write_still=True)
    print('rendered', A.out)
