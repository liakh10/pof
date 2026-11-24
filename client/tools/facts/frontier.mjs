/* POF rings facts: read-only mainnet/devnet reads behind RINGS.md. Uses the SDK installed in hush/node_modules and the Helius site keys in ~/.config/helius/site_keys (never printed). Run: node <file>.mjs */
import {rpc,b64} from './rpc.mjs';
const S='/Users/artem/Desktop/sol/hush/node_modules/@heliuslabs/spr/dist/';
const H=await import(S+'hasher/index.js'); await H.initializePoseidon(); const codecs=await import(S+'interface/codecs/index.js');
const hx=b=>Buffer.from(b).toString('hex');
const ta=await rpc('getAccountInfo',['777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor',{encoding:'base64'}]); const tb=b64(ta.value); const dv=new DataView(tb.buffer,tb.byteOffset);
const next=dv.getBigUint64(72,true); const root=codecs.decodeTreeHeadRoots(tb).stateRoot;
const zeros=[new Uint8Array(32)]; for(let i=0;i<32;i++) zeros.push(H.poseidon([zeros[i],zeros[i]]));
for (const base of [128]) { let cur=zeros[0]; for(let i=0;i<32;i++){ const f=tb.subarray(base+i*32,base+i*32+32); cur=((next>>BigInt(i))&1n)?H.poseidon([f,cur]):H.poseidon([cur,zeros[i]]);} console.log('frontier at',base,'root match',hx(cur)===hx(root)); }
console.log('next',next,'slot@120?',dv.getBigUint64(120,true));
