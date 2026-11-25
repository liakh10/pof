/* The phase 2 flow without a chain: the generated IDL is the program's zk IDL, the codec matches it, and against a node whose
   pof program has no ZkConfig (the launch program) every entry point answers ZK_OFF and sends nothing. The on-chain run is
   lab/test/zk-e2e.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
globalThis.isSecureContext ??= true;
const S = await import('../dist/spr.js');
S.setHasherSource(fs.readFileSync(new URL('../dist/hasher-simd.wasm', import.meta.url)));
const { createPofClient } = await import('../pof-client.js');
const { createZkFlow, zkIxData, decodeZkAccount, NOTE_LOCK_SIZE, ZK_OWNER_SIZE } = await import('../zk-flow.js');
const IDL = (await import('../zk-idl.js')).default;
const PROGRAM = 'pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT';

const { committedZkIdl } = await import('../tools/zk-idl.mjs');
test('zk-idl.js is the committed program/idl/pof-zk.json (rerun node tools/zk-idl.mjs when the program commits a new one)', () => {
  assert.deepEqual(IDL, committedZkIdl());
  assert.ok(IDL.instructions.some(i => i.name === 'certify_zk') && IDL.instructions.some(i => i.name === 'register_zk_owner'));
  const reg = IDL.instructions.find(i => i.name === 'register_zk_owner').accounts.map(a => a.name);
  assert.deepEqual(reg, ['owner', 'payer', 'config', 'treasury', 'registry', 'owner_record', 'system_program']);
});

test('codec: account sizes and the certify_zk data layout', () => {
  assert.equal(NOTE_LOCK_SIZE, 214); assert.equal(ZK_OWNER_SIZE, 121);   // ZkOwner records its payer since 73bcf04 (FZ-19)
  const args = { subject_kind: 0, asset: 0, tier: 1, nonce: new Uint8Array(16).fill(1), proof: new Uint8Array(256).fill(2), state_root: new Uint8Array(32).fill(3), null_root: new Uint8Array(32).fill(4), registry_root: new Uint8Array(32).fill(5), eph: [new Uint8Array(32).fill(6), new Uint8Array(32).fill(7)], tags: [new Uint8Array(32).fill(8)], cts: [new Uint8Array(32).fill(9)] };
  const d = zkIxData('certify_zk', { args });
  assert.equal(d.length, 8 + 3 + 16 + 256 + 96 + 64 + 4 + 32 + 4 + 32);
  assert.deepEqual([...d.subarray(0, 8)], IDL.instructions.find(i => i.name === 'certify_zk').discriminator);
  const disc = IDL.accounts.find(a => a.name === 'ZkOwner').discriminator;
  const acc = new Uint8Array(ZK_OWNER_SIZE); acc.set(disc); acc[72] = 7; acc.set(new Uint8Array(32).fill(5), 80);
  const o = decodeZkAccount('ZkOwner', acc);
  assert.equal(o.index, 7n); assert.equal(o.commitment[0], 5);
  assert.throws(() => decodeZkAccount('NoteLock', acc), /not a NoteLock/);
});

test('the launch program (no ZkConfig): state is off, certify and register answer ZK_OFF and send nothing', async () => {
  const seen = [];
  const srv = http.createServer((q, r) => { let b = ''; q.on('data', c => (b += c)); q.on('end', () => { const j = JSON.parse(b); seen.push(j.method); const result = j.method === 'getAccountInfo' ? { context: { slot: 5 }, value: null } : j.method === 'getSlot' ? 5 : null; r.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result })); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const rpc = `http://127.0.0.1:${srv.address().port}`;
    const sent = [];
    const wallet = { setChain() {}, state: () => ({ address: '4Nd1mY8TQGoXJdcTWQT6B5M7uU3cfBRNtSqcWFvVRvsQ' }), send: async () => { sent.push(1); throw Error('must not send'); } };
    const pof = await createPofClient({ network: 'local', rpc: [rpc], wallet, storage: new Map(), programId: PROGRAM });
    const zk = await createZkFlow(pof, { wallet });
    const st = await zk.state();
    assert.deepEqual([st.deployed, st.enabled, st.reason], [false, false, 'ZK_NOT_DEPLOYED']);
    assert.equal(await zk.enabled(), false);
    await assert.rejects(zk.certify({ asset: 0, tier: 1 }), e => e.code === 'ZK_OFF');
    assert.equal(sent.length, 0);
    assert.ok(!seen.includes('sendTransaction') && !seen.includes('simulateTransaction'));
  } finally { srv.close(); }
});
