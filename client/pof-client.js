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
export { explain } from './errors.js';

const S = C.spr;
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
/* The vault message (audit POF-11): one canonical domain (not location.origin, so the vault survives a preview URL), the
   purpose, and the warning. Any page that obtains this signature can rebuild the vault's spending key: the warning says so. */
export const VAULT_DOMAIN = 'proof-of-funds';
export const VAULT_MESSAGE = (wallet, domain = VAULT_DOMAIN) => [
  'Proof of Funds: create my POF vault key',
  `domain: ${domain}`,
  `wallet: ${wallet}`,
  'purpose: this signature IS the spending key of a separate Privacy Ring (the POF vault).',
  'Never sign this message on any other site: whoever has this signature can move the money in the vault.',
  'version: pof/vault/v2',
].join('\n');

export async function createPofClient(opts = {}) {
  const net = opts.network || 'mainnet';
  const cfg = {
    network: net,
    rpc: opts.rpc || ['/api/rpc' + (net === 'mainnet' ? '' : `?net=${net}`)],
    indexer: opts.indexer || (net === 'local' ? null : '/api/spr' + (net === 'mainnet' ? '' : `?net=${net}`)),
    attestUrl: opts.attestUrl || '/api/attest',
    prover: opts.prover || (net === 'local' ? null : '/api/spr-prover' + (net === 'mainnet' ? '' : `?net=${net}`)),   // spends only; the site's proxy adds the key
    programId: opts.programId || null,
    vaultDomain: opts.vaultDomain || VAULT_DOMAIN,
    relayer: opts.relayer || null,   // the relayer's address (GET /api/attest facts); X and badge certificates go through it
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
  /* The vault seed: sha256("pof/vault/v2" ‖ signature) when the wallet signs deterministically (checked by signing twice the
     first time, and against a stored check value after), otherwise a random seed kept on this device that must be backed up
     (kits.download with a passphrase) before the first shield. Neither the seed nor anything derived from it is sent. */
  const VCHECK = w => 'pof:vaultcheck:v2:' + w, VRANDOM = w => 'pof:vaultseed:v2:' + w;
  async function deriveVault({ domain = cfg.vaultDomain } = {}) {
    await C.ready();
    const wallet = W.state().address; if (!wallet) throw Error('Connect a wallet first.');
    let seed, mode = 'signature', needsBackup = false;
    const stored = get(VRANDOM(wallet));
    if (stored) { const o = JSON.parse(stored); seed = C.unhex(o.seed, 32); mode = 'random'; needsBackup = !o.backedUp; }
    else {
      status('vault', { phase: 'sign' });
      const text = VAULT_MESSAGE(wallet, domain);
      const sig = await W.signText(text);
      seed = await C.sha256(C.utf8('pof/vault/v2'), sig);
      const check = C.hex(await C.sha256(C.utf8('pof:vault-check:v2'), seed));
      const known = get(VCHECK(wallet));
      if (known && known !== check) { seed.fill(0); throw Object.assign(Error('This wallet signed the vault message differently than before, so it would open another vault. Use the device and wallet you made the vault with, or import your backup.'), { code: 'VAULT_CHANGED' }); }
      if (!known) {
        status('vault', { phase: 'sign-again' });
        const sig2 = await W.signText(text);
        const again = await C.sha256(C.utf8('pof/vault/v2'), sig2);
        if (!C.eq(again, seed)) {
          // a signer that is not deterministic (some MPC and smart wallets): a random vault key, backed up before any shield
          seed = crypto.getRandomValues(new Uint8Array(32)); mode = 'random'; needsBackup = true;
          put(VRANDOM(wallet), JSON.stringify({ seed: C.hex(seed), backedUp: false, at: new Date().toISOString() }));
          status('vault', { phase: 'random', note: 'this wallet does not sign deterministically: the vault key is random and must be backed up' });
        } else put(VCHECK(wallet), check);
        sig2.fill(0); again.fill(0);
      }
      sig.fill(0);
    }
    const signing = S.SigningKey.fromEd25519Bytes(seed);
    const kp = S.ShieldedKeypair.fromKeypair(signing);
    const owner = C.b58encode(kp.signingPublicKey().ed25519());
    const nk = kp.nullifierKey(); const nkBytes = nk.secretBytes(); nk.destroy();
    // the Verifier sees nk (CONTRACT §4), so nothing that seals or controls may come from nk: the kit key and the X controller
    // seed come from the vault seed (audit POF-10); kitKeyLegacy opens kits sealed before that fix, which are re-sealed on open
    vault = { kind: 'vault', wallet, owner, kp, signing, mode, needsBackup, nk: nkBytes, ownerHash: kp.ownerHash(),
      kitKey: await C.sha256(C.utf8('pof:kit:v2'), seed), kitKeyLegacy: await C.sha256(C.utf8('pof:kit:v1'), nkBytes),
      ctlSeed: await C.sha256(C.utf8('pof:ctl:v1'), seed), seedForBackup: mode === 'random' ? C.hex(seed) : null };
    seed.fill(0);
    status('vault', { phase: 'ready', owner, mode, needsBackup });
    return { owner, ownerHash: C.hex(vault.ownerHash), registered: await isRegistered(owner), mode, needsBackup };
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
    ring = { kind: 'ring', wallet, owner: wallet, keys, address, nk: nkBytes, ownerHash: address.ownerHash(), kitKey: await C.sha256(C.utf8('pof:kit:v2'), sig), kitKeyLegacy: await C.sha256(C.utf8('pof:kit:v1'), nkBytes), ctlSeed: await C.sha256(C.utf8('pof:ctl:v1'), sig) };
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
    if (id.needsBackup) throw Object.assign(Error('Back up the vault key first: this wallet does not sign the same way twice, so the key exists only on this device.'), { code: 'VAULT_BACKUP_NEEDED' });
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

  /* ---------------------------------------------------------------- subjects (CONTRACT §1) and the §4 v2 proofs
     One disclosure message names subject, ring, controller, asset, tier, payer and a recent slot. The ring owner always
     signs it (ring.proof, audit POF-02: lending nk alone no longer lends a certificate); the vault key signs in the page with
     no wallet prompt. A wallet subject's wallet and a badge key sign it too; an X subject shows a link id bound to the same
     controller (POF-03). */
  const xController = async (id, handle) => S.SigningKey.fromEd25519Bytes(await C.sha256(id.ctlSeed, C.utf8('x:' + C.normalHandle(handle))));
  async function ringSign(id, msg) {
    if (id.kind === 'vault') return C.hex(id.signing.sign(msg));
    status('subject', { phase: 'sign-ring' });
    return C.hex(await W.signBytes(msg, 'utf8'));
  }
  async function subject({ kind, value, asset, tier, payer, from = 'vault', linkId }) {
    const id = who(from);
    if (!cfg.programId) throw Error('the POF program id is not set');
    const at = await chainSlot();
    const base = { programId: cfg.programId, kind, ring: id.owner, asset, tier, payer, slot: at };
    if (kind === 0) {
      const wallet = W.state().address;
      const msg = C.disclosureMessage({ ...base, value: wallet, controller: wallet });
      const ringProof = await ringSign(id, msg);
      let proof = ringProof;
      if (id.owner !== wallet) { status('subject', { phase: 'sign' }); proof = C.hex(await W.signBytes(msg, 'utf8')); }
      return { kind, value: wallet, proof, slot: at, controller: wallet, ringProof };
    }
    if (kind === 1) {
      const h = C.normalHandle(value);
      if (!linkId) throw Object.assign(Error('Link the handle first (post the code from it).'), { code: 'NO_LINK' });
      const controller = C.b58encode((await xController(id, h)).publicKey().ed25519());
      const msg = C.disclosureMessage({ ...base, value: h, controller });
      return { kind, value: h, proof: linkId, slot: at, controller, ringProof: await ringSign(id, msg) };
    }
    if (kind === 2) {
      // a fresh badge key made here: its secret is sealed in the kit (under a key the Verifier cannot rebuild, POF-10)
      const secret = crypto.getRandomValues(new Uint8Array(32));
      const badge = S.SigningKey.fromEd25519Bytes(secret);
      const value2 = C.b58encode(badge.publicKey().ed25519());
      const msg = C.disclosureMessage({ ...base, value: value2, controller: value2 });
      return { kind, value: value2, proof: C.hex(badge.sign(msg)), slot: at, controller: value2, ringProof: await ringSign(id, msg), badgeSecret: C.hex(secret) };
    }
    throw Error('subject kind is 0 (wallet), 1 (X handle) or 2 (badge)');
  }

  /* ---------------------------------------------------------------- the X handle link (audit POF-03)
     start: the Verifier gives a code to post and a secret that stays in this tab (sessionStorage); check: the post and the
     secret, bound to this vault's controller for the handle, give the link id that subject() takes. */
  const linkUrl = fn => api(cfg.attestUrl.replace(/\/attest$/, '/link/' + fn));
  const LINKS = h => 'pof:link:v2:' + h;
  const session = typeof sessionStorage !== 'undefined' ? sessionStorage : new Map();
  async function linkStart({ handle, from = 'vault' }) {
    const id = who(from);
    const h = C.normalHandle(handle);
    const controller = C.b58encode((await xController(id, h)).publicKey().ed25519());
    const r = await jsonCall(linkUrl('start'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: h, controller }) });
    const v = JSON.stringify({ secret: r.secret, controller, at: Date.now() });
    session.setItem ? session.setItem(LINKS(h), v) : session.set(LINKS(h), v);
    return { handle: h, code: r.code, post: r.post, expiresInSec: r.expiresInSec, controller };
  }
  async function linkCheck({ handle, post }) {
    const h = C.normalHandle(handle);
    const raw = session.getItem ? session.getItem(LINKS(h)) : session.get(LINKS(h));
    if (!raw) throw Object.assign(Error('Start the link again in this tab: the secret that goes with the code is kept only here.'), { code: 'NO_SECRET' });
    const { secret, controller } = JSON.parse(raw);
    const r = await jsonCall(linkUrl('check'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: h, post, secret, controller }) });
    session.removeItem ? session.removeItem(LINKS(h)) : session.delete(LINKS(h));
    return { handle: h, linkId: r.link, controller: r.controller, expiresInSec: r.expiresInSec };
  }

  /* ---------------------------------------------------------------- CONTRACT §4 and the attestation */
  function disclose({ subject: subj, asset, tier, notes: chosen, payer, relay, from = 'vault' }) {
    const id = who(from);
    return C.disclosurePackage({ subject: subj, asset, tier, ring: { owner: id.owner, nk: id.nk, proof: subj.ringProof }, notes: chosen, payer, relay, controller: subj.kind === 1 ? subj.controller : undefined });
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
  /* a passphrase box for the export file (PBKDF2-SHA256 600k → AES-GCM), so a lost device does not lose a random vault key */
  async function passBox(obj, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const base = await crypto.subtle.importKey('raw', C.utf8(passphrase), 'PBKDF2', false, ['deriveBits']);
    const key = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 }, base, 256));
    return { kdf: 'pbkdf2-sha256-600000', salt: C.hex(salt), ...(await seal(obj, key)) };
  }
  async function passOpen(box, passphrase) {
    const base = await crypto.subtle.importKey('raw', C.utf8(passphrase), 'PBKDF2', false, ['deriveBits']);
    const key = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: C.unhex(box.salt), iterations: 600_000 }, base, 256));
    try { return await unseal(box, key); } catch { throw Object.assign(Error('That passphrase does not open the vault backup.'), { code: 'BAD_PASSPHRASE' }); }
  }
  const kits = {
    list: () => readKits(),
    /* the export file: the kits, and, when this device holds a random vault key, that key under a passphrase */
    async export({ passphrase } = {}) {
      const out = { kind: 'pof-kits', v: 1, kits: readKits() };
      if (vault && vault.mode === 'random') {
        if (!passphrase || passphrase.length < 10) throw Object.assign(Error('Choose a passphrase of at least 10 characters for the vault key backup.'), { code: 'PASSPHRASE_NEEDED' });
        out.vaultBackup = { wallet: vault.wallet, owner: vault.owner, box: await passBox({ seed: vault.seedForBackup }, passphrase) };
      }
      return JSON.stringify(out, null, 1);
    },
    async import(text, { passphrase } = {}) {
      const j = typeof text === 'string' ? JSON.parse(text) : text;
      const add = (j.kind === 'pof-kits' ? j.kits : [j]).filter(k => k && k.v === 1 && /^[0-9a-f]{480}$/.test(k.attestation));
      const all = readKits(); for (const k of add) if (!all.some(x => x.attestation === k.attestation)) all.push(k);
      put(KITS, JSON.stringify(all));
      if (j.vaultBackup && passphrase) {
        const o = await passOpen(j.vaultBackup.box, passphrase);
        put(VRANDOM(j.vaultBackup.wallet), JSON.stringify({ seed: o.seed, backedUp: true, at: new Date().toISOString() }));
      }
      return add.length;
    },
    /* open a kit; a kit sealed under the old nk-derived key (before audit POF-10) is re-sealed under the vault-seed key */
    async open(kit, from = 'vault') {
      const id = who(from);
      try { return await unseal(kit.sealed, id.kitKey); }
      catch {
        const o = await unseal(kit.sealed, id.kitKeyLegacy);
        const all = readKits(); const k = all.find(x => x.attestation === kit.attestation);
        if (k) { k.sealed = await seal(o, id.kitKey); put(KITS, JSON.stringify(all)); }
        return o;
      }
    },
    async download({ passphrase, filename = `pof-kits-${new Date().toISOString().slice(0, 10)}.json` } = {}) {
      const text = await kits.export({ passphrase });
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      if (vault && vault.mode === 'random') { vault.needsBackup = false; put(VRANDOM(vault.wallet), JSON.stringify({ seed: vault.seedForBackup, backedUp: true, at: new Date().toISOString() })); }
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
    const k = await xController(id, kit.subject.value);
    return { publicKey: C.b58encode(k.publicKey().ed25519()), sign: m => k.sign(new Uint8Array(m)) };
  }

  /* ---------------------------------------------------------------- the whole flow in one call (the /get page drives it step by step) */
  /* The relayer (audit POF-12): an X or badge certificate is paid and submitted by the relayer, so no wallet appears in
     Certificate.payer, the Certified event or the log leaf. The relay fee is paid by default as a Ring withdrawal from the
     vault (the vault is already the funds' address); paying from the wallet needs { allowWalletPayer: true } and makes the
     wallet ↔ subject link public, which the caller must have shown the holder first. */
  const api = path => new URL(path, typeof location !== 'undefined' ? location.href : 'http://localhost/').href;
  const facts = async () => { if (cfg.facts) return cfg.facts; const r = await fetch(api(cfg.attestUrl)); cfg.facts = await r.json(); return cfg.facts; };
  async function relayerAddress() { if (cfg.relayer) return cfg.relayer; try { return (await facts()).relayer || null; } catch { return null; } }
  const relayUrl = fn => api(cfg.attestUrl.replace(/\/attest$/, '/relay/' + fn));
  async function jsonCall(url, init) {
    const r = await fetch(url, init);
    const j = await r.json().catch(() => ({ error: { code: 'BAD_ANSWER', message: `the server answered ${r.status}` } }));
    if (!r.ok || j.error) throw Object.assign(Error(j.error?.message || `the server answered ${r.status}`), { code: j.error?.code, details: j.error?.details });
    return j;
  }
  async function payRelay(quote, { allowWalletPayer, from }) {
    const lamports = BigInt(quote.lamports);
    if (lamports === 0n) return null;
    if (allowWalletPayer) {
      const { SystemProgram, PublicKey } = await import('./dist/web3.js');
      status('relay', { phase: 'pay', from: 'wallet', lamports: quote.lamports });
      const r = await W.send([SystemProgram.transfer({ fromPubkey: new PublicKey(W.state().address), toPubkey: new PublicKey(quote.payTo), lamports: Number(lamports) })]);
      await r.wait(); return r.signature;
    }
    status('relay', { phase: 'pay', from: 'vault', lamports: quote.lamports });
    return (await withdraw({ asset: 0, amount: lamports, to: quote.payTo, from })).signature;
  }
  async function certify({ asset, tier, subjectKind = 0, handle, linkId, payer, relay, allowWalletPayer = false, from = 'vault' }) {
    const pick = await choose({ asset, tier, from });
    if (!pick.ready) throw Object.assign(Error(pick.waitSlots ? `your newest note needs ${pick.waitSlots} more slots before it can be certified` : 'not enough in the vault for that tier'), { code: pick.waitSlots ? 'NOTE_TOO_NEW' : 'BELOW_TIER', pick });
    const useRelay = relay ?? subjectKind !== 0;
    let pay = payer || W.state().address;
    if (useRelay) {
      if (subjectKind === 0) throw Object.assign(Error('a wallet certificate is submitted by the wallet itself'), { code: 'RELAY_NOT_FOR_WALLETS' });
      const r = await relayerAddress();
      if (r) pay = r;
      else if (!allowWalletPayer) throw Object.assign(Error('The relayer is off, so this certificate would be paid from your wallet and link it to the subject in public.'), { code: 'RELAY_NEEDED' });
      else status('relay', { phase: 'off', warning: 'paid from the wallet: the wallet and the subject are linked on chain' });
    } else if (subjectKind !== 0 && !allowWalletPayer) throw Object.assign(Error('Paying an X or badge certificate from your wallet links the wallet to the subject in public.'), { code: 'PAYER_LINKS_WALLET' });
    const viaRelay = useRelay && pay !== W.state().address;
    const quote = viaRelay ? await jsonCall(relayUrl('quote')) : null;
    const subj = await subject({ kind: subjectKind, value: handle, asset, tier, payer: pay, from, linkId });
    const pkg = disclose({ subject: subj, asset, tier, notes: pick.notes, payer: pay, relay: viaRelay, from });
    const answer = await attest(pkg, { from, subject: subj });
    if (!viaRelay) return answer;   // the holder submits certify from the wallet (the program's IDL; the /get page does it)
    const payment = await payRelay(quote, { allowWalletPayer, from });
    for (let i = 0; i < 20; i++) {
      try {
        const done = await jsonCall(relayUrl('certify'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attestation: answer.attestation, signature: answer.signature, logIndex: answer.logIndex, quote: quote.quote, hashes: answer.hashes }) });
        status('relay', { phase: 'done', signature: done.signature });
        return { ...answer, relayed: done, payment };
      } catch (e) { if (e.code !== 'NOT_PAID' || i === 19) throw e; await new Promise(r => setTimeout(r, 1500)); }
    }
  }


  return {
    config: cfg, onStatus: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    ready: () => C.ready(), hasher: S.hasherState,
    connect: id => W.connect(id), wallet: () => W.state(),
    deriveVault, deriveRing, isRegistered, register, shield, notes, balance, choose, subject, disclose, attest, certify, kits, controllerOf, vaultSigner: () => vaultSigner(), fundVault, withdraw, linkStart, linkCheck,
    local, identity: from => { const id = from === 'ring' ? ring : vault; return id ? { kind: id.kind, owner: id.owner, ownerHash: C.hex(id.ownerHash) } : null; },
    forget() { for (const id of [vault, ring]) if (id) { id.nk.fill(0); id.kitKey.fill(0); id.ctlSeed.fill(0); } vault = ring = null; },
  };
}
export { C as core };
