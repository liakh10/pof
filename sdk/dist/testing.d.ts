/**
 * An in-memory RPC for unit tests of your own gates: put certificates, rooms and members, then point PofClient at it.
 *   import { MemoryRpc } from "@pof/sdk/testing";
 */
import type { AccountData, MemcmpFilter, RpcLike } from "./rpc.js";
import { type Subject } from "./subject.js";
export declare class MemoryRpc implements RpcLike {
    accounts: Map<string, AccountData>;
    slot: number;
    calls: string[];
    getSlot(): Promise<number>;
    getAccount(address: string): Promise<AccountData | null>;
    getAccounts(addresses: string[]): Promise<(AccountData | null)[]>;
    getProgramAccounts(programId: string, filters: MemcmpFilter[]): Promise<AccountData[]>;
    /** transaction history for verifierKeys({ history: true }): address → [{ signature, logs }] newest first */
    history: Map<string, {
        signature: string;
        logs: string[];
    }[]>;
    getSignaturesForAddress(address: string, opts?: {
        before?: string;
        limit?: number;
    }): Promise<{
        signature: string;
        slot: number;
        err: null;
    }[]>;
    getTransactionLogs(signature: string): Promise<string[] | null>;
    put(address: string, owner: string, data: Uint8Array): void;
    /** Write a Certificate account at its PDA. Returns the address. */
    putCertificate(c: {
        subject: Subject | Uint8Array;
        asset: number;
        tier: number;
        status?: number;
        certifiedSlot?: number;
        expirySlot?: number;
        revokedSlot?: number;
        noteCount?: number;
        payer?: string;
        logIndex?: number;
        verifier?: string;
        programId?: string;
        controller?: string;
    }): Promise<string>;
    /** Write the Treasury counters (live, revoked, …) and an anchored log head. */
    putTreasury(t: Record<string, any>, programId?: string): Promise<string>;
    putConfig(c: Record<string, any>, programId?: string): Promise<string>;
    putRoom(address: string, r: {
        creator: string;
        id: number;
        asset: number;
        minTier: number;
        memberCount?: number;
        name?: string;
        gateProgramId?: string;
    }): void;
    putMember(room: string, subject: Subject | Uint8Array, certificate: string, gateProgramId?: string): Promise<string>;
}
