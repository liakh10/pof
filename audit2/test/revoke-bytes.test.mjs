/* audit2 A2-01: the relayed holder revoke cannot land.
   The program (program/programs/pof/src/lib.rs revoke_bytes, revoke_signed(valid_until)) checks 156 bytes:
     "POF-REVOKE1" ‖ program ‖ certificate ‖ subject_hash ‖ asset ‖ nullset_hash ‖ issued_slot ‖ valid_until.
   The browser client (client/pof-client.js revokeBytesOf / revokeRelayed) signs 148 bytes without valid_until and posts no
   validUntil, and the relayer (verifier/src/relayer.ts revoke, now revoke_signed v2 since the IDL sync) refuses a request
   without validUntil. So an X or badge holder cannot revoke through the relayer; the only other way is revoke_by_holder,
   which needs the controller key to sign a transaction (and so to be funded, which links it). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

globalThis.isSecureContext ??= true;
const S = await import('../../client/dist/spr.js');
S.setHasherSource(fs.readFileSync(new URL('../../client/dist/hasher-simd.wasm', import.meta.url)));
const { createPofClient } = await import('../../client/pof-client.js');
const web3 = await import('../../client/dist/web3.js');

const PROGRAM = 'pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT';

function fakeKit() {
  const att = Buffer.alloc(240);
  att.write('POF1', 0);
  Buffer.from(new web3.PublicKey(PROGRAM).toBytes()).copy(att, 4);
  att[36] = 1; crypto.randomBytes(32).copy(att, 37); att[69] = 0; att[70] = 2;
  crypto.randomBytes(32).copy(att, 112);
  att.writeBigUInt64LE(473_000_000n, 144);
  return { v: 1, programId: PROGRAM, subject: { kind: 1, value: 'someone' }, attestation: att.toString('hex') };
}

/** the bytes the program checks (lib.rs revoke_bytes), rebuilt from the attestation fields */
function programBytes(kit, validUntil) {
  const att = Buffer.from(kit.attestation, 'hex');
  const pid = new web3.PublicKey(PROGRAM);
  const [cert] = web3.PublicKey.findProgramAddressSync([new Uint8Array(Buffer.from('cert')), new Uint8Array(att.subarray(37, 69)), Uint8Array.of(att[69])], pid);
  const vu = Buffer.alloc(8); vu.writeBigUInt64LE(validUntil);
  return Buffer.concat([Buffer.from('POF-REVOKE1'), Buffer.from(pid.toBytes()), Buffer.from(cert.toBytes()), att.subarray(37, 69), Buffer.from([att[69]]), att.subarray(112, 144), att.subarray(144, 152), vu]);
}

test('A2-01: the client signs the 156 bytes revoke_signed(valid_until) checks', async () => {
  const pof = await createPofClient({ network: 'local', rpc: ['http://127.0.0.1:1'], wallet: { state: () => ({}) }, storage: new Map(), programId: PROGRAM });
  const kit = fakeKit();
  const r = await pof.revokeBytesOf(kit);
  assert.equal(r.bytes.length, 156, `the client builds ${r.bytes.length} bytes; the program's revoke_bytes is 156 (valid_until appended, RV-01)`);
  assert.deepEqual(Buffer.from(r.bytes), programBytes(kit, BigInt(Buffer.from(r.bytes).readBigUInt64LE(148))));
});

test('A2-01: revokeRelayed sends validUntil (the relayer refuses v2 revokes without it)', () => {
  const src = fs.readFileSync(new URL('../../client/pof-client.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('async function revokeRelayed'), src.indexOf('async function controllerOf'));
  assert.match(body, /validUntil/, 'POST /api/relay/revoke carries no validUntil: relayer.ts answers BAD_VALID_UNTIL');
});
