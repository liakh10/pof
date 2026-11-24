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
import { CREDIT_PINS } from './dist/pins.js';
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
    // a random wait before certify by default off the lab (audit2): the attestation's slot then says less about the moment
    defaultDelaySlots: opts.defaultDelaySlots || (net === 'local' ? [0, 0] : [75, 750]),
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
  const del = k => (store.removeItem ? store.removeItem(k) : store.delete(k));

  const listeners = new Set();
  let lastStatus = null;
  const status = (step, detail = {}) => { lastStatus = { step, ...detail, at: Date.now() }; for (const fn of listeners) { try { fn(lastStatus); } catch {} } };
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
  /* A random vault seed (non-deterministic wallets) is stored only inside a passphrase box (PBKDF2-SHA256, 600,000 rounds,
     AES-GCM; audit POF-27) and is in memory only while the vault is open. The box is also what the backup file carries. */
  const VCHECK = w => 'pof:vaultcheck:v2:' + w, VRANDOM = w => 'pof:vaultbox:v3:' + w, VLEGACY = w => 'pof:vaultseed:v2:' + w;
  const pendingRandom = new Map();
  async function deriveVault({ domain = cfg.vaultDomain, passphrase } = {}) {
    await C.ready();
    const wallet = W.state().address; if (!wallet) throw Error('Connect a wallet first.');
    let seed, mode = 'signature', needsBackup = false, box = null;
    const stored = get(VRANDOM(wallet)), legacy = get(VLEGACY(wallet));
    if (stored) {
      const o = JSON.parse(stored);
      if (!passphrase) throw Object.assign(Error('Enter the passphrase of your vault key.'), { code: 'VAULT_LOCKED' });
      seed = C.unhex((await passOpen(o.box, passphrase)).seed, 32); mode = 'random'; needsBackup = !o.backedUp; box = o.box;
    } else if (legacy) {
      // a plain-text seed from before POF-27: sealed under a passphrase now, and the plain copy removed
      if (!passphrase) throw Object.assign(Error('Choose a passphrase to lock your vault key on this device.'), { code: 'PASSPHRASE_NEEDED', migrate: true });
      const o = JSON.parse(legacy); seed = C.unhex(o.seed, 32); mode = 'random'; needsBackup = !o.backedUp;
      box = await passBox({ seed: o.seed }, passphrase);
      put(VRANDOM(wallet), JSON.stringify({ box, backedUp: !!o.backedUp, at: o.at })); del(VLEGACY(wallet));
    } else if (pendingRandom.has(wallet)) {
      if (!passphrase || passphrase.length < 10) throw Object.assign(Error('Choose a passphrase of at least 10 characters to lock your vault key.'), { code: 'PASSPHRASE_NEEDED', nonDeterministic: true });
      seed = pendingRandom.get(wallet); pendingRandom.delete(wallet); mode = 'random'; needsBackup = true;
      box = await passBox({ seed: C.hex(seed) }, passphrase);
      put(VRANDOM(wallet), JSON.stringify({ box, backedUp: false, at: new Date().toISOString() }));
    } else {
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
        const same = C.eq(again, seed);
        sig2.fill(0); again.fill(0);
        if (!same) {
          // a signer that is not deterministic (some MPC and smart wallets): a random vault key, locked by a passphrase
          // and backed up before any shield
          seed.fill(0);
          const fresh = crypto.getRandomValues(new Uint8Array(32));
          if (!passphrase || passphrase.length < 10) { pendingRandom.set(wallet, fresh); sig.fill(0); status('vault', { phase: 'needs-passphrase' }); throw Object.assign(Error('Your wallet does not sign the same way twice, so your vault key will be random. Choose a passphrase of at least 10 characters to lock it.'), { code: 'PASSPHRASE_NEEDED', nonDeterministic: true }); }
          seed = fresh; mode = 'random'; needsBackup = true;
          box = await passBox({ seed: C.hex(seed) }, passphrase);
          put(VRANDOM(wallet), JSON.stringify({ box, backedUp: false, at: new Date().toISOString() }));
          status('vault', { phase: 'random' });
        } else put(VCHECK(wallet), check);
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
      ctlSeed: await C.sha256(C.utf8('pof:ctl:v1'), seed), box };
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
  /* The fewest notes of one asset that reach a tier and are old enough (the minimum note age keeps a certificate from being
     paired with the shield that just happened). Not ready yet: readyAtSlot is the first slot at which some set qualifies, and
     waitSlots counts down to it. Not enough at all: short is what is missing, in base units. */
  async function minAge() {
    if (cfg.minAgeFromVerifier !== false && cfg.network !== 'local' && !cfg.minAgeFixed) { try { const f = await facts(); if (Number.isFinite(f.minAgeSlots)) cfg.minAgeSlots = BigInt(f.minAgeSlots); } catch {} cfg.minAgeFixed = true; }
    return cfg.minAgeSlots;
  }
  async function choose({ asset, tier, from = 'vault', list }) {
    list ||= await notes({ from });
    const min = C.tierMinimum(asset, tier);
    const [now, age] = [await chainSlot(), await minAge()];
    const mint = cfg.mints[asset];
    const mine = list.filter(n => n.asset === mint);
    const slotOf = n => (n.slot === null || n.slot === undefined ? 0n : BigInt(n.slot));
    const base = { asset, tier, minimum: min, nowSlot: now, minAgeSlots: Number(age), total: mine.reduce((a, n) => a + BigInt(n.amount), 0n) };
    const pick = C.pickNotes(mine.filter(n => slotOf(n) + age <= now), min);
    if (pick) return { ready: true, ...base, ...pick };
    const slots = [...new Set(mine.map(slotOf))].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    for (const at of slots) {
      const later = C.pickNotes(mine.filter(n => slotOf(n) <= at), min);
      if (later) { const readyAtSlot = at + age; return { ready: false, ...base, ...later, readyAtSlot, waitSlots: Number(readyAtSlot - now) }; }
    }
    return { ready: false, ...base, notes: [], short: min > base.total ? min - base.total : 0n, needsNotes: min <= base.total };
  }

  /* waits, with a countdown, until the vault's notes are old enough for the tier: status('age', { waitSlots, readyAtSlot })
     every tick; resolves with the ready pick. `signal` (AbortSignal) stops it. */
  async function waitForAge({ asset, tier, from = 'vault', signal, tickMs = 2000 } = {}) {
    let list = await notes({ from });
    for (;;) {
      if (signal?.aborted) throw Object.assign(Error('stopped'), { code: 'ABORTED', silent: true });
      const p = await choose({ asset, tier, from, list });
      if (p.ready) { status('age', { phase: 'ready', waitSlots: 0 }); return p; }
      if (p.waitSlots === undefined) throw Object.assign(Error('not enough in the vault for that tier'), { code: 'BELOW_TIER', pick: p });
      status('age', { phase: 'waiting', waitSlots: p.waitSlots, readyAtSlot: String(p.readyAtSlot) });
      await new Promise(r => setTimeout(r, Math.min(tickMs, Math.max(400, p.waitSlots * 400))));
      if (p.waitSlots > 50) list = await notes({ from });
    }
  }

  /* a random wait of [min, max] slots before certify, so the attestation's slot says less about when the holder acted */
  async function randomDelay([lo, hi] = [0, 0], signal) {
    const span = Math.max(0, hi - lo), pickN = lo + (span ? crypto.getRandomValues(new Uint32Array(1))[0] % (span + 1) : 0);
    if (!pickN) return 0;
    const start = await chainSlot(), until = start + BigInt(pickN);
    for (;;) {
      if (signal?.aborted) throw Object.assign(Error('stopped'), { code: 'ABORTED', silent: true });
      const now = await chainSlot();
      if (now >= until) { status('delay', { phase: 'done', slots: pickN }); return pickN; }
      status('delay', { phase: 'waiting', remainingSlots: Number(until - now), totalSlots: pickN });
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  /* What this certificate would reveal, as structured states for the page: level 'block' (the client refuses), 'warn'
     (the holder must accept it), 'info' (shown, nothing to accept). Audit POF-12 and RINGS §7. */
  async function privacy({ subjectKind = 0, relay, allowWalletPayer = false, from = 'vault', pick } = {}) {
    const out = [];
    const useRelay = relay ?? subjectKind !== 0;
    const relayer = subjectKind !== 0 ? await relayerAddress() : null;
    if (pick && !pick.ready && pick.waitSlots !== undefined) out.push({ code: 'NOTE_TOO_NEW', level: 'block', waitSlots: pick.waitSlots, readyAtSlot: String(pick.readyAtSlot), text: `The newest note you need is too fresh: ${pick.waitSlots} more slots (about ${Math.max(1, Math.round(pick.waitSlots * 0.4))} s).` });
    if (pick && pick.ready) {
      const newest = pick.notes.reduce((m, n) => (n.slot != null && BigInt(n.slot) > m ? BigInt(n.slot) : m), 0n);
      const age = newest ? Number(pick.nowSlot - newest) : null;
      if (age !== null && age < Math.max(10 * pick.minAgeSlots, 1500)) out.push({ code: 'RECENT_SHIELD', level: 'warn', ageSlots: age, text: 'You shielded recently. Waiting longer, or a random delay before certifying, makes the certificate harder to pair with the shield.' });
    }
    if (subjectKind !== 0 && (!useRelay || !relayer)) out.push({ code: 'WALLET_PAYER', level: allowWalletPayer ? 'warn' : 'block', text: useRelay ? 'The relayer is off: paying from your wallet would link it to this subject in public.' : 'Paying from your wallet links it to this subject in public.' });
    if (subjectKind !== 0 && useRelay && relayer && vault) {
      const left = await credits.count().catch(() => 0);
      if (!left) out.push({ code: 'NO_CREDIT', level: 'warn', text: 'No prepaid relay credit: paying the relayer now puts a payment from your vault right next to the certificate in time. Buy credits earlier to avoid that.' });
    }
    if (subjectKind === 0) out.push({ code: 'SUBJECT_IS_WALLET', level: 'info', text: 'The certificate names this wallet. Anyone can read that this wallet controls funds of this tier.' });
    if (from === 'ring') out.push({ code: 'RING_KEY_SHARED', level: 'warn', text: "Certifying from your wallet's own Ring gives the Verifier that Ring's nullifier key: it could see when your deposits into it are spent. The POF vault keeps this separate." });
    out.push({ code: 'SHIELD_IS_PUBLIC', level: 'info', text: 'A shield from your wallet is a public deposit that names the vault; the vault separates keys, not identity.' });
    out.push({ code: 'REVOKE_FIRST', level: 'info', text: 'To move the money without linking the certificate to the spend, revoke the certificate first.' });
    return { ok: !out.some(w => w.level === 'block'), needsConsent: out.some(w => w.level === 'warn'), warnings: out };
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
      const ctlKey = await xController(id, h);
      const controller = C.b58encode(ctlKey.publicKey().ed25519());
      const msg = C.disclosureMessage({ ...base, value: h, controller });
      // the controller key signs too (audit POF-26): a bound link id alone no longer certifies
      return { kind, value: h, proof: linkId, slot: at, controller, controllerProof: C.hex(ctlKey.sign(msg)), ringProof: await ringSign(id, msg) };
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
  /* Kits are kept encrypted at rest (audit2 info): the whole list of a vault or Ring is one AES-GCM box under its kit key
     (from the vault seed or the Ring's derivation signature, never from nk), so the device's storage shows no salt,
     nullifier, handle or vault. Kits stored in clear by older builds (pof:kits:v1) are moved into the box on first open. */
  const KITS_LEGACY = 'pof:kits:v1';
  const KITS = owner => 'pof:kits:v2:' + owner;
  async function readKits(from = 'vault') {
    const id = who(from);
    let list = [];
    const raw = get(KITS(id.owner));
    if (raw) list = await unseal(JSON.parse(raw), id.kitKey);
    const legacyRaw = get(KITS_LEGACY);
    if (legacyRaw) {
      let legacy = []; try { legacy = JSON.parse(legacyRaw); } catch {}
      const mine = legacy.filter(k => k.ringOwner === id.owner), rest = legacy.filter(k => k.ringOwner !== id.owner);
      if (mine.length) {
        for (const k of mine) if (!list.some(x => x.attestation === k.attestation)) list.push(k);
        await writeKits(list, from);
        if (rest.length) put(KITS_LEGACY, JSON.stringify(rest)); else del(KITS_LEGACY);
      }
    }
    return list;
  }
  async function writeKits(list, from = 'vault') { const id = who(from); put(KITS(id.owner), JSON.stringify(await seal(list, id.kitKey))); }
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
    const all = (await readKits(from)).filter(k => k.attestation !== kit.attestation);
    all.push(kit); await writeKits(all, from);
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
    list: (from = 'vault') => readKits(from),
    /* the export file: the kits sealed under this vault's kit key (only this vault opens it again), and, when this device
       holds a random vault key, that key's passphrase box. { plain: true } writes the kits in clear instead, for a holder
       who wants anyone holding the file to be able to revoke on a spend; it shows the handle and the vault together. */
    async export({ from = 'vault', plain = false } = {}) {
      const id = who(from);
      const list = await readKits(from);
      const out = plain ? { kind: 'pof-kits', v: 1, kits: list } : { kind: 'pof-kits', v: 2, owner: id.owner, box: await seal(list, id.kitKey) };
      if (vault && vault.mode === 'random') out.vaultBackup = { wallet: vault.wallet, owner: vault.owner, box: vault.box };
      return JSON.stringify(out, null, 1);
    },
    async import(text, { passphrase, from = 'vault' } = {}) {
      const j = typeof text === 'string' ? JSON.parse(text) : text;
      if (j.vaultBackup && passphrase) {
        await passOpen(j.vaultBackup.box, passphrase);   // proves the passphrase before the box is kept
        put(VRANDOM(j.vaultBackup.wallet), JSON.stringify({ box: j.vaultBackup.box, backedUp: true, at: new Date().toISOString() }));
      }
      const id = from === 'ring' ? ring : vault;
      if (!id) return 0;   // a backup-only import before the vault is open: the kits come in on the next import
      let incoming = [];
      if (j.kind === 'pof-kits' && j.v === 2) {
        if (j.owner !== id.owner) throw Object.assign(Error('These kits belong to another vault.'), { code: 'OTHER_VAULT' });
        incoming = await unseal(j.box, id.kitKey);
      } else incoming = j.kind === 'pof-kits' ? j.kits : [j];
      const add = incoming.filter(k => k && k.v === 1 && /^[0-9a-f]{480}$/.test(k.attestation));
      const all = await readKits(from); for (const k of add) if (!all.some(x => x.attestation === k.attestation)) all.push(k);
      await writeKits(all, from);
      return add.length;
    },
    /* open a kit; a kit sealed under the old nk-derived key (before audit POF-10) is re-sealed under the vault-seed key */
    async open(kit, from = 'vault') {
      const id = who(from);
      try { return await unseal(kit.sealed, id.kitKey); }
      catch {
        const o = await unseal(kit.sealed, id.kitKeyLegacy);
        const all = await readKits(from); const k = all.find(x => x.attestation === kit.attestation);
        if (k) { k.sealed = await seal(o, id.kitKey); await writeKits(all, from); }
        return o;
      }
    },
    async download({ from = 'vault', plain = false, filename = `pof-kits-${new Date().toISOString().slice(0, 10)}.json` } = {}) {
      const text = await kits.export({ from, plain });
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      if (vault && vault.mode === 'random') { vault.needsBackup = false; put(VRANDOM(vault.wallet), JSON.stringify({ box: vault.box, backedUp: true, at: new Date().toISOString() })); }
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
  /* one spend from the vault through the attested prover: a withdrawal to a public address, or a private transfer to a
     registered Rings address (amount and recipient hidden by the proof). The vault key signs in the page and pays the fee. */
  async function spendFromVault(kind, { asset = 0, amount, to }) {
    if (!cfg.prover || !cfg.indexer) throw Error('spending needs the Rings indexer and prover');
    const id = who('vault');
    const X = await import('./dist/spr-spend.js');
    const abs = u => new URL(u, typeof location !== 'undefined' ? location.href : 'http://localhost/').href;
    const client = new X.SprClient({ solanaRpcUrl: abs(Array.isArray(cfg.rpc) ? cfg.rpc[0] : cfg.rpc), indexerUrl: abs(cfg.indexer), proverUrl: abs(cfg.prover), proverTee: X.SignedTeePolicy.forNetwork(net), allowInsecureHttp: true });
    const keys = X.LocalKeys.fromKeypair(id.kp, client.proofService);
    const wallet = id.syncWallet || (id.syncWallet = new S.Wallet({ identity: id.kp.shieldedAddress() }));
    await S.syncWallet({ client, wallet, keys });
    const a = C.ASSETS[asset];
    const amt = typeof amount === 'bigint' ? amount : C.parseUnits(amount, a.decimals);
    status(kind, { phase: 'prove' });
    const build = kind === 'transfer' ? X.buildTransferTransaction : X.buildWithdrawalTransaction;
    const tx = await build({ client, wallet, keys, feePayer: id.owner, recipient: to, amount: amt, ...(asset === 0 ? {} : { asset: cfg.mints[asset] }) });
    const signatures = { ...tx.signatures, [id.owner]: id.signing.sign(new Uint8Array(tx.messageBytes)) };
    const wire = X.getBase64EncodedWireTransaction({ ...tx, signatures });
    const signature = await rpc('sendTransaction', [wire, { encoding: 'base64', preflightCommitment: 'confirmed' }]);
    status(kind, { phase: 'sent', signature });
    for (let i = 0; i < 90; i++) {
      const st = (await rpc('getSignatureStatuses', [[signature]])).value[0];
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) { if (st.err) throw Error(`the ${kind} failed on chain: ` + JSON.stringify(st.err)); status(kind, { phase: 'done', signature }); return { signature, slot: BigInt(st.slot) }; }
      await new Promise(r => setTimeout(r, 1000));
    }
    throw Error(`the ${kind} was not confirmed in time`);
  }
  async function withdraw({ asset = 0, amount, to, from = 'vault' }) {
    if (from !== 'vault') throw Error("withdraw signs with the vault key in this page; the wallet's own Ring withdraws in the wallet");
    return spendFromVault('withdraw', { asset, amount, to: to || W.state().address });
  }

  /* ---------------------------------------------------------------- relay credits (audit POF-12): blind tokens
     The relayer is paid ahead of time, in a fixed bundle, by a PRIVATE transfer from the vault to its house ring (amount and
     recipient hidden by the proof). For each credit the client makes a random token and blinds it (blind RSA-FDH,
     dist/blind.mjs = verifier/lib/blind.mjs); the relayer signs the blinded values without seeing the tokens; the client
     unblinds. A spent credit { kid, token, signature } therefore cannot be tied, even by the relayer, to the purchase that
     paid for it. The claim is signed by the vault key that signed the transfer (claim message v2), so nobody who only sees
     the transaction can claim it. Tokens, blinding factors and signatures live only in the sealed store of this vault. */
  const CREDITS = () => 'pof:credits:v2:' + who('vault').owner;
  const blindLib = () => import('./dist/blind.mjs');
  /* audit CR-01: the credit key and the house ring are pinned in this build (dist/pins.js, from the Verifier's
     verifier/lib/credit-pins.json), never taken from the live offer, so a relayer cannot hand one buyer a key of their own
     and recognise them at spend. Only the local lab may pass its own pins (opts.creditPins). */
  const pinned = () => {
    const p = net === 'local' && opts.creditPins ? opts.creditPins : CREDIT_PINS[net];
    if (!p) throw Object.assign(Error(`this build has no pinned relay credit key for ${net}`), { code: 'NO_CREDIT_PIN' });
    if (String(p.e).replace(/^0+/, '') !== '10001') throw Object.assign(Error('a pinned credit key must use e = 65537'), { code: 'BAD_CREDIT_PIN' });
    return p;
  };
  async function fingerprintOf(p) { const d = C.hex(await C.sha256(C.utf8(`pof:credit-key:v1\n${p.kid}\n${String(p.n).toLowerCase()}\n${p.e}\n${p.houseRing}`))); return d.slice(0, 32).match(/.{4}/g).join(' '); }
  async function checkedOffer() {
    const o = await jsonCall(relayUrl('credits'));
    const p = pinned();
    const same = o.key && o.key.kid === p.kid && String(o.key.n).toLowerCase().replace(/^0+/, '') === String(p.n).toLowerCase().replace(/^0+/, '') && String(o.key.e).replace(/^0+/, '') === '10001' && o.houseRing === p.houseRing;
    if (!same) throw Object.assign(Error('The relayer offered a credit key or house ring that this build does not trust. Nothing was paid.'), { code: 'CREDIT_KEY_MISMATCH' });
    return { ...o, key: { kid: p.kid, n: p.n, e: p.e }, houseRing: p.houseRing, fingerprint: await fingerprintOf(p) };
  }
  const claimMessage = async ({ signature, owner, kid, blinded }) => C.utf8(['Proof of Funds: relay credits v2', `transfer: ${signature}`, `owner: ${owner}`, `kid: ${kid}`, `blinded: ${C.hex(await C.sha256(C.utf8(blinded.join(''))))}`].join('\n'));
  async function readCredits() { const raw = get(CREDITS()); if (!raw) return { tokens: [], pending: [] }; try { return await unseal(JSON.parse(raw), who('vault').kitKey); } catch { return { tokens: [], pending: [] }; } }
  async function writeCredits(v) { put(CREDITS(), JSON.stringify(await seal(v, who('vault').kitKey))); }
  const credits = {
    offer: () => checkedOffer(),
    fingerprint: async () => fingerprintOf(pinned()),
    async count() { return (await readCredits()).tokens.filter(t => !t.used).length; },
    /* step 1: blind fresh tokens for a bundle, kept sealed before any money moves */
    async prepare({ count, offer }) {
      const o = await credits.offer(); void offer;
      const n = Number(count);
      if (!o.bundles?.includes(n)) throw Object.assign(Error(`credits come in bundles of ${(o.bundles || []).join(' or ')}`), { code: 'BAD_BUNDLE' });
      const B = await blindLib();
      const items = [];
      for (let i = 0; i < n; i++) { const token = C.hex(crypto.getRandomValues(new Uint8Array(32))); const { blinded, r } = await B.blind(o.key, token); items.push({ token, blinded, r }); }
      const pend = { id: C.hex(crypto.getRandomValues(new Uint8Array(8))), key: o.key, unitLamports: String(o.unitLamports), houseRing: o.houseRing, items, signature: null };
      const st = await readCredits(); st.pending.push(pend); await writeCredits(st);
      return pend;
    },
    /* step 3: claim a paid bundle, unblind, check every signature before keeping it */
    async claim({ id, signature }) {
      const st = await readCredits();
      const pend = st.pending.find(p => p.id === id);
      if (!pend) throw Object.assign(Error('no prepared bundle with that id'), { code: 'NO_BUNDLE' });
      if (signature) { pend.signature = signature; await writeCredits(st); }
      const owner = who('vault').owner;
      const blinded = pend.items.map(x => x.blinded);
      const proof = C.hex(who('vault').signing.sign(await claimMessage({ signature: pend.signature, owner, kid: pend.key.kid, blinded })));
      const r = await jsonCall(relayUrl('credits'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signature: pend.signature, owner, blinded, proof }) });
      const B = await blindLib();
      const tokens = [];
      for (const [i, x] of pend.items.entries()) {
        const sig = B.unblind(pend.key, r.signatures[i], x.r);
        if (!(await B.verifyCredit(pend.key, x.token, sig))) throw Object.assign(Error('the relayer returned a signature that does not verify'), { code: 'BAD_CREDIT' });
        if (r.kid && r.kid !== pend.key.kid) throw Object.assign(Error('the relayer signed with another key than the pinned one'), { code: 'CREDIT_KEY_MISMATCH' });
        tokens.push({ kid: pend.key.kid, token: x.token, signature: sig });
      }
      const now = await readCredits();
      now.pending = now.pending.filter(p => p.id !== id); now.tokens.push(...tokens); await writeCredits(now);
      status('credits', { phase: 'claimed', count: tokens.length });
      return { count: tokens.length };
    },
    /* the whole purchase: prepare, pay by private transfer, claim (retried while the house ring indexes the transfer) */
    async buy({ count }) {
      const pend = await credits.prepare({ count });
      const sent = await spendFromVault('transfer', { asset: 0, amount: BigInt(pend.unitLamports) * BigInt(pend.items.length), to: pend.houseRing });
      for (let i = 0; ; i++) {
        try { return await credits.claim({ id: pend.id, signature: sent.signature }); }
        catch (e) { if (e.code !== 'NOT_RECEIVED' || i >= 20) throw e; await new Promise(r => setTimeout(r, 3000)); }
      }
    },
    /* bundles paid but not claimed (a closed tab, an indexer delay): claim them again */
    async resume() { const st = await readCredits(); const out = []; for (const p of st.pending.filter(x => x.signature)) out.push(await credits.claim({ id: p.id }).catch(e => ({ id: p.id, code: e.code }))); return out; },
    async take() {
      const st = await readCredits();
      const t = st.tokens.find(x => !x.used);
      if (!t) return null;
      t.used = 'reserved'; await writeCredits(st);
      return { credit: { kid: t.kid, token: t.token, signature: t.signature }, done: async ok => { const s2 = await readCredits(); const x = s2.tokens.find(y => y.token === t.token); if (x) { if (ok) x.used = true; else delete x.used; } await writeCredits(s2); } };
    },
    claimMessage,
  };

  /* ---------------------------------------------------------------- the relayed revoke (X and badge certificates)
     The controller signs the 148 POF-REVOKE1 bytes (CONTRACT, verifier contract.ts revokeBytes) and the relayer submits
     [ed25519(controller, bytes), revoke_signed()], so no wallet pays and no wallet appears. */
  /* 156 bytes since program 74654cb (audit RV-01 / audit2 A2-01): ... ‖ issued_slot u64 LE ‖ valid_until u64 LE, the last
     slot the signature may be used at. Default: the current slot + 1500 (about ten minutes); where the chain cannot be read
     and none is given, the certificate's own expiry slot (the signature dies with the certificate either way). */
  async function revokeBytesOf(kit, { validUntil } = {}) {
    const att = C.unhex(kit.attestation, 240);
    const { PublicKey } = await import('./dist/web3.js');
    const programId = new PublicKey(kit.programId || cfg.programId);
    const subjectHash = att.slice(37, 69), asset = att[69], nullset = att.slice(112, 144), issued = att.slice(144, 152);
    let vu = validUntil;
    if (vu === undefined) { try { vu = (await chainSlot()) + 1500n; } catch { vu = new DataView(att.buffer, att.byteOffset).getBigUint64(152, true); } }
    const vuBytes = new Uint8Array(8); new DataView(vuBytes.buffer).setBigUint64(0, BigInt(vu), true);
    const [cert] = PublicKey.findProgramAddressSync([C.utf8('cert'), subjectHash, Uint8Array.of(asset)], programId);
    const out = new Uint8Array(156); let o = 0;
    for (const part of [C.utf8('POF-REVOKE1'), programId.toBytes(), cert.toBytes(), subjectHash, Uint8Array.of(asset), nullset, issued, vuBytes]) { out.set(part, o); o += part.length; }
    return { bytes: out, certificate: cert.toBase58(), subjectHash: C.hex(subjectHash), asset, validUntil: BigInt(vu) };
  }
  async function revokeRelayed(kit, from = 'vault') {
    if (kit.subject.kind === 0) throw Object.assign(Error('a wallet certificate is revoked by the wallet itself (revoke_by_holder)'), { code: 'RELAY_NOT_FOR_WALLETS' });
    const ctl = await controllerOf(kit, from);
    const validUntil = (await chainSlot()) + 1500n;
    const r = await revokeBytesOf(kit, { validUntil });
    const sigBytes = await ctl.sign(r.bytes);
    if (ctl.verify && !ctl.verify(r.bytes, sigBytes)) throw Object.assign(Error('the controller signature did not verify'), { code: 'BAD_SIGNATURE' });
    const signature = C.hex(sigBytes);
    status('revoke', { phase: 'send', certificate: r.certificate });
    const ans = await jsonCall(relayUrl('revoke'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subjectHash: r.subjectHash, asset: r.asset, validUntil: String(validUntil), signature }) });
    status('revoke', { phase: 'done', signature: ans.signature });
    return ans;
  }
  /* the controller key of a kit, as a signer ({ publicKey, sign(message) }) for revoke_by_holder and room joins: the
     wallet itself (kind 0, signs through the wallet), the badge key (kind 2, from the sealed kit), or the X key (kind 1) */
  async function controllerOf(kit, from = 'vault') {
    const id = who(from);
    if (kit.subject.kind === 0) return { publicKey: kit.subject.value, wallet: true };
    if (kit.subject.kind === 2) { const o = await kits.open(kit, from); const k = S.SigningKey.fromEd25519Bytes(C.unhex(o.badgeSecret, 32)); return { publicKey: kit.subject.value, sign: m => k.sign(new Uint8Array(m)), verify: (m, sg) => k.verify(new Uint8Array(m), sg) }; }
    const k = await xController(id, kit.subject.value);
    return { publicKey: C.b58encode(k.publicKey().ed25519()), sign: m => k.sign(new Uint8Array(m)), verify: (m, sg) => k.verify(new Uint8Array(m), sg) };
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
  /* paying a quote now (the fallback when there is no credit; audit2 A2-03): ONE transaction holding a SystemProgram
     transfer of exactly quote.lamports to quote.payTo and a Memo "pof:<reference>", so only the payment made for this quote
     pays it. From the vault's public SOL by default (signed by the vault key in the page; fundVault tops it up), or from
     the wallet with allowWalletPayer. */
  const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
  async function payRelay(quote, { allowWalletPayer }) {
    const lamports = BigInt(quote.lamports);
    if (lamports === 0n) return null;
    if (!quote.reference || quote.memo !== `pof:${quote.reference}`) throw Object.assign(Error('the relayer quote carries no payment reference'), { code: 'BAD_QUOTE' });
    const { SystemProgram, PublicKey, Transaction, TransactionInstruction, Buffer } = await import('./dist/web3.js');
    const memo = new TransactionInstruction({ programId: new PublicKey(MEMO), keys: [], data: Buffer.from(quote.memo, 'utf8') });
    if (allowWalletPayer) {
      status('relay', { phase: 'pay', from: 'wallet', lamports: quote.lamports });
      const r = await W.send([SystemProgram.transfer({ fromPubkey: new PublicKey(W.state().address), toPubkey: new PublicKey(quote.payTo), lamports: Number(lamports) }), memo]);
      await r.wait(); return r.signature;
    }
    const id = who('vault');
    const have = BigInt((await rpc('getBalance', [id.owner, { commitment: 'confirmed' }])).value);
    if (have < lamports + 10_000n) throw Object.assign(Error(`The vault needs ${C.formatUnits(lamports + 10_000n - have, 9)} SOL more to pay the relayer now (fundVault), or use a relay credit.`), { code: 'VAULT_NEEDS_SOL', missingLamports: String(lamports + 10_000n - have) });
    status('relay', { phase: 'pay', from: 'vault', lamports: quote.lamports });
    const { blockhash, lastValidBlockHeight } = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
    const tx = new Transaction({ feePayer: new PublicKey(id.owner), blockhash, lastValidBlockHeight });
    tx.add(SystemProgram.transfer({ fromPubkey: new PublicKey(id.owner), toPubkey: new PublicKey(quote.payTo), lamports: Number(lamports) }), memo);
    tx.addSignature(new PublicKey(id.owner), Buffer.from(id.signing.sign(new Uint8Array(tx.serializeMessage()))));
    const raw = tx.serialize();
    const signature = await rpc('sendTransaction', [Buffer.from(raw).toString('base64'), { encoding: 'base64', preflightCommitment: 'confirmed' }]);
    for (let i = 0; i < 60; i++) {
      const st = (await rpc('getSignatureStatuses', [[signature]])).value[0];
      if (st && st.confirmationStatus) { if (st.err) throw Error('the relay payment failed: ' + JSON.stringify(st.err)); return signature; }
      await new Promise(r => setTimeout(r, 800));
    }
    throw Error('the relay payment was not confirmed in time');
  }
  /* the arguments for a holder-submitted certify (wallet subjects): the Verifier publishes only landed attestations
     (audit2 A2-06), so attest answers logIndex null and the holder passes log_index = u64::MAX; the keeper publishes it
     after its scan */
  const U64_MAX = (1n << 64n) - 1n;
  function holderCertifyArgs(answer) {
    return { attestation: C.unhex(answer.attestation, 240), signature: C.unhex(answer.signature, 64), verifierKey: answer.verifierKey, hashes: (answer.hashes || []).map(h => C.unhex(h, 32)), logIndex: answer.logIndex == null ? U64_MAX : BigInt(answer.logIndex) };
  }
  async function certify({ asset, tier, subjectKind = 0, handle, linkId, payer, relay, allowWalletPayer = false, payNow = false, from = 'vault', delaySlots, signal }) {
    await randomDelay(delaySlots ?? cfg.defaultDelaySlots, signal);
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
    // a prepaid credit first (nothing is paid at certify time); paying now is the fallback, and it links by timing
    const credit = viaRelay ? await credits.take() : null;
    if (viaRelay && !credit && !payNow) throw Object.assign(Error('No relay credit left. Buy credits ahead of time (a private transfer from the vault), or pay now and accept that the payment sits next to the certificate in time.'), { code: 'CREDITS_NEEDED' });
    const quote = viaRelay && !credit ? await jsonCall(relayUrl('quote')) : null;
    const subj = await subject({ kind: subjectKind, value: handle, asset, tier, payer: pay, from, linkId });
    const pkg = disclose({ subject: subj, asset, tier, notes: pick.notes, payer: pay, relay: viaRelay, from });
    const answer = await attest(pkg, { from, subject: subj });
    if (!viaRelay) return answer;   // the holder submits certify from the wallet (the program's IDL; the /get page does it)
    const payment = credit ? null : await payRelay(quote, { allowWalletPayer });
    for (let i = 0; i < 20; i++) {
      try {
        const done = await jsonCall(relayUrl('certify'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attestation: answer.attestation, signature: answer.signature, logIndex: answer.logIndex, hashes: answer.hashes, ...(credit ? { credit: credit.credit } : { quote: quote.quote }) }) });
        if (credit) await credit.done(true);
        if (done.logIndex != null) { const all = await readKits(from); const k = all.find(x => x.attestation === answer.attestation); if (k) { k.logIndex = done.logIndex; await writeKits(all, from); } }
        status('relay', { phase: 'done', signature: done.signature });
        return { ...answer, relayed: done, payment };
      } catch (e) { if (e.code !== 'NOT_PAID' || i === 19) { if (credit) await credit.done(e.code === 'CREDIT_USED' || e.code === 'BAD_CREDIT' || e.code === 'OLD_CREDIT_KEY'); throw e; } await new Promise(r => setTimeout(r, 1500)); }
    }
  }


  return {
    config: cfg, onStatus: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    ready: () => C.ready(), hasher: S.hasherState,
    connect: id => W.connect(id), wallet: () => W.state(),
    deriveVault, deriveRing, isRegistered, register, shield, notes, balance, choose, subject, disclose, attest, certify, kits, controllerOf, vaultSigner: () => vaultSigner(), fundVault, withdraw, linkStart, linkCheck, waitForAge, randomDelay, privacy, credits, revokeRelayed, revokeBytesOf, holderCertifyArgs,
    progress: () => ({ hasher: S.hasherState(), last: lastStatus }),
    local, identity: from => { const id = from === 'ring' ? ring : vault; return id ? { kind: id.kind, owner: id.owner, ownerHash: C.hex(id.ownerHash) } : null; },
    forget() { for (const id of [vault, ring]) if (id) { id.nk.fill(0); id.kitKey.fill(0); id.ctlSeed.fill(0); } vault = ring = null; },
  };
}
export { C as core };
