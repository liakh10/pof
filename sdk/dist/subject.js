/** §1 subjects: who a certificate is about, and how its 32-byte hash is formed. */
import { sha256, toHex, fromHex } from "./bytes.js";
import { isAddress, toAddress } from "./base58.js";
import { SubjectKind } from "./constants.js";
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
export function normalizeHandle(h) {
    const s = h.trim().replace(/^@/, "").toLowerCase();
    if (!HANDLE.test(s))
        throw new Error(`"${h}" is not an X handle (1-15 letters, digits or _)`);
    return s;
}
export function walletSubject(wallet) {
    return { kind: SubjectKind.Wallet, value: toAddress(wallet) };
}
export function xSubject(handle) {
    return { kind: SubjectKind.X, value: normalizeHandle(handle) };
}
export function badgeSubject(badge) {
    return { kind: SubjectKind.Badge, value: toAddress(badge) };
}
/** sha256("pof:wallet:" ‖ base58) · sha256("pof:x:" ‖ handle) · sha256("pof:badge:" ‖ base58) */
export async function subjectHash(subject) {
    switch (subject.kind) {
        case SubjectKind.Wallet:
            return sha256("pof:wallet:", toAddress(subject.value));
        case SubjectKind.X:
            return sha256("pof:x:", normalizeHandle(subject.value));
        case SubjectKind.Badge:
            return sha256("pof:badge:", toAddress(subject.value));
        default:
            throw new Error(`unknown subject kind ${subject.kind}`);
    }
}
export async function subjectHashHex(subject) {
    return toHex(await subjectHash(subject));
}
/**
 * Parse what a person types into a checker:
 * `@handle`, `x:handle`, `wallet:<base58>`, `badge:<base58>`, a bare base58 key (wallet or badge),
 * or a 64-hex subject hash.
 */
export function parseSubjectQuery(input) {
    const s = decodeURIComponent(input).trim();
    if (!s)
        throw new Error("empty subject");
    const m = /^(wallet|x|badge|hash):(.+)$/i.exec(s);
    if (m) {
        const kind = m[1].toLowerCase();
        const v = m[2].trim();
        if (kind === "wallet")
            return { type: "subjects", subjects: [walletSubject(v)] };
        if (kind === "badge")
            return { type: "subjects", subjects: [badgeSubject(v)] };
        if (kind === "x")
            return { type: "subjects", subjects: [xSubject(v)] };
        return { type: "hash", hash: parseHash(v) };
    }
    if (s.startsWith("@"))
        return { type: "subjects", subjects: [xSubject(s)] };
    if (/^(0x)?[0-9a-fA-F]{64}$/.test(s))
        return { type: "hash", hash: parseHash(s) };
    if (isAddress(s))
        return { type: "subjects", subjects: [walletSubject(s), badgeSubject(s)] };
    if (HANDLE.test(s))
        return { type: "subjects", subjects: [xSubject(s)] };
    throw new Error(`cannot read "${input}" as a wallet, @handle, badge or subject hash`);
}
function parseHash(h) {
    const b = fromHex(h);
    if (b.length !== 32)
        throw new Error("a subject hash is 32 bytes (64 hex)");
    return b;
}
