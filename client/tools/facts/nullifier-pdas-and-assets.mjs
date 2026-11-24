/* POF rings facts: read-only mainnet/devnet reads behind RINGS.md. Uses the SDK installed in hush/node_modules and the Helius site keys in ~/.config/helius/site_keys (never printed). Run: node <file>.mjs */
import {rpc,b64} from './rpc.mjs';
import { createRequire } from 'node:module'; const r0=createRequire('/Users/artem/Desktop/sol/hush/package.json')('bs58'); const bs58=r0.default||r0;
const P='ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW';
const nps=await rpc('getProgramAccounts',[P,{encoding:'base64',filters:[{dataSize:11}]}]);
const idx=nps.map(x=>{const b=Buffer.from(x.account.data[0],'base64'); return {i:b.readBigUInt64LE(1), tail:b.subarray(9).toString('hex')};});
const is=idx.map(x=>x.i).sort((a,b)=>a<b?-1:1); const tails={}; idx.forEach(x=>tails[x.tail]=(tails[x.tail]||0)+1);
console.log('nullifier PDAs',nps.length,'min',is[0],'max',is[is.length-1],'tails',tails);
const regs=await rpc('getProgramAccounts',[P,{encoding:'base64',filters:[{dataSize:48}]}]);
const known={EPjFWdd5AufqSmeszrNsKKqUXrmCMssNqdM46b4LTqNZ:'USDC',Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB:'USDT',J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn:'JitoSOL',JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN:'JUP'};
const rows=regs.map(x=>{const b=Buffer.from(x.account.data[0],'base64'); return {pda:x.pubkey, mint:bs58.encode(b.subarray(8,40)), id:b.readBigUInt64LE(40)};});
for(const r of rows) if(known[r.mint]) console.log(known[r.mint], r);
console.log(rows.sort((a,b)=>Number(a.id-b.id)).slice(0,6));
