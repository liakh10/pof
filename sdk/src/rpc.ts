/** A minimal Solana JSON-RPC reader (fetch only). Pass your own RPC URL; no API of ours is involved. */
import { encodeBase58 } from "./base58.js";

export type Commitment = "processed" | "confirmed" | "finalized";

export interface AccountData {
  address: string;
  owner: string;
  lamports: number;
  data: Uint8Array;
}

export type MemcmpFilter = { memcmp: { offset: number; bytes: string } } | { dataSize: number };

export interface RpcLike {
  getSlot(commitment?: Commitment): Promise<number>;
  getAccount(address: string): Promise<AccountData | null>;
  getAccounts(addresses: string[]): Promise<(AccountData | null)[]>;
  getProgramAccounts(programId: string, filters: MemcmpFilter[]): Promise<AccountData[]>;
  /** optional: accounts plus the slot they were read at, in ONE call (saves the separate getSlot) */
  getAccountsWithSlot?(addresses: string[]): Promise<{ slot: number; accounts: (AccountData | null)[] }>;
  getProgramAccountsWithSlot?(programId: string, filters: MemcmpFilter[]): Promise<{ slot: number; accounts: AccountData[] }>;
  /** optional: transaction history of an address, newest first */
  getSignaturesForAddress?(address: string, opts?: { before?: string; limit?: number }): Promise<{ signature: string; slot: number; err: unknown }[]>;
  /** optional: the log lines of one transaction */
  getTransactionLogs?(signature: string): Promise<string[] | null>;
}

import { fromBase64 as b64 } from "./bytes.js";

export class RpcError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
  }
}

export class Rpc implements RpcLike {
  private id = 0;
  constructor(
    public url: string,
    private opts: { commitment?: Commitment; fetch?: typeof fetch; headers?: Record<string, string>; timeoutMs?: number } = {},
  ) {}

  get commitment(): Commitment {
    return this.opts.commitment ?? "confirmed";
  }

  async call<T = any>(method: string, params: unknown[]): Promise<T> {
    const f = this.opts.fetch ?? fetch;
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const t = ctl ? setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? 20_000) : undefined;
    try {
      const res = await f(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.opts.headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
        signal: ctl?.signal,
      });
      if (!res.ok) throw new RpcError(`RPC ${method} HTTP ${res.status}`, res.status);
      const j: any = await res.json();
      if (j.error) throw new RpcError(`RPC ${method}: ${j.error.message}`, j.error.code);
      return j.result as T;
    } finally {
      if (t) clearTimeout(t);
    }
  }

  async getSlot(commitment?: Commitment): Promise<number> {
    return this.call("getSlot", [{ commitment: commitment ?? this.commitment }]);
  }

  private toAccount(address: string, v: any): AccountData | null {
    if (!v) return null;
    return { address, owner: v.owner, lamports: v.lamports, data: b64(v.data[0]) };
  }

  async getAccount(address: string): Promise<AccountData | null> {
    const r: any = await this.call("getAccountInfo", [address, { encoding: "base64", commitment: this.commitment }]);
    return this.toAccount(address, r?.value);
  }

  async getAccounts(addresses: string[]): Promise<(AccountData | null)[]> {
    const out: (AccountData | null)[] = [];
    for (let i = 0; i < addresses.length; i += 100) {
      const chunk = addresses.slice(i, i + 100);
      const r: any = await this.call("getMultipleAccounts", [chunk, { encoding: "base64", commitment: this.commitment }]);
      r.value.forEach((v: any, j: number) => out.push(this.toAccount(chunk[j], v)));
    }
    return out;
  }

  async getSignaturesForAddress(address: string, opts: { before?: string; limit?: number } = {}) {
    return this.call<{ signature: string; slot: number; err: unknown }[]>("getSignaturesForAddress", [
      address, { limit: opts.limit ?? 1000, before: opts.before, commitment: this.commitment === "processed" ? "confirmed" : this.commitment },
    ]);
  }

  async getTransactionLogs(signature: string): Promise<string[] | null> {
    const r: any = await this.call("getTransaction", [signature, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: this.commitment === "processed" ? "confirmed" : this.commitment }]);
    return r?.meta?.logMessages ?? null;
  }

  async getAccountsWithSlot(addresses: string[]): Promise<{ slot: number; accounts: (AccountData | null)[] }> {
    const accounts: (AccountData | null)[] = [];
    let slot = 0;
    if (!addresses.length) return { slot: await this.getSlot(), accounts };
    for (let i = 0; i < addresses.length; i += 100) {
      const chunk = addresses.slice(i, i + 100);
      const r: any = await this.call("getMultipleAccounts", [chunk, { encoding: "base64", commitment: this.commitment }]);
      slot = Math.max(slot, r.context?.slot ?? 0);
      r.value.forEach((v: any, j: number) => accounts.push(this.toAccount(chunk[j], v)));
    }
    return { slot: slot || (await this.getSlot()), accounts };
  }

  async getProgramAccountsWithSlot(programId: string, filters: MemcmpFilter[]): Promise<{ slot: number; accounts: AccountData[] }> {
    const r: any = await this.call("getProgramAccounts", [programId, { encoding: "base64", commitment: this.commitment, filters, withContext: true }]);
    const list = Array.isArray(r) ? r : r.value;
    const slot = Array.isArray(r) ? await this.getSlot() : r.context?.slot ?? (await this.getSlot());
    return { slot, accounts: list.map((x: any) => this.toAccount(x.pubkey, x.account)!) };
  }

  async getProgramAccounts(programId: string, filters: MemcmpFilter[]): Promise<AccountData[]> {
    const r: any = await this.call("getProgramAccounts", [
      programId,
      { encoding: "base64", commitment: this.commitment, filters },
    ]);
    const list = Array.isArray(r) ? r : r.value;
    return list.map((x: any) => this.toAccount(x.pubkey, x.account)!);
  }
}

export function memcmp(offset: number, bytes: Uint8Array): MemcmpFilter {
  return { memcmp: { offset, bytes: encodeBase58(bytes) } };
}
