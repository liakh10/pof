/* The vault key (audits POF-11 and POF-27), on the local clone for the registry reads:
   a deterministic wallet gets the same vault every time, and a wallet whose signature changes is stopped (VAULT_CHANGED);
   a non-deterministic wallet gets a random vault key that is only ever stored inside a passphrase box, refuses to shield
   until backed up, opens only with the passphrase, and moves to a new device through the backup file. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { nodeWallet } from './node-wallet.mjs';
const RPC = process.env.POF_LOCAL_RPC || 'http://127.0.0.1:35899';
globalThis.isSecureContext ??= true;
const S = await import('../dist/spr.js');
S.setHasherSource(fs.readFileSync(new URL('../dist/hasher-simd.wasm', import.meta.url)));
const { createPofClient } = await import('../pof-client.js');
const up = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' }).then(r => r.ok).catch(() => false);
const PROGRAM = 'pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT';
const client = (W, storage) => createPofClient({ network: 'local', rpc: [RPC], wallet: W, storage, programId: PROGRAM, minAgeSlots: 0 });

test('vault keys: deterministic, changed, random and locked', { skip: !up && 'no local validator on ' + RPC }, async () => {
  // deterministic
  const W = nodeWallet(RPC);
  const store = new Map();
  const a = await (await client(W, store)).deriveVault();
  const b = await (await client(W, store)).deriveVault();
  assert.equal(a.mode, 'signature'); assert.equal(a.owner, b.owner);
  // the same wallet now signing differently (another device, a changed signer) is stopped, not given a second vault
  const W2 = { ...W, signText: async t => new Uint8Array(crypto.randomBytes(64)) };
  await assert.rejects((await client(W2, store)).deriveVault(), e => e.code === 'VAULT_CHANGED');

  // non-deterministic: random key, passphrase box, backup before shield
  const N = { ...nodeWallet(RPC), signText: async () => new Uint8Array(crypto.randomBytes(64)) };
  const ns = new Map();
  const pof = await client(N, ns);
  await assert.rejects(pof.deriveVault(), e => e.code === 'PASSPHRASE_NEEDED' && e.nonDeterministic);
  await assert.rejects(pof.deriveVault({ passphrase: 'short' }), e => e.code === 'PASSPHRASE_NEEDED');
  const v = await pof.deriveVault({ passphrase: 'correct horse battery' });
  assert.equal(v.mode, 'random'); assert.equal(v.needsBackup, true);
  const raw = [...ns.values()].join('\n');
  assert.ok(!/"seed"/.test(raw), 'no seed field in clear in storage');
  await assert.rejects(pof.shield({ asset: 0, amount: '1' }), e => e.code === 'VAULT_BACKUP_NEEDED');
  const file = await pof.kits.export();
  assert.ok(JSON.parse(file).vaultBackup.box.kdf.startsWith('pbkdf2'));
  // a second session on this device: locked without the passphrase, refused with a wrong one
  const again = await client(N, ns);
  await assert.rejects(again.deriveVault(), e => e.code === 'VAULT_LOCKED');
  await assert.rejects(again.deriveVault({ passphrase: 'wrong passphrase!' }), e => e.code === 'BAD_PASSPHRASE');
  assert.equal((await again.deriveVault({ passphrase: 'correct horse battery' })).owner, v.owner);
  // a new device: the backup file and the passphrase bring the same vault back
  const fresh = new Map();
  const other = await client(N, fresh);
  await other.kits.import(file, { passphrase: 'correct horse battery' });
  const moved = await other.deriveVault({ passphrase: 'correct horse battery' });
  assert.equal(moved.owner, v.owner); assert.equal(moved.needsBackup, false);
  // a plain-text seed from before POF-27 is sealed on the next open and its clear copy removed
  const legacy = new Map([['pof:vaultseed:v2:' + N.state().address, JSON.stringify({ seed: 'ab'.repeat(32), backedUp: true })]]);
  const old = await client(N, legacy);
  await assert.rejects(old.deriveVault(), e => e.code === 'PASSPHRASE_NEEDED' && e.migrate);
  await old.deriveVault({ passphrase: 'correct horse battery' });
  assert.ok(![...legacy.keys()].some(k => k.startsWith('pof:vaultseed:')));
});
