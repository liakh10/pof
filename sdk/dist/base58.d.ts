/** Bitcoin-alphabet base58, as used by Solana addresses and signatures. */
export declare function encodeBase58(bytes: Uint8Array): string;
export declare function decodeBase58(s: string): Uint8Array;
/** Anything that looks like a public key: a base58 string, 32 raw bytes, or a web3.js / kit object. */
export type AddressLike = string | Uint8Array | {
    toBase58(): string;
} | {
    toBytes(): Uint8Array;
};
export declare function toAddressBytes(a: AddressLike): Uint8Array;
export declare function toAddress(a: AddressLike): string;
export declare function isAddress(s: string): boolean;
