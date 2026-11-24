#!/usr/bin/env python3
"""Applies the certify_zk patch to a copy of pof/program (never to pof/program itself unless --in-place is given by its owner).
   python3 apply.py <program dir>
Copies src/zk.rs, src/groth16.rs, src/vk.rs into programs/pof/src/, and edits lib.rs, errors.rs and Cargo.toml by anchored
string replacement (each anchor must be found exactly once, so a drifted lib.rs fails loudly instead of patching the wrong place)."""
import os, shutil, sys
here = os.path.dirname(os.path.abspath(__file__))
dst = sys.argv[1]
src = os.path.join(dst, 'programs/pof/src')
for f in ['zk.rs', 'groth16.rs', 'vk.rs']:
    shutil.copy(os.path.join(here, 'src', f), os.path.join(src, f))

def edit(path, pairs):
    s = open(path).read()
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            sys.exit(f'{path}: anchor found {n} times: {old[:70]!r}')
        s = s.replace(old, new)
    open(path, 'w').write(s)

edit(os.path.join(src, 'lib.rs'), [
    ("pub mod errors;\npub mod ext;\n", "pub mod errors;\npub mod ext;\npub mod zk;\n\npub use zk::*;\n"),
    ("    /// A fresh attestation on the same notes (same salted hashes), subject, asset and controller: new root, slots and tier.\n",
     "    /// Phase 2: certify from a Groth16 proof of funds (pof/zk) instead of the Verifier's signature. See zk.rs.\n"
     "    pub fn certify_zk<'info>(ctx: Context<'info, CertifyZk<'info>>, args: ZkArgs) -> Result<()> {\n"
     "        zk::handle_certify_zk(ctx, args)\n"
     "    }\n\n"
     "    /// Admin: turn certify_zk on or off and set the revocation (escrow) key; records the build's verifying key hash.\n"
     "    pub fn set_zk(ctx: Context<SetZk>, enabled: bool, escrow: [[u8; 32]; 2]) -> Result<()> {\n"
     "        zk::handle_set_zk(ctx, enabled, escrow)\n"
     "    }\n\n"
     "    /// Anyone: close a note lock whose certificate is no longer live.\n"
     "    pub fn release_note_lock(ctx: Context<ReleaseNoteLock>) -> Result<()> {\n"
     "        zk::handle_release_note_lock(ctx)\n"
     "    }\n\n"
     "    /// A fresh attestation on the same notes (same salted hashes), subject, asset and controller: new root, slots and tier.\n"),
    ("    require!(ext::salted_nullifier(&salt, &nullifier) == cert.null_hashes[index as usize], PofError::NullifierMismatch);\n",
     "    // a zk certificate stores Poseidon(TAG_DOMAIN, nullifier) per note (no salt); a Verifier one the salted sha256\n"
     "    let h = if cert.verifier == zk::ZK_CONFIG { zk::tag_of(&nullifier)? } else { ext::salted_nullifier(&salt, &nullifier) };\n"
     "    require!(h == cert.null_hashes[index as usize], PofError::NullifierMismatch);\n"),
])
edit(os.path.join(src, 'errors.rs'), [
    ("    #[msg(\"arithmetic overflow\")]\n    Overflow,\n",
     "    #[msg(\"arithmetic overflow\")]\n    Overflow,\n"
     "    #[msg(\"certify_zk is turned off\")]\n    ZkDisabled,\n"
     "    #[msg(\"certify_zk takes a wallet or badge subject (its key signs)\")]\n    ZkSubjectKind,\n"
     "    #[msg(\"pass one writable note lock [\\\"znote\\\", tag] per tag, in order\")]\n    ZkLockMissing,\n"
     "    #[msg(\"the state root is not in the Rings tree's root history\")]\n    ZkStateRootUnknown,\n"
     "    #[msg(\"the nullifier root is not in the Rings tree's nullifier root history\")]\n    ZkNullRootUnknown,\n"
     "    #[msg(\"a public input is not a canonical field element\")]\n    ZkInputNotInField,\n"
     "    #[msg(\"the proof does not verify for this certificate\")]\n    ZkProofInvalid,\n"
     "    #[msg(\"a note is already behind another certificate\")]\n    ZkNoteLocked,\n"
     "    #[msg(\"the lock's certificate is still live with this note\")]\n    ZkNoteStillLive,\n"),
])
edit(os.path.join(dst, 'programs/pof/Cargo.toml'), [
    ('solana-poseidon = "3"\n', 'solana-poseidon = "3"\nsolana-bn254 = "3.2.1"\n'),
])
print('patched', dst)
