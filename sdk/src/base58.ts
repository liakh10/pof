/** Bitcoin-alphabet base58, as used by Solana addresses and signatures. */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) MAP[ALPHABET.charCodeAt(i)] = i;

export function encodeBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let s = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) s += ALPHABET[digits[i]];
  return s;
}

export function decodeBase58(s: string): Uint8Array {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  const bytes: number[] = [];
  for (let i = zeros; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? MAP[c] : -1;
    if (v < 0) throw new Error(`invalid base58 character "${s[i]}"`);
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[out.length - 1 - i] = bytes[i];
  return out;
}

/** Anything that looks like a public key: a base58 string, 32 raw bytes, or a web3.js / kit object. */
export type AddressLike = string | Uint8Array | { toBase58(): string } | { toBytes(): Uint8Array };

export function toAddressBytes(a: AddressLike): Uint8Array {
  let b: Uint8Array;
  if (typeof a === "string") b = decodeBase58(a);
  else if (a instanceof Uint8Array) b = a;
  else if ("toBytes" in a && typeof a.toBytes === "function") b = a.toBytes();
  else if ("toBase58" in a && typeof a.toBase58 === "function") b = decodeBase58(a.toBase58());
  else throw new Error("not an address");
  if (b.length !== 32) throw new Error(`an address is 32 bytes, got ${b.length}`);
  return b;
}

export function toAddress(a: AddressLike): string {
  return encodeBase58(toAddressBytes(a));
}

export function isAddress(s: string): boolean {
  try {
    return decodeBase58(s).length === 32;
  } catch {
    return false;
  }
}
