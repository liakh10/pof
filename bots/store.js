// Bot state: links (platform user ↔ subject), chat/guild bindings to Rooms, pending join requests, granted roles.
// Production: Vercel Blob, private, reads bypass the CDN cache (same pattern as the verifier). Tests: memory.

export class MemoryStore {
  constructor() {
    this.m = new Map();
  }
  async get(key) {
    return this.m.has(key) ? structuredClone(this.m.get(key)) : null;
  }
  async put(key, value) {
    this.m.set(key, structuredClone(value));
  }
  async del(key) {
    this.m.delete(key);
  }
  async list(prefix) {
    return [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

export class BlobStore {
  constructor(prefix = "pof/bots/") {
    this.prefix = prefix;
    this.B = null;
  }
  async b() {
    return this.B || (this.B = await import("@vercel/blob"));
  }
  async get(key) {
    const B = await this.b();
    try {
      const r = await B.get(this.prefix + key, { access: "private", useCache: false });
      if (!r || !r.stream) return null;
      return JSON.parse(await new Response(r.stream).text());
    } catch (e) {
      if (/not.?found|404/i.test(String(e?.message)) || e?.name === "BlobNotFoundError") return null;
      throw e;
    }
  }
  async put(key, value) {
    const B = await this.b();
    await B.put(this.prefix + key, JSON.stringify(value), {
      access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json",
    });
  }
  async del(key) {
    const B = await this.b();
    try {
      await B.del(this.prefix + key);
    } catch {}
  }
  async list(prefix) {
    const B = await this.b();
    const out = [];
    let cursor;
    do {
      const r = await B.list({ prefix: this.prefix + prefix, cursor, limit: 1000 });
      out.push(...r.blobs.map((x) => x.pathname.slice(this.prefix.length)));
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);
    return out.sort();
  }
}

let shared = null;
export function getStore(env = process.env) {
  if (shared) return shared;
  if (!env.BLOB_READ_WRITE_TOKEN) throw new Error("bots need a Vercel Blob store (BLOB_READ_WRITE_TOKEN)");
  return (shared = new BlobStore());
}

/** Keys, in one place. */
export const K = {
  link: (platform, userId) => `link/${platform}/${userId}`,
  bySubject: (platform, subjectHash) => `subject/${platform}/${subjectHash}`,
  tgChat: (chatId) => `tg/chat/${chatId}`,
  tgPending: (userId) => `tg/pending/${userId}`,
  tgMember: (chatId, userId) => `tg/member/${chatId}/${userId}`,
  dcGuild: (guildId) => `dc/guild/${guildId}`,
  dcGrant: (guildId, userId) => `dc/grant/${guildId}/${userId}`,
};
