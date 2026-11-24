#!/usr/bin/env node
// Local preview of the POF site the way Vercel serves it: static files with cleanUrls, the vercel.json rewrites, and the
// Node functions under api/ (rpc, v1, status, card, share) called with the same (req, res) they get on Vercel.
//   node site/serve.mjs [--port 5492]
// Mainnet reads go through api/rpc.js with a key from ~/.config/helius/site_keys (never printed). Localhost only.
// Open http://localhost:5492/?fixture for the development fixture (data.js; never on a deployed site).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 5492;
if (!process.env.HELIUS_KEYS && !process.env.SOLANA_RPC) {
  try { process.env.HELIUS_KEYS = fs.readFileSync(path.join(os.homedir(), '.config/helius/site_keys'), 'utf8').split('\n').map(s => s.trim()).filter(Boolean).join(','); } catch {}
}
if (!process.env.SOLANA_RPC && process.env.HELIUS_KEYS) process.env.SOLANA_RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_KEYS.split(',')[0]}`;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.vtt': 'text/vtt', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

/** vercel.json rewrite: "/x/:a/:b*" → regex */
function compile(src) {
  const names = [];
  const re = '^' + src.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\/:(\w+)\*/g, (_, n) => { names.push(n); return '(?:/(.*))?'; }).replace(/:(\w+)\*/g, (_, n) => { names.push(n); return '(.*)'; }).replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '/?$';
  return { re: new RegExp(re), names };
}
const rewrites = (vercel.rewrites || []).map(r => ({ ...compile(r.source), dest: r.destination }));
function rewrite(pathname) {
  for (const r of rewrites) {
    const m = r.re.exec(pathname);
    if (!m) continue;
    let d = r.dest;
    r.names.forEach((n, i) => { d = d.replaceAll(`:${n}*`, m[i + 1] ?? '').replaceAll(`:${n}`, m[i + 1] ?? ''); });
    return d;
  }
  return null;
}

/** static file lookup with cleanUrls */
function staticFile(p) {
  const f = path.normalize(path.join(ROOT, decodeURIComponent(p)));
  if (!f.startsWith(ROOT) || /\/(node_modules|\.git|\.vercel)(\/|$)/.test(f)) return null;
  const tries = [f, f + '.html', path.join(f, 'index.html')];
  for (const t of tries) if (fs.existsSync(t) && fs.statSync(t).isFile()) return t;
  return null;
}

/** an api/ function file for a path, Vercel style ([fn].js dynamic segments) */
function apiFile(p) {
  const parts = p.replace(/^\/+|\/+$/g, '').split('/');
  const walk = (dir, i, params) => {
    if (i === parts.length) {
      for (const c of [dir + '.js', path.join(dir, 'index.js')]) if (fs.existsSync(c)) return { file: c, params };
      return null;
    }
    const exact = path.join(dir, parts[i]);
    if (i === parts.length - 1 && fs.existsSync(exact + '.js')) return { file: exact + '.js', params };
    if (fs.existsSync(exact) && fs.statSync(exact).isDirectory()) { const r = walk(exact, i + 1, params); if (r) return r; }
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      for (const e of fs.readdirSync(dir)) {
        const m = /^\[(\w+)\](\.js)?$/.exec(e);
        if (!m) continue;
        if (m[2] && i === parts.length - 1) return { file: path.join(dir, e), params: { ...params, [m[1]]: parts[i] } };
        if (!m[2]) { const r = walk(path.join(dir, e), i + 1, { ...params, [m[1]]: parts[i] }); if (r) return r; }
      }
    }
    return null;
  };
  return walk(ROOT, 0, {});
}

const mods = new Map();
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    let pathname = url.pathname;
    let search = url.search;
    // static first (Vercel checks the filesystem before rewrites), then rewrites, then api/
    let file = !pathname.startsWith('/api/') ? staticFile(pathname) : null;
    if (!file) {
      const d = rewrite(pathname);
      if (d) {
        const du = new URL(d, 'http://x');
        pathname = du.pathname;
        const q = new URLSearchParams(du.search); for (const [k, v] of url.searchParams) if (!q.has(k)) q.set(k, v);
        search = q.toString() ? `?${q}` : '';
        file = !pathname.startsWith('/api/') ? staticFile(pathname) : null;
      }
    }
    if (file) {
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      return fs.createReadStream(file).pipe(res);
    }
    if (pathname.startsWith('/api/')) {
      const hit = apiFile(pathname);
      if (hit) {
        const q = new URLSearchParams(search); for (const [k, v] of Object.entries(hit.params)) if (!q.has(k)) q.set(k, v);
        req.url = pathname + (q.toString() ? `?${q}` : '');
        if (!mods.has(hit.file)) mods.set(hit.file, await import(pathToFileURL(hit.file).href));
        req.query = Object.fromEntries(q);
        return await mods.get(hit.file).default(req, res);
      }
    }
    const nf = staticFile('/404');
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(nf ? fs.readFileSync(nf) : 'not found');
  } catch (e) {
    console.error(String(e.stack || e).replace(/api-key=[^&\s"]+/g, 'api-key=…'));
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('server error');
  }
}).listen(port, '127.0.0.1', () => console.log(`POF site on http://localhost:${port}/  (fixture: http://localhost:${port}/?fixture)`));
