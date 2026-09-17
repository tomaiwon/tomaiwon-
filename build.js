/* 把 index.html + src/*.js 打包成一个自包含的 HTML，方便直接上传到任何静态服务器。
   用法：node build.js   →   dist/index.html */
const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
for (const f of ['src/engine.js', 'src/canvas.js', 'src/ui.js']) {
  const js = fs.readFileSync(f, 'utf8');
  // 必须用函数形式：replace 的替换串里 $$ 会被当成转义（变成一个 $），
  // 会把代码里的 $$ 悄悄改坏。函数返回值不做任何替换。
  const block = '<script>\n/* ' + f + ' */\n' + js + '\n</script>';
  html = html.replace(`<script src="${f}"></script>`, () => block);
}
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
console.log('dist/index.html', (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB');
