// The project's own witness run (cron, parked before launch): one step, then the document is in Blob for GET /v1/witness.
// Anyone else runs the same code with `node witness/run.js` and their own key; that is what makes a witness independent.
import { PofClient, LogReader, decodeBase58 } from "../sdk/dist/index.js";
import { Witness, signerFromSecret } from "../witness/witness.js";
import { BlobState } from "../witness/store.js";

function secretFromEnv(v) {
  if (!v) return null;
  const s = v.trim();
  return s.startsWith("[") ? Uint8Array.from(JSON.parse(s)) : decodeBase58(s);
}

export default async function handler(req, res) {
  const env = process.env;
  const out = (status, body) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(body));
  };
  if (!env.CRON_SECRET || req.headers.authorization !== `Bearer ${env.CRON_SECRET}`) return out(401, { error: "unauthorized" });
  if (env.WITNESS_PAUSED === "1") return out(200, { paused: true });
  const secret = secretFromEnv(env.WITNESS_KEY);
  if (!secret || !env.SOLANA_RPC || !env.POF_LOG_URL || !env.BLOB_READ_WRITE_TOKEN) return out(503, { error: "witness not configured (WITNESS_KEY, SOLANA_RPC, POF_LOG_URL, Blob)" });
  try {
    const w = new Witness({
      reader: new LogReader(env.POF_LOG_URL),
      client: new PofClient({ rpc: env.SOLANA_RPC, programId: env.POF_PROGRAM_ID || undefined }),
      signer: signerFromSecret(secret),
      state: new BlobState(),
      name: env.WITNESS_NAME || "pof-witness",
      monitorCertificates: true,
      peers: (env.WITNESS_PEERS || "").split(",").map((x) => x.trim()).filter(Boolean),
    });
    const r = await w.step();
    return out(200, r.ok ? { ok: true, treeSize: r.cosignature.treeSize, anchor: r.cosignature.anchor } : { ok: false, alarm: r.kind });
  } catch (e) {
    return out(500, { error: e.message });
  }
}
