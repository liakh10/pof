#!/usr/bin/env node
// pof: Proof of Funds from a terminal. Reads the chain through YOUR RPC (--rpc or SOLANA_RPC) and the Verifier's log
// (--origin <site> or --log <url>). Exit codes: 0 yes / verified, 1 no / failed, 2 usage or an unreachable service.
import * as sdk from "../sdk/dist/index.js";

const HELP = `pof ${sdk.SDK_VERSION}: Proof of Funds certificates, rooms and the transparency log

usage
  pof check <wallet|@handle|badge:<key>|hash> [--asset SOL|USDC] [--min-tier 1-5] [--verify-log]
  pof watch <subject> [--interval 10] [--max-events n]     print every status change as it happens
  pof rooms [<room address>]
  pof log head                                             the signed head, checked against the program's keys
  pof log proof <id> [--certificate <address>]             one entry with its inclusion proof, checked
  pof log verify                                           download the whole log, recompute it, check the anchor
  pof config | pof stats

options
  --rpc <url>       Solana RPC (or SOLANA_RPC). Every answer is read from chain.
  --origin <url>    the POF site (or POF_ORIGIN); the log is <origin>/api/attest/log
  --log <url>       the log endpoint itself (or POF_LOG_URL)
  --program <id>    another deployment of pof
  --json            machine-readable output
`;

function parse(argv) {
  const pos = [];
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (["json", "verify-log", "help", "version"].includes(k)) o[k] = true;
      else o[k] = argv[++i];
    } else pos.push(a);
  }
  return { pos, o };
}

class Usage extends Error {}

export async function main(argv, io = { out: (s) => process.stdout.write(s + "\n"), err: (s) => process.stderr.write(s + "\n"), env: process.env, fetch }) {
  const { pos, o } = parse(argv);
  const env = io.env;
  const json = !!o.json;
  const say = (human, data) => io.out(json ? JSON.stringify(data, null, 2) : human);
  if (o.version) return say(sdk.SDK_VERSION, { version: sdk.SDK_VERSION }), 0;
  if (o.help || !pos.length) return io.out(HELP), pos.length ? 0 : 2;

  const rpcUrl = o.rpc || env.SOLANA_RPC;
  const origin = (o.origin || env.POF_ORIGIN || "").replace(/\/$/, "");
  const logUrl = o.log || env.POF_LOG_URL || (origin ? `${origin}/api/attest/log` : null);
  const client = () => {
    if (!rpcUrl) throw new Usage("set --rpc <url> or SOLANA_RPC: pof reads the chain itself");
    return new sdk.PofClient({ rpc: new sdk.Rpc(rpcUrl, { fetch: io.fetch }), programId: o.program });
  };
  const reader = () => {
    if (!logUrl) throw new Usage("set --origin <site> (or --log <url>) to read the transparency log");
    return new sdk.LogReader(logUrl, io.fetch);
  };
  const keySet = async (c) => c.verifierKeys({ history: true, fromCertificates: true, maxTransactions: 200 }).catch(() => c.verifierKeys());
  const keys = async (c) => (await keySet(c)).all;
  const line = (c) =>
    `${c.assetSymbol.padEnd(4)} ${c.tierLabel.padEnd(16)} ${c.effectiveStatus.toUpperCase().padEnd(17)} ` +
    (c.live ? `until slot ${c.expirySlot}` : c.revokedSlot ? `at slot ${c.revokedSlot}` : `expired after slot ${c.expirySlot}`) +
    `  ${c.address}`;

  try {
    const [cmd, ...rest] = pos;
    if (cmd === "check") {
      if (!rest[0]) throw new Usage("pof check <subject>");
      const c = client();
      const asset = o.asset !== undefined ? sdk.parseAsset(o.asset) : undefined;
      const minTier = o["min-tier"] !== undefined ? Number(o["min-tier"]) : undefined;
      if (minTier !== undefined && asset === undefined) throw new Usage("--min-tier needs --asset");
      const r = await c.lookup(rest[0], { asset });
      let ok = r.certificates.some((x) => x.live);
      let reason = ok ? "ok" : r.certificates.length ? r.certificates[0].effectiveStatus : "no_certificate";
      if (minTier !== undefined) {
        const chk = await c.checkProofOfFunds({ subject: rest[0], asset, minTier });
        ok = chk.ok;
        reason = chk.reason;
      }
      const logs = [];
      if (o["verify-log"]) {
        const rd = reader();
        const ks = await keySet(c);
        const trusted = ks.all;
        for (const x of r.certificates) {
          if (x.logIndex === null) {
            logs.push({ certificate: x.address, ok: false, why: "no log index" });
            continue;
          }
          const head = await rd.head();
          const [e, p] = await Promise.all([rd.entry(x.logIndex), rd.proof(x.logIndex, head.treeSize)]);
          const v = await sdk.verifyLogEntry({ leaf: e.leaf, index: x.logIndex, proof: p, head, programId: c.programId, trustedKeys: trusted, headKeys: ks.active ? [ks.active] : [] });
          const m = v.leaf ? sdk.matchCertificateLeaf(x, v.leaf) : { matches: false, mismatched: ["leaf"] };
          logs.push({ certificate: x.address, logIndex: x.logIndex, ok: v.ok && m.matches, checks: v.checks, mismatched: m.mismatched });
        }
        if (logs.some((l) => !l.ok)) ok = false;
      }
      const human = [
        `${rest[0]}  ${ok ? "YES" : "NO"}${minTier !== undefined ? ` (needs ${sdk.tierLabel(asset, minTier)}: ${reason})` : reason === "ok" ? "" : ` (${reason})`}  as of slot ${r.slot}`,
        ...r.certificates.map((x) => "  " + line(x)),
        ...logs.map((l) => `  log entry ${l.logIndex ?? "-"}: ${l.ok ? "verified, holds this certificate's signed attestation" : `NOT verified (${[...Object.entries(l.checks ?? {}).filter(([, v]) => v === false).map(([k]) => k), ...(l.mismatched ?? [])].join(", ") || l.why})`}`),
      ];
      if (!r.certificates.length) human.push("  no certificate");
      say(human.join("\n"), { subject: rest[0], ok, reason, slot: r.slot, certificates: r.certificates, log: o["verify-log"] ? logs : undefined });
      return ok ? 0 : 1;
    }

    if (cmd === "watch") {
      if (!rest[0]) throw new Usage("pof watch <subject>");
      const c = client();
      const every = Math.max(1, Number(o.interval ?? 10)) * 1000;
      const max = o["max-events"] !== undefined ? Number(o["max-events"]) : Infinity;
      const sleep = io.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
      let prev = null;
      let events = 0;
      const key = (x) => `${x.address}|${x.effectiveStatus}|${x.tier}|${x.expirySlot}|${x.revokedSlot}`;
      for (;;) {
        let r;
        try {
          r = await c.lookup(rest[0]);
        } catch (e) {
          io.err(`rpc: ${e.message}`);
          await sleep(every);
          continue;
        }
        const now = new Map(r.certificates.map((x) => [x.address, x]));
        const emit = (kind, x) => {
          events++;
          const data = { at: new Date().toISOString(), slot: r.slot, kind, certificate: x ? { address: x.address, asset: x.assetSymbol, tier: x.tier, tierLabel: x.tierLabel, status: x.effectiveStatus, expirySlot: x.expirySlot, revokedSlot: x.revokedSlot } : null };
          io.out(json ? JSON.stringify(data) : `slot ${r.slot}  ${kind.padEnd(8)} ${x ? line(x) : rest[0] + ": no certificate"}`);
        };
        if (!prev) {
          if (!now.size) emit("none", null);
          for (const x of now.values()) emit("now", x);
        } else {
          for (const [a, x] of now) if (!prev.has(a)) emit("new", x);
            else if (key(prev.get(a)) !== key(x)) emit(x.effectiveStatus === "live" ? "changed" : x.effectiveStatus.startsWith("revoked") ? "REVOKED" : "changed", x);
          for (const [a, x] of prev) if (!now.has(a)) emit("closed", { ...x, effectiveStatus: "expired" });
        }
        prev = now;
        if (events >= max) return 0;
        await sleep(every);
      }
    }

    if (cmd === "rooms") {
      const c = client();
      if (rest[0]) {
        const r = await c.getRoomWithMembers(rest[0]);
        if (!r) return say(`no pof_gate room at ${rest[0]}`, { error: "not_found" }), 1;
        say(
          [`room ${r.room.address}  ${r.room.assetSymbol} ${r.room.minTierLabel}  ${r.members.filter((m) => m.live).length} of ${r.members.length} members live  (slot ${r.slot})`,
            `  name (set by its creator): ${JSON.stringify(r.room.name ?? "")}`,
            ...r.members.map((m) => `  ${m.live ? "live   " : "evictable"} ${m.subjectHash.slice(0, 16)}…  ${m.certificateStatus}${m.tier ? ` tier ${m.tier}` : ""}  ${m.address}`)].join("\n"),
          r,
        );
        return 0;
      }
      const rooms = await c.listRooms();
      say(rooms.length ? rooms.map((r) => `${r.address}  ${r.assetSymbol} ${r.minTierLabel}  ${r.memberCount} members  ${JSON.stringify(r.name ?? "")}`).join("\n") : "no rooms", { rooms });
      return 0;
    }

    if (cmd === "config") {
      const cfg = await client().getConfig();
      if (!cfg) return say("no pof Config on this cluster", { error: "not_found" }), 1;
      say([`verifier ${cfg.activeVerifier}${cfg.nextVerifier ? `  (next ${cfg.nextVerifier} from slot ${cfg.nextVerifierSlot})` : ""}`, `fee ${cfg.feeLamports} lamports  validity ${cfg.validitySlots} slots  paused ${cfg.paused}`,
        `a verifier proposed now waits ${cfg.rotationDelayAt(cfg.slot)} slots${cfg.heldUntil > cfg.slot ? ` (a lowered delay is held until slot ${cfg.heldUntil})` : ""}`,
        ...cfg.assets.filter((a) => a.enabled).map((a) => `asset ${a.id} ${sdk.ASSETS[a.id]?.symbol ?? "?"}  mins ${a.mins.join(" ")}`)].join("\n"), { ...cfg, raw: undefined });
      return 0;
    }

    if (cmd === "stats") {
      const s = await client().stats();
      say(`slot ${s.slot}: ${s.live} live, ${s.revokedSpent} revoked (spent), ${s.revokedByHolder} revoked (holder), ${s.expired} expired, ${s.total} certified`, { ...s, treasury: s.treasury ? { ...s.treasury } : null });
      return 0;
    }

    if (cmd === "log") {
      const sub = rest[0];
      const rd = reader();
      const c = rpcUrl ? client() : null;
      const ks = c ? await keySet(c) : null;
      const trusted = ks ? ks.all : null;
      const active = ks?.active ?? null;
      const programId = c?.programId ?? o.program ?? sdk.POF_PROGRAM_ID;
      if (sub === "head") {
        const h = await rd.head();
        const sig = await sdk.verifyTreeHead(h, programId);
        const keyOk = ks ? active === h.verifierKey : null; // heads: only the key active now (W-02)
        const t = c ? await c.getTreasury().catch(() => null) : null;
        const ok = sig && keyOk !== false;
        say([`head size ${h.treeSize} root ${h.rootHash}`, `  signature ${sig ? "valid" : "INVALID"}; key ${h.verifierKey} ${keyOk === null ? "(not checked: no --rpc)" : keyOk ? "is the program's active verifier key" : "is NOT the program's active verifier key"}`,
          t?.log ? `  anchored on chain: size ${t.log.treeSize} root ${t.log.rootHash} at slot ${t.log.slot}` : c ? "  no head anchored on chain yet" : ""].filter(Boolean).join("\n"), { head: h, signatureValid: sig, keyTrusted: keyOk, anchor: t?.log ?? null });
        return ok ? 0 : 1;
      }
      if (sub === "proof") {
        const id = Number(rest[1]);
        if (!Number.isInteger(id) || id < 0) throw new Usage("pof log proof <id>");
        const h = await rd.head();
        const [e, p] = await Promise.all([rd.entry(id), rd.proof(id, h.treeSize)]);
        if (!trusted) io.err("note: without --rpc the verifier key cannot be checked against the program");
        const v = await sdk.verifyLogEntry({ leaf: e.leaf, index: id, proof: p, head: h, programId, trustedKeys: trusted ?? [], headKeys: active ? [active] : [] });
        let match = null;
        if (o.certificate) {
          const acc = await c?.rpc.getAccount(o.certificate);
          match = acc ? sdk.matchCertificateLeaf(sdk.decodeCertificate(o.certificate, acc.data), v.leaf) : { matches: false, mismatched: ["certificate not found"] };
        }
        const ok = v.ok && (match ? match.matches : true);
        const a = v.leaf?.attestation;
        say([`entry ${id} of ${h.treeSize}: ${ok ? "VERIFIED" : "NOT VERIFIED"}`, ...Object.entries(v.checks).map(([k, x]) => `  ${k}: ${x}`),
          a ? `  ${["wallet", "x", "badge"][a.subjectKind]} subject ${a.subjectHash.slice(0, 16)}…  ${sdk.ASSETS[a.asset] ? sdk.tierLabel(a.asset, a.tier) : a.tier}  issued slot ${a.issuedSlot}  expiry slot ${a.expirySlot}` : "",
          match ? `  certificate ${o.certificate}: ${match.matches ? "matches" : `does NOT match (${match.mismatched.join(", ")})`}` : ""].filter(Boolean).join("\n"), { ...v, certificateMatch: match });
        return ok ? 0 : 1;
      }
      if (sub === "verify") {
        if (!trusted) throw new Usage("pof log verify needs --rpc: the verifier keys and the anchor come from chain");
        const t = await c.getTreasury().catch(() => null);
        const r = await sdk.auditLog({ reader: rd, programId, trustedKeys: trusted, headKeys: active ? [active] : [], anchor: t?.log ?? null, onProgress: json ? undefined : (d, n) => io.err(`  ${d}/${n} entries`) });
        say([`log size ${r.treeSize}: ${r.ok ? "VERIFIED" : "FAILED"}`, `  head signed by the active key: ${r.checks.headSigned}`, `  root recomputed from every entry: ${r.checks.rootRecomputed}`,
          `  entries signed by a listed key: ${r.checks.entriesSigned}/${r.treeSize}${r.checks.entriesBad.length ? ` (bad: ${r.checks.entriesBad.slice(0, 20).join(", ")})` : ""}`,
          `  anchor on chain: ${r.anchor ? `size ${r.anchor.treeSize} at slot ${r.anchor.slot}: ${r.checks.anchorMatches ? "matches the log" : "DOES NOT MATCH"}` : "none yet"}`,
          `  every entry is for this program: ${r.checks.programMatches}`].join("\n"), r);
        return r.ok ? 0 : 1;
      }
      throw new Usage("pof log head | proof <id> | verify");
    }
    throw new Usage(`unknown command ${cmd}; pof --help`);
  } catch (e) {
    if (e instanceof Usage) {
      io.err(e.message);
      return 2;
    }
    io.err(`error: ${e.message}`);
    return 2;
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) main(process.argv.slice(2)).then((code) => process.exit(code ?? 0));
