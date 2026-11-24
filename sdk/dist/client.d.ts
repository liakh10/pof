/** PofClient: everything a reader needs, straight from chain. */
import { type RpcLike, type Commitment } from "./rpc.js";
import { type AddressLike } from "./base58.js";
import { type Subject } from "./subject.js";
import { type PofConfig, type Treasury, type Certificate, type Member, type Room, type StatusName } from "./accounts.js";
export interface PofClientOptions {
    /** an RPC URL or anything implementing RpcLike */
    rpc: string | RpcLike;
    programId?: AddressLike;
    gateProgramId?: AddressLike;
    commitment?: Commitment;
}
export interface LiveCertificate extends Certificate {
    /** status as of `slot`: a live byte past its expiry reads "expired" */
    effectiveStatus: StatusName;
    live: boolean;
}
export interface SubjectLookup {
    query: string;
    slot: number;
    /** the subjects the query was read as, with their hashes (a bare key is tried as wallet and as badge) */
    candidates: {
        kind: number;
        value: string | null;
        subjectHash: string;
    }[];
    certificates: LiveCertificate[];
}
export interface FundsCheck {
    ok: boolean;
    reason: "ok" | "no_certificate" | "below_tier" | StatusName;
    slot: number;
    certificate: LiveCertificate | null;
}
export interface ListFilter {
    asset?: number | string;
    tier?: number;
    minTier?: number;
    status?: StatusName | "any";
    subjectKind?: number;
}
export declare class PofClient {
    readonly rpc: RpcLike;
    readonly programId: string;
    readonly gateProgramId: string;
    constructor(opts: PofClientOptions);
    private live;
    /** The certificate for one subject and asset, or null. */
    getCertificate(subject: Subject | Uint8Array, asset: number | string): Promise<LiveCertificate | null>;
    /**
     * Look a subject up the way a person types it: `@handle`, `x:handle`, `wallet:<key>`, `badge:<key>`,
     * a bare key (tried as wallet and as badge), or a 64-hex subject hash. Every asset is checked.
     */
    lookup(query: string, opts?: {
        asset?: number | string;
    }): Promise<SubjectLookup>;
    /** The one-call gate: does this subject hold a live certificate of at least `minTier` in `asset`? */
    checkProofOfFunds(args: {
        subject: string | Subject;
        asset: number | string;
        minTier: number;
    }): Promise<FundsCheck>;
    /** Every certificate matching the filter (getProgramAccounts with memcmp filters). */
    listCertificates(f?: ListFilter): Promise<{
        slot: number;
        certificates: LiveCertificate[];
    }>;
    /** The program's Config: verifier keys, fee, validity, tier tables in base units. */
    getConfig(): Promise<(PofConfig & {
        activeVerifier: string;
        slot: number;
    }) | null>;
    /**
     * The verifier keys a log head or entry may be signed with: the Config's verifier and scheduled next verifier, plus,
     * with `history`, every key a `VerifierSet` event ever named (read from the Config account's transaction history,
     * when the RPC serves it). Never trust the key a head or a leaf names about itself.
     */
    verifierKeys(opts?: {
        history?: boolean;
        maxTransactions?: number;
    }): Promise<{
        current: string | null;
        next: string | null;
        all: string[];
        fromHistory: boolean;
    }>;
    /** The Treasury's public counters, and the transparency log head anchored on chain. */
    getTreasury(): Promise<(Treasury & {
        address: string;
    }) | null>;
    getRoom(address: AddressLike): Promise<Room | null>;
    listRooms(): Promise<Room[]>;
    /** A room with its members, each with the live status of the certificate behind it. */
    getRoomWithMembers(address: AddressLike): Promise<{
        slot: number;
        room: Room;
        members: (Member & {
            certificateStatus: StatusName | "missing";
            tier: number | null;
            live: boolean;
        })[];
    } | null>;
    /**
     * Counters: live certificates, revocations, and the sum of live tier minimums per asset.
     * The cumulative counters come from the Treasury when it exists (expired certificates are closed, so a scan cannot
     * count them); the per-tier breakdown comes from a scan of the open certificates.
     */
    stats(): Promise<{
        slot: number;
        total: number;
        live: number;
        revokedSpent: number;
        revokedByHolder: number;
        expired: number;
        byAsset: Record<string, {
            live: number;
            certifiedMinimum: number;
            byTier: Record<number, number>;
        }>;
        bySubjectKind: Record<string, number>;
        treasury: (Treasury & {
            address: string;
        }) | null;
    }>;
}
