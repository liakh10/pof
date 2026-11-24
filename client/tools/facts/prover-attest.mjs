/* POF rings facts: read-only. Uses ~/.config/helius/site_keys (never printed). Run: node <file>.mjs */
import fs from 'node:fs';
const KEY=fs.readFileSync(process.env.HOME+'/.config/helius/site_keys','utf8').split('\n')[3].trim();
const S='/Users/artem/Desktop/sol/pof/client/node_modules/@heliuslabs/spr/dist/';
const C=await import(S+'client/index.js');
for (const net of ['mainnet','devnet']) {
  const base=`https://${net}.helius-rpc.com/v1/spr?api-key=${KEY}`;
  try { const c=new C.SprClient({solanaRpcUrl:`https://${net}.helius-rpc.com/?api-key=${KEY}`, indexerUrl:`https://${net}.helius-rpc.com/v1/spr`, apiKey:KEY, proverUrl:base, proverTee:C.SignedTeePolicy.forNetwork(net)}); const a=await c.attestProver(); console.log(net,'attest ok', JSON.stringify(a,(k,v)=>typeof v==='bigint'?String(v):v).slice(0,200)); } catch(e){ console.log(net,'err', e.code||'', JSON.stringify(e.details||{}).slice(0,300), String(e.cause?.message||'').slice(0,200).replace(KEY,'K')); }
}
