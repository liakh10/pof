// The fuzz world: keys from the seed, the program set up as on launch (with the quick floors), and helpers every suite uses:
// attestations, certify/renew/revoke builders, a model of every check certify makes before the signature, the invariant checker
// over every POF and pof_gate account, and the result ledger (cases, unexpected outcomes, error-branch coverage).
import fs from 'node:fs';
import path from 'node:path';
import { SCRATCH, FUZZ, web3, Keypair, PublicKey, SystemProgram, rng, loadIdl, harness, attBytes, sthBytes, edIx, keySubject, subjectHash, salted, sha256, u64le } from './core.mjs';

export const STATUS = { live: 0, spent: 1, holder: 2 };
export async function world(seed) {
  const idls = loadIdl();
  const h = harness(idls);
  const { P, G, HOSTILE } = h;
  const R = rng(seed);
  const fx = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'fixture.json'), 'utf8'));
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(SCRATCH, 'authority.json'), 'utf8'))));
  const kp = () => R.keypair();
  // the genesis keys of fuzz/prep.mjs when the chain started with its config (fuzz/chain.sh), else fresh ones (init_config)
  const gk = fs.existsSync(path.join(SCRATCH, 'genesis-keys.json')) ? Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(SCRATCH, 'genesis-keys.json'), 'utf8'))).map(([k, v]) => [k, Keypair.fromSecretKey(Uint8Array.from(v))])) : null;
  const V = gk?.V ?? kp(), V2 = gk?.V2 ?? kp(), V3 = gk?.V3 ?? kp(), relayer = gk?.relayer ?? kp(), dev = gk?.dev ?? kp();
  const users = Array.from({ length: 10 }, kp);
  const K = {
    config: P.pda(['config']), treasury: P.pda(['treasury']),
    programData: PublicKey.findProgramAddressSync([P.programId.toBuffer()], new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))[0],
    tree0: new PublicKey(fx.tree0), ft: new PublicKey(fx.ft), SPP: new PublicKey('ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW'),
  };
  const certPda = (sh, asset) => P.pda([Buffer.from('cert'), Buffer.from(sh), Buffer.from([asset & 255])]);
  const roomPda = (creator, id) => G.pda([Buffer.from('room'), new PublicKey(creator).toBuffer(), u64le(id)]);
  const memberPda = (room, sh) => G.pda([Buffer.from('member'), new PublicKey(room).toBuffer(), Buffer.from(sh)]);
  const nfPda = (tree, nf) => PublicKey.findProgramAddressSync([Buffer.from('nullifier'), new PublicKey(tree).toBuffer(), Buffer.from(nf)], K.SPP)[0];
  const decode = async (prog, name, addr) => { const a = await h.info(addr); return a ? prog.decodeAccount(name, a.data) : null; };
  const config = () => decode(P, 'Config', K.config);
  const treasury = () => decode(P, 'Treasury', K.treasury);
  const cert = (sh, asset = 0) => decode(P, 'Certificate', certPda(sh, asset));

  /* ---------------------------------------------------------------- the ledger */
  const results = { seed: String(seed), suites: {}, coverage: {}, unexpected: [], cu: {}, sizes: {} };
  let current = 'setup';
  const suite = name => { current = name; results.suites[name] = results.suites[name] || { cases: 0, unexpected: 0, notes: [] }; };
  const cover = (ix, why) => { (results.coverage[ix] = results.coverage[ix] || {})[why || 'ok'] = ((results.coverage[ix] || {})[why || 'ok'] || 0) + 1; };
  /** one case: `want` is null (must succeed), a string or array of acceptable error names, or '*' (must fail, any reason) */
  function expect(name, ix, got, want, extra = {}) {
    const s = results.suites[current]; s.cases++;
    cover(ix, got.ok ? null : got.why);
    const okWanted = want === null;
    const match = okWanted ? got.ok : !got.ok && (want === '*' || [].concat(want).includes('*') || [].concat(want).includes(got.why));
    if (!match) {
      s.unexpected++;
      const row = { suite: current, case: name, ix, want: want === null ? 'ok' : want, got: got.ok ? 'ok' : got.why, slot: got.slot, ...extra };
      results.unexpected.push(row);
      console.log(`  UNEXPECTED [${current}] ${name}: want ${JSON.stringify(row.want)}, got ${row.got}` + (process.env.LOGS ? '\n' + (got.logs || []).slice(-12).join('\n') : ''));
    }
    return match;
  }
  const note = text => { results.suites[current].notes.push(text); console.log('  note: ' + text); };
  const cu = (name, units, size) => { const c = results.cu[name] = results.cu[name] || { max: 0, min: Infinity, n: 0, maxSize: 0 }; c.max = Math.max(c.max, units || 0); c.min = Math.min(c.min, units || Infinity); c.n++; if (size) c.maxSize = Math.max(c.maxSize, size); };

  /* ---------------------------------------------------------------- attestations and instructions */
  const kindOf = (kind, k) => keySubject(kind, k.publicKey || k);
  async function att(o = {}) {
    const slot = o.slot ?? await h.slotNow();
    const kind = o.kind ?? 0;
    const ctl = o.controller ?? (o.ctlKp ? o.ctlKp.publicKey : kp().publicKey);
    const subject_hash = o.subject_hash ?? (kind === 1 ? subjectHash(1, o.handle ?? 'h' + R.bytes(6).toString('hex')) : keySubject(kind, ctl));
    const issued = o.issued_slot ?? slot - 1;
    return {
      subject_kind: kind, subject_hash, asset: o.asset ?? 0, tier: o.tier ?? 1, tree_root: o.tree_root ?? R.bytes(32),
      root_slot: o.root_slot ?? (BigInt(issued) > 3n ? BigInt(issued) - 3n : 0n), null_hashes: o.null_hashes ?? sortedHashes(o.n ?? 2).hashes,
      issued_slot: BigInt(issued), expiry_slot: o.expiry_slot ?? BigInt(issued) + BigInt(o.valid ?? 500), controller: ctl, nonce: o.nonce ?? R.bytes(16),
    };
  }
  /** n notes with fresh salts (or given nullifiers): { list: [{salt, nf, h}], hashes (sorted), index(nf) } */
  function sortedHashes(n, nfs) {
    const list = (nfs || Array.from({ length: n }, () => R.field())).map(nf => { const salt = R.bytes(32); return { salt, nf: Buffer.from(nf), h: salted(salt, Buffer.from(nf)) }; });
    const hashes = list.map(x => x.h).sort(Buffer.compare);
    return { list, hashes, index: nf => hashes.findIndex(x => x.equals(list.find(l => l.nf.equals(Buffer.from(nf))).h)), of: nf => list.find(l => l.nf.equals(Buffer.from(nf))) };
  }
  const notesOf = sortedHashes;
  function certifyIxs(payer, a, o = {}) {
    const signer = o.signer ?? api.V;
    const msg = o.msg ?? attBytes(o.signed ?? a, o.signedPayer ?? payer.publicKey, o.programId ?? P.programId);
    const ed = o.ed ?? edIx(signer, msg, o.edOpts || {});
    const holderDefault = api.rootMint ? PublicKey.findProgramAddressSync([payer.publicKey.toBuffer(), new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBuffer(), api.rootMint.toBuffer()], new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))[0] : payer.publicKey;
    const accounts = { payer: payer.publicKey, certificate: o.certificate ?? certPda(a.subject_hash, a.asset), holder_token: o.holder ?? holderDefault };
    if ((o.name ?? 'certify') === 'certify') accounts.prior_payer = o.prior ?? null;
    const args = (o.name ?? 'certify') === 'certify' ? { att: a, log_index: o.logIndex ?? 0 } : { att: a };
    return [ed, P.ix(o.name ?? 'certify', args, { ...accounts, ...(o.accounts || {}) })];
  }
  const certify = (payer, a, o = {}) => h.send(certifyIxs(payer, a, o), [payer, ...(o.extraSigners || [])], o);
  const simCertify = (payer, a, o = {}) => h.sim(certifyIxs(payer, a, o), [payer], o);
  const revokeSpentIx = (caller, sh, asset, index, salt, nf, o = {}) => P.ix('revoke_spent', { index, salt, nullifier: nf, membership: o.membership ?? null },
    { caller: caller.publicKey, certificate: o.certificate ?? certPda(sh, asset), tree: o.tree ?? K.tree0, nullifier_account: o.nfAccount === undefined ? (o.membership ? null : nfPda(o.tree ?? K.tree0, nf)) : o.nfAccount });
  const revokeHolderIx = (ctl, sh, asset = 0) => P.ix('revoke_by_holder', {}, { controller: ctl.publicKey, certificate: certPda(sh, asset) });
  const expireIx = (caller, sh, asset, payer) => P.ix('expire', {}, { caller: caller.publicKey, certificate: certPda(sh, asset), payer });
  const anchorIxs = (signer, size, head, caller) => [edIx(signer, sthBytes(size, head, P.programId)), P.ix('anchor_log', { size, head }, { caller: caller.publicKey })];
  const joinIx = (ctl, payer, room, sh, asset = 0, o = {}) => G.ix('join', { subject_hash: sh }, { controller: ctl.publicKey ?? ctl, payer: payer.publicKey, room, member: memberPda(room, sh), certificate: o.certificate ?? certPda(sh, asset), pof_config: K.config, pof_program: o.pofProgram ?? P.programId });
  const evictIx = (caller, room, sh, m) => G.ix('evict', {}, { caller: caller.publicKey, room, member: memberPda(room, sh), payer: m.payer, certificate: m.certificate, pof_config: K.config });
  const transfer = (from, to, lamports) => SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: new PublicKey(to), lamports: BigInt(lamports) });

  /* ---------------------------------------------------------------- the model of certify's checks before the signature */
  const DEFAULT = PublicKey.default;
  function model(a, slot, c) {
    if (c.closing) return 'Closing';
    if (c.paused) return 'Paused';
    if (a.subject_kind === 0 || a.subject_kind === 2) { if (!keySubject(a.subject_kind, new PublicKey(a.controller)).equals(Buffer.from(a.subject_hash))) return 'SubjectMismatch'; }
    else if (a.subject_kind === 1) { if (new PublicKey(a.controller).equals(DEFAULT)) return 'NotController'; }
    else return 'BadSubjectKind';
    if (a.asset >= 4) return 'BadAsset';
    const t = c.assets[a.asset];
    if (!t.enabled) return 'BadAsset';
    const tiers = t.mins.findIndex(m => m === 0n) < 0 ? 5 : t.mins.findIndex(m => m === 0n);
    if (a.tier < 1 || a.tier > tiers) return 'BadTier';
    const n = a.null_hashes.length;
    if (n < 1 || n > 8) return 'BadNoteCount';
    for (let i = 1; i < n; i++) if (Buffer.compare(Buffer.from(a.null_hashes[i - 1]), Buffer.from(a.null_hashes[i])) >= 0) return 'NullHashesUnsorted';
    const u = v => BigInt.asUintN(64, BigInt(v));
    const s = u(slot), is = u(a.issued_slot), rs = u(a.root_slot), ex = u(a.expiry_slot), p = c.params;
    if (is > s) return 'IssuedInFuture';
    if (s - is > p.max_attest_age) return 'AttestationStale';
    if (!(rs <= is && is - rs <= p.max_root_lag)) return 'RootStale';
    if (!(ex > is && ex - is <= p.validity_slots)) return 'BadExpiry';
    if (!(ex > s)) return 'Expired';
    return null;
  }

  /* ---------------------------------------------------------------- invariants over every account */
  async function invariants(tag) {
    const c = await config(), t = await treasury();
    const pofAccs = await h.conn.getProgramAccounts(P.programId, { commitment: 'confirmed' });
    const certs = pofAccs.map(x => ({ address: x.pubkey, lamports: BigInt(x.account.lamports), len: x.account.data.length, c: P.decodeAccount('Certificate', x.account.data) })).filter(x => x.c);
    const rent = BigInt(await h.conn.getMinimumBalanceForRentExemption(certs[0]?.len ?? 595));
    const bad = [];
    const liveN = certs.filter(x => x.c.status === 0).length;
    if (t.open !== BigInt(certs.length)) bad.push(`open ${t.open} != ${certs.length} certificate accounts`);
    if (t.live !== BigInt(liveN)) bad.push(`live ${t.live} != ${liveN} certificates with status live`);
    if (t.live !== t.certified - t.revoked_spent - t.revoked_holder - t.expired - (t.voided ?? 0n)) bad.push(`live ${t.live} != certified ${t.certified} - revoked ${t.revoked_spent}+${t.revoked_holder} - expired ${t.expired} - voided ${t.voided ?? 0n}`);
    for (let i = 0; i < 4; i++) {
      const want = certs.filter(x => x.c.status === 0 && x.c.asset === i).reduce((s, x) => s + c.assets[i].mins[x.c.tier - 1], 0n);
      if (t.live_min[i] !== want) bad.push(`live_min[${i}] ${t.live_min[i]} != ${want}`);
    }
    for (const x of certs) {
      if (x.lamports < rent) bad.push(`certificate ${x.address.toBase58().slice(0, 8)} under rent`);
      if (!certPda(x.c.subject_hash, x.c.asset).equals(x.address)) bad.push(`certificate ${x.address.toBase58().slice(0, 8)} not at its PDA`);
      if (x.c.status === 1 && x.c.revealed_index === 255) bad.push('revoked spent without a revealed note');
      if (x.c.note_count < 1 || x.c.note_count > 8) bad.push('note_count out of range');
    }
    const tInfo = await h.info(K.treasury);
    const tRent = BigInt(await h.conn.getMinimumBalanceForRentExemption(tInfo.data.length));
    if (BigInt(tInfo.lamports) - tRent < t.fees_in - t.fees_out) bad.push(`treasury holds ${BigInt(tInfo.lamports) - tRent} free, owes fees ${t.fees_in - t.fees_out}`);
    const gateAccs = await h.conn.getProgramAccounts(G.programId, { commitment: 'confirmed' });
    const rooms = gateAccs.map(x => ({ address: x.pubkey, r: G.decodeAccount('Room', x.account.data) })).filter(x => x.r);
    const members = gateAccs.map(x => ({ address: x.pubkey, m: G.decodeAccount('Member', x.account.data) })).filter(x => x.m);
    for (const r of rooms) {
      const n = members.filter(m => m.m.room === r.address.toBase58()).length;
      if (r.r.members !== n) bad.push(`room ${r.address.toBase58().slice(0, 8)} counts ${r.r.members} members, has ${n}`);
    }
    for (const m of members) if (!memberPda(m.m.room, m.m.subject_hash).equals(m.address)) bad.push('member not at its PDA');
    const s = results.suites[current]; s.cases++;
    results.invariantChecks = (results.invariantChecks || 0) + 1;
    if (bad.length) { s.unexpected++; results.unexpected.push({ suite: current, case: 'invariants ' + tag, got: bad }); console.log(`  INVARIANT [${current}] ${tag}: ${bad.join('; ')}`); }
    return { ok: !bad.length, certs, rooms, members, t, c };
  }

  async function setup(params) {
    await h.fund([admin, relayer, ...users], 400);
    await h.fund([dev], 1);
    if (await h.info(K.config)) return 'genesis';
    const r = await h.send([P.ix('init_config', { verifier: V.publicKey, relayer: relayer.publicKey, dev: dev.publicKey }, { admin: admin.publicKey, program_data: K.programData })], [admin]);
    if (!r.ok) throw Error('init_config: ' + r.why + '\n' + (r.logs || []).slice(-6).join('\n'));
    const p = await h.send([P.ix('set_params', { params }, { admin: admin.publicKey })], [admin]);
    if (!p.ok) throw Error('set_params: ' + p.why);
  }

  const api = { h, P, G, HOSTILE, R, fx, admin, V, V2, V3, relayer, dev, users, kp, K, certPda, roomPda, memberPda, nfPda, decode, config, treasury, cert,
    results, suite, expect, note, cover, cu, att, notesOf, certifyIxs, certify, simCertify, revokeSpentIx, revokeHolderIx, expireIx, anchorIxs, joinIx, evictIx, transfer,
    model, invariants, setup, kindOf, attBytes, sthBytes, edIx, keySubject, subjectHash, salted, sha256, u64le };
  return api;
}
