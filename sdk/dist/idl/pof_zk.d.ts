export declare const IDL_IS_DRAFT = false;
export declare const POF_ZK_IDL: {
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
        readonly name: "certify_zk";
        readonly docs: readonly ["Phase 2: certify from a Groth16 proof of funds (pof/zk) instead of the Verifier's signature. See zk.rs."];
        readonly discriminator: readonly [96, 7, 247, 175, 189, 16, 188, 111];
        readonly accounts: readonly [{
            readonly name: "payer";
            readonly writable: true;
            readonly signer: true;
        }, {
            readonly name: "controller";
            readonly docs: readonly ["The subject key (wallet or badge): it consents by signing; may be the payer."];
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
            readonly name: "zk";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [122, 107];
                }];
            };
        }, {
            readonly name: "registry";
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [122, 107, 114, 101, 103];
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
            readonly name: "tree";
        }, {
            readonly name: "system_program";
            readonly address: "11111111111111111111111111111111";
        }];
        readonly args: readonly [{
            readonly name: "args";
            readonly type: {
                readonly defined: {
                    readonly name: "ZkArgs";
                };
            };
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
        readonly name: "close_path";
        readonly docs: readonly ["The revoker drops its staged buffer (rent back); during the wind-down anyone may."];
        readonly discriminator: readonly [228, 246, 66, 195, 202, 252, 223, 199];
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
            readonly name: "buffer";
            readonly writable: true;
        }, {
            readonly name: "revoker";
            readonly writable: true;
        }];
        readonly args: readonly [];
    }, {
        readonly name: "close_zk";
        readonly docs: readonly ["Wind-down only (audit LW-01): the ZkConfig [\"zk\"] and the owner registry [\"zkreg\"] close, their rent to the admin. Run", "after every certificate expired and every note lock was released, before close_config."];
        readonly discriminator: readonly [186, 191, 205, 32, 107, 130, 198, 60];
        readonly accounts: readonly [{
            readonly name: "admin";
            readonly writable: true;
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
            readonly name: "zk";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [122, 107];
                }];
            };
        }, {
            readonly name: "registry";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [122, 107, 114, 101, 103];
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
        readonly name: "open_path";
        readonly docs: readonly ["Open the revoker's buffer for this certificate (the revoker pays its rent) with the nullifier, its next value, its leaf", "index and the first siblings (from the leaf up); `stage_path` adds the rest. Two transactions carry the full 40 levels."];
        readonly discriminator: readonly [239, 145, 149, 165, 39, 35, 63, 161];
        readonly accounts: readonly [{
            readonly name: "revoker";
            readonly writable: true;
            readonly signer: true;
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
        }, {
            readonly name: "buffer";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [112, 97, 116, 104];
                }, {
                    readonly kind: "account";
                    readonly path: "revoker";
                }, {
                    readonly kind: "account";
                    readonly path: "certificate";
                }];
            };
        }, {
            readonly name: "system_program";
            readonly address: "11111111111111111111111111111111";
        }];
        readonly args: readonly [{
            readonly name: "nullifier";
            readonly type: {
                readonly array: readonly ["u8", 32];
            };
        }, {
            readonly name: "next_value";
            readonly type: {
                readonly array: readonly ["u8", 32];
            };
        }, {
            readonly name: "leaf_index";
            readonly type: "u64";
        }, {
            readonly name: "siblings";
            readonly type: {
                readonly vec: {
                    readonly array: readonly ["u8", 32];
                };
            };
        }];
    }, {
        readonly name: "register_zk_owner";
        readonly docs: readonly ["The ring owner registers its zk owner commitment (the consent certify_zk proves)."];
        readonly discriminator: readonly [202, 209, 9, 250, 182, 12, 179, 171];
        readonly accounts: readonly [{
            readonly name: "owner";
            readonly docs: readonly ["The ring owner (the vault key): its signature is the consent the circuit later proves."];
            readonly signer: true;
        }, {
            readonly name: "registry";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [122, 107, 114, 101, 103];
                }];
            };
        }];
        readonly args: readonly [{
            readonly name: "commitment";
            readonly type: {
                readonly array: readonly ["u8", 32];
            };
        }];
    }, {
        readonly name: "release_note_lock";
        readonly docs: readonly ["Anyone: close a note lock whose certificate is no longer live."];
        readonly discriminator: readonly [199, 220, 11, 102, 53, 157, 182, 199];
        readonly accounts: readonly [{
            readonly name: "lock";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [122, 110, 111, 116, 101];
                }, {
                    readonly kind: "account";
                    readonly path: "lock.tag";
                    readonly account: "NoteLock";
                }];
            };
        }, {
            readonly name: "certificate";
        }, {
            readonly name: "payer";
            readonly writable: true;
        }];
        readonly args: readonly [];
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
        }, {
            readonly name: "config";
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [99, 111, 110, 102, 105, 103];
                }];
            };
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
        readonly name: "revoke_signed";
        readonly docs: readonly ["Anyone submits the controller's signed revoke (Ed25519 instruction right before, signed by the certificate's controller", "key over the 156 POF-REVOKE1 bytes, usable until `valid_until`). The holder's wallet never signs or pays: for an X-handle", "or badge certificate the relayer submits it."];
        readonly discriminator: readonly [224, 136, 97, 88, 214, 203, 185, 196];
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
            readonly name: "instructions";
            readonly address: "Sysvar1nstructions1111111111111111111111111";
        }];
        readonly args: readonly [{
            readonly name: "valid_until";
            readonly type: "u64";
        }];
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
        readonly name: "revoke_spent_staged";
        readonly docs: readonly ["The staged proof: the revoker's buffer for this certificate holds a membership path of its nullifier; the program hashes", "all 40 levels to the root and checks it is one of the 100 nullifier roots the tree account holds NOW, checks the salted", "hash of the disclosed note, revokes, and closes the buffer (rent back to the revoker)."];
        readonly discriminator: readonly [255, 103, 254, 43, 147, 107, 237, 146];
        readonly accounts: readonly [{
            readonly name: "revoker";
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
            readonly name: "tree";
        }, {
            readonly name: "buffer";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [112, 97, 116, 104];
                }, {
                    readonly kind: "account";
                    readonly path: "revoker";
                }, {
                    readonly kind: "account";
                    readonly path: "certificate";
                }];
            };
        }];
        readonly args: readonly [{
            readonly name: "index";
            readonly type: "u8";
        }, {
            readonly name: "salt";
            readonly type: {
                readonly array: readonly ["u8", 32];
            };
        }];
    }, {
        readonly name: "revoke_verifier_key";
        readonly docs: readonly ["The admin revokes a Verifier key at once (a leak, or a key retired after rotation): it signs nothing more, and every", "certificate it signed fails require_certificate and Rooms from now on; `void_by_key` marks each of them. At most 4 keys."];
        readonly discriminator: readonly [38, 162, 12, 240, 52, 250, 34, 161];
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
            readonly name: "key";
            readonly type: "pubkey";
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
        readonly name: "set_zk";
        readonly docs: readonly ["Admin: turn certify_zk on or off and set the revocation (escrow) key; records the build's verifying key hash."];
        readonly discriminator: readonly [226, 103, 224, 87, 119, 167, 193, 186];
        readonly accounts: readonly [{
            readonly name: "admin";
            readonly writable: true;
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
            readonly name: "zk";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [122, 107];
                }];
            };
        }, {
            readonly name: "registry";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [122, 107, 114, 101, 103];
                }];
            };
        }, {
            readonly name: "system_program";
            readonly address: "11111111111111111111111111111111";
        }];
        readonly args: readonly [{
            readonly name: "enabled";
            readonly type: "bool";
        }, {
            readonly name: "escrow";
            readonly type: {
                readonly array: readonly [{
                    readonly array: readonly ["u8", 32];
                }, 2];
            };
        }];
    }, {
        readonly name: "stage_path";
        readonly docs: readonly ["Write `siblings` at levels offset.. of the revoker's open buffer (no gap above what is written; a level may be rewritten)."];
        readonly discriminator: readonly [68, 97, 146, 218, 201, 81, 33, 62];
        readonly accounts: readonly [{
            readonly name: "revoker";
            readonly signer: true;
            readonly relations: readonly ["buffer"];
        }, {
            readonly name: "buffer";
            readonly writable: true;
        }];
        readonly args: readonly [{
            readonly name: "offset";
            readonly type: "u8";
        }, {
            readonly name: "siblings";
            readonly type: {
                readonly vec: {
                    readonly array: readonly ["u8", 32];
                };
            };
        }];
    }, {
        readonly name: "void_by_key";
        readonly docs: readonly ["Anyone: a live certificate signed by a revoked Verifier key becomes voided (status 4)."];
        readonly discriminator: readonly [74, 62, 124, 112, 58, 63, 147, 156];
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
        }];
        readonly args: readonly [];
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
        readonly name: "NoteLock";
        readonly discriminator: readonly [189, 43, 98, 15, 18, 238, 104, 64];
    }, {
        readonly name: "PathBuffer";
        readonly discriminator: readonly [15, 240, 22, 62, 212, 197, 226, 181];
    }, {
        readonly name: "Treasury";
        readonly discriminator: readonly [238, 239, 123, 238, 89, 1, 168, 253];
    }, {
        readonly name: "ZkConfig";
        readonly discriminator: readonly [181, 176, 242, 167, 108, 219, 13, 202];
    }, {
        readonly name: "ZkRegistry";
        readonly discriminator: readonly [179, 149, 101, 22, 34, 133, 223, 52];
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
        readonly name: "NoteReleased";
        readonly discriminator: readonly [147, 68, 218, 190, 7, 90, 172, 64];
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
        readonly name: "VerifierKeyRevoked";
        readonly discriminator: readonly [227, 104, 7, 71, 203, 98, 107, 98];
    }, {
        readonly name: "VerifierSet";
        readonly discriminator: readonly [127, 200, 69, 52, 190, 16, 199, 53];
    }, {
        readonly name: "ZkCertified";
        readonly discriminator: readonly [196, 133, 181, 152, 252, 22, 235, 172];
    }, {
        readonly name: "ZkConfigSet";
        readonly discriminator: readonly [223, 67, 224, 100, 156, 174, 146, 215];
    }, {
        readonly name: "ZkOwnerRegistered";
        readonly discriminator: readonly [170, 98, 201, 235, 61, 29, 165, 46];
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
        readonly name: "KeyRevoked";
        readonly msg: "the Verifier key that signed this has been revoked";
    }, {
        readonly code: 6047;
        readonly name: "KeyNotRevoked";
        readonly msg: "the certificate's Verifier key is not revoked";
    }, {
        readonly code: 6048;
        readonly name: "Overflow";
        readonly msg: "arithmetic overflow";
    }, {
        readonly code: 6049;
        readonly name: "ZkDisabled";
        readonly msg: "certify_zk is turned off";
    }, {
        readonly code: 6050;
        readonly name: "ZkSubjectKind";
        readonly msg: "certify_zk takes a wallet or badge subject (its key signs)";
    }, {
        readonly code: 6051;
        readonly name: "ZkLockMissing";
        readonly msg: "pass one writable note lock [\\znote\\, tag] per tag, in order";
    }, {
        readonly code: 6052;
        readonly name: "ZkStateRootUnknown";
        readonly msg: "the state root is not in the Rings tree's root history";
    }, {
        readonly code: 6053;
        readonly name: "ZkNullRootNotNewest";
        readonly msg: "the nullifier root is not the Rings tree's newest nullifier root (prove again against it)";
    }, {
        readonly code: 6054;
        readonly name: "ZkRegistryRootUnknown";
        readonly msg: "the owner registry root is not in its recent history";
    }, {
        readonly code: 6055;
        readonly name: "ZkRegistryFull";
        readonly msg: "the owner registry is full";
    }, {
        readonly code: 6056;
        readonly name: "ZkBadEscrowKey";
        readonly msg: "the revocation key is not a Baby Jubjub point";
    }, {
        readonly code: 6057;
        readonly name: "ZkNoVerifyingKey";
        readonly msg: "this build has no verifying key";
    }, {
        readonly code: 6058;
        readonly name: "ZkSettling";
        readonly msg: "the zk certificate is still settling (its nullifiers may be queued spends)";
    }, {
        readonly code: 6059;
        readonly name: "ZkInputNotInField";
        readonly msg: "a public input is not a canonical field element";
    }, {
        readonly code: 6060;
        readonly name: "ZkProofInvalid";
        readonly msg: "the proof does not verify for this certificate";
    }, {
        readonly code: 6061;
        readonly name: "ZkNoteLocked";
        readonly msg: "a note is already behind another certificate";
    }, {
        readonly code: 6062;
        readonly name: "ZkNoteStillLive";
        readonly msg: "the lock's certificate is still live with this note";
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
                readonly name: "held_delay";
                readonly docs: readonly ["A lowered rotation delay takes effect only after the old one has run: until held_until, set_verifier waits at least held_delay."];
                readonly type: "u64";
            }, {
                readonly name: "held_until";
                readonly type: "u64";
            }, {
                readonly name: "revoked_keys";
                readonly docs: readonly ["Verifier keys revoked by the admin (leaked or retired): they sign nothing more, and every certificate they signed is dead", "for require_certificate and Rooms at once, and can be voided by anyone."];
                readonly type: {
                    readonly array: readonly ["pubkey", 8];
                };
            }, {
                readonly name: "revoked_at";
                readonly docs: readonly ["The slot each was revoked at. A full list reuses an entry once VALIDITY_MAX slots have passed since its revocation: by then", "every certificate that key signed has expired."];
                readonly type: {
                    readonly array: readonly ["u64", 8];
                };
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
        readonly name: "NoteLock";
        readonly docs: readonly ["One note behind one live certificate, with what the keeper needs to open the escrow."];
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "certificate";
                readonly type: "pubkey";
            }, {
                readonly name: "tag";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "payer";
                readonly docs: readonly ["Paid the lock's rent (gets it back at release)."];
                readonly type: "pubkey";
            }, {
                readonly name: "eph";
                readonly type: {
                    readonly array: readonly [{
                        readonly array: readonly ["u8", 32];
                    }, 2];
                };
            }, {
                readonly name: "ct";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "escrow_epoch";
                readonly type: "u32";
            }, {
                readonly name: "locked_slot";
                readonly type: "u64";
            }, {
                readonly name: "bump";
                readonly type: "u8";
            }];
        };
    }, {
        readonly name: "NoteReleased";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "tag";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "certificate";
                readonly type: "pubkey";
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
        readonly name: "PathBuffer";
        readonly docs: readonly ["A membership path staged in parts (`stage_path`) for `revoke_spent_staged`, so the full 40-level path never has to fit one", "transaction. PDA [\"path\", revoker, certificate]: only that revoker writes it, only for that certificate and that nullifier;", "`revoke_spent_staged` hashes it to a nullifier root the tree holds at that moment and closes it (rent back to the revoker)."];
        readonly serialization: "bytemuck";
        readonly repr: {
            readonly kind: "c";
        };
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "revoker";
                readonly type: "pubkey";
            }, {
                readonly name: "certificate";
                readonly type: "pubkey";
            }, {
                readonly name: "nullifier";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "next_value";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "leaf_index";
                readonly type: "u64";
            }, {
                readonly name: "path";
                readonly type: {
                    readonly array: readonly [{
                        readonly array: readonly ["u8", 32];
                    }, 40];
                };
            }, {
                readonly name: "levels";
                readonly docs: readonly ["Siblings written so far from the leaf up (levels above are empty subtrees when consumed)."];
                readonly type: "u8";
            }, {
                readonly name: "bump";
                readonly type: "u8";
            }, {
                readonly name: "_pad";
                readonly type: {
                    readonly array: readonly ["u8", 6];
                };
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
        readonly docs: readonly ["path: 0 nullifier PDA, 1 nullifier tree membership, 3 by the holder (controller signs the transaction), 4 by the controller's", "signed revoke, 5 voided (its Verifier key revoked)."];
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
                readonly name: "voided";
                readonly docs: readonly ["Certificates voided because their Verifier key was revoked."];
                readonly type: "u64";
            }, {
                readonly name: "paths";
                readonly docs: readonly ["Staged revoke buffers open now (close_config waits for 0, so no buffer's rent is ever stranded)."];
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
        readonly name: "VerifierKeyRevoked";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "key";
                readonly type: "pubkey";
            }, {
                readonly name: "slot";
                readonly type: "u64";
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
    }, {
        readonly name: "ZkArgs";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "subject_kind";
                readonly docs: readonly ["0 wallet or 2 badge: the controller is that key and signs (an X handle needs the linker's proof: not in this version)."];
                readonly type: "u8";
            }, {
                readonly name: "asset";
                readonly type: "u8";
            }, {
                readonly name: "tier";
                readonly type: "u8";
            }, {
                readonly name: "nonce";
                readonly type: {
                    readonly array: readonly ["u8", 16];
                };
            }, {
                readonly name: "proof";
                readonly docs: readonly ["-A ‖ B ‖ C, big-endian (js/zk.js proofBytes)."];
                readonly type: {
                    readonly array: readonly ["u8", 256];
                };
            }, {
                readonly name: "state_root";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "null_root";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "registry_root";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "eph";
                readonly type: {
                    readonly array: readonly [{
                        readonly array: readonly ["u8", 32];
                    }, 2];
                };
            }, {
                readonly name: "tags";
                readonly docs: readonly ["One per used note, strictly ascending (distinct notes), 1..=4."];
                readonly type: {
                    readonly vec: {
                        readonly array: readonly ["u8", 32];
                    };
                };
            }, {
                readonly name: "cts";
                readonly type: {
                    readonly vec: {
                        readonly array: readonly ["u8", 32];
                    };
                };
            }];
        };
    }, {
        readonly name: "ZkCertified";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "certificate";
                readonly type: "pubkey";
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
                readonly name: "settles_slot";
                readonly type: "u64";
            }, {
                readonly name: "tags";
                readonly type: {
                    readonly vec: {
                        readonly array: readonly ["u8", 32];
                    };
                };
            }, {
                readonly name: "eph";
                readonly type: {
                    readonly array: readonly [{
                        readonly array: readonly ["u8", 32];
                    }, 2];
                };
            }, {
                readonly name: "cts";
                readonly type: {
                    readonly vec: {
                        readonly array: readonly ["u8", 32];
                    };
                };
            }, {
                readonly name: "escrow_epoch";
                readonly type: "u32";
            }, {
                readonly name: "state_root";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "null_root";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }];
        };
    }, {
        readonly name: "ZkConfig";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "enabled";
                readonly docs: readonly ["certify_zk refuses while false. Turning it on, or changing the key, waits Config.params.rotation_delay (ZK-09);", "turning it off is immediate."];
                readonly type: "bool";
            }, {
                readonly name: "escrow";
                readonly docs: readonly ["The revocation key K = k·B8 on Baby Jubjub (x, y, 32-byte big-endian): the keeper holds k. On the curve (checked)."];
                readonly type: {
                    readonly array: readonly [{
                        readonly array: readonly ["u8", 32];
                    }, 2];
                };
            }, {
                readonly name: "escrow_epoch";
                readonly docs: readonly ["Counts key changes; each note lock records the epoch it was encrypted under, so the keeper knows which k opens it."];
                readonly type: "u32";
            }, {
                readonly name: "next_enabled";
                readonly docs: readonly ["A change waiting for next_slot (0: none). Takes over by itself at that slot (as the verifier key does)."];
                readonly type: "bool";
            }, {
                readonly name: "next_escrow";
                readonly type: {
                    readonly array: readonly [{
                        readonly array: readonly ["u8", 32];
                    }, 2];
                };
            }, {
                readonly name: "next_slot";
                readonly type: "u64";
            }, {
                readonly name: "vk_hash";
                readonly docs: readonly ["sha256 of the verifying key compiled into this build (vk::VK_HASH), to match against the ceremony transcript."];
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "certified";
                readonly type: "u64";
            }, {
                readonly name: "bump";
                readonly type: "u8";
            }];
        };
    }, {
        readonly name: "ZkConfigSet";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "enabled";
                readonly type: "bool";
            }, {
                readonly name: "escrow";
                readonly type: {
                    readonly array: readonly [{
                        readonly array: readonly ["u8", 32];
                    }, 2];
                };
            }, {
                readonly name: "takes_over_slot";
                readonly type: "u64";
            }, {
                readonly name: "vk_hash";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }];
        };
    }, {
        readonly name: "ZkOwnerRegistered";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "owner";
                readonly type: "pubkey";
            }, {
                readonly name: "index";
                readonly type: "u64";
            }, {
                readonly name: "leaf";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "root";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }];
        };
    }, {
        readonly name: "ZkRegistry";
        readonly docs: readonly ["The POF owner registry (ZK-04): an append-only Poseidon Merkle tree (height 20) of Poseidon(ownerId(owner), commitment), each", "appended by register_zk_owner under the ring owner's own signature, with its last 12 roots (Borsh decoding keeps it under the 4 KB frame)."];
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "next_index";
                readonly type: "u64";
            }, {
                readonly name: "filled";
                readonly type: {
                    readonly array: readonly [{
                        readonly array: readonly ["u8", 32];
                    }, 20];
                };
            }, {
                readonly name: "roots";
                readonly type: {
                    readonly array: readonly [{
                        readonly array: readonly ["u8", 32];
                    }, 12];
                };
            }, {
                readonly name: "cursor";
                readonly type: "u8";
            }, {
                readonly name: "bump";
                readonly type: "u8";
            }];
        };
    }];
};
