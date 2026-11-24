/* ed25519 keys. A key arrives as a Solana keypair JSON (64 numbers: seed ‖ public key), from an env var on Vercel or a file
   in ~/.config/pof locally. The secret never leaves this module and is never logged. */
import { ed25519 } from '@noble/curves/ed25519.js';
import { PofError, equal, toB58 } from './codec.js';

export interface Signer { publicKey: Uint8Array; address: string; sign(msg: Uint8Array): Uint8Array; secretForWeb3(): Uint8Array }

export function signerFromJson(json: string, name = 'key'): Signer {
  let arr: unknown;
  try { arr = JSON.parse(json); } catch { throw new PofError('KEY_MISSING', `${name} is not a keypair JSON`, 500); }
  if (!Array.isArray(arr) || arr.length !== 64) throw new PofError('KEY_MISSING', `${name} is not a 64-byte keypair`, 500);
  const full = Uint8Array.from(arr as number[]);
  const seed = full.slice(0, 32);
  const pub = ed25519.getPublicKey(seed);
  if (!equal(pub, full.subarray(32))) throw new PofError('KEY_MISSING', `${name}: the public half does not match the seed`, 500);
  return {
    publicKey: pub, address: toB58(pub),
    sign: (msg) => ed25519.sign(msg, seed),
    secretForWeb3: () => Uint8Array.from(full),
  };
}

export function signerFromSeed(seed: Uint8Array): Signer {
  const pub = ed25519.getPublicKey(seed);
  return signerFromJson(JSON.stringify([...seed, ...pub]));
}

export const verifySig = (sig: Uint8Array, msg: Uint8Array, pub: Uint8Array): boolean => {
  try { return ed25519.verify(sig, msg, pub); } catch { return false; }
};

export const randomSeed = (): Uint8Array => ed25519.utils.randomSecretKey();
