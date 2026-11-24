#!/usr/bin/env node
// Make a witness key: ed25519, written as a 64-byte JSON array (Solana keypair format) with mode 600.
// Prints only the public key. Never overwrites an existing key.
//   node witness/keygen.js [path]     default ~/.config/pof/witness.json
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { encodeBase58 } from "../sdk/dist/index.js";

const file = process.argv[2] || path.join(os.homedir(), ".config", "pof", "witness.json");
if (fs.existsSync(file)) {
  const b = Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")));
  console.log(`exists: ${file}\nwitness public key: ${encodeBase58(b.subarray(32))}`);
  process.exit(0);
}
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const seed = Buffer.from(privateKey.export({ format: "jwk" }).d, "base64url");
const pub = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
fs.writeFileSync(file, JSON.stringify([...seed, ...pub]), { mode: 0o600, flag: "wx" });
fs.chmodSync(file, 0o600);
console.log(`written: ${file} (mode 600)\nwitness public key: ${encodeBase58(pub)}`);
