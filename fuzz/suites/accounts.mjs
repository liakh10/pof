// Suites "accounts" and "data": every canonical call (state.mjs) with its accounts and its instruction data mutated.
// accounts: each account position replaced by each member of a pool of interesting accounts (POF's config and treasury, live,
//   revoked and expired certificates, tree 0, the forged tree, a spent nullifier PDA and a look-alike, a room, a member, the
//   programs, sysvars, the program data account, our own keys, a fresh key), a writable account made read-only, a read-only one
//   made writable, a signer made a non-signer, and every pair of positions made duplicates. Anything that still succeeds must be
//   a position the instruction leaves free by design (the caller of a permissionless call, holder_token while no $ROOT is set,
//   prior_payer when the payer is unchanged), or a read-only account made writable.
// data: truncation at every length, 1/8/64 trailing bytes, the discriminator and each argument byte changed, vector lengths and
//   option tags that lie.
import { web3, PublicKey } from '../lib/core.mjs';

export async function accounts(W, C, S, o = {}) {
  const { h, R, K, P, G, HOSTILE, users, admin, expect, note, fx } = W;
  W.suite('accounts');
  const held = new Map([...users, admin, W.relayer, W.dev, S.rvKp, S.exKp].map(k => [k.publicKey.toBase58(), k]));
  const pool = [
    ['config', K.config], ['treasury', K.treasury], ['cert L', W.certPda(S.aL.subject_hash, 0)], ['cert RV', W.certPda(S.aRV.subject_hash, 0)],
    ['cert EX', W.certPda(S.aEX.subject_hash, 0)], ['tree 0', K.tree0], ['forged tree', K.ft], ['spent PDA', W.nfPda(K.tree0, S.spentNf)],
    ['look-alike PDA', W.nfPda(K.tree0, Buffer.from(fx.lookAlikes[0].nf, 'hex'))], ['room', S.room], ['member', W.memberPda(S.room, S.aL.subject_hash)],
    ['system', web3.SystemProgram.programId], ['ix sysvar', web3.SYSVAR_INSTRUCTIONS_PUBKEY], ['clock', web3.SYSVAR_CLOCK_PUBKEY], ['pof', P.programId],
    ['gate', G.programId], ['hostile', HOSTILE], ['program data', K.programData], ['alice', S.alice.publicKey], ['admin', admin.publicKey],
    ['relayer', W.relayer.publicKey], ['fresh key', W.kp().publicKey],
  ];
  let n = 0, benign = 0;
  // a fee payer that is in none of the instructions: the fee payer is always a writable signer of the message, so a signer or
  // writable flag taken off an account that also pays the fee would not change the transaction at all
  const fee = W.kp(); await h.fund([fee], 5);
  for (const c of C) {
    const ix = c.ixs[c.target];
    const names = (ix.programId.equals(P.programId) ? P : G).accountNames(c.ixName);
    const run = async (label, keys, extraSigners = []) => {
      const ixs = c.ixs.map((x, i) => i === c.target ? new web3.TransactionInstruction({ programId: x.programId, keys, data: x.data }) : x);
      const r = await h.sim(ixs, [...c.signers, ...extraSigners], { feePayer: fee });
      n++;
      return r;
    };
    for (let p = 0; p < ix.keys.length; p++) {
      const k = ix.keys[p], nm = names[p] ?? `#${p}`;
      const free = c.free.includes(nm);
      for (const [pn, pk] of pool) {
        if (pk.equals(k.pubkey)) continue;
        const signer = k.isSigner && held.has(pk.toBase58());
        const keys = ix.keys.map((x, i) => i === p ? { pubkey: pk, isSigner: signer, isWritable: x.isWritable } : x);
        const r = await run(`${nm} := ${pn}`, keys, signer ? [held.get(pk.toBase58())] : []);
        if (r.ok && free) { benign++; W.cover(c.ixName, 'ok (free position)'); W.results.suites.accounts.cases++; continue; }
        expect(`${c.name}: ${nm} := ${pn}`, c.ixName, r, '*');
      }
      if (k.isWritable) expect(`${c.name}: ${nm} made read-only`, c.ixName, await run('ro', ix.keys.map((x, i) => i === p ? { ...x, isWritable: false } : x)), '*');
      else { const r = await run('rw', ix.keys.map((x, i) => i === p ? { ...x, isWritable: true } : x)); W.results.suites.accounts.cases++; W.cover(c.ixName, r.ok ? 'ok (read-only made writable)' : r.why); if (r.ok) benign++; }
      if (k.isSigner && !free) expect(`${c.name}: ${nm} not a signer`, c.ixName, await run('ns', ix.keys.map((x, i) => i === p ? { ...x, isSigner: false } : x)), '*');
      for (let q = 0; q < ix.keys.length; q++) {
        if (q === p || ix.keys[q].pubkey.equals(k.pubkey)) continue;
        const keys = ix.keys.map((x, i) => i === p ? { ...x, pubkey: ix.keys[q].pubkey, isSigner: x.isSigner && ix.keys[q].isSigner } : x);
        const r = await run('dup', keys);
        if (r.ok && free) { benign++; W.results.suites.accounts.cases++; continue; }
        expect(`${c.name}: ${nm} := ${names[q] ?? q} (duplicate)`, c.ixName, r, '*');
      }
    }
  }
  note(`${n} account mutations over ${C.length} canonical calls; ${benign} succeeded in a free position or as a read-only account made writable`);
}

export async function data(W, C, o = {}) {
  const { h, R, expect, note } = W;
  W.suite('data');
  let n = 0;
  // where an argument byte may change and still succeed: certify's log_index (not signed, POF-18), admin settings, a room name
  const freeTail = { certify: 8, set_params: Infinity, set_fee: Infinity, set_paused: Infinity, set_asset: Infinity, set_verifier: Infinity, set_roles: Infinity, withdraw_fees: Infinity, anchor_log: 0, create_room: Infinity, set_room: Infinity, close_begin: 0 };
  for (const c of C) {
    const ix = c.ixs[c.target];
    const d = ix.data;
    const run = async data => { n++; return h.sim(c.ixs.map((x, i) => i === c.target ? new web3.TransactionInstruction({ programId: x.programId, keys: x.keys, data }) : x), c.signers); };
    const step = Math.max(1, Math.floor(d.length / (o.truncations ?? 400)));
    for (let L = 0; L < d.length; L += step) expect(`${c.name}: truncated to ${L} bytes`, c.ixName, await run(d.subarray(0, L)), '*');
    for (const t of [1, 8, 64]) {
      const r = await run(Buffer.concat([d, R.bytes(t)]));
      W.results.suites.data.cases++; W.cover(c.ixName, r.ok ? `ok (+${t} trailing bytes)` : r.why);
      if (r.ok && t === 1) note(`${c.name}: trailing bytes after the arguments are ignored`);
    }
    for (let b = 0; b < 8; b++) { const x = Buffer.from(d); x[b] ^= 1 << R.int(8); expect(`${c.name}: discriminator byte ${b} changed`, c.ixName, await run(x), '*'); }
    const ft = freeTail[c.ixName];
    if (ft === Infinity) continue;   // admin values: any value is a legal setting (bounds are checked by the model suites)
    for (let b = 8; b < d.length - (ft || 0); b++) {
      if (c.ixName === 'require_certificate' && b === d.length - 1) continue;   // min_tier lowered still passes
      const x = Buffer.from(d); x[b] ^= 1 << R.int(8);
      const r = await run(x);
      // a lower min_tier, a different revoke index whose pair also fits, or the evict/join subject: judged by the outcome
      expect(`${c.name}: argument byte ${b - 8} changed`, c.ixName, r, '*');
    }
  }
  // vector lengths and option tags that lie (certify: the null_hashes length at argument offset 75; revoke_spent: the option tag)
  const cert = C.find(c => c.name === 'certify'), rv = C.find(c => c.name === 'revoke_spent');
  const at = 8 + 1 + 32 + 1 + 1 + 32 + 8;
  for (const v of [0, 1, 9, 0xffff, 0x7fffffff, 0xffffffff]) {
    const x = Buffer.from(cert.ixs[cert.target].data); x.writeUInt32LE(v, at);
    const r = await h.sim(cert.ixs.map((y, i) => i === cert.target ? new web3.TransactionInstruction({ programId: y.programId, keys: y.keys, data: x }) : y), cert.signers);
    expect(`certify: null_hashes length says ${v}`, 'certify', r, '*'); n++;
    if (r.units > 200_000) note(`certify with a lying vector length ${v} burned ${r.units} CU`);
  }
  for (const tag of [2, 3, 255]) {
    const x = Buffer.from(rv.ixs[rv.target].data); x[x.length - 1] = tag;
    expect(`revoke_spent: membership option tag ${tag}`, 'revoke_spent', await h.sim([new web3.TransactionInstruction({ programId: rv.ixs[0].programId, keys: rv.ixs[0].keys, data: x })], rv.signers), '*'); n++;
    const y = Buffer.concat([Buffer.from(rv.ixs[rv.target].data).subarray(0, -1), Buffer.from([1]), Buffer.alloc(8), Buffer.alloc(32), Buffer.from([0xff, 0xff, 0xff, 0xff])]);
    expect(`revoke_spent: membership with a path length of 2^32-1`, 'revoke_spent', await h.sim([new web3.TransactionInstruction({ programId: rv.ixs[0].programId, keys: rv.ixs[0].keys, data: y })], rv.signers), '*'); n++;
  }
  note(`${n} instruction-data mutations`);
}
