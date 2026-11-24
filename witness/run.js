#!/usr/bin/env node
// Run a witness anywhere:
//   node witness/run.js --origin https://<site> --rpc https://<your rpc> [--key ~/.config/pof/witness.json]
//                       [--out witness.json] [--name my-witness] [--loop 60] [--monitor]
// --monitor also checks that every certificate on chain is backed by the log entry it names (needs getProgramAccounts).
// --log <url> overrides the log endpoint (default <origin>/api/attest/log). Exit code 1 on an alarm (single run).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PofClient, LogReader } from "../sdk/dist/index.js";
import { Witness, signerFromSecret } from "./witness.js";
import { FileState } from "./store.js";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const origin = opt("origin", process.env.POF_ORIGIN);
const logUrl = opt("log", process.env.POF_LOG_URL || (origin ? `${origin.replace(/\/$/, "")}/api/attest/log` : null));
const rpc = opt("rpc", process.env.SOLANA_RPC);
if (!logUrl || !rpc) {
  console.error("usage: node witness/run.js --origin <site> --rpc <solana rpc> [--key file] [--out file] [--loop seconds]");
  process.exit(2);
}
const keyFile = opt("key", path.join(os.homedir(), ".config", "pof", "witness.json"));
if (!fs.existsSync(keyFile)) {
  console.error(`no witness key at ${keyFile}: run node witness/keygen.js first`);
  process.exit(2);
}
const signer = signerFromSecret(Uint8Array.from(JSON.parse(fs.readFileSync(keyFile, "utf8"))));
const w = new Witness({
  reader: new LogReader(logUrl),
  client: new PofClient({ rpc, programId: opt("program", undefined) }),
  signer,
  state: new FileState(opt("out", "witness.json")),
  name: opt("name", "pof-witness"),
  monitorCertificates: args.includes("--monitor"),
});
const loop = Number(opt("loop", 0));
const once = async () => {
  const r = await w.step();
  const t = new Date().toISOString();
  if (r.ok) console.log(`${t} cosigned size ${r.cosignature.treeSize} root ${r.cosignature.rootHash.slice(0, 16)}…${r.cosignature.anchor ? ` anchor ${r.cosignature.anchor.relation} @ slot ${r.cosignature.anchor.slot}` : " (no anchor on chain yet)"}`);
  else console.log(`${t} ALARM ${r.kind}: ${JSON.stringify(r.detail)}`);
  return r.ok;
};
if (!loop) process.exit((await once()) ? 0 : 1);
console.log(`witness ${signer.publicKey} watching ${logUrl} every ${loop}s`);
for (;;) {
  await once().catch((e) => console.log(`error: ${e.message}`));
  await new Promise((r) => setTimeout(r, loop * 1000));
}
