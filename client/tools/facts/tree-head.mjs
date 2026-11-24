/* POF rings facts: read-only mainnet/devnet reads behind RINGS.md. Uses the SDK installed in hush/node_modules and the Helius site keys in ~/.config/helius/site_keys (never printed). Run: node <file>.mjs */
const S='/Users/artem/Desktop/sol/hush/node_modules/@heliuslabs/spr/dist/';
const pda = await import(S+'interface/pda/index.js');
const codecs = await import(S+'interface/codecs/index.js');
const H = await import(S+'hasher/index.js');
await H.initializePoseidon();
const RPC='https://solana-rpc.publicnode.com';
async function rpc(method, params){const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json(); if(j.error) throw Error(JSON.stringify(j.error)); return j.result;}
for (const id of [0,1,2]) { const t=pda.treeAddress(id); const a=await rpc('getAccountInfo',[t,{encoding:'base64'}]); console.log('tree',id,t, a.value? {owner:a.value.owner,len:Buffer.from(a.value.data[0],'base64').length, lamports:a.value.lamports}:null, 'ctx',a.context.slot);
  if(a.value){const b=new Uint8Array(Buffer.from(a.value.data[0],'base64')); const r=codecs.decodeTreeHeadRoots(b); console.log({treeId:codecs.decodeTreeId(b), stateRoot:Buffer.from(r.stateRoot).toString('hex'), stateRootIndex:r.stateRootIndex, nullRoot:Buffer.from(r.nullifierRoot).toString('hex'), nullIdx:r.nullifierRootIndex}); console.log('fees',codecs.decodeTreeFees(b)); console.log('hdr', Buffer.from(b.subarray(0,160)).toString('hex'));}
}
const pc=await pda.protocolConfigAddress(); const a=await rpc('getAccountInfo',[pc,{encoding:'base64'}]); console.log('protocolConfig',pc, a.value && codecs.decodeProtocolConfigAccount(new Uint8Array(Buffer.from(a.value.data[0],'base64'))));
console.log('solInterface',pda.solInterfaceAddress(),'cpiAuth',pda.shieldedPoolCpiAuthorityAddress());
const usdc='EPjFWdd5AufqSmeszrNsKKqUXrmCMssNqdM46b4LTqNZ'; console.log('usdc registry', await pda.splAssetRegistryAddress(usdc), 'vault', await pda.splAssetVaultAddress(usdc));
const reg=await pda.splAssetRegistryAddress(usdc); const ra=await rpc('getAccountInfo',[reg,{encoding:'base64'}]); console.log('usdc reg', ra.value && codecs.decodeSplAssetRegistryAccount(new Uint8Array(Buffer.from(ra.value.data[0],'base64'))));
