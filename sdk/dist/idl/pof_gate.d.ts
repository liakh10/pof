export declare const IDL_IS_DRAFT = false;
export declare const POF_GATE_IDL: {
    readonly address: "gatSToJMD8ZPLa85fKj6seYHUtYx4ah3ptZvLkisLPU";
    readonly metadata: {
        readonly name: "pof_gate";
        readonly version: "0.1.0";
        readonly spec: "0.1.0";
        readonly description: "Proof of Funds Rooms: on-chain rooms that admit a subject only with a live POF certificate (through the require_certificate CPI) and let anyone evict a member whose certificate is revoked or expired";
    };
    readonly instructions: readonly [{
        readonly name: "close_room";
        readonly docs: readonly ["The creator closes an empty room (rent back)."];
        readonly discriminator: readonly [152, 197, 88, 192, 98, 197, 51, 211];
        readonly accounts: readonly [{
            readonly name: "creator";
            readonly writable: true;
            readonly signer: true;
            readonly relations: readonly ["room"];
        }, {
            readonly name: "room";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [114, 111, 111, 109];
                }, {
                    readonly kind: "account";
                    readonly path: "room.creator";
                    readonly account: "Room";
                }, {
                    readonly kind: "account";
                    readonly path: "room.id";
                    readonly account: "Room";
                }];
            };
        }];
        readonly args: readonly [];
    }, {
        readonly name: "create_room";
        readonly docs: readonly ["A new room: certificates of `asset` at `min_tier` or above may join."];
        readonly discriminator: readonly [130, 166, 32, 2, 247, 120, 178, 53];
        readonly accounts: readonly [{
            readonly name: "creator";
            readonly writable: true;
            readonly signer: true;
        }, {
            readonly name: "room";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [114, 111, 111, 109];
                }, {
                    readonly kind: "account";
                    readonly path: "creator";
                }, {
                    readonly kind: "arg";
                    readonly path: "id";
                }];
            };
        }, {
            readonly name: "pof_config";
        }, {
            readonly name: "system_program";
            readonly address: "11111111111111111111111111111111";
        }];
        readonly args: readonly [{
            readonly name: "id";
            readonly type: "u64";
        }, {
            readonly name: "asset";
            readonly type: "u8";
        }, {
            readonly name: "min_tier";
            readonly type: "u8";
        }, {
            readonly name: "name";
            readonly type: {
                readonly array: readonly ["u8", 32];
            };
        }];
    }, {
        readonly name: "evict";
        readonly docs: readonly ["Anyone: the member's certificate is no longer good for this room (revoked, expired, closed, below the tier, or remade", "with another controller). The member closes, its rent back to its payer."];
        readonly discriminator: readonly [56, 13, 174, 235, 133, 159, 37, 162];
        readonly accounts: readonly [{
            readonly name: "caller";
            readonly signer: true;
        }, {
            readonly name: "room";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [114, 111, 111, 109];
                }, {
                    readonly kind: "account";
                    readonly path: "room.creator";
                    readonly account: "Room";
                }, {
                    readonly kind: "account";
                    readonly path: "room.id";
                    readonly account: "Room";
                }];
            };
            readonly relations: readonly ["member"];
        }, {
            readonly name: "member";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [109, 101, 109, 98, 101, 114];
                }, {
                    readonly kind: "account";
                    readonly path: "room";
                }, {
                    readonly kind: "account";
                    readonly path: "member.subject_hash";
                    readonly account: "Member";
                }];
            };
        }, {
            readonly name: "payer";
            readonly writable: true;
        }, {
            readonly name: "certificate";
        }, {
            readonly name: "pof_config";
        }];
        readonly args: readonly [];
    }, {
        readonly name: "join";
        readonly docs: readonly ["The controller of a live certificate joins: POF's `require_certificate` CPI decides."];
        readonly discriminator: readonly [206, 55, 2, 106, 113, 220, 17, 163];
        readonly accounts: readonly [{
            readonly name: "controller";
            readonly signer: true;
        }, {
            readonly name: "payer";
            readonly writable: true;
            readonly signer: true;
        }, {
            readonly name: "room";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [114, 111, 111, 109];
                }, {
                    readonly kind: "account";
                    readonly path: "room.creator";
                    readonly account: "Room";
                }, {
                    readonly kind: "account";
                    readonly path: "room.id";
                    readonly account: "Room";
                }];
            };
        }, {
            readonly name: "member";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [109, 101, 109, 98, 101, 114];
                }, {
                    readonly kind: "account";
                    readonly path: "room";
                }, {
                    readonly kind: "arg";
                    readonly path: "subject_hash";
                }];
            };
        }, {
            readonly name: "certificate";
        }, {
            readonly name: "pof_config";
        }, {
            readonly name: "pof_program";
            readonly address: "pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT";
        }, {
            readonly name: "system_program";
            readonly address: "11111111111111111111111111111111";
        }];
        readonly args: readonly [{
            readonly name: "subject_hash";
            readonly type: {
                readonly array: readonly ["u8", 32];
            };
        }];
    }, {
        readonly name: "leave";
        readonly docs: readonly ["The member's controller leaves."];
        readonly discriminator: readonly [59, 234, 148, 108, 107, 149, 173, 112];
        readonly accounts: readonly [{
            readonly name: "controller";
            readonly signer: true;
            readonly relations: readonly ["member"];
        }, {
            readonly name: "room";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [114, 111, 111, 109];
                }, {
                    readonly kind: "account";
                    readonly path: "room.creator";
                    readonly account: "Room";
                }, {
                    readonly kind: "account";
                    readonly path: "room.id";
                    readonly account: "Room";
                }];
            };
            readonly relations: readonly ["member"];
        }, {
            readonly name: "member";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [109, 101, 109, 98, 101, 114];
                }, {
                    readonly kind: "account";
                    readonly path: "room";
                }, {
                    readonly kind: "account";
                    readonly path: "member.subject_hash";
                    readonly account: "Member";
                }];
            };
        }, {
            readonly name: "payer";
            readonly writable: true;
        }];
        readonly args: readonly [];
    }, {
        readonly name: "release_room";
        readonly docs: readonly ["Anyone, while POF winds down (config closing or closed): an empty room closes, its rent back to its creator."];
        readonly discriminator: readonly [78, 88, 102, 137, 121, 90, 75, 233];
        readonly accounts: readonly [{
            readonly name: "caller";
            readonly signer: true;
        }, {
            readonly name: "room";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [114, 111, 111, 109];
                }, {
                    readonly kind: "account";
                    readonly path: "room.creator";
                    readonly account: "Room";
                }, {
                    readonly kind: "account";
                    readonly path: "room.id";
                    readonly account: "Room";
                }];
            };
        }, {
            readonly name: "creator";
            readonly writable: true;
        }, {
            readonly name: "pof_config";
        }];
        readonly args: readonly [];
    }, {
        readonly name: "set_room";
        readonly docs: readonly ["The creator changes the tier (members below it become evictable), opens or shuts the door, renames."];
        readonly discriminator: readonly [67, 127, 154, 110, 226, 167, 240, 184];
        readonly accounts: readonly [{
            readonly name: "creator";
            readonly signer: true;
            readonly relations: readonly ["room"];
        }, {
            readonly name: "room";
            readonly writable: true;
            readonly pda: {
                readonly seeds: readonly [{
                    readonly kind: "const";
                    readonly value: readonly [114, 111, 111, 109];
                }, {
                    readonly kind: "account";
                    readonly path: "room.creator";
                    readonly account: "Room";
                }, {
                    readonly kind: "account";
                    readonly path: "room.id";
                    readonly account: "Room";
                }];
            };
        }, {
            readonly name: "pof_config";
        }];
        readonly args: readonly [{
            readonly name: "min_tier";
            readonly type: "u8";
        }, {
            readonly name: "open";
            readonly type: "bool";
        }, {
            readonly name: "name";
            readonly type: {
                readonly array: readonly ["u8", 32];
            };
        }];
    }];
    readonly accounts: readonly [{
        readonly name: "Member";
        readonly discriminator: readonly [54, 19, 162, 21, 29, 166, 17, 198];
    }, {
        readonly name: "Room";
        readonly discriminator: readonly [156, 199, 67, 27, 222, 23, 185, 94];
    }];
    readonly events: readonly [{
        readonly name: "Joined";
        readonly discriminator: readonly [16, 20, 44, 48, 132, 189, 68, 98];
    }, {
        readonly name: "Left";
        readonly discriminator: readonly [225, 78, 253, 233, 66, 254, 152, 164];
    }, {
        readonly name: "RoomClosed";
        readonly discriminator: readonly [150, 23, 85, 195, 169, 114, 30, 88];
    }, {
        readonly name: "RoomSet";
        readonly discriminator: readonly [10, 18, 6, 38, 218, 151, 133, 149];
    }];
    readonly errors: readonly [{
        readonly code: 6000;
        readonly name: "NotCreator";
        readonly msg: "only the room's creator may do this";
    }, {
        readonly code: 6001;
        readonly name: "RoomShut";
        readonly msg: "the room takes no new members";
    }, {
        readonly code: 6002;
        readonly name: "BadTier";
        readonly msg: "no such asset or tier on POF";
    }, {
        readonly code: 6003;
        readonly name: "NotController";
        readonly msg: "the certificate's controller is not the signer";
    }, {
        readonly code: 6004;
        readonly name: "StillValid";
        readonly msg: "the member's certificate is still live and good enough for this room";
    }, {
        readonly code: 6005;
        readonly name: "MembersLeft";
        readonly msg: "the room still has members";
    }, {
        readonly code: 6006;
        readonly name: "BadPofConfig";
        readonly msg: "not POF's config";
    }, {
        readonly code: 6007;
        readonly name: "NotClosing";
        readonly msg: "POF is not winding down";
    }, {
        readonly code: 6008;
        readonly name: "BadCertificate";
        readonly msg: "not this member's certificate";
    }];
    readonly types: readonly [{
        readonly name: "Joined";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "room";
                readonly type: "pubkey";
            }, {
                readonly name: "subject_hash";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "tier";
                readonly type: "u8";
            }, {
                readonly name: "expiry_slot";
                readonly type: "u64";
            }, {
                readonly name: "controller";
                readonly type: "pubkey";
            }, {
                readonly name: "slot";
                readonly type: "u64";
            }];
        };
    }, {
        readonly name: "Left";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "room";
                readonly type: "pubkey";
            }, {
                readonly name: "subject_hash";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "evicted";
                readonly type: "bool";
            }, {
                readonly name: "by";
                readonly type: "pubkey";
            }, {
                readonly name: "slot";
                readonly type: "u64";
            }];
        };
    }, {
        readonly name: "Member";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "room";
                readonly type: "pubkey";
            }, {
                readonly name: "subject_hash";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "subject_kind";
                readonly type: "u8";
            }, {
                readonly name: "certificate";
                readonly docs: readonly ["The POF certificate PDA of (subject_hash, room.asset)."];
                readonly type: "pubkey";
            }, {
                readonly name: "controller";
                readonly docs: readonly ["The certificate's controller when it joined."];
                readonly type: "pubkey";
            }, {
                readonly name: "payer";
                readonly docs: readonly ["Paid the rent; gets it back at evict or leave."];
                readonly type: "pubkey";
            }, {
                readonly name: "joined_slot";
                readonly type: "u64";
            }, {
                readonly name: "bump";
                readonly type: "u8";
            }];
        };
    }, {
        readonly name: "Room";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "creator";
                readonly type: "pubkey";
            }, {
                readonly name: "id";
                readonly type: "u64";
            }, {
                readonly name: "asset";
                readonly type: "u8";
            }, {
                readonly name: "min_tier";
                readonly type: "u8";
            }, {
                readonly name: "open";
                readonly docs: readonly ["Takes new members."];
                readonly type: "bool";
            }, {
                readonly name: "name";
                readonly docs: readonly ["A label, UTF-8, zero padded."];
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }, {
                readonly name: "members";
                readonly type: "u32";
            }, {
                readonly name: "joined";
                readonly type: "u64";
            }, {
                readonly name: "evicted";
                readonly type: "u64";
            }, {
                readonly name: "created_slot";
                readonly type: "u64";
            }, {
                readonly name: "bump";
                readonly type: "u8";
            }];
        };
    }, {
        readonly name: "RoomClosed";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "room";
                readonly type: "pubkey";
            }, {
                readonly name: "creator";
                readonly type: "pubkey";
            }];
        };
    }, {
        readonly name: "RoomSet";
        readonly type: {
            readonly kind: "struct";
            readonly fields: readonly [{
                readonly name: "room";
                readonly type: "pubkey";
            }, {
                readonly name: "creator";
                readonly type: "pubkey";
            }, {
                readonly name: "id";
                readonly type: "u64";
            }, {
                readonly name: "asset";
                readonly type: "u8";
            }, {
                readonly name: "min_tier";
                readonly type: "u8";
            }, {
                readonly name: "open";
                readonly type: "bool";
            }, {
                readonly name: "name";
                readonly type: {
                    readonly array: readonly ["u8", 32];
                };
            }];
        };
    }];
};
