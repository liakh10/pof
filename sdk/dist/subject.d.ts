import { type AddressLike } from "./base58.js";
import { SubjectKind } from "./constants.js";
export interface Subject {
    kind: SubjectKind;
    /** canonical value: base58 for wallet and badge, lowercase handle without @ for x */
    value: string;
}
export declare function normalizeHandle(h: string): string;
export declare function walletSubject(wallet: AddressLike): Subject;
export declare function xSubject(handle: string): Subject;
export declare function badgeSubject(badge: AddressLike): Subject;
/** sha256("pof:wallet:" ‖ base58) · sha256("pof:x:" ‖ handle) · sha256("pof:badge:" ‖ base58) */
export declare function subjectHash(subject: Subject): Promise<Uint8Array>;
export declare function subjectHashHex(subject: Subject): Promise<string>;
/** What a free-form query string can mean. A bare base58 key may be a wallet or a badge, so both are tried. */
export type SubjectQuery = {
    type: "subjects";
    subjects: Subject[];
} | {
    type: "hash";
    hash: Uint8Array;
};
/**
 * Parse what a person types into a checker:
 * `@handle`, `x:handle`, `wallet:<base58>`, `badge:<base58>`, a bare base58 key (wallet or badge),
 * or a 64-hex subject hash.
 */
export declare function parseSubjectQuery(input: string): SubjectQuery;
