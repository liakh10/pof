//! The verifier alone, for native tests (see Cargo.toml).
pub mod groth16;
pub mod vk;

#[cfg(test)]
mod tests {
    use super::groth16::*;
    use super::vk::NPUB;

    fn hexb<const L: usize>(s: &str) -> [u8; L] {
        let mut o = [0u8; L];
        for i in 0..L {
            o[i] = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
        }
        o
    }
    fn vectors() -> Vec<([u8; 256], [[u8; 32]; NPUB])> {
        let f = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/test/vectors.json")).expect("run node test/vectors.mjs first");
        let v: serde_json::Value = serde_json::from_str(&f).unwrap();
        v["proofs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                let proof = hexb::<256>(p["proof"].as_str().unwrap());
                let ins: Vec<[u8; 32]> = p["inputs"].as_array().unwrap().iter().map(|x| hexb::<32>(x.as_str().unwrap())).collect();
                (proof, ins.try_into().unwrap())
            })
            .collect()
    }

    #[test]
    fn snarkjs_proofs_verify() {
        let v = vectors();
        assert!(!v.is_empty());
        for (proof, inputs) in &v {
            assert_eq!(verify(proof, inputs), Ok(()));
        }
    }

    #[test]
    fn any_changed_input_fails() {
        let (proof, inputs) = vectors().remove(0);
        for i in 0..NPUB {
            let mut x = inputs;
            x[i][31] ^= 1;
            assert_ne!(verify(&proof, &x), Ok(()), "input {} changed and still verified", i);
        }
    }

    #[test]
    fn a_changed_proof_fails() {
        let (proof, inputs) = vectors().remove(0);
        for at in [5usize, 40, 70, 100, 140, 170, 200, 250] {
            let mut p = proof;
            p[at] ^= 1;
            assert_ne!(verify(&p, &inputs), Ok(()));
        }
        // A not negated: the honest A with the sign flipped back
        let mut p = proof;
        let mut y = [0u8; 32];
        y.copy_from_slice(&p[32..64]);
        // q - y
        let q: [u8; 32] = hexb("30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47");
        let mut borrow = 0i16;
        for i in (0..32).rev() {
            let d = q[i] as i16 - y[i] as i16 - borrow;
            borrow = if d < 0 { 1 } else { 0 };
            p[32 + i] = (d + if d < 0 { 256 } else { 0 }) as u8;
        }
        assert_eq!(verify(&p, &inputs), Err(Groth16Error::Invalid));
    }

    #[test]
    fn a_zero_proof_never_verifies() {
        // audit ZK-03: with a stub key a zero proof verified everything; the key is real (vk.rs compiles only then) and
        // points at infinity in the proof are refused
        let (_, inputs) = vectors().remove(0);
        assert_eq!(verify(&[0u8; 256], &inputs), Err(Groth16Error::BadPoint));
        assert_ne!(verify(&[0u8; 256], &[[0u8; 32]; NPUB]), Ok(()));
    }

    #[test]
    fn a_non_canonical_input_is_refused() {
        let (proof, inputs) = vectors().remove(0);
        // x + r for the first nonzero input that stays under 2^256
        let mut x = inputs;
        let i = 4; // ctx (top bits cleared, so x + r < 2^256)
        let mut carry = 0u16;
        for k in (0..32).rev() {
            let s = x[i][k] as u16 + FIELD_R[k] as u16 + carry;
            x[i][k] = (s & 255) as u8;
            carry = s >> 8;
        }
        assert_eq!(carry, 0);
        assert_eq!(verify(&proof, &x), Err(Groth16Error::InputNotInField));
        let mut y = inputs;
        y[0] = FIELD_R;
        assert_eq!(verify(&proof, &y), Err(Groth16Error::InputNotInField));
    }
}
