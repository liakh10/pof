/* Where the log, the keeper's sealed kits, the relayer's ledger and the rate counters live. Production: Vercel Blob
   (private store, every read bypasses the CDN cache). Tests and the local end-to-end: a folder. Both give the one primitive
   the log needs: create-if-absent, which makes appends safe across concurrent function instances. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PofError } from './codec.js';

export interface Store {
  get(key: string): Promise<Uint8Array | null>;
  /** writes only if the key does not exist yet; false when it did */
  create(key: string, body: Uint8Array): Promise<boolean>;
  put(key: string, body: Uint8Array): Promise<void>;
  del(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export class FsStore implements Store {
  constructor(private dir: string) {}
  private p(key: string) { if (key.includes('..')) throw new PofError('INTERNAL', 'bad key', 500); return path.join(this.dir, key); }
  async get(key: string) { try { return new Uint8Array(await fs.readFile(this.p(key))); } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; } }
  async create(key: string, body: Uint8Array) {
    await fs.mkdir(path.dirname(this.p(key)), { recursive: true });
    /* write a temp file, then hard-link it into place: the link is atomic and fails if the name exists, so a reader never
       sees a half-written entry */
    const tmp = this.p(key) + '.' + crypto.randomBytes(6).toString('hex');
    await fs.writeFile(tmp, body);
    try { await fs.link(tmp, this.p(key)); return true; } catch (e: any) { if (e.code === 'EEXIST') return false; throw e; } finally { await fs.rm(tmp, { force: true }); }
  }
  async put(key: string, body: Uint8Array) {
    await fs.mkdir(path.dirname(this.p(key)), { recursive: true });
    const tmp = this.p(key) + '.' + crypto.randomBytes(6).toString('hex');
    await fs.writeFile(tmp, body); await fs.rename(tmp, this.p(key));
  }
  async del(key: string) { await fs.rm(this.p(key), { force: true }); }
  async list(prefix: string) {
    const out: string[] = [];
    const walk = async (d: string) => {
      let ents; try { ents = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) { const f = path.join(d, e.name); if (e.isDirectory()) await walk(f); else if (!/\.[0-9a-f]{12}$/.test(e.name)) out.push(path.relative(this.dir, f)); }
    };
    await walk(this.dir);
    return out.filter(k => k.startsWith(prefix)).sort();
  }
}

export class BlobStore implements Store {
  private blob: any = null;
  constructor(private prefix = 'pof/') {}
  private async b() { return this.blob || (this.blob = await import('@vercel/blob')); }
  async get(key: string) {
    const B = await this.b();
    const r = await B.get(this.prefix + key, { access: 'private', useCache: false });
    if (!r || !r.stream) return null;
    return new Uint8Array(await new Response(r.stream).arrayBuffer());
  }
  async create(key: string, body: Uint8Array) {
    const B = await this.b();
    try {
      await B.put(this.prefix + key, Buffer.from(body), { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/octet-stream' });
      return true;
    } catch (e: any) {
      if (/exist|already|precondition|409|412/i.test(String(e?.message)) || e?.name === 'BlobPreconditionFailedError') return false;
      throw e;
    }
  }
  async put(key: string, body: Uint8Array) {
    const B = await this.b();
    await B.put(this.prefix + key, Buffer.from(body), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/octet-stream' });
  }
  async del(key: string) { const B = await this.b(); try { await B.del(this.prefix + key); } catch {} }
  async list(prefix: string) {
    const B = await this.b();
    const out: string[] = []; let cursor: string | undefined;
    do { const r = await B.list({ prefix: this.prefix + prefix, cursor, limit: 1000 }); out.push(...r.blobs.map((x: any) => x.pathname.slice(this.prefix.length))); cursor = r.hasMore ? r.cursor : undefined; } while (cursor);
    return out.sort();
  }
}

/** a small JSON document helper over a Store */
export async function getJson<T>(s: Store, key: string): Promise<T | null> { const b = await s.get(key); return b ? JSON.parse(Buffer.from(b).toString('utf8')) : null; }
export const putJson = (s: Store, key: string, v: unknown) => s.put(key, new Uint8Array(Buffer.from(JSON.stringify(v))));

/** AES-256-GCM sealing for what must rest encrypted (the keeper's kits). The key is 32 bytes from POF_SEAL_KEY (hex). The
 *  associated data binds a sealed blob to its key name, so a blob moved to another name does not open. */
export function seal(key: Uint8Array, aad: string, plain: Uint8Array): Uint8Array {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return new Uint8Array(Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), body]));
}
export function open(key: Uint8Array, aad: string, sealed: Uint8Array): Uint8Array {
  const b = Buffer.from(sealed);
  if (b[0] !== 1) throw new PofError('SEALED', 'unknown seal version', 500);
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(1, 13)); d.setAAD(Buffer.from(aad)); d.setAuthTag(b.subarray(13, 29));
  return new Uint8Array(Buffer.concat([d.update(b.subarray(29)), d.final()]));
}
