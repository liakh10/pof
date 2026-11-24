// Shared fixtures for the devx tests (API, MCP, bots): an in-memory chain and an in-memory transparency log.
import crypto from "node:crypto";
import * as sdk from "../../../sdk/dist/index.js";
import { MemoryRpc } from "../../../sdk/dist/testing.js";

export const rand = () => sdk.encodeBase58(crypto.randomBytes(32));

export async function makeWorld() {
  const rpc = new MemoryRpc();
  rpc.slot = 5000;
  const w = { rpc, whale: rand(), badge: rand(), spent: rand(), creator: rand() };
  w.whaleCert = await rpc.putCertificate({ subject: sdk.walletSubject(w.whale), asset: 0, tier: 4, expirySlot: 9000, logIndex: 4 });
  await rpc.putCertificate({ subject: sdk.walletSubject(w.whale), asset: 1, tier: 2, expirySlot: 4000 });
  w.anonCert = await rpc.putCertificate({ subject: sdk.xSubject("anon"), asset: 0, tier: 5, expirySlot: 9000 });
  await rpc.putCertificate({ subject: sdk.badgeSubject(w.badge), asset: 0, tier: 1, expirySlot: 9000 });
  w.spentCert = await rpc.putCertificate({ subject: sdk.walletSubject(w.spent), asset: 0, tier: 3, status: 1, revokedSlot: 4500, expirySlot: 9000 });
  [w.room] = await sdk.roomAddress(w.creator, 1);
  rpc.putRoom(w.room, { creator: w.creator, id: 1, asset: 0, minTier: 3, memberCount: 2, name: "whales" });
  await rpc.putMember(w.room, sdk.walletSubject(w.whale), w.whaleCert);
  await rpc.putMember(w.room, sdk.walletSubject(w.spent), w.spentCert);
  w.client = new sdk.PofClient({ rpc });
  return w;
}

/** A transparency log with the verifier's HTTP shape (CONTRACT §7), served through an injected fetch. */
export async function makeLog(n = 7) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const vk = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  const verifierKey = sdk.encodeBase58(vk);
  const leaves = [];
  for (let i = 0; i < n; i++) {
    const att = sdk.buildAttestation({
      programId: sdk.POF_PROGRAM_ID, subjectKind: 0, subjectHash: crypto.randomBytes(32).toString("hex"), asset: 0, tier: 1 + (i % 5),
      treeRoot: "bb".repeat(32), rootSlot: 100 + i, noteCount: 1, nullsetHash: "cc".repeat(32), issuedSlot: 200 + i, expirySlot: 9000,
      payer: verifierKey, controller: verifierKey, nonce: crypto.randomBytes(16).toString("hex"),
    });
    const sig = crypto.sign(null, att, privateKey);
    const slot = Buffer.alloc(8); slot.writeBigUInt64LE(BigInt(300 + i));
    leaves.push(new Uint8Array(Buffer.concat([Buffer.from([1]), att, sig, vk, Buffer.alloc(32, 9), slot])));
  }
  const hashes = await Promise.all(leaves.map((l) => sdk.leafHash(l)));
  const root = sdk.toHex(await sdk.merkleRoot(hashes));
  const sth = {
    treeSize: n, rootHash: root, slot: 5000,
    signature: crypto.sign(null, sdk.treeHeadMessage(sdk.POF_PROGRAM_ID, n, root), privateKey).toString("hex"), verifierKey,
  };
  const base = "https://pof.test/api/attest/log";
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (u.searchParams.has("head")) return reply(200, sth);
    if (u.searchParams.has("entry")) {
      const i = Number(u.searchParams.get("entry"));
      if (!leaves[i]) return reply(404, { error: { code: "NOT_FOUND", message: `log entry ${i} does not exist` } });
      return reply(200, { index: i, leaf: sdk.toHex(leaves[i]), leafHash: sdk.toHex(hashes[i]), verifierKey: vk.toString("hex") });
    }
    if (u.searchParams.has("proof")) {
      const i = Number(u.searchParams.get("proof"));
      const size = Number(u.searchParams.get("size") ?? n);
      const path = (await sdk.inclusionPath(i, hashes.slice(0, size))).map(sdk.toHex);
      return reply(200, { index: i, treeSize: size, rootHash: sdk.toHex(await sdk.merkleRoot(hashes.slice(0, size))), leafHash: sdk.toHex(hashes[i]), path });
    }
    return reply(400, { error: { code: "BAD", message: "?" } });
  };
  return { base, fetch: fetchImpl, sth, leaves, verifierKey, privateKey };
}

/** Serve a MemoryRpc as a real JSON-RPC endpoint (and a log under /api/attest/log), for child processes and HTTP tests. */
import http from "node:http";
export async function startChainServer(rpc, log) {
  const b64 = (u8) => Buffer.from(u8).toString("base64");
  const acc = (a) => (a ? { data: [b64(a.data), "base64"], executable: false, lamports: a.lamports, owner: a.owner, rentEpoch: 0, space: a.data.length } : null);
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (req.url.startsWith("/api/attest/log") && log) {
      const r = await log.fetch("https://pof.test" + req.url);
      res.writeHead(r.status, { "content-type": "application/json" });
      return res.end(await r.text());
    }
    const { id, method, params } = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    let result;
    const ctx = { slot: rpc.slot };
    if (method === "getSlot") result = await rpc.getSlot();
    else if (method === "getAccountInfo") result = { context: ctx, value: acc(await rpc.getAccount(params[0])) };
    else if (method === "getMultipleAccounts") result = { context: ctx, value: (await rpc.getAccounts(params[0])).map(acc) };
    else if (method === "getProgramAccounts")
      result = (await rpc.getProgramAccounts(params[0], params[1]?.filters ?? [])).map((a) => ({ pubkey: a.address, account: acc(a) }));
    else {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, logUrl: `${url}/api/attest/log`, close: () => new Promise((r) => server.close(r)) };
}
