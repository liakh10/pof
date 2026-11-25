/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/pof.json`.
 */
export type Pof = {
  "address": "pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT",
  "metadata": {
    "name": "pof",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Proof of Funds: live certificates that a subject holds at least a tier of SOL or USDC in a Helius Privacy Ring, signed by the Verifier, revoked on chain the moment a disclosed note is spent"
  },
  "instructions": [
    {
      "name": "anchorLog",
      "docs": [
        "Anyone submits the transparency log's signed tree head (CONTRACT §7; Ed25519 instruction right before, by the active",
        "Verifier key): \"POF-STH1\" ‖ program id ‖ size ‖ root. The anchored log only grows."
      ],
      "discriminator": [
        169,
        33,
        65,
        3,
        86,
        224,
        46,
        177
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "size",
          "type": "u64"
        },
        {
          "name": "head",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "applyVerifier",
      "docs": [
        "Anyone, once the proposed key's slot has come: it becomes the recorded key."
      ],
      "discriminator": [
        233,
        0,
        246,
        93,
        255,
        44,
        198,
        174
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "certify",
      "docs": [
        "Certify a subject: the Verifier's attestation (the Ed25519 instruction right before this one) is checked against the bytes",
        "rebuilt here. A new certificate, or one remade over a revoked or expired one (whose rent goes back to its old payer)."
      ],
      "discriminator": [
        242,
        131,
        34,
        239,
        225,
        117,
        92,
        27
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "certificate",
          "writable": true
        },
        {
          "name": "priorPayer",
          "writable": true,
          "optional": true
        },
        {
          "name": "holderToken"
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "att",
          "type": {
            "defined": {
              "name": "attestation"
            }
          }
        },
        {
          "name": "logIndex",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closeBegin",
      "docs": [
        "One way: no certify or renew; anyone may `expire` any certificate (rent back to its payer). See wind-down.mjs."
      ],
      "discriminator": [
        161,
        49,
        64,
        17,
        104,
        205,
        191,
        182
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "closeConfig",
      "docs": [
        "The last step of the wind-down: no certificate account left. The treasury (fees and rent) and the config close to the admin."
      ],
      "discriminator": [
        145,
        9,
        72,
        157,
        95,
        125,
        61,
        85
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "closePath",
      "docs": [
        "The revoker drops its staged buffer (rent back); during the wind-down anyone may."
      ],
      "discriminator": [
        228,
        246,
        66,
        195,
        202,
        252,
        223,
        199
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "buffer",
          "writable": true
        },
        {
          "name": "revoker",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "expire",
      "docs": [
        "Anyone, past the expiry slot (or at any moment during the wind-down): the account closes, its rent back to its payer."
      ],
      "discriminator": [
        243,
        83,
        205,
        58,
        57,
        201,
        247,
        146
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "certificate",
          "writable": true
        },
        {
          "name": "payer",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "initConfig",
      "docs": [
        "Only the program's upgrade authority, who becomes the admin and pays the config and treasury rent. The Verifier and the",
        "relayer keys are set at once; SOL and USDC tiers as CONTRACT §2; the launch parameters."
      ],
      "discriminator": [
        23,
        235,
        115,
        232,
        168,
        96,
        1,
        231
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "programData",
          "address": "ETKHHhmbAD2AJbeDd961pDaet2Gnnv1DFg8x49ibbiHH"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "verifier",
          "type": "pubkey"
        },
        {
          "name": "relayer",
          "type": "pubkey"
        },
        {
          "name": "dev",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "openPath",
      "docs": [
        "Open the revoker's buffer for this certificate (the revoker pays its rent) with the nullifier, its next value, its leaf",
        "index and the first siblings (from the leaf up); `stage_path` adds the rest. Two transactions carry the full 40 levels."
      ],
      "discriminator": [
        239,
        145,
        149,
        165,
        39,
        35,
        63,
        161
      ],
      "accounts": [
        {
          "name": "revoker",
          "writable": true,
          "signer": true
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "certificate"
        },
        {
          "name": "buffer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "revoker"
              },
              {
                "kind": "account",
                "path": "certificate"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "nullifier",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "nextValue",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "leafIndex",
          "type": "u64"
        },
        {
          "name": "siblings",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "renew",
      "docs": [
        "A fresh attestation on the same notes (same salted hashes), subject, asset and controller: new root, slots and tier."
      ],
      "discriminator": [
        43,
        239,
        15,
        46,
        27,
        7,
        163,
        73
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "certificate",
          "writable": true
        },
        {
          "name": "holderToken"
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "att",
          "type": {
            "defined": {
              "name": "attestation"
            }
          }
        }
      ]
    },
    {
      "name": "requireCertificate",
      "docs": [
        "The CPI gate for other programs: fails unless the certificate at [\"cert\", subject_hash, [asset]] is live, unexpired and at",
        "least `min_tier`; returns its kind, tier, expiry and controller."
      ],
      "discriminator": [
        133,
        238,
        16,
        4,
        145,
        190,
        131,
        187
      ],
      "accounts": [
        {
          "name": "certificate"
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "subjectHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "asset",
          "type": "u8"
        },
        {
          "name": "minTier",
          "type": "u8"
        }
      ],
      "returns": {
        "defined": {
          "name": "certView"
        }
      }
    },
    {
      "name": "revokeByHolder",
      "docs": [
        "The certificate's controller withdraws it, at any moment."
      ],
      "discriminator": [
        166,
        202,
        246,
        103,
        191,
        5,
        172,
        192
      ],
      "accounts": [
        {
          "name": "controller",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "certificate",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "revokeSigned",
      "docs": [
        "Anyone submits the controller's signed revoke (Ed25519 instruction right before, signed by the certificate's controller",
        "key over the 156 POF-REVOKE1 bytes, usable until `valid_until`). The holder's wallet never signs or pays: for an X-handle",
        "or badge certificate the relayer submits it."
      ],
      "discriminator": [
        224,
        136,
        97,
        88,
        214,
        203,
        185,
        196
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "certificate",
          "writable": true
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "validUntil",
          "type": "u64"
        }
      ]
    },
    {
      "name": "revokeSpent",
      "docs": [
        "Anyone: a disclosed note's salt and nullifier, and a proof that the nullifier is spent on the Rings program: without",
        "`membership`, its nullifier PDA [\"nullifier\", tree, nullifier] exists now (pass it as nullifier_account); with it, the",
        "nullifier is a leaf of the tree's folded nullifier tree under one of the 100 roots the tree holds (for a PDA the pool has",
        "closed). The salt and nullifier become public."
      ],
      "discriminator": [
        143,
        133,
        193,
        161,
        71,
        33,
        14,
        131
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "certificate",
          "writable": true
        },
        {
          "name": "tree"
        },
        {
          "name": "nullifierAccount",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u8"
        },
        {
          "name": "salt",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "nullifier",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "membership",
          "type": {
            "option": {
              "defined": {
                "name": "membership"
              }
            }
          }
        }
      ]
    },
    {
      "name": "revokeSpentStaged",
      "docs": [
        "The staged proof: the revoker's buffer for this certificate holds a membership path of its nullifier; the program hashes",
        "all 40 levels to the root and checks it is one of the 100 nullifier roots the tree account holds NOW, checks the salted",
        "hash of the disclosed note, revokes, and closes the buffer (rent back to the revoker)."
      ],
      "discriminator": [
        255,
        103,
        254,
        43,
        147,
        107,
        237,
        146
      ],
      "accounts": [
        {
          "name": "revoker",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "certificate",
          "writable": true
        },
        {
          "name": "tree"
        },
        {
          "name": "buffer",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  116,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "revoker"
              },
              {
                "kind": "account",
                "path": "certificate"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u8"
        },
        {
          "name": "salt",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "revokeVerifierKey",
      "docs": [
        "The admin revokes a Verifier key at once (a leak, or a key retired after rotation): it signs nothing more, and every",
        "certificate it signed fails require_certificate and Rooms from now on; `void_by_key` marks each of them. At most 4 keys."
      ],
      "discriminator": [
        38,
        162,
        12,
        240,
        52,
        250,
        34,
        161
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "key",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setAsset",
      "docs": [
        "A new asset's tier table in a free slot; on an asset already set only `enabled` may change (the tiers of certificates",
        "already issued never change meaning)."
      ],
      "discriminator": [
        243,
        216,
        48,
        30,
        63,
        58,
        91,
        239
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "asset",
          "type": "u8"
        },
        {
          "name": "tiers",
          "type": {
            "defined": {
              "name": "assetTiers"
            }
          }
        }
      ]
    },
    {
      "name": "setFee",
      "docs": [
        "The fee per certify and per renew alone (at most FEE_CAP)."
      ],
      "discriminator": [
        18,
        154,
        24,
        18,
        237,
        214,
        19,
        80
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "feeLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setParams",
      "docs": [
        "Every parameter at once, within the bounds (the fee at most FEE_CAP)."
      ],
      "discriminator": [
        27,
        234,
        178,
        52,
        147,
        2,
        187,
        141
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "params"
            }
          }
        }
      ]
    },
    {
      "name": "setPaused",
      "docs": [
        "No certify or renew while paused (revocations and expiry never pause). Immediate, for a leaked Verifier key."
      ],
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setRoles",
      "docs": [
        "The dev and relayer keys (None leaves them), and the root mint once (pass its mint account)."
      ],
      "discriminator": [
        119,
        86,
        129,
        161,
        55,
        23,
        250,
        12
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "rootMint",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "dev",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "relayer",
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "setVerifier",
      "docs": [
        "Propose the next Verifier key: it takes over rotation_delay slots from now (by itself; `apply_verifier` records it). The",
        "default key cancels a pending proposal at once."
      ],
      "discriminator": [
        186,
        247,
        191,
        131,
        148,
        158,
        213,
        63
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "next",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "stagePath",
      "docs": [
        "Write `siblings` at levels offset.. of the revoker's open buffer (no gap above what is written; a level may be rewritten)."
      ],
      "discriminator": [
        68,
        97,
        146,
        218,
        201,
        81,
        33,
        62
      ],
      "accounts": [
        {
          "name": "revoker",
          "signer": true,
          "relations": [
            "buffer"
          ]
        },
        {
          "name": "buffer",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "offset",
          "type": "u8"
        },
        {
          "name": "siblings",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "voidByKey",
      "docs": [
        "Anyone: a live certificate signed by a revoked Verifier key becomes voided (status 4)."
      ],
      "discriminator": [
        74,
        62,
        124,
        112,
        58,
        63,
        147,
        156
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "certificate",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "withdrawFees",
      "docs": [
        "The treasury's fees to the dev wallet (0: all of them); its rent stays."
      ],
      "discriminator": [
        198,
        212,
        171,
        109,
        144,
        215,
        174,
        89
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "dev",
          "writable": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "lamports",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "certificate",
      "discriminator": [
        202,
        229,
        222,
        220,
        116,
        20,
        74,
        67
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "pathBuffer",
      "discriminator": [
        15,
        240,
        22,
        62,
        212,
        197,
        226,
        181
      ]
    },
    {
      "name": "treasury",
      "discriminator": [
        238,
        239,
        123,
        238,
        89,
        1,
        168,
        253
      ]
    }
  ],
  "events": [
    {
      "name": "assetSet",
      "discriminator": [
        175,
        84,
        64,
        85,
        102,
        200,
        50,
        40
      ]
    },
    {
      "name": "certified",
      "discriminator": [
        47,
        44,
        174,
        70,
        153,
        102,
        41,
        72
      ]
    },
    {
      "name": "closingBegun",
      "discriminator": [
        3,
        21,
        199,
        214,
        209,
        212,
        107,
        91
      ]
    },
    {
      "name": "configSet",
      "discriminator": [
        15,
        104,
        59,
        16,
        236,
        241,
        8,
        6
      ]
    },
    {
      "name": "expired",
      "discriminator": [
        197,
        227,
        104,
        103,
        133,
        50,
        207,
        161
      ]
    },
    {
      "name": "feesWithdrawn",
      "discriminator": [
        234,
        15,
        0,
        119,
        148,
        241,
        40,
        21
      ]
    },
    {
      "name": "logAnchored",
      "discriminator": [
        63,
        53,
        65,
        90,
        183,
        145,
        180,
        157
      ]
    },
    {
      "name": "pausedSet",
      "discriminator": [
        171,
        125,
        127,
        156,
        233,
        81,
        68,
        66
      ]
    },
    {
      "name": "renewed",
      "discriminator": [
        139,
        252,
        217,
        35,
        73,
        42,
        7,
        87
      ]
    },
    {
      "name": "revoked",
      "discriminator": [
        113,
        216,
        148,
        99,
        124,
        184,
        0,
        65
      ]
    },
    {
      "name": "verifierKeyRevoked",
      "discriminator": [
        227,
        104,
        7,
        71,
        203,
        98,
        107,
        98
      ]
    },
    {
      "name": "verifierSet",
      "discriminator": [
        127,
        200,
        69,
        52,
        190,
        16,
        199,
        53
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "notUpgradeAuthority",
      "msg": "only the program's upgrade authority may run init_config"
    },
    {
      "code": 6001,
      "name": "notAdmin",
      "msg": "only the admin may do this"
    },
    {
      "code": 6002,
      "name": "badParams",
      "msg": "a setting is out of its bounds"
    },
    {
      "code": 6003,
      "name": "feeAboveCap",
      "msg": "the fee is above the cap"
    },
    {
      "code": 6004,
      "name": "rootSet",
      "msg": "the root mint is already set"
    },
    {
      "code": 6005,
      "name": "badMint",
      "msg": "not a token mint"
    },
    {
      "code": 6006,
      "name": "badHolderAccount",
      "msg": "the holder token account is not the payer's canonical root account"
    },
    {
      "code": 6007,
      "name": "paused",
      "msg": "certify and renew are paused"
    },
    {
      "code": 6008,
      "name": "closing",
      "msg": "the program is winding down"
    },
    {
      "code": 6009,
      "name": "notClosing",
      "msg": "the program is not winding down"
    },
    {
      "code": 6010,
      "name": "noVerifier",
      "msg": "no verifier key is set"
    },
    {
      "code": 6011,
      "name": "noSignature",
      "msg": "no ed25519 instruction right before this one"
    },
    {
      "code": 6012,
      "name": "badSignatureLayout",
      "msg": "the ed25519 instruction is not one signature over its own data"
    },
    {
      "code": 6013,
      "name": "wrongVerifier",
      "msg": "the attestation is not signed by the active verifier key"
    },
    {
      "code": 6014,
      "name": "attestationMismatch",
      "msg": "the signed bytes differ from the attestation rebuilt on chain"
    },
    {
      "code": 6015,
      "name": "badSubjectKind",
      "msg": "unknown subject kind"
    },
    {
      "code": 6016,
      "name": "subjectMismatch",
      "msg": "the subject hash does not belong to the controller key"
    },
    {
      "code": 6017,
      "name": "badAsset",
      "msg": "the asset is not enabled"
    },
    {
      "code": 6018,
      "name": "badTier",
      "msg": "no such tier for this asset"
    },
    {
      "code": 6019,
      "name": "badNoteCount",
      "msg": "note count must be 1 to 8 and match the nullifier hashes"
    },
    {
      "code": 6020,
      "name": "nullHashesUnsorted",
      "msg": "the salted nullifier hashes must be sorted ascending without repeats"
    },
    {
      "code": 6021,
      "name": "issuedInFuture",
      "msg": "the attestation was issued in the future"
    },
    {
      "code": 6022,
      "name": "attestationStale",
      "msg": "the attestation is too old to submit"
    },
    {
      "code": 6023,
      "name": "rootStale",
      "msg": "the tree root was read too long before the attestation"
    },
    {
      "code": 6024,
      "name": "badExpiry",
      "msg": "the expiry is not after the issue slot, or longer than the validity"
    },
    {
      "code": 6025,
      "name": "expired",
      "msg": "the attestation has already expired"
    },
    {
      "code": 6026,
      "name": "payerMismatch",
      "msg": "the payer in the attestation is not the signer paying"
    },
    {
      "code": 6027,
      "name": "alreadyLive",
      "msg": "a live certificate already exists for this subject and asset: renew it"
    },
    {
      "code": 6028,
      "name": "priorPayerMissing",
      "msg": "the previous payer of this certificate must be passed to take its rent back"
    },
    {
      "code": 6029,
      "name": "replayed",
      "msg": "this attestation is not newer than the one the certificate holds"
    },
    {
      "code": 6030,
      "name": "notLive",
      "msg": "the certificate is not live"
    },
    {
      "code": 6031,
      "name": "certificateExpired",
      "msg": "the certificate has expired"
    },
    {
      "code": 6032,
      "name": "tierTooLow",
      "msg": "the certificate is below the required tier"
    },
    {
      "code": 6033,
      "name": "assetMismatch",
      "msg": "the certificate is for another asset"
    },
    {
      "code": 6034,
      "name": "badCertificate",
      "msg": "not this program's certificate at the subject's address"
    },
    {
      "code": 6035,
      "name": "renewMismatch",
      "msg": "renew must carry the same notes, subject, asset and controller"
    },
    {
      "code": 6036,
      "name": "badIndex",
      "msg": "no disclosed note at that index"
    },
    {
      "code": 6037,
      "name": "nullifierMismatch",
      "msg": "salt and nullifier do not hash to the disclosed note"
    },
    {
      "code": 6038,
      "name": "notSpent",
      "msg": "the nullifier is not shown as spent by this proof"
    },
    {
      "code": 6039,
      "name": "badRingsAccounts",
      "msg": "the Rings accounts passed are not the Rings program's"
    },
    {
      "code": 6040,
      "name": "notController",
      "msg": "only the certificate's controller may do this"
    },
    {
      "code": 6041,
      "name": "notExpired",
      "msg": "the certificate has not expired yet"
    },
    {
      "code": 6042,
      "name": "notPayer",
      "msg": "the rent goes back to the certificate's payer"
    },
    {
      "code": 6043,
      "name": "logNotGrowing",
      "msg": "the log can only grow"
    },
    {
      "code": 6044,
      "name": "treasuryShort",
      "msg": "the treasury cannot pay that much"
    },
    {
      "code": 6045,
      "name": "noRotationDue",
      "msg": "no verifier key is waiting, or its delay has not passed"
    },
    {
      "code": 6046,
      "name": "keyRevoked",
      "msg": "the Verifier key that signed this has been revoked"
    },
    {
      "code": 6047,
      "name": "keyNotRevoked",
      "msg": "the certificate's Verifier key is not revoked"
    },
    {
      "code": 6048,
      "name": "overflow",
      "msg": "arithmetic overflow"
    },
    {
      "code": 6049,
      "name": "zkDisabled",
      "msg": "certify_zk is turned off"
    },
    {
      "code": 6050,
      "name": "zkSubjectKind",
      "msg": "certify_zk takes a wallet or badge subject (its key signs)"
    },
    {
      "code": 6051,
      "name": "zkLockMissing",
      "msg": "pass one writable note lock [\\znote\\, tag] per tag, in order"
    },
    {
      "code": 6052,
      "name": "zkStateRootUnknown",
      "msg": "the state root is not in the Rings tree's root history"
    },
    {
      "code": 6053,
      "name": "zkNullRootNotNewest",
      "msg": "the nullifier root is not the Rings tree's newest nullifier root (prove again against it)"
    },
    {
      "code": 6054,
      "name": "zkRegistryRootUnknown",
      "msg": "the owner registry root is not in its recent history"
    },
    {
      "code": 6055,
      "name": "zkRegistryFull",
      "msg": "the owner registry is full"
    },
    {
      "code": 6056,
      "name": "zkBadEscrowKey",
      "msg": "the revocation key is not a Baby Jubjub point"
    },
    {
      "code": 6057,
      "name": "zkNoVerifyingKey",
      "msg": "this build has no verifying key"
    },
    {
      "code": 6058,
      "name": "zkSettling",
      "msg": "the zk certificate is still settling (its nullifiers may be queued spends)"
    },
    {
      "code": 6059,
      "name": "zkInputNotInField",
      "msg": "a public input is not a canonical field element"
    },
    {
      "code": 6060,
      "name": "zkProofInvalid",
      "msg": "the proof does not verify for this certificate"
    },
    {
      "code": 6061,
      "name": "zkNoteLocked",
      "msg": "a note is already behind another certificate"
    },
    {
      "code": 6062,
      "name": "zkNoteStillLive",
      "msg": "the lock's certificate is still live with this note"
    }
  ],
  "types": [
    {
      "name": "assetSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "u8"
          },
          {
            "name": "tiers",
            "type": {
              "defined": {
                "name": "assetTiers"
              }
            }
          }
        ]
      }
    },
    {
      "name": "assetTiers",
      "docs": [
        "One asset's tier table (CONTRACT §2): tier i (1-based) needs at least mins[i-1] base units; zeros end the table."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "mint",
            "docs": [
              "The SPL mint (USDC), or the default key for native SOL."
            ],
            "type": "pubkey"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "mins",
            "type": {
              "array": [
                "u64",
                5
              ]
            }
          }
        ]
      }
    },
    {
      "name": "attestation",
      "docs": [
        "The attestation as `certify` and `renew` take it; with the payer (signer) and the program id it rebuilds CONTRACT §3."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subjectKind",
            "type": "u8"
          },
          {
            "name": "subjectHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "asset",
            "type": "u8"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "treeRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rootSlot",
            "type": "u64"
          },
          {
            "name": "nullHashes",
            "docs": [
              "The salted nullifier hashes, sorted ascending, 1 to 8 (their count is the note_count byte)."
            ],
            "type": {
              "vec": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "issuedSlot",
            "type": "u64"
          },
          {
            "name": "expirySlot",
            "type": "u64"
          },
          {
            "name": "controller",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          }
        ]
      }
    },
    {
      "name": "certView",
      "docs": [
        "What `require_certificate` returns (also its return data)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subjectKind",
            "type": "u8"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "expirySlot",
            "type": "u64"
          },
          {
            "name": "controller",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "certificate",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subjectKind",
            "type": "u8"
          },
          {
            "name": "subjectHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "asset",
            "type": "u8"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "status",
            "docs": [
              "STATUS_LIVE, STATUS_REVOKED_SPENT, STATUS_REVOKED_HOLDER (STATUS_EXPIRED is what readers show past expiry_slot; the account",
              "itself closes at `expire`)."
            ],
            "type": "u8"
          },
          {
            "name": "certifiedSlot",
            "docs": [
              "The slot this certificate was made (or remade after a revocation), and of its latest attestation."
            ],
            "type": "u64"
          },
          {
            "name": "issuedSlot",
            "type": "u64"
          },
          {
            "name": "expirySlot",
            "type": "u64"
          },
          {
            "name": "revokedSlot",
            "type": "u64"
          },
          {
            "name": "treeRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rootSlot",
            "type": "u64"
          },
          {
            "name": "noteCount",
            "type": "u8"
          },
          {
            "name": "nullHashes",
            "docs": [
              "The sorted salted nullifier hashes h (CONTRACT §5), the first note_count used."
            ],
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                8
              ]
            }
          },
          {
            "name": "nullsetHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "payer",
            "docs": [
              "Paid the rent (gets it back at `expire`)."
            ],
            "type": "pubkey"
          },
          {
            "name": "controller",
            "docs": [
              "May revoke it and join rooms with it."
            ],
            "type": "pubkey"
          },
          {
            "name": "verifier",
            "docs": [
              "The Verifier key that signed the latest attestation."
            ],
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "logIndex",
            "docs": [
              "The attestation's index in the transparency log (as the submitter states it; the log proof is the check)."
            ],
            "type": "u64"
          },
          {
            "name": "renewals",
            "type": "u32"
          },
          {
            "name": "revealedIndex",
            "docs": [
              "After revoke_spent: which note (255: none), its salt and nullifier, now public."
            ],
            "type": "u8"
          },
          {
            "name": "revealedSalt",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "revealedNullifier",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "certified",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subjectKind",
            "type": "u8"
          },
          {
            "name": "subjectHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "asset",
            "type": "u8"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "certifiedSlot",
            "type": "u64"
          },
          {
            "name": "expirySlot",
            "type": "u64"
          },
          {
            "name": "noteCount",
            "type": "u8"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "controller",
            "type": "pubkey"
          },
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "logIndex",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "closingBegun",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "dev",
            "docs": [
              "Where `withdraw_fees` sends the treasury's surplus."
            ],
            "type": "pubkey"
          },
          {
            "name": "relayer",
            "docs": [
              "The relayer's key: certificates it pays for owe no on-chain fee (the holder paid it privately)."
            ],
            "type": "pubkey"
          },
          {
            "name": "verifier",
            "docs": [
              "The Verifier's ed25519 key that signs attestations now (default: none, nothing certifies)."
            ],
            "type": "pubkey"
          },
          {
            "name": "nextVerifier",
            "docs": [
              "A proposed key and the slot it takes over at (default key: nothing proposed)."
            ],
            "type": "pubkey"
          },
          {
            "name": "nextVerifierSlot",
            "type": "u64"
          },
          {
            "name": "rootMint",
            "docs": [
              "$ROOT; default until set_roles (nobody counts as a holder until then)."
            ],
            "type": "pubkey"
          },
          {
            "name": "rootTokenProgram",
            "type": "pubkey"
          },
          {
            "name": "params",
            "type": {
              "defined": {
                "name": "params"
              }
            }
          },
          {
            "name": "assets",
            "docs": [
              "The tier tables by asset id (CONTRACT §2): 0 SOL, 1 USDC, 2 and 3 free for new assets."
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "assetTiers"
                  }
                },
                4
              ]
            }
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "closing",
            "type": "bool"
          },
          {
            "name": "launchSlot",
            "type": "u64"
          },
          {
            "name": "heldDelay",
            "docs": [
              "A lowered rotation delay takes effect only after the old one has run: until held_until, set_verifier waits at least held_delay."
            ],
            "type": "u64"
          },
          {
            "name": "heldUntil",
            "type": "u64"
          },
          {
            "name": "revokedKeys",
            "docs": [
              "Verifier keys revoked by the admin (leaked or retired): they sign nothing more, and every certificate they signed is dead",
              "for require_certificate and Rooms at once, and can be voided by anyone."
            ],
            "type": {
              "array": [
                "pubkey",
                8
              ]
            }
          },
          {
            "name": "revokedAt",
            "docs": [
              "The slot each was revoked at. A full list reuses an entry once VALIDITY_MAX slots have passed since its revocation: by then",
              "every certificate that key signed has expired."
            ],
            "type": {
              "array": [
                "u64",
                8
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "treasuryBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "dev",
            "type": "pubkey"
          },
          {
            "name": "relayer",
            "type": "pubkey"
          },
          {
            "name": "rootMint",
            "type": "pubkey"
          },
          {
            "name": "params",
            "type": {
              "defined": {
                "name": "params"
              }
            }
          }
        ]
      }
    },
    {
      "name": "expired",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subjectHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "asset",
            "type": "u8"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "payer",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "feesWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lamports",
            "type": "u64"
          },
          {
            "name": "to",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "logAnchored",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "size",
            "type": "u64"
          },
          {
            "name": "head",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "membership",
      "docs": [
        "A membership path of a nullifier in the tree's folded nullifier tree (pof/RINGS.md §3): its leaf index, the next value of",
        "its indexed leaf, the siblings from the leaf up (at most 40; upper levels left out are empty subtrees)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "leafIndex",
            "type": "u64"
          },
          {
            "name": "nextValue",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "path",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "params",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "feeLamports",
            "docs": [
              "Lamports per certify and per renew, to the treasury (at most FEE_CAP)."
            ],
            "type": "u64"
          },
          {
            "name": "holderMin",
            "docs": [
              "Base units of $ROOT a payer's canonical account must hold to pay no fee (1,000,000 $ROOT at 6 decimals)."
            ],
            "type": "u64"
          },
          {
            "name": "validitySlots",
            "docs": [
              "An attestation's expiry may be at most this many slots after its issue slot."
            ],
            "type": "u64"
          },
          {
            "name": "maxAttestAge",
            "docs": [
              "An attestation must reach the chain within this many slots of its issue slot."
            ],
            "type": "u64"
          },
          {
            "name": "maxRootLag",
            "docs": [
              "The tree root must have been read at most this many slots before the issue slot."
            ],
            "type": "u64"
          },
          {
            "name": "rotationDelay",
            "docs": [
              "Slots between `set_verifier` and the new key taking over."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "pathBuffer",
      "docs": [
        "A membership path staged in parts (`stage_path`) for `revoke_spent_staged`, so the full 40-level path never has to fit one",
        "transaction. PDA [\"path\", revoker, certificate]: only that revoker writes it, only for that certificate and that nullifier;",
        "`revoke_spent_staged` hashes it to a nullifier root the tree holds at that moment and closes it (rent back to the revoker)."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "revoker",
            "type": "pubkey"
          },
          {
            "name": "certificate",
            "type": "pubkey"
          },
          {
            "name": "nullifier",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "nextValue",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "leafIndex",
            "type": "u64"
          },
          {
            "name": "path",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                40
              ]
            }
          },
          {
            "name": "levels",
            "docs": [
              "Siblings written so far from the leaf up (levels above are empty subtrees when consumed)."
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          }
        ]
      }
    },
    {
      "name": "pausedSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "renewed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subjectHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "asset",
            "type": "u8"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "issuedSlot",
            "type": "u64"
          },
          {
            "name": "expirySlot",
            "type": "u64"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "renewals",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "revoked",
      "docs": [
        "path: 0 nullifier PDA, 1 nullifier tree membership, 3 by the holder (controller signs the transaction), 4 by the controller's",
        "signed revoke, 5 voided (its Verifier key revoked)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subjectHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "asset",
            "type": "u8"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "by",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u8"
          },
          {
            "name": "salt",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "nullifier",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "path",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "treasury",
      "docs": [
        "The treasury holds the fees (its lamports above its rent) and the public counters."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "feesIn",
            "type": "u64"
          },
          {
            "name": "feesOut",
            "type": "u64"
          },
          {
            "name": "certified",
            "docs": [
              "certify calls that made or remade a certificate; renews."
            ],
            "type": "u64"
          },
          {
            "name": "renewed",
            "type": "u64"
          },
          {
            "name": "revokedSpent",
            "type": "u64"
          },
          {
            "name": "revokedHolder",
            "type": "u64"
          },
          {
            "name": "expired",
            "type": "u64"
          },
          {
            "name": "live",
            "docs": [
              "Live certificates (status live, closed or not past their expiry yet) and the sum of their tier minimums by asset."
            ],
            "type": "u64"
          },
          {
            "name": "liveMin",
            "type": {
              "array": [
                "u64",
                4
              ]
            }
          },
          {
            "name": "open",
            "docs": [
              "Certificate accounts that exist now (rent held for payers)."
            ],
            "type": "u64"
          },
          {
            "name": "relayed",
            "docs": [
              "certify/renew paid by the relayer; by a $ROOT holder (no fee in both)."
            ],
            "type": "u64"
          },
          {
            "name": "exempt",
            "type": "u64"
          },
          {
            "name": "voided",
            "docs": [
              "Certificates voided because their Verifier key was revoked."
            ],
            "type": "u64"
          },
          {
            "name": "paths",
            "docs": [
              "Staged revoke buffers open now (close_config waits for 0, so no buffer's rent is ever stranded)."
            ],
            "type": "u64"
          },
          {
            "name": "logSize",
            "docs": [
              "The transparency log's latest signed head anchored on chain: its size, its root hash, the slot."
            ],
            "type": "u64"
          },
          {
            "name": "logHead",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "logSlot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "verifierKeyRevoked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "key",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "verifierSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "verifier",
            "type": "pubkey"
          },
          {
            "name": "nextVerifier",
            "type": "pubkey"
          },
          {
            "name": "nextVerifierSlot",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
