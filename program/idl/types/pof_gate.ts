/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/pof_gate.json`.
 */
export type PofGate = {
  "address": "gatSToJMD8ZPLa85fKj6seYHUtYx4ah3ptZvLkisLPU",
  "metadata": {
    "name": "pofGate",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Proof of Funds Rooms: on-chain rooms that admit a subject only with a live POF certificate (through the require_certificate CPI) and let anyone evict a member whose certificate is revoked or expired"
  },
  "instructions": [
    {
      "name": "closeRoom",
      "docs": [
        "The creator closes an empty room (rent back)."
      ],
      "discriminator": [
        152,
        197,
        88,
        192,
        98,
        197,
        51,
        211
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true,
          "relations": [
            "room"
          ]
        },
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.creator",
                "account": "room"
              },
              {
                "kind": "account",
                "path": "room.id",
                "account": "room"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "createRoom",
      "docs": [
        "A new room: certificates of `asset` at `min_tier` or above may join."
      ],
      "discriminator": [
        130,
        166,
        32,
        2,
        247,
        120,
        178,
        53
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "pofConfig"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "asset",
          "type": "u8"
        },
        {
          "name": "minTier",
          "type": "u8"
        },
        {
          "name": "name",
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
      "name": "evict",
      "docs": [
        "Anyone: the member's certificate is no longer good for this room (revoked, expired, closed, below the tier, or remade",
        "with another controller). The member closes, its rent back to its payer."
      ],
      "discriminator": [
        56,
        13,
        174,
        235,
        133,
        159,
        37,
        162
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.creator",
                "account": "room"
              },
              {
                "kind": "account",
                "path": "room.id",
                "account": "room"
              }
            ]
          },
          "relations": [
            "member"
          ]
        },
        {
          "name": "member",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "room"
              },
              {
                "kind": "account",
                "path": "member.subjectHash",
                "account": "member"
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "certificate"
        }
      ],
      "args": []
    },
    {
      "name": "join",
      "docs": [
        "The controller of a live certificate joins: POF's `require_certificate` CPI decides."
      ],
      "discriminator": [
        206,
        55,
        2,
        106,
        113,
        220,
        17,
        163
      ],
      "accounts": [
        {
          "name": "controller",
          "signer": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.creator",
                "account": "room"
              },
              {
                "kind": "account",
                "path": "room.id",
                "account": "room"
              }
            ]
          }
        },
        {
          "name": "member",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "room"
              },
              {
                "kind": "arg",
                "path": "subjectHash"
              }
            ]
          }
        },
        {
          "name": "certificate"
        },
        {
          "name": "pofProgram",
          "address": "pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
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
        }
      ]
    },
    {
      "name": "leave",
      "docs": [
        "The member's controller leaves."
      ],
      "discriminator": [
        59,
        234,
        148,
        108,
        107,
        149,
        173,
        112
      ],
      "accounts": [
        {
          "name": "controller",
          "signer": true,
          "relations": [
            "member"
          ]
        },
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.creator",
                "account": "room"
              },
              {
                "kind": "account",
                "path": "room.id",
                "account": "room"
              }
            ]
          },
          "relations": [
            "member"
          ]
        },
        {
          "name": "member",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "room"
              },
              {
                "kind": "account",
                "path": "member.subjectHash",
                "account": "member"
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "releaseRoom",
      "docs": [
        "Anyone, while POF winds down (config closing or closed): an empty room closes, its rent back to its creator."
      ],
      "discriminator": [
        78,
        88,
        102,
        137,
        121,
        90,
        75,
        233
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.creator",
                "account": "room"
              },
              {
                "kind": "account",
                "path": "room.id",
                "account": "room"
              }
            ]
          }
        },
        {
          "name": "creator",
          "writable": true
        },
        {
          "name": "pofConfig"
        }
      ],
      "args": []
    },
    {
      "name": "setRoom",
      "docs": [
        "The creator changes the tier (members below it become evictable), opens or shuts the door, renames."
      ],
      "discriminator": [
        67,
        127,
        154,
        110,
        226,
        167,
        240,
        184
      ],
      "accounts": [
        {
          "name": "creator",
          "signer": true,
          "relations": [
            "room"
          ]
        },
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.creator",
                "account": "room"
              },
              {
                "kind": "account",
                "path": "room.id",
                "account": "room"
              }
            ]
          }
        },
        {
          "name": "pofConfig"
        }
      ],
      "args": [
        {
          "name": "minTier",
          "type": "u8"
        },
        {
          "name": "open",
          "type": "bool"
        },
        {
          "name": "name",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "member",
      "discriminator": [
        54,
        19,
        162,
        21,
        29,
        166,
        17,
        198
      ]
    },
    {
      "name": "room",
      "discriminator": [
        156,
        199,
        67,
        27,
        222,
        23,
        185,
        94
      ]
    }
  ],
  "events": [
    {
      "name": "joined",
      "discriminator": [
        16,
        20,
        44,
        48,
        132,
        189,
        68,
        98
      ]
    },
    {
      "name": "left",
      "discriminator": [
        225,
        78,
        253,
        233,
        66,
        254,
        152,
        164
      ]
    },
    {
      "name": "roomClosed",
      "discriminator": [
        150,
        23,
        85,
        195,
        169,
        114,
        30,
        88
      ]
    },
    {
      "name": "roomSet",
      "discriminator": [
        10,
        18,
        6,
        38,
        218,
        151,
        133,
        149
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "notCreator",
      "msg": "only the room's creator may do this"
    },
    {
      "code": 6001,
      "name": "roomShut",
      "msg": "the room takes no new members"
    },
    {
      "code": 6002,
      "name": "badTier",
      "msg": "no such asset or tier on POF"
    },
    {
      "code": 6003,
      "name": "notController",
      "msg": "the certificate's controller is not the signer"
    },
    {
      "code": 6004,
      "name": "stillValid",
      "msg": "the member's certificate is still live and good enough for this room"
    },
    {
      "code": 6005,
      "name": "membersLeft",
      "msg": "the room still has members"
    },
    {
      "code": 6006,
      "name": "badPofConfig",
      "msg": "not POF's config"
    },
    {
      "code": 6007,
      "name": "notClosing",
      "msg": "POF is not winding down"
    },
    {
      "code": 6008,
      "name": "badCertificate",
      "msg": "not this member's certificate"
    }
  ],
  "types": [
    {
      "name": "joined",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "room",
            "type": "pubkey"
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
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "left",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "room",
            "type": "pubkey"
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
            "name": "evicted",
            "type": "bool"
          },
          {
            "name": "by",
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
      "name": "member",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "room",
            "type": "pubkey"
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
            "name": "subjectKind",
            "type": "u8"
          },
          {
            "name": "certificate",
            "docs": [
              "The POF certificate PDA of (subject_hash, room.asset)."
            ],
            "type": "pubkey"
          },
          {
            "name": "controller",
            "docs": [
              "The certificate's controller when it joined."
            ],
            "type": "pubkey"
          },
          {
            "name": "payer",
            "docs": [
              "Paid the rent; gets it back at evict or leave."
            ],
            "type": "pubkey"
          },
          {
            "name": "joinedSlot",
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
      "name": "room",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "asset",
            "type": "u8"
          },
          {
            "name": "minTier",
            "type": "u8"
          },
          {
            "name": "open",
            "docs": [
              "Takes new members."
            ],
            "type": "bool"
          },
          {
            "name": "name",
            "docs": [
              "A label, UTF-8, zero padded."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "members",
            "type": "u32"
          },
          {
            "name": "joined",
            "type": "u64"
          },
          {
            "name": "evicted",
            "type": "u64"
          },
          {
            "name": "createdSlot",
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
      "name": "roomClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "room",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "roomSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "room",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "asset",
            "type": "u8"
          },
          {
            "name": "minTier",
            "type": "u8"
          },
          {
            "name": "open",
            "type": "bool"
          },
          {
            "name": "name",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    }
  ]
};
