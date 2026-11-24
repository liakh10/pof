/* Read-only checks of the Verifier's Rings source against mainnet (no transaction is sent). Keys come from
   ~/.config/helius/site_keys (never printed). Run: node test/e2e/mainnet-read.mjs */
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const V = await import(new URL('../../dist/pof-verifier.mjs', import.meta.url));
const keys = fs.readFileSync(process.env.HOME + '/.config/helius/site_keys', 'utf8').split(/\s+/).filter(Boolean);
const key = keys[Math.floor(Math.random() * keys.length)];
const url = 'https://mainnet.helius-rpc.com/?api-key=' + key;
const rpc = V.jsonRpc([url]);
const R = new V.HeliusRings(rpc, { url: 'https://mainnet.helius-rpc.com/v1/spr', apiKey: key }, url);
const TREE = '777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor';
const out = [];
const ok = (c, what) => { assert.ok(c, what); out.push('PASS ' + what); console.log('  ✓ ' + what); };
const { poseidon } = await import('@heliuslabs/spr/internal').then(async m => { await (await import('@heliuslabs/spr')).initializePoseidon(); return m; });

const head = await R.treeHead(TREE);
ok(head.treeId === 0 && head.history.length === 500 && head.nullifierHistory.length > 0, `tree 0 decoded: 500 state roots, ${head.nullifierHistory.length} nullifier roots, head slot ${head.headSlot}`);
const sigs = await rpc('getSignaturesForAddress', [TREE, { limit: 30 }]);
await R.client();
let tx = null;
for (const s of sigs) { if (s.err) continue; const r = await R.spr.getShieldedTransactionsBySignature(s.signature); const t = r.transactions[0]?.transaction; if (t && t.outputSlots.length && t.nullifiers.length) { tx = { sig: s.signature, t }; break; } }
ok(!!tx, 'found a recent Rings transaction with outputs and nullifiers');
const oc = tx.t.outputSlots[0].outputContext;
const [p] = await R.merklePaths(TREE, [oc.hash]);
let h = oc.hash, idx = p.leafIndex;
for (const sib of p.path) { h = (idx & 1n) ? poseidon([sib, h]) : poseidon([h, sib]); idx >>= 1n; }
const hist = new Set(head.history.map(x => Buffer.from(x).toString('hex')));
ok(Buffer.from(h).equals(Buffer.from(p.root)) && hist.has(Buffer.from(h).toString('hex')), `a real leaf (index ${p.leafIndex}) re-hashes with the SDK's Poseidon to a root in the on-chain history`);
const c = await R.creation(tx.sig, oc.hash);
ok(c && c.leafIndex === p.leafIndex && c.tree === TREE, `the creating transaction gives the leaf's slot (${c?.slot})`);
const rnd = crypto.randomBytes(32); rnd[0] &= 0x1f;
const spent = await R.spent(TREE, [tx.t.nullifiers[0], new Uint8Array(rnd)], { nullifierHistory: head.nullifierHistory });
ok(spent[0] === true && spent[1] === false, 'a published nullifier reads spent (PDA); a random one reads unspent with a verified non-inclusion path');
const m = await R.nullifierMembership(TREE, tx.t.nullifiers[0]).catch(e => e);
ok(m instanceof Error ? m.code === 'NOT_FOLDED' : m.path.length <= 40, m instanceof Error ? 'the newest nullifier is still queued (PDA path only), as expected' : `nullifier-tree membership built (${m.path.length} levels kept)`);
const regs = await rpc('getProgramAccounts', [V.REGISTRY_PROGRAM, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]);
const one = await rpc('getAccountInfo', [regs[0].pubkey, { encoding: 'base64' }]);
const W = await import('@heliuslabs/spr/wallet');
const rec = W.decodeUserRecordAccount({ owner: one.value.owner, data: new Uint8Array(Buffer.from(one.value.data[0], 'base64')) });
const npk = await R.registryNullifierKey(rec.owner);
ok(npk && npk.length === 32 && Buffer.from(npk).equals(Buffer.from(rec.nullifierPublicKey)), `${regs.length} registry records; one owner's npk read through the record PDA`);
fs.writeFileSync(new URL('./mainnet-read.txt', import.meta.url), out.join('\n') + '\n');
console.log(`all ${out.length} mainnet read checks passed`);
