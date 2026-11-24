/** A small Anchor-IDL-driven Borsh reader/writer. It keeps the account layout in the IDL, not in code. */
import { encodeBase58, toAddressBytes } from "./base58.js";
import { concat } from "./bytes.js";
const SIZES = {
    bool: 1, u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, f32: 4,
    u64: 8, i64: 8, f64: 8, u128: 16, i128: 16, pubkey: 32, publicKey: 32,
};
function typeDef(idl, t) {
    const name = typeof t.defined === "string" ? t.defined : t.defined.name;
    const d = idl.types?.find((x) => x.name === name);
    if (!d)
        throw new Error(`IDL type ${name} not found`);
    return d;
}
/** Fixed byte size of a type, or null when it varies (vec, string, option, data-carrying enum). */
export function fixedSize(idl, t) {
    if (typeof t === "string")
        return SIZES[t] ?? null;
    if (t.array) {
        const inner = fixedSize(idl, t.array[0]);
        return inner === null ? null : inner * t.array[1];
    }
    if (t.defined) {
        const d = typeDef(idl, t);
        if (d.type.kind === "struct") {
            let n = 0;
            for (const f of d.type.fields ?? []) {
                const s = fixedSize(idl, f.type);
                if (s === null)
                    return null;
                n += s;
            }
            return n;
        }
        return d.type.variants.every((v) => !v.fields || v.fields.length === 0) ? 1 : null;
    }
    return null;
}
/** Byte offset of a struct field inside an account's data (8-byte discriminator included). */
export function fieldOffset(idl, typeName, field) {
    const d = idl.types?.find((x) => x.name === typeName);
    if (!d || d.type.kind !== "struct")
        throw new Error(`IDL struct ${typeName} not found`);
    let off = 8;
    for (const f of d.type.fields ?? []) {
        if (f.name === field)
            return off;
        const s = fixedSize(idl, f.type);
        if (s === null)
            throw new Error(`${typeName}.${field} sits after a variable-size field`);
        off += s;
    }
    throw new Error(`IDL field ${typeName}.${field} not found`);
}
export class Reader {
    b;
    o = 0;
    v;
    constructor(b, offset = 0) {
        this.b = b;
        this.o = offset;
        this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    }
    need(n) {
        if (this.o + n > this.b.length)
            throw new Error("account data too short for its IDL layout");
    }
    bytes(n) {
        this.need(n);
        const r = this.b.slice(this.o, this.o + n);
        this.o += n;
        return r;
    }
    read(idl, t) {
        if (typeof t === "string") {
            const v = this.v;
            switch (t) {
                case "bool":
                    this.need(1);
                    return this.b[this.o++] !== 0;
                case "u8":
                    this.need(1);
                    return this.b[this.o++];
                case "i8":
                    this.need(1);
                    return v.getInt8(this.o++);
                case "u16":
                    this.need(2);
                    this.o += 2;
                    return v.getUint16(this.o - 2, true);
                case "i16":
                    this.need(2);
                    this.o += 2;
                    return v.getInt16(this.o - 2, true);
                case "u32":
                    this.need(4);
                    this.o += 4;
                    return v.getUint32(this.o - 4, true);
                case "i32":
                    this.need(4);
                    this.o += 4;
                    return v.getInt32(this.o - 4, true);
                case "f32":
                    this.need(4);
                    this.o += 4;
                    return v.getFloat32(this.o - 4, true);
                case "f64":
                    this.need(8);
                    this.o += 8;
                    return v.getFloat64(this.o - 8, true);
                case "u64":
                    this.need(8);
                    this.o += 8;
                    return v.getBigUint64(this.o - 8, true);
                case "i64":
                    this.need(8);
                    this.o += 8;
                    return v.getBigInt64(this.o - 8, true);
                case "u128":
                case "i128": {
                    const lo = this.read(idl, "u64");
                    const hi = this.read(idl, "u64");
                    let x = (hi << 64n) | lo;
                    if (t === "i128" && hi >> 63n)
                        x -= 1n << 128n;
                    return x;
                }
                case "pubkey":
                case "publicKey": return encodeBase58(this.bytes(32));
                case "string": return new TextDecoder().decode(this.bytes(this.read(idl, "u32")));
                case "bytes": return this.bytes(this.read(idl, "u32"));
            }
            throw new Error(`unsupported IDL type ${t}`);
        }
        if (t.array) {
            const [inner, n] = t.array;
            if (inner === "u8")
                return this.bytes(n);
            return Array.from({ length: n }, () => this.read(idl, inner));
        }
        if (t.vec) {
            const n = this.read(idl, "u32");
            if (t.vec === "u8")
                return this.bytes(n);
            return Array.from({ length: n }, () => this.read(idl, t.vec));
        }
        if (t.option)
            return this.read(idl, "u8") ? this.read(idl, t.option) : null;
        if (t.coption) {
            const tag = this.read(idl, "u32");
            const val = this.read(idl, t.coption);
            return tag ? val : null;
        }
        if (t.defined) {
            const d = typeDef(idl, t);
            if (d.type.kind === "struct")
                return this.struct(idl, d.type.fields ?? []);
            const idx = this.read(idl, "u8");
            const variant = d.type.variants[idx];
            if (!variant)
                throw new Error(`bad enum tag ${idx} for ${d.name}`);
            if (!variant.fields?.length)
                return { kind: variant.name };
            const named = typeof variant.fields[0] === "object" && "name" in variant.fields[0];
            return named
                ? { kind: variant.name, ...this.struct(idl, variant.fields) }
                : { kind: variant.name, values: variant.fields.map((ft) => this.read(idl, ft)) };
        }
        throw new Error(`unsupported IDL type ${JSON.stringify(t)}`);
    }
    struct(idl, fields) {
        const out = {};
        for (const f of fields)
            out[f.name] = this.read(idl, f.type);
        return out;
    }
}
/** Encode a value of an IDL type (instruction args). */
export function encode(idl, t, v) {
    if (typeof t === "string") {
        const size = SIZES[t];
        if (t === "pubkey" || t === "publicKey")
            return toAddressBytes(v);
        if (t === "bool")
            return Uint8Array.of(v ? 1 : 0);
        if (t === "string") {
            const s = new TextEncoder().encode(v);
            return concat(encode(idl, "u32", s.length), s);
        }
        if (t === "bytes")
            return concat(encode(idl, "u32", v.length), v);
        if (size) {
            const out = new Uint8Array(size);
            const dv = new DataView(out.buffer);
            switch (t) {
                case "u8":
                    dv.setUint8(0, Number(v));
                    break;
                case "i8":
                    dv.setInt8(0, Number(v));
                    break;
                case "u16":
                    dv.setUint16(0, Number(v), true);
                    break;
                case "i16":
                    dv.setInt16(0, Number(v), true);
                    break;
                case "u32":
                    dv.setUint32(0, Number(v), true);
                    break;
                case "i32":
                    dv.setInt32(0, Number(v), true);
                    break;
                case "u64":
                    dv.setBigUint64(0, BigInt(v), true);
                    break;
                case "i64":
                    dv.setBigInt64(0, BigInt(v), true);
                    break;
                case "u128":
                case "i128": {
                    const x = BigInt.asUintN(128, BigInt(v));
                    dv.setBigUint64(0, x & ((1n << 64n) - 1n), true);
                    dv.setBigUint64(8, x >> 64n, true);
                    break;
                }
                default: throw new Error(`cannot encode ${t}`);
            }
            return out;
        }
        throw new Error(`cannot encode ${t}`);
    }
    if (t.array) {
        const [inner, n] = t.array;
        if (inner === "u8") {
            const b = v instanceof Uint8Array ? v : Uint8Array.from(v);
            if (b.length !== n)
                throw new Error(`expected ${n} bytes, got ${b.length}`);
            return b;
        }
        if (v.length !== n)
            throw new Error(`expected ${n} items`);
        return concat(...v.map((x) => encode(idl, inner, x)));
    }
    if (t.vec)
        return concat(encode(idl, "u32", v.length), ...Array.from(v, (x) => encode(idl, t.vec, x)));
    if (t.option)
        return v === null || v === undefined ? Uint8Array.of(0) : concat(Uint8Array.of(1), encode(idl, t.option, v));
    if (t.defined) {
        const d = typeDef(idl, t);
        if (d.type.kind === "struct")
            return concat(...(d.type.fields ?? []).map((f) => encode(idl, f.type, v[f.name])));
        const idx = d.type.variants.findIndex((x) => x.name === (typeof v === "string" ? v : v.kind));
        if (idx < 0)
            throw new Error(`unknown variant for ${d.name}`);
        return Uint8Array.of(idx);
    }
    throw new Error(`cannot encode ${JSON.stringify(t)}`);
}
export function accountDiscriminator(idl, name) {
    const a = idl.accounts?.find((x) => x.name === name);
    if (!a)
        throw new Error(`IDL account ${name} not found`);
    return Uint8Array.from(a.discriminator);
}
/** Decode one account by IDL name. Throws if the discriminator does not match. */
export function decodeAccount(idl, name, data) {
    const disc = accountDiscriminator(idl, name);
    for (let i = 0; i < 8; i++)
        if (data[i] !== disc[i])
            throw new Error(`not a ${name} account`);
    const d = idl.types?.find((x) => x.name === name);
    if (!d || d.type.kind !== "struct")
        throw new Error(`IDL struct ${name} not found`);
    return new Reader(data, 8).struct(idl, d.type.fields ?? []);
}
/** Encode an account (used by tests and local fixtures). */
export function encodeAccount(idl, name, value) {
    const d = idl.types?.find((x) => x.name === name);
    if (!d || d.type.kind !== "struct")
        throw new Error(`IDL struct ${name} not found`);
    return concat(accountDiscriminator(idl, name), ...(d.type.fields ?? []).map((f) => encode(idl, f.type, value[f.name])));
}
/** Instruction data: discriminator ‖ borsh(args). */
export function encodeInstruction(idl, name, args) {
    const ix = idl.instructions.find((x) => x.name === name);
    if (!ix)
        throw new Error(`IDL instruction ${name} not found`);
    return concat(Uint8Array.from(ix.discriminator), ...ix.args.map((a) => encode(idl, a.type, args[a.name])));
}
