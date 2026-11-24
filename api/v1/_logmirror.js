// A per-instance mirror of the Verifier's transparency log (CONTRACT §7), so /v1/log proofs cost the log nothing per
// request. It pages in new entries (?from&to, 256 at a time) as the signed head grows, keeps every leaf hash in RFC 9162
// tree levels updated in O(log n) per append, and serves inclusion paths at exactly the signed head it last synced to.
// Before it serves anything it checks that its own root equals the signed head's root: a log whose entries do not add
// up to its head is refused, never mirrored.
import * as sdk from "../../sdk/dist/index.js";

const ENTRY_KEEP = 20_000;
const PARALLEL = 4;

export class LogMirror {
  constructor(reader) {
    this.reader = reader; // { head(), entries(from, to), entry(i) }
    this.levels = [[]]; // levels[0] = leaf hashes; an unpaired last node is promoted (RFC 9162 §2.1.1)
    this.head = null;
    this.entries = new Map(); // index → leaf hex, LRU
    this.syncing = null;
    this.stats = { pages: 0, entriesFetched: 0, entriesCached: 0, rebuilds: 0 };
  }

  get size() {
    return this.levels[0].length;
  }

  async append(hash) {
    this.levels[0].push(hash);
    let i = this.levels[0].length - 1;
    for (let k = 0; ; k++) {
      const lvl = this.levels[k];
      if (lvl.length === 1) break; // the top: this node is the root
      const parent = i >> 1;
      const left = lvl[parent * 2];
      const right = lvl[parent * 2 + 1];
      const node = right ? await sdk.nodeHash(left, right) : left;
      if (!this.levels[k + 1]) this.levels[k + 1] = [];
      this.levels[k + 1][parent] = node;
      this.levels[k + 1].length = parent + 1;
      i = parent;
    }
  }

  root() {
    const top = this.levels[this.levels.length - 1];
    return this.size ? top[0] : null;
  }

  /** Bring the mirror to `head` (a signed head the caller already checked). Single-flight. */
  async syncTo(head) {
    if (this.head && head.treeSize <= this.head.treeSize) return this.head;
    if (this.syncing) {
      // wait for the sync in flight and share its outcome: a failure is not retried by every waiter at once
      await this.syncing;
      return this.syncTo(head);
    }
    if (this.failed && Date.now() < this.failed.until) throw this.failed.error; // back off: do not hammer a busy log
    this.syncing = (async () => {
      if (head.treeSize < this.size) this.reset();
      // pages are fetched up to PARALLEL at a time and appended in order
      while (this.size < head.treeSize) {
        const starts = [];
        for (let a = this.size; a < head.treeSize && starts.length < PARALLEL; a += 256) starts.push(a);
        const pages = await Promise.all(starts.map((a) => this.reader.entries(a, Math.min(head.treeSize, a + 256))));
        for (const page of pages) {
          this.stats.pages++;
          for (const e of page) {
            if (e.index !== this.size) throw new Error(`log page out of order at ${e.index}`);
            await this.append(await sdk.leafHash(sdk.fromHex(e.leaf)));
            this.keep(e.index, e.leaf);
          }
          if (page.length < 256 && this.size < head.treeSize) break; // a short page: fetch the rest in the next round
        }
      }
      const root = this.root();
      if (!root || sdk.toHex(root) !== String(head.rootHash).toLowerCase()) {
        this.reset();
        throw Object.assign(new Error("the log's entries do not add up to its signed head"), { mismatch: true });
      }
      this.head = head;
      return head;
    })();
    try {
      const h = await this.syncing;
      this.failed = null;
      return h;
    } catch (e) {
      if (!e?.mismatch) this.failed = { error: e, until: Date.now() + 2_000 };
      throw e;
    } finally {
      this.syncing = null;
    }
  }

  reset() {
    this.levels = [[]];
    this.head = null;
    this.entries.clear();
    this.stats.rebuilds++;
  }

  keep(i, leaf) {
    this.entries.set(i, leaf);
    if (this.entries.size > ENTRY_KEEP) this.entries.delete(this.entries.keys().next().value);
  }

  async leaf(i) {
    const hit = this.entries.get(i);
    if (hit) {
      this.stats.entriesCached++;
      return hit;
    }
    this.stats.entriesFetched++;
    const e = await this.reader.entry(i);
    this.keep(i, e.leaf);
    return e.leaf;
  }

  /** the audit path of leaf i in the tree of the synced head */
  path(i) {
    if (!this.head || i < 0 || i >= this.head.treeSize) throw new RangeError(`entry ${i} is not in the log`);
    const out = [];
    let idx = i;
    for (let k = 0; k < this.levels.length - 1; k++) {
      const sib = idx ^ 1;
      if (sib < this.levels[k].length) out.push(this.levels[k][sib]);
      idx >>= 1;
    }
    return out.map(sdk.toHex);
  }
}
