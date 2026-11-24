// A mock Solana JSON-RPC for the benchmarks: N certificates, rooms with members, Config and Treasury, served with an
// injected latency (BENCH_RPC_MS, default 30 ms, about a Helius call from a nearby region), and a count of every method.
//   node bench/rpc.mjs <port>   (reads BENCH_VERIFIER, BENCH_CERTS, BENCH_ROOMS, BENCH_MEMBERS from env)
import http from "node:http";
import crypto from "node:crypto";
import * as sdk from "../sdk/dist/index.js";
import { MemoryRpc } from "../sdk/dist/testing.js";

const PORT = Number(process.argv[2] || 46990);
const LAT = Number(process.env.BENCH_RPC_MS ?? 30);
const N = Number(process.env.BENCH_CERTS ?? 5000);
const ROOMS = Number(process.env.BENCH_ROOMS ?? 50);
const MEMBERS = Number(process.env.BENCH_MEMBERS ?? 20);
const verifier = process.env.BENCH_VERIFIER;

const rpc = new MemoryRpc();
rpc.slot = 10_000_000;
const rnd = (seed) => sdk.encodeBase58(crypto.createHash("sha256").update(seed).digest());
const subjects = [];
for (let i = 0; i < N; i++) {
  const kind = i % 3; // wallet, x, badge
  const value = kind === 1 ? `user${i}` : rnd(`s${i}`);
  const subject = kind === 1 ? sdk.xSubject(value) : kind === 0 ? sdk.walletSubject(value) : sdk.badgeSubject(value);
  const status = i % 10 === 0 ? 1 : 0;
  await rpc.putCertificate({ subject, asset: i % 4 === 0 ? 1 : 0, tier: 1 + (i % 5), status, revokedSlot: status ? 9_999_000 : 0, expirySlot: 16_000_000, logIndex: i, verifier: verifier ?? undefined });
  subjects.push({ kind, value, query: kind === 1 ? `@${value}` : kind === 0 ? value : `badge:${value}` });
}
const rooms = [];
for (let r = 0; r < ROOMS; r++) {
  const creator = rnd(`creator${r}`);
  const [room] = await sdk.roomAddress(creator, r);
  rpc.putRoom(room, { creator, id: r, asset: 0, minTier: 2, memberCount: MEMBERS, name: `room ${r}` });
  for (let m = 0; m < MEMBERS; m++) {
    const s = subjects[(r * MEMBERS + m) % N];
    const subj = s.kind === 1 ? sdk.xSubject(s.value) : s.kind === 0 ? sdk.walletSubject(s.value) : sdk.badgeSubject(s.value);
    const h = await sdk.subjectHash(subj);
    const [cert] = await sdk.certificateAddress(h, 0);
    await rpc.putMember(room, subj, cert);
  }
  rooms.push(room);
}
const admin = rnd("admin");
await rpc.putConfig({
  admin, verifier: verifier ?? rnd("verifier"),
  params: { fee_lamports: 10_000_000, holder_min: 1_000_000_000_000n, validity_slots: 6_480_000, max_attest_age: 300, max_root_lag: 9000, rotation_delay: 216_000 },
  assets: [
    { enabled: true, mint: "So11111111111111111111111111111111111111112", decimals: 9, mins: [1e9, 1e10, 1e11, 1e12, 1e13] },
    { enabled: true, mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, mins: [1e8, 1e9, 1e10, 1e11, 1e12] },
    { enabled: false, mint: "11111111111111111111111111111111", decimals: 0, mins: [0, 0, 0, 0, 0] },
    { enabled: false, mint: "11111111111111111111111111111111", decimals: 0, mins: [0, 0, 0, 0, 0] },
  ],
});
await rpc.putTreasury({ certified: N, live: N - N / 10, revoked_spent: N / 10 });

const counts = {};
const b64 = (u8) => Buffer.from(u8).toString("base64");
const acc = (a) => (a ? { data: [b64(a.data), "base64"], executable: false, lamports: a.lamports, owner: a.owner, rentEpoch: 0, space: a.data.length } : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString();
  if (req.url === "/__stats") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ counts, subjects: subjects.map((s) => s.query), rooms }));
  }
  if (req.url === "/__reset") {
    for (const k of Object.keys(counts)) delete counts[k];
    res.writeHead(204);
    return res.end();
  }
  if (req.url === "/__treasury") {
    const t = JSON.parse(body);
    await rpc.putTreasury({ certified: N, live: N - N / 10, revoked_spent: N / 10, log_size: t.size, log_head: sdk.fromHex(t.root), log_slot: rpc.slot - 10 });
    res.writeHead(204);
    return res.end();
  }
  const msgs = JSON.parse(body || "{}");
  const one = async ({ id, method, params }) => {
    counts[method] = (counts[method] ?? 0) + 1;
    const ctx = { slot: rpc.slot };
    switch (method) {
      case "getSlot": return { jsonrpc: "2.0", id, result: rpc.slot };
      case "getHealth": return { jsonrpc: "2.0", id, result: "ok" };
      case "getBalance": return { jsonrpc: "2.0", id, result: { context: ctx, value: 1_500_000_000 } };
      case "getAccountInfo": return { jsonrpc: "2.0", id, result: { context: ctx, value: acc(await rpc.getAccount(params[0])) } };
      case "getMultipleAccounts": return { jsonrpc: "2.0", id, result: { context: ctx, value: (await rpc.getAccounts(params[0])).map(acc) } };
      case "getProgramAccounts": {
        const list = (await rpc.getProgramAccounts(params[0], params[1]?.filters ?? [])).map((a) => ({ pubkey: a.address, account: acc(a) }));
        return { jsonrpc: "2.0", id, result: params[1]?.withContext ? { context: ctx, value: list } : list };
      }
      case "getSignaturesForAddress": return { jsonrpc: "2.0", id, result: [] };
      case "getTransaction": return { jsonrpc: "2.0", id, result: null };
      default: return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
    }
  };
  await sleep(LAT);
  const out = Array.isArray(msgs) ? await Promise.all(msgs.map(one)) : await one(msgs);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(out));
});
server.listen(PORT, "127.0.0.1", () => process.stdout.write(`rpc ready ${PORT} certs=${N} rooms=${ROOMS}\n`));
