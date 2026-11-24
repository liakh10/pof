// Bots against mocks: a recorded Telegram Bot API, a recorded Discord REST API, signed Discord interactions,
// the in-memory chain from the API fixtures, and real ed25519 wallet signatures for the link step.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as sdk from "../../sdk/dist/index.js";
import { makeWorld } from "../../api/v1/_test/fixtures.mjs";
import { MemoryStore, K } from "../store.js";
import { makeLinkToken, linkMessage, checkLinkToken } from "../link.js";
import { telegramWebhook, discordWebhook, linkSubmit, linkPage, sweepRun } from "../handlers.js";

const env = {
  BOT_LINK_SECRET: "x".repeat(40), SITE_URL: "https://pof.test", TG_BOT_TOKEN: "tg-test", TG_WEBHOOK_SECRET: "hook-secret",
  DISCORD_BOT_TOKEN: "dc-test", CRON_SECRET: "cron-secret",
};
let w, store, tgCalls, dcCalls, deps, discordKey;
const admins = new Set();

function wallet() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const address = sdk.encodeBase58(Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url"));
  return { address, sign: (text) => sdk.encodeBase58(crypto.sign(null, Buffer.from(text), privateKey)) };
}

beforeEach(async () => {
  w = await makeWorld();
  store = new MemoryStore();
  tgCalls = [];
  dcCalls = [];
  admins.clear();
  const api = async (method, body) => {
    tgCalls.push({ method, body });
    if (method === "getChatMember") return { ok: true, result: { status: admins.has(body.user_id) ? "administrator" : "member" } };
    return { ok: true, result: true };
  };
  const dapi = async (method, path) => {
    dcCalls.push({ method, path });
    if (method === "GET" && path.endsWith("/roles")) return { ok: true, status: 200, json: [{ id: "444", position: 1, managed: false }] };
    if (method === "GET") return { ok: true, status: 200, json: { owner_id: "333" } };
    return { ok: true, status: 204, json: null };
  };
  const kp = crypto.generateKeyPairSync("ed25519");
  discordKey = kp;
  deps = { env: { ...env, DISCORD_PUBLIC_KEY: Buffer.from(kp.publicKey.export({ format: "jwk" }).x, "base64url").toString("hex") }, store, client: w.client, api, dapi };
});

const tg = (update, secret = env.TG_WEBHOOK_SECRET) =>
  telegramWebhook({ method: "POST", headers: { "x-telegram-bot-api-secret-token": secret }, rawBody: JSON.stringify(update) }, deps);
const groupMsg = (text, from = 7, chat = -100) => ({ message: { text, from: { id: from }, chat: { id: chat, type: "supergroup", title: "Whales" } } });
const joinReq = (user, chat = -100) => ({ chat_join_request: { chat: { id: chat, title: "Whales" }, from: { id: user }, user_chat_id: user, date: 1 } });

async function link(p, u, wal, g = "") {
  const tok = makeLinkToken(env, { p, u, g });
  const proof = wal.sign(linkMessage(tok));
  return linkSubmit({ method: "POST", rawBody: JSON.stringify({ ...tok, subject: { kind: 0, value: wal.address }, proof }) }, deps);
}

async function certify(wal, tier, extra = {}) {
  return w.rpc.putCertificate({ subject: sdk.walletSubject(wal.address), asset: 0, tier, expirySlot: 9000, ...extra });
}

test("link tokens expire, bind the platform user, and reject tampering", () => {
  const tok = makeLinkToken(env, { p: "tg", u: 42 });
  assert.equal(checkLinkToken(env, tok), null);
  assert.equal(checkLinkToken(env, { ...tok, u: "43" }), "bad token");
  assert.equal(checkLinkToken(env, { ...tok, p: "dc" }), "bad token");
  assert.match(checkLinkToken(env, tok, Date.now() + 3600_000), /expired/);
  assert.equal(checkLinkToken(env, { ...tok, t: "AAAA" }), "bad token");
  assert.throws(() => makeLinkToken({ BOT_LINK_SECRET: "short" }, { p: "tg", u: 1 }));
});

test("telegram: webhook secret is enforced", async () => {
  assert.equal((await tg(groupMsg("/pof_status"), "wrong")).status, 401);
  assert.equal((await telegramWebhook({ method: "GET", headers: {}, rawBody: "" }, deps)).status, 405);
  assert.equal((await tg(groupMsg("/pof_status"))).status, 200);
});

test("telegram: only admins bind; a linked whale is approved, an unlinked user is held then approved after linking", async () => {
  await tg(groupMsg(`/pof_bind ${w.room}`, 7));
  assert.match(tgCalls.at(-1).body.text, /Only a group admin/);
  admins.add(7);
  await tg(groupMsg(`/pof_bind@PofBot ${w.room}`, 7));
  assert.match(tgCalls.at(-1).body.text, /Bound to Room "whales": ≥ 100 SOL/);
  assert.equal((await store.get(K.tgChat(-100))).room, w.room);

  // unlinked requester: kept pending, DM'd a personal link
  const alice = wallet();
  await certify(alice, 4);
  tgCalls.length = 0;
  await tg(joinReq(1001));
  assert.equal(tgCalls.some((c) => c.method === "approveChatJoinRequest"), false);
  const dm = tgCalls.find((c) => c.method === "sendMessage");
  assert.equal(dm.body.chat_id, 1001);
  const url = new URL(dm.body.reply_markup.inline_keyboard[0][0].url);
  assert.equal(url.pathname, "/link");
  assert.equal(url.searchParams.get("u"), "1001");
  assert.deepEqual((await store.get(K.tgPending(1001))).chats, [-100]);

  // she links her wallet: the pending request is approved in the same call
  tgCalls.length = 0;
  const r = await link("tg", 1001, alice);
  const body = JSON.parse(r.body);
  assert.equal(r.status, 200, r.body);
  assert.equal(body.results[0].action, "approved");
  assert.deepEqual(tgCalls.find((c) => c.method === "approveChatJoinRequest").body, { chat_id: -100, user_id: 1001 });
  assert.equal(await store.get(K.tgPending(1001)), null);
  assert.ok(await store.get(K.tgMember(-100, 1001)));

  // a linked small holder is declined with the reason
  const bob = wallet();
  await certify(bob, 2);
  await link("tg", 1002, bob);
  tgCalls.length = 0;
  await tg(joinReq(1002));
  assert.ok(tgCalls.find((c) => c.method === "declineChatJoinRequest"));
  assert.match(tgCalls.find((c) => c.method === "sendMessage").body.text, /≥ 10 SOL; this room needs ≥ 100 SOL/);

  // a linked whale requesting later is approved straight away
  const carol = wallet();
  await certify(carol, 5);
  await link("tg", 1003, carol);
  tgCalls.length = 0;
  await tg(joinReq(1003));
  assert.ok(tgCalls.find((c) => c.method === "approveChatJoinRequest"));

  // a chat that is not bound is left alone
  tgCalls.length = 0;
  await tg(joinReq(1003, -999));
  assert.equal(tgCalls.length, 0);
});

test("telegram: private commands /start, /status, /unlink", async () => {
  const pm = (text, from = 55) => ({ message: { text, from: { id: from }, chat: { id: from, type: "private" } } });
  await tg(pm("/start"));
  assert.ok(tgCalls.at(-1).body.reply_markup.inline_keyboard[0][0].url.includes("u=55"));
  await tg(pm("/status"));
  assert.match(tgCalls.at(-1).body.text, /Nothing linked/);
  const dave = wallet();
  await certify(dave, 3);
  await link("tg", 55, dave);
  await tg(pm("/status"));
  assert.match(tgCalls.at(-1).body.text, /≥ 100 SOL: live/);
  await tg(pm("/unlink"));
  assert.equal(await store.get(K.link("tg", 55)), null);
});

test("link: bad signatures, wrong key, expired token, and one subject per account", async () => {
  const eve = wallet();
  const tok = makeLinkToken(env, { p: "tg", u: 9 });
  let r = await linkSubmit({ method: "POST", rawBody: JSON.stringify({ ...tok, subject: { kind: 0, value: eve.address }, proof: wallet().sign(linkMessage(tok)) }) }, deps);
  assert.match(JSON.parse(r.body).error, /does not match/);
  r = await linkSubmit({ method: "POST", rawBody: JSON.stringify({ ...tok, subject: { kind: 0, value: eve.address }, proof: "zzz" }) }, deps);
  assert.equal(r.status, 400);
  // a signature for user 9 cannot link user 10
  const tok10 = makeLinkToken(env, { p: "tg", u: 10 });
  r = await linkSubmit({ method: "POST", rawBody: JSON.stringify({ ...tok10, subject: { kind: 0, value: eve.address }, proof: eve.sign(linkMessage(tok)) }) }, deps);
  assert.match(JSON.parse(r.body).error, /does not match/);
  // the same wallet linked by a second account moves away from the first
  await link("tg", 9, eve);
  r = await link("tg", 10, eve);
  assert.equal(JSON.parse(r.body).movedFromAnotherAccount, true);
  assert.equal(await store.get(K.link("tg", 9)), null);
  // X handles: signed by the controller of the handle's certificate, read from chain (POF-03: no bearer link id)
  const ctl = wallet();
  await w.rpc.putCertificate({ subject: sdk.xSubject("handlecase"), asset: 0, tier: 3, expirySlot: 9000, controller: ctl.address });
  const tx = makeLinkToken(env, { p: "tg", u: 11 });
  const xlink = (value, proof) => linkSubmit({ method: "POST", rawBody: JSON.stringify({ ...tx, subject: { kind: 1, value }, proof }) }, deps);
  r = await xlink("@handlecase", wallet().sign(linkMessage(tx)));
  assert.match(JSON.parse(r.body).error, /not by the key that controls/);
  r = await xlink("@nocert", ctl.sign(linkMessage(tx)));
  assert.match(JSON.parse(r.body).error, /no certificate yet/);
  r = await xlink("@HandleCase", ctl.sign(linkMessage(tx)));
  assert.equal(JSON.parse(r.body).linked, "@handlecase");
  // the page and the message endpoint
  assert.match(linkPage({ query: {} }, deps).body, /Link your certificate/);
  const m = JSON.parse(linkPage({ query: { ...tx, message: "1" } }, deps).body);
  assert.equal(m.message, linkMessage(tx));
});

function signedDiscord(body) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.sign(null, Buffer.from(ts + raw), discordKey.privateKey).toString("hex");
  return discordWebhook({ method: "POST", headers: { "x-signature-ed25519": sig, "x-signature-timestamp": ts }, rawBody: raw }, deps);
}
const cmd = (name, user = "222", options = [], permissions = "0") => ({
  type: 2, guild_id: "111", member: { user: { id: user }, permissions }, data: { name, options },
});

test("discord: signatures are verified, PING answers PONG", async () => {
  let r = await signedDiscord({ type: 1 });
  assert.deepEqual(JSON.parse(r.body), { type: 1 });
  r = await discordWebhook({ method: "POST", headers: { "x-signature-ed25519": "00".repeat(64), "x-signature-timestamp": "1" }, rawBody: '{"type":1}' }, deps);
  assert.equal(r.status, 401);
});

test("discord: setup needs Manage Roles; verify grants and removes the role", async () => {
  let r = JSON.parse((await signedDiscord(cmd("pof-setup", "333", [{ name: "room", value: w.room }, { name: "role", value: "444" }]))).body);
  assert.match(r.data.content, /need Manage Roles/);
  r = JSON.parse((await signedDiscord(cmd("pof-setup", "333", [{ name: "room", value: "nope" }, { name: "role", value: "444" }], String(1n << 28n)))).body);
  assert.match(r.data.content, /not a pof_gate Room/);
  r = JSON.parse((await signedDiscord(cmd("pof-setup", "333", [{ name: "room", value: w.room }, { name: "role", value: "444" }], String(1n << 28n)))).body);
  assert.match(r.data.content, /Bound to Room "whales"/);
  assert.equal(r.data.flags, 64);

  // not linked yet: a personal link button
  r = JSON.parse((await signedDiscord(cmd("pof-verify", "222"))).body);
  const btn = r.data.components[0].components[0];
  assert.equal(btn.style, 5);
  assert.equal(new URL(btn.url).searchParams.get("g"), "111");

  // linking from the page grants the role at once
  const frank = wallet();
  const cert = await certify(frank, 3);
  const lr = JSON.parse((await link("dc", "222", frank, "111")).body);
  assert.equal(lr.results[0].ok, true);
  assert.deepEqual(dcCalls.at(-1), { method: "PUT", path: "/guilds/111/members/222/roles/444" });

  r = JSON.parse((await signedDiscord(cmd("pof-verify", "222"))).body);
  assert.match(r.data.content, /^Verified/);
  r = JSON.parse((await signedDiscord(cmd("pof-status", "222"))).body);
  assert.match(r.data.content, /≥ 100 SOL: live/);

  // the money moves: the keeper revokes; the next sweep removes the role
  await w.rpc.putCertificate({ subject: sdk.walletSubject(frank.address), asset: 0, tier: 3, status: 1, revokedSlot: 4999, expirySlot: 9000 });
  dcCalls.length = 0;
  let s = await sweepRun({ headers: { authorization: "Bearer wrong" } }, deps);
  assert.equal(s.status, 401);
  s = JSON.parse((await sweepRun({ headers: { authorization: `Bearer ${env.CRON_SECRET}` } }, deps)).body);
  assert.equal(s.discordRemoved, 1);
  assert.deepEqual(dcCalls[0], { method: "DELETE", path: "/guilds/111/members/222/roles/444" });
  assert.equal(await store.get(K.dcGrant("111", "222")), null);
  s = JSON.parse((await sweepRun({ headers: { authorization: `Bearer ${env.CRON_SECRET}` } }, deps)).body);
  assert.equal(s.discordRemoved, 0, "a second sweep does nothing");

  // verify after revocation says why
  r = JSON.parse((await signedDiscord(cmd("pof-verify", "222"))).body);
  assert.match(r.data.content, /funds moved/);
  r = JSON.parse((await signedDiscord(cmd("pof-unlink", "222"))).body);
  assert.equal(r.data.content, "Unlinked.");
  void cert;
});

test("telegram sweep removes revoked members only where eviction is on", async () => {
  admins.add(7);
  await tg(groupMsg(`/pof_bind ${w.room}`, 7));
  const gina = wallet();
  await certify(gina, 4);
  await link("tg", 2001, gina);
  await tg(joinReq(2001));
  await w.rpc.putCertificate({ subject: sdk.walletSubject(gina.address), asset: 0, tier: 4, status: 2, revokedSlot: 4999, expirySlot: 9000 });
  let s = JSON.parse((await sweepRun({ headers: { authorization: `Bearer ${env.CRON_SECRET}` } }, deps)).body);
  assert.equal(s.telegramRemoved, 0, "eviction is off by default");
  // re-admit and turn eviction on
  await w.rpc.putCertificate({ subject: sdk.walletSubject(gina.address), asset: 0, tier: 4, expirySlot: 9000 });
  await tg(joinReq(2001));
  await tg(groupMsg("/pof_evict on", 7));
  await w.rpc.putCertificate({ subject: sdk.walletSubject(gina.address), asset: 0, tier: 4, status: 1, revokedSlot: 4999, expirySlot: 9000 });
  tgCalls.length = 0;
  s = JSON.parse((await sweepRun({ headers: { authorization: `Bearer ${env.CRON_SECRET}` } }, deps)).body);
  assert.equal(s.telegramRemoved, 1);
  assert.deepEqual(tgCalls.map((c) => c.method), ["banChatMember", "unbanChatMember"]);
  assert.equal(tgCalls[1].body.only_if_banned, true);
});

test("paused and unconfigured bots answer clearly", async () => {
  const s = await sweepRun({ headers: { authorization: `Bearer ${env.CRON_SECRET}` } }, { ...deps, env: { ...deps.env, BOTS_PAUSED: "1" } });
  assert.deepEqual(JSON.parse(s.body), { paused: true });
  const t = await telegramWebhook({ method: "POST", headers: {}, rawBody: "{}" }, { ...deps, env: {} });
  assert.equal(t.status, 503);
  const d = await discordWebhook({ method: "POST", headers: {}, rawBody: "{}" }, { ...deps, env: {} });
  assert.equal(d.status, 503);
});

test("POF-21: /pof-setup refuses a role at or above the member's own, @everyone and managed roles; the owner may bind any", async () => {
  const roles = [
    { id: "111", position: 0, managed: false }, // @everyone (id = guild id)
    { id: "500", position: 5, managed: false }, // the member's top role
    { id: "400", position: 4, managed: false },
    { id: "600", position: 6, managed: false },
    { id: "700", position: 3, managed: true },
  ];
  deps.dapi = async (method, path) => {
    dcCalls.push({ method, path });
    if (path === "/guilds/111/roles") return { ok: true, status: 200, json: roles };
    if (path === "/guilds/111") return { ok: true, status: 200, json: { owner_id: "999" } };
    return { ok: true, status: 204, json: null };
  };
  const setup = (role, user = "333", memberRoles = ["500"]) => {
    const b = cmd("pof-setup", user, [{ name: "room", value: w.room }, { name: "role", value: role }], String(1n << 28n));
    b.member.roles = memberRoles;
    return signedDiscord(b).then((r) => JSON.parse(r.body).data.content);
  };
  assert.match(await setup("600"), /at or above your own highest role/);
  assert.match(await setup("500"), /at or above your own highest role/);
  assert.match(await setup("111"), /not @everyone/);
  assert.match(await setup("700"), /integration/);
  assert.match(await setup("888"), /does not exist/);
  assert.match(await setup("400"), /Bound to Room "whales"/);
  assert.match(await setup("600", "999", []), /Bound to Room/, "the server owner may bind any role");
});

test("POF-15: the sweep re-checks everyone in turns, past any fixed cap, and saves where it stopped", async () => {
  // 30 granted members whose certificates are all revoked
  await store.put(K.dcGuild("111"), { room: w.room, role: "444" });
  for (let i = 0; i < 30; i++) {
    const wal = wallet();
    await w.rpc.putCertificate({ subject: sdk.walletSubject(wal.address), asset: 0, tier: 4, status: 1, revokedSlot: 4999, expirySlot: 9000 });
    const { saveLink } = await import("../link.js");
    const { rec } = await saveLink(store, { p: "dc", u: String(1000 + i) }, { kind: 0, value: wal.address });
    await store.put(K.dcGrant("111", String(1000 + i)), { role: "444", room: w.room, subjectHash: rec.subjectHash, at: 1 });
  }
  const { sweep } = await import("../sweep.js");
  let t = 0;
  const now = () => (t += 10); // each check "takes" 10 ms
  let total = 0;
  let r = await sweep({ ...deps, api: null }, { budgetMs: 100, now });
  total += r.discordRemoved;
  assert.equal(r.complete.discord, false);
  assert.ok(r.discordRemoved > 0 && r.discordRemoved < 30);
  assert.ok((await store.get("sweep/cursor")).dc);
  for (let i = 0; i < 10 && total < 30; i++) {
    r = await sweep({ ...deps, api: null }, { budgetMs: 100, now });
    total += r.discordRemoved;
  }
  assert.equal(total, 30);
  assert.equal((await store.list("dc/grant/")).length, 0);
});

test("POF-24: creator-chosen room names reach chats without links or markup", async () => {
  const { safeName } = await import("../gate.js");
  assert.equal(safeName({ name: "[claim](https://evil.example) @everyone", address: "x" }), '"claim everyone"');
  assert.equal(safeName({ name: "", address: "Addr" }), "Addr");
  assert.equal(safeName({ name: "whales‮ evil.xyz/path", address: "x" }), '"whales"');
});
