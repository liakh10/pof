// Telegram gate bot. Webhook updates in, Bot API calls out.
// A group is bound to a pof_gate Room by an admin (/pof_bind <room>). The group's invite link asks for admin approval;
// the bot approves a join request when the requester's linked subject holds a live certificate that meets the Room.
import { K } from "./store.js";
import { linkUrl, subjectLabel, unlink } from "./link.js";
import { evaluate, loadRoom } from "./gate.js";

export function tgApi(env, f = fetch) {
  return async (method, body) => {
    const res = await f(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({ ok: false }));
    if (!j.ok) console.warn(`telegram ${method} failed: ${j.description ?? res.status}`);
    return j;
  };
}

const button = (text, url) => ({ inline_keyboard: [[{ text, url }]] });

function parseCommand(text = "") {
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+(.*))?$/is.exec(text.trim());
  return m ? { cmd: m[1].toLowerCase(), arg: (m[2] ?? "").trim() } : null;
}

async function isAdmin(api, chatId, userId) {
  const r = await api("getChatMember", { chat_id: chatId, user_id: userId });
  return r.ok && ["creator", "administrator"].includes(r.result?.status);
}

/** Check one user against one chat and act on the join request. */
export async function decideJoin(deps, chatId, userId, userChatId) {
  const { store, client, api } = deps;
  const binding = await store.get(K.tgChat(chatId));
  if (!binding) return { action: "ignored", reason: "chat not bound" };
  const room = await loadRoom(client, binding.room);
  if (!room) return { action: "ignored", reason: "room missing" };
  const link = await store.get(K.link("tg", userId));
  if (!link) {
    const pend = (await store.get(K.tgPending(userId))) ?? { chats: [] };
    if (!pend.chats.includes(chatId)) pend.chats.push(chatId);
    await store.put(K.tgPending(userId), pend);
    if (userChatId)
      await api("sendMessage", {
        chat_id: userChatId,
        text: `${binding.title ?? "This group"} is gated by Proof of Funds: ${room.minTierLabel}, live.\nLink the wallet, @handle or badge that holds your certificate, and your request is approved at once.`,
        reply_markup: button("Link my certificate", linkUrl(deps.env, { p: "tg", u: userId })),
        link_preview_options: { is_disabled: true },
      });
    return { action: "pending", reason: "not_linked" };
  }
  const v = await evaluate(client, room, link);
  if (v.ok) {
    await api("approveChatJoinRequest", { chat_id: chatId, user_id: userId });
    await store.put(K.tgMember(chatId, userId), { room: binding.room, subjectHash: link.subjectHash, at: v.slot });
    const pend = await store.get(K.tgPending(userId));
    if (pend) {
      pend.chats = pend.chats.filter((c) => c !== chatId);
      pend.chats.length ? await store.put(K.tgPending(userId), pend) : await store.del(K.tgPending(userId));
    }
    return { action: "approved", reason: "ok" };
  }
  await api("declineChatJoinRequest", { chat_id: chatId, user_id: userId });
  if (userChatId) await api("sendMessage", { chat_id: userChatId, text: `Not approved: ${v.text}` });
  return { action: "declined", reason: v.reason };
}

/** After a successful link: approve every join request this user left pending. */
export async function onLinked(deps, userId) {
  const pend = await deps.store.get(K.tgPending(userId));
  const out = [];
  for (const chatId of pend?.chats ?? []) out.push({ chatId, ...(await decideJoin(deps, chatId, userId, userId)) });
  return out;
}

export async function handleTelegramUpdate(update, deps) {
  const { store, client, api, env } = deps;

  if (update.chat_join_request) {
    const r = update.chat_join_request;
    return decideJoin(deps, r.chat.id, r.from.id, r.user_chat_id);
  }

  const msg = update.message;
  if (!msg?.text) return { action: "ignored" };
  const c = parseCommand(msg.text);
  if (!c) return { action: "ignored" };
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const reply = (text, extra = {}) => api("sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true }, ...extra });
  const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

  if (isGroup) {
    if (c.cmd === "pof_bind") {
      if (!(await isAdmin(api, chatId, userId))) return reply("Only a group admin can bind this group to a Room.");
      const room = await loadRoom(client, c.arg);
      if (!room) return reply("Send /pof_bind <room address>. The Room is the pof_gate account shown on the Rooms page.");
      await store.put(K.tgChat(chatId), { room: room.address, title: msg.chat.title ?? null, boundBy: userId, evict: false });
      return reply(
        `Bound to Room ${room.name || room.address}: ${room.minTierLabel}.\nNext: make me an admin with "Invite users", and turn on "Approve new members" on the invite link. I approve requests whose certificate is live and meets the Room.`,
      );
    }
    if (c.cmd === "pof_unbind") {
      if (!(await isAdmin(api, chatId, userId))) return reply("Only a group admin can unbind.");
      await store.del(K.tgChat(chatId));
      return reply("Unbound. I no longer act on join requests here.");
    }
    if (c.cmd === "pof_evict") {
      if (!(await isAdmin(api, chatId, userId))) return reply("Only a group admin can change this.");
      const b = await store.get(K.tgChat(chatId));
      if (!b) return reply("Bind a Room first: /pof_bind <room address>.");
      b.evict = c.arg.toLowerCase() !== "off";
      await store.put(K.tgChat(chatId), b);
      return reply(b.evict ? "On: members whose certificate is revoked or expires are removed (they can request again)." : "Off: I only gate new requests.");
    }
    if (c.cmd === "pof_status") {
      const b = await store.get(K.tgChat(chatId));
      if (!b) return reply("This group is not bound to a Room.");
      const room = await loadRoom(client, b.room);
      return reply(`Room ${room?.name || b.room}: ${room?.minTierLabel ?? "missing"}. Removal on revoke: ${b.evict ? "on" : "off"}.`);
    }
    return { action: "ignored" };
  }

  // private chat
  if (c.cmd === "start" || c.cmd === "link") {
    return reply(
      "I check Proof of Funds certificates for gated groups.\nLink the wallet, @handle or badge that holds your certificate. The link is yours only and expires soon.",
      { reply_markup: button("Link my certificate", linkUrl(env, { p: "tg", u: userId })) },
    );
  }
  if (c.cmd === "status" || c.cmd === "pof_check") {
    const link = await store.get(K.link("tg", userId));
    if (!link) return reply("Nothing linked yet. Send /link.");
    const r = await client.lookup(`${link.kind === 1 ? "x" : link.kind === 2 ? "badge" : "wallet"}:${link.value}`);
    const lines = r.certificates.map((x) => `· ${x.tierLabel}: ${x.effectiveStatus}`);
    return reply(`Linked: ${subjectLabel(link)}\n${lines.length ? lines.join("\n") : "No certificate yet."}`);
  }
  if (c.cmd === "unlink") {
    await unlink(store, "tg", userId);
    return reply("Unlinked.");
  }
  return reply("Commands: /link, /status, /unlink. In a group (admins): /pof_bind <room>, /pof_status, /pof_evict on|off, /pof_unbind.");
}
