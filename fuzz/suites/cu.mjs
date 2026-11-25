// Suite "cu": compute units of every instruction at its worst case and the transaction size limits.
// Worst cases: certify of a wallet subject (base58 of the controller on chain) with 8 notes over a revoked certificate holding a
// donation, another payer (prior-payer transfer, fee, surplus shift), with a subject whose certificate PDA needs extra bump
// tries; the same as a $ROOT holder (ATA derivation and token read; set_roles last, it is one-way); renew with 8 notes;
// revoke_spent by PDA and by a 40-level membership path (a version 1 transaction: the 40-level path does not fit 1,232 bytes);
// pof_gate join (with the CPI), evict, leave; the admin calls. Sizes: a relayed certify with 8 notes, the CONTRACT §7 memo, a
// compute-unit limit and price, as legacy and v0, with one and two signers; the membership path at every length.
import { createRequire } from 'node:module';
import path from 'node:path';
import { PROG, web3, PublicKey, Keypair, TransactionInstruction, edIx, spl } from '../lib/core.mjs';
const require = createRequire(path.join(PROG, 'package.json'));

const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/** a version 1 transaction through @solana/kit (web3.js 1.x has none): { ok, why, size, units, logs } */
export async function sendV1(W, ixs, signers, { simulate = false, units = 1_400_000 } = {}) {
  const kit = require('@solana/kit');
  const rpc = kit.createSolanaRpc(W.h.conn.rpcEndpoint);
  const ks = await Promise.all(signers.map(s => kit.createKeyPairSignerFromBytes(s.secretKey)));
  const role = k => k.isSigner ? (k.isWritable ? kit.AccountRole.WRITABLE_SIGNER : kit.AccountRole.READONLY_SIGNER) : (k.isWritable ? kit.AccountRole.WRITABLE : kit.AccountRole.READONLY);
  const kixs = ixs.map(ix => ({ programAddress: kit.address(ix.programId.toBase58()), accounts: ix.keys.map(k => { const signer = ks.find(s => s.address === k.pubkey.toBase58()); return { address: kit.address(k.pubkey.toBase58()), role: role(k), ...(signer && k.isSigner ? { signer } : {}) }; }), data: Uint8Array.from(ix.data) }));
  const { value: bh } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  let m = kit.createTransactionMessage({ version: 1 });
  m = kit.setTransactionMessageFeePayerSigner(ks[0], m);
  m = kit.setTransactionMessageLifetimeUsingBlockhash(bh, m);
  m = kit.setTransactionMessageComputeUnitLimit ? kit.setTransactionMessageComputeUnitLimit(units, m) : m;
  // a v1 message carries its limits in its config: without this one the loaded-accounts limit defaults low and the 40 KB tree trips it
  m = kit.setTransactionMessageLoadedAccountsDataSizeLimit ? kit.setTransactionMessageLoadedAccountsDataSizeLimit(64 * 1024 * 1024, m) : m;
  m = kit.appendTransactionMessageInstructions(kixs, m);
  let tx;
  try { tx = await kit.signTransactionMessageWithSigners(m); } catch (e) { return { ok: false, why: 'build: ' + e.message }; }
  const wire = kit.getBase64EncodedWireTransaction(tx);
  const size = Buffer.from(wire, 'base64').length;
  try {
    if (simulate) {
      const r = await rpc.simulateTransaction(wire, { encoding: 'base64', sigVerify: false, commitment: 'confirmed' }).send();
      return { ok: !r.value.err, why: r.value.err ? W.h.why(r.value.err, r.value.logs) : null, size, units: Number(r.value.unitsConsumed), pofUnits: W.h.unitsOf(r.value.logs), logs: r.value.logs };
    }
    const sig = await rpc.sendTransaction(wire, { encoding: 'base64', skipPreflight: true }).send();
    for (let i = 0; i < 100; i++) {
      const st = (await W.h.conn.getSignatureStatuses([sig])).value[0];
      if (st && st.confirmationStatus) { const t = await W.h.txOf(sig); const logs = t?.meta?.logMessages || []; return { ok: !st.err, why: st.err ? W.h.why(st.err, logs) : null, size, slot: st.slot, logs, pofUnits: W.h.unitsOf(logs), sig }; }
      await new Promise(r => setTimeout(r, 150));
    }
    return { ok: false, why: 'not confirmed', size };
  } catch (e) { return { ok: false, why: 'rpc: ' + String(e.message || e).slice(0, 300), size }; }
}

export async function cu(W, o = {}) {
  const { h, R, P, G, K, users, expect, note } = W;
  W.suite('cu');
  const sizes = W.results.sizes;
  /* a subject whose certificate PDA needs extra bump tries (grind badge keys) */
  const grind = want => { for (let i = 0; i < 20000; i++) { const k = W.kp(); const sh = W.keySubject(0, k.publicKey); const [, b] = PublicKey.findProgramAddressSync([Buffer.from('cert'), sh, Buffer.from([0])], P.programId); if (b <= want) return { k, bump: b }; } return null; };
  const g = grind(249) || grind(252);
  const ctl = g ? g.k : W.kp();
  await h.fund([ctl], 20);
  note(`worst-case subject: certificate PDA bump ${g ? g.bump : '?'} (${g ? 255 - g.bump : 0} extra find_program_address tries)`);
  const n8 = W.notesOf(8);
  const a1 = await W.att({ kind: 0, ctlKp: ctl, null_hashes: n8.hashes, tier: 5 });
  const r1 = await W.certify(ctl, a1);
  expect('certify, wallet subject, 8 notes, new', 'certify', r1, null); W.cu('certify (kind 0, 8 notes, new, fee, low bump)', r1.pofUnits[0], r1.size);
  const ren = await W.att({ kind: 0, ctlKp: ctl, null_hashes: n8.hashes, tier: 4 });
  const rr = await W.certify(ctl, ren, { name: 'renew' });
  expect('renew, 8 notes', 'renew', rr, null); W.cu('renew (8 notes, fee)', rr.pofUnits[0], rr.size);
  await h.send([W.transfer(users[0], W.certPda(a1.subject_hash, 0), 123_456_789n)], [users[0]]);
  await h.send([W.revokeHolderIx(ctl, a1.subject_hash)], [ctl]);
  const p2 = users[2];
  const a2 = await W.att({ kind: 0, ctlKp: ctl, null_hashes: W.notesOf(8).hashes, tier: 5 });
  const r2 = await h.send(W.certifyIxs(p2, a2, { prior: ctl.publicKey }), [p2]);
  expect('certify, remake: prior payer, donation surplus, fee, 8 notes', 'certify', r2, null); W.cu('certify (remake: prior payer + surplus + fee, 8 notes)', r2.pofUnits[0], r2.size);
  // anchor_log, revoke_by_holder, expire, admin calls
  const al = await h.send(W.anchorIxs(W.V, (await W.treasury()).log_size + 1n + BigInt(R.int(1000)), R.bytes(32), users[0]), [users[0]]);
  expect('anchor_log', 'anchor_log', al, null); W.cu('anchor_log', al.pofUnits[0], al.size);
  const rb = await h.send([W.revokeHolderIx(ctl, a2.subject_hash)], [ctl]); W.cu('revoke_by_holder', rb.pofUnits[0], rb.size);
  // pof_gate
  const creator = users[8];
  const id = 7000n + BigInt(R.int(1000));
  const room = W.roomPda(creator.publicKey, id);
  const cr = await h.send([G.ix('create_room', { id, asset: 0, min_tier: 1, name: Buffer.alloc(32, 0x61) }, { creator: creator.publicKey, room, pof_config: K.config })], [creator]); W.cu('create_room', cr.units, cr.size);
  const sr = await h.send([G.ix('set_room', { min_tier: 1, open: true, name: Buffer.alloc(32, 0x62) }, { creator: creator.publicKey, room, pof_config: K.config })], [creator]); W.cu('set_room', sr.units, sr.size);
  const x = W.kp(); await h.fund([x], 5);
  const ax = await W.att({ kind: 2, ctlKp: x, tier: 3, valid: 14 });
  await W.certify(x, ax);
  const j = await h.send([W.joinIx(x, x, room, ax.subject_hash)], [x]);
  expect('join', 'join', j, null);
  W.cu('join (incl. the require_certificate CPI)', h.unitsOf(j.logs, G.programId.toBase58())[0], j.size);
  W.cu('require_certificate (CPI from join)', j.pofUnits[0]);
  await h.waitSlot(BigInt(ax.expiry_slot) + 1n);
  const m = await W.decode(G, 'Member', W.memberPda(room, ax.subject_hash));
  const ev = await h.send([W.evictIx(users[0], room, ax.subject_hash, m)], [users[0]]); W.cu('evict (expired certificate)', h.unitsOf(ev.logs, G.programId.toBase58())[0], ev.size);
  const ex = await h.send([W.expireIx(users[0], ax.subject_hash, 0, x.publicKey)], [users[0]]); W.cu('expire', ex.pofUnits[0], ex.size);
  const y = W.kp(); await h.fund([y], 5);
  const ay = await W.att({ kind: 2, ctlKp: y, tier: 3 }); await W.certify(y, ay); await h.send([W.joinIx(y, y, room, ay.subject_hash)], [y]);
  const lv = await h.send([G.ix('leave', {}, { controller: y.publicKey, room, member: W.memberPda(room, ay.subject_hash), payer: y.publicKey })], [y]); W.cu('leave', h.unitsOf(lv.logs, G.programId.toBase58())[0], lv.size);
  const cl = await h.send([G.ix('close_room', {}, { creator: creator.publicKey, room })], [creator]); W.cu('close_room', h.unitsOf(cl.logs, G.programId.toBase58())[0], cl.size);
  const admin = W.admin;
  const params = (await W.config()).params;
  for (const [name, ix] of [['set_params', P.ix('set_params', { params }, { admin: admin.publicKey })], ['set_fee', P.ix('set_fee', { fee_lamports: params.fee_lamports }, { admin: admin.publicKey })],
    ['set_paused', P.ix('set_paused', { paused: false }, { admin: admin.publicKey })], ['set_verifier (cancel)', P.ix('set_verifier', { next: PublicKey.default }, { admin: admin.publicKey })],
    ['withdraw_fees', P.ix('withdraw_fees', { lamports: 0n }, { admin: admin.publicKey, dev: W.dev.publicKey })]]) {
    const r = await h.sim([ix], [admin]); W.cu(name, r.pofUnits[0], r.size);
  }
  /* revoke_spent by membership: path length vs transaction size, legacy/v0 and v1 */
  const real = W.real40;
  if (real) {
    for (const k of [0, 8, 16, 20, 24, 28, 32, 36, 40]) {
      const mem = { leaf_index: real.full.leaf_index, next_value: real.full.next_value, path: real.full.path.slice(0, k) };
      const ix = W.revokeSpentIx(users[4], real.E.sh, 0, 0, real.E.n.list[0].salt, real.nf, { membership: mem });
      const t = new web3.VersionedTransaction(h.message([ix], users[4].publicKey, {}, (await h.bh())));
      let len; try { len = t.serialize().length; } catch { len = '> 1232 (does not serialize)'; }
      sizes[`revoke_spent membership, ${k} levels (v0, 1 signer, CU limit ix)`] = len;
    }
    const ix40 = W.revokeSpentIx(users[4], real.E.sh, 0, 0, real.E.n.list[0].salt, real.nf, { membership: real.full });
    const v1sim = await sendV1(W, [ix40], [users[4]], { simulate: true });
    note(`v1 simulation of the 40-level path: ${v1sim.ok ? 'ok' : v1sim.why}, ${v1sim.size} bytes`);
    const v1 = await sendV1(W, [ix40], [users[4]]);
    if (/too large/.test(v1.why || '')) v1.why = 'TxTooLarge(v1)';
    expect('revoke_spent with the real 40-level mainnet path in a version 1 transaction', 'revoke_spent', v1, v1.why === 'TxTooLarge(v1)' ? 'TxTooLarge(v1)' : null);
    sizes['revoke_spent membership, 40 levels (v1, 1 signer)'] = v1.size;
    if (v1.ok) W.cu('revoke_spent (membership, real 40-level path, v1)', v1.pofUnits[0], v1.size);
    else note(`v1 send: ${v1.why}`);
    // certify inside a version 1 transaction: the instructions sysvar must read the same
    const z = W.kp(); await h.fund([z], 3);
    const az = await W.att({ kind: 2, ctlKp: z });
    const cv1 = await sendV1(W, W.certifyIxs(z, az), [z]);
    expect('certify inside a version 1 transaction', 'certify', cv1, null);
  }
  /* certify transaction sizes: relayed, 8 notes, CONTRACT §7 memo, CU limit + price */
  {
    const rel = W.relayer;
    const a = await W.att({ kind: 1, controller: W.kp().publicKey, null_hashes: W.notesOf(8).hashes, tier: 5 });
    const memo = new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(`pof:log:${2 ** 40}:${R.bytes(32).toString('hex')}`) });
    const price = web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 });
    const [ed, cix] = W.certifyIxs(rel, a);
    const bhash = await h.bh();
    const size = (ixs, payer, o2 = {}) => { const m = h.message(ixs, payer, o2, bhash); const t = new web3.VersionedTransaction(m); try { return t.serialize().length; } catch { return kitSize(ixs, payer, o2); } };
    // past 1,232 bytes web3.js cannot serialize at all: the exact size from @solana/kit's compiler (no limit there)
    const kitSize = (ixs, payer, o2) => {
      const kit = require('@solana/kit');
      const role = k => k.isSigner ? (k.isWritable ? kit.AccountRole.WRITABLE_SIGNER : kit.AccountRole.READONLY_SIGNER) : (k.isWritable ? kit.AccountRole.WRITABLE : kit.AccountRole.READONLY);
      const all = [...(o2.units === 0 ? [] : [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })]), ...ixs];
      let m = kit.createTransactionMessage({ version: o2.legacy ? 'legacy' : 0 });
      m = kit.setTransactionMessageFeePayer(kit.address(payer.toBase58()), m);
      m = kit.setTransactionMessageLifetimeUsingBlockhash({ blockhash: bhash, lastValidBlockHeight: 0n }, m);
      m = kit.appendTransactionMessageInstructions(all.map(ix => ({ programAddress: kit.address(ix.programId.toBase58()), accounts: ix.keys.map(k => ({ address: kit.address(k.pubkey.toBase58()), role: role(k) })), data: Uint8Array.from(ix.data) })), m);
      const t = kit.compileTransaction(m);
      return 1 + 64 * Object.keys(t.signatures).length + t.messageBytes.length;
    };
    sizes['certify relayed as verifier/src/program.ts sends it: legacy, Ed25519 + certify only, 8 notes'] = size([ed, cix], rel.publicKey, { legacy: true, units: 0 });
    sizes['certify relayed, 8 notes, memo, CU limit+price (v0, 1 signer)'] = size([price, ed, cix, memo], rel.publicKey);
    sizes['certify relayed, 8 notes, memo, CU limit+price (legacy, 1 signer)'] = size([price, ed, cix, memo], rel.publicKey, { legacy: true });
    const holder = W.kp();
    const [ed2, cix2] = W.certifyIxs(holder, { ...a });
    sizes['certify self-paid by the holder, relayer as fee payer, 8 notes, memo, CU limit+price (v0, 2 signers)'] = size([price, ed2, cix2, memo], rel.publicKey);
    // with a $ROOT holder account and a prior payer: every optional account present
    const [ed3, cix3] = W.certifyIxs(holder, a, { prior: W.kp().publicKey, holder: W.kp().publicKey });
    sizes['certify, every optional account, 8 notes, memo, CU limit+price (v0, 2 signers)'] = size([price, ed3, cix3, memo], rel.publicKey);
    const tooBig = Object.entries(sizes).filter(([k, v]) => (typeof v !== 'number' || v > 1232) && !k.includes('v1'));
    note(`transaction sizes: ${Object.entries(sizes).map(([k, v]) => `${k}: ${v}`).join('; ')}`);
    if (tooBig.length) note(`OVER 1,232 bytes: ${tooBig.map(([k]) => k).join('; ')}`);
  }
}

/** the holder exemption's cost: set_roles with a real mint, a payer holding the minimum (one-way: run last) */
export async function cuHolder(W) {
  const { h, P, users, expect, note } = W;
  W.suite('holder');
  const admin = W.admin;
  const payer = W.kp(); await h.fund([payer], 10);
  const mint = Keypair.generate();
  const rentMint = await h.conn.getMinimumBalanceForRentExemption(spl.MINT_SIZE);
  await h.send([web3.SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: mint.publicKey, lamports: rentMint, space: spl.MINT_SIZE, programId: spl.TOKEN_PROGRAM_ID }), spl.createInitializeMint2Instruction(mint.publicKey, 6, admin.publicKey, null)], [admin, mint]);
  // a token ACCOUNT offered as the root mint: set_roles must refuse it (it would be one-way)
  const ta = spl.getAssociatedTokenAddressSync(mint.publicKey, admin.publicKey);
  await h.send([spl.createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ta, admin.publicKey, mint.publicKey)], [admin]);
  const bad = await h.sim([P.ix('set_roles', { dev: null, relayer: null }, { admin: admin.publicKey, root_mint: ta })], [admin]);
  expect('set_roles with a token ACCOUNT (165 bytes) as the root mint', 'set_roles', bad, '*');
  if (bad.ok) note('set_roles accepts a token account as the $ROOT mint (only owner and length >= 82 are checked), and the root mint can be set only once');
  const r = await h.send([P.ix('set_roles', { dev: null, relayer: null }, { admin: admin.publicKey, root_mint: mint.publicKey })], [admin]);
  expect('set_roles with the mint', 'set_roles', r, null); W.cu('set_roles (root mint)', r.pofUnits[0], r.size);
  if (r.ok) W.rootMint = mint.publicKey;
  expect('set_roles a second mint (the root mint is set once)', 'set_roles', await h.sim([P.ix('set_roles', { dev: null, relayer: null }, { admin: admin.publicKey, root_mint: mint.publicKey })], [admin]), 'RootSet');
  { const q = W.kp(); await h.fund([q], 2); const aq = await W.att({ kind: 0, ctlKp: q }); expect('certify naming a holder account that is not the payer\'s canonical $ROOT account', 'certify', await W.simCertify(q, aq, { holder: W.kp().publicKey }), 'BadHolderAccount'); }
  const ata = spl.getAssociatedTokenAddressSync(mint.publicKey, payer.publicKey);
  const min = (await W.config()).params.holder_min;
  await h.send([spl.createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, payer.publicKey, mint.publicKey), spl.createMintToInstruction(mint.publicKey, ata, admin.publicKey, min)], [admin]);
  const a = await W.att({ kind: 0, ctlKp: payer, null_hashes: W.notesOf(8).hashes, tier: 5 });
  const t0 = await W.treasury();
  const c = await W.certify(payer, a, { holder: ata });
  expect('certify as a $ROOT holder, 8 notes', 'certify', c, null);
  const t1 = await W.treasury();
  expect('  no fee, counted exempt', 'certify', { ok: t1.exempt === t0.exempt + 1n && t1.fees_in === t0.fees_in }, null);
  W.cu('certify (kind 0, 8 notes, $ROOT holder: ATA derivation + token read)', c.pofUnits[0], c.size);
  // the same tokens, moved to another payer within one transaction, make both exempt (holding is checked at the instant of certify)
  const p2 = W.kp(); await h.fund([p2], 5);
  const ata2 = spl.getAssociatedTokenAddressSync(mint.publicKey, p2.publicKey);
  await h.send([spl.createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata2, p2.publicKey, mint.publicKey)], [admin]);
  const a2 = await W.att({ kind: 0, ctlKp: p2 });
  const moved = await h.send([spl.createTransferInstruction(ata, ata2, payer.publicKey, min), ...W.certifyIxs(p2, a2, { holder: ata2 }), spl.createTransferInstruction(ata2, ata, p2.publicKey, min)], [p2, payer]);
  expect('borrow the $ROOT balance for one transaction, certify fee-free, give it back', 'certify', moved, null);
  if (moved.ok) note('the $ROOT exemption is checked at the instant of certify: a balance borrowed (or flash-swapped) inside the same transaction makes any payer exempt');
}
