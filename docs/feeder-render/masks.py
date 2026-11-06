"""刻痕 / 丝印遮罩：用 Chromium 把图标、刻字栅格化成灰度图，跟页面里的 SVG 热区逐像素对齐。
画布 = 设计坐标 x 0..575、y −56..720，每设计 px 4 个像素；白 = 有字/有刻痕。

  python3 masks.py <输出目录>        （需要 Python 版 playwright + Chromium、Pillow）
"""
import sys, os
from PIL import Image
from playwright.sync_api import sync_playwright
out = sys.argv[1]
MONO = "'Space Mono','JetBrains Mono','IBM Plex Mono',Menlo,Consolas,monospace"
pins = ''.join(f'<rect x="{304.5+i*9.4:.1f}" y="27.8" width="4.4" height="3.4" rx=".6"/>' for i in range(16))
MASKS = {
 # engraved into metal (motor icons, end-cap marks, roller text, side text, screw crosses)
 'engrave': f'''
  <g fill="none" stroke="#fff" stroke-linecap="round">
    <g stroke-width="2.7"><circle cx="106.5" cy="248.5" r="4.4"/><path d="M110.9 244.5V250.6Q110.9 254 114 254Q117.6 254 117.6 248.5A11.1 11.1 0 1 0 112.6 257.8"/></g>
    <g stroke-width="2.1"><circle cx="106.5" cy="334" r="10.6"/><path d="M98 327.5Q106.5 333 115 327.5M98 340.5Q106.5 335 115 340.5"/><path d="M106.5 323.4Q100.6 334 106.5 344.6M106.5 323.4Q112.4 334 106.5 344.6"/></g>
    <g stroke-width="1.1"><rect x="73" y="261.5" width="9" height="9" rx="1.6"/><rect x="73" y="337.5" width="9" height="9" rx="1.6"/></g>
    <g stroke-width="1.05"><path d="M165.9 190H170.1M168 187.9V192.1M473.9 188H478.1M476 185.9V190.1"/></g>
  </g>
  <rect x="95" y="281" width="23" height="23" rx="2.2" fill="#fff"/>
  <rect x="99.5" y="287" width="14" height="10.5" rx="1" fill="#000"/>
  <path d="M100 287.8L106.5 293L113 287.8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
  <g font-family="{MONO}" fill="#fff" text-anchor="middle">
    <text x="323" y="116.6" font-size="12.2" letter-spacing="1.5">DESIGN | CODE | MOTION | SHIP</text>
    <text transform="translate(467 312) rotate(-90)" font-size="9.6" letter-spacing="1.15">SCROLL TO EXPLORE</text>
  </g>''',
 # copper traces + vias under the solder mask
 'traces': '''
  <g fill="none" stroke="#fff" stroke-width="1.1">
    <path d="M236 -6H286V14H294"/><path d="M236 2H280V22H294"/><path d="M188 40V30H200"/>
    <path d="M300 52H322L328 58H388"/><path d="M462 -30V36"/><path d="M290 40V54"/>
    <path d="M176 -40H200V-20M420 40H440V50M188 52V60H230"/>
  </g>
  <g fill="#fff"><circle cx="294" cy="14" r="1.6"/><circle cx="294" cy="22" r="1.6"/><circle cx="290" cy="54" r="1.6"/><circle cx="462" cy="36" r="1.6"/></g>''',
 # white silkscreen on the board
 'silk': '''
  <path d="M325 43H456" stroke="#fff" stroke-width="1.1"/><path d="M392 46H456" stroke="#fff" stroke-width=".9"/>
''',
 # dark print on capacitor tops + chip dimples + chip pins (separate channels used as masks)
 'capprint': '''<g font-family="Inter,Arial,sans-serif" font-size="6.6" font-weight="700" fill="#fff" text-anchor="middle">
    <text x="255" y="42">100µ</text><text x="285" y="42">16V</text></g>''',
}
html = '<html><body style="margin:0;background:#000">{}</body></html>'
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 575, 'height': 776}, device_scale_factor=4)
    for name, body in MASKS.items():
        svg = f'<svg width="575" height="776" viewBox="0 -56 575 776" style="display:block">{body}</svg>'
        pg.set_content(html.format(svg)); pg.wait_for_timeout(150)
        p_ = os.path.join(out, name + '.png'); pg.screenshot(path=p_)
        Image.open(p_).convert('L').save(p_)
    b.close()
print('masks →', out)
