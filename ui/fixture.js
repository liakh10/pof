/* Development fixture (localhost with ?fixture only; data.js never imports this file on a deployed site).
   It builds a small chain in memory with the SDK's own MemoryRpc and account encoders, and a transparency log with real
   Ed25519 signatures over real 240-byte attestations, so the wall, /c, /verify, /rooms and /log run every code path they
   run in production: decode, status, proofs, signatures, trusted keys from Config. Time moves: the slot advances, new
   certificates arrive and live ones get revoked. */
import * as sdk from '/sdk/dist/index.js';
import { MemoryRpc } from '/sdk/dist/testing.js';

const PROGRAM = (window.POF && window.POF.PROGRAM) || sdk.POF_PROGRAM_ID;
const GATE = (window.POF && window.POF.GATE) || sdk.POF_GATE_PROGRAM_ID;
const DEFAULT = '11111111111111111111111111111111';

let seed = 20261125;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];
const bytes = n => Uint8Array.from({ length: n }, () => Math.floor(rnd() * 256));
const key = () => sdk.encodeBase58(bytes(32));

export async function fixtureSource() {
  const rpc = new MemoryRpc();
  const t0 = performance.now();
  const SLOT0 = 473_620_000;
  rpc.slot = SLOT0;
  const now = () => SLOT0 + Math.floor((performance.now() - t0) / 400);

  // the Verifier key: a real Ed25519 key made in this tab
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const verifier = sdk.encodeBase58(pub);
  const sign = async m => new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, m));
  const relayer = key();
  const bundle = await sdk.sha256('pof-verifier fixture bundle');
  await rpc.putConfig({ admin: key(), dev: key(), relayer, verifier, next_verifier: DEFAULT, root_mint: DEFAULT, params: { fee_lamports: 20_000_000, holder_min: 1_000_000_000_000, validity_slots: 216_000, max_attest_age: 300, max_root_lag: 9000, rotation_delay: 216_000 } }, PROGRAM);

  // the log: leaves and their hashes
  const leaves = [], leafHashes = [];
  const certs = [];
  async function addCertificate({ kind, asset, tier, at, status = 0, revokedAt = 0, notes = 1 + Math.floor(rnd() * 3), payer }) {
    const value = kind === 1 ? null : key();
    const subject = kind === 0 ? sdk.walletSubject(value) : kind === 2 ? sdk.badgeSubject(value) : sdk.xSubject(pick(['night_desk', 'otcmarta', 'pierogi_whale', 'laminar', 'quietsize', 'deskthree', 'brickwall_sol', 'basispoint']) + Math.floor(rnd() * 90));
    const hash = await sdk.subjectHash(subject);
    const controller = kind === 1 ? key() : value;
    const hashes = Array.from({ length: notes }, () => bytes(32)).sort((a, b) => sdk.toHex(a).localeCompare(sdk.toHex(b)));
    const nullset = await sdk.sha256(...hashes);
    const nonce = sdk.toHex(bytes(16));
    const issued = at - 12;
    const expiry = issued + 216_000;
    const att = sdk.buildAttestation({ programId: PROGRAM, subjectKind: kind, subjectHash: sdk.toHex(hash), asset, tier, treeRoot: sdk.toHex(bytes(32)), rootSlot: issued - 40, noteCount: notes, nullsetHash: sdk.toHex(nullset), issuedSlot: issued, expirySlot: expiry, payer: payer || (kind === 0 ? value : relayer), controller, nonce });
    const sig = await sign(att);
    const slotLe = new Uint8Array(8); new DataView(slotLe.buffer).setBigUint64(0, BigInt(issued), true);
    const leaf = new Uint8Array(377); leaf[0] = 1; leaf.set(att, 1); leaf.set(sig, 241); leaf.set(pub, 305); leaf.set(bundle, 337); leaf.set(slotLe, 369);
    const index = leaves.length;
    leaves.push({ leaf, slot: issued }); leafHashes.push(await sdk.leafHash(leaf));
    const [addr, bump] = await sdk.certificateAddress(hash, asset, PROGRAM);
    const nulls = Array.from({ length: 8 }, (_, i) => hashes[i] || new Uint8Array(32));
    const write = (st, rev) => rpc.put(addr, PROGRAM, sdk.encodeAccountPartial(sdk.POF_IDL, 'Certificate', {
      subject_kind: kind, subject_hash: hash, asset, tier, status: st, certified_slot: at, issued_slot: issued, expiry_slot: expiry, revoked_slot: rev,
      tree_root: bytes(32), root_slot: issued - 40, note_count: notes, null_hashes: nulls, nullset_hash: nullset, payer: payer || (kind === 0 ? value : relayer),
      controller, verifier, nonce: sdk.fromHex(nonce), log_index: index, renewals: 0, revealed_index: st === 1 ? 0 : 255,
      revealed_salt: st === 1 ? bytes(32) : new Uint8Array(32), revealed_nullifier: st === 1 ? bytes(32) : new Uint8Array(32), bump,
    }));
    write(status, revokedAt);
    const c = { addr, kind, value, subject, hash: sdk.toHex(hash), asset, tier, status, write, controller };
    certs.push(c);
    return c;
  }

  // history: a few dozen certificates across the last days of slots, some revoked, a couple expired-looking
  const plan = [];
  for (let i = 0; i < 34; i++) {
    const asset = rnd() < 0.68 ? 0 : 1;
    const tier = pick([1, 2, 2, 3, 3, 3, 4, 4, 5]);
    const kind = pick([0, 0, 1, 1, 1, 2]);
    plan.push({ kind, asset, tier, at: SLOT0 - Math.floor(rnd() * 190_000) - 500 });
  }
  plan.sort((a, b) => a.at - b.at);
  for (const p of plan) {
    const r = rnd();
    if (r < 0.16) await addCertificate({ ...p, status: 1, revokedAt: Math.min(SLOT0 - 20, p.at + Math.floor(rnd() * 20_000)) });
    else if (r < 0.22) await addCertificate({ ...p, status: 2, revokedAt: Math.min(SLOT0 - 20, p.at + Math.floor(rnd() * 20_000)) });
    else if (r < 0.25) await addCertificate({ ...p, status: 4, revokedAt: Math.min(SLOT0 - 20, p.at + Math.floor(rnd() * 20_000)) });
    else await addCertificate(p);
  }

  // rooms
  const rooms = [];
  for (const [name, asset, minTier] of [['Desk 1000', 0, 4], ['OTC counterparties', 1, 3], ['Hundred club', 0, 3], ['Size check', 0, 2]]) {
    const creator = key();
    const id = Math.floor(rnd() * 1000);
    const [addr] = await sdk.roomAddress(creator, id, GATE);
    const members = certs.filter(c => c.asset === asset && c.tier >= minTier).slice(0, 9);
    rpc.putRoom(addr, { creator, id, asset, minTier, memberCount: members.length, name, gateProgramId: GATE });
    for (const m of members) await rpc.putMember(addr, sdk.fromHex(m.hash), m.addr, GATE);
    rooms.push(addr);
  }

  const treasury = async () => {
    const list = certs;
    await rpc.putTreasury({ certified: list.length, renewed: 2, revoked_spent: list.filter(c => c.status === 1).length, revoked_holder: list.filter(c => c.status === 2).length,
      expired: 0, live: list.filter(c => c.status === 0).length, live_min: [0, 1, 2, 3].map(a => BigInt(list.filter(c => c.status === 0 && c.asset === a).reduce((s, c) => s + sdk.tierMinimum(a, c.tier), 0)) * (a === 0 ? 1_000_000_000n : 1_000_000n)),
      open: list.length, relayed: list.filter(c => c.kind !== 0).length, exempt: 1, log_size: leaves.length, log_head: await sdk.merkleRoot(leafHashes), log_slot: now() - 30 }, PROGRAM);
  };
  await treasury();

  // time moves: a new certificate every so often, and now and then a live one is revoked (funds moved)
  setInterval(async () => {
    rpc.slot = now();
    if (rnd() < 0.5) {
      const live = certs.filter(c => c.status === 0);
      const c = pick(live);
      if (c) { c.status = 1; c.write(1, now()); }
    } else {
      await addCertificate({ kind: pick([0, 1, 1, 2]), asset: rnd() < 0.7 ? 0 : 1, tier: pick([2, 3, 3, 4, 5]), at: now() });
    }
    await treasury();
  }, 7000);
  setInterval(() => { rpc.slot = now(); }, 400);

  const client = new sdk.PofClient({ rpc, programId: PROGRAM, gateProgramId: GATE });
  const certJson = (c, subjectValue = null) => ({
    address: c.address, subject: subjectValue, kind: c.subjectKindName, subjectHash: c.subjectHash, asset: c.assetSymbol, assetId: c.asset,
    tier: c.tier, tierLabel: c.tierLabel, status: c.effectiveStatus, statusOnChain: c.statusName, live: c.live, certifiedSlot: c.certifiedSlot,
    expirySlot: c.expirySlot, revokedSlot: c.revokedSlot, logIndex: c.logIndex, noteCount: c.noteCount, payer: c.payer, verifierKey: c.verifier,
    controller: c.controller, issuedSlot: c.issuedSlot, renewals: c.renewals, revealed: c.revealed,
  });
  const fail = (code, message, status = 404) => Object.assign(Error(message), { code, status });
  const head = async () => {
    const size = leaves.length, root = await sdk.merkleRoot(leafHashes);
    const signature = sdk.toHex(await sign(sdk.treeHeadMessage(PROGRAM, size, root)));
    return { treeSize: size, rootHash: sdk.toHex(root), slot: now(), signature, verifierKey: verifier };
  };
  const delay = ms => new Promise(r => setTimeout(r, ms));

  return {
    mode: 'fixture',
    slot: async () => now(),
    async stats() {
      const s = await client.stats();
      const h = await head();
      return { slot: s.slot, live: s.treasury ? s.treasury.live : s.live, total: s.total, revoked: s.revokedSpent + s.revokedByHolder, revokedSpent: s.revokedSpent, revokedByHolder: s.revokedByHolder, expired: s.expired,
        solCertified: s.byAsset.SOL?.certifiedMinimum ?? 0, usdcCertified: s.byAsset.USDC?.certifiedMinimum ?? 0, byAsset: s.byAsset, bySubjectKind: s.bySubjectKind,
        log: { treeSize: h.treeSize, rootHash: h.rootHash, signatureValid: true, keyTrusted: true } };
    },
    async config() { const c = await client.getConfig(); return { slot: c.slot, programId: PROGRAM, gateProgramId: GATE, verifier: c.activeVerifier, relayer: c.relayer, feeLamports: c.feeLamports, holderMin: c.holderMin, validitySlots: c.validitySlots, paused: c.paused }; },
    async list(o = {}) {
      await delay(120);
      const all = await client.listCertificates({});
      let list = all.certificates;
      if (o.status && o.status !== 'any') list = list.filter(c => c.effectiveStatus === o.status);
      if (o.asset !== undefined && o.asset !== '') list = list.filter(c => c.assetSymbol === o.asset || String(c.asset) === String(o.asset));
      return { slot: all.slot, total: list.length, cursor: 0, nextCursor: null, certificates: list.slice(0, Number(o.limit) || 100).map(c => certJson(c)) };
    },
    async lookup(query, o = {}) {
      await delay(150);
      let r;
      try { r = await client.lookup(query, {}); } catch (e) { throw fail('bad_subject', e.message, 400); }
      const byHash = new Map(r.candidates.map(c => [c.subjectHash, c]));
      const certificates = r.certificates.sort((a, b) => Number(b.live) - Number(a.live) || b.tier - a.tier).map(c => certJson(c, byHash.get(c.subjectHash)?.value ?? null));
      const out = { query, slot: r.slot, subjects: r.candidates.map(c => ({ kind: sdk.SUBJECT_KIND_NAMES[c.kind], value: c.value, subjectHash: c.subjectHash })), live: certificates.some(c => c.live), certificates };
      if (o.minTier !== undefined && o.asset !== undefined) {
        const best = certificates.filter(c => c.asset === o.asset)[0];
        const reason = !best ? 'no_certificate' : !best.live ? best.status : best.tier < Number(o.minTier) ? 'below_tier' : 'ok';
        out.check = { asset: o.asset, minTier: Number(o.minTier), ok: reason === 'ok', reason };
      }
      return out;
    },
    async rooms() {
      const list = await client.listRooms();
      return { rooms: list.map(r => ({ address: r.address, creator: r.creator, id: r.id, name: r.name, asset: r.assetSymbol, minTier: r.minTier, minTierLabel: r.minTierLabel, memberCount: r.memberCount, createdSlot: r.createdSlot })) };
    },
    async room(addr) {
      const r = await client.getRoomWithMembers(addr);
      if (!r) throw fail('not_found', `no pof_gate room at ${addr}`);
      return { address: r.room.address, creator: r.room.creator, id: r.room.id, name: r.room.name, asset: r.room.assetSymbol, assetId: r.room.asset, minTier: r.room.minTier, minTierLabel: r.room.minTierLabel, memberCount: r.room.memberCount, createdSlot: r.room.createdSlot, slot: r.slot, liveMembers: r.members.filter(m => m.live).length,
        members: r.members.map(m => ({ address: m.address, subjectHash: m.subjectHash, certificate: m.certificate, certificateStatus: m.certificateStatus, tier: m.tier, live: m.live, joinedSlot: m.joinedSlot })) };
    },
    log: {
      head,
      async entry(i) {
        const l = leaves[i]; if (!l) throw fail('not_found', `no entry ${i}`);
        const p = sdk.parseLeaf(l.leaf);
        return { index: i, leaf: sdk.toHex(l.leaf), leafHash: sdk.toHex(leafHashes[i]), attestation: p.attestationBytes, signature: p.signature, verifierKey: p.verifierKey, bundleHash: p.bundleHash, loggedSlot: l.slot };
      },
      async proof(i, size = leaves.length) {
        const hs = leafHashes.slice(0, size);
        return { index: i, treeSize: size, rootHash: sdk.toHex(await sdk.merkleRoot(hs)), leafHash: sdk.toHex(hs[i]), path: (await sdk.inclusionPath(i, hs)).map(sdk.toHex) };
      },
      async consistency(m, n = leaves.length) {
        const hs = leafHashes.slice(0, n);
        return { first: m, second: n, firstRoot: sdk.toHex(await sdk.merkleRoot(hs.slice(0, m))), secondRoot: sdk.toHex(await sdk.merkleRoot(hs)), path: (await sdk.consistencyProof(m, hs)).map(sdk.toHex) };
      },
      async range(from, to) {
        const out = [];
        for (let i = Math.max(0, from); i < Math.min(to, leaves.length, from + 256); i++) out.push(await this.entry(i));
        return { treeSize: leaves.length, entries: out };
      },
      async witness() { throw fail('not_found', 'no witness has published yet'); },
    },
    async verifierFacts() { return { verifierKey: verifier, relayer, bundleHash: sdk.toHex(bundle), minAgeSlots: 150, validitySlots: 216_000, assets: {} }; },
    chain: () => client,
    rpc: async (method) => { if (method === 'getSlot') return now(); throw fail('rpc', 'not in the fixture'); },
  };
}
