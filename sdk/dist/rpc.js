/** A minimal Solana JSON-RPC reader (fetch only). Pass your own RPC URL; no API of ours is involved. */
import { encodeBase58 } from "./base58.js";
import { fromBase64 as b64 } from "./bytes.js";
export class RpcError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}
export class Rpc {
    url;
    opts;
    id = 0;
    constructor(url, opts = {}) {
        this.url = url;
        this.opts = opts;
    }
    get commitment() {
        return this.opts.commitment ?? "confirmed";
    }
    async call(method, params) {
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
            if (!res.ok)
                throw new RpcError(`RPC ${method} HTTP ${res.status}`, res.status);
            const j = await res.json();
            if (j.error)
                throw new RpcError(`RPC ${method}: ${j.error.message}`, j.error.code);
            return j.result;
        }
        finally {
            if (t)
                clearTimeout(t);
        }
    }
    async getSlot(commitment) {
        return this.call("getSlot", [{ commitment: commitment ?? this.commitment }]);
    }
    toAccount(address, v) {
        if (!v)
            return null;
        return { address, owner: v.owner, lamports: v.lamports, data: b64(v.data[0]) };
    }
    async getAccount(address) {
        const r = await this.call("getAccountInfo", [address, { encoding: "base64", commitment: this.commitment }]);
        return this.toAccount(address, r?.value);
    }
    async getAccounts(addresses) {
        const out = [];
        for (let i = 0; i < addresses.length; i += 100) {
            const chunk = addresses.slice(i, i + 100);
            const r = await this.call("getMultipleAccounts", [chunk, { encoding: "base64", commitment: this.commitment }]);
            r.value.forEach((v, j) => out.push(this.toAccount(chunk[j], v)));
        }
        return out;
    }
    async getSignaturesForAddress(address, opts = {}) {
        return this.call("getSignaturesForAddress", [
            address, { limit: opts.limit ?? 1000, before: opts.before, commitment: this.commitment === "processed" ? "confirmed" : this.commitment },
        ]);
    }
    async getTransactionLogs(signature) {
        const r = await this.call("getTransaction", [signature, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: this.commitment === "processed" ? "confirmed" : this.commitment }]);
        return r?.meta?.logMessages ?? null;
    }
    async getAccountsWithSlot(addresses) {
        const accounts = [];
        let slot = 0;
        if (!addresses.length)
            return { slot: await this.getSlot(), accounts };
        for (let i = 0; i < addresses.length; i += 100) {
            const chunk = addresses.slice(i, i + 100);
            const r = await this.call("getMultipleAccounts", [chunk, { encoding: "base64", commitment: this.commitment }]);
            slot = Math.max(slot, r.context?.slot ?? 0);
            r.value.forEach((v, j) => accounts.push(this.toAccount(chunk[j], v)));
        }
        return { slot: slot || (await this.getSlot()), accounts };
    }
    async getProgramAccountsWithSlot(programId, filters) {
        const r = await this.call("getProgramAccounts", [programId, { encoding: "base64", commitment: this.commitment, filters, withContext: true }]);
        const list = Array.isArray(r) ? r : r.value;
        const slot = Array.isArray(r) ? await this.getSlot() : r.context?.slot ?? (await this.getSlot());
        return { slot, accounts: list.map((x) => this.toAccount(x.pubkey, x.account)) };
    }
    async getProgramAccounts(programId, filters) {
        const r = await this.call("getProgramAccounts", [
            programId,
            { encoding: "base64", commitment: this.commitment, filters },
        ]);
        const list = Array.isArray(r) ? r : r.value;
        return list.map((x) => this.toAccount(x.pubkey, x.account));
    }
}
export function memcmp(offset, bytes) {
    return { memcmp: { offset, bytes: encodeBase58(bytes) } };
}
