/** PofClient: everything a reader needs, straight from chain. */
import { Rpc, memcmp } from "./rpc.js";
import { toHex, fromHex } from "./bytes.js";
import { toAddress, toAddressBytes } from "./base58.js";
import { POF_PROGRAM_ID, POF_GATE_PROGRAM_ID, ASSETS, tierMinimum, parseAsset } from "./constants.js";
import { parseSubjectQuery, subjectHash } from "./subject.js";
import { certificateAddress, configAddress, treasuryAddress, decodeConfig, decodeTreasury, activeVerifier, decodeCertificate, decodeEvents, decodeMember, decodeRoom, effectiveStatus, layout, } from "./accounts.js";
export class PofClient {
    rpc;
    programId;
    gateProgramId;
    constructor(opts) {
        this.rpc = typeof opts.rpc === "string" ? new Rpc(opts.rpc, { commitment: opts.commitment }) : opts.rpc;
        this.programId = toAddress(opts.programId ?? POF_PROGRAM_ID);
        this.gateProgramId = toAddress(opts.gateProgramId ?? POF_GATE_PROGRAM_ID);
    }
    /** accounts and the slot in one RPC call when the RPC supports it, else two in parallel */
    async accountsAt(addrs) {
        if (this.rpc.getAccountsWithSlot)
            return this.rpc.getAccountsWithSlot(addrs);
        const [accounts, slot] = await Promise.all([this.rpc.getAccounts(addrs), this.rpc.getSlot()]);
        return { slot, accounts };
    }
    async programAccountsAt(programId, filters) {
        if (this.rpc.getProgramAccountsWithSlot)
            return this.rpc.getProgramAccountsWithSlot(programId, filters);
        const [accounts, slot] = await Promise.all([this.rpc.getProgramAccounts(programId, filters), this.rpc.getSlot()]);
        return { slot, accounts };
    }
    live(c, slot) {
        const s = effectiveStatus(c, slot);
        return { ...c, effectiveStatus: s, live: s === "live" };
    }
    /** The certificate for one subject and asset, or null. */
    async getCertificate(subject, asset) {
        const hash = subject instanceof Uint8Array ? subject : await subjectHash(subject);
        const [addr] = await certificateAddress(hash, parseAsset(asset), this.programId);
        const { slot, accounts: [acc] } = await this.accountsAt([addr]);
        if (!acc || acc.owner !== this.programId)
            return null;
        return this.live(decodeCertificate(addr, acc.data), slot);
    }
    /**
     * Look a subject up the way a person types it: `@handle`, `x:handle`, `wallet:<key>`, `badge:<key>`,
     * a bare key (tried as wallet and as badge), or a 64-hex subject hash. Every asset is checked.
     */
    async lookup(query, opts = {}) {
        const q = parseSubjectQuery(query);
        const candidates = [];
        if (q.type === "hash")
            candidates.push({ kind: -1, value: null, subjectHash: toHex(q.hash) });
        else
            for (const s of q.subjects)
                candidates.push({ kind: s.kind, value: s.value, subjectHash: toHex(await subjectHash(s)) });
        const assets = opts.asset === undefined ? Object.keys(ASSETS).map(Number) : [parseAsset(opts.asset)];
        const addrs = [];
        for (const c of candidates)
            for (const a of assets)
                addrs.push((await certificateAddress(fromHex(c.subjectHash), a, this.programId))[0]);
        const { slot, accounts: accs } = await this.accountsAt(addrs);
        const certificates = [];
        accs.forEach((acc) => {
            if (acc && acc.owner === this.programId)
                certificates.push(this.live(decodeCertificate(acc.address, acc.data), slot));
        });
        // a bare key that matched as a badge: keep only the kinds that exist, and the hash candidate learns its kind
        for (const c of candidates)
            if (c.kind === -1)
                c.kind = certificates.find((x) => x.subjectHash === c.subjectHash)?.subjectKind ?? -1;
        return { query, slot, candidates, certificates };
    }
    /** The one-call gate: does this subject hold a live certificate of at least `minTier` in `asset`? */
    async checkProofOfFunds(args) {
        const asset = parseAsset(args.asset);
        tierMinimum(asset, args.minTier);
        const query = typeof args.subject === "string" ? args.subject : `${["wallet", "x", "badge"][args.subject.kind]}:${args.subject.value}`;
        const { certificates: certs, slot } = await this.lookup(query, { asset });
        if (!certs.length)
            return { ok: false, reason: "no_certificate", slot, certificate: null };
        const best = certs.sort((a, b) => Number(b.live) - Number(a.live) || b.tier - a.tier)[0];
        if (!best.live)
            return { ok: false, reason: best.effectiveStatus, slot, certificate: best };
        if (best.tier < args.minTier)
            return { ok: false, reason: "below_tier", slot, certificate: best };
        return { ok: true, reason: "ok", slot, certificate: best };
    }
    /** Every certificate matching the filter (getProgramAccounts with memcmp filters). */
    async listCertificates(f = {}) {
        const filters = [memcmp(0, layout.certificate.discriminator())];
        if (f.asset !== undefined)
            filters.push(memcmp(layout.certificate.offset("asset"), Uint8Array.of(parseAsset(f.asset))));
        if (f.tier !== undefined)
            filters.push(memcmp(layout.certificate.offset("tier"), Uint8Array.of(f.tier)));
        if (f.subjectKind !== undefined)
            filters.push(memcmp(layout.certificate.offset("subject_kind"), Uint8Array.of(f.subjectKind)));
        const { slot, accounts: accs } = await this.programAccountsAt(this.programId, filters);
        let certificates = accs.map((a) => this.live(decodeCertificate(a.address, a.data), slot));
        if (f.minTier !== undefined)
            certificates = certificates.filter((c) => c.tier >= f.minTier);
        const st = f.status ?? "any";
        if (st !== "any")
            certificates = certificates.filter((c) => c.effectiveStatus === st);
        certificates.sort((a, b) => b.certifiedSlot - a.certifiedSlot);
        return { slot, certificates };
    }
    /** The program's Config: verifier keys, fee, validity, tier tables in base units. */
    async getConfig() {
        const [addr] = await configAddress(this.programId);
        const { slot, accounts: [acc] } = await this.accountsAt([addr]);
        if (!acc || acc.owner !== this.programId)
            return null;
        const c = decodeConfig(acc.data);
        return { ...c, activeVerifier: activeVerifier(c, slot), slot };
    }
    /**
     * The verifier keys the program accepted, for checking log ENTRIES (never trust the key a leaf names about itself):
     *  - the Config's verifier and scheduled next verifier;
     *  - with `fromCertificates`, the `verifier` of every open certificate (certify only stores the key it accepted);
     *  - with `history`, every key a `VerifierSet` event named, read from the ADMIN's transactions (set_verifier and
     *    init_config are admin-signed; scanning the Config account instead would walk every certify ever made).
     * `active` is the one key a log HEAD may be signed with now (audit W-02): a retired key must not sign new heads.
     */
    async verifierKeys(opts = {}) {
        let calls = 1;
        const c = await this.getConfig();
        const keys = new Set();
        const DEFAULT = "11111111111111111111111111111111";
        if (c) {
            keys.add(c.verifier);
            if (c.nextVerifier)
                keys.add(c.nextVerifier);
        }
        if (opts.fromCertificates) {
            calls++;
            const { certificates } = await this.listCertificates();
            for (const x of certificates)
                if (x.verifier && x.verifier !== DEFAULT)
                    keys.add(x.verifier);
        }
        let fromHistory = false;
        if (opts.history && c && this.rpc.getSignaturesForAddress && this.rpc.getTransactionLogs) {
            let before;
            let seen = 0;
            const max = opts.maxTransactions ?? 200;
            for (;;) {
                calls++;
                const page = await this.rpc.getSignaturesForAddress(c.admin, { before, limit: Math.min(1000, max - seen) });
                if (!page.length)
                    break;
                for (const sig of page) {
                    if (sig.err)
                        continue;
                    calls++;
                    const logs = await this.rpc.getTransactionLogs(sig.signature);
                    if (!logs?.some((l) => l.startsWith("Program " + this.programId + " invoke")))
                        continue;
                    for (const e of decodeEvents(logs)) {
                        if (e.name !== "VerifierSet")
                            continue;
                        for (const k of [e.data.verifier, e.data.next_verifier])
                            if (k && k !== DEFAULT)
                                keys.add(String(k));
                    }
                }
                seen += page.length;
                before = page[page.length - 1].signature;
                if (page.length < 1000 || seen >= max)
                    break;
            }
            fromHistory = true;
        }
        const active = c ? activeVerifier(c, c.slot) : null;
        return { active, current: active, next: c?.nextVerifier ?? null, all: [...keys], fromHistory, rpcCalls: calls };
    }
    /** The Treasury's public counters, and the transparency log head anchored on chain. */
    async getTreasury() {
        const [addr] = await treasuryAddress(this.programId);
        const acc = await this.rpc.getAccount(addr);
        if (!acc || acc.owner !== this.programId)
            return null;
        return { ...decodeTreasury(acc.data), address: addr };
    }
    async getRoom(address) {
        const addr = toAddress(address);
        const acc = await this.rpc.getAccount(addr);
        if (!acc || acc.owner !== this.gateProgramId)
            return null;
        return decodeRoom(addr, acc.data);
    }
    async listRooms() {
        const accs = await this.rpc.getProgramAccounts(this.gateProgramId, [memcmp(0, layout.room.discriminator())]);
        return accs.map((a) => decodeRoom(a.address, a.data));
    }
    /** A room with its members, each with the live status of the certificate behind it. */
    async getRoomWithMembers(address, opts = {}) {
        // the room and its members in parallel: the member filter needs only the room's address
        const addr = toAddress(address);
        const [room, accs] = await Promise.all([
            opts.room ? Promise.resolve(opts.room) : this.getRoom(addr),
            this.rpc.getProgramAccounts(this.gateProgramId, [memcmp(0, layout.member.discriminator()), memcmp(layout.member.offset("room"), toAddressBytes(addr))]),
        ]);
        if (!room)
            return null;
        const members = accs.map((a) => decodeMember(a.address, a.data));
        const certAddrs = await Promise.all(members.map(async (m) => m.certificate ?? (await certificateAddress(fromHex(m.subjectHash), room.asset, this.programId))[0]));
        const { slot, accounts: certs } = await this.accountsAt(certAddrs);
        return {
            slot,
            room,
            members: members.map((m, i) => {
                const acc = certs[i];
                if (!acc || acc.owner !== this.programId)
                    return { ...m, certificateStatus: "missing", tier: null, live: false };
                const c = this.live(decodeCertificate(acc.address, acc.data), slot);
                const live = c.live && c.tier >= room.minTier && c.asset === room.asset;
                return { ...m, certificate: acc.address, certificateStatus: c.effectiveStatus, tier: c.tier, live };
            }),
        };
    }
    /**
     * Counters: live certificates, revocations, and the sum of live tier minimums per asset.
     * The cumulative counters come from the Treasury when it exists (expired certificates are closed, so a scan cannot
     * count them); the per-tier breakdown comes from a scan of the open certificates.
     */
    async stats(opts = {}) {
        const [{ slot, certificates }, treasury] = await Promise.all([opts.list ? Promise.resolve(opts.list) : this.listCertificates(), this.getTreasury()]);
        const out = {
            slot, total: certificates.length, live: 0, revokedSpent: 0, revokedByHolder: 0, expired: 0, treasury,
            byAsset: {},
            bySubjectKind: { wallet: 0, x: 0, badge: 0 },
        };
        for (const a of Object.values(ASSETS))
            out.byAsset[a.symbol] = { live: 0, certifiedMinimum: 0, byTier: {} };
        for (const c of certificates) {
            if (c.effectiveStatus === "revoked_spent")
                out.revokedSpent++;
            else if (c.effectiveStatus === "revoked_by_holder")
                out.revokedByHolder++;
            else if (c.effectiveStatus === "expired")
                out.expired++;
            if (!c.live)
                continue;
            out.live++;
            out.bySubjectKind[c.subjectKindName] = (out.bySubjectKind[c.subjectKindName] ?? 0) + 1;
            const b = out.byAsset[c.assetSymbol] ?? (out.byAsset[c.assetSymbol] = { live: 0, certifiedMinimum: 0, byTier: {} });
            b.live++;
            b.byTier[c.tier] = (b.byTier[c.tier] ?? 0) + 1;
            if (ASSETS[c.asset]?.tiers[c.tier] !== undefined)
                b.certifiedMinimum += tierMinimum(c.asset, c.tier);
        }
        if (treasury) {
            // the program's own counters are authoritative for the cumulative numbers
            out.total = treasury.certified;
            out.revokedSpent = treasury.revokedSpent;
            out.revokedByHolder = treasury.revokedHolder;
            out.expired = Math.max(treasury.expired, out.expired);
        }
        return out;
    }
}
