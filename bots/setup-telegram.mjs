#!/usr/bin/env node
// One-time Telegram setup: point the bot's webhook at this deployment and publish its commands.
//   TG_BOT_TOKEN=… TG_WEBHOOK_SECRET=… SITE_URL=https://<site> node bots/setup-telegram.mjs
// Never prints the token.
const { TG_BOT_TOKEN, TG_WEBHOOK_SECRET, SITE_URL } = process.env;
if (!TG_BOT_TOKEN || !TG_WEBHOOK_SECRET || !SITE_URL) {
  console.error("set TG_BOT_TOKEN, TG_WEBHOOK_SECRET (the same value as in Vercel env) and SITE_URL");
  process.exit(1);
}
const call = async (method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}),
  });
  const j = await r.json();
  console.log(`${method}: ${j.ok ? "ok" : `FAILED ${j.description}`}`);
  return j;
};
const me = await call("getMe");
if (me.ok) console.log(`bot: @${me.result.username}`);
await call("setWebhook", {
  url: `${SITE_URL.replace(/\/$/, "")}/api/bots/telegram`,
  secret_token: TG_WEBHOOK_SECRET,
  allowed_updates: ["message", "chat_join_request"],
  drop_pending_updates: true,
});
await call("setMyCommands", {
  commands: [
    { command: "link", description: "Link the wallet, handle or badge that holds your certificate" },
    { command: "status", description: "Your linked subject and certificates" },
    { command: "unlink", description: "Unlink" },
  ],
  scope: { type: "all_private_chats" },
});
await call("setMyCommands", {
  commands: [
    { command: "pof_bind", description: "Bind this group to a Room: /pof_bind <room address>" },
    { command: "pof_status", description: "The Room this group is bound to" },
    { command: "pof_evict", description: "on|off: remove members whose certificate is revoked" },
    { command: "pof_unbind", description: "Stop gating this group" },
  ],
  scope: { type: "all_chat_administrators" },
});
const info = await call("getWebhookInfo");
if (info.ok) console.log(`webhook: ${info.result.url} · pending ${info.result.pending_update_count}${info.result.last_error_message ? ` · last error: ${info.result.last_error_message}` : ""}`);
