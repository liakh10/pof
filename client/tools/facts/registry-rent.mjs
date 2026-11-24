/* POF rings facts: read-only mainnet/devnet reads behind RINGS.md. Uses the SDK installed in hush/node_modules and the Helius site keys in ~/.config/helius/site_keys (never printed). Run: node <file>.mjs */
import {rpc,b64} from './rpc.mjs';
const r=await rpc('getProgramAccounts',['regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ',{encoding:'base64',dataSlice:{offset:0,length:2}}]);
console.log('registry records', r.length, 'lamports sample', r[0].account.lamports, r[0].pubkey);
const m=await rpc('getAccountInfo',[r[0].pubkey,{encoding:'base64'}]); console.log('len', b64(m.value).length);
console.log('rent 100B', await rpc('getMinimumBalanceForRentExemption',[100]), 'rent 11B', await rpc('getMinimumBalanceForRentExemption',[11]));
const s=await rpc('getSignaturesForAddress',[r[0].pubkey,{limit:5}]); const sig=s[s.length-1].signature; const tx=await rpc('getTransaction',[sig,{encoding:'json',maxSupportedTransactionVersion:1}]); console.log('reg tx fee', tx.meta.fee, 'version', tx.version, 'cu', tx.meta.computeUnitsConsumed, 'sigs', tx.transaction.signatures.length);
