// What the POF suite, the wind-down test, own-ca and the rehearsal stand on: the local chain (Rings tree 0 and pump.fun cloned), funded
// keys, v0 transactions simulated first (a refusal comes back with the program's reason and logs), the slot clock, plain SPL mints, a
// Verifier that signs CONTRACT §3 attestations exactly as the off-chain one must, and the codec js/pof.mjs over the committed IDLs.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { makePof, subjectHash, saltedNullifier, sortHashes, b58 } from '../js/pof.mjs';
const require = createRequire(import.meta.url);
export const web3 = require('@solana/web3.js');
export const spl = require('@solana/spl-token');
export const P = require('@pump-fun/pump-sdk');
const BN = require('bn.js');
const { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, AddressLookupTableProgram, LAMPORTS_PER_SOL } = web3;
export { Keypair, PublicKey, subjectHash, saltedNullifier, sortHashes, b58 };

export const here = path.dirname(fileURLToPath(import.meta.url));
export const run = path.join(here, '.run');
export const SOL = LAMPORTS_PER_SOL;
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const RPC = process.env.RPC_URL || 'http://127.0.0.1:50899';
export const keyOf = name => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(run, name + '.json'), 'utf8'))));
export const rand = n => crypto.randomBytes(n);
export const field = () => { const b = crypto.randomBytes(32); b[0] = 0; return b; };

export function setup(url = RPC) {
  const conn = new Connection(url, 'confirmed');
  const q = makePof(web3);
  const lam = async a => BigInt(await conn.getBalance(new PublicKey(a), 'confirmed'));
  const info = a => conn.getAccountInfo(new PublicKey(a), 'confirmed');
  const exists = async a => !!(await info(a));
  const slotNow = async () => Number(await conn.getSlot('confirmed'));
  async function waitSlot(s) { while ((await slotNow()) < Number(s)) await sleep(150); }
  async function build(ixs, signers, units = 1_400_000, tables = []) {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    const pre = units ? [ComputeBudgetProgram.setComputeUnitLimit({ units })] : [];
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: signers[0].publicKey, recentBlockhash: blockhash, instructions: [...pre, ...ixs] }).compileToV0Message(tables));
    tx.sign(signers);
    return { tx, blockhash, lastValidBlockHeight };
  }
  async function send(ixs, signers, units, tables) {
    const { tx, blockhash, lastValidBlockHeight } = await build(Array.isArray(ixs) ? ixs : [ixs], signers, units, tables);
    const sim = await conn.simulateTransaction(tx, { sigVerify: false, commitment: 'confirmed' });
    if (sim.value.err) {
      const why = q.reason(sim.value.logs);
      const e = Error('simulation ' + JSON.stringify(sim.value.err) + ' ' + (why || (sim.value.logs || []).filter(l => /Error|failed|insufficient/i.test(l)).slice(-3).join(' | ')));
      e.logs = (sim.value.logs || []).slice(-40); e.why = why; throw e;
    }
    const sig = await conn.sendTransaction(tx, { skipPreflight: true });
    const r = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    if (r.value.err) throw Error('failed ' + JSON.stringify(r.value.err));
    send.last = { sig, size: tx.serialize().length, units: sim.value.unitsConsumed, logs: sim.value.logs };
    return sig;
  }
  async function txOf(sig) { for (let i = 0; i < 30; i++) { const t = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 1 }); if (t) return t; await sleep(300); } }
  const eventsOf = async sig => { const logs = (await txOf(sig))?.meta?.logMessages || []; return [...q.P.events(logs), ...q.G.events(logs)]; };
  const ev = async (sig, name) => (await eventsOf(sig)).find(e => e.name === name)?.data;
  async function fund(kps, sol = 20) { for (const k of kps) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey || new PublicKey(k), Math.round(sol * SOL) + Math.floor(Math.random() * 1000)), 'confirmed'); }
  async function makeTable(payer, list) {
    const s0 = await conn.getSlot('finalized');
    const [mk, key] = AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot: Math.max(0, Number(s0) - 20) });
    await send([mk], [payer], 0);
    for (let i = 0; i < list.length; i += 25) await send([AddressLookupTableProgram.extendLookupTable({ lookupTable: key, authority: payer.publicKey, payer: payer.publicKey, addresses: list.slice(i, i + 25) })], [payer], 0);
    for (let i = 0; i < 40; i++) { await sleep(500); const t = (await conn.getAddressLookupTable(key)).value; if (t && t.state.addresses.length === list.length) return t; }
    throw Error('table not ready');
  }
  /* a plain SPL mint with [owner, amount] holders */
  async function plainMint(payer, holders = [], tp = spl.TOKEN_PROGRAM_ID, decimals = 6) {
    const mint = Keypair.generate();
    const rent = await conn.getMinimumBalanceForRentExemption(spl.MINT_SIZE);
    await send([
      web3.SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, lamports: rent, space: spl.MINT_SIZE, programId: tp }),
      spl.createInitializeMint2Instruction(mint.publicKey, decimals, payer.publicKey, null, tp),
    ], [payer, mint], 0);
    for (const [owner, amount] of holders) {
      const a = spl.getAssociatedTokenAddressSync(mint.publicKey, owner, true, tp);
      await send([spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, a, owner, mint.publicKey, tp), spl.createMintToInstruction(mint.publicKey, a, payer.publicKey, BigInt(amount), [], tp)], [payer], 0);
    }
    return mint.publicKey;
  }
  const decode = async (name, addr, gate = false) => { const a = await info(addr); return a ? (gate ? q.G : q.P).decodeAccount(name, a.data) : null; };
  const config = () => decode('Config', q.K.config);
  const treasury = () => decode('Treasury', q.K.treasury);
  const cert = (h, asset = 0) => decode('Certificate', q.certPda(h, asset));
  const rentOf = bytes => conn.getMinimumBalanceForRentExemption(bytes).then(BigInt);

  /* the root mint once set_roles ran: certify and renew then pass the payer's canonical root account */
  const root = { mint: null, tp: null };
  /* pump.fun, through its own SDK: a curve buy (the rehearsal's $ROOT holder) */
  const online = new P.OnlinePumpSdk(conn), psdk = new P.PumpSdk();
  const T22 = spl.TOKEN_2022_PROGRAM_ID;
  async function curveBuy(mint, kp, lamports) {
    const g = await online.fetchGlobal();
    const st = await online.fetchBuyState(new PublicKey(mint), kp.publicKey, T22);
    const amount = P.getBuyTokenAmountFromSolAmount({ global: g, feeConfig: null, mintSupply: st.bondingCurve.tokenTotalSupply, bondingCurve: st.bondingCurve, amount: new BN(String(lamports)) });
    return send(await psdk.buyInstructions({ global: g, ...st, mint: new PublicKey(mint), user: kp.publicKey, amount, solAmount: new BN(String(lamports)), slippage: 30, tokenProgram: T22 }), [kp], 1_000_000);
  }
  const tokenAt = async account => { const a = await info(account); return a ? a.data.readBigUInt64LE(64) : 0n; };
  /* ---- the Verifier's side: an attestation (CONTRACT §3) over chosen notes, signed into an Ed25519 instruction */
  function notes(n, nullifiers) {
    const list = (nullifiers || Array.from({ length: n }, field)).map(nf => { const salt = rand(32); return { salt, nf: Buffer.from(nf), h: saltedNullifier(salt, Buffer.from(nf)) }; });
    return { list, hashes: sortHashes(list.map(x => x.h)), indexOf: nf => sortHashes(list.map(x => x.h)).findIndex(h => h.equals(list.find(x => x.nf.equals(Buffer.from(nf))).h)) };
  }
  async function attestation(o = {}) {
    const slot = await slotNow();
    const kind = o.kind ?? 0;
    const controller = o.controller ?? Keypair.generate().publicKey;
    const subject_hash = o.subject_hash ?? (kind === 1 ? subjectHash(1, o.handle || 'anon' + rand(4).toString('hex')) : subjectHash(kind, controller.toBase58()));
    const issued = o.issued_slot ?? slot - 1;
    return {
      subject_kind: kind, subject_hash, asset: o.asset ?? 0, tier: o.tier ?? 2, tree_root: o.tree_root ?? rand(32), root_slot: o.root_slot ?? issued - 3,
      null_hashes: o.null_hashes ?? notes(o.n ?? 2).hashes, issued_slot: issued, expiry_slot: o.expiry_slot ?? issued + (o.valid ?? 2000), controller, nonce: o.nonce ?? rand(16),
    };
  }
  /* certify (or renew): the Ed25519 instruction right before, signing `signed` (default: the attestation itself) for `signedPayer` */
  function certifyIxs(payer, a, { verifier, signed = a, signedPayer = payer.publicKey, programId = q.PID, prior = null, holderToken = null, logIndex = 0, name = 'certify', sigIx = null } = {}) {
    const ed = sigIx || q.signIx(verifier, q.attestationBytes(signed, signedPayer, programId));
    const accts = { payer: payer.publicKey, certificate: q.certPda(a.subject_hash, a.asset), holder_token: holderToken || (root.mint ? q.ata(payer.publicKey, root.mint, root.tp || spl.TOKEN_PROGRAM_ID) : payer.publicKey) };
    if (name === 'certify') accts.prior_payer = prior;
    const args = name === 'certify' ? { att: a, log_index: logIndex } : { att: a };
    return [ed, q.P.ix(name, args, accts)];
  }

  return { conn, q, lam, info, exists, slotNow, waitSlot, build, send, txOf, eventsOf, ev, fund, makeTable, plainMint, decode, config, treasury, cert, rentOf, notes, attestation, certifyIxs, root, curveBuy, tokenAt, psdk };
}
