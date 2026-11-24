//! What the program reads of other programs and of the runtime, by hand (no crate linked for any of them): the instructions
//! sysvar and the Ed25519 program's instruction before ours (the Verifier's signature), the upgradeable loader (whose upgrade
//! authority alone runs `init_config`), token accounts of SPL Token or Token-2022 (the $ROOT holder rule), and the Helius Privacy
//! Rings spent-nullifier proofs (`spent_on_rings`). Plus base58 and the subject and nullifier hashes of CONTRACT §1 and §5.

use anchor_lang::prelude::*;

use crate::errors::PofError;

pub const TOKEN_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const ATA_ID: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const LOADER_ID: Pubkey = pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");
pub const INSTRUCTIONS_ID: Pubkey = pubkey!("Sysvar1nstructions1111111111111111111111111");
pub const ED25519_ID: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");
/// The Solana Privacy Program (Helius Privacy Rings), mainnet.
pub const SPP_ID: Pubkey = pubkey!("ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW");
pub const NULLIFIER_SEED: &[u8] = b"nullifier";
/// Rings tree 0, PDA ["tree", u16 LE 0] of the Privacy Program: the only tree (pof/RINGS.md §1). Every spent proof names it.
pub const RINGS_TREE: Pubkey = pubkey!("777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor");

pub fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    solana_sha256_hasher::hashv(parts).to_bytes()
}
fn key_at(d: &[u8], at: usize) -> Pubkey {
    Pubkey::new_from_array(d[at..at + 32].try_into().unwrap())
}
fn u16_at(d: &[u8], at: usize) -> Result<u16> {
    let b = d.get(at..at + 2).ok_or(error!(PofError::BadSignatureLayout))?;
    Ok(u16::from_le_bytes([b[0], b[1]]))
}

// ------------------------------------------------------------------------------------------------
// base58 and the hashes of CONTRACT §1 / §5

const B58: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/// Bitcoin-alphabet base58 of 32 bytes (a Solana address as wallets print it), into `out`; returns the length used (32..=44).
pub fn base58_32(bytes: &[u8; 32], out: &mut [u8; 44]) -> usize {
    let mut digits = [0u8; 44];
    let mut len = 0usize;
    for &b in bytes.iter() {
        let mut carry = b as u32;
        for d in digits[..len].iter_mut() {
            carry += (*d as u32) << 8;
            *d = (carry % 58) as u8;
            carry /= 58;
        }
        while carry > 0 {
            digits[len] = (carry % 58) as u8;
            len += 1;
            carry /= 58;
        }
    }
    let zeros = bytes.iter().take_while(|&&b| b == 0).count();
    let mut n = 0;
    for _ in 0..zeros {
        out[n] = b'1';
        n += 1;
    }
    for i in (0..len).rev() {
        out[n] = B58[digits[i] as usize];
        n += 1;
    }
    n
}

pub const KIND_WALLET: u8 = 0;
pub const KIND_X: u8 = 1;
pub const KIND_BADGE: u8 = 2;

/// CONTRACT §1 for the key kinds: sha256("pof:wallet:" ‖ base58(key)) or sha256("pof:badge:" ‖ base58(key)).
pub fn key_subject_hash(kind: u8, key: &Pubkey) -> Option<[u8; 32]> {
    let prefix: &[u8] = match kind {
        KIND_WALLET => b"pof:wallet:",
        KIND_BADGE => b"pof:badge:",
        _ => return None,
    };
    let mut s = [0u8; 44];
    let n = base58_32(&key.to_bytes(), &mut s);
    Some(sha256(&[prefix, &s[..n]]))
}

/// CONTRACT §5: h = sha256("pof:null:" ‖ salt ‖ nullifier).
pub fn salted_nullifier(salt: &[u8; 32], nullifier: &[u8; 32]) -> [u8; 32] {
    sha256(&[b"pof:null:", salt, nullifier])
}

// ------------------------------------------------------------------------------------------------
// the instructions sysvar and the Ed25519 program

/// The instruction at index `at` of this transaction, read from the instructions sysvar: (program id, data).
fn instruction_at(data: &[u8], at: u16) -> Result<(Pubkey, &[u8])> {
    let n = u16_at(data, 0)?;
    require!(at < n, PofError::NoSignature);
    let mut p = u16_at(data, 2 + 2 * at as usize)? as usize;
    let accounts = u16_at(data, p)? as usize;
    p += 2 + accounts * 33;
    require!(data.len() >= p + 34, PofError::BadSignatureLayout);
    let program = key_at(data, p);
    p += 32;
    let len = u16_at(data, p)? as usize;
    p += 2;
    let d = data.get(p..p + len).ok_or(error!(PofError::BadSignatureLayout))?;
    Ok((program, d))
}

/// The message signed by the Ed25519 program instruction placed right before the current one, and its public key. It must be
/// exactly one signature whose signature, key and message all sit in that same instruction (index u16::MAX), so nothing can point
/// the check at bytes elsewhere in the transaction.
pub fn signed_before(ix_sysvar: &AccountInfo) -> Result<(Pubkey, Vec<u8>)> {
    require_keys_eq!(ix_sysvar.key(), INSTRUCTIONS_ID, PofError::NoSignature);
    let data = ix_sysvar.try_borrow_data()?;
    require!(data.len() >= 4, PofError::NoSignature);
    let current = u16_at(&data, data.len() - 2)?;
    require!(current > 0, PofError::NoSignature);
    let (program, d) = instruction_at(&data, current - 1)?;
    require_keys_eq!(program, ED25519_ID, PofError::NoSignature);
    // [count u8, padding u8, then 7 x u16: sig offset, sig ix, key offset, key ix, msg offset, msg size, msg ix]
    require!(d.len() >= 16 && d[0] == 1, PofError::BadSignatureLayout);
    let sig_off = u16_at(d, 2)? as usize;
    let sig_ix = u16_at(d, 4)?;
    let key_off = u16_at(d, 6)? as usize;
    let key_ix = u16_at(d, 8)?;
    let msg_off = u16_at(d, 10)? as usize;
    let msg_len = u16_at(d, 12)? as usize;
    let msg_ix = u16_at(d, 14)?;
    require!(sig_ix == u16::MAX && key_ix == u16::MAX && msg_ix == u16::MAX, PofError::BadSignatureLayout);
    require!(d.len() >= sig_off + 64 && d.len() >= key_off + 32, PofError::BadSignatureLayout);
    let msg = d.get(msg_off..msg_off + msg_len).ok_or(error!(PofError::BadSignatureLayout))?;
    Ok((key_at(d, key_off), msg.to_vec()))
}

// ------------------------------------------------------------------------------------------------
// the loader and tokens

/// The upgrade authority written in a ProgramData account of the upgradeable loader.
pub fn upgrade_authority(program_data: &AccountInfo) -> Result<Option<Pubkey>> {
    require_keys_eq!(*program_data.owner, LOADER_ID, PofError::NotUpgradeAuthority);
    let d = program_data.try_borrow_data()?;
    require!(d.len() >= 45 && d[..4] == [3, 0, 0, 0], PofError::NotUpgradeAuthority);
    Ok(if d[12] == 1 { Some(key_at(&d, 13)) } else { None })
}

pub fn is_token_program(key: &Pubkey) -> bool {
    *key == TOKEN_ID || *key == TOKEN_2022_ID
}

/// The canonical associated token account of `owner` for `mint` under `token_program`.
pub fn ata(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[owner.as_ref(), token_program.as_ref(), mint.as_ref()], &ATA_ID).0
}

/// An initialized MINT of SPL Token or Token-2022 (not a token account): 82 bytes, or a Token-2022 mint with extensions
/// (account type byte 1 at offset 165).
pub fn is_mint(m: &AccountInfo) -> bool {
    if !is_token_program(m.owner) {
        return false;
    }
    let Ok(d) = m.try_borrow_data() else { return false };
    let shape = d.len() == 82 || (*m.owner == TOKEN_2022_ID && d.len() > 165 && d[165] == 1);
    shape && d[45] == 1
}

/// (mint, owner, amount) of an initialized token account of SPL Token or Token-2022, else None.
pub fn token_view(account: &AccountInfo) -> Option<(Pubkey, Pubkey, u64)> {
    if !is_token_program(account.owner) {
        return None;
    }
    let d = account.try_borrow_data().ok()?;
    if d.len() < 165 || d[108] != 1 {
        return None;
    }
    Some((key_at(&d, 0), key_at(&d, 32), u64::from_le_bytes(d[64..72].try_into().unwrap())))
}

/// Lamports out of an account this program owns.
pub fn shift(from: &AccountInfo, to: &AccountInfo, lamports: u64) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    let left = from.lamports().checked_sub(lamports).ok_or(PofError::Overflow)?;
    let now = to.lamports().checked_add(lamports).ok_or(PofError::Overflow)?;
    **from.try_borrow_mut_lamports()? = left;
    **to.try_borrow_mut_lamports()? = now;
    Ok(())
}

// ------------------------------------------------------------------------------------------------
// Helius Privacy Rings: is a nullifier spent? (pof/RINGS.md §3, verified on mainnet)
//
// A transact that spends a note creates the account ["nullifier", input tree, nullifier] under the Solana Privacy Program
// (11 bytes: 0x08 ‖ u64 LE queue index ‖ 0x0000). A forester later folds each batch of nullifiers into the tree's indexed
// nullifier tree (height 40, leaf = Poseidon(value, next value), node = Poseidon(left, right)), whose last 100 roots the tree
// account keeps at offset 17,232; after that the pool MAY close the PDA. So two proofs, and no code path on chain ever reads a
// missing or closed PDA as "unspent":
//   (a) `spent_on_rings`: the nullifier PDA exists now, the Privacy Program's, 11 bytes, data[0] == 8;
//   (b) `spent_in_nullifier_tree`: a membership path of the nullifier in the folded nullifier tree to one of those 100 roots.

/// Tree account: discriminator 1 at 0; the nullifier root history (100 x 32 bytes) at 17,232.
const TREE_DISC: u8 = 1;
const NULL_ROOTS_AT: usize = 17_232;
const NULL_ROOTS: usize = 100;
pub const NULL_TREE_HEIGHT: usize = 40;

/// (a) The nullifier PDA of (`tree`, `nullifier`) exists and is the Privacy Program's. True means spent; false means only "not
/// shown by this proof" (the caller refuses with NotSpent and never treats it as unspent).
pub fn spent_on_rings(tree: &AccountInfo, nullifier_account: &AccountInfo, nullifier: &[u8; 32]) -> Result<bool> {
    require_keys_eq!(tree.key(), RINGS_TREE, PofError::BadRingsAccounts);
    require_keys_eq!(*tree.owner, SPP_ID, PofError::BadRingsAccounts);
    let (pda, _) = Pubkey::find_program_address(&[NULLIFIER_SEED, tree.key.as_ref(), nullifier], &SPP_ID);
    require_keys_eq!(nullifier_account.key(), pda, PofError::BadRingsAccounts);
    if *nullifier_account.owner != SPP_ID || nullifier_account.lamports() == 0 {
        return Ok(false);
    }
    let d = nullifier_account.try_borrow_data()?;
    Ok(d.len() == 11 && d[0] == 8)
}

/// The zero subtree hashes of the indexed nullifier tree: ZEROS[0] is the empty leaf (0), ZEROS[i + 1] = Poseidon(ZEROS[i],
/// ZEROS[i]). A path may stop at the level from which every sibling is empty; the rest is filled from here.
pub const NULL_ZEROS: [[u8; 32]; NULL_TREE_HEIGHT] = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [32, 152, 245, 251, 158, 35, 158, 171, 60, 234, 195, 242, 123, 129, 228, 129, 220, 49, 36, 213, 95, 254, 213, 35, 168, 57, 238, 132, 70, 182, 72, 100],
    [16, 105, 103, 61, 205, 177, 34, 99, 223, 48, 26, 111, 245, 132, 167, 236, 38, 26, 68, 203, 157, 198, 141, 240, 103, 164, 119, 68, 96, 177, 241, 225],
    [24, 244, 51, 49, 83, 126, 226, 175, 46, 61, 117, 141, 80, 247, 33, 6, 70, 124, 110, 234, 80, 55, 29, 213, 40, 213, 126, 178, 184, 86, 210, 56],
    [7, 249, 216, 55, 203, 23, 176, 211, 99, 32, 255, 233, 59, 165, 35, 69, 241, 183, 40, 87, 26, 86, 130, 101, 202, 172, 151, 85, 157, 188, 149, 42],
    [43, 148, 207, 94, 135, 70, 179, 245, 201, 99, 31, 76, 93, 243, 41, 7, 166, 153, 197, 140, 148, 178, 173, 77, 123, 92, 236, 22, 57, 24, 63, 85],
    [45, 238, 147, 197, 166, 102, 69, 150, 70, 234, 125, 34, 204, 169, 225, 188, 254, 215, 30, 105, 81, 185, 83, 97, 29, 17, 221, 163, 46, 160, 157, 120],
    [7, 130, 149, 229, 162, 43, 132, 233, 130, 207, 96, 30, 182, 57, 89, 123, 139, 5, 21, 168, 140, 181, 172, 127, 168, 164, 170, 190, 60, 135, 52, 157],
    [47, 165, 229, 241, 143, 96, 39, 166, 80, 27, 236, 134, 69, 100, 71, 42, 97, 107, 46, 39, 74, 65, 33, 26, 68, 76, 190, 58, 153, 243, 204, 97],
    [14, 136, 67, 118, 208, 216, 253, 33, 236, 183, 128, 56, 158, 148, 31, 102, 228, 94, 122, 204, 227, 226, 40, 171, 62, 33, 86, 166, 20, 252, 215, 71],
    [27, 114, 1, 218, 114, 73, 79, 30, 40, 113, 122, 209, 165, 46, 180, 105, 249, 88, 146, 249, 87, 113, 53, 51, 222, 97, 117, 229, 218, 25, 10, 242],
    [31, 141, 136, 34, 114, 94, 54, 56, 82, 0, 192, 178, 1, 36, 152, 25, 166, 230, 225, 228, 101, 8, 8, 181, 190, 188, 107, 250, 206, 125, 118, 54],
    [44, 93, 130, 246, 108, 145, 75, 175, 185, 112, 21, 137, 186, 140, 252, 251, 97, 98, 176, 161, 42, 207, 136, 168, 208, 135, 154, 4, 113, 181, 248, 90],
    [20, 197, 65, 72, 160, 148, 11, 184, 32, 149, 127, 90, 223, 63, 161, 19, 78, 245, 196, 170, 161, 19, 244, 100, 100, 88, 242, 112, 224, 191, 191, 208],
    [25, 13, 51, 177, 47, 152, 111, 150, 30, 16, 192, 238, 68, 216, 185, 175, 17, 190, 37, 88, 140, 173, 137, 212, 22, 17, 142, 75, 244, 235, 232, 12],
    [34, 249, 138, 169, 206, 112, 65, 82, 172, 23, 53, 73, 20, 173, 115, 237, 17, 103, 174, 101, 150, 175, 81, 10, 165, 179, 100, 147, 37, 224, 108, 146],
    [42, 124, 124, 155, 108, 229, 136, 11, 159, 111, 34, 141, 114, 191, 106, 87, 90, 82, 111, 41, 198, 110, 204, 238, 248, 183, 83, 211, 139, 186, 115, 35],
    [46, 129, 134, 229, 88, 105, 142, 193, 198, 122, 249, 193, 77, 70, 63, 252, 71, 0, 67, 201, 194, 152, 139, 149, 77, 117, 221, 100, 63, 54, 185, 146],
    [15, 87, 197, 87, 30, 154, 78, 171, 73, 226, 200, 207, 5, 13, 174, 148, 138, 239, 110, 173, 100, 115, 146, 39, 53, 70, 36, 157, 28, 31, 241, 15],
    [24, 48, 238, 103, 181, 251, 85, 74, 213, 246, 61, 67, 136, 128, 14, 28, 254, 120, 227, 16, 105, 125, 70, 228, 60, 156, 227, 97, 52, 247, 44, 202],
    [33, 52, 231, 106, 197, 210, 26, 171, 24, 108, 43, 225, 221, 143, 132, 238, 136, 10, 30, 70, 234, 247, 18, 249, 211, 113, 182, 223, 34, 25, 31, 62],
    [25, 223, 144, 236, 132, 78, 188, 79, 254, 235, 216, 102, 243, 56, 89, 176, 192, 81, 216, 201, 88, 238, 58, 168, 143, 143, 141, 243, 219, 145, 165, 177],
    [24, 204, 162, 166, 107, 92, 7, 135, 152, 30, 105, 174, 253, 132, 133, 45, 116, 175, 14, 147, 239, 73, 18, 180, 100, 140, 5, 247, 34, 239, 229, 43],
    [35, 136, 144, 148, 21, 35, 13, 27, 77, 19, 4, 210, 213, 79, 71, 58, 98, 131, 56, 242, 239, 173, 131, 250, 223, 5, 100, 69, 73, 210, 83, 141],
    [39, 23, 31, 180, 169, 123, 108, 192, 233, 232, 245, 67, 181, 41, 77, 232, 102, 162, 175, 44, 156, 141, 11, 29, 150, 230, 115, 228, 82, 158, 213, 64],
    [47, 246, 101, 5, 64, 246, 41, 253, 87, 17, 160, 188, 116, 252, 13, 40, 220, 178, 48, 185, 57, 37, 131, 229, 248, 213, 150, 150, 221, 230, 174, 33],
    [18, 12, 88, 241, 67, 212, 145, 233, 89, 2, 247, 245, 39, 119, 120, 162, 224, 173, 81, 104, 246, 173, 215, 86, 105, 147, 38, 48, 206, 97, 21, 24],
    [31, 33, 254, 183, 13, 63, 33, 176, 123, 248, 83, 213, 229, 219, 3, 7, 30, 196, 149, 160, 165, 101, 162, 29, 162, 214, 101, 210, 121, 72, 55, 149],
    [36, 190, 144, 95, 167, 19, 53, 225, 76, 99, 140, 192, 246, 106, 134, 35, 168, 38, 231, 104, 6, 138, 158, 150, 139, 177, 161, 221, 225, 138, 114, 210],
    [15, 134, 102, 182, 46, 209, 116, 145, 197, 12, 234, 222, 173, 87, 212, 205, 89, 126, 243, 130, 29, 101, 195, 40, 116, 76, 116, 229, 83, 218, 194, 109],
    [9, 24, 212, 107, 245, 45, 152, 176, 52, 65, 63, 74, 26, 28, 65, 89, 78, 122, 122, 63, 106, 224, 140, 180, 61, 26, 42, 35, 14, 25, 89, 239],
    [27, 190, 176, 27, 76, 71, 158, 205, 231, 105, 23, 100, 94, 64, 77, 250, 46, 38, 249, 13, 10, 252, 90, 101, 18, 133, 19, 173, 55, 92, 95, 242],
    [47, 104, 161, 197, 142, 37, 126, 66, 161, 122, 108, 97, 223, 245, 85, 30, 213, 96, 185, 146, 42, 177, 25, 213, 172, 142, 24, 76, 151, 52, 234, 217],
    [17, 2, 210, 248, 219, 5, 228, 175, 72, 66, 232, 173, 61, 133, 237, 69, 235, 40, 68, 126, 183, 33, 34, 53, 162, 40, 29, 90, 181, 216, 29, 17],
    [42, 248, 193, 202, 245, 96, 221, 65, 249, 151, 160, 31, 248, 149, 178, 30, 13, 31, 237, 183, 134, 231, 202, 210, 153, 1, 225, 35, 16, 99, 139, 220],
    [1, 29, 146, 59, 193, 75, 90, 19, 151, 42, 199, 223, 230, 66, 11, 21, 176, 66, 92, 152, 186, 128, 237, 175, 94, 2, 145, 180, 162, 101, 224, 165],
    [34, 76, 204, 37, 152, 24, 34, 212, 197, 182, 252, 25, 159, 188, 116, 130, 132, 136, 116, 28, 113, 81, 166, 21, 158, 207, 170, 183, 194, 168, 186, 201],
    [39, 232, 57, 246, 245, 85, 254, 174, 130, 74, 180, 51, 227, 75, 28, 14, 100, 206, 92, 117, 150, 45, 255, 193, 60, 104, 87, 29, 107, 74, 97, 14],
    [42, 186, 32, 63, 189, 4, 191, 171, 200, 107, 77, 80, 214, 171, 173, 195, 194, 79, 55, 239, 160, 14, 112, 14, 244, 209, 119, 100, 194, 204, 213, 124],
    [17, 239, 244, 246, 12, 44, 220, 197, 72, 193, 224, 119, 12, 61, 100, 180, 156, 1, 227, 77, 164, 175, 41, 207, 234, 87, 90, 25, 190, 250, 102, 156],
];

/// Poseidon (BN254 x5, circom-compatible, big-endian) of two field elements, through the sol_poseidon syscall on chain.
#[allow(deprecated)]
pub fn poseidon2(a: &[u8; 32], b: &[u8; 32]) -> Result<[u8; 32]> {
    solana_poseidon::hashv(solana_poseidon::Parameters::Bn254X5, solana_poseidon::Endianness::BigEndian, &[a, b])
        .map(|h| h.to_bytes())
        .map_err(|_| error!(PofError::NotSpent))
}

/// The root a membership path gives: leaf Poseidon(value, next) at `leaf_index`, `path` the siblings from the leaf up (at most
/// 40; missing upper levels are empty subtrees).
pub fn membership_root(value: &[u8; 32], next: &[u8; 32], leaf_index: u64, path: &[[u8; 32]]) -> Result<[u8; 32]> {
    require!(path.len() <= NULL_TREE_HEIGHT && (leaf_index >> NULL_TREE_HEIGHT) == 0, PofError::NotSpent);
    let mut cur = poseidon2(value, next)?;
    let mut idx = leaf_index;
    for level in 0..NULL_TREE_HEIGHT {
        let sib = path.get(level).unwrap_or(&NULL_ZEROS[level]);
        cur = if idx & 1 == 1 { poseidon2(sib, &cur)? } else { poseidon2(&cur, sib)? };
        idx >>= 1;
    }
    Ok(cur)
}

/// (b) `nullifier` is a leaf of `tree`'s folded nullifier tree: its path hashes to one of the 100 nullifier roots the tree
/// account holds now. True means spent; false only "not shown".
pub fn spent_in_nullifier_tree(tree: &AccountInfo, nullifier: &[u8; 32], next: &[u8; 32], leaf_index: u64, path: &[[u8; 32]]) -> Result<bool> {
    require_keys_eq!(tree.key(), RINGS_TREE, PofError::BadRingsAccounts);
    require_keys_eq!(*tree.owner, SPP_ID, PofError::BadRingsAccounts);
    let root = membership_root(nullifier, next, leaf_index, path)?;
    let d = tree.try_borrow_data()?;
    require!(d.len() >= NULL_ROOTS_AT + NULL_ROOTS * 32 && d[0] == TREE_DISC, PofError::BadRingsAccounts);
    Ok((0..NULL_ROOTS).any(|i| d[NULL_ROOTS_AT + i * 32..NULL_ROOTS_AT + i * 32 + 32] == root))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b58(bytes: [u8; 32]) -> String {
        let mut s = [0u8; 44];
        let n = base58_32(&bytes, &mut s);
        String::from_utf8(s[..n].to_vec()).unwrap()
    }

    #[test]
    fn base58_matches_wallet_addresses() {
        assert_eq!(b58([0u8; 32]), "11111111111111111111111111111111");
        assert_eq!(b58(SPP_ID.to_bytes()), "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW");
        assert_eq!(b58(TOKEN_ID.to_bytes()), "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
        assert_eq!(b58(INSTRUCTIONS_ID.to_bytes()), "Sysvar1nstructions1111111111111111111111111");
        let mut x = [0u8; 32];
        x[31] = 1;
        assert_eq!(b58(x), "11111111111111111111111111111112");
        assert_eq!(b58([255u8; 32]), "JEKNVnkbo3jma5nREBBJCDoXFVeKkD56V3xKrvRmWxFG");
    }

    #[test]
    fn subject_hashes_follow_the_contract() {
        let k = SPP_ID;
        let w = key_subject_hash(KIND_WALLET, &k).unwrap();
        assert_eq!(w, sha256(&[b"pof:wallet:ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW"]));
        let b = key_subject_hash(KIND_BADGE, &k).unwrap();
        assert_eq!(b, sha256(&[b"pof:badge:", b"ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW"]));
        assert!(key_subject_hash(KIND_X, &k).is_none());
        assert_eq!(salted_nullifier(&[1; 32], &[2; 32]), sha256(&[b"pof:null:", &[1; 32], &[2; 32]]));
    }

    fn hexb(h: &str) -> [u8; 32] {
        let mut b = [0u8; 32];
        for i in 0..32 {
            b[i] = u8::from_str_radix(&h[2 * i..2 * i + 2], 16).unwrap();
        }
        b
    }

    #[test]
    fn zero_hashes_chain() {
        for i in 0..NULL_TREE_HEIGHT - 1 {
            assert_eq!(poseidon2(&NULL_ZEROS[i], &NULL_ZEROS[i]).unwrap(), NULL_ZEROS[i + 1]);
        }
    }

    /// A real mainnet nullifier of tree 0 and its indexer path (test/fixtures/membership.json, from test/membership-fixture.mjs).
    #[test]
    fn a_mainnet_membership_path_hashes_to_its_root() {
        let f = include_str!("../../../test/fixtures/membership.json");
        let get = |k: &str| -> String {
            let at = f.find(&format!("\"{}\": \"", k)).unwrap() + k.len() + 5;
            f[at..at + f[at..].find('"').unwrap()].to_string()
        };
        let nf = hexb(&get("nullifier"));
        let next = hexb(&get("next"));
        let root = hexb(&get("root"));
        let idx: u64 = get("leafIndex").parse().unwrap();
        let at = f.find("\"path\": [").unwrap();
        let path: Vec<[u8; 32]> = f[at..at + f[at..].find(']').unwrap()].split('"').filter(|s| s.len() == 64).map(hexb).collect();
        assert_eq!(path.len(), 40);
        assert_eq!(membership_root(&nf, &next, idx, &path).unwrap(), root);
        // the same with only the non-empty levels
        assert_eq!(membership_root(&nf, &next, idx, &path[..16]).unwrap(), root);
        // a wrong next value, a wrong index, a wrong sibling: another root
        let mut bad = next;
        bad[31] ^= 1;
        assert_ne!(membership_root(&nf, &bad, idx, &path[..16]).unwrap(), root);
        assert_ne!(membership_root(&nf, &next, idx ^ 1, &path[..16]).unwrap(), root);
        let mut p2 = path[..16].to_vec();
        p2[3][31] ^= 1;
        assert_ne!(membership_root(&nf, &next, idx, &p2).unwrap(), root);
        assert!(membership_root(&nf, &next, idx, &[[0u8; 32]; 41]).is_err());
    }
}
