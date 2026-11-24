use anchor_lang::prelude::*;

#[error_code]
pub enum PofError {
    #[msg("only the program's upgrade authority may run init_config")]
    NotUpgradeAuthority,
    #[msg("only the admin may do this")]
    NotAdmin,
    #[msg("a setting is out of its bounds")]
    BadParams,
    #[msg("the fee is above the cap")]
    FeeAboveCap,
    #[msg("the root mint is already set")]
    RootSet,
    #[msg("not a token mint")]
    BadMint,
    #[msg("the holder token account is not the payer's canonical root account")]
    BadHolderAccount,
    #[msg("certify and renew are paused")]
    Paused,
    #[msg("the program is winding down")]
    Closing,
    #[msg("the program is not winding down")]
    NotClosing,
    #[msg("no verifier key is set")]
    NoVerifier,
    #[msg("no ed25519 instruction right before this one")]
    NoSignature,
    #[msg("the ed25519 instruction is not one signature over its own data")]
    BadSignatureLayout,
    #[msg("the attestation is not signed by the active verifier key")]
    WrongVerifier,
    #[msg("the signed bytes differ from the attestation rebuilt on chain")]
    AttestationMismatch,
    #[msg("unknown subject kind")]
    BadSubjectKind,
    #[msg("the subject hash does not belong to the controller key")]
    SubjectMismatch,
    #[msg("the asset is not enabled")]
    BadAsset,
    #[msg("no such tier for this asset")]
    BadTier,
    #[msg("note count must be 1 to 8 and match the nullifier hashes")]
    BadNoteCount,
    #[msg("the salted nullifier hashes must be sorted ascending without repeats")]
    NullHashesUnsorted,
    #[msg("the attestation was issued in the future")]
    IssuedInFuture,
    #[msg("the attestation is too old to submit")]
    AttestationStale,
    #[msg("the tree root was read too long before the attestation")]
    RootStale,
    #[msg("the expiry is not after the issue slot, or longer than the validity")]
    BadExpiry,
    #[msg("the attestation has already expired")]
    Expired,
    #[msg("the payer in the attestation is not the signer paying")]
    PayerMismatch,
    #[msg("a live certificate already exists for this subject and asset: renew it")]
    AlreadyLive,
    #[msg("the previous payer of this certificate must be passed to take its rent back")]
    PriorPayerMissing,
    #[msg("this attestation is not newer than the one the certificate holds")]
    Replayed,
    #[msg("the certificate is not live")]
    NotLive,
    #[msg("the certificate has expired")]
    CertificateExpired,
    #[msg("the certificate is below the required tier")]
    TierTooLow,
    #[msg("the certificate is for another asset")]
    AssetMismatch,
    #[msg("not this program's certificate at the subject's address")]
    BadCertificate,
    #[msg("renew must carry the same notes, subject, asset and controller")]
    RenewMismatch,
    #[msg("no disclosed note at that index")]
    BadIndex,
    #[msg("salt and nullifier do not hash to the disclosed note")]
    NullifierMismatch,
    #[msg("the nullifier is not shown as spent by this proof")]
    NotSpent,
    #[msg("the Rings accounts passed are not the Rings program's")]
    BadRingsAccounts,
    #[msg("only the certificate's controller may do this")]
    NotController,
    #[msg("the certificate has not expired yet")]
    NotExpired,
    #[msg("the rent goes back to the certificate's payer")]
    NotPayer,
    #[msg("the log can only grow")]
    LogNotGrowing,
    #[msg("the treasury cannot pay that much")]
    TreasuryShort,
    #[msg("no verifier key is waiting, or its delay has not passed")]
    NoRotationDue,
    #[msg("the Verifier key that signed this has been revoked")]
    KeyRevoked,
    #[msg("the certificate's Verifier key is not revoked")]
    KeyNotRevoked,
    #[msg("arithmetic overflow")]
    Overflow,
}
