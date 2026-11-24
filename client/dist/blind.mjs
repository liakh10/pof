/* Blind RSA-FDH for POF relay credits (zero dependencies; browser and Node 20+: BigInt and WebCrypto only).
   The relayer signs a credit without seeing it, so the credit it later accepts cannot be tied to the purchase that paid
   for it. A credit is a random 32-byte token; its message is H(token) = MGF1-SHA256("pof:credit:v1" ‖ token), cut to one
   byte less than the modulus, as an integer.
     holder:  const { blinded, r } = await blind(key, token);      // send blinded (hex)
     relayer: signBlinded(key, blinded)                              // returns the blind signature (hex)
     holder:  const signature = unblind(key, blindSig, r);           // keep { token, signature }
     relayer: await verifyCredit(key, token, signature)              // when the credit is spent
   key: { n: hex, e: hex } (public), plus d: hex on the relayer. */
const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const bi = (h) => BigInt('0x' + (h || '0'));
const hx = (x, bytes) => x.toString(16).padStart(bytes * 2, '0');
const lenOf = (n) => Math.ceil(n.toString(16).length / 2);
function modPow(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
function modInv(a, m) { let [g, x] = egcd(((a % m) + m) % m, m); if (g !== 1n) throw new Error('not invertible'); return ((x % m) + m) % m; }
function egcd(a, b) { let [x0, x1, r0, r1] = [1n, 0n, a, b]; while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [x0, x1] = [x1, x0 - q * x1]; } return [r0, x0]; }
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const toBytes = (h) => { const s = h.length % 2 ? '0' + h : h; const b = new Uint8Array(s.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16); return b; };
const toHex = (b) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

/** H(token) as a BigInt below n */
export async function fdh(key, tokenHex) {
  if (!/^[0-9a-f]{64}$/.test(tokenHex)) throw new Error('a credit token is 32 bytes of hex');
  const n = bi(key.n), want = lenOf(n) - 1;
  const seed = new Uint8Array([...te.encode('pof:credit:v1'), ...toBytes(tokenHex)]);
  const out = new Uint8Array(want);
  for (let c = 0, o = 0; o < want; c++) {
    const block = new Uint8Array(await subtle.digest('SHA-256', new Uint8Array([...seed, c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255])));
    out.set(block.subarray(0, Math.min(32, want - o)), o); o += 32;
  }
  return bi(toHex(out));
}
export async function blind(key, tokenHex) {
  const n = bi(key.n), e = bi(key.e), k = lenOf(n);
  let r;
  do { const b = globalThis.crypto.getRandomValues(new Uint8Array(k)); r = bi(toHex(b)) % n; } while (r < 2n || gcd(r, n) !== 1n);
  const m = await fdh(key, tokenHex);
  return { blinded: hx(m * modPow(r, e, n) % n, k), r: hx(r, k) };
}
export function signBlinded(key, blindedHex) {
  const n = bi(key.n), d = bi(key.d), k = lenOf(n);
  if (!/^[0-9a-f]+$/.test(blindedHex) || blindedHex.length > 2 * k) throw new Error('a blinded value is hex, at most the modulus length');
  const b = bi(blindedHex);
  if (b < 2n || b >= n) throw new Error('a blinded value must be in [2, n)');
  return hx(modPow(b, d, n), k);
}
export function unblind(key, blindSigHex, rHex) {
  const n = bi(key.n), k = lenOf(n);
  return hx(bi(blindSigHex) * modInv(bi(rHex), n) % n, k);
}
export async function verifyCredit(key, tokenHex, sigHex) {
  if (!/^[0-9a-f]+$/.test(String(sigHex))) return false;
  const n = bi(key.n), e = bi(key.e), s = bi(sigHex);
  if (s <= 0n || s >= n) return false;
  return modPow(s, e, n) === await fdh(key, tokenHex);
}
/** the public half of a relayer key */
export const publicKey = (key) => ({ kid: key.kid, n: key.n, e: key.e });
export const _internal = { modPow, modInv };
