import { type AddressLike } from "./base58.js";
/** True when the 32 bytes decode to a point on the ed25519 curve (RFC 8032 §5.1.3). */
export declare function isOnCurve(bytes: Uint8Array): boolean;
export type Seed = Uint8Array | string;
export declare function createProgramAddress(seeds: Seed[], programId: AddressLike): Promise<string | null>;
export declare function findProgramAddress(seeds: Seed[], programId: AddressLike): Promise<[string, number]>;
