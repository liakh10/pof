/* Every refusal a holder can meet on the way to a certificate, as one sentence that says what to do. Codes come from the
   Verifier (verifier/src), the Rings proxies (client/server/spr-proxy.js), the client itself and the chain's simulation.
   explain(error) → { code, title, action, retry, silent, waitSlots? }. The site shows title + action; it never shows a raw
   stack. No fixed times: waits are in slots and rounded seconds at 0.4 s a slot. */
const T = {
  // the wallet
  DECLINED: ['You declined in the wallet.', 'Nothing was sent. Start again when you are ready.', true],
  NO_WALLET: ['No Solana wallet in this browser.', 'Install Phantom, Solflare or Backpack, then reload the page.', false],
  DERIVE_REFUSED: ['This wallet cannot make a Rings identity here.', 'Use the POF vault instead: it needs only a plain signature.', false],
  LOW_SOL: ['Not enough SOL in the wallet for this.', 'It needs the amount plus the network fee and, the first time, 0.00116 SOL of rent for the vault record.', false],
  SIMULATION: ['The network refused this transaction before you signed it.', 'Nothing was sent. Try again; if it repeats, the details are in the console.', true],
  EXPIRED_TX: ['The network was slow and the transaction expired.', 'Sign it once more.', true],
  // the hasher and the Rings services
  HASHER: ['The Rings hasher did not load.', 'Check the connection and try again (it is 420 KB, loaded once).', true],
  RATE_LIMITED: ['Too many requests from this connection.', 'Wait a little and try again.', true],
  RINGS_UNAVAILABLE: ['Helius Privacy Rings did not answer.', 'Try again in a moment. Your funds are not affected.', true],
  INDEXER_UNAVAILABLE: ['The Rings indexer did not answer.', 'Try again in a moment. Your funds are not affected.', true],
  NO_KEY: ['This deployment cannot reach Privacy Rings yet.', 'Try again later.', false],
  RPC_UNAVAILABLE: ['The Solana network did not answer.', 'Try again in a moment.', true],
  // the vault and its notes
  NO_VAULT: ['Make your POF vault first.', 'One signature in your wallet makes it; nothing is sent on chain.', false],
  NO_RING: ['The vault is not registered yet.', 'Register it once (a small transaction, 0.00116 SOL of rent you can see on chain).', false],
  BELOW_TIER: ['The vault does not hold enough for that tier.', 'Shield more into the vault, or pick a lower tier.', false],
  NOTE_TOO_NEW: ['Your newest note is too fresh to certify.', 'Wait until it is older, so the certificate cannot be paired with the shield that just happened.', true],
  NOTE_SPENT: ['A note you picked was already spent.', 'Sync the vault again and certify with what is left.', true],
  NOTE_IN_USE: ['A note you picked already backs a live certificate.', 'Revoke that certificate first, or shield a new note for this one.', false],
  NOT_IN_TREE: ['A note does not match the Rings tree.', 'Sync the vault again; if it repeats, the note may have been made by another app.', true],
  NULLIFIER_KEY_MISMATCH: ['The vault keys do not match the vault record.', 'Make the vault again with the same wallet and try once more.', false],
  NULLIFIER_UNPROVEN: ['Rings could not prove the notes unspent just now.', 'Try again in a moment.', true],
  STALE_ROOT: ['The Rings tree moved while we checked.', 'Try again.', true],
  ROOT_TOO_OLD: ['The Rings tree read is too old.', 'Try again.', true],
  MIXED_TREES: ['The notes come from different Rings trees.', 'Certify with notes from one tree.', false],
  DUPLICATE_NOTES: ['A note was sent twice.', 'Sync again and retry.', true],
  // subjects
  SUBJECT_PROOF_STALE: ['The subject signature is too old.', 'Sign again; it takes a fresh slot.', true],
  BAD_SUBJECT_PROOF: ['The subject signature did not check out.', 'Sign again with the wallet you are certifying.', true],
  BAD_CONTROLLER: ['The certificate key is missing or wrong.', 'Start again from the subject step.', true],
  LINK_EXPIRED: ['The X link expired.', 'Post a fresh code from the handle and link again.', true],
  BAD_HANDLE: ['That is not an X handle.', 'A handle is 1 to 15 letters, digits or underscores.', false],
  X_UNAVAILABLE: ['X did not answer the handle check.', 'Try again in a moment.', true],
  NO_CODE: ['The code was not found in the post.', 'Post the exact code from the handle, then check again.', true],
  // the vault key (audit POF-11) and privacy (POF-12)
  VAULT_CHANGED: ['This wallet opened a different vault than before.', 'Use the wallet and device you made the vault with, or import your backup file.', false],
  VAULT_BACKUP_NEEDED: ['Back up your vault key first.', 'Your wallet does not sign the same way twice, so the vault key lives only on this device: download the backup with a passphrase.', false],
  PASSPHRASE_NEEDED: ['Choose a passphrase for the backup.', 'At least 10 characters; you need it to restore the vault on another device.', false],
  BAD_PASSPHRASE: ['That passphrase does not open the backup.', 'Try again with the passphrase you chose.', true],
  RELAY_NEEDED: ['The relayer is off right now.', 'Paying from your wallet would link it to this subject in public. Wait for the relayer, or confirm that you accept the link.', true],
  PAYER_LINKS_WALLET: ['Paying from your wallet links it to this subject in public.', 'Use the relayer, or confirm that you accept the link.', false],
  // the relayer
  RELAY_OFF: ['The relayer is off right now.', 'Submit the certificate from your own wallet.', false],
  RELAY_CAP: ['The relayer reached its spending cap for now.', 'Submit from your own wallet, or try later.', true],
  RELAY_LOW: ['The relayer is low on SOL.', 'Submit from your own wallet, or try later.', true],
  RELAY_NOT_FOR_WALLETS: ['A wallet certificate is submitted by the wallet itself.', 'Turn off the relayer for a wallet subject.', false],
  NOT_PAID: ['The certificate fee has not arrived yet.', 'Wait for the payment to confirm, then try again.', true],
  QUOTE_EXPIRED: ['The fee quote expired.', 'Ask for a new quote.', true],
  ATTESTATION_EXPIRED: ['The Verifier signature expired before it reached the chain.', 'Certify again; it takes seconds.', true],
  CHAIN_REJECTED: ['The POF program refused the certificate.', 'Try again; if it repeats, the details are in the console.', true],
};
const LOW = /insufficient (lamports|funds)|0x1\b|"Custom":1\b|InsufficientFunds/i;
export function explain(e) {
  if (!e) return { code: 'UNKNOWN', title: 'Something went wrong.', action: 'Try again.', retry: true };
  let code = e.code || (e.declined || e.silent ? 'DECLINED' : '');
  const msg = String(e.message || e);
  if (!code || code === 'ERROR') {
    if (/simulation failed/i.test(msg)) code = LOW.test(msg + JSON.stringify(e.logs || [])) ? 'LOW_SOL' : 'SIMULATION';
    else if (/expired/i.test(msg) || e.expired) code = 'EXPIRED_TX';
    else if (/hasher/i.test(msg)) code = 'HASHER';
    else if (/Connect a wallet/i.test(msg)) code = 'NO_WALLET';
    else if (/Make your POF vault/i.test(msg)) code = 'NO_VAULT';
    else if (/not enough in the vault/i.test(msg)) code = 'BELOW_TIER';
  }
  const t = T[code];
  const out = t ? { code, title: t[0], action: t[1], retry: t[2] } : { code: code || 'UNKNOWN', title: msg.slice(0, 160) || 'Something went wrong.', action: 'Try again.', retry: true };
  if (code === 'DECLINED') out.silent = true;
  const wait = e.details?.waitSlots ?? e.pick?.waitSlots;
  if (wait) { out.waitSlots = wait; out.action = `Wait about ${Math.max(1, Math.round(wait * 0.4))} s (${wait} slots), then try again.`; }
  return out;
}
export const CODES = Object.keys(T);
