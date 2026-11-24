// A static server over pof/zk for the bench page, plus POST /result: prints the page's timings and exits.
// node bench/serve.mjs [port]   then open http://127.0.0.1:<port>/bench/?auto&report
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const port = Number(process.argv[2] || 4377);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.zkey': 'application/octet-stream' };
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let b = ''; req.on('data', d => (b += d)).on('end', () => { res.end('ok'); fs.writeFileSync(process.env.BENCH_OUT || path.join(root, 'bench/last.json'), b); console.log(b); if (!process.env.KEEP) setTimeout(() => process.exit(0), 100); });
    return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('no'); }
  res.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream');
  res.setHeader('content-length', fs.statSync(f).size);
  fs.createReadStream(f).pipe(res);
}).listen(port, '127.0.0.1', () => console.error(`bench on http://127.0.0.1:${port}/bench/`));
