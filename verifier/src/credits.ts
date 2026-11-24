/* Prepaid relay credits (audit POF-12): the holder pays the relayer ahead of time, by a private transfer from the vault to
   the relayer's own Ring (the house ring), and later spends one credit per relayed certificate, so no payment sits next to
   a certify in time and no amount carries a tag. Credits are blind RSA signatures (lib/blind.mjs): the relayer signs them
   without seeing them, so a spent credit cannot be tied to the transfer that bought it.
     offer   GET  /api/relay/credits
     claim   POST /api/relay/credits { signature, owner, blinded: [hex], proof }   once per transfer
     spend   inside POST /api/relay/certify { …, credit: { kid, token, signature } }
   Stored: relay/credits/claim/<transfer signature> (which transfer was claimed, how many) and
   relay/credits/spent/<sha256(token)> (spent tokens). Nothing ties the two. */
import crypto from 'node:crypto';
import { PofError, fromB58, hex, text } from './codec.js';
import { verifySig } from './keys.js';
import type { Store } from './store.js';
// @ts-ignore: a plain ESM module shared with the browser client
import * as B from '../lib/blind.mjs';

export interface CreditKey { kid: string; n: string; e: string; d: string; jwk?: any }
export interface PublicCreditKey { kid: string; n: string; e: string; fingerprint?: string }
import PINS from '../lib/credit-pins.json';
/** the pinned credit key and house ring per network (audit CR-01): bundled, so the published bundle hash fixes them; the
 *  client builds the same file in (client/dist/pins.js), so a relayer cannot hand one buyer a key of its own */
export const creditPins: { v: number; networks: Record<string, { kid: string; n: string; e: string; houseRing: string; retired?: PublicCreditKey[]; fingerprint?: string }> } = PINS as any;
export function pinFor(network: string) {
  const p = creditPins.networks[network];
  if (!p) return null;
  return { houseRing: p.houseRing, current: { kid: p.kid, n: p.n, e: p.e }, retired: p.retired || [], fingerprint: fingerprint({ kid: p.kid, n: p.n, e: p.e, houseRing: p.houseRing }) };
}
/** the fingerprint the client shows: sha256("pof:credit-key:v1\n<kid>\n<n>\n<e>\n<houseRing>"), 32 hex in groups of 4 */
export const fingerprint = (k: { kid: string; n: string; e: string; houseRing: string }) =>
  crypto.createHash('sha256').update(`pof:credit-key:v1\n${k.kid}\n${String(k.n).toLowerCase()}\n${k.e}\n${k.houseRing}`).digest('hex').slice(0, 32).match(/.{4}/g)!.join(' ');
export const pinned = pinFor('mainnet');

/** e = 65537 and a modulus of at least 3,072 bits (CR-01) */
export function checkPublicKey(k: { n: string; e: string }) {
  if (BigInt('0x' + k.e) !== 65537n) throw new PofError('BAD_CREDIT_KEY', 'a credit key must have e = 65537', 500);
  if (BigInt('0x' + k.n).toString(2).length < 3072) throw new PofError('BAD_CREDIT_KEY', 'a credit key must be at least 3,072 bits', 500);
}
export interface HouseRing {
  /** the private SOL the house ring received in transaction `signature`, and that transaction's signers; null if none */
  received(signature: string): Promise<{ lamports: bigint; signers: string[] } | null>;
}

export const claimMessage = (m: { signature: string; owner: string; kid: string; blinded: string[] }) => text([
  'Proof of Funds: relay credits v2',
  `transfer: ${m.signature}`,
  `owner: ${m.owner}`,
  `kid: ${m.kid}`,
  `blinded: ${crypto.createHash('sha256').update(m.blinded.join('')).digest('hex')}`,
].join('\n'));

export function creditKeyFromJson(json: string): CreditKey {
  const k = JSON.parse(json);
  if (!k.n || !k.e || !k.d) throw new PofError('KEY_MISSING', 'the credit key is not an RSA key', 500);
  return { kid: k.kid || crypto.createHash('sha256').update(k.n).digest('hex').slice(0, 8), n: k.n, e: k.e, d: k.d, ...(k.jwk ? { jwk: k.jwk } : {}) };
}

/** RSA signing of a blinded value through OpenSSL (constant time, RSA blinding, CRT: audit CR-03) */
function rawSign(key: CreditKey, blindedHex: string): string {
  const k = Math.ceil(key.n.length / 2);
  if (!/^[0-9a-f]+$/.test(blindedHex) || blindedHex.length > 2 * k) throw new Error('a blinded value is hex, at most the modulus length');
  const b = BigInt('0x' + blindedHex);
  if (b < 2n || b >= BigInt('0x' + key.n)) throw new Error('a blinded value must be in [2, n)');
  if (!key.jwk) return B.signBlinded(key, blindedHex); // test keys without CRT parts
  const priv = crypto.createPrivateKey({ key: key.jwk, format: 'jwk' });
  return crypto.privateDecrypt({ key: priv, padding: crypto.constants.RSA_NO_PADDING }, Buffer.from(blindedHex.padStart(2 * k, '0'), 'hex')).toString('hex');
}

export class Credits {
  private verifyKeys: PublicCreditKey[];
  constructor(private store: Store, private key: CreditKey, private house: HouseRing | null, private houseRing: string, public unitLamports: bigint, public bundles: number[] = [5, 20], pin: ReturnType<typeof pinFor> = null) {
    if (pin) {
      if (key.n.toLowerCase() !== pin.current.n.toLowerCase() || key.e !== pin.current.e) throw new PofError('CREDIT_KEY_NOT_PINNED', 'the configured credit key is not the pinned one (verifier/lib/credit-pins.json)', 500);
      if (houseRing !== pin.houseRing) throw new PofError('CREDIT_KEY_NOT_PINNED', 'the house ring is not the pinned one', 500);
      checkPublicKey(key);
    }
    this.verifyKeys = [{ kid: key.kid, n: key.n, e: key.e }, ...((pin && pin.retired) || [])];
  }

  offer() {
    const pub = B.publicKey(this.key);
    return { unitLamports: String(this.unitLamports), bundles: this.bundles, houseRing: this.houseRing, key: pub, fingerprint: fingerprint({ ...pub, houseRing: this.houseRing }),
      pinned: 'verifier/lib/credit-pins.json (in the published bundle and the client build); a client must refuse any other key or house ring',
      note: 'send unitLamports × count as a private transfer from your vault to houseRing, then claim with one blinded token per credit' };
  }

  async claim(input: { signature: unknown; owner: unknown; blinded: unknown; proof: unknown }) {
    if (!this.house) throw new PofError('CREDITS_OFF', 'relay credits are not configured here', 503);
    const signature = String(input.signature || '');
    fromB58(signature, 64, 'signature');
    const owner = String(input.owner || '');
    const ownerKey = fromB58(owner, 32, 'owner');
    if (!Array.isArray(input.blinded) || !this.bundles.includes(input.blinded.length)) throw new PofError('BAD_BUNDLE', `credits come in bundles of ${this.bundles.join(' or ')}`);
    const blinded = input.blinded.map(String);
    if (new Set(blinded).size !== blinded.length) throw new PofError('BAD_BLINDED', 'each credit needs its own blinded value');
    const proof = typeof input.proof === 'string' && /^[0-9a-f]{128}$/.test(input.proof) ? Buffer.from(input.proof, 'hex') : fromB58(input.proof, 64, 'proof');
    if (!verifySig(proof, claimMessage({ signature, owner, kid: this.key.kid, blinded }), ownerKey)) throw new PofError('BAD_CLAIM_PROOF', 'proof must be the transfer signer\'s signature over the claim message');
    const got = await this.house.received(signature);
    if (!got) throw new PofError('NOT_RECEIVED', 'the house ring has not received a private transfer in that transaction (yet: it can take a few seconds to index)', 402);
    if (!got.signers.includes(owner)) throw new PofError('NOT_SENDER', 'owner did not sign that transfer');
    const want = this.unitLamports * BigInt(blinded.length);
    if (got.lamports !== want) throw new PofError('WRONG_AMOUNT', `that transfer paid ${got.lamports} lamports; ${blinded.length} credits cost exactly ${want}`);
    let signatures: string[];
    try { signatures = blinded.map(b => rawSign(this.key, b)); } catch (e: any) { throw new PofError('BAD_BLINDED', String(e?.message || e)); }
    const setHash = crypto.createHash('sha256').update(blinded.join(',')).digest('hex');
    const rec = `relay/credits/claim/${signature}`;
    if (!(await this.store.create(rec, text(JSON.stringify({ count: blinded.length, kid: this.key.kid, set: setHash }))))) {
      // a repeat of the same claim (its answer was lost) gets the same signatures again: RSA is deterministic, nothing new
      // is minted (CR-02); any other set for that transfer stays refused
      const was = JSON.parse(Buffer.from((await this.store.get(rec)) || text('{}')).toString());
      if (was.set !== setHash || was.kid !== this.key.kid) throw new PofError('ALREADY_CLAIMED', 'that transfer was claimed already, with other blinded values');
    }
    return { kid: this.key.kid, signatures };
  }

  /** checks a credit and marks it spent; returns the name to release if the certify surely did not land */
  async spend(credit: any, bindTo = ''): Promise<string> {
    if (!credit || typeof credit !== 'object') throw new PofError('BAD_CREDIT', 'credit is { kid, token, signature }');
    const vk = this.verifyKeys.find(k => k.kid === credit.kid);
    if (!vk) throw new PofError('OLD_CREDIT_KEY', 'that credit was signed by a key this relayer does not honour');
    const token = String(credit.token || '');
    if (!/^[0-9a-f]{64}$/.test(token)) throw new PofError('BAD_CREDIT', 'credit.token is 32 bytes of hex');
    if (!(await B.verifyCredit(vk, token, String(credit.signature || '')))) throw new PofError('BAD_CREDIT', 'that credit was not signed by this relayer');
    const name = `relay/credits/spent/${hex(crypto.createHash('sha256').update('pof:credit:spent:').update(token).digest())}`;
    const mark = text('for:' + bindTo);
    if (!(await this.store.create(name, mark))) {
      // the same attestation retrying after an uncertain send may spend its own credit again
      const was = await this.store.get(name);
      if (!bindTo || !was || Buffer.compare(Buffer.from(was), Buffer.from(mark))) throw new PofError('CREDIT_USED', 'that credit was spent already');
    }
    return name;
  }
}

/* The house ring over the Helius SDK: the relayer key's own Ring, synced from a sealed snapshot in the store. */
export function sdkHouseRing(o: { store: Store; seed: Uint8Array; solanaRpcUrl: string; indexerUrl: string; apiKey?: string; rpc: (m: string, p: unknown[]) => Promise<any> }): HouseRing {
  let ready: any = null;
  async function init() {
    if (ready) return ready;
    const S: any = await import('@heliuslabs/spr');
    const client = await S.createSprClient({ solanaRpcUrl: o.solanaRpcUrl, indexerUrl: o.indexerUrl, proverUrl: o.indexerUrl, ...(o.apiKey ? { apiKey: o.apiKey } : {}) });
    const kp = S.ShieldedKeypair.fromKeypair(S.SigningKey.fromEd25519Bytes(o.seed));
    const keys = S.LocalKeys.fromKeypair(kp, client.proofService);
    const cipher = S.walletSnapshotCipher(kp);
    const store = { load: async () => { const b = await o.store.get('relay/house/snapshot'); return b ? Buffer.from(b).toString('utf8') : undefined; }, save: async (v: string) => o.store.put('relay/house/snapshot', text(v)) };
    const wallet = (await S.loadPersistedWallet({ store, cipher })) ?? new S.Wallet({ identity: kp.shieldedAddress() });
    ready = { S, client, wallet, keys, store, cipher };
    return ready;
  }
  return {
    async received(signature) {
      const H = await init();
      await H.S.syncPersistedWallet({ client: H.client, wallet: H.wallet, keys: H.keys, store: H.store, cipher: H.cipher });
      const rows = H.S.getPrivateTransactions(H.wallet).filter((t: any) => t.id.signature === signature && t.direction === 'incoming' && t.asset === H.S.SOL_MINT);
      if (!rows.length) return null;
      const lamports = rows.reduce((s: bigint, t: any) => s + BigInt(t.amount), 0n);
      const tx = await o.rpc('getTransaction', [signature, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]);
      const m = tx?.transaction?.message;
      const n = m?.header?.numRequiredSignatures ?? 0;
      return { lamports, signers: (m?.accountKeys || []).slice(0, n) };
    },
  };
}
