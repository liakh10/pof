// An independent witness for the Proof of Funds transparency log, in the manner of Certificate Transparency monitors.
// Each step: fetch the Verifier's signed tree head; check its key against the program's Config; check it extends the last
// head this witness verified (RFC 9162 consistency proof), so the log never forks, shrinks or rewrites; check it agrees with
// the head anchored on chain (Treasury, anchor_log); and only then cosign it. Everything else becomes an alarm, with evidence.
import crypto from "node:crypto";
import * as sdk from "../sdk/dist/index.js";

const KEEP_HEADS = 100;
/** zk certificates name the zk config PDA as their verifier (zk/onchain/src/zk.rs) */
export const ZK_CONFIG = "6q7PxLzgUtLHMfCDDHzkU4Ho54rC6b21VZmSFsD6Tsv1";
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
    this.monitorCertificates = o.monitorCertificates ?? false;
    this.monitorBatch = o.monitorBatch ?? 50;
    this.graceSlots = o.graceSlots ?? 1_500;
    this.peers = o.peers ?? [];
    this.fetch = o.fetch ?? globalThis.fetch;
  }

  async load() {
    return (
      (await this.state.get()) ?? {
        v: 1, witness: { name: this.name, key: this.signer.publicKey }, programId: this.programId,
        last: null, heads: [], alarms: [], stats: { checked: 0, cosigned: 0, alarms: 0 }, firstKey: null, updatedAt: null,
      }
    );
  }

  /**
   * The key a head may be signed with: the key the program has active NOW (Config verifier, or the proposed next one
   * once its slot has come). A retired key, even one that signed old entries, must not sign a new head (audit W-02).
   */
  async allowedKeys(doc) {
    if (this.trustedKeys) return this.trustedKeys;
    const c = await this.client.getConfig().catch(() => null);
    if (c) return [c.activeVerifier];
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
    if (this.monitorCertificates) await this.monitor(doc, head, alarm);
    await this.gossip(doc, head, alarm);
    return finish({ ok: true, cosignature: rec });
  }

  /**
   * The monitor's other duty (audit POF-18, W-01): every Verifier-signed certificate on chain must be backed by a log entry
   * holding exactly its signed attestation. The certificate's `log_index` is unsigned: when it does not point at a matching
   * leaf, the leaf is searched by its signed bytes (the nonce) across the whole log. A certificate whose leaf is in no
   * entry once `graceSlots` have passed since it was certified raises `unlogged_certificate`, whatever index it claims
   * (u64::MAX included). zk certificates (verifier = the zk config PDA) carry no Verifier signature and are skipped.
   */
  async monitor(doc, head, alarm) {
    doc.monitored = doc.monitored ?? {};
    const { slot, certificates } = await this.client.listCertificates().catch(() => ({ slot: 0, certificates: [] }));
    let n = 0;
    let index = null; // nonce → leaf index, built once per step when needed
    const byNonce = async () => {
      if (index) return index;
      index = new Map();
      const entries = head.treeSize ? await this.reader.entries(0, head.treeSize) : [];
      for (const e of entries) {
        try {
          index.set(sdk.parseLeaf(e.leaf).attestation.nonce, e.index);
        } catch {}
      }
      return index;
    };
    for (const c of certificates) {
      if (c.verifier === ZK_CONFIG) continue;
      const id = `${c.address}:${c.nonce}`;
      if (doc.monitored[id] === "ok" || doc.monitored[id] === "mismatch" || n >= this.monitorBatch) continue;
      n++;
      let res = { matches: false, mismatched: ["log_index outside the log"] };
      if (c.logIndex !== null && c.logIndex < head.treeSize) {
        try {
          res = sdk.matchCertificateLeaf(c, sdk.parseLeaf((await this.reader.entry(c.logIndex)).leaf));
        } catch (e) {
          res = { matches: false, mismatched: [String(e.message ?? e)] };
        }
      }
      if (res.matches) {
        doc.monitored[id] = "ok";
        continue;
      }
      // not at the index it claims: look for its signed bytes anywhere in the log
      const at = (await byNonce()).get(c.nonce);
      if (at !== undefined) {
        const m = sdk.matchCertificateLeaf(c, sdk.parseLeaf((await this.reader.entry(at)).leaf));
        if (m.matches) {
          doc.monitored[id] = "ok";
          if (c.logIndex !== at) (doc.notes ??= []).unshift({ kind: "misindexed", certificate: c.address, claimed: c.logIndex, actual: at });
          continue;
        }
      }
      if (slot && c.certifiedSlot && slot - c.certifiedSlot < this.graceSlots) {
        doc.monitored[id] = "pending"; // the log may not have caught up yet: checked again next step
        continue;
      }
      doc.monitored[id] = "mismatch";
      alarm("unlogged_certificate", { certificate: c.address, logIndex: c.logIndex, mismatched: res.mismatched });
    }
    doc.stats.monitored = Object.values(doc.monitored).filter((v) => v !== "pending").length;
  }

  /**
   * Gossip (audit W-03): fetch other witnesses' published documents, check their cosignatures, and make sure every head
   * they cosigned is consistent with the log this witness sees. A head another witness cosigned at our size with another
   * root, or one that no consistency proof can join to ours, is a split view: someone is being shown a different log.
   */
  async gossip(doc, head, alarm) {
    if (!this.peers.length) return;
    doc.peers = [];
    for (const url of this.peers) {
      const p = { url, ok: false, key: null, treeSize: null, checkedAt: this.now() };
      try {
        const r = await this.fetch(url, { headers: { accept: "application/json" } });
        const other = await r.json();
        const chk = await checkWitnessDoc(other, this.programId);
        p.key = other.witness?.key ?? null;
        if (!chk.ok) {
          p.error = "bad cosignatures";
        } else if (other.latest) {
          const o = other.latest;
          p.treeSize = o.treeSize;
          let consistent;
          if (o.treeSize === head.treeSize) consistent = o.rootHash.toLowerCase() === head.rootHash.toLowerCase();
          else if (o.treeSize < head.treeSize) consistent = await this.consistent(o.treeSize, o.rootHash, head.treeSize, head.rootHash);
          else consistent = await this.consistent(head.treeSize, head.rootHash, o.treeSize, o.rootHash);
          p.ok = consistent;
          if (!consistent) alarm("split_view", { peer: url, peerHead: { treeSize: o.treeSize, rootHash: o.rootHash, witnessKey: o.witnessKey, signature: o.signature }, ours: { treeSize: head.treeSize, rootHash: head.rootHash } });
        } else p.ok = true;
      } catch (e) {
        p.error = String(e.message ?? e);
      }
      doc.peers.push(p);
    }
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
