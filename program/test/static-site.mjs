// The site's files on a local port, at the paths the build serves them (for the rehearsal's coin-image check; launch.mjs runs as a child
// of rehearse.mjs, whose own event loop is blocked while it waits, so this runs as its own process). Prints the port. A file the site
// does not have yet (coin.png before the art is made) is served from the second argument's folder when it is there.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
const siteDir = process.argv[2], spare = process.argv[3] || null;
let built = {};
try { built = JSON.parse(execFileSync('node', ['build.mjs', '--map', '--json'], { cwd: siteDir, encoding: 'utf8' })).files || {}; } catch {}
const bySrc = Object.fromEntries(Object.entries(built).map(([src, out]) => ['/' + out, src]));
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const src = bySrc[p] || p.slice(1);
  let f = path.join(siteDir, src);
  if (spare && src && !src.includes('..') && !fs.existsSync(f) && fs.existsSync(path.join(spare, src))) f = path.join(spare, src);
  if (!src || src.includes('..') || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200); res.end(fs.readFileSync(f));
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
