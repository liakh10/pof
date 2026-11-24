//! ZK-03: the verifying key in zk/onchain/src/vk.rs is a placeholder of zeros (the point at infinity for the alt_bn128
//! syscalls). Then e(-A,B)·e(alpha,beta)·e(vk_x,gamma)·e(C,delta) is 1 for A = C = O whatever the inputs: a 256-byte proof of
//! zeros "proves" any statement. The secure behaviour: verify refuses (a build with an unset or degenerate key must fail
//! closed, and a proof with A or C at infinity is never valid). This test fails while the finding is open.
#[path = "../../../zk/onchain/src/vk.rs"]
pub mod vk;
#[path = "../../../zk/onchain/src/groth16.rs"]
pub mod groth16;

#[cfg(test)]
mod tests {
    use super::groth16::verify;
    use super::vk::NPUB;

    #[test]
    fn zk03_an_all_zero_proof_is_refused_for_any_inputs() {
        let proof = [0u8; 256];
        let mut inputs = [[0u8; 32]; NPUB];
        inputs[3][31] = 1; // a "minimum" of 1, a context: any statement at all
        inputs[4][31] = 42;
        assert!(verify(&proof, &inputs).is_err(), "an all-zero proof verified: the placeholder key accepts every statement");
    }
}
