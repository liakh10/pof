export declare const IDL_IS_DRAFT = false;
export declare const POF_IDL: {
    readonly address: "pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT";
    readonly metadata: {
        readonly name: "pof";
        readonly version: "0.1.0";
        readonly spec: "0.1.0";
        readonly description: "Proof of Funds: live certificates that a subject holds at least a tier of SOL or USDC in a Helius Privacy Ring, signed by the Verifier, revoked on chain the moment a disclosed note is spent";
    };
    readonly instructions: readonly [{
        readonly name: "anchor_log";
        readonly docs: readonly ["Anyone submits the transparency log's signed tree head (CONTRACT §7; Ed25519 instruction right before, by the active", "Verifier key): \"POF-STH1\" ‖ program id ‖ size ‖ root. The anchored log only grows."];
        readonly discriminator: readonly [169, 33, 65, 3, 86, 224, 46, 177];
        readonly accounts: readonly [{
            readonly name: "caller";
            readonly signer: true;
        }, {
            readonly name: "config";
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
        }, {
            readonly name: "treasury";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [116, 114, 101, 97, 115, 117, 114, 121];
                }];
            };
        }, {
            readonly name: "instructions";
            readonly address: "Sysvar1nstructions1111111111111111111111111";
        }];
        readonly args: readonly [{
            readonly name: "size";
            readonly type: "u64";
        }, {
            readonly name: "head";
            readonly type: {
                readonly array: readonly ["u8", 32];
            };
        }];
    }, {
        readonly name: "apply_verifier";
        readonly docs: readonly ["Anyone, once the proposed key's slot has come: it becomes the recorded key."];
        readonly discriminator: readonly [233, 0, 246, 93, 255, 44, 198, 174];
        readonly accounts: readonly [{
            readonly name: "caller";
            readonly signer: true;
        }, {
            readonly name: "config";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
        }];
        readonly args: readonly [];
    }, {
        readonly name: "certify";
        readonly docs: readonly ["Certify a subject: the Verifier's attestation (the Ed25519 instruction right before this one) is checked against the bytes", "rebuilt here. A new certificate, or one remade over a revoked or expired one (whose rent goes back to its old payer)."];
        readonly discriminator: readonly [242, 131, 34, 239, 225, 117, 92, 27];
        readonly accounts: readonly [{
            readonly name: "payer";
            readonly writable: true;
            readonly signer: true;
        }, {
            readonly name: "config";
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
        }, {
            readonly name: "treasury";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [116, 114, 101, 97, 115, 117, 114, 121];
                }];
            };
        }, {
            readonly name: "certificate";
            readonly writable: true;
        }, {
            readonly name: "prior_payer";
            readonly writable: true;
            readonly optional: true;
        }, {
            readonly name: "holder_token";
        }, {
            readonly name: "instructions";
            readonly address: "Sysvar1nstructions1111111111111111111111111";
        }, {
            readonly name: "system_program";
            readonly address: "11111111111111111111111111111111";
        }];
        readonly args: readonly [{
            readonly name: "att";
            readonly type: {
                readonly defined: {
                    readonly name: "Attestation";
                };
            };
        }, {
            readonly name: "log_index";
            readonly type: "u64";
        }];
    }, {
        readonly name: "close_begin";
        readonly docs: readonly ["One way: no certify or renew; anyone may `expire` any certificate (rent back to its payer). See wind-down.mjs."];
        readonly discriminator: readonly [161, 49, 64, 17, 104, 205, 191, 182];
        readonly accounts: readonly [{
            readonly name: "admin";
            readonly signer: true;
            readonly relations: readonly ["config"];
        }, {
            readonly name: "config";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
        }];
        readonly args: readonly [];
    }, {
        readonly name: "close_config";
        readonly docs: readonly ["The last step of the wind-down: no certificate account left. The treasury (fees and rent) and the config close to the admin."];
        readonly discriminator: readonly [145, 9, 72, 157, 95, 125, 61, 85];
        readonly accounts: readonly [{
            readonly name: "admin";
            readonly writable: true;
            readonly signer: true;
            readonly relations: readonly ["config"];
        }, {
            readonly name: "config";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
        }, {
            readonly name: "treasury";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [116, 114, 101, 97, 115, 117, 114, 121];
                }];
            };
        }];
        readonly args: readonly [];
    }, {
        readonly name: "expire";
        readonly docs: readonly ["Anyone, past the expiry slot (or at any moment during the wind-down): the account closes, its rent back to its payer."];
        readonly discriminator: readonly [243, 83, 205, 58, 57, 201, 247, 146];
        readonly accounts: readonly [{
            readonly name: "caller";
            readonly signer: true;
        }, {
            readonly name: "config";
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
        }, {
            readonly name: "treasury";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [116, 114, 101, 97, 115, 117, 114, 121];
                }];
            };
        }, {
            readonly name: "certificate";
            readonly writable: true;
        }, {
            readonly name: "payer";
            readonly writable: true;
        }];
        readonly args: readonly [];
    }, {
        readonly name: "init_config";
        readonly docs: readonly ["Only the program's upgrade authority, who becomes the admin and pays the config and treasury rent. The Verifier and the", "relayer keys are set at once; SOL and USDC tiers as CONTRACT §2; the launch parameters."];
        readonly discriminator: readonly [23, 235, 115, 232, 168, 96, 1, 231];
        readonly accounts: readonly [{
            readonly name: "admin";
            readonly writable: true;
            readonly signer: true;
        }, {
            readonly name: "config";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
        }, {
            readonly name: "treasury";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [116, 114, 101, 97, 115, 117, 114, 121];
                }];
            };
        }, {
            readonly name: "program_data";
            readonly address: "ETKHHhmbAD2AJbeDd961pDaet2Gnnv1DFg8x49ibbiHH";
        }, {
            readonly name: "system_program";
            readonly address: "11111111111111111111111111111111";
        }];
        readonly args: readonly [{
            readonly name: "verifier";
            readonly type: "pubkey";
        }, {
            readonly name: "relayer";
            readonly type: "pubkey";
        }, {
            readonly name: "dev";
            readonly type: "pubkey";
        }];
    }, {
        readonly name: "renew";
        readonly docs: readonly ["A fresh attestation on the same notes (same salted hashes), subject, asset and controller: new root, slots and tier."];
        readonly discriminator: readonly [43, 239, 15, 46, 27, 7, 163, 73];
        readonly accounts: readonly [{
            readonly name: "payer";
            readonly writable: true;
            readonly signer: true;
        }, {
            readonly name: "config";
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
        }, {
            readonly name: "treasury";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [116, 114, 101, 97, 115, 117, 114, 121];
                }];
            };
        }, {
            readonly name: "certificate";
            readonly writable: true;
        }, {
            readonly name: "holder_token";
        }, {
            readonly name: "instructions";
            readonly address: "Sysvar1nstructions1111111111111111111111111";
        }, {
            readonly name: "system_program";
            readonly address: "11111111111111111111111111111111";
        }];
        readonly args: readonly [{
            readonly name: "att";
            readonly type: {
                readonly defined: {
                    readonly name: "Attestation";
                };
            };
        }];
    }, {
        readonly name: "require_certificate";
        readonly docs: readonly ["The CPI gate for other programs: fails unless the certificate at [\"cert\", subject_hash, [asset]] is live, unexpired and at", "least `min_tier`; returns its kind, tier, expiry and controller."];
        readonly discriminator: readonly [133, 238, 16, 4, 145, 190, 131, 187];
        readonly accounts: readonly [{
            readonly name: "certificate";
        }];
        readonly args: readonly [{
            readonly name: "subject_hash";
            readonly type: {
                readonly array: readonly ["u8", 32];
            };
        }, {
            readonly name: "asset";
            readonly type: "u8";
        }, {
            readonly name: "min_tier";
            readonly type: "u8";
        }];
        readonly returns: {
            readonly defined: {
                readonly name: "CertView";
            };
        };
    }, {
        readonly name: "revoke_by_holder";
        readonly docs: readonly ["The certificate's controller withdraws it, at any moment."];
        readonly discriminator: readonly [166, 202, 246, 103, 191, 5, 172, 192];
        readonly accounts: readonly [{
            readonly name: "controller";
            readonly signer: true;
        }, {
            readonly name: "config";
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
        }, {
            readonly name: "treasury";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [116, 114, 101, 97, 115, 117, 114, 121];
                }];
            };
        }, {
            readonly name: "certificate";
            readonly writable: true;
        }];
        readonly args: readonly [];
    }, {
        readonly name: "revoke_spent";
        readonly docs: readonly ["Anyone: a disclosed note's salt and nullifier, and a proof that the nullifier is spent on the Rings program: without", "`membership`, its nullifier PDA [\"nullifier\", tree, nullifier] exists now (pass it as nullifier_account); with it, the", "nullifier is a leaf of the tree's folded nullifier tree under one of the 100 roots the tree holds (for a PDA the pool has", "closed). The salt and nullifier become public."];
        readonly discriminator: readonly [143, 133, 193, 161, 71, 33, 14, 131];
        readonly accounts: readonly [{
            readonly name: "caller";
            readonly signer: true;
        }, {
            readonly name: "config";
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
        }, {
            readonly name: "treasury";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [116, 114, 101, 97, 115, 117, 114, 121];
                }];
            };
        }, {
            readonly name: "certificate";
            readonly writable: true;
        }, {
            readonly name: "tree";
        }, {
            readonly name: "nullifier_account";
            readonly optional: true;
        }];
        readonly args: readonly [{
            readonly name: "index";
            readonly type: "u8";
        }, {
            readonly name: "salt";
            readonly type: {
                readonly array: readonly ["u8", 32];
            };
        }, {
            readonly name: "nullifier";
            readonly type: {
                readonly array: readonly ["u8", 32];
            };
        }, {
            readonly name: "membership";
            readonly type: {
                readonly option: {
                    readonly defined: {
                        readonly name: "Membership";
                    };
                };
            };
        }];
    }, {
        readonly name: "set_asset";
        readonly docs: readonly ["A new asset's tier table in a free slot; on an asset already set only `enabled` may change (the tiers of certificates", "already issued never change meaning)."];
        readonly discriminator: readonly [243, 216, 48, 30, 63, 58, 91, 239];
        readonly accounts: readonly [{
            readonly name: "admin";
            readonly signer: true;
            readonly relations: readonly ["config"];
        }, {
            readonly name: "config";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
        }];
        readonly args: readonly [{
            readonly name: "asset";
            readonly type: "u8";
        }, {
            readonly name: "tiers";
            readonly type: {
                readonly defined: {
                    readonly name: "AssetTiers";
                };
            };
        }];
    }, {
        readonly name: "set_fee";
        readonly docs: readonly ["The fee per certify and per renew alone (at most FEE_CAP)."];
        readonly discriminator: readonly [18, 154, 24, 18, 237, 214, 19, 80];
        readonly accounts: readonly [{
            readonly name: "admin";
            readonly signer: true;
            readonly relations: readonly ["config"];
        }, {
            readonly name: "config";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
        }];
        readonly args: readonly [{
            readonly name: "fee_lamports";
            readonly type: "u64";
        }];
    }, {
        readonly name: "set_params";
        readonly docs: readonly ["Every parameter at once, within the bounds (the fee at most FEE_CAP)."];
        readonly discriminator: readonly [27, 234, 178, 52, 147, 2, 187, 141];
        readonly accounts: readonly [{
            readonly name: "admin";
            readonly signer: true;
            readonly relations: readonly ["config"];
        }, {
            readonly name: "config";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
        }];
        readonly args: readonly [{
            readonly name: "params";
            readonly type: {
                readonly defined: {
                    readonly name: "Params";
                };
            };
        }];
    }, {
        readonly name: "set_paused";
        readonly docs: readonly ["No certify or renew while paused (revocations and expiry never pause). Immediate, for a leaked Verifier key."];
        readonly discriminator: readonly [91, 60, 125, 192, 176, 225, 166, 218];
        readonly accounts: readonly [{
            readonly name: "admin";
            readonly signer: true;
            readonly relations: readonly ["config"];
        }, {
            readonly name: "config";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
        }];
        readonly args: readonly [{
            readonly name: "paused";
            readonly type: "bool";
        }];
    }, {
        readonly name: "set_roles";
        readonly docs: readonly ["The dev and relayer keys (None leaves them), and the root mint once (pass its mint account)."];
        readonly discriminator: readonly [119, 86, 129, 161, 55, 23, 250, 12];
        readonly accounts: readonly [{
            readonly name: "admin";
            readonly signer: true;
            readonly relations: readonly ["config"];
        }, {
            readonly name: "config";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
        }, {
            readonly name: "root_mint";
            readonly optional: true;
        }];
        readonly args: readonly [{
            readonly name: "dev";
            readonly type: {
                readonly option: "pubkey";
            };
        }, {
            readonly name: "relayer";
            readonly type: {
                readonly option: "pubkey";
            };
        }];
    }, {
        readonly name: "set_verifier";
        readonly docs: readonly ["Propose the next Verifier key: it takes over rotation_delay slots from now (by itself; `apply_verifier` records it). The", "default key cancels a pending proposal at once."];
        readonly discriminator: readonly [186, 247, 191, 131, 148, 158, 213, 63];
        readonly accounts: readonly [{
            readonly name: "admin";
            readonly signer: true;
            readonly relations: readonly ["config"];
        }, {
            readonly name: "config";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
        }];
        readonly args: readonly [{
            readonly name: "next";
            readonly type: "pubkey";
        }];
    }, {
        readonly name: "withdraw_fees";
        readonly docs: readonly ["The treasury's fees to the dev wallet (0: all of them); its rent stays."];
        readonly discriminator: readonly [198, 212, 171, 109, 144, 215, 174, 89];
        readonly accounts: readonly [{
            readonly name: "admin";
            readonly signer: true;
            readonly relations: readonly ["config"];
        }, {
            readonly name: "config";
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
        }, {
            readonly name: "treasury";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [116, 114, 101, 97, 115, 117, 114, 121];
                }];
            };
        }, {
            readonly name: "dev";
            readonly writable: true;
            readonly relations: readonly ["config"];
        }];
        readonly args: readonly [{
            readonly name: "lamports";
            readonly type: "u64";
        }];
    }];
    readonly accounts: readonly [{
        readonly name: "Certificate";
        readonly discriminator: readonly [202, 229, 222, 220, 116, 20, 74, 67];
    }, {
        readonly name: "Config";
        readonly discriminator: readonly [155, 12, 170, 224, 30, 250, 204, 130];
    }, {
        readonly name: "Treasury";
        readonly discriminator: readonly [238, 239, 123, 238, 89, 1, 168, 253];
    }];
    readonly events: readonly [{
        readonly name: "AssetSet";
        readonly discriminator: readonly [175, 84, 64, 85, 102, 200, 50, 40];
    }, {
        readonly name: "Certified";
        readonly discriminator: readonly [47, 44, 174, 70, 153, 102, 41, 72];
    }, {
        readonly name: "ClosingBegun";
        readonly discriminator: readonly [3, 21, 199, 214, 209, 212, 107, 91];
    }, {
        readonly name: "ConfigSet";
        readonly discriminator: readonly [15, 104, 59, 16, 236, 241, 8, 6];
    }, {
        readonly name: "Expired";
        readonly discriminator: readonly [197, 227, 104, 103, 133, 50, 207, 161];
    }, {
        readonly name: "FeesWithdrawn";
        readonly discriminator: readonly [234, 15, 0, 119, 148, 241, 40, 21];
    }, {
        readonly name: "LogAnchored";
        readonly discriminator: readonly [63, 53, 65, 90, 183, 145, 180, 157];
    }, {
        readonly name: "PausedSet";
        readonly discriminator: readonly [171, 125, 127, 156, 233, 81, 68, 66];
    }, {
        readonly name: "Renewed";
        readonly discriminator: readonly [139, 252, 217, 35, 73, 42, 7, 87];
    }, {
        readonly name: "Revoked";
        readonly discriminator: readonly [113, 216, 148, 99, 124, 184, 0, 65];
    }, {
        readonly name: "VerifierSet";
        readonly discriminator: readonly [127, 200, 69, 52, 190, 16, 199, 53];
    }];
    readonly errors: readonly [{
        readonly code: 6000;
        readonly name: "NotUpgradeAuthority";
        readonly msg: "only the program's upgrade authority may run init_config";
    }, {
        readonly code: 6001;
        readonly name: "NotAdmin";
        readonly msg: "only the admin may do this";
    }, {
        readonly code: 6002;
        readonly name: "BadParams";
        readonly msg: "a setting is out of its bounds";
    }, {
        readonly code: 6003;
        readonly name: "FeeAboveCap";
        readonly msg: "the fee is above the cap";
    }, {
        readonly code: 6004;
        readonly name: "RootSet";
        readonly msg: "the root mint is already set";
    }, {
        readonly code: 6005;
        readonly name: "BadMint";
        readonly msg: "not a token mint";
    }, {
        readonly code: 6006;
        readonly name: "BadHolderAccount";
        readonly msg: "the holder token account is not the payer's canonical root account";
    }, {
        readonly code: 6007;
        readonly name: "Paused";
        readonly msg: "certify and renew are paused";
    }, {
        readonly code: 6008;
        readonly name: "Closing";
        readonly msg: "the program is winding down";
    }, {
        readonly code: 6009;
        readonly name: "NotClosing";
        readonly msg: "the program is not winding down";
    }, {
        readonly code: 6010;
        readonly name: "NoVerifier";
        readonly msg: "no verifier key is set";
    }, {
        readonly code: 6011;
        readonly name: "NoSignature";
        readonly msg: "no ed25519 instruction right before this one";
    }, {
        readonly code: 6012;
        readonly name: "BadSignatureLayout";
        readonly msg: "the ed25519 instruction is not one signature over its own data";
    }, {
        readonly code: 6013;
        readonly name: "WrongVerifier";
        readonly msg: "the attestation is not signed by the active verifier key";
    }, {
        readonly code: 6014;
        readonly name: "AttestationMismatch";
        readonly msg: "the signed bytes differ from the attestation rebuilt on chain";
    }, {
        readonly code: 6015;
        readonly name: "BadSubjectKind";
        readonly msg: "unknown subject kind";
    }, {
        readonly code: 6016;
        readonly name: "SubjectMismatch";
        readonly msg: "the subject hash does not belong to the controller key";
    }, {
        readonly code: 6017;
        readonly name: "BadAsset";
        readonly msg: "the asset is not enabled";
    }, {
        readonly code: 6018;
        readonly name: "BadTier";
        readonly msg: "no such tier for this asset";
    }, {
        readonly code: 6019;
        readonly name: "BadNoteCount";
        readonly msg: "note count must be 1 to 8 and match the nullifier hashes";
    }, {
        readonly code: 6020;
        readonly name: "NullHashesUnsorted";
        readonly msg: "the salted nullifier hashes must be sorted ascending without repeats";
    }, {
        readonly code: 6021;
        readonly name: "IssuedInFuture";
        readonly msg: "the attestation was issued in the future";
    }, {
        readonly code: 6022;
        readonly name: "AttestationStale";
        readonly msg: "the attestation is too old to submit";
    }, {
        readonly code: 6023;
        readonly name: "RootStale";
        readonly msg: "the tree root was read too long before the attestation";
    }, {
        readonly code: 6024;
        readonly name: "BadExpiry";
        readonly msg: "the expiry is not after the issue slot, or longer than the validity";
    }, {
        readonly code: 6025;
        readonly name: "Expired";
        readonly msg: "the attestation has already expired";
    }, {
        readonly code: 6026;
        readonly name: "PayerMismatch";
        readonly msg: "the payer in the attestation is not the signer paying";
    }, {
        readonly code: 6027;
        readonly name: "AlreadyLive";
        readonly msg: "a live certificate already exists for this subject and asset: renew it";
    }, {
        readonly code: 6028;
        readonly name: "PriorPayerMissing";
        readonly msg: "the previous payer of this certificate must be passed to take its rent back";
    }, {
        readonly code: 6029;
        readonly name: "Replayed";
        readonly msg: "this attestation is not newer than the one the certificate holds";
    }, {
        readonly code: 6030;
        readonly name: "NotLive";
        readonly msg: "the certificate is not live";
    }, {
        readonly code: 6031;
        readonly name: "CertificateExpired";
        readonly msg: "the certificate has expired";
    }, {
        readonly code: 6032;
        readonly name: "TierTooLow";
        readonly msg: "the certificate is below the required tier";
    }, {
        readonly code: 6033;
        readonly name: "AssetMismatch";
        readonly msg: "the certificate is for another asset";
    }, {
        readonly code: 6034;
        readonly name: "BadCertificate";
        readonly msg: "not this program's certificate at the subject's address";
    }, {
        readonly code: 6035;
        readonly name: "RenewMismatch";
        readonly msg: "renew must carry the same notes, subject, asset and controller";
    }, {
        readonly code: 6036;
        readonly name: "BadIndex";
        readonly msg: "no disclosed note at that index";
    }, {
        readonly code: 6037;
        readonly name: "NullifierMismatch";
        readonly msg: "salt and nullifier do not hash to the disclosed note";
    }, {
        readonly code: 6038;
        readonly name: "NotSpent";
        readonly msg: "the nullifier is not shown as spent by this proof";
    }, {
        readonly code: 6039;
        readonly name: "BadRingsAccounts";
        readonly msg: "the Rings accounts passed are not the Rings program's";
    }, {
        readonly code: 6040;
        readonly name: "NotController";
        readonly msg: "only the certificate's controller may do this";
    }, {
        readonly code: 6041;
        readonly name: "NotExpired";
        readonly msg: "the certificate has not expired yet";
    }, {
        readonly code: 6042;
        readonly name: "NotPayer";
        readonly msg: "the rent goes back to the certificate's payer";
    }, {
        readonly code: 6043;
        readonly name: "LogNotGrowing";
        readonly msg: "the log can only grow";
    }, {
        readonly code: 6044;
        readonly name: "TreasuryShort";
        readonly msg: "the treasury cannot pay that much";
    }, {
        readonly code: 6045;
        readonly name: "NoRotationDue";
        readonly msg: "no verifier key is waiting, or its delay has not passed";
    }, {
        readonly code: 6046;
        readonly name: "Overflow";
        readonly msg: "arithmetic overflow";
    }];
    readonly types: readonly [{
        readonly name: "AssetSet";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "asset";
                readonly type: "u8";
            }, {
                readonly name: "tiers";
                readonly type: {
                    readonly defined: {
                        readonly name: "AssetTiers";
                    };
                };
            }];
        };
    }, {
        readonly name: "AssetTiers";
        readonly docs: readonly ["One asset's tier table (CONTRACT §2): tier i (1-based) needs at least mins[i-1] base units; zeros end the table."];
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "enabled";
                readonly type: "bool";
            }, {
                readonly name: "mint";
                readonly docs: readonly ["The SPL mint (USDC), or the default key for native SOL."];
                readonly type: "pubkey";
            }, {
                readonly name: "decimals";
                readonly type: "u8";
            }, {
                readonly name: "mins";
                readonly type: {
                    readonly array: readonly ["u64", 5];
                };
            }];
        };
    }, {
        readonly name: "Attestation";
        readonly docs: readonly ["The attestation as `certify` and `renew` take it; with the payer (signer) and the program id it rebuilds CONTRACT §3."];
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "subject_kind";
                readonly type: "u8";
            }, {
                readonly name: "subject_hash";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "asset";
                readonly type: "u8";
            }, {
                readonly name: "tier";
                readonly type: "u8";
            }, {
                readonly name: "tree_root";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "root_slot";
                readonly type: "u64";
            }, {
                readonly name: "null_hashes";
                readonly docs: readonly ["The salted nullifier hashes, sorted ascending, 1 to 8 (their count is the note_count byte)."];
                readonly type: {
                    readonly vec: {
                        readonly array: readonly ["u8", 32];
                    };
                };
            }, {
                readonly name: "issued_slot";
                readonly type: "u64";
            }, {
                readonly name: "expiry_slot";
                readonly type: "u64";
            }, {
                readonly name: "controller";
                readonly type: "pubkey";
            }, {
                readonly name: "nonce";
                readonly type: {
                    readonly array: readonly ["u8", 16];
                };
            }];
        };
    }, {
        readonly name: "CertView";
        readonly docs: readonly ["What `require_certificate` returns (also its return data)."];
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "subject_kind";
                readonly type: "u8";
            }, {
                readonly name: "tier";
                readonly type: "u8";
            }, {
                readonly name: "expiry_slot";
                readonly type: "u64";
            }, {
                readonly name: "controller";
                readonly type: "pubkey";
            }];
        };
    }, {
        readonly name: "Certificate";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "subject_kind";
                readonly type: "u8";
            }, {
                readonly name: "subject_hash";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "asset";
                readonly type: "u8";
            }, {
                readonly name: "tier";
                readonly type: "u8";
            }, {
                readonly name: "status";
                readonly docs: readonly ["STATUS_LIVE, STATUS_REVOKED_SPENT, STATUS_REVOKED_HOLDER (STATUS_EXPIRED is what readers show past expiry_slot; the account", "itself closes at `expire`)."];
                readonly type: "u8";
            }, {
                readonly name: "certified_slot";
                readonly docs: readonly ["The slot this certificate was made (or remade after a revocation), and of its latest attestation."];
                readonly type: "u64";
            }, {
                readonly name: "issued_slot";
                readonly type: "u64";
            }, {
                readonly name: "expiry_slot";
                readonly type: "u64";
            }, {
                readonly name: "revoked_slot";
                readonly type: "u64";
            }, {
                readonly name: "tree_root";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "root_slot";
                readonly type: "u64";
            }, {
                readonly name: "note_count";
                readonly type: "u8";
            }, {
                readonly name: "null_hashes";
                readonly docs: readonly ["The sorted salted nullifier hashes h (CONTRACT §5), the first note_count used."];
                readonly type: {
                    readonly array: readonly [{
                        readonly array: readonly ["u8", 32];
                    }, 8];
                };
            }, {
                readonly name: "nullset_hash";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "payer";
                readonly docs: readonly ["Paid the rent (gets it back at `expire`)."];
                readonly type: "pubkey";
            }, {
                readonly name: "controller";
                readonly docs: readonly ["May revoke it and join rooms with it."];
                readonly type: "pubkey";
            }, {
                readonly name: "verifier";
                readonly docs: readonly ["The Verifier key that signed the latest attestation."];
                readonly type: "pubkey";
            }, {
                readonly name: "nonce";
                readonly type: {
                    readonly array: readonly ["u8", 16];
                };
            }, {
                readonly name: "log_index";
                readonly docs: readonly ["The attestation's index in the transparency log (as the submitter states it; the log proof is the check)."];
                readonly type: "u64";
            }, {
                readonly name: "renewals";
                readonly type: "u32";
            }, {
                readonly name: "revealed_index";
                readonly docs: readonly ["After revoke_spent: which note (255: none), its salt and nullifier, now public."];
                readonly type: "u8";
            }, {
                readonly name: "revealed_salt";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "revealed_nullifier";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "bump";
                readonly type: "u8";
            }];
        };
    }, {
        readonly name: "Certified";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "subject_kind";
                readonly type: "u8";
            }, {
                readonly name: "subject_hash";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "asset";
                readonly type: "u8";
            }, {
                readonly name: "tier";
                readonly type: "u8";
            }, {
                readonly name: "certified_slot";
                readonly type: "u64";
            }, {
                readonly name: "expiry_slot";
                readonly type: "u64";
            }, {
                readonly name: "note_count";
                readonly type: "u8";
            }, {
                readonly name: "payer";
                readonly type: "pubkey";
            }, {
                readonly name: "controller";
                readonly type: "pubkey";
            }, {
                readonly name: "verifier";
                readonly type: "pubkey";
            }, {
                readonly name: "log_index";
                readonly type: "u64";
            }, {
                readonly name: "fee";
                readonly type: "u64";
            }];
        };
    }, {
        readonly name: "ClosingBegun";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "slot";
                readonly type: "u64";
            }];
        };
    }, {
        readonly name: "Config";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "admin";
                readonly type: "pubkey";
            }, {
                readonly name: "dev";
                readonly docs: readonly ["Where `withdraw_fees` sends the treasury's surplus."];
                readonly type: "pubkey";
            }, {
                readonly name: "relayer";
                readonly docs: readonly ["The relayer's key: certificates it pays for owe no on-chain fee (the holder paid it privately)."];
                readonly type: "pubkey";
            }, {
                readonly name: "verifier";
                readonly docs: readonly ["The Verifier's ed25519 key that signs attestations now (default: none, nothing certifies)."];
                readonly type: "pubkey";
            }, {
                readonly name: "next_verifier";
                readonly docs: readonly ["A proposed key and the slot it takes over at (default key: nothing proposed)."];
                readonly type: "pubkey";
            }, {
                readonly name: "next_verifier_slot";
                readonly type: "u64";
            }, {
                readonly name: "root_mint";
                readonly docs: readonly ["$ROOT; default until set_roles (nobody counts as a holder until then)."];
                readonly type: "pubkey";
            }, {
                readonly name: "root_token_program";
                readonly type: "pubkey";
            }, {
                readonly name: "params";
                readonly type: {
                    readonly defined: {
                        readonly name: "Params";
                    };
                };
            }, {
                readonly name: "assets";
                readonly docs: readonly ["The tier tables by asset id (CONTRACT §2): 0 SOL, 1 USDC, 2 and 3 free for new assets."];
                readonly type: {
                    readonly array: readonly [{
                        readonly defined: {
                            readonly name: "AssetTiers";
                        };
                    }, 4];
                };
            }, {
                readonly name: "paused";
                readonly type: "bool";
            }, {
                readonly name: "closing";
                readonly type: "bool";
            }, {
                readonly name: "launch_slot";
                readonly type: "u64";
            }, {
                readonly name: "bump";
                readonly type: "u8";
            }, {
                readonly name: "treasury_bump";
                readonly type: "u8";
            }];
        };
    }, {
        readonly name: "ConfigSet";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "admin";
                readonly type: "pubkey";
            }, {
                readonly name: "dev";
                readonly type: "pubkey";
            }, {
                readonly name: "relayer";
                readonly type: "pubkey";
            }, {
                readonly name: "root_mint";
                readonly type: "pubkey";
            }, {
                readonly name: "params";
                readonly type: {
                    readonly defined: {
                        readonly name: "Params";
                    };
                };
            }];
        };
    }, {
        readonly name: "Expired";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "subject_hash";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "asset";
                readonly type: "u8";
            }, {
                readonly name: "tier";
                readonly type: "u8";
            }, {
                readonly name: "status";
                readonly type: "u8";
            }, {
                readonly name: "slot";
                readonly type: "u64";
            }, {
                readonly name: "payer";
                readonly type: "pubkey";
            }];
        };
    }, {
        readonly name: "FeesWithdrawn";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "lamports";
                readonly type: "u64";
            }, {
                readonly name: "to";
                readonly type: "pubkey";
            }];
        };
    }, {
        readonly name: "LogAnchored";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "size";
                readonly type: "u64";
            }, {
                readonly name: "head";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "slot";
                readonly type: "u64";
            }];
        };
    }, {
        readonly name: "Membership";
        readonly docs: readonly ["A membership path of a nullifier in the tree's folded nullifier tree (pof/RINGS.md §3): its leaf index, the next value of", "its indexed leaf, the siblings from the leaf up (at most 40; upper levels left out are empty subtrees)."];
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "leaf_index";
                readonly type: "u64";
            }, {
                readonly name: "next_value";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "path";
                readonly type: {
                    readonly vec: {
                        readonly array: readonly ["u8", 32];
                    };
                };
            }];
        };
    }, {
        readonly name: "Params";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "fee_lamports";
                readonly docs: readonly ["Lamports per certify and per renew, to the treasury (at most FEE_CAP)."];
                readonly type: "u64";
            }, {
                readonly name: "holder_min";
                readonly docs: readonly ["Base units of $ROOT a payer's canonical account must hold to pay no fee (1,000,000 $ROOT at 6 decimals)."];
                readonly type: "u64";
            }, {
                readonly name: "validity_slots";
                readonly docs: readonly ["An attestation's expiry may be at most this many slots after its issue slot."];
                readonly type: "u64";
            }, {
                readonly name: "max_attest_age";
                readonly docs: readonly ["An attestation must reach the chain within this many slots of its issue slot."];
                readonly type: "u64";
            }, {
                readonly name: "max_root_lag";
                readonly docs: readonly ["The tree root must have been read at most this many slots before the issue slot."];
                readonly type: "u64";
            }, {
                readonly name: "rotation_delay";
                readonly docs: readonly ["Slots between `set_verifier` and the new key taking over."];
                readonly type: "u64";
            }];
        };
    }, {
        readonly name: "PausedSet";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "paused";
                readonly type: "bool";
            }];
        };
    }, {
        readonly name: "Renewed";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "subject_hash";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "asset";
                readonly type: "u8";
            }, {
                readonly name: "tier";
                readonly type: "u8";
            }, {
                readonly name: "issued_slot";
                readonly type: "u64";
            }, {
                readonly name: "expiry_slot";
                readonly type: "u64";
            }, {
                readonly name: "payer";
                readonly type: "pubkey";
            }, {
                readonly name: "verifier";
                readonly type: "pubkey";
            }, {
                readonly name: "fee";
                readonly type: "u64";
            }, {
                readonly name: "renewals";
                readonly type: "u32";
            }];
        };
    }, {
        readonly name: "Revoked";
        readonly docs: readonly ["path: 0 nullifier PDA, 1 nullifier tree membership, 3 by the holder."];
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "subject_hash";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "asset";
                readonly type: "u8";
            }, {
                readonly name: "tier";
                readonly type: "u8";
            }, {
                readonly name: "status";
                readonly type: "u8";
            }, {
                readonly name: "slot";
                readonly type: "u64";
            }, {
                readonly name: "by";
                readonly type: "pubkey";
            }, {
                readonly name: "index";
                readonly type: "u8";
            }, {
                readonly name: "salt";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "nullifier";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "path";
                readonly type: "u8";
            }];
        };
    }, {
        readonly name: "Treasury";
        readonly docs: readonly ["The treasury holds the fees (its lamports above its rent) and the public counters."];
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "fees_in";
                readonly type: "u64";
            }, {
                readonly name: "fees_out";
                readonly type: "u64";
            }, {
                readonly name: "certified";
                readonly docs: readonly ["certify calls that made or remade a certificate; renews."];
                readonly type: "u64";
            }, {
                readonly name: "renewed";
                readonly type: "u64";
            }, {
                readonly name: "revoked_spent";
                readonly type: "u64";
            }, {
                readonly name: "revoked_holder";
                readonly type: "u64";
            }, {
                readonly name: "expired";
                readonly type: "u64";
            }, {
                readonly name: "live";
                readonly docs: readonly ["Live certificates (status live, closed or not past their expiry yet) and the sum of their tier minimums by asset."];
                readonly type: "u64";
            }, {
                readonly name: "live_min";
                readonly type: {
                    readonly array: readonly ["u64", 4];
                };
            }, {
                readonly name: "open";
                readonly docs: readonly ["Certificate accounts that exist now (rent held for payers)."];
                readonly type: "u64";
            }, {
                readonly name: "relayed";
                readonly docs: readonly ["certify/renew paid by the relayer; by a $ROOT holder (no fee in both)."];
                readonly type: "u64";
            }, {
                readonly name: "exempt";
                readonly type: "u64";
            }, {
                readonly name: "log_size";
                readonly docs: readonly ["The transparency log's latest signed head anchored on chain: its size, its root hash, the slot."];
                readonly type: "u64";
            }, {
                readonly name: "log_head";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "log_slot";
                readonly type: "u64";
            }, {
                readonly name: "bump";
                readonly type: "u8";
            }];
        };
    }, {
        readonly name: "VerifierSet";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "verifier";
                readonly type: "pubkey";
            }, {
                readonly name: "next_verifier";
                readonly type: "pubkey";
            }, {
                readonly name: "next_verifier_slot";
                readonly type: "u64";
            }];
        };
    }];
};
