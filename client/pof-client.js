/* Proof of Funds browser client (ESM). One object that takes a holder from a wallet to a certificate:
     connect → derive the POF vault (one signature) or the wallet's own Ring (the Rings derivation signature)
     → register it (once) → shield SOL or USDC into it → sync its notes → pick the fewest notes that reach a tier
     → sign the subject → build the CONTRACT §4 package → POST /api/attest → keep the revoke kit locally.
   Facts behind every step: pof/RINGS.md. The SDK parts come from dist/spr.js (built by tools/build.mjs); the Poseidon WASM
   loads once, with progress (onStatus 'hasher'). Nothing secret leaves the page except the package sent to the Verifier
   (the openings of the chosen notes and the vault's nullifier key, RINGS §5), and nothing is logged.

   Networks: mainnet and devnet read notes through the Helius Rings indexer behind the site's /api/spr proxy (the key stays
   on the server); local reads them from the chain itself (LocalRings, localtree.js). */
import * as C from './core.js';
import { setRpc, rpc, account, slot as chainSlot } from './chain.js';
import * as walletJs from './wallet.js';
import { LocalRings, jsonRpc } from './localtree.js';

const S = C.spr;
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const VAULT_MESSAGE = wallet => `Proof of Funds vault key\nwallet: ${wallet}\nThis signature makes your POF vault, a separate Privacy Ring for certificates. Sign it only on Proof of Funds.`;

export async function createPofClient(opts = {}) {
  const net = opts.network || 'mainnet';
  const cfg = {
    network: net,
    rpc: opts.rpc || ['/api/rpc' + (net === 'mainnet' ? '' : `?net=${net}`)],
    indexer: opts.indexer || (net === 'local' ? null : '/api/spr' + (net === 'mainnet' ? '' : `?net=${net}`)),
    attestUrl: opts.attestUrl || '/api/attest',
    prover: opts.prover || (net === 'local' ? null : '/api/spr-prover' + (net === 'mainnet' ? '' : `?net=${net}`)),   // spends only; the site's proxy adds the key
    programId: opts.programId || null,
    minAgeSlots: BigInt(opts.minAgeSlots ?? 150),
    tree: C.RINGS.tree,
    mints: { 0: C.ASSETS[0].mint, 1: opts.usdcMint || C.ASSETS[1].mint },
  };
  setRpc(cfg.rpc);
  const W = opts.wallet || walletJs;
  if (W.setChain) W.setChain(net === 'mainnet' ? 'solana:mainnet' : net === 'devnet' ? 'solana:devnet' : 'solana:localnet');
  const store = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : new Map());
  const get = k => (store.getItem ? store.getItem(k) : store.get(k)) ?? null;
  const put = (k, v) => (store.setItem ? store.setItem(k, v) : store.set(k, v));

  const listeners = new Set();
  const status = (step, detail = {}) => { for (const fn of listeners) { try { fn({ step, ...detail }); } catch {} } };
  S.onHasherProgress(h => status('hasher', h));

  let local = null;
  if (net === 'local') {
    local = new LocalRings(jsonRpc(Array.isArray(cfg.rpc) ? cfg.rpc[0] : cfg.rpc), { cloned: opts.clonedTree || null });
  }
  const indexer = () => {
    if (!cfg.indexer) throw Error('no Rings indexer on this network');
    // the SDK posts to <base>/<method> and keeps the query (?net=devnet)
    return new S.SprIndexer(new S.SprApi({ url: new URL(cfg.indexer, typeof location !== 'undefined' ? location.href : 'http://localhost/').href }));
  };

  /* ---------------------------------------------------------------- identities: the vault and the wallet's own Ring */
  let vault = null, ring = null;
  async function deriveVault() {
    await C.ready();
    const wallet = W.state().address; if (!wallet) throw Error('Connect a wallet first.');
    status('vault', { phase: 'sign' });
    const sig = await W.signText(VAULT_MESSAGE(wallet));
    const seed = await C.sha256(C.utf8('pof/vault/v1'), sig);
    const signing = S.SigningKey.fromEd25519Bytes(seed);
    const kp = S.ShieldedKeypair.fromKeypair(signing);
    const owner = C.b58encode(kp.signingPublicKey().ed25519());
    const nk = kp.nullifierKey(); const nkBytes = nk.secretBytes(); nk.destroy();
    // ctlSeed: the root of X-handle controller keys. It comes from the vault seed, which never leaves the page (the Verifier
    // sees nk, so nothing it could rebuild may derive a controller)
    vault = { kind: 'vault', wallet, owner, kp, signing, nk: nkBytes, ownerHash: kp.ownerHash(), kitKey: await C.sha256(C.utf8('pof:kit:v1'), nkBytes), ctlSeed: await C.sha256(C.utf8('pof:ctl:v1'), seed) };
    sig.fill(0); seed.fill(0);
    status('vault', { phase: 'ready', owner });
    return { owner, ownerHash: C.hex(vault.ownerHash), registered: await isRegistered(owner) };
  }
  async function deriveRing() {
    await C.ready();
    const wallet = W.state().address; if (!wallet) throw Error('Connect a wallet first.');
    const pub = C.b58decode(wallet, 32);
    const msg = S.ed25519DerivationMessage(pub);
    status('ring', { phase: 'sign' });
    const sig = await W.signBytes(msg, 'hex');
    let keys;
    try { keys = S.LocalShieldedKeys.fromDerivationSeed({ solanaPublicKey: wallet, derivationSeed: sig }); }
    catch (e) { throw Object.assign(Error('derive: the wallet changed the bytes it signed, so it cannot make a Rings identity here (use the POF vault instead)'), { code: 'DERIVE_REFUSED', cause: e }); }
    const nkBytes = keys.withNullifierKey(k => k.secretBytes());
    const address = keys.address();
    ring = { kind: 'ring', wallet, owner: wallet, keys, address, nk: nkBytes, ownerHash: address.ownerHash(), kitKey: await C.sha256(C.utf8('pof:kit:v1'), nkBytes), ctlSeed: await C.sha256(C.utf8('pof:ctl:v1'), sig) };
    sig.fill(0);
    status('ring', { phase: 'ready', owner: wallet, ownerHash: C.hex(ring.ownerHash) });
    return { owner: wallet, ownerHash: C.hex(ring.ownerHash), registered: await isRegistered(wallet) };
  }
  const who = from => { const id = from === 'ring' ? ring : vault; if (!id) throw Error(from === 'ring' ? 'Derive your Ring first.' : 'Make your POF vault first.'); return id; };
  async function isRegistered(owner) {
    const rec = await account(await S.internalUserRecordAddress(owner));
    return !!rec && rec.owner === C.RINGS.registry;
  }

  /* ---------------------------------------------------------------- registration (User Registry, RINGS §6) */
  async function register(from = 'vault') {
    const id = who(from);
    if (await isRegistered(id.owner)) { status('register', { phase: 'done', already: true }); return { already: true }; }
    const address = id.kind === 'vault' ? id.kp.shieldedAddress() : id.address;
    const ix = await S.registerInstruction({ owner: id.owner, payer: W.state().address, nullifierPublicKey: address.nullifierPublicKey, viewingPublicKey: address.viewingPublicKey.toBytes() });
    status('register', { phase: 'sign' });
    const cosigners = id.kind === 'vault' ? [vaultSigner()] : [];
    const r = await W.send([W.toWeb3(ix)], { cosigners });
    status('register', { phase: 'sent', signature: r.signature });
    const done = await r.wait();
    status('register', { phase: 'done', signature: r.signature });
    return done;
  }
  const vaultSigner = () => ({ publicKey: vault.owner, sign: m => vault.signing.sign(new Uint8Array(m)) });

  /* ---------------------------------------------------------------- shield: a proofless deposit into the vault or the Ring */
  async function shield({ asset = 0, amount, into = 'vault' }) {
    const id = who(into);
    const a = C.ASSETS[asset]; if (!a) throw Error('asset is 0 (SOL) or 1 (USDC)');
    const amt = typeof amount === 'bigint' ? amount : C.parseUnits(amount, a.decimals);
    if (amt <= 0n) throw Error('enter an amount');
    const depositor = W.state().address;
    let depositAsset;
    if (asset === 0) depositAsset = { kind: 'sol' };
    else {
      const mint = cfg.mints[1];
      const [source] = await findPda([C.b58decode(depositor, 32), C.b58decode(TOKEN, 32), C.b58decode(mint, 32)], ATA);
      depositAsset = { kind: 'spl', accounts: { mint, sourceTokenAccount: source, tokenProgram: TOKEN } };
    }
    const ix = await S.depositInstruction({ tree: cfg.tree, depositor, deposits: [{ asset: depositAsset, viewTag: C.b58decode(id.owner, 32), recipientOwnerHash: id.ownerHash, amount: amt }] });
    status('shield', { phase: 'sign', asset, amount: String(amt) });
    const r = await W.send([W.toWeb3(ix)]);
    status('shield', { phase: 'sent', signature: r.signature });
    const done = await r.wait();
    status('shield', { phase: 'done', signature: r.signature, slot: String(done.slot) });
    return { signature: r.signature, slot: done.slot };
  }
  async function findPda(seeds, program) {
    const { PublicKey } = await import('./dist/web3.js');
    const [k] = PublicKey.findProgramAddressSync(seeds, new PublicKey(program));
    return [k.toBase58()];
  }

  /* ---------------------------------------------------------------- notes: sync and decrypt */
  async function notes({ from = 'vault' } = {}) {
    const id = who(from);
    await C.ready();
    status('sync', { phase: 'start' });
    let list;
    if (local) list = await local.notesOf({ owner: id.owner, ownerHash: id.ownerHash });
    else {
      const keys = id.kind === 'vault' ? S.LocalShieldedKeys.fromKeypair(id.kp) : id.keys;
      const address = id.kind === 'vault' ? id.kp.shieldedAddress() : id.address;
      const wallet = id.syncWallet || (id.syncWallet = new S.Wallet({ identity: address }));
      const ix = indexer();
      const client = {
        getShieldedTransactionsByTags: (...a) => ix.getShieldedTransactionsByTags(...a),
        getEncryptedUtxosByTags: (...a) => ix.getEncryptedUtxosByTags(...a),
        getShieldedTransactionsByNullifiers: (...a) => ix.getShieldedTransactionsByNullifiers(...a),
        solanaRpc: S.createSolanaRpc(new URL(Array.isArray(cfg.rpc) ? cfg.rpc[0] : cfg.rpc, typeof location !== 'undefined' ? location.href : 'http://localhost/').href),
        commitment: 'confirmed',
      };
      await S.syncWallet({ client, wallet, keys });
      const rows = wallet.privateTransactions();
      list = wallet.utxos().filter(u => !u.spent).map(u => {
        const row = rows.find(r => r.id.index === u.outputContext.leafIndex);
        return {
          tree: u.outputContext.tree, leafIndex: BigInt(u.outputContext.leafIndex), asset: u.utxo.asset, amount: u.utxo.amount, blinding: u.utxo.blinding,
          leaf: u.outputContext.hash, sig: row?.id.signature, slot: row ? BigInt(row.id.slot) : null, kind: row?.kind,
          ...(u.dataHash ? { dataHash: u.dataHash } : {}), ...(u.ringDataHash ? { ringDataHash: u.ringDataHash } : {}), ...(u.utxo.ringProgramId ? { ringProgramId: u.utxo.ringProgramId } : {}),
        };
      });
    }
    // each note's nullifier, and the chain's word on it (the nullifier PDA, RINGS §3)
    for (const n of list) n.nullifier = C.nullifier(n.leaf, n.blinding, id.nk);
    const pdas = await Promise.all(list.map(n => S.nullifierPdaAddress(n.tree, n.nullifier)));
    const spent = pdas.length ? (await rpc('getMultipleAccounts', [pdas, { encoding: 'base64', commitment: 'confirmed' }])).value : [];
    list = list.filter((n, i) => !(spent[i] && spent[i].owner === C.RINGS.spp));
    status('sync', { phase: 'done', count: list.length });
    return list;
  }
  function balance(list, asset) { const mint = cfg.mints[asset]; return list.filter(n => n.asset === mint).reduce((a, n) => a + BigInt(n.amount), 0n); }

  /* the fewest notes of one asset that reach a tier, old enough for the Verifier (minAgeSlots) */
  async function choose({ asset, tier, from = 'vault', list }) {
    list ||= await notes({ from });
    const min = C.tierMinimum(asset, tier);
    const now = await chainSlot();
    const mint = cfg.mints[asset];
    const mine = list.filter(n => n.asset === mint);
    const aged = mine.filter(n => n.slot === null || n.slot === undefined || n.slot + cfg.minAgeSlots <= now);
    const pick = C.pickNotes(aged, min);
    if (pick) return { ready: true, ...pick, minimum: min };
    const later = C.pickNotes(mine, min);
    if (later) {
      const newest = later.notes.reduce((m, n) => (n.slot > m ? n.slot : m), 0n);
      return { ready: false, waitSlots: Number(newest + cfg.minAgeSlots - now), ...later, minimum: min };
    }
    return { ready: false, short: min - balance(mine, asset) > 0n ? min - mine.reduce((a, n) => a + BigInt(n.amount), 0n) : 0n, minimum: min, notes: [] };
  }

  /* ---------------------------------------------------------------- subjects (CONTRACT §1, the §4 proof) */
  async function subject({ kind, value, asset, tier, payer, from = 'vault', linkId }) {
    const id = who(from);
    if (!cfg.programId) throw Error('the POF program id is not set');
    if (kind === 1) {
      // the controller of an X certificate (CONTRACT §3): an Ed25519 key rebuilt from this vault or Ring for this handle,
      // so the holder can revoke it and join rooms with it from any device that signs the same message again
      const h = C.normalHandle(value);
      const ctl = S.SigningKey.fromEd25519Bytes(await C.sha256(id.ctlSeed, C.utf8('x:' + h)));
      return { kind, value: h, proof: linkId, controller: C.b58encode(ctl.publicKey().ed25519()) };
    }
    const at = await chainSlot();
    if (kind === 0) {
      const wallet = W.state().address;
      const msg = C.subjectMessage({ programId: cfg.programId, kind, value: wallet, ring: id.owner, asset, tier, payer, slot: at });
      status('subject', { phase: 'sign' });
      const sig = await W.signBytes(msg, 'utf8');
      return { kind, value: wallet, proof: C.hex(sig), slot: at };
    }
    if (kind === 2) {
      // a fresh badge key made here: its secret is kept in the kit, so the holder can prove the badge later
      const secret = crypto.getRandomValues(new Uint8Array(32));
      const badge = S.SigningKey.fromEd25519Bytes(secret);
      const value2 = C.b58encode(badge.publicKey().ed25519());
      const msg = C.subjectMessage({ programId: cfg.programId, kind, value: value2, ring: id.owner, asset, tier, payer, slot: at });
      return { kind, value: value2, proof: C.hex(badge.sign(msg)), slot: at, badgeSecret: C.hex(secret) };
    }
    throw Error('subject kind is 0 (wallet), 1 (X handle) or 2 (badge)');
  }

  /* ---------------------------------------------------------------- CONTRACT §4 and the attestation */
  function disclose({ subject: subj, asset, tier, notes: chosen, payer, relay, from = 'vault' }) {
    const id = who(from);
    return C.disclosurePackage({ subject: subj, asset, tier, ring: { owner: id.owner, nk: id.nk }, notes: chosen, payer, relay, controller: subj.controller });
  }
  async function attest(pkg, { from = 'vault', subject: subj } = {}) {
    status('attest', { phase: 'send' });
    const r = await fetch(cfg.attestUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pkg) });
    const j = await r.json().catch(() => ({ error: { code: 'BAD_ANSWER', message: 'the Verifier did not answer with JSON' } }));
    if (!r.ok || j.error) { const e = Error(j.error?.message || j.message || `the Verifier answered ${r.status}`); e.code = j.error?.code || j.code; e.details = j.error?.details || j.details; status('attest', { phase: 'refused', code: e.code }); throw e; }
    await saveKit({ pkg, answer: j, from, subject: subj });
    status('attest', { phase: 'done', logIndex: j.logIndex });
    return j;
  }

  /* ---------------------------------------------------------------- the revoke kit, kept locally (export/import) */
  const KITS = 'pof:kits:v1';
  const readKits = () => { try { return JSON.parse(get(KITS) || '[]'); } catch { return []; } };
  async function seal(obj, key) {
    const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, C.utf8(JSON.stringify(obj))));
    return { iv: C.hex(iv), ct: C.hex(ct) };
  }
  async function unseal(box, key) {
    const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: C.unhex(box.iv) }, k, C.unhex(box.ct))));
  }
  async function saveKit({ pkg, answer, from, subject: subj }) {
    const id = who(from);
    const kit = {
      v: 1, savedAt: new Date().toISOString(), network: net, programId: cfg.programId,
      subject: { kind: pkg.subject.kind, value: pkg.subject.value }, subjectHash: answer.subjectHash, asset: pkg.asset, tier: pkg.tier,
      tree: pkg.notes[0].tree, ringOwner: id.owner, controller: answer.controller || pkg.controller || pkg.subject.value, attestation: answer.attestation, signature: answer.signature, verifierKey: answer.verifierKey,
      logIndex: answer.logIndex, issuedSlot: answer.issuedSlot, expirySlot: answer.expirySlot,
      // CONTRACT §5: anyone holding (salt, nullifier) can revoke once the note is spent; these never name an amount
      revoke: (answer.salts || []).map((salt, i) => ({ salt, nullifier: answer.nullifiers[i] })),
      // the openings (amounts) and a badge secret, sealed with a key only this vault or Ring can rebuild
      sealed: await seal({ notes: pkg.notes, badgeSecret: subj?.badgeSecret || null }, id.kitKey),
    };
    const all = readKits().filter(k => k.attestation !== kit.attestation);
    all.push(kit); put(KITS, JSON.stringify(all));
    return kit;
  }
  const kits = {
    list: () => readKits(),
    export: () => JSON.stringify({ kind: 'pof-kits', v: 1, kits: readKits() }, null, 1),
    import(text) {
      const j = typeof text === 'string' ? JSON.parse(text) : text;
      const add = (j.kind === 'pof-kits' ? j.kits : [j]).filter(k => k && k.v === 1 && /^[0-9a-f]{480}$/.test(k.attestation));
      const all = readKits(); for (const k of add) if (!all.some(x => x.attestation === k.attestation)) all.push(k);
      put(KITS, JSON.stringify(all)); return add.length;
    },
    async open(kit, from = 'vault') { return unseal(kit.sealed, who(from).kitKey); },
    download(filename = `pof-kits-${new Date().toISOString().slice(0, 10)}.json`) {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([kits.export()], { type: 'application/json' })); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    },
  };

  /* ---------------------------------------------------------------- spend: withdraw out of the vault (the Helius prover)
     The vault key signs in the page and pays its own fee and the nullifier PDA rent (0.00070612 SOL per spent note), so
     fund it first (fundVault). Loads dist/spr-spend.js (the attested prover client) only now. */
  async function fundVault(lamports = 5_000_000) {
    const { SystemProgram, PublicKey } = await import('./dist/web3.js');
    const ix = SystemProgram.transfer({ fromPubkey: new PublicKey(W.state().address), toPubkey: new PublicKey(who('vault').owner), lamports });
    const r = await W.send([ix]); return r.wait();
  }
  async function withdraw({ asset = 0, amount, to, from = 'vault' }) {
    if (from !== 'vault') throw Error("withdraw signs with the vault key in this page; the wallet's own Ring withdraws in the wallet");
    if (!cfg.prover || !cfg.indexer) throw Error('withdraw needs the Rings indexer and prover');
    const id = who('vault');
    const X = await import('./dist/spr-spend.js');
    const abs = u => new URL(u, typeof location !== 'undefined' ? location.href : 'http://localhost/').href;
    const client = new X.SprClient({ solanaRpcUrl: abs(Array.isArray(cfg.rpc) ? cfg.rpc[0] : cfg.rpc), indexerUrl: abs(cfg.indexer), proverUrl: abs(cfg.prover), proverTee: X.SignedTeePolicy.forNetwork(net), allowInsecureHttp: true });
    const keys = X.LocalKeys.fromKeypair(id.kp, client.proofService);
    const wallet = id.syncWallet || (id.syncWallet = new S.Wallet({ identity: id.kp.shieldedAddress() }));
    await S.syncWallet({ client, wallet, keys });
    const a = C.ASSETS[asset];
    const amt = typeof amount === 'bigint' ? amount : C.parseUnits(amount, a.decimals);
    status('withdraw', { phase: 'prove' });
    const tx = await X.buildWithdrawalTransaction({ client, wallet, keys, feePayer: id.owner, recipient: to || W.state().address, amount: amt, ...(asset === 0 ? {} : { asset: cfg.mints[asset] }) });
    const signatures = { ...tx.signatures, [id.owner]: id.signing.sign(new Uint8Array(tx.messageBytes)) };
    const wire = X.getBase64EncodedWireTransaction({ ...tx, signatures });
    const signature = await rpc('sendTransaction', [wire, { encoding: 'base64', preflightCommitment: 'confirmed' }]);
    status('withdraw', { phase: 'sent', signature });
    for (let i = 0; i < 90; i++) {
      const st = (await rpc('getSignatureStatuses', [[signature]])).value[0];
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) { if (st.err) throw Error('the withdrawal failed on chain: ' + JSON.stringify(st.err)); status('withdraw', { phase: 'done', signature }); return { signature, slot: BigInt(st.slot) }; }
      await new Promise(r => setTimeout(r, 1000));
    }
    throw Error('the withdrawal was not confirmed in time');
  }

  /* the controller key of a kit, as a signer ({ publicKey, sign(message) }) for revoke_by_holder and room joins: the
     wallet itself (kind 0, signs through the wallet), the badge key (kind 2, from the sealed kit), or the X key (kind 1) */
  async function controllerOf(kit, from = 'vault') {
    const id = who(from);
    if (kit.subject.kind === 0) return { publicKey: kit.subject.value, wallet: true };
    if (kit.subject.kind === 2) { const o = await kits.open(kit, from); const k = S.SigningKey.fromEd25519Bytes(C.unhex(o.badgeSecret, 32)); return { publicKey: kit.subject.value, sign: m => k.sign(new Uint8Array(m)) }; }
    const k = S.SigningKey.fromEd25519Bytes(await C.sha256(id.ctlSeed, C.utf8('x:' + kit.subject.value)));
    return { publicKey: C.b58encode(k.publicKey().ed25519()), sign: m => k.sign(new Uint8Array(m)) };
  }

  /* ---------------------------------------------------------------- the whole flow in one call (the /get page drives it step by step) */
  async function certify({ asset, tier, subjectKind = 0, handle, linkId, payer, relay = false, from = 'vault' }) {
    const pick = await choose({ asset, tier, from });
    if (!pick.ready) throw Object.assign(Error(pick.waitSlots ? `your newest note needs ${pick.waitSlots} more slots before it can be certified` : 'not enough in the vault for that tier'), { code: pick.waitSlots ? 'NOTE_TOO_NEW' : 'BELOW_TIER', pick });
    const pay = payer || W.state().address;
    const subj = await subject({ kind: subjectKind, value: handle, asset, tier, payer: pay, from, linkId });
    const pkg = disclose({ subject: subj, asset, tier, notes: pick.notes, payer: pay, relay, from });
    return attest(pkg, { from, subject: subj });
  }

  return {
    config: cfg, onStatus: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    ready: () => C.ready(), hasher: S.hasherState,
    connect: id => W.connect(id), wallet: () => W.state(),
    deriveVault, deriveRing, isRegistered, register, shield, notes, balance, choose, subject, disclose, attest, certify, kits, controllerOf, vaultSigner: () => vaultSigner(), fundVault, withdraw,
    local, identity: from => { const id = from === 'ring' ? ring : vault; return id ? { kind: id.kind, owner: id.owner, ownerHash: C.hex(id.ownerHash) } : null; },
    forget() { for (const id of [vault, ring]) if (id) { id.nk.fill(0); id.kitKey.fill(0); id.ctlSeed.fill(0); } vault = ring = null; },
  };
}
export { C as core };
