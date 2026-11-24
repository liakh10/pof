export type IdlType = any;
export interface IdlField {
    name: string;
    type: IdlType;
}
export interface IdlTypeDef {
    name: string;
    type: {
        kind: "struct";
        fields?: readonly IdlField[];
    } | {
        kind: "enum";
        variants: readonly {
            name: string;
            fields?: readonly any[];
        }[];
    };
}
export interface Idl {
    address: string;
    metadata: {
        name: string;
        version: string;
        spec?: string;
    };
    instructions: readonly {
        name: string;
        discriminator: readonly number[];
        accounts: readonly any[];
        args: readonly IdlField[];
    }[];
    accounts?: readonly {
        name: string;
        discriminator: readonly number[];
    }[];
    types?: readonly IdlTypeDef[];
}
/** Fixed byte size of a type, or null when it varies (vec, string, option, data-carrying enum). */
export declare function fixedSize(idl: Idl, t: IdlType): number | null;
/** Byte offset of a struct field inside an account's data (8-byte discriminator included). */
export declare function fieldOffset(idl: Idl, typeName: string, field: string): number;
export declare class Reader {
    b: Uint8Array;
    o: number;
    private v;
    constructor(b: Uint8Array, offset?: number);
    need(n: number): void;
    bytes(n: number): Uint8Array<ArrayBufferLike>;
    read(idl: Idl, t: IdlType): any;
    struct(idl: Idl, fields: readonly IdlField[]): Record<string, any>;
}
/** Encode a value of an IDL type (instruction args). */
export declare function encode(idl: Idl, t: IdlType, v: any): Uint8Array;
export declare function accountDiscriminator(idl: Idl, name: string): Uint8Array;
/** Decode one account by IDL name. Throws if the discriminator does not match. */
export declare function decodeAccount(idl: Idl, name: string, data: Uint8Array): Record<string, any>;
/** Encode an account (used by tests and local fixtures). */
export declare function encodeAccount(idl: Idl, name: string, value: Record<string, any>): Uint8Array;
/** Instruction data: discriminator ‖ borsh(args). */
export declare function encodeInstruction(idl: Idl, name: string, args: Record<string, any>): Uint8Array;
/** A zero value for any IDL type (fixtures fill the fields they care about on top of it). */
export declare function zeroValue(idl: Idl, t: IdlType): any;
/** Encode an account from a partial value: missing fields are zero. */
export declare function encodeAccountPartial(idl: Idl, name: string, value: Record<string, any>): Uint8Array;
