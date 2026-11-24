// Start the mock RPC and the function harness as child processes.
import { spawn } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function start(file, port, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(here, file), String(port)], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] });
    p.stdout.on("data", (d) => {
      if (String(d).includes("ready")) resolve({ p, line: String(d).trim() });
    });
    p.on("exit", (c) => reject(new Error(`${file} exited ${c}`)));
  });
}

export async function world({ rpcPort, harnessPort, env = {}, harnessEnv = {} }) {
  const seed = crypto.randomBytes(32).toString("hex");
  const { V } = await import("../verifier/test/helpers.mjs");
  const verifierKey = V.signerFromSeed(new Uint8Array(Buffer.from(seed, "hex"))).address;
  const rpc = await start("rpc.mjs", rpcPort, { BENCH_VERIFIER: verifierKey, ...env });
  const RPC = `http://127.0.0.1:${rpcPort}`;
  const BASE = `http://127.0.0.1:${harnessPort}`;
  const harness = await start("harness.mjs", harnessPort, { SOLANA_RPC: RPC, POF_LOG_URL: `${BASE}/api/attest/log`, POF_STATUS_ORIGIN: BASE, BENCH_SEED: seed, ...env, ...harnessEnv });
  const w = await (await fetch(`${RPC}/__stats`)).json();
  const stop = () => {
    rpc.p.kill();
    harness.p.kill();
  };
  const reset = async (memo = true) => {
    await fetch(`${RPC}/__reset`);
    await fetch(`${BASE}/__reset?${memo ? "memo&" : ""}memoOff=0`);
  };
  const upstream = async () => ({ rpc: (await (await fetch(`${RPC}/__stats`)).json()).counts, harness: await (await fetch(`${BASE}/__stats`)).json() });
  return { RPC, BASE, subjects: w.subjects, rooms: w.rooms, stop, reset, upstream };
}
