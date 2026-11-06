"""把 slice.py 切好的三张 PNG 以 data URI 嵌进 feeder.html，只替换机器的两个 <svg> 块（后层线缆、前层 #front），
纸带 / 动效 / 交互代码一个字不动。可以反复跑：按注释开头「后层：线缆」「前层：辊子」定位。

  python3 embed.py <feeder.html> <slice.py 的输出目录> [输出 html，默认原地改]
"""
import sys, json, base64, re
src, outdir = sys.argv[1], sys.argv[2]
dst = sys.argv[3] if len(sys.argv) > 3 else src
html = open(src, encoding='utf-8').read()
P = json.load(open(f'{outdir}/placement.json'))
def img(name):
    b64 = base64.b64encode(open(f'{outdir}/{name}.png', 'rb').read()).decode()
    p = P[name]; f = lambda v: ('%g' % v)
    return f'<image x="{f(p["x"])}" y="{f(p["y"])}" width="{f(p["w"])}" height="{f(p["h"])}" href="data:image/png;base64,{b64}"/>'

back_old = re.search(r'  <!-- ═══ 后层：线缆.*?</svg>\n', html, re.S).group(0)
front_old = re.search(r'  <!-- ═══ 前层：辊子.*?</svg>\n', html, re.S).group(0)
assert back_old.count('<svg') == 1 and front_old.count('<svg id="front"') == 1

back_new = f'''  <!-- ═══ 后层：线缆。Blender 渲染的透明 PNG（2 倍图，怎么重渲见 docs/feeder-render/）。两端都塞进侧板 / 电机后面，所以画在最底下 ═══ -->
  <svg width="575" height="720" viewBox="0 0 575 720" aria-hidden="true">
    {img('cables')}
  </svg>
'''
front_new = f'''  <!-- ═══ 前层：辊子、轴承、钣金侧架、电机、电路板。Blender 渲染的透明 PNG（2 倍图），纸带窗口 x194–450、y134 以下挖空。
       电路板单独一张，窄屏时 layout() 给 #pcb 挂渐隐遮罩；轴承刻线、电机入口热区、指示灯仍是 SVG ═══ -->
  <svg id="front" width="575" height="720" viewBox="0 0 575 720">
    <defs>
      <filter id="ledGlow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="2.4"/></filter>
      <!-- 窄屏用：电路板上沿在桌面上伸出视口看不到，手机上会整块露出来，改成往上渐隐 -->
      <linearGradient id="gPcbFade" x1="0" y1="-50" x2="0" y2="24" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#000"/><stop offset=".35" stop-color="#000"/><stop offset="1" stop-color="#fff"/>
      </linearGradient>
      <mask id="pcbFade" maskUnits="userSpaceOnUse" x="150" y="-60" width="360" height="160">
        <rect x="150" y="-60" width="360" height="160" fill="url(#gPcbFade)"/>
      </mask>
      <clipPath id="clipBear"><rect x="120" y="73" width="25.5" height="80"/></clipPath>
      <!-- 邮件入口悬停时压深刻痕，信封那块凸起不压 -->
      <mask id="mailInk" maskUnits="userSpaceOnUse" x="94" y="280" width="25" height="25">
        <rect x="95" y="281" width="23" height="23" rx="2.2" fill="#fff"/>
        <rect x="99.5" y="287" width="14" height="10.5" rx="1" fill="#000"/>
        <path d="M100 287.8L106.5 293L113 287.8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
      </mask>
    </defs>

    {img('body')}

    <!-- 轴承表面刻线随走纸转（很淡，只给一点转动感） -->
    <g clip-path="url(#clipBear)"><g id="knurl" stroke-width=".9"></g></g>

    <!-- 电机罐上三个入口：图案已经刻在渲染图里，这里只留透明热区；悬停时把刻痕压深 -->
    <g id="motor">
      <a class="ico" href="https://www.instagram.com/yellwork_/" aria-label="Instagram @yellwork_"><title>Instagram @yellwork_</title>
        <rect x="94" y="236" width="25" height="25" fill="transparent"/>
        <g class="ink" fill="none" stroke-width="2.7" stroke-linecap="round" stroke="transparent" opacity=".6">
          <circle cx="106.5" cy="248.5" r="4.4"/><path d="M110.9 244.5V250.6Q110.9 254 114 254Q117.6 254 117.6 248.5A11.1 11.1 0 1 0 112.6 257.8"/></g>
      </a>
      <a class="ico" href="mailto:yihuangart09@gmail.com" aria-label="邮件 yihuangart09@gmail.com"><title>邮件 yihuangart09@gmail.com</title>
        <rect x="94" y="280" width="25" height="25" fill="transparent"/>
        <rect class="inkf" x="95" y="281" width="23" height="23" rx="2.2" fill="transparent" opacity=".6" mask="url(#mailInk)"/>
      </a>
      <a class="ico" href="https://yihuang.art" aria-label="个人网站 yihuang.art"><title>yihuang.art</title>
        <rect x="95" y="322" width="24" height="24" fill="transparent"/>
        <g class="ink" fill="none" stroke-width="2.1" stroke="transparent" opacity=".6">
          <circle cx="106.5" cy="334" r="10.6"/><path d="M98 327.5Q106.5 333 115 327.5M98 340.5Q106.5 335 115 340.5"/><path d="M106.5 323.4Q100.6 334 106.5 344.6M106.5 323.4Q112.4 334 106.5 344.6"/></g>
      </a>
    </g>

    <!-- 电路板（上沿伸出视口） -->
    <g id="pcb">
      {img('pcb')}
      <!-- parts() 还会往这两个组里生成焊点和母座；渲染图里已经有了，所以藏起来 -->
      <g id="pins" display="none"></g><g id="hdr" display="none"></g>
      <!-- 指示灯：走纸越快越亮 -->
      <rect x="440" y="54.5" width="7" height="4" rx="1" fill="#2f4a32"/>
      <circle id="ledGlowDot" cx="443.5" cy="56.5" r="4" fill="#7dff8a" filter="url(#ledGlow)" opacity=".4"/>
      <rect id="led" x="440" y="54.5" width="7" height="4" rx="1" fill="#9dffab" opacity=".5"/>
    </g>
  </svg>
'''
out = html.replace(back_old, back_new).replace(front_old, front_new)
open(dst, 'w', encoding='utf-8').write(out)
print(dst, len(html.encode()), '→', len(out.encode()), 'bytes')
