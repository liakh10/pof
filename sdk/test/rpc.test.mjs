import { test } from "node:test";
import assert from "node:assert/strict";
import { Rpc, RpcError } from "../dist/index.js";

// a fake JSON-RPC endpoint that answers like mainnet since SIMD-0385: a version 1 transaction is only returned when the
// caller allows version 1, otherwise error -32015 (pump.fun create transactions come as v1)
const err = (req, tx) => ({ jsonrpc: "2.0", id: req.id, error: { code: -32015, message: `Transaction version (${tx.version}) is not supported by the requesting client.` } });
const ok = (req, tx) => ({ jsonrpc: "2.0", id: req.id, result: tx });
function node(tx) {
  const seen = [];
  const fetch = async (_url, init) => {
    const req = JSON.parse(init.body);
    seen.push(req);
    const max = req.params[1]?.maxSupportedTransactionVersion;
    const ver = tx.version === "legacy" ? -1 : tx.version;
    const body = (max ?? -1) < ver ? err(req, tx) : ok(req, tx); // no max: legacy only
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch, seen };
}

const v1 = {
  slot: 400000000,
  version: 1,
  blockTime: 1764000000,
  transaction: { signatures: ["sig"], message: { header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 }, accountKeys: ["a", "b"], recentBlockhash: "h", instructions: [] } },
  meta: { err: null, fee: 5000, logMessages: ["Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]", "Program log: Instruction: Create"] },
};

test("getTransactionLogs reads a version 1 transaction", async () => {
  const { fetch, seen } = node(v1);
  const rpc = new Rpc("http://rpc.invalid", { fetch });
  const logs = await rpc.getTransactionLogs("sig");
  assert.deepEqual(logs, v1.meta.logMessages);
  assert.equal(seen[0].method, "getTransaction");
  assert.equal(seen[0].params[1].maxSupportedTransactionVersion, 1);
  assert.equal(seen[0].params[1].encoding, "json");
});

test("getTransactionLogs still reads legacy and v0 transactions", async () => {
  for (const version of ["legacy", 0]) {
    const rpc = new Rpc("http://rpc.invalid", { fetch: node({ ...v1, version }).fetch });
    assert.deepEqual(await rpc.getTransactionLogs("sig"), v1.meta.logMessages);
  }
});

test("an RPC that refuses the version surfaces as RpcError with its code", async () => {
  const rpc = new Rpc("http://rpc.invalid", { fetch: node({ ...v1, version: 2 }).fetch });
  await assert.rejects(rpc.getTransactionLogs("sig"), (e) => e instanceof RpcError && e.code === -32015);
});
