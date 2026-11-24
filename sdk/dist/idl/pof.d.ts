export declare const IDL_IS_DRAFT = true;
export declare const POF_IDL: {
    readonly address: "sKhmjuNGqbdMaqDy4PQpWUyFroVkZMTjrXkTnrmdEwi";
    readonly metadata: {
        readonly name: "pof";
        readonly version: "0.0.0-draft";
        readonly spec: "0.1.0";
    };
    readonly instructions: readonly [{
        readonly name: "require_certificate";
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
    }];
    readonly accounts: readonly [{
        readonly name: "Certificate";
        readonly discriminator: readonly [202, 229, 222, 220, 116, 20, 74, 67];
    }, {
        readonly name: "Config";
        readonly discriminator: readonly [155, 12, 170, 224, 30, 250, 204, 130];
    }];
    readonly types: readonly [{
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
                readonly type: "u8";
            }, {
                readonly name: "certified_slot";
                readonly type: "u64";
            }, {
                readonly name: "expiry_slot";
                readonly type: "u64";
            }, {
                readonly name: "revoked_slot";
                readonly type: "u64";
            }, {
                readonly name: "note_count";
                readonly type: "u8";
            }, {
                readonly name: "nullifier_hashes";
                readonly type: {
                    readonly array: readonly [{
                        readonly array: readonly ["u8", 32];
                    }, 8];
                };
            }, {
                readonly name: "payer";
                readonly type: "pubkey";
            }, {
                readonly name: "log_index";
                readonly type: "u64";
            }, {
                readonly name: "verifier";
                readonly type: "pubkey";
            }, {
                readonly name: "bump";
                readonly type: "u8";
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
                readonly name: "verifier";
                readonly type: "pubkey";
            }, {
                readonly name: "fee_lamports";
                readonly type: "u64";
            }, {
                readonly name: "validity_slots";
                readonly type: "u64";
            }, {
                readonly name: "root_mint";
                readonly type: "pubkey";
            }, {
                readonly name: "certified";
                readonly type: "u64";
            }, {
                readonly name: "revoked";
                readonly type: "u64";
            }, {
                readonly name: "bump";
                readonly type: "u8";
            }];
        };
    }];
};
