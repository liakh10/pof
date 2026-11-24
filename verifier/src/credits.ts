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

export interface CreditKey { kid: string; n: string; e: string; d: string }
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
  return { kid: k.kid || crypto.createHash('sha256').update(k.n).digest('hex').slice(0, 8), n: k.n, e: k.e, d: k.d };
}

export class Credits {
  constructor(private store: Store, private key: CreditKey, private house: HouseRing | null, private houseRing: string, public unitLamports: bigint, public bundles: number[] = [5, 20]) {}

  offer() { return { unitLamports: String(this.unitLamports), bundles: this.bundles, houseRing: this.houseRing, key: B.publicKey(this.key), note: 'send unitLamports × count as a private transfer from your vault to houseRing, then claim with one blinded token per credit' }; }

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
    if (!(await this.store.create(`relay/credits/claim/${signature}`, text(JSON.stringify({ count: blinded.length, kid: this.key.kid }))))) throw new PofError('ALREADY_CLAIMED', 'that transfer was claimed already');
    try { return { kid: this.key.kid, signatures: blinded.map(b => B.signBlinded(this.key, b)) }; }
    catch (e: any) { await this.store.del(`relay/credits/claim/${signature}`).catch(() => {}); throw new PofError('BAD_BLINDED', String(e?.message || e)); }
  }

  /** checks a credit and marks it spent; returns the name to release if the certify surely did not land */
  async spend(credit: any, bindTo = ''): Promise<string> {
    if (!credit || typeof credit !== 'object') throw new PofError('BAD_CREDIT', 'credit is { kid, token, signature }');
    if (credit.kid !== this.key.kid) throw new PofError('OLD_CREDIT_KEY', 'that credit was signed by another relayer key');
    const token = String(credit.token || '');
    if (!/^[0-9a-f]{64}$/.test(token)) throw new PofError('BAD_CREDIT', 'credit.token is 32 bytes of hex');
    if (!(await B.verifyCredit(this.key, token, String(credit.signature || '')))) throw new PofError('BAD_CREDIT', 'that credit was not signed by this relayer');
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
