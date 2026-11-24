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
}

function b64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

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
