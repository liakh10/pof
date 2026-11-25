/** Fixed values from CONTRACT.md §1, §2 and §6. Program ids come from the IDL (see idl/). */
import { POF_IDL, POF_GATE_IDL } from "./idl/index.js";

export const POF_PROGRAM_ID: string = POF_IDL.address;
export const POF_GATE_PROGRAM_ID: string = POF_GATE_IDL.address;
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const SYSVAR_INSTRUCTIONS_ID = "Sysvar1nstructions1111111111111111111111111";

/**
 * Refuse a program id other than POF's unless the caller says so: reading "certificates" owned by another program, or
 * passing another program to a CPI, accepts a fake POF (fuzz FZ-17).
 */
export function assertPinned(programId: string, gateProgramId: string = POF_GATE_PROGRAM_ID, allow = false): void {
  if (allow) return;
  if (programId !== POF_PROGRAM_ID || gateProgramId !== POF_GATE_PROGRAM_ID)
    throw new Error(
      `refusing program id ${programId !== POF_PROGRAM_ID ? programId : gateProgramId}: POF is ${POF_PROGRAM_ID} (pof_gate ${POF_GATE_PROGRAM_ID}). ` +
        "Pass allowOtherDeployment: true only for your own test deployment.",
    );
}

/** §1 subject kinds. */
export const SubjectKind = { Wallet: 0, X: 1, Badge: 2 } as const;
export type SubjectKind = (typeof SubjectKind)[keyof typeof SubjectKind];
export const SUBJECT_KIND_NAMES: Record<number, "wallet" | "x" | "badge"> = { 0: "wallet", 1: "x", 2: "badge" };

/** §2 assets. */
export const Asset = { SOL: 0, USDC: 1 } as const;
export type Asset = (typeof Asset)[keyof typeof Asset];

export interface AssetInfo {
  id: number;
  symbol: string;
  decimals: number;
  /** tier index (1..5) to the minimum, in whole units */
  tiers: Record<number, number>;
}

export const ASSETS: Record<number, AssetInfo> = {
  0: { id: 0, symbol: "SOL", decimals: 9, tiers: { 1: 1, 2: 10, 3: 100, 4: 1_000, 5: 10_000 } },
  1: { id: 1, symbol: "USDC", decimals: 6, tiers: { 1: 100, 2: 1_000, 3: 10_000, 4: 100_000, 5: 1_000_000 } },
};

/** §6 certificate status as stored on chain. */
export const CertStatus = { Live: 0, RevokedSpent: 1, RevokedByHolder: 2, Expired: 3, Voided: 4 } as const;
export type CertStatus = (typeof CertStatus)[keyof typeof CertStatus];
export const CERT_STATUS_NAMES: Record<number, "live" | "revoked_spent" | "revoked_by_holder" | "expired" | "voided"> = {
  0: "live",
  1: "revoked_spent",
  2: "revoked_by_holder",
  3: "expired",
  4: "voided",
};

/** zk certificates name the zk config PDA as their verifier (program/programs/pof/src/zk.rs ZK_CONFIG) */
export const ZK_CONFIG = "6q7PxLzgUtLHMfCDDHzkU4Ho54rC6b21VZmSFsD6Tsv1";

export function assetInfo(asset: number): AssetInfo {
  const a = ASSETS[asset];
  if (!a) throw new Error(`unknown asset ${asset}`);
  return a;
}

/** Parse "SOL" / "usdc" / "0" / 1 into the §2 asset id. */
export function parseAsset(v: string | number): number {
  if (typeof v === "number") return assetInfo(v).id;
  const s = v.trim().toUpperCase();
  if (/^\d+$/.test(s)) return assetInfo(Number(s)).id;
  for (const a of Object.values(ASSETS)) if (a.symbol === s) return a.id;
  throw new Error(`unknown asset "${v}"`);
}

/** The minimum a tier proves, in whole units of the asset. */
export function tierMinimum(asset: number, tier: number): number {
  const m = assetInfo(asset).tiers[tier];
  if (m === undefined) throw new Error(`unknown tier ${tier} for ${assetInfo(asset).symbol}`);
  return m;
}

/** "≥ 1,000 SOL" */
export function tierLabel(asset: number, tier: number): string {
  return `≥ ${tierMinimum(asset, tier).toLocaleString("en-US")} ${assetInfo(asset).symbol}`;
}
