export declare const IDL_IS_DRAFT = true;
export declare const POF_GATE_IDL: {
    readonly address: "42iRXsi4PdFG2BwraUKtcxmWthF8df67zp7r9s3GhLxv";
    readonly metadata: {
        readonly name: "pof_gate";
        readonly version: "0.0.0-draft";
        readonly spec: "0.1.0";
    };
    readonly instructions: readonly [{
        readonly name: "join";
        readonly discriminator: readonly [206, 55, 2, 106, 113, 220, 17, 163];
        readonly accounts: readonly [{
            readonly name: "room";
            readonly writable: true;
        }, {
            readonly name: "member";
            readonly writable: true;
        }, {
            readonly name: "certificate";
        }, {
            readonly name: "payer";
            readonly writable: true;
            readonly signer: true;
        }, {
            readonly name: "pof_program";
            readonly address: "sKhmjuNGqbdMaqDy4PQpWUyFroVkZMTjrXkTnrmdEwi";
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
    }];
    readonly accounts: readonly [{
        readonly name: "Room";
        readonly discriminator: readonly [156, 199, 67, 27, 222, 23, 185, 94];
    }, {
        readonly name: "Member";
        readonly discriminator: readonly [54, 19, 162, 21, 29, 166, 17, 198];
    }];
    readonly types: readonly [{
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
                readonly name: "member_count";
                readonly type: "u32";
            }, {
                readonly name: "created_slot";
                readonly type: "u64";
            }, {
                readonly name: "bump";
                readonly type: "u8";
            }, {
                readonly name: "name";
                readonly type: "string";
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
                readonly name: "certificate";
                readonly type: "pubkey";
            }, {
                readonly name: "joined_slot";
                readonly type: "u64";
            }, {
                readonly name: "bump";
                readonly type: "u8";
            }];
        };
    }];
};
