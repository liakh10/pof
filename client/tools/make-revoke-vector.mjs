// node tools/make-revoke-vector.mjs: writes test/vectors/revoke-v2.json, the shared POF-REVOKE1 (156 bytes) vector the
// client, the Verifier and the program check: fixed inputs, the certificate PDA, and the bytes from the Verifier's revokeBytesV2.
import fs from 'node:fs';
import { PublicKey } from '@solana/web3.js';
const V = await import('../../verifier/dist/pof-verifier.mjs');
const program = 'pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT';
const subjectHash = Buffer.from('7f'.repeat(16) + '01'.repeat(16), 'hex');
const nullsetHash = Buffer.from('a5'.repeat(32), 'hex');
const asset = 1, issuedSlot = 473_512_345n, validUntil = 473_513_845n;
const [cert] = PublicKey.findProgramAddressSync([Buffer.from('cert'), subjectHash, Buffer.from([asset])], new PublicKey(program));
const bytes = V.revokeBytesV2(new PublicKey(program).toBytes(), cert.toBytes(), subjectHash, asset, nullsetHash, issuedSlot, validUntil);
const out = { note: 'POF-REVOKE1 v2 (156 bytes): "POF-REVOKE1" ‖ program ‖ certificate ‖ subject_hash ‖ asset u8 ‖ nullset_hash ‖ issued_slot u64 LE ‖ valid_until u64 LE; certificate = PDA ["cert", subject_hash, [asset]] under program', program, certificate: cert.toBase58(), subjectHash: subjectHash.toString('hex'), asset, nullsetHash: nullsetHash.toString('hex'), issuedSlot: String(issuedSlot), validUntil: String(validUntil), bytes: Buffer.from(bytes).toString('hex'), length: bytes.length };
fs.writeFileSync(new URL('../test/vectors/revoke-v2.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(out.length, out.certificate);
