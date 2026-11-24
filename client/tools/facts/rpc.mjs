/* POF rings facts: read-only mainnet/devnet reads behind RINGS.md. Uses the SDK installed in hush/node_modules and the Helius site keys in ~/.config/helius/site_keys (never printed). Run: node <file>.mjs */
import fs from 'node:fs';
const keys=fs.readFileSync(process.env.HOME+'/.config/helius/site_keys','utf8').split('\n').map(s=>s.trim()).filter(Boolean);
let k=Number(process.env.KI||3);
export const RPCURL=()=>`https://mainnet.helius-rpc.com/?api-key=${keys[k%keys.length]}`;
export async function rpc(method, params){ for(let t=0;t<keys.length;t++){ const r=await fetch(RPCURL(),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}); if(r.status===429||r.status===401||r.status===403){k++;continue;} const j=await r.json(); if(j.error){ if(/rate|credit|limit/i.test(j.error.message)){k++;continue;} throw Error(String(j.error.message).slice(0,200)); } return j.result;} throw Error('no key answered'); }
export const b64=x=>new Uint8Array(Buffer.from(x.data[0],'base64'));
