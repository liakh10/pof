/* LocalRings reads deposits sent as legacy, version 0 and version 1 transactions (mainnet Rings traffic is version 1, the
   SDK builds only version 1; preflight refuses v0-only reads). Each deposit is rebuilt and the tree must reach the account's
   root. Needs the local clone (lab/rings-local/chain.sh start). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { nodeWallet } from './node-wallet.mjs';
const RPC = process.env.POF_LOCAL_RPC || 'http://127.0.0.1:35899';
globalThis.isSecureContext ??= true;
const S = await import('../dist/spr.js');
S.setHasherSource(fs.readFileSync(new URL('../dist/hasher-simd.wasm', import.meta.url)));
const { core: C } = await import('../pof-client.js');
const { LocalRings, jsonRpc } = await import('../localtree.js');
const kit = await import('@solana/kit');
const compile = await import('../node_modules/@heliuslabs/spr/dist/flows/compile.js');
const cloned = new Uint8Array(Buffer.from(fs.readFileSync(new URL('../../lab/rings-local/.run/cloned-tree.b64', import.meta.url), 'utf8'), 'base64'));
const up = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' }).then(r => r.ok).catch(() => false);

test('LocalRings replays legacy and version 0 deposits on the clone (and version 1 where the validator executes it)', { skip: !up && 'no local validator on ' + RPC }, async () => {
  await C.ready();
  const W = nodeWallet(RPC); await W.airdrop(5);
  const me = W.state().address;
  const kp = S.ShieldedKeypair.generate();
  const owner = C.b58encode(kp.signingPublicKey().ed25519());
  const depositIx = amount => S.depositInstruction({ tree: C.RINGS.tree, depositor: me, deposits: [{ asset: { kind: 'sol' }, viewTag: C.b58decode(owner, 32), recipientOwnerHash: kp.ownerHash(), amount }] });
  const confirm = async sig => { for (let i = 0; i < 60; i++) { const s = (await W.rpc('getSignatureStatuses', [[sig]])).value[0]; if (s && s.confirmationStatus) { assert.equal(s.err, null); return; } await new Promise(r => setTimeout(r, 400)); } throw Error('not confirmed'); };
  // legacy
  await (await W.send([W.toWeb3(await depositIx(1_000_000n))])).wait();
  // version 0 (no lookup table)
  const bh = (await W.rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
  const msg0 = new TransactionMessage({ payerKey: new PublicKey(me), recentBlockhash: bh.blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), W.toWeb3(await depositIx(2_000_000n))] }).compileToV0Message();
  const tx0 = new VersionedTransaction(msg0); tx0.sign([W.keypair]);
  const sig0 = await W.rpc('sendTransaction', [Buffer.from(tx0.serialize()).toString('base64'), { encoding: 'base64', preflightCommitment: 'confirmed' }]);
  await confirm(sig0);
  // version 1, the SDK's own compile path
  const signer = await kit.createKeyPairSignerFromPrivateKeyBytes(W.keypair.secretKey.slice(0, 32));
  const v1 = compile.compileUnsignedTransaction({ feePayer: signer.address, lifetime: { blockhash: bh.blockhash, lastValidBlockHeight: BigInt(bh.lastValidBlockHeight) }, computeUnitLimit: 300_000, instructions: [await depositIx(3_000_000n)] });
  const signed = await kit.signTransaction([signer.keyPair], v1);
  let v1ok = true;
  try { await confirm(await W.rpc('sendTransaction', [kit.getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }])); }
  catch (e) { v1ok = false; console.log('  (this local validator does not take version 1 transactions: ' + String(e.message).slice(0, 120) + ')'); }
  const rings = new LocalRings(jsonRpc(RPC), { cloned });
  const head = await rings.refresh();   // throws unless the rebuilt tree reaches the account root
  const mine = await rings.notesOf({ owner, ownerHash: kp.ownerHash() });
  assert.deepEqual(mine.map(n => n.amount).sort((a, b) => (a < b ? -1 : 1)), v1ok ? [1_000_000n, 2_000_000n, 3_000_000n] : [1_000_000n, 2_000_000n]);
  for (const n of mine) assert.equal(C.hex(C.rootFromPath(n.leaf, n.leafIndex, rings.pathOf(n.leafIndex))), C.hex(head.root));
  if (v1ok) console.log('  version 1 deposit replayed');
});

/* version 1 as mainnet sends it (this local validator refuses to execute v1): read-only, the public deposits behind
   test/vectors.json fetched with maxSupportedTransactionVersion 1, decoded by the same depositsOfTransaction, and rebuilt
   to the leaf the indexer holds */
const keyFile = (await import('node:os')).homedir() + '/.config/helius/site_keys';
test('depositsOfTransaction decodes mainnet version 1 deposits (read-only)', { skip: !fs.existsSync(keyFile) && 'no Helius key file' }, async () => {
  await C.ready();
  const { depositsOfTransaction } = await import('../localtree.js');
  const key = fs.readFileSync(keyFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)[3];
  const rpc = jsonRpc(`https://mainnet.helius-rpc.com/?api-key=${key}`);
  const V = JSON.parse(fs.readFileSync(new URL('./vectors.json', import.meta.url)));
  const versions = new Set();
  for (const d of V.deposits.slice(0, 3)) {
    const tx = await rpc('getTransaction', [d.sig, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]);
    versions.add(tx.version);
    const deps = depositsOfTransaction(tx, V.tree);
    const dep = deps.find(x => C.hex(x.ownerHash) === d.ownerHash && x.amount === BigInt(d.amount));
    assert.ok(dep, 'the deposit is found in ' + d.sig.slice(0, 8));
    const leaf = C.commitment({ ownerHash: dep.ownerHash, asset: dep.asset, amount: dep.amount, blinding: C.depositBlinding(V.tree, d.leafIndex) });
    assert.equal(C.hex(leaf), d.leaf);
  }
  console.log('  mainnet transaction versions read:', [...versions].join(', '));
});
