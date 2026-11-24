/* POF rings facts: read-only mainnet/devnet reads behind RINGS.md. Uses the SDK installed in hush/node_modules and the Helius site keys in ~/.config/helius/site_keys (never printed). Run: node <file>.mjs */
import fs from 'node:fs';
import {rpc,b64} from './rpc.mjs';
import { createRequire } from 'node:module'; const r0=createRequire('/Users/artem/Desktop/sol/hush/package.json')('bs58'); const bs58=r0.default||r0;
const S='/Users/artem/Desktop/sol/hush/node_modules/@heliuslabs/spr/dist/';
const {SprApi}=await import(S+'api/index.js'); const {SprIndexer}=await import(S+'client/indexer.js');
const H=await import(S+'hasher/index.js'); await H.initializePoseidon();
const U=await import(S+'transaction/utxo.js');
const KEY=fs.readFileSync(process.env.HOME+'/.config/helius/site_keys','utf8').split('\n')[3].trim();
const ix=new SprIndexer(new SprApi({url:'https://mainnet.helius-rpc.com/v1/spr', apiKey:KEY}));
const T='777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor', P='ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW'; const hx=b=>Buffer.from(b).toString('hex');
const sigs=await rpc('getSignaturesForAddress',[T,{limit:200}]);
let done=0;
for(const s of sigs){ if(s.err) continue; const tx=await rpc('getTransaction',[s.signature,{encoding:'json',maxSupportedTransactionVersion:1}]); const keys=tx.transaction.message.accountKeys;
 for(const ins of tx.transaction.message.instructions){ if(keys[ins.programIdIndex]!==P) continue; const d=bs58.decode(ins.data); if(d[0]!==15) continue;
  let o=1; const na=d[o++]; const kinds=[]; for(let i=0;i<na;i++){const k=d[o++]; kinds.push(k); if(k===1)o++;} const nd=d[o++];
  const deps=[]; for(let i=0;i<nd;i++){ const ai=d[o++]; const vt=d.slice(o,o+32);o+=32; const oh=d.slice(o,o+32);o+=32; const amt=Buffer.from(d.slice(o,o+8)).readBigUInt64LE(0);o+=8; const hasMemo=d[o++]; if(hasMemo){const L=d[o]|(d[o+1]<<8)|(d[o+2]<<16)|(d[o+3]<<24); o+=4+L;} deps.push({ai,vt:bs58.encode(vt),oh,amt,hasMemo}); }
  const r=await ix.getShieldedTransactionsBySignature(s.signature); const outs=r.transactions.flatMap(t=>t.transaction.outputSlots);
  for(const [i,dp] of deps.entries()){ const out=outs[i]; if(!out) continue; const li=BigInt(out.outputContext.leafIndex);
    const assetAcc = kinds[dp.ai]===0 ? '11111111111111111111111111111111' : null; if(!assetAcc){console.log('spl deposit skip');continue;}
    const blinding=U.depositBlinding(T, li);
    const ownerUtxo=H.poseidon([dp.oh, blinding]);
    const be8=new Uint8Array(32); new DataView(be8.buffer).setBigUint64(24,dp.amt,false);
    const tid=new Uint8Array(32); const dom=new Uint8Array(32); dom[31]=3;
    const assetF=H.hashBytes(new Uint8Array(bs58.decode(assetAcc)));
    const ringHash=H.poseidon([new Uint8Array(32),new Uint8Array(32)]);
    const c=H.poseidon([dom,tid,assetF,be8,new Uint8Array(32),ringHash,ownerUtxo]);
    console.log(s.signature.slice(0,10),'SOL deposit',Number(dp.amt)/1e9,'viewTag(wallet)',dp.vt.slice(0,8),'signer',keys[0].slice(0,8),'memo',dp.hasMemo,'leaf',li,'commit match', hx(c)===hx(out.outputContext.hash));
    done++; }
 }
 if(done>=3) break; }
