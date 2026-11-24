// Where a witness keeps its state and publishes its document: a JSON file, or Vercel Blob (public, so anyone can fetch it).
import fs from "node:fs/promises";
import path from "node:path";

export class FileState {
  constructor(file) {
    this.file = file;
  }
  async get() {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async put(v) {
    await fs.mkdir(path.dirname(path.resolve(this.file)), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(v, null, 2));
    await fs.rename(tmp, this.file);
  }
}

export class MemoryState {
  constructor() {
    this.v = null;
  }
  async get() {
    return this.v ? structuredClone(this.v) : null;
  }
  async put(v) {
    this.v = structuredClone(v);
  }
}

/** Vercel Blob, private, read back without the CDN cache (the same calls the verifier and the bots use). */
export class BlobState {
  constructor(key = "pof/witness/witness.json") {
    this.key = key;
  }
  async get() {
    const B = await import("@vercel/blob");
    try {
      const r = await B.get(this.key, { access: "private", useCache: false });
      if (!r?.stream) return null;
      return JSON.parse(await new Response(r.stream).text());
    } catch (e) {
      if (/not.?found|404/i.test(String(e?.message)) || e?.name === "BlobNotFoundError") return null;
      throw e;
    }
  }
  async put(v) {
    const B = await import("@vercel/blob");
    await B.put(this.key, JSON.stringify(v), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
  }
}
