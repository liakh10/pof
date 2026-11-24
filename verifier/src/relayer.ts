/* The relayer: submits certify for handle and badge subjects, so the holder's wallet never signs anything public.
   1. quote: the fee, the certificate rent and the network fee, plus a few unique lamports that tag the payment;
   2. the holder pays that exact amount to the relayer from anywhere (a Ring withdrawal keeps the source private);
   3. certify: the relayer finds that payment, marks it used (create-if-absent), checks its rolling 24-hour spend cap and its
      balance floor, and sends ed25519 + certify in one transaction (the log head is anchored by anchor_log, keeper cron).
   Quotes are sealed into the quote id itself (HMAC), so nothing is stored until a payment is used. */
import crypto from 'node:crypto';
import { PofError, fromB58, hex, unhex } from './codec.js';
import { ATTESTATION_LEN, decodeAttestation, nullsetHash, revokeBytes, revokeBytesV2, sortHashes } from './contract.js';
import { verifySig } from './keys.js';
import { getJson, putJson, type Store } from './store.js';
import type { PofChain } from './chain.js';
import type { TransparencyLog } from './log.js';
import type { Credits } from './credits.js';
export const UNKNOWN_LOG_INDEX = 18446744073709551615n; // u64::MAX: the SDK reads it as "unknown"

export interface RelayConfig {
  address: string; verifierKey: Uint8Array; programId: Uint8Array;
  dailyCapLamports: bigint; balanceFloorLamports: bigint; quoteTtlSec: number; free: boolean; hmacKey: Uint8Array;
}

export class Relayer {
  constructor(private cfg: RelayConfig, private store: Store, private chain: PofChain, private log: TransparencyLog, public credits: Credits | null = null) {}

  private mac(body: string) { return crypto.createHmac('sha256', this.cfg.hmacKey).update(body).digest('hex').slice(0, 32); }

  async quote() {
    const q = await this.chain.quoteLamports();
    const tag = BigInt(1 + crypto.randomInt(99_999));
    const lamports = this.cfg.free ? 0n : q.fee + q.rent + q.network + tag;
    const slot = await this.chain.slot();
    const exp = Math.floor(Date.now() / 1000) + this.cfg.quoteTtlSec;
    // a reference per quote (A2-03): the payment carries it in a memo, so only the payment made for this quote pays it,
    // whatever other transfers the relayer receives, and nobody can claim a payment by asking quotes until one matches
    const reference = crypto.randomBytes(16).toString('hex');
    const body = `${lamports}.${slot}.${exp}.${reference}`;
    return { quote: `${body}.${this.mac(body)}`, lamports: String(lamports), payTo: this.cfg.address, reference, memo: `pof:${reference}`, expiresInSec: this.cfg.quoteTtlSec,
      parts: { fee: String(q.fee), rent: String(q.rent), network: String(q.network), tag: String(this.cfg.free ? 0n : tag) },
      note: this.cfg.free ? 'the relayer is free on this network' : 'one transaction: a SystemProgram transfer of exactly lamports to payTo and a Memo instruction with the text memo; then call certify with the quote. Relay credits (/api/relay/credits) are the private way to pay' };
  }

  private parseQuote(q: unknown) {
    if (typeof q !== 'string') throw new PofError('BAD_QUOTE', 'certify needs the quote from /api/relay/quote');
    const [l, s, e, ref, m] = q.split('.');
    if (!m || !/^[0-9a-f]{32}$/.test(ref || '') || this.mac(`${l}.${s}.${e}.${ref}`) !== m) throw new PofError('BAD_QUOTE', 'that quote was not issued by this relayer');
    if (Number(e) < Date.now() / 1000) throw new PofError('QUOTE_EXPIRED', 'the quote expired: ask for a new one');
    return { lamports: BigInt(l), slot: BigInt(s), reference: ref };
  }

  /** the rolling 24-hour spend, from relay/spend.json: [[unixSec, lamports], ...] */
  private async spend(): Promise<[number, string][]> { const now = Date.now() / 1000; return ((await getJson<[number, string][]>(this.store, 'relay/spend.json')) || []).filter(([t]) => t > now - 86_400); }

  async certify(input: { attestation: unknown; signature: unknown; logIndex: unknown; quote?: unknown; hashes: unknown; credit?: unknown }) {
    const att = unhex(input.attestation, ATTESTATION_LEN, 'attestation');
    const sig = unhex(input.signature, 64, 'signature');
    const a = decodeAttestation(att);
    if (Buffer.compare(Buffer.from(a.programId), Buffer.from(this.cfg.programId))) throw new PofError('WRONG_PROGRAM', 'that attestation is for another deployment');
    if (a.subjectKind === 0) throw new PofError('RELAY_NOT_FOR_WALLETS', 'a wallet certificate is submitted by the wallet itself; the relayer serves handles and badges');
    if (hex(a.payer) !== hex(fromB58(this.cfg.address, 32, 'relayer'))) throw new PofError('BAD_PAYER', 'the attestation does not name the relayer as payer');
    if (!verifySig(sig, att, this.cfg.verifierKey)) throw new PofError('BAD_SIGNATURE', 'the Verifier did not sign that attestation');
    const slot = await this.chain.slot();
    if (slot >= a.expirySlot) throw new PofError('ATTESTATION_EXPIRED', 'the attestation expired before it was submitted');
    if (!Array.isArray(input.hashes) || input.hashes.length !== a.noteCount) throw new PofError('BAD_HASHES', `send the ${a.noteCount} salted nullifier hashes that came with the attestation`);
    const hashes = input.hashes.map((h, i) => unhex(h, 32, `hashes[${i}]`));
    if (hex(nullsetHash(sortHashes(hashes))) !== hex(a.nullsetHash)) throw new PofError('BAD_HASHES', 'those hashes do not match the attestation');
    // the log index is not known before the certificate lands (A2-06): certify carries u64::MAX ("look it up by the bytes")
    const logIndex = UNKNOWN_LOG_INDEX;

    /* every refusal that does not depend on the payment comes first, so a refused request never uses up a payment (POF-08) */
    const spend = await this.spend();
    const used = spend.reduce((s, [, l]) => s + BigInt(l), 0n);
    const q = await this.chain.quoteLamports();
    const cost = q.fee + q.rent + q.network;
    if (used + cost > this.cfg.dailyCapLamports) throw new PofError('RELAY_CAP', 'the relayer reached its spend cap for the last 24 hours; your payment stays valid, try later or certify from your own wallet', 429);
    if ((await this.chain.relayerBalance()) < cost + this.cfg.balanceFloorLamports) throw new PofError('RELAY_LOW', 'the relayer is low on SOL; your payment stays valid, try later', 503);

    const attId = crypto.createHash('sha256').update(att).digest('hex'); // the whole 240 bytes: nonce and nullset included
    let paid: string | null = null, creditMark: string | null = null;
    if (!this.cfg.free && input.credit !== undefined) {
      if (!this.credits) throw new PofError('CREDITS_OFF', 'relay credits are not configured here; use a quote', 503);
      creditMark = await this.credits.spend(input.credit, attId);
    } else if (!this.cfg.free) {
      const quote = this.parseQuote(input.quote);
      const inc = await this.chain.incoming(quote.slot - 150n, quote.reference);
      const mark = new Uint8Array(Buffer.from('for:' + attId)); // bound to this exact attestation (POF-30)
      for (const t of inc) {
        if (t.lamports !== quote.lamports || t.reference !== quote.reference) continue;
        if (await this.store.create(`relay/paid/${t.signature}`, mark)) { paid = t.signature; break; }
        // a payment already bound to this same attestation (an earlier try whose outcome was uncertain) may be used again
        const was = await this.store.get(`relay/paid/${t.signature}`);
        if (was && Buffer.from(was).equals(Buffer.from(mark))) { paid = t.signature; break; }
      }
      if (!paid) throw new PofError('NOT_PAID', `no unused payment of exactly ${quote.lamports} lamports to ${this.cfg.address} with the memo pof:${quote.reference} yet; it can take a few seconds to land`, 402);
    }
    /* the payment comes back only when the certify surely did not land (refused before a block, or landed and failed) and
       the certificate does not hold this attestation; an uncertain send keeps the payment bound to this attestation, so the
       same request can be retried with it (POF-28) */
    const landed = async () => { const c = await this.chain.certificate(a.subjectHash, a.asset).catch(() => null); return !!c && c.hashes.length === hashes.length && hashes.every(h => c.hashes.includes(hex(h))); };
    let r;
    try { r = await this.chain.certify({ attestation: att, signature: sig, verifierKey: this.cfg.verifierKey, logIndex, hashes: sortHashes(hashes) }); }
    catch (e: any) {
      if (await landed()) r = { signature: e?.details?.signature || 'landed', lamports: 0n };
      else {
        if (paid && e?.code === 'CHAIN_REJECTED') await this.store.del(`relay/paid/${paid}`).catch(() => {});
        if (creditMark && e?.code === 'CHAIN_REJECTED') await this.store.del(creditMark).catch(() => {}); // the credit comes back
        throw e;
      }
    }
    if (paid) await this.store.put(`relay/paid/${paid}`, new Uint8Array(Buffer.from('done:' + r.signature))); // used: never again
    if (creditMark) await this.store.put(creditMark, new Uint8Array(Buffer.from('done:' + r.signature)));
    spend.push([Math.floor(Date.now() / 1000), String(r.lamports)]);
    await putJson(this.store, 'relay/spend.json', spend);
    const published = await this.log.publish(attId).catch(() => null);
    return { signature: r.signature, payment: paid, credit: creditMark ? 'spent' : null, logIndex: published, certificate: (await this.chain.certificate(a.subjectHash, a.asset))?.address ?? null };
  }


  /** a relayed revoke_by_holder for X and badge certificates: the controller signs the CONTRACT revoke bytes, the relayer
   *  pays the network fee, so no wallet of the holder appears. The signature is checked here before anything is sent, and a
   *  v2 signature carries the last slot it may be used at (RV-01). */
  async revoke(input: { subjectHash: unknown; asset: unknown; signature: unknown; validUntil?: unknown }) {
    const sh = unhex(input.subjectHash, 32, 'subjectHash');
    const asset = Number(input.asset);
    const sig = typeof input.signature === 'string' && /^[0-9a-f]{128}$/.test(input.signature) ? unhex(input.signature, 64) : fromB58(input.signature, 64, 'signature');
    if (!this.chain.revokeSigned) throw new PofError('PROGRAM_NOT_READY', 'the program does not take a signed revoke yet; revoke from the controller key directly', 503);
    const cert = await this.chain.certificate(sh, asset);
    if (!cert) throw new PofError('NOT_FOUND', 'no certificate for that subject and asset', 404);
    if (cert.status !== 0) throw new PofError('NOT_LIVE', 'that certificate is not live');
    if (!cert.controller || !cert.nullsetHash || cert.issuedSlot === undefined) throw new PofError('CHAIN_OFF', 'the certificate could not be read in full', 503);
    const v2 = (this.chain.revokeVersion ?? 1) >= 2;
    let validUntil: bigint | undefined;
    if (v2) {
      if (input.validUntil == null || !/^\d{1,20}$/.test(String(input.validUntil))) throw new PofError('BAD_VALID_UNTIL', 'validUntil (the last slot this signature may be used at) is part of the signed revoke');
      validUntil = BigInt(String(input.validUntil));
      if ((await this.chain.slot()) > validUntil) throw new PofError('REVOKE_EXPIRED', 'that signed revoke expired: sign a new one');
    }
    const msg = v2 ? revokeBytesV2(this.cfg.programId, fromB58(cert.address), sh, asset, unhex(cert.nullsetHash, 32), cert.issuedSlot, validUntil!)
                   : revokeBytes(this.cfg.programId, fromB58(cert.address), sh, asset, unhex(cert.nullsetHash, 32), cert.issuedSlot);
    if (!verifySig(sig, msg, fromB58(cert.controller))) throw new PofError('BAD_REVOKE_SIGNATURE', 'that is not the controller\'s signature over this certificate\'s revoke bytes');
    const spend = await this.spend();
    if (spend.reduce((s, [, l]) => s + BigInt(l), 0n) + 10_000n > this.cfg.dailyCapLamports) throw new PofError('RELAY_CAP', 'the relayer reached its spend cap for the last 24 hours; try later', 429);
    const r = await this.chain.revokeSigned({ subjectHash: sh, asset, signature: sig, ...(v2 ? { validUntil } : {}) });
    spend.push([Math.floor(Date.now() / 1000), String(r.lamports)]);
    await putJson(this.store, 'relay/spend.json', spend);
    return { signature: r.signature, note: 'report "revoked" only after reading the certificate on chain' };
  }
}
