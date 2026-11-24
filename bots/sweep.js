// Re-check everyone the bots let in. Discord: remove the role when a certificate stops passing.
// Telegram: in chats with /pof_evict on, remove the member (ban + unban, so they can request again later).
// Runs from a cron (parked before launch) and is safe to run twice.
import { K } from "./store.js";
import { evaluate, loadRoom } from "./gate.js";

// POF-15: everything is re-checked, in turns: each run works for at most `budgetMs`, then saves where it stopped and the
// next run goes on from there (wrapping round at the end).
export async function sweep(deps, { budgetMs = 40_000, now = () => Date.now() } = {}) {
  const { store, client, api, dapi } = deps;
  const out = { checked: 0, discordRemoved: 0, telegramRemoved: 0, errors: 0, complete: { discord: false, telegram: false } };
  const t0 = now();
  const cursor = (await store.get("sweep/cursor")) ?? { dc: null, tg: null };
  const turn = (keys, after) => {
    const i = after ? keys.findIndex((k) => k > after) : 0;
    return i < 0 ? [] : keys.slice(i);
  };
  const rooms = new Map();
  const room = async (addr) => {
    if (!rooms.has(addr)) rooms.set(addr, await loadRoom(client, addr));
    return rooms.get(addr);
  };

  if (dapi) {
    const keys = turn(await store.list("dc/grant/"), cursor.dc);
    out.complete.discord = true;
    for (const key of keys) {
      if (now() - t0 > budgetMs) {
        out.complete.discord = false;
        break;
      }
      cursor.dc = key;
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
    if (out.complete.discord) cursor.dc = null;
  }

  if (api) {
    const keys = turn(await store.list("tg/member/"), cursor.tg);
    out.complete.telegram = true;
    for (const key of keys) {
      if (now() - t0 > budgetMs) {
        out.complete.telegram = false;
        break;
      }
      cursor.tg = key;
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
    if (out.complete.telegram) cursor.tg = null;
  }
  await store.put("sweep/cursor", cursor);
  return out;
}
