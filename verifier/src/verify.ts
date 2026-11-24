/* The Verifier (CONTRACT §4 in, §3 out). It recomputes every disclosed note's commitment with the Helius SDK's own hasher,
   proves each is in the Rings tree (the path is re-hashed here and its root must be in the tree account's on-chain root
   history), derives every nullifier from the disclosed nullifier key and checks none is spent, checks each note's age and that
   the sum reaches the tier, then signs. It keeps no amounts: the answer, the log entry and the keeper's sealed kit carry none,
   and nothing in the package is logged. */
import { PofError, compareBytes, equal, fromB58, hex, unhex, toB58 } from './codec.js';
import {
  ASSETS, SUBJECT, encodeAttestation, linkTokenBytes, normalHandle, nullsetHash, saltedNullifier, sortHashes, subjectHash,
  disclosureMessage, tierMinimum, logLeaf,
} from './contract.js';
import { verifySig, type Signer } from './keys.js';
import type { RingsSource } from './rings.js';
import type { TransparencyLog } from './log.js';
import type { Keeper } from './keeper.js';
import type { NoteLocks } from './locks.js';
import type { Escrow } from './escrow.js';
import crypto from 'node:crypto';

export interface VerifierConfig {
  programId: Uint8Array;
  minAgeSlots: bigint;          // a note must be at least this old (timing-leak guard, IDEAS §10)
  validitySlots: bigint;        // expiry = issued + validity; equals the program Config
  subjectProofSlots: bigint;    // a subject signature names a slot at most this old
  maxRootAgeSlots: bigint;      // the tree head read must be this fresh (always true for a live read; guards a stale source)
  maxRootLagSlots: bigint;      // issued_slot - root_slot the program accepts (Config max_root_lag)
  relayer: string | null;       // the relayer's address: payer when relay is true
  mints: Record<number, string>;// asset → mint (USDC differs on a local validator)
  bundleHash: Uint8Array;
  /** tests and the lab only: sign with note locks that cannot see the chain (they then bind until expiry) */
  allowNoChain?: boolean;
}

let sdk: any = null;
async function loadSdk() {
  if (sdk) return sdk;
  const root: any = await import('@heliuslabs/spr');
  await root.initializePoseidon();
  const internal: any = await import('@heliuslabs/spr/internal');
  const tx: any = await import('@heliuslabs/spr/transaction');
  sdk = { root, internal, tx, NullifierKey: root.NullifierKey };
  return sdk;
}

const field = (o: any, k: string) => { if (o == null || typeof o !== 'object') throw new PofError('BAD_PACKAGE', 'the disclosure package must be a JSON object'); return o[k]; };
function u64(v: unknown, name: string): bigint {
  if (typeof v !== 'string' && typeof v !== 'number') throw new PofError('BAD_PACKAGE', `${name} must be a decimal string`);
  const s = String(v);
  if (!/^\d{1,20}$/.test(s)) throw new PofError('BAD_PACKAGE', `${name} must be a decimal string`);
  const b = BigInt(s);
  if (b > 0xffffffffffffffffn) throw new PofError('BAD_PACKAGE', `${name} is larger than a u64`);
  return b;
}
function sigBytes(v: unknown, name: string): Uint8Array {
  if (typeof v === 'string' && /^[0-9a-fA-F]{128}$/.test(v)) return unhex(v, 64, name);
  return fromB58(v, 64, name);
}

export interface Disclosure {
  v: 1;
  subject: { kind: number; value: string; proof?: string; slot: string | number; controllerProof?: string };
  asset: number; tier: number;
  ring: { owner: string; nk: string; proof: string };
  notes: { tree: string; leafIndex: string; asset: string; amount: string; blinding: string; sig: string; dataHash?: string; ringDataHash?: string; ringProgramId?: string }[];
  payer: string; relay?: boolean;
  /** kind 1 only: the key the holder's client keeps to revoke the certificate and join rooms with it */
  controller?: string;
  /** a renew only: the salts of the live certificate (from the holder's kit), one per note in order */
  salts?: string[];
}

export interface AttestResult {
  attestation: string; signature: string; verifierKey: string; salts: string[]; nullifiers: string[]; hashes: string[];
  logIndex: number | null; attestationId: string; subjectHash: string; certificate: { seeds: string[] }; issuedSlot: number; expirySlot: number; bundleHash: string; controller: string;
}

export class Verifier {
  constructor(public cfg: VerifierConfig, private signer: Signer, private rings: RingsSource, private log: TransparencyLog, private keeper: Keeper | null, private locks: NoteLocks | null = null, private escrow: Escrow | null = null) {}

  get key() { return this.signer.address; }

  /** the X link id (kind 1 proof), signed by the same key: "handle, controller, until unix time" (CONTRACT §4) */
  linkToken(handle: string, expiresAt: number, controller?: string | null): string {
    const h = normalHandle(handle);
    const ctl = controller ? fromB58(controller, 32, 'controller') : new Uint8Array(32);
    const sig = this.signer.sign(linkTokenBytes(this.cfg.programId, h, ctl, expiresAt));
    return `${h}.${toB58(ctl)}.${expiresAt}.${hex(sig)}`;
  }
  /** checks a link id; returns its controller (null when unbound). With `controller`, the id must be bound to exactly it. */
  checkLinkToken(handle: string, token: unknown, controller?: string): string | null {
    if (typeof token !== 'string') throw new PofError('BAD_SUBJECT_PROOF', 'an X subject needs the link id from /api/link/check');
    const [h, ctl, exp, sig] = token.split('.');
    const n = normalHandle(handle);
    if (h !== n || !ctl || !/^\d+$/.test(exp || '') || !/^[0-9a-f]{128}$/.test(sig || '')) throw new PofError('BAD_SUBJECT_PROOF', 'that link id is not for this handle');
    const ctlBytes = fromB58(ctl, 32, 'link controller');
    if (!verifySig(unhex(sig, 64), linkTokenBytes(this.cfg.programId, n, ctlBytes, Number(exp)), this.signer.publicKey)) throw new PofError('BAD_SUBJECT_PROOF', 'that link id was not issued by this Verifier');
    if (Number(exp) < Date.now() / 1000) throw new PofError('LINK_EXPIRED', 'the handle link expired: post a fresh code and link again');
    const bound = ctlBytes.some(x => x !== 0) ? ctl : null;
    if (controller !== undefined) {
      if (!bound) throw new PofError('LINK_UNBOUND', 'that link id is not bound to a controller key; link again with the controller from your client');
      if (bound !== controller) throw new PofError('LINK_OTHER_CONTROLLER', 'that link id was issued for another controller key');
    }
    return bound;
  }

  async attest(pkg: unknown): Promise<AttestResult> {
    const S = await loadSdk();
    if (field(pkg, 'v') !== 1) throw new PofError('BAD_VERSION', 'the disclosure package version must be 1');
    const p = pkg as Disclosure;
    const subj = field(p, 'subject');
    const kind = Number(field(subj, 'kind')), value = String(field(subj, 'value') ?? '');
    const asset = Number(p.asset), tier = Number(p.tier);
    const minimum = tierMinimum(asset, tier);
    const sHash = subjectHash(kind, value);
    const ring = field(p, 'ring');
    const owner = String(field(ring, 'owner') ?? '');
    const ownerBytes = fromB58(owner, 32, 'ring.owner');
    const payerBytes = fromB58(p.payer, 32, 'payer');
    let controller: Uint8Array;
    if (kind === SUBJECT.x) {
      controller = fromB58(p.controller, 32, 'controller');
      if (controller.every(x => x === 0)) throw new PofError('BAD_CONTROLLER', 'an X certificate needs a controller key (not the default key)');
    } else {
      if (p.controller !== undefined && p.controller !== value) throw new PofError('BAD_CONTROLLER', 'for a wallet or badge subject the controller is the subject key itself');
      controller = fromB58(value, 32, 'subject');
    }
    if (p.relay) {
      if (!this.cfg.relayer) throw new PofError('RELAY_OFF', 'the relayer is not configured; submit certify from your own wallet (relay: false)');
      if (p.payer !== this.cfg.relayer) throw new PofError('BAD_PAYER', `with relay: true the payer is the relayer ${this.cfg.relayer}`);
    }
    if (!Array.isArray(p.notes) || p.notes.length < 1 || p.notes.length > 8) throw new PofError('BAD_NOTES', 'disclose 1 to 8 notes');
    // one note, one live certificate needs the chain's view of certificates; without it nothing is signed (A2-02)
    if (this.locks && !this.locks.hasChain && !this.cfg.allowNoChain) throw new PofError('CHAIN_OFF', 'the Verifier cannot read the pof program here, so it signs nothing; try again later', 503);

    let slot = await this.rings.slot();

    /* the proofs: the ring owner signs the disclosure message (always); the subject key signs it too for a wallet or badge;
       an X subject shows a link id bound to the same controller (POF-02, POF-03) */
    const at = u64(subj.slot ?? field(p, 'slot'), 'subject.slot');
    if (at > slot + 50n || slot - at > this.cfg.subjectProofSlots) throw new PofError('SUBJECT_PROOF_STALE', `sign the disclosure message again with a slot from the last ${this.cfg.subjectProofSlots} slots`);
    const msg = disclosureMessage({ programId: toB58(this.cfg.programId), kind, value, ring: owner, controller: toB58(controller), asset, tier, payer: p.payer, slot: at });
    if (!verifySig(sigBytes(field(ring, 'proof'), 'ring.proof'), msg, ownerBytes)) throw new PofError('BAD_RING_PROOF', 'ring.proof must be the ring owner\'s signature over the disclosure message (CONTRACT §4)');
    if (kind === SUBJECT.wallet || kind === SUBJECT.badge) {
      const same = kind === SUBJECT.wallet && value === owner && (subj.proof === undefined || subj.proof === ring.proof);
      if (!same && (subj.proof == null || !verifySig(sigBytes(subj.proof, 'subject.proof'), msg, fromB58(value, 32, 'subject')))) throw new PofError('BAD_SUBJECT_PROOF', 'the subject signature does not match the disclosure message');
    } else if (kind === SUBJECT.x) {
      this.checkLinkToken(value, subj.proof, toB58(controller));
      // the controller signs too, so a leaked link id alone certifies nobody (POF-26)
      if (subj.controllerProof == null || !verifySig(sigBytes(subj.controllerProof, 'subject.controllerProof'), msg, controller)) throw new PofError('BAD_CONTROLLER_PROOF', 'subject.controllerProof must be the controller key\'s signature over the disclosure message');
    }

    /* the Ring's owner and the nullifier key */
    const npk = await this.rings.registryNullifierKey(owner);
    if (!npk) throw new PofError('NO_RING', 'that ring owner has no User Registry record (register the Ring first)');
    const nkBytes = unhex(ring.nk, 31, 'ring.nk');
    let nk: any;
    try {
      nk = S.NullifierKey.fromSecret(nkBytes);
      if (!equal(nk.publicKey(), npk)) throw new PofError('NULLIFIER_KEY_MISMATCH', 'the nullifier key does not belong to that Ring');
      const ownerField = S.internal.poseidon([S.internal.solanaOwnerIdentity(ownerBytes), npk]);

      /* the notes */
      const tree = String(p.notes[0].tree);
      fromB58(tree, 32, 'notes[0].tree');
      const head = await this.rings.treeHead(tree);
      if (slot > head.slot + this.cfg.maxRootAgeSlots) throw new PofError('STALE_ROOT', 'the tree read is too old; try again', 503);
      // the tree was read after the first slot read: issue at the later of the two, so root_slot <= issued_slot always holds
      // (a Rings write between the two reads otherwise looked like a root from the future)
      if (head.slot > slot) slot = head.slot;
      if (head.headSlot > slot || slot - head.headSlot > this.cfg.maxRootLagSlots) throw new PofError('ROOT_TOO_OLD', `the Rings tree has not changed for more than ${this.cfg.maxRootLagSlots} slots, which the program refuses; try again after the next Rings transaction`, 503);
      const mint = this.cfg.mints[asset];
      const notes = p.notes.map((n, i) => {
        if (n.tree !== tree) throw new PofError('MIXED_TREES', 'all disclosed notes must be in one tree');
        if (n.asset !== mint) throw new PofError('WRONG_ASSET', `notes[${i}] is not ${ASSETS[asset].name} (mint ${mint})`);
        const amount = u64(n.amount, `notes[${i}].amount`);
        if (amount === 0n) throw new PofError('BAD_NOTES', `notes[${i}] is empty`);
        const blinding = unhex(n.blinding, 32, `notes[${i}].blinding`);
        const input: any = { owner: ownerField, asset: mint, amount, blinding, treeId: head.treeId };
        if (n.dataHash) input.dataHash = unhex(n.dataHash, 32, `notes[${i}].dataHash`);
        if (n.ringDataHash) input.ringDataHash = unhex(n.ringDataHash, 32, `notes[${i}].ringDataHash`);
        if (n.ringProgramId) { fromB58(n.ringProgramId, 32, `notes[${i}].ringProgramId`); input.ringProgramId = n.ringProgramId; }
        let commitment: Uint8Array;
        try { commitment = S.tx.ownerUtxoHash(input); } catch (e: any) { throw new PofError('BAD_NOTES', `notes[${i}] does not form a commitment (${String(e?.code || e?.message).slice(0, 60)})`); }
        return { i, amount, blinding, commitment, leafIndex: u64(n.leafIndex, `notes[${i}].leafIndex`), sig: String(n.sig || '') };
      });
      const seen = new Set(notes.map(n => hex(n.commitment)));
      if (seen.size !== notes.length) throw new PofError('DUPLICATE_NOTES', 'a note is disclosed twice');

      /* membership: re-hash every path with the SDK's Poseidon; the root must be in the on-chain root history */
      const paths = await this.rings.merklePaths(tree, notes.map(n => n.commitment));
      const history = new Set(head.history.map(hex));
      notes.forEach((n, k) => {
        const pr = paths[k];
        if (!pr || !equal(pr.leaf, n.commitment)) throw new PofError('NOT_IN_TREE', `notes[${n.i}]: the commitment does not match the note in the tree (wrong amount, blinding or owner?)`);
        if (pr.leafIndex !== n.leafIndex) throw new PofError('NOT_IN_TREE', `notes[${n.i}] sits at another leaf index`);
        let h = n.commitment, idx = n.leafIndex;
        for (const sib of pr.path) { h = (idx & 1n) ? S.internal.poseidon([sib, h]) : S.internal.poseidon([h, sib]); idx >>= 1n; }
        if (pr.path.length !== 32 || !equal(h, pr.root) || !history.has(hex(h))) throw new PofError('NOT_IN_TREE', `notes[${n.i}]: the Merkle path does not reach a root the tree account holds`);
      });

      /* nullifiers: derived here, so a note cannot be certified under a nullifier it will never publish */
      const nullifiers = notes.map(n => nk.nullifier(n.commitment, n.blinding) as Uint8Array);
      const spent = await this.rings.spent(tree, nullifiers, { nullifierHistory: head.nullifierHistory });
      spent.forEach((s, k) => { if (s) throw new PofError('NOTE_SPENT', `notes[${notes[k].i}] is already spent`); });

      /* age */
      for (const n of notes) {
        if (!n.sig) throw new PofError('BAD_NOTES', `notes[${n.i}].sig (the transaction that created it) is missing`);
        const c = await this.rings.creation(n.sig, n.commitment);
        if (!c || c.tree !== tree || c.leafIndex !== n.leafIndex) throw new PofError('BAD_NOTES', `notes[${n.i}].sig did not create that note`);
        if (slot < c.slot + this.cfg.minAgeSlots) throw new PofError('NOTE_TOO_NEW', `notes[${n.i}] is too new: wait ${String(c.slot + this.cfg.minAgeSlots - slot)} more slots (this keeps a certificate from pointing at the shield that just happened)`, 400, { waitSlots: Number(c.slot + this.cfg.minAgeSlots - slot) });
      }

      /* the sum: compared, never returned */
      const sum = notes.reduce((a, n) => a + n.amount, 0n);
      if (sum < minimum) throw new PofError('BELOW_TIER', `the disclosed notes do not reach tier ${tier} (${ASSETS[asset].name}); add notes or pick a lower tier`);

      /* one note backs one live certificate: a keyed index of its nullifier (no amount), checked and then taken */
      if (this.locks) await this.locks.take(nullifiers, { subjectHash: hex(sHash), asset, issuedSlot: Number(slot), expirySlot: Number(slot + this.cfg.validitySlots) }, slot);

      /* salts, the nullset, the bytes */
      /* a renew reuses the certificate's salts (the holder's kit), so the salted hashes stay those the certificate stores */
      let salts: Uint8Array[];
      if (p.salts !== undefined) {
        if (!Array.isArray(p.salts) || p.salts.length !== notes.length) throw new PofError('BAD_SALTS', 'salts (for a renew) are one hex32 per note, in the notes\' order');
        salts = p.salts.map((x, i) => unhex(x, 32, `salts[${i}]`));
      } else salts = notes.map(() => new Uint8Array(crypto.randomBytes(32)));
      const hs = notes.map((_, k) => saltedNullifier(salts[k], nullifiers[k]));
      const sorted = sortHashes(hs);
      const att = encodeAttestation({
        programId: this.cfg.programId, subjectKind: kind, subjectHash: sHash, asset, tier, treeRoot: head.head, rootSlot: head.headSlot,
        noteCount: notes.length, nullsetHash: nullsetHash(sorted), issuedSlot: slot, expirySlot: slot + this.cfg.validitySlots,
        payer: payerBytes, controller, nonce: new Uint8Array(crypto.randomBytes(16)),
      });
      const sig = this.signer.sign(att);
      // held privately until the certificate lands (A2-06): an attestation that is never submitted never becomes public
      const attId = crypto.createHash('sha256').update(att).digest('hex');
      await this.log.hold(attId, logLeaf(att, sig, this.signer.publicKey, this.cfg.bundleHash, slot));
      const logIndex = null;
      const kit = { subjectHash: hex(sHash), asset, tree, expirySlot: Number(slot + this.cfg.validitySlots), attestation: hex(att), kit: notes.map((_, k) => ({ h: hex(hs[k]), salt: hex(salts[k]), nullifier: hex(nullifiers[k]) })) };
      if (this.keeper) await this.keeper.hold(kit);
      // the escrow is published by the keeper once the certificate lands (A2-06), not here
      return {
        attestation: hex(att), signature: hex(sig), verifierKey: this.signer.address,
        salts: salts.map(hex), nullifiers: nullifiers.map(hex), hashes: sorted.map(hex), logIndex, attestationId: attId,
        subjectHash: hex(sHash), certificate: { seeds: ['cert', hex(sHash), String(asset)] },
        issuedSlot: Number(slot), expirySlot: Number(slot + this.cfg.validitySlots), bundleHash: hex(this.cfg.bundleHash),
        controller: toB58(controller),
      };
    } finally {
      try { nk?.destroy(); } catch {}
      nkBytes.fill(0);
    }
  }
}
export { compareBytes };
