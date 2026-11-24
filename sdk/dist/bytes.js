/** Byte helpers shared by every module. No dependencies: WebCrypto only. */
const enc = new TextEncoder();
export function utf8(s) {
    return enc.encode(s);
}
export function concat(...parts) {
    let n = 0;
    for (const p of parts)
        n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
const NodeBuffer = globalThis.Buffer;
export function toHex(b) {
    if (NodeBuffer)
        return NodeBuffer.from(b.buffer, b.byteOffset, b.byteLength).toString("hex");
    let s = "";
    for (let i = 0; i < b.length; i++)
        s += HEX[b[i]];
    return s;
}
/** base64 to bytes: Buffer in Node (fast), atob in browsers */
export function fromBase64(s) {
    if (NodeBuffer) {
        const b = NodeBuffer.from(s, "base64");
        return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    }
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
export function fromHex(h) {
    const s = h.startsWith("0x") ? h.slice(2) : h;
    if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s))
        throw new Error("invalid hex");
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++)
        out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return out;
}
export function equalBytes(a, b) {
    if (a.length !== b.length)
        return false;
    let d = 0;
    for (let i = 0; i < a.length; i++)
        d |= a[i] ^ b[i];
    return d === 0;
}
export function u64le(v) {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigUint64(0, BigInt(v), true);
    return out;
}
function subtle() {
    const c = globalThis.crypto;
    if (!c?.subtle)
        throw new Error("WebCrypto (globalThis.crypto.subtle) is required: Node 20+ or a modern browser");
    return c.subtle;
}
/** SHA-256 of the concatenation of the parts. */
export async function sha256(...parts) {
    const data = concat(...parts.map((p) => (typeof p === "string" ? utf8(p) : p)));
    return new Uint8Array(await subtle().digest("SHA-256", data));
}
/** Ed25519 signature check through WebCrypto (Node 20+, Chrome 137+, Safari 17+, Firefox 129+). */
export async function ed25519Verify(publicKey, message, signature) {
    if (publicKey.length !== 32 || signature.length !== 64)
        return false;
    const key = await subtle().importKey("raw", publicKey, { name: "Ed25519" }, false, ["verify"]);
    return subtle().verify({ name: "Ed25519" }, key, signature, message);
}
