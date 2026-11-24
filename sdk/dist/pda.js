/** Program derived addresses without @solana/web3.js: SHA-256 plus an ed25519 on-curve test. */
import { concat, sha256, utf8 } from "./bytes.js";
import { encodeBase58, toAddressBytes } from "./base58.js";
const P = (1n << 255n) - 19n;
const D = (-121665n * modInv(121666n)) % P;
const SQRT_M1 = modPow(2n, (P - 1n) / 4n);
function mod(a) {
    const r = a % P;
    return r >= 0n ? r : r + P;
}
function modPow(b, e) {
    let r = 1n;
    b = ((b % P) + P) % P;
    while (e > 0n) {
        if (e & 1n)
            r = (r * b) % P;
        b = (b * b) % P;
        e >>= 1n;
    }
    return r;
}
function modInv(a) {
    return modPow(a, P - 2n);
}
/** True when the 32 bytes decode to a point on the ed25519 curve (RFC 8032 §5.1.3). */
export function isOnCurve(bytes) {
    if (bytes.length !== 32)
        return false;
    const b = bytes.slice();
    b[31] &= 0x7f;
    let y = 0n;
    for (let i = 31; i >= 0; i--)
        y = (y << 8n) | BigInt(b[i]);
    if (y >= P)
        return false;
    const y2 = mod(y * y);
    const u = mod(y2 - 1n);
    const v = mod(D * y2 + 1n);
    // x = (u/v)^((p+3)/8) computed as u v^3 (u v^7)^((p-5)/8)
    const v3 = mod(v * v * v);
    const v7 = mod(v3 * v3 * v);
    let x = mod(u * v3 * modPow(mod(u * v7), (P - 5n) / 8n));
    const vx2 = mod(v * x * x);
    if (vx2 === u)
        return true;
    if (vx2 === mod(-u)) {
        x = mod(x * SQRT_M1);
        return true;
    }
    return false;
}
function seedBytes(s) {
    return typeof s === "string" ? utf8(s) : s;
}
export async function createProgramAddress(seeds, programId) {
    const parts = seeds.map(seedBytes);
    for (const p of parts)
        if (p.length > 32)
            throw new Error("a seed is at most 32 bytes");
    const h = await sha256(concat(...parts, toAddressBytes(programId), utf8("ProgramDerivedAddress")));
    return isOnCurve(h) ? null : encodeBase58(h);
}
export async function findProgramAddress(seeds, programId) {
    for (let bump = 255; bump >= 0; bump--) {
        const a = await createProgramAddress([...seeds, Uint8Array.of(bump)], programId);
        if (a)
            return [a, bump];
    }
    throw new Error("no viable bump");
}
