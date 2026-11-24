/**
 * An in-memory RPC for unit tests of your own gates: put certificates, rooms and members, then point PofClient at it.
 *   import { MemoryRpc } from "@pof/sdk/testing";
 */
import type { AccountData, MemcmpFilter, RpcLike } from "./rpc.js";
import { decodeBase58 } from "./base58.js";
import { encodeAccountPartial, type Idl } from "./borsh.js";
import { POF_IDL, POF_GATE_IDL } from "./idl/index.js";
import { POF_PROGRAM_ID, POF_GATE_PROGRAM_ID } from "./constants.js";
import { certificateAddress, memberAddress, configAddress, treasuryAddress } from "./accounts.js";
import { fromHex } from "./bytes.js";
import { subjectHash, type Subject } from "./subject.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
export class MemoryRpc implements RpcLike {
  accounts = new Map<string, AccountData>();
  slot = 1000;
  calls: string[] = [];

  async getSlot() {
    this.calls.push("getSlot");
    return this.slot;
  }
  async getAccount(address: string) {
    this.calls.push("getAccount");
    return this.accounts.get(address) ?? null;
  }
  async getAccounts(addresses: string[]) {
    this.calls.push("getAccounts");
    return addresses.map((a) => this.accounts.get(a) ?? null);
  }
  async getProgramAccounts(programId: string, filters: MemcmpFilter[]) {
    this.calls.push("getProgramAccounts");
    return [...this.accounts.values()].filter((a) => {
      if (a.owner !== programId) return false;
      return filters.every((f) => {
        if ("dataSize" in f) return a.data.length === f.dataSize;
        const want = decodeBase58(f.memcmp.bytes);
        for (let i = 0; i < want.length; i++) if (a.data[f.memcmp.offset + i] !== want[i]) return false;
        return true;
      });
    });
  }

  put(address: string, owner: string, data: Uint8Array) {
    this.accounts.set(address, { address, owner, lamports: 1_000_000, data });
  }

  /** Write a Certificate account at its PDA. Returns the address. */
  async putCertificate(c: {
    subject: Subject | Uint8Array; asset: number; tier: number; status?: number; certifiedSlot?: number; expirySlot?: number;
    revokedSlot?: number; noteCount?: number; payer?: string; logIndex?: number; verifier?: string; programId?: string;
    controller?: string;
  }): Promise<string> {
    const programId = c.programId ?? POF_PROGRAM_ID;
    const hash = c.subject instanceof Uint8Array ? c.subject : await subjectHash(c.subject);
    const [addr, bump] = await certificateAddress(hash, c.asset, programId);
    const nulls = Array.from({ length: 8 }, (_, i) => (i < (c.noteCount ?? 1) ? fromHex((i + 1).toString(16).padStart(2, "0").repeat(32)) : new Uint8Array(32)));
    const controller = c.controller ?? (!(c.subject instanceof Uint8Array) && c.subject.kind !== 1 ? c.subject.value : "11111111111111111111111111111111");
    const data = encodeAccountPartial(POF_IDL as unknown as Idl, "Certificate", {
      subject_kind: c.subject instanceof Uint8Array ? 0 : c.subject.kind,
      subject_hash: hash, asset: c.asset, tier: c.tier, status: c.status ?? 0,
      certified_slot: c.certifiedSlot ?? 900, issued_slot: c.certifiedSlot ?? 900, expiry_slot: c.expirySlot ?? 1_000_000,
      revoked_slot: c.revokedSlot ?? 0, root_slot: 890, note_count: c.noteCount ?? 1, null_hashes: nulls, nullifier_hashes: nulls,
      payer: c.payer ?? "11111111111111111111111111111111", controller, log_index: c.logIndex ?? 0,
      verifier: c.verifier ?? "11111111111111111111111111111111", revealed_index: 255, bump,
    });
    this.put(addr, programId, data);
    return addr;
  }

  /** Write the Treasury counters (live, revoked, …) and an anchored log head. */
  async putTreasury(t: Record<string, any>, programId = POF_PROGRAM_ID) {
    const [addr] = await treasuryAddress(programId);
    this.put(addr, programId, encodeAccountPartial(POF_IDL as unknown as Idl, "Treasury", t));
    return addr;
  }

  async putConfig(c: Record<string, any>, programId = POF_PROGRAM_ID) {
    const [addr] = await configAddress(programId);
    this.put(addr, programId, encodeAccountPartial(POF_IDL as unknown as Idl, "Config", c));
    return addr;
  }

  putRoom(address: string, r: { creator: string; id: number; asset: number; minTier: number; memberCount?: number; name?: string; gateProgramId?: string }) {
    const name = new Uint8Array(32);
    name.set(new TextEncoder().encode(r.name ?? "").slice(0, 32));
    const data = encodeAccountPartial(POF_GATE_IDL as unknown as Idl, "Room", {
      creator: r.creator, id: r.id, asset: r.asset, min_tier: r.minTier, members: r.memberCount ?? 0, member_count: r.memberCount ?? 0,
      open: true, created_slot: 500, bump: 255, name,
    });
    this.put(address, r.gateProgramId ?? POF_GATE_PROGRAM_ID, data);
  }

  async putMember(room: string, subject: Subject | Uint8Array, certificate: string, gateProgramId = POF_GATE_PROGRAM_ID): Promise<string> {
    const hash = subject instanceof Uint8Array ? subject : await subjectHash(subject);
    const [addr, bump] = await memberAddress(room, hash, gateProgramId);
    const data = encodeAccountPartial(POF_GATE_IDL as unknown as Idl, "Member", {
      room, subject_hash: hash, subject_kind: subject instanceof Uint8Array ? 0 : subject.kind, certificate, joined_slot: 950, bump,
    });
    this.put(addr, gateProgramId, data);
    return addr;
  }
}
