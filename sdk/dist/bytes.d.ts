/** Byte helpers shared by every module. No dependencies: WebCrypto only. */
export declare function utf8(s: string): Uint8Array;
export declare function concat(...parts: Uint8Array[]): Uint8Array;
export declare function toHex(b: Uint8Array): string;
/** base64 to bytes: Buffer in Node (fast), atob in browsers */
export declare function fromBase64(s: string): Uint8Array;
export declare function fromHex(h: string): Uint8Array;
export declare function equalBytes(a: Uint8Array, b: Uint8Array): boolean;
export declare function u64le(v: bigint | number): Uint8Array;
/** SHA-256 of the concatenation of the parts. */
export declare function sha256(...parts: (Uint8Array | string)[]): Promise<Uint8Array>;
/** Ed25519 signature check through WebCrypto (Node 20+, Chrome 137+, Safari 17+, Firefox 129+). */
export declare function ed25519Verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean>;
