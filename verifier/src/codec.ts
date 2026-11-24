/* Byte helpers shared by every part of the Verifier. No I/O here. */
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { getBase58Encoder, getBase58Decoder } from '@solana/kit';

const b58enc = getBase58Encoder();
const b58dec = getBase58Decoder();
const utf8 = new TextEncoder();

export const sha256 = (...parts: Uint8Array[]): Uint8Array => nobleSha256(concat(...parts));
export const text = (s: string): Uint8Array => utf8.encode(s);

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function hex(b: Uint8Array): string { return Buffer.from(b).toString('hex'); }

export function unhex(s: unknown, len?: number, field = 'value'): Uint8Array {
  if (typeof s !== 'string' || !/^(0x)?[0-9a-fA-F]*$/.test(s) || s.replace(/^0x/, '').length % 2) throw new PofError('BAD_HEX', `${field} must be hex`);
  const b = new Uint8Array(Buffer.from(s.replace(/^0x/, ''), 'hex'));
  if (len !== undefined && b.length !== len) throw new PofError('BAD_LENGTH', `${field} must be ${len} bytes, got ${b.length}`);
  return b;
}

export function fromB58(s: unknown, len = 32, field = 'address'): Uint8Array {
  if (typeof s !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{1,128}$/.test(s)) throw new PofError('BAD_BASE58', `${field} must be base58`);
  let b: Uint8Array;
  try { b = new Uint8Array(b58enc.encode(s)); } catch { throw new PofError('BAD_BASE58', `${field} must be base58`); }
  if (b.length !== len) throw new PofError('BAD_LENGTH', `${field} must decode to ${len} bytes`);
  return b;
}
export const toB58 = (b: Uint8Array): string => b58dec.decode(b);

export function u64le(v: bigint | number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
  return b;
}
export const readU64le = (b: Uint8Array, o: number): bigint => new DataView(b.buffer, b.byteOffset + o, 8).getBigUint64(0, true);

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** Every rejection the Verifier, the relayer, the keeper or the linker gives: a stable code, a sentence a person can act on,
 *  and the HTTP status. */
export class PofError extends Error {
  code: string; status: number; details?: Record<string, unknown>;
  constructor(code: string, message: string, status = 400, details?: Record<string, unknown>) {
    super(message); this.name = 'PofError'; this.code = code; this.status = status; if (details) this.details = details;
  }
}
