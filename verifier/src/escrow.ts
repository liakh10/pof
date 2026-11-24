/* Keeper escrow (audit POF-01): revocation must not depend on our keeper alone. Every kit (salt, nullifier per disclosed
   note; never an amount, an opening or nk) is also sealed to each registered keeper's X25519 key and published under
   escrow/<subject hash>-<asset>/<attestation hash>. Any registered keeper (ours, an independent operator, devx's witness)
   reads the escrow from GET /api/keeper/escrow, opens its own envelope, watches the nullifiers and calls the permissionless
   revoke_spent itself. The registry is keepers.json in this folder: it is bundled, so the published bundle hash pins it.
   Envelope: ephemeral X25519 → HKDF-SHA256(shared, salt = attestation hash, info "pof:escrow:v1" ‖ kid) → AES-256-GCM, with
   associated data "pof:escrow:v1" ‖ attestation hash ‖ kid. */
import crypto from 'node:crypto';
import { x25519 } from '@noble/curves/ed25519.js';
import { hex, sha256, unhex } from './codec.js';
import { getJson, putJson, type Store } from './store.js';
import REGISTRY from '../keepers.json';

export interface KeeperKey { kid: string; x25519: string; operator: string; contact?: string }
export interface Envelope { kid: string; epk: string; iv: string; ct: string }
export const registry: KeeperKey[] = (REGISTRY as any).keepers || [];

const INFO = 'pof:escrow:v1';
function keyFor(shared: Uint8Array, attHash: Uint8Array, kid: string) {
  return new Uint8Array(crypto.hkdfSync('sha256', shared, attHash, Buffer.from(INFO + kid), 32));
}

export function sealTo(k: KeeperKey, attHash: Uint8Array, plain: Uint8Array): Envelope {
  const esk = x25519.utils.randomSecretKey();
  const epk = x25519.getPublicKey(esk);
  const key = keyFor(x25519.getSharedSecret(esk, unhex(k.x25519, 32, 'keeper key')), attHash, k.kid);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.concat([Buffer.from(INFO), attHash, Buffer.from(k.kid)]));
  const ct = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  esk.fill(0); key.fill(0);
  return { kid: k.kid, epk: hex(epk), iv: iv.toString('hex'), ct: ct.toString('hex') };
}

/** what an independent keeper runs with its own secret (also scripts/witness-keeper.mjs) */
export function openEnvelope(secret: Uint8Array, kid: string, attHash: Uint8Array, e: Envelope): any {
  const key = keyFor(x25519.getSharedSecret(secret, unhex(e.epk, 32)), attHash, kid);
  const b = Buffer.from(e.ct, 'hex');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'hex')); d.setAAD(Buffer.concat([Buffer.from(INFO), attHash, Buffer.from(kid)])); d.setAuthTag(b.subarray(b.length - 16));
  return JSON.parse(Buffer.concat([d.update(b.subarray(0, b.length - 16)), d.final()]).toString('utf8'));
}

export class Escrow {
  constructor(private store: Store, private keys: KeeperKey[] = registry) {}
  get keepers() { return this.keys.map(k => ({ kid: k.kid, operator: k.operator, x25519: k.x25519, ...(k.contact ? { contact: k.contact } : {}) })); }

  async put(kit: { subjectHash: string; asset: number; tree: string; expirySlot: number; attestation: string; kit: { h: string; salt: string; nullifier: string }[] }) {
    if (!this.keys.length) return null;
    const attHash = sha256(unhex(kit.attestation));
    const plain = new Uint8Array(Buffer.from(JSON.stringify(kit)));
    const name = `escrow/${kit.subjectHash}-${kit.asset}/${hex(attHash)}.json`;
    await putJson(this.store, name, { v: 1, subjectHash: kit.subjectHash, asset: kit.asset, tree: kit.tree, expirySlot: kit.expirySlot, attestationHash: hex(attHash), attestation: kit.attestation, envelopes: this.keys.map(k => sealTo(k, attHash, plain)) });
    return name;
  }

  /** the public listing: names after a cursor, at most `limit`, with their envelopes */
  async list(after = '', limit = 100) {
    const names = (await this.store.list('escrow/')).filter(n => n > after).slice(0, Math.min(500, Math.max(1, limit)));
    const entries = [];
    for (const n of names) { const e = await getJson<any>(this.store, n); if (e) entries.push({ name: n, ...e }); }
    return { keepers: this.keepers, entries, next: names.length ? names[names.length - 1] : null };
  }

  /** drops escrow entries whose attestation expired (the keeper scan calls it) */
  async sweep(slot: bigint, graceSlots = 9000n) {
    let n = 0;
    for (const name of await this.store.list('escrow/')) {
      const e = await getJson<any>(this.store, name);
      if (!e || slot > BigInt(e.expirySlot) + graceSlots) { await this.store.del(name); n++; }
    }
    return n;
  }
}

export const x25519Public = (secret: Uint8Array): Uint8Array => x25519.getPublicKey(secret);
