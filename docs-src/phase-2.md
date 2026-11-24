---
title: Phase 2
order: 11
summary: Replacing the Verifier's view of amounts and the nullifier key with a zero-knowledge proof the program checks itself.
---

# Phase 2: the zero-knowledge Verifier

Phase 1 asks you to trust the Verifier with the openings of the notes you disclose and with your vault's nullifier key
([Trust points](trust), item 1). Phase 2 removes that view. The holder's browser proves the same statement with a Groth16
proof, and the program checks the proof on chain. Nobody, including the operator, sees an amount, the nullifier key, the
owner, the notes or their nullifiers.

## The statement

The circuit (`zk/circuits/pof.circom`, circom 2, BN254, the same Poseidon as Rings) proves that the prover knows 1 to N
notes such that:

- each commitment is a leaf of the Rings state tree under a state root the chain holds;
- each nullifier is derived correctly from the note and the prover's nullifier key;
- each nullifier is absent from the Rings nullifier tree under a nullifier root the chain holds (unspent);
- the amounts, all in one asset, sum to at least the tier minimum;
- each nullifier is **escrowed** to a revocation key: encrypted on Baby Jubjub so that the holder of that key, and only
  they, can recover it and show the spend to `revoke_spent`.

The public inputs are the two roots, the asset, the tier minimum, a context value that ties the proof to one certificate, the escrow key, and per note a tag and a ciphertext. The program rebuilds or checks each one.

## What changes and what stays

| | phase 1 | phase 2 |
|---|---|---|
| Who sees amounts | the Verifier, for one request | nobody |
| Who sees the nullifier key | the Verifier, for one request | nobody |
| Who checks membership and non-spending | the Verifier, against on-chain roots | the program, by verifying the proof against on-chain roots |
| Who can revoke on spend | holders of the salts (holder, keeper) | holders of the revocation key (and the holder) |
| Trusted setup | none | a Groth16 setup per circuit: today a development setup made on one machine; a public ceremony runs before `certify_zk` is switched on |
| The X handle check | X and fxtwitter | unchanged |
| Timing and funding links | as in [Privacy guidance](privacy) | unchanged: a proof hides amounts, not the public deposit |

## Status

Phase 2 is in development in `zk/`: the circuit (4 notes per proof), a development setup, the browser prover and the
on-chain instruction `certify_zk` are built and tested. It is not deployed, and no certificate today is issued by a proof. The
[zero-knowledge circuit](zk) page describes the circuit, the setup and the on-chain verifier in full; the
[changelog](https://github.com/liakh10/pof/blob/main/CHANGELOG.md) records when it ships.
