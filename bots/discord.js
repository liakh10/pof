// Discord role bot over HTTP interactions. A server admin binds a Room and a role (/pof-setup);
// members run /pof-verify: a live certificate meeting the Room gets the role, anything else removes it.
import crypto from "node:crypto";
import { K } from "./store.js";
import { linkUrl, subjectLabel, unlink } from "./link.js";
import { evaluate, loadRoom, safeName } from "./gate.js";

const EPHEMERAL = 64;
const MANAGE_ROLES = 1n << 28n;
const ADMINISTRATOR = 1n << 3n;

export const COMMANDS = [
  {
    name: "pof-setup",
    description: "Bind this server to a Proof of Funds Room and the role its members get",
    default_member_permissions: String(MANAGE_ROLES),
    dm_permission: false,
    options: [
      { type: 3, name: "room", description: "The pof_gate Room address", required: true },
      { type: 8, name: "role", description: "The role to grant while the certificate is live", required: true },
    ],
  },
  { name: "pof-verify", description: "Check your Proof of Funds certificate and get the role", dm_permission: false },
  { name: "pof-status", description: "Show your linked subject and certificates", dm_permission: false },
  { name: "pof-unlink", description: "Unlink your subject from this Discord account", dm_permission: false },
];

/** Discord signs every interaction: ed25519 over timestamp ‖ raw body with the application's public key. */
export function verifyDiscordSignature(publicKeyHex, signatureHex, timestamp, rawBody) {
  try {
    if (!publicKeyHex || !signatureHex || !timestamp) return false;
    const key = crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKeyHex, "hex").toString("base64url") }, format: "jwk" });
    return crypto.verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

export function discordApi(env, f = fetch) {
  return async (method, path, body) => {
    const res = await f(`https://discord.com/api/v10${path}`, {
      method,
      headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "content-type": "application/json", "x-audit-log-reason": "Proof of Funds certificate check" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && res.status !== 404) console.warn(`discord ${method} ${path}: ${res.status}`);
    const json = res.status === 204 ? null : await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  };
}

const say = (content, components) => ({ type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] }, ...(components ? { components } : {}) } });
const linkButton = (url) => [{ type: 1, components: [{ type: 2, style: 5, label: "Link my certificate", url }] }];

/** Grant or remove the role for one member. Returns the evaluation. */
export async function syncMember(deps, guildId, userId) {
  const { store, client, dapi } = deps;
  const g = await store.get(K.dcGuild(guildId));
  if (!g) return { ok: false, reason: "not_setup", text: "This server is not set up yet. An admin runs /pof-setup." };
  const room = await loadRoom(client, g.room);
  if (!room) return { ok: false, reason: "room_missing", text: "The bound Room no longer exists. An admin runs /pof-setup again." };
  const link = await store.get(K.link("dc", userId));
  const v = await evaluate(client, room, link);
  const path = `/guilds/${guildId}/members/${userId}/roles/${g.role}`;
  if (v.ok) {
    const r = await dapi("PUT", path);
    if (!r.ok) return { ...v, ok: false, reason: "role_failed", text: "Your certificate passes, but I could not grant the role: my role must sit above it." };
    await store.put(K.dcGrant(guildId, userId), { role: g.role, room: g.room, subjectHash: link.subjectHash, at: v.slot });
  } else {
    const had = await store.get(K.dcGrant(guildId, userId));
    if (had) {
      await dapi("DELETE", path);
      await store.del(K.dcGrant(guildId, userId));
    }
  }
  return v;
}

/** null when the member may bind this role; otherwise the reason. */
export async function roleProblem(dapi, guildId, member, roleId) {
  if (!dapi) return "The bot is not configured with a token yet.";
  if (roleId === guildId) return "Pick a real role, not @everyone.";
  const [roles, guild] = await Promise.all([dapi("GET", `/guilds/${guildId}/roles`), dapi("GET", `/guilds/${guildId}`)]);
  if (!roles.ok || !Array.isArray(roles.json)) return "I could not read this server's roles. Check that I am in the server.";
  const target = roles.json.find((r) => r.id === roleId);
  if (!target) return "That role does not exist here.";
  if (target.managed) return "That role belongs to an integration; pick a normal role.";
  const isOwner = guild.ok && guild.json?.owner_id && guild.json.owner_id === member?.user?.id;
  if (isOwner) return null;
  const mine = new Set(member?.roles ?? []);
  const top = Math.max(0, ...roles.json.filter((r) => mine.has(r.id)).map((r) => r.position));
  if (target.position >= top) return "That role sits at or above your own highest role. Pick a lower one, or ask someone above it.";
  return null;
}

export async function handleDiscordInteraction(body, deps) {
  const { store, client, env } = deps;
  if (body.type === 1) return { type: 1 };
  if (body.type !== 2) return say("Unsupported interaction.");
  const guildId = body.guild_id;
  const user = body.member?.user ?? body.user;
  if (!guildId || !user) return say("Use these commands inside a server.");
  const name = body.data?.name;
  const opt = (n) => body.data?.options?.find((o) => o.name === n)?.value;

  if (name === "pof-setup") {
    const perms = BigInt(body.member?.permissions ?? "0");
    if (!(perms & MANAGE_ROLES) && !(perms & ADMINISTRATOR)) return say("You need Manage Roles to set this up.");
    const room = await loadRoom(client, opt("room"));
    if (!room) return say("That is not a pof_gate Room address. Copy it from the Rooms page.");
    const role = String(opt("role"));
    // POF-21: never let /pof-setup hand out a role the member could not grant themselves
    const why = await roleProblem(deps.dapi, guildId, body.member, role);
    if (why) return say(why);
    await store.put(K.dcGuild(guildId), { room: room.address, role, by: user.id });
    return say(`Bound to Room ${safeName(room)} (${room.minTierLabel}). Members run /pof-verify to get <@&${role}>. My own role must sit above it.`);
  }
  if (name === "pof-verify") {
    const link = await store.get(K.link("dc", user.id));
    if (!link) return say("Link the wallet, @handle or badge that holds your certificate first. Then run /pof-verify again.", linkButton(linkUrl(env, { p: "dc", u: user.id, g: guildId })));
    const v = await syncMember(deps, guildId, user.id);
    return say(v.ok ? `Verified: ${v.text} Role granted.` : v.text);
  }
  if (name === "pof-status") {
    const link = await store.get(K.link("dc", user.id));
    if (!link) return say("Nothing linked yet.", linkButton(linkUrl(env, { p: "dc", u: user.id, g: guildId })));
    const r = await client.lookup(`${link.kind === 1 ? "x" : link.kind === 2 ? "badge" : "wallet"}:${link.value}`);
    const lines = r.certificates.map((x) => `· ${x.tierLabel}: ${x.effectiveStatus}`);
    return say(`Linked: ${subjectLabel(link)}\n${lines.length ? lines.join("\n") : "No certificate yet."}`);
  }
  if (name === "pof-unlink") {
    await unlink(store, "dc", user.id);
    const had = await store.get(K.dcGrant(guildId, user.id));
    if (had) {
      await deps.dapi("DELETE", `/guilds/${guildId}/members/${user.id}/roles/${had.role}`);
      await store.del(K.dcGrant(guildId, user.id));
    }
    return say("Unlinked.");
  }
  return say("Unknown command.");
}
