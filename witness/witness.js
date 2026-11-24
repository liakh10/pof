// An independent witness for the Proof of Funds transparency log, in the manner of Certificate Transparency monitors.
// Each step: fetch the Verifier's signed tree head; check its key against the program's Config; check it extends the last
// head this witness verified (RFC 9162 consistency proof), so the log never forks, shrinks or rewrites; check it agrees with
// the head anchored on chain (Treasury, anchor_log); and only then cosign it. Everything else becomes an alarm, with evidence.
import crypto from "node:crypto";
import * as sdk from "../sdk/dist/index.js";

const KEEP_HEADS = 100;
const KEEP_ALARMS = 50;

/** A signer from a Solana-style 64-byte secret key (seed ‖ public key). */
export function signerFromSecret(secret64) {
  const b = Buffer.from(secret64);
  if (b.length !== 64) throw new Error("a witness key is 64 bytes (seed and public key)");
  const key = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), b.subarray(0, 32)]), format: "der", type: "pkcs8" });
  const pub = Buffer.from(crypto.createPublicKey(key).export({ format: "jwk" }).x, "base64url");
  if (!pub.equals(b.subarray(32))) throw new Error("the witness key file is inconsistent");
  return { publicKey: sdk.encodeBase58(pub), sign: (msg) => new Uint8Array(crypto.sign(null, Buffer.from(msg), key)) };
}

export class Witness {
  /**
   * @param {{ reader: sdk.LogReader, client: sdk.PofClient, signer: {publicKey: string, sign(m: Uint8Array): Uint8Array},
   *           state: { get(): Promise<object|null>, put(v: object): Promise<void> }, name?: string, trustedKeys?: string[],
   *           now?: () => number }} o
   */
  constructor(o) {
    this.reader = o.reader;
    this.client = o.client;
    this.signer = o.signer;
    this.state = o.state;
    this.name = o.name ?? "pof-witness";
    this.trustedKeys = o.trustedKeys ?? null;
    this.now = o.now ?? (() => Math.floor(Date.now() / 1000));
    this.programId = o.client.programId;
  }

  async load() {
    return (
      (await this.state.get()) ?? {
        v: 1, witness: { name: this.name, key: this.signer.publicKey }, programId: this.programId,
        last: null, heads: [], alarms: [], stats: { checked: 0, cosigned: 0, alarms: 0 }, firstKey: null, updatedAt: null,
      }
    );
  }

  /** The verifier keys a head may be signed with: the program's Config (verifier and the scheduled next one). */
  async allowedKeys(doc) {
    if (this.trustedKeys) return this.trustedKeys;
    const c = await this.client.getConfig().catch(() => null);
    if (c) return [c.verifier, c.nextVerifier].filter(Boolean);
    // before the program is configured: trust on first use, and alarm if the key ever changes
    return doc.firstKey ? [doc.firstKey] : null;
  }

  async step() {
    const doc = await this.load();
    doc.witness = { name: this.name, key: this.signer.publicKey };
    doc.stats.checked++;
    const ts = this.now();
    const alarm = (kind, detail) => {
      doc.alarms.unshift({ kind, detail, at: ts });
      doc.alarms = doc.alarms.slice(0, KEEP_ALARMS);
      doc.stats.alarms++;
      return { ok: false, kind, detail };
    };
    const finish = async (r) => {
      doc.updatedAt = ts;
      await this.state.put(doc);
      return { ...r, doc };
    };

    let head;
    try {
      head = await this.reader.head();
    } catch (e) {
      return finish(alarm("log_unreachable", String(e.message ?? e)));
    }
    const ev = { treeSize: head.treeSize, rootHash: head.rootHash, signature: head.signature, verifierKey: head.verifierKey };

    const allowed = await this.allowedKeys(doc);
    if (allowed && !allowed.some((k) => sameKey(k, head.verifierKey))) return finish(alarm("unknown_key", { head: ev, allowed }));
    if (!(await sdk.verifyTreeHead(head, this.programId))) return finish(alarm("bad_signature", { head: ev }));
    if (!allowed) doc.firstKey = head.verifierKey;

    // the log only grows, and only by appending
    const last = doc.last;
    if (last) {
      if (head.treeSize < last.treeSize) return finish(alarm("log_shrank", { previous: last, head: ev }));
      if (head.treeSize === last.treeSize && head.rootHash.toLowerCase() !== last.rootHash.toLowerCase())
        return finish(alarm("equivocation", { previous: last, head: ev }));
      if (head.treeSize > last.treeSize && last.treeSize > 0) {
        const ok = await this.consistent(last.treeSize, last.rootHash, head.treeSize, head.rootHash);
        if (!ok) return finish(alarm("inconsistent", { previous: last, head: ev }));
      }
    }

    // agreement with the head anchored on chain
    let anchor = null;
    const t = await this.client.getTreasury().catch(() => null);
    if (t?.log) {
      const a = t.log;
      let relation, consistent;
      if (a.treeSize === head.treeSize) {
        relation = "equal";
        consistent = a.rootHash === head.rootHash.toLowerCase();
      } else if (a.treeSize < head.treeSize) {
        relation = "prefix";
        consistent = await this.consistent(a.treeSize, a.rootHash, head.treeSize, head.rootHash);
      } else {
        relation = "ahead"; // the chain has seen a newer head than the log serves now: the log must extend to it
        consistent = await this.consistent(head.treeSize, head.rootHash, a.treeSize, a.rootHash);
      }
      anchor = { treeSize: a.treeSize, rootHash: a.rootHash, slot: a.slot, relation, consistent };
      if (!consistent) return finish(alarm("anchor_mismatch", { head: ev, anchor }));
    }

    const unchanged = last && last.treeSize === head.treeSize;
    const cos = {
      witnessKey: this.signer.publicKey, treeSize: head.treeSize, rootHash: head.rootHash.toLowerCase(), timestamp: ts,
      signature: sdk.toHex(this.signer.sign(sdk.cosignMessage(this.programId, head.treeSize, head.rootHash, ts))),
    };
    const rec = { ...cos, verifierKey: head.verifierKey, verifierSignature: head.signature, anchor };
    if (unchanged) doc.heads[0] = rec; // same head again: refresh the timestamp, keep one row
    else doc.heads.unshift(rec);
    doc.heads = doc.heads.slice(0, KEEP_HEADS);
    doc.last = { treeSize: head.treeSize, rootHash: head.rootHash.toLowerCase(), verifierKey: head.verifierKey, signature: head.signature };
    doc.latest = rec;
    doc.stats.cosigned++;
    return finish({ ok: true, cosignature: rec });
  }

  async consistent(m, rootM, n, rootN) {
    try {
      const p = await this.reader.consistency(m, n);
      return await sdk.verifyConsistency({ size1: m, size2: n, root1: rootM, root2: rootN, proof: p.path });
    } catch {
      return false;
    }
  }
}

function sameKey(a, b) {
  try {
    return sdk.encodeBase58(sdk.keyBytes(a)) === sdk.encodeBase58(sdk.keyBytes(b));
  } catch {
    return false;
  }
}

/** Check a published witness document: every cosignature verifies, by the key it claims. */
export async function checkWitnessDoc(doc, programId = doc.programId) {
  const bad = [];
  for (const [i, h] of (doc.heads ?? []).entries()) {
    if (h.witnessKey !== doc.witness?.key || !(await sdk.verifyCosignature(h, programId))) bad.push(i);
  }
  return { ok: bad.length === 0, checked: doc.heads?.length ?? 0, bad };
}
