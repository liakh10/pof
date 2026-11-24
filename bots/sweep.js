// Re-check everyone the bots let in. Discord: remove the role when a certificate stops passing.
// Telegram: in chats with /pof_evict on, remove the member (ban + unban, so they can request again later).
// Runs from a cron (parked before launch) and is safe to run twice.
import { K } from "./store.js";
import { evaluate, loadRoom } from "./gate.js";

export async function sweep(deps, { max = 500 } = {}) {
  const { store, client, api, dapi } = deps;
  const out = { checked: 0, discordRemoved: 0, telegramRemoved: 0, errors: 0 };
  const rooms = new Map();
  const room = async (addr) => {
    if (!rooms.has(addr)) rooms.set(addr, await loadRoom(client, addr));
    return rooms.get(addr);
  };

  if (dapi) {
    for (const key of (await store.list("dc/grant/")).slice(0, max)) {
      const [, , guildId, userId] = key.split("/");
      try {
        const grant = await store.get(key);
        const r = await room(grant.room);
        const link = await store.get(K.link("dc", userId));
        const v = r ? await evaluate(client, r, link) : { ok: false };
        out.checked++;
        if (!v.ok || !link || link.subjectHash !== grant.subjectHash) {
          await dapi("DELETE", `/guilds/${guildId}/members/${userId}/roles/${grant.role}`);
          await store.del(key);
          out.discordRemoved++;
        }
      } catch {
        out.errors++;
      }
    }
  }

  if (api) {
    for (const key of (await store.list("tg/member/")).slice(0, max)) {
      const [, , chatId, userId] = key.split("/");
      try {
        const binding = await store.get(K.tgChat(chatId));
        if (!binding) {
          await store.del(key);
          continue;
        }
        const r = await room(binding.room);
        const link = await store.get(K.link("tg", userId));
        const v = r ? await evaluate(client, r, link) : { ok: false };
        out.checked++;
        if (v.ok && link?.subjectHash) continue;
        if (binding.evict) {
          await api("banChatMember", { chat_id: Number(chatId), user_id: Number(userId), until_date: Math.floor(Date.now() / 1000) + 60 });
          await api("unbanChatMember", { chat_id: Number(chatId), user_id: Number(userId), only_if_banned: true });
          out.telegramRemoved++;
        }
        await store.del(key);
      } catch {
        out.errors++;
      }
    }
  }
  return out;
}
