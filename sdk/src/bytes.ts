/** Byte helpers shared by every module. No dependencies: WebCrypto only. */

const enc = new TextEncoder();

export function utf8(s: string): Uint8Array {
  return enc.encode(s);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(h: string): Uint8Array {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) throw new Error("invalid hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export function u64le(v: bigint | number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(v), true);
  return out;
}

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error("WebCrypto (globalThis.crypto.subtle) is required: Node 20+ or a modern browser");
  return c.subtle;
}

/** SHA-256 of the concatenation of the parts. */
export async function sha256(...parts: (Uint8Array | string)[]): Promise<Uint8Array> {
  const data = concat(...parts.map((p) => (typeof p === "string" ? utf8(p) : p)));
  return new Uint8Array(await subtle().digest("SHA-256", data as BufferSource));
}

/** Ed25519 signature check through WebCrypto (Node 20+, Chrome 137+, Safari 17+, Firefox 129+). */
export async function ed25519Verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  const key = await subtle().importKey("raw", publicKey as BufferSource, { name: "Ed25519" }, false, ["verify"]);
  return subtle().verify({ name: "Ed25519" }, key, signature as BufferSource, message as BufferSource);
}
