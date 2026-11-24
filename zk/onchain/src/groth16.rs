//! Groth16 over BN254 with Solana's alt_bn128 syscalls (solana-bn254): the check
//!   e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1,   vk_x = IC_0 + sum_i x_i · IC_(i+1)
//! Every point is big-endian (G1: x ‖ y, G2: x.c1 ‖ x.c0 ‖ y.c1 ‖ y.c0), the layout of the syscalls and of
//! `proofBytes` in js/zk.js (which negates A). Public inputs must be canonical field elements (below r), so one statement
//! has one byte encoding: a value x + r would pass the pairing and break every uniqueness check built on the inputs.
//! On a non-Solana target the same crate runs arkworks, so this file is unit-tested natively against snarkjs proofs.
use solana_bn254::prelude::{alt_bn128_g1_addition_be, alt_bn128_g1_multiplication_be, alt_bn128_pairing_be};

use super::vk::{VK_ALPHA_G1, VK_BETA_G2, VK_DELTA_G2, VK_GAMMA_G2, VK_IC, NPUB};

/// The BN254 scalar field modulus r, big-endian.
pub const FIELD_R: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d, 0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91,
    0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Groth16Error {
    /// A public input is not below r.
    InputNotInField,
    /// A syscall refused a point (not on the curve, not in the subgroup, malformed).
    BadPoint,
    /// The pairing product is not one: the proof does not verify for these inputs.
    Invalid,
}

/// x < r, big-endian.
pub fn in_field(x: &[u8; 32]) -> bool {
    x < &FIELD_R
}

fn g1_add(a: &[u8; 64], b: &[u8; 64]) -> Result<[u8; 64], Groth16Error> {
    let mut buf = [0u8; 128];
    buf[..64].copy_from_slice(a);
    buf[64..].copy_from_slice(b);
    let r = alt_bn128_g1_addition_be(&buf).map_err(|_| Groth16Error::BadPoint)?;
    r.as_slice().try_into().map_err(|_| Groth16Error::BadPoint)
}

fn g1_mul(p: &[u8; 64], s: &[u8; 32]) -> Result<[u8; 64], Groth16Error> {
    let mut buf = [0u8; 96];
    buf[..64].copy_from_slice(p);
    buf[64..].copy_from_slice(s);
    let r = alt_bn128_g1_multiplication_be(&buf).map_err(|_| Groth16Error::BadPoint)?;
    r.as_slice().try_into().map_err(|_| Groth16Error::BadPoint)
}

/// The linear combination of the public inputs (zero inputs cost nothing: unused note slots are zero).
pub fn prepare_inputs(inputs: &[[u8; 32]; NPUB]) -> Result<[u8; 64], Groth16Error> {
    let mut acc = VK_IC[0];
    for (i, x) in inputs.iter().enumerate() {
        if !in_field(x) {
            return Err(Groth16Error::InputNotInField);
        }
        if x.iter().all(|b| *b == 0) {
            continue;
        }
        let term = g1_mul(&VK_IC[i + 1], x)?;
        acc = g1_add(&acc, &term)?;
    }
    Ok(acc)
}

/// Verifies a 256-byte proof (A negated ‖ B ‖ C) for these public inputs.
pub fn verify(proof: &[u8; 256], inputs: &[[u8; 32]; NPUB]) -> Result<(), Groth16Error> {
    let vk_x = prepare_inputs(inputs)?;
    let mut buf = vec![0u8; 4 * 192];
    buf[0..64].copy_from_slice(&proof[0..64]); // -A
    buf[64..192].copy_from_slice(&proof[64..192]); // B
    buf[192..256].copy_from_slice(&VK_ALPHA_G1);
    buf[256..384].copy_from_slice(&VK_BETA_G2);
    buf[384..448].copy_from_slice(&vk_x);
    buf[448..576].copy_from_slice(&VK_GAMMA_G2);
    buf[576..640].copy_from_slice(&proof[192..256]); // C
    buf[640..768].copy_from_slice(&VK_DELTA_G2);
    let out = alt_bn128_pairing_be(&buf).map_err(|_| Groth16Error::BadPoint)?;
    if out.len() == 32 && out[..31].iter().all(|b| *b == 0) && out[31] == 1 {
        Ok(())
    } else {
        Err(Groth16Error::Invalid)
    }
}
