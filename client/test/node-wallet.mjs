/* A wallet for Node tests and the lab harness: a local keypair behind the same interface as wallet.js
   (state, signBytes, signText, toWeb3, send, setChain). Local validators only. */
import { Keypair, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
export function nodeWallet(rpcUrl, keypair = Keypair.generate()) {
  let id = 0;
  const rpc = async (method, params) => { const r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }); const j = await r.json(); if (j.error) throw Object.assign(Error(j.error.message), { data: j.error.data }); return j.result; };
  const secret = keypair.secretKey.slice(0, 32);
  const W = {
    keypair, rpc,
    setChain() {},
    state: () => ({ address: keypair.publicKey.toBase58(), wallet: 'node' }),
    connect: async () => W.state(),
    signBytes: async bytes => ed25519.sign(bytes, secret),
    signText: async text => ed25519.sign(new TextEncoder().encode(text), secret),
    toWeb3: ix => new TransactionInstruction({ programId: new PublicKey(ix.programAddress), keys: ix.accounts.map(a => ({ pubkey: new PublicKey(a.address), isSigner: a.role >= 2, isWritable: (a.role & 1) === 1 })), data: Buffer.from(ix.data) }),
    async send(instructions, { cosigners = [] } = {}) {
      const { blockhash, lastValidBlockHeight } = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
      const tx = new Transaction({ feePayer: keypair.publicKey, blockhash, lastValidBlockHeight });
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })); for (const ix of instructions) tx.add(ix);
      tx.partialSign(keypair);
      const msg = tx.serializeMessage();
      for (const s of cosigners) tx.addSignature(new PublicKey(s.publicKey), Buffer.from(await s.sign(msg)));
      const signature = await rpc('sendTransaction', [tx.serialize().toString('base64'), { encoding: 'base64', preflightCommitment: 'confirmed' }]);
      return { signature, wait: async () => { for (let i = 0; i < 60; i++) { const s = (await rpc('getSignatureStatuses', [[signature]])).value[0]; if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) { if (s.err) throw Error('failed: ' + JSON.stringify(s.err)); return { signature, slot: BigInt(s.slot) }; } await new Promise(r => setTimeout(r, 400)); } throw Error('not confirmed'); } };
    },
    async airdrop(sol) { const sig = await rpc('requestAirdrop', [keypair.publicKey.toBase58(), Math.round(sol * 1e9)]); for (let i = 0; i < 60; i++) { const s = (await rpc('getSignatureStatuses', [[sig]])).value[0]; if (s && s.confirmationStatus) return; await new Promise(r => setTimeout(r, 400)); } },
  };
  return W;
}
