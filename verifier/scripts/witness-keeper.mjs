/* An independent keeper (audit POF-01), in one file: anyone registered in keepers.json runs this with their own X25519
   secret and their own Solana key and RPC, and revokes spent certificates without us.
     POF_ESCROW_URL=https://<site>/api/keeper/escrow  KEEPER_KID=<kid>  KEEPER_X25519=<hex secret file>
     KEEPER_SOLANA_KEY=<keypair json file>  SOLANA_RPC=<url>  node scripts/witness-keeper.mjs [--once]
   It reads the escrow, opens its own envelopes, checks each disclosed nullifier's PDA (CONTRACT §5 path (a)) on its RPC,
   and sends revoke_spent signed by its own key. It needs nothing from our servers but the escrow listing (a mirror works). */
import fs from 'node:fs';
const V = await import(new URL('../dist/pof-verifier.mjs', import.meta.url));
const web3 = await import('@solana/web3.js');
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`set ${k}`); process.exit(2); } return v; };
const url = need('POF_ESCROW_URL'), kid = need('KEEPER_KID');
const secret = Buffer.from(fs.readFileSync(need('KEEPER_X25519'), 'utf8').trim(), 'hex');
const me = V.signerFromJson(fs.readFileSync(need('KEEPER_SOLANA_KEY'), 'utf8'), 'keeper key');
const rpcUrl = need('SOLANA_RPC');
const program = process.env.POF_PROGRAM || V.PROGRAM_ID;
const conn = new web3.Connection(rpcUrl, 'confirmed');
const SPP = new web3.PublicKey('ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW');

const chain = await V.makeProgramChain({ web3, rpcUrl, programId: program, relayer: me, verifier: me, rings: null });
async function pass() {
  let after = '', revoked = 0, watched = 0;
  for (;;) {
    const r = await fetch(`${url}?after=${encodeURIComponent(after)}&limit=200`).then(x => x.json());
    for (const e of r.entries || []) {
      const env = e.envelopes.find(x => x.kid === kid);
      if (!env) continue;
      let kit; try { kit = V.openEnvelope(secret, kid, Buffer.from(e.attestationHash, 'hex'), env); } catch { continue; }
      const cert = await chain.certificate(Buffer.from(kit.subjectHash, 'hex'), kit.asset);
      if (!cert || cert.status !== 0 || !kit.kit.every(x => cert.hashes.includes(x.h))) continue;
      watched++;
      for (const x of kit.kit) {
        const pda = web3.PublicKey.findProgramAddressSync([Buffer.from('nullifier'), new web3.PublicKey(kit.tree).toBuffer(), Buffer.from(x.nullifier, 'hex')], SPP)[0];
        const a = await conn.getAccountInfo(pda);
        if (!a || !a.owner.equals(SPP) || a.data.length !== 11 || a.data[0] !== 8) continue;
        const t = await chain.revokeSpent({ subjectHash: Buffer.from(kit.subjectHash, 'hex'), asset: kit.asset, index: cert.hashes.indexOf(x.h), salt: Buffer.from(x.salt, 'hex'), nullifier: Buffer.from(x.nullifier, 'hex'), tree: kit.tree });
        console.log(`revoked ${cert.address} (note ${cert.hashes.indexOf(x.h)}) in ${t.signature}`); revoked++; break;
      }
    }
    if (!r.next || !(r.entries || []).length) break;
    after = r.next;
  }
  console.log(JSON.stringify({ watched, revoked, at: new Date().toISOString() }));
}
do { await pass().catch(e => console.error('pass failed:', e.message)); if (process.argv.includes('--once')) break; await new Promise(r => setTimeout(r, 20_000)); } while (true);
