#!/usr/bin/env node
// One-time Discord setup: register the slash commands globally for the application.
//   DISCORD_APP_ID=… DISCORD_BOT_TOKEN=… node bots/register-discord.mjs
// Never prints the token. Prints the invite URL with the permissions the bot needs (Manage Roles).
import { COMMANDS } from "./discord.js";

const { DISCORD_APP_ID, DISCORD_BOT_TOKEN } = process.env;
if (!DISCORD_APP_ID || !DISCORD_BOT_TOKEN) {
  console.error("set DISCORD_APP_ID and DISCORD_BOT_TOKEN");
  process.exit(1);
}
const r = await fetch(`https://discord.com/api/v10/applications/${DISCORD_APP_ID}/commands`, {
  method: "PUT",
  headers: { authorization: `Bot ${DISCORD_BOT_TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify(COMMANDS),
});
console.log(`register commands: ${r.status} ${r.ok ? "ok" : await r.text()}`);
console.log(`invite: https://discord.com/oauth2/authorize?client_id=${DISCORD_APP_ID}&scope=bot%20applications.commands&permissions=268435456`);
