/* POF rings facts: read-only mainnet/devnet reads behind RINGS.md. Uses the SDK installed in hush/node_modules and the Helius site keys in ~/.config/helius/site_keys (never printed). Run: node <file>.mjs */
import fs from 'node:fs';
import {rpc,b64} from './rpc.mjs';
const S='/Users/artem/Desktop/sol/hush/node_modules/@heliuslabs/spr/dist/';
const {SprApi}=await import(S+'api/index.js'); const {SprIndexer}=await import(S+'client/indexer.js');
const H=await import(S+'hasher/index.js'); await H.initializePoseidon();
const pda=await import(S+'interface/pda/index.js'); const codecs=await import(S+'interface/codecs/index.js'); const st=await import(S+'interface/state.js');
const KEY=fs.readFileSync(process.env.HOME+'/.config/helius/site_keys','utf8').split('\n')[3].trim();
const ix=new SprIndexer(new SprApi({url:'https://mainnet.helius-rpc.com/v1/spr', apiKey:KEY}));
const T='777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor'; const hx=b=>Buffer.from(b).toString('hex');
// walk back signatures of the tree to an old one
let before; let sigs=[]; for(let i=0;i<4;i++){ const s=await rpc('getSignaturesForAddress',[T,{limit:1000,...(before?{before}:{})}]); if(!s.length)break; sigs=s; before=s[s.length-1].signature; }
let found=null;
for (const s of sigs.slice(-60)) { const r=await ix.getShieldedTransactionsBySignature(s.signature); for(const t of r.transactions){ const tx=t.transaction; if(tx.nullifiers.length && !found) found={sig:s.signature,slot:s.slot,tx}; } if(found) break; }
console.log('old tx', found.sig.slice(0,12), found.slot, 'nullifiers', found.tx.nullifiers.length, 'outputs', found.tx.outputSlots.length, 'proofless', found.tx.proofless);
const nf=found.tx.nullifiers[0];
const np=await pda.nullifierPdaAddress(T,nf); const a=await rpc('getAccountInfo',[np,{encoding:'base64'}]); console.log('nullifier PDA',np, a.value?{owner:a.value.owner,data:Buffer.from(a.value.data[0],'base64').toString('hex')}:null);
try{ const r=await ix.getNonInclusionProofs(T,[nf]); const p=r.proofs[0]; console.log('noninclusion for spent nf returned', hx(p.lowElement)===hx(nf)?'low==nf':'low!=nf', p.lowElementIndex); 
  let cur=H.poseidon([p.lowElement,p.highElement]); let idx=BigInt(p.lowElementIndex); for(const s of p.path){ cur=(idx&1n)?H.poseidon([s,cur]):H.poseidon([cur,s]); idx>>=1n;} console.log('membership path recompute == root', hx(cur)===hx(p.root));
}catch(e){console.log('noninclusion err', e.code, JSON.stringify(e.details||{}).slice(0,300), e.cause && (e.cause.message||'').slice(0,300));}
// state inclusion of an output
const out=found.tx.outputSlots[0]; console.log('output ctx', out.outputContext.leafIndex, out.outputContext.tree);
const mp=await ix.getMerkleProofs(T,[out.outputContext.hash]); const m=mp.proofs[0];
let cur=m.leaf; let idx=BigInt(m.leafIndex); for(const s of m.path){ cur=(idx&1n)?H.poseidon([s,cur]):H.poseidon([cur,s]); idx>>=1n;}
console.log('state proof pathlen',m.path.length,'leafIndex',m.leafIndex,'recompute==root',hx(cur)===hx(m.root),'rootIndex',m.rootIndex,'rootSeq',m.rootSeq);
const ta=await rpc('getAccountInfo',[T,{encoding:'base64'}]); const tb=b64(ta.value);
const inHist=[...Array(500).keys()].some(i=>hx(tb.subarray(st.UTXO_ROOT_HISTORY_OFFSET+i*32,st.UTXO_ROOT_HISTORY_OFFSET+i*32+32))===hx(m.root)); console.log('state root in on-chain history', inHist, 'at index', m.rootIndex, hx(tb.subarray(st.UTXO_ROOT_HISTORY_OFFSET+m.rootIndex*32,st.UTXO_ROOT_HISTORY_OFFSET+m.rootIndex*32+32))===hx(m.root));
// header fields 
const dv=new DataView(tb.buffer,tb.byteOffset); console.log('hdr: cursor',dv.getUint16(112,true),'len',dv.getUint16(114,true),'cap',dv.getUint16(116,true),'subtrees',tb[118], 'u64@40',dv.getBigUint64(40,true),'u64@48',dv.getBigUint64(48,true),'u64@56',dv.getBigUint64(56,true),'u64@64',dv.getBigUint64(64,true),'u64@72',dv.getBigUint64(72,true));
console.log('stateRoot@80 == current', hx(tb.subarray(80,112))===hx(codecs.decodeTreeHeadRoots(tb).stateRoot));
