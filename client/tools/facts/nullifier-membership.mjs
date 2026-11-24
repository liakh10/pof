/* POF rings facts: read-only mainnet/devnet reads behind RINGS.md. Uses the SDK installed in hush/node_modules and the Helius site keys in ~/.config/helius/site_keys (never printed). Run: node <file>.mjs */
import fs from 'node:fs';
import {rpc,b64} from './rpc.mjs';
const S='/Users/artem/Desktop/sol/hush/node_modules/@heliuslabs/spr/dist/';
const {SprApi}=await import(S+'api/index.js');
const H=await import(S+'hasher/index.js'); await H.initializePoseidon();
const KEY=fs.readFileSync(process.env.HOME+'/.config/helius/site_keys','utf8').split('\n')[3].trim();
const T='777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor';
const sig='4QcJMxtNyeKi';
async function raw(method, params){ const r=await fetch(`https://mainnet.helius-rpc.com/v1/spr/${method}?api-key=${KEY}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'x',method,params})}); return (await r.text()).slice(0,700); }
const s=await rpc('getSignaturesForAddress',[T,{limit:1000}]);
// get an old nullifier via api
const {SprIndexer}=await import(S+'client/indexer.js'); const ix=new SprIndexer(new SprApi({url:'https://mainnet.helius-rpc.com/v1/spr', apiKey:KEY}));
let before; let sigs; for(let i=0;i<4;i++){ const q=await rpc('getSignaturesForAddress',[T,{limit:1000,...(before?{before}:{})}]); sigs=q; before=q[q.length-1].signature;}
let nf; for(const x of sigs.slice(-60)){ const r=await ix.getShieldedTransactionsBySignature(x.signature); for(const t of r.transactions) if(t.transaction.nullifiers.length){nf=t.transaction.nullifiers[0];break;} if(nf)break;}
import { createRequire } from 'node:module'; const r0=createRequire('/Users/artem/Desktop/sol/hush/package.json')('bs58'); const bs58=r0.default||r0; const h=bs58.encode(Buffer.from(nf));
console.log('nonIncl spent:', await raw('getNonInclusionProofs',{treeAccount:T,leaves:[h]}));
console.log('merkle by nf:', await raw('getMerkleProofs',{treeAccount:T,leaves:[h]}));
// find slot value in tree


const v=BigInt('0x'+Buffer.from(nf).toString('hex'))+1n; const nb=Buffer.from(v.toString(16).padStart(64,'0'),'hex');
const r=await ix.getNonInclusionProofs(T,[new Uint8Array(nb)]); const p=r.proofs[0]; const hx=b=>Buffer.from(b).toString('hex');
console.log('nf     ', hx(nf)); console.log('low    ', hx(p.lowElement), p.lowElementIndex, 'high', hx(p.highElement).slice(0,16));
let cur=H.poseidon([p.lowElement,p.highElement]); let idx=BigInt(p.lowElementIndex); for(const s of p.path){ cur=(idx&1n)?H.poseidon([s,cur]):H.poseidon([cur,s]); idx>>=1n;}
console.log('low==nf', hx(p.lowElement)===hx(nf), 'path->root', hx(cur)===hx(p.root), 'rootIndex', p.rootIndex, 'rootSeq', p.rootSeq);
const ta=await rpc('getAccountInfo',[T,{encoding:'base64'}]); const tb=b64(ta.value); console.log('root in on-chain nullifier history', [...Array(100).keys()].some(i=>hx(tb.subarray(17232+i*32,17264+i*32))===hx(p.root)), 'cursor', new DataView(tb.buffer,tb.byteOffset).getBigUint64(17224,true));
