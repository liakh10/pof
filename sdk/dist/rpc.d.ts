export type Commitment = "processed" | "confirmed" | "finalized";
export interface AccountData {
    address: string;
    owner: string;
    lamports: number;
    data: Uint8Array;
}
export type MemcmpFilter = {
    memcmp: {
        offset: number;
        bytes: string;
    };
} | {
    dataSize: number;
};
export interface RpcLike {
    getSlot(commitment?: Commitment): Promise<number>;
    getAccount(address: string): Promise<AccountData | null>;
    getAccounts(addresses: string[]): Promise<(AccountData | null)[]>;
    getProgramAccounts(programId: string, filters: MemcmpFilter[]): Promise<AccountData[]>;
}
export declare class RpcError extends Error {
    code?: number | undefined;
    constructor(message: string, code?: number | undefined);
}
export declare class Rpc implements RpcLike {
    url: string;
    private opts;
    private id;
    constructor(url: string, opts?: {
        commitment?: Commitment;
        fetch?: typeof fetch;
        headers?: Record<string, string>;
        timeoutMs?: number;
    });
    get commitment(): Commitment;
    call<T = any>(method: string, params: unknown[]): Promise<T>;
    getSlot(commitment?: Commitment): Promise<number>;
    private toAccount;
    getAccount(address: string): Promise<AccountData | null>;
    getAccounts(addresses: string[]): Promise<(AccountData | null)[]>;
    getProgramAccounts(programId: string, filters: MemcmpFilter[]): Promise<AccountData[]>;
}
export declare function memcmp(offset: number, bytes: Uint8Array): MemcmpFilter;
