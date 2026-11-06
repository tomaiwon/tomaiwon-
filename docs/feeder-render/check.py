"""FEEDER.md 第 5 节的回归，一次跑完：走纸 / 悬停速度、拖 100、滚轮正反、logo 依次虚→空→依次显、
电机三个入口命中 + 悬停加深、窄屏电路板遮罩、四个尺寸截图、控制台报错。

  python3 check.py <page.html> <名字> <截图目录>     （需要 Python 版 playwright + Chromium）
期望：idle ≈19（设计坐标 px/s）、hover ≈5、drag_100 = 100（屏幕 px）、wheel 一正一负、logo_gone/back 各差 ~75ms、console 为空
"""
import sys, json, statistics
from playwright.sync_api import sync_playwright
import os
page_path, tag, outdir = os.path.abspath(sys.argv[1]), sys.argv[2], sys.argv[3]
os.makedirs(outdir, exist_ok=True)
R = {}
TY = "parseFloat(getComputedStyle(document.querySelector('#strip')).transform.split(',')[5])"
SETH = "(()=>{let h=0;document.querySelectorAll('#strip .card').forEach((c,i)=>{if(i<7)h+=c.offsetHeight+3});return h})()"
def speed(pg, secs=2.0, n=8):
    setH = pg.evaluate(SETH); vals = []; prev = pg.evaluate(TY)
    for _ in range(n):
        pg.wait_for_timeout(secs * 1000 / n); cur = pg.evaluate(TY)
        d = cur - prev
        if d < -setH / 2: d += setH
        if d > setH / 2: d -= setH
        vals.append(d / (secs / n)); prev = cur
    return round(statistics.median(vals), 1)
with sync_playwright() as p:
    b = p.chromium.launch()
    errs = []
    pg = b.new_page(viewport={'width': 1094, 'height': 720})
    pg.on('console', lambda m: errs.append(m.text) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('file://' + page_path)
    # logo sequence: poll opacity of the 4 logos across the first swap (t = 4s)
    pg.evaluate("""() => { window.__lg = []; const t0 = performance.now();
      const tick = () => { const o = [...document.querySelectorAll('#logos .lg')].map(e => +getComputedStyle(e).opacity);
        window.__lg.push([Math.round(performance.now() - t0), o]); if (performance.now() - t0 < 6000) requestAnimationFrame(tick); };
      requestAnimationFrame(tick); }""")
    pg.wait_for_timeout(700)
    R['idle_px_s'] = speed(pg)
    box = pg.locator('#paper').bounding_box()
    cx, cy = box['x'] + box['width'] / 2, min(box['y'] + 300, 700)
    pg.mouse.move(cx, cy); pg.wait_for_timeout(1800)
    R['hover_px_s'] = speed(pg)
    # drag 100 screen px → paper moves 100 screen px
    pg.mouse.down(); a = pg.evaluate(TY)
    for i in range(1, 11): pg.mouse.move(cx, cy + i * 10)
    c = pg.evaluate(TY); pg.mouse.up()
    setH = pg.evaluate(SETH); d = c - a
    if d < -setH / 2: d += setH
    sc = pg.evaluate("new DOMMatrix(getComputedStyle(document.querySelector('#rig')).transform).a")
    R['drag_100'] = round(d * sc, 1)      # 屏幕 px：纸跟手 1:1（strip 的位移是设计坐标，乘回机器缩放）
    pg.mouse.move(20, 20); pg.wait_for_timeout(1500)
    # wheel forward / backward
    a = pg.evaluate(TY); pg.mouse.wheel(0, 400); pg.wait_for_timeout(250); c = pg.evaluate(TY)
    R['wheel_down_moves'] = round(((c - a + setH / 2) % setH) - setH / 2, 1)
    pg.wait_for_timeout(1500)
    a = pg.evaluate(TY); pg.mouse.wheel(0, -1200); pg.wait_for_timeout(250); c = pg.evaluate(TY)
    R['wheel_up_moves'] = round(((c - a + setH / 2) % setH) - setH / 2, 1)
    # logo analysis
    pg.wait_for_timeout(max(0, 6200 - 700 - 2000 - 1800 - 1500 - 250 - 1500 - 250))
    lg = pg.evaluate('window.__lg')
    def first(cond_i, after=0):
        out = []
        for i in range(4):
            t = next((t for t, o in lg if t > after and cond_i(o[i])), None); out.append(t)
        return out
    gone = first(lambda v: v < 0.05, 3500)
    back = first(lambda v: v > 0.95, max(gone) if None not in gone else 3500)
    allzero = [t for t, o in lg if t > 3500 and max(o) < 0.05]
    R['logo_gone_ms'] = gone; R['logo_back_ms'] = back
    R['logo_all_blank_ms'] = [allzero[0], allzero[-1]] if allzero else None
    # icon hotspots: centre of each <a class=ico> hits that link; hover darkens ink
    ico = []
    for i in range(3):
        bb = pg.locator('a.ico').nth(i).bounding_box()
        x, y = bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
        hit = pg.evaluate(f"(() => {{ const e = document.elementFromPoint({x},{y}); const a = e && e.closest('a.ico'); return a ? a.getAttribute('aria-label') : (e ? e.tagName + '#' + e.id : null) }})()")
        pg.mouse.move(x, y); pg.wait_for_timeout(300)
        ink = pg.evaluate(f"(() => {{ const a = document.querySelectorAll('a.ico')[{i}]; const k = a.querySelector('.ink,.inkf'); const s = getComputedStyle(k); return k.classList.contains('inkf') ? s.fill : s.stroke }})()")
        ico.append({'hit': hit, 'hover_ink': ink, 'href': pg.locator('a.ico').nth(i).get_attribute('href')})
    R['icons'] = ico
    pg.mouse.move(20, 20); pg.wait_for_timeout(400)
    pg.screenshot(path=f'{outdir}/{tag}_1094x720.png')
    pg.close()
    for (w, h) in ((1920, 1080), (1000, 1000), (390, 844)):
        q = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2 if w == 390 else 1)
        q.on('console', lambda m: errs.append(m.text) if m.type in ('error', 'warning') else None)
        q.on('pageerror', lambda e: errs.append(str(e)))
        q.goto('file://' + page_path); q.wait_for_timeout(1200)
        q.screenshot(path=f'{outdir}/{tag}_{w}x{h}.png')
        if w == 390:
            R['narrow_pcb_mask'] = q.evaluate("document.querySelector('#pcb').getAttribute('mask')")
            # copy block bottom vs machine top
            R['narrow_copy_bottom'] = q.evaluate("Math.round(document.querySelector('#copy').getBoundingClientRect().bottom)")
            R['narrow_roller_top'] = q.evaluate("(() => { const m = new DOMMatrix(getComputedStyle(document.querySelector('#rig')).transform); return Math.round(m.f + 92 * m.a) })()")
        q.close()
    R['console'] = errs
    b.close()
print(json.dumps(R, ensure_ascii=False))
json.dump(R, open(f'{outdir}/{tag}_regress.json', 'w'), ensure_ascii=False, indent=1)
