export declare const POF_PROGRAM_ID: string;
export declare const POF_GATE_PROGRAM_ID: string;
export declare const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export declare const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export declare const SYSVAR_INSTRUCTIONS_ID = "Sysvar1nstructions1111111111111111111111111";
/**
 * Refuse a program id other than POF's unless the caller says so: reading "certificates" owned by another program, or
 * passing another program to a CPI, accepts a fake POF (fuzz FZ-17).
 */
export declare function assertPinned(programId: string, gateProgramId?: string, allow?: boolean): void;
/** §1 subject kinds. */
export declare const SubjectKind: {
    readonly Wallet: 0;
    readonly X: 1;
    readonly Badge: 2;
};
export type SubjectKind = (typeof SubjectKind)[keyof typeof SubjectKind];
export declare const SUBJECT_KIND_NAMES: Record<number, "wallet" | "x" | "badge">;
/** §2 assets. */
export declare const Asset: {
    readonly SOL: 0;
    readonly USDC: 1;
};
export type Asset = (typeof Asset)[keyof typeof Asset];
export interface AssetInfo {
    id: number;
    symbol: string;
    decimals: number;
    /** tier index (1..5) to the minimum, in whole units */
    tiers: Record<number, number>;
}
export declare const ASSETS: Record<number, AssetInfo>;
/** §6 certificate status as stored on chain. */
export declare const CertStatus: {
    readonly Live: 0;
    readonly RevokedSpent: 1;
    readonly RevokedByHolder: 2;
    readonly Expired: 3;
    readonly Voided: 4;
};
export type CertStatus = (typeof CertStatus)[keyof typeof CertStatus];
export declare const CERT_STATUS_NAMES: Record<number, "live" | "revoked_spent" | "revoked_by_holder" | "expired" | "voided">;
/** zk certificates name the zk config PDA as their verifier (program/programs/pof/src/zk.rs ZK_CONFIG) */
export declare const ZK_CONFIG = "6q7PxLzgUtLHMfCDDHzkU4Ho54rC6b21VZmSFsD6Tsv1";
export declare function assetInfo(asset: number): AssetInfo;
/** Parse "SOL" / "usdc" / "0" / 1 into the §2 asset id. */
export declare function parseAsset(v: string | number): number;
/** The minimum a tier proves, in whole units of the asset. */
export declare function tierMinimum(asset: number, tier: number): number;
/** "≥ 1,000 SOL" */
export declare function tierLabel(asset: number, tier: number): string;
