/* POF rings facts: read-only mainnet/devnet reads behind RINGS.md. Uses the SDK installed in hush/node_modules and the Helius site keys in ~/.config/helius/site_keys (never printed). Run: node <file>.mjs */
import fs from 'node:fs';
const KEY=fs.readFileSync(process.env.HOME+'/.config/helius/site_keys','utf8').split('\n')[3].trim();
const S='/Users/artem/Desktop/sol/hush/node_modules/@heliuslabs/spr/dist/';
const {SprApi}=await import(S+'api/index.js'); const {SprIndexer}=await import(S+'client/indexer.js');
for (const base of ['https://devnet.helius-rpc.com/v1/spr','https://api-devnet.helius-rpc.com/v1/spr']) { try { const ix=new SprIndexer(new SprApi({url:base, apiKey:KEY})); const n=new Uint8Array(32); n[31]=7; const r=await ix.getNonInclusionProofs('777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor',[n]); console.log(base.split('/')[2],'devnet indexer ok', r.context.slot, 'rootSeq', r.proofs[0].rootSeq); } catch(e){ console.log(base.split('/')[2],'err', e.code, JSON.stringify(e.details||{}).slice(0,200)); } }
// prover attest check: mainnet + devnet
const C=await import(S+'client/index.js');
for (const [net,url] of [['mainnet','https://mainnet.helius-rpc.com/v1/spr'],['devnet','https://devnet.helius-rpc.com/v1/spr']]) {
  try { const c=new C.SprClient({solanaRpcUrl:`https://${net}.helius-rpc.com/?api-key=${KEY}`, indexerUrl:url, proverUrl:url, apiKey:KEY, proverTee:C.SignedTeePolicy.forNetwork(net)}); const a=await c.attestProver?.(); console.log(net,'attest', a?Object.keys(a):a); } catch(e){ console.log(net,'client err', e.code||'', String(e.message).slice(0,200), JSON.stringify(e.details||{}).slice(0,200)); }
}
