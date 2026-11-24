import { decodeBase58 } from "./base58.js";
import { encodeAccountPartial } from "./borsh.js";
import { POF_IDL, POF_GATE_IDL } from "./idl/index.js";
import { POF_PROGRAM_ID, POF_GATE_PROGRAM_ID } from "./constants.js";
import { certificateAddress, memberAddress, configAddress, treasuryAddress } from "./accounts.js";
import { fromHex } from "./bytes.js";
import { subjectHash } from "./subject.js";
/* eslint-disable @typescript-eslint/no-explicit-any */
export class MemoryRpc {
    accounts = new Map();
    slot = 1000;
    calls = [];
    async getSlot() {
        this.calls.push("getSlot");
        return this.slot;
    }
    async getAccount(address) {
        this.calls.push("getAccount");
        return this.accounts.get(address) ?? null;
    }
    async getAccounts(addresses) {
        this.calls.push("getAccounts");
        return addresses.map((a) => this.accounts.get(a) ?? null);
    }
    async getProgramAccounts(programId, filters) {
        this.calls.push("getProgramAccounts");
        return [...this.accounts.values()].filter((a) => {
            if (a.owner !== programId)
                return false;
            return filters.every((f) => {
                if ("dataSize" in f)
                    return a.data.length === f.dataSize;
                const want = decodeBase58(f.memcmp.bytes);
                for (let i = 0; i < want.length; i++)
                    if (a.data[f.memcmp.offset + i] !== want[i])
                        return false;
                return true;
            });
        });
    }
    put(address, owner, data) {
        this.accounts.set(address, { address, owner, lamports: 1_000_000, data });
    }
    /** Write a Certificate account at its PDA. Returns the address. */
    async putCertificate(c) {
        const programId = c.programId ?? POF_PROGRAM_ID;
        const hash = c.subject instanceof Uint8Array ? c.subject : await subjectHash(c.subject);
        const [addr, bump] = await certificateAddress(hash, c.asset, programId);
        const nulls = Array.from({ length: 8 }, (_, i) => (i < (c.noteCount ?? 1) ? fromHex((i + 1).toString(16).padStart(2, "0").repeat(32)) : new Uint8Array(32)));
        const controller = c.controller ?? (!(c.subject instanceof Uint8Array) && c.subject.kind !== 1 ? c.subject.value : "11111111111111111111111111111111");
        const data = encodeAccountPartial(POF_IDL, "Certificate", {
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
    async putTreasury(t, programId = POF_PROGRAM_ID) {
        const [addr] = await treasuryAddress(programId);
        this.put(addr, programId, encodeAccountPartial(POF_IDL, "Treasury", t));
        return addr;
    }
    async putConfig(c, programId = POF_PROGRAM_ID) {
        const [addr] = await configAddress(programId);
        this.put(addr, programId, encodeAccountPartial(POF_IDL, "Config", c));
        return addr;
    }
    putRoom(address, r) {
        const name = new Uint8Array(32);
        name.set(new TextEncoder().encode(r.name ?? "").slice(0, 32));
        const data = encodeAccountPartial(POF_GATE_IDL, "Room", {
            creator: r.creator, id: r.id, asset: r.asset, min_tier: r.minTier, members: r.memberCount ?? 0, member_count: r.memberCount ?? 0,
            open: true, created_slot: 500, bump: 255, name,
        });
        this.put(address, r.gateProgramId ?? POF_GATE_PROGRAM_ID, data);
    }
    async putMember(room, subject, certificate, gateProgramId = POF_GATE_PROGRAM_ID) {
        const hash = subject instanceof Uint8Array ? subject : await subjectHash(subject);
        const [addr, bump] = await memberAddress(room, hash, gateProgramId);
        const data = encodeAccountPartial(POF_GATE_IDL, "Member", {
            room, subject_hash: hash, subject_kind: subject instanceof Uint8Array ? 0 : subject.kind, certificate, joined_slot: 950, bump,
        });
        this.put(addr, gateProgramId, data);
        return addr;
    }
}
