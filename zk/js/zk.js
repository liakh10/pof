/* POF zk: everything around the circuit that is not the proof itself. Plain ESM with no dependencies, for the browser and Node:
   - the field and the encodings the program uses (32-byte big-endian),
   - the context hash that binds a proof to one certificate (subject, asset, tier, controller, payer, nonce),
   - Baby Jubjub for the nullifier escrow (keygen, the client's ephemeral key, the keeper's decryption),
   - the circuit's input object from note openings and Merkle paths,
   - the proof in the byte layout the on-chain verifier takes.
   Poseidon is passed in (`P(bigints) -> bigint`): in the browser it is the Rings SDK hasher the client already loads
   (`fromBytesPoseidon(core.poseidon)`), in tests circomlibjs; both are the same function (test/parity.test.mjs).
   The circuit and its formulas: circuits/pof.circom. The design: docs-src/zk.md. */

export const N = 4;
export const STATE_H = 32;
export const NULL_H = 40;
export const REG_H = 20;
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const BASE_Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const enc = new TextEncoder();
const big = bytes => { let x = 0n; for (const b of bytes) x = (x << 8n) | BigInt(b); return x; };
export const TAG_DOMAIN = big(enc.encode('pof:zk:tag:v1'));
export const ESC_DOMAIN = big(enc.encode('pof:zk:esc:v1'));
export const CTX_DOMAIN = enc.encode('pof:zk:ctx:v1');
export const OWN_DOMAIN = big(enc.encode('pof:zk:own:v1'));

/* ------------------------------------------------------------------ encodings */
export const toBig = b => big(b);
export function be32(x) { const o = new Uint8Array(32); let v = BigInt(x); for (let i = 31; i >= 0; i--) { o[i] = Number(v & 255n); v >>= 8n; } if (v) throw Error('value over 32 bytes'); return o; }
export const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
export const unhex = s => Uint8Array.from(s.match(/../g) || [], h => parseInt(h, 16));
const mod = (a, m = FIELD) => ((a % m) + m) % m;
/* the Rings SDK hasher (bytes in, bytes out) as P(bigints) -> bigint */
export const fromBytesPoseidon = poseidonBytes => xs => big(poseidonBytes(xs.map(be32)));

/* hashBytes of Rings (RINGS §2) for 32- and 33-byte inputs: the first 31 bytes as one field, the rest as another, folded */
export function hashBytes(P, bytes) {
  if (bytes.length <= 31) return big(bytes);
  if (bytes.length > 62) throw Error('hashBytes here takes at most 62 bytes');
  return P([big(bytes.subarray(0, 31)), big(bytes.subarray(31))]);
}
export const assetHash = (P, mint32) => hashBytes(P, mint32);
export function ownerId(P, ownerKey32) { const t = new Uint8Array(33); t[0] = 0x53; t.set(ownerKey32, 1); return hashBytes(P, t); }
export const ringTerm = (P, ringDataHash, ringProgramId32) => P([ringDataHash ? big(ringDataHash) : 0n, ringProgramId32 ? hashBytes(P, ringProgramId32) : 0n]);

/* RINGS §2 and §3 with the circuit's split of the inputs */
export function noteHashes(P, { ownerId: oid, nk, asset, amount, blinding, dataHash = 0n, ringTerm: rt }) {
  const npk = P([nk]);
  const owner = P([oid, npk]);
  const commitment = P([3n, 0n, asset, BigInt(amount), dataHash, rt ?? P([0n, 0n]), P([owner, blinding])]);
  const nullifier = P([commitment, blinding, nk]);
  return { npk, owner, commitment, nullifier, tag: P([TAG_DOMAIN, nullifier]) };
}

/* the ring owner's registration (audit ZK-04). ownerSecret never leaves the device and is never shown to a phase 1 Verifier;
   derive it from the vault seed so the wallet alone recovers it: ownerSecretFrom(seed32) = sha256("pof:zk:own:v1" ‖ seed),
   top 3 bits cleared. The owner signs register_zk_owner(Poseidon(OWN_DOMAIN, ownerSecret)); the program appends
   Poseidon(ownerId(owner), that commitment) to the owner registry tree (height 20). */
export const ownerCommitment = (P, ownerSecret) => P([OWN_DOMAIN, BigInt(ownerSecret)]);
export const registryLeaf = (P, oid, ownerSecret) => P([oid, ownerCommitment(P, ownerSecret)]);
export async function ownerSecretFrom(seed32) {
  const msg = new Uint8Array(13 + seed32.length); msg.set(enc.encode('pof:zk:own:v1')); msg.set(seed32, 13);
  const d = new Uint8Array(await (globalThis.crypto?.subtle ?? (await import('node:crypto')).webcrypto.subtle).digest('SHA-256', msg));
  d[0] &= 0x1f;
  return big(d);
}

/* the context: sha256("pof:zk:ctx:v1" ‖ program ‖ kind ‖ subject_hash ‖ asset ‖ tier ‖ controller ‖ payer ‖ nonce), its top three
   bits cleared so it is a field element. The program rebuilds the same bytes (onchain/certify_zk.rs, zk_context). */
export function contextBytes({ programId, subjectKind, subjectHash, asset, tier, controller, payer, nonce }) {
  const parts = [CTX_DOMAIN, programId, Uint8Array.of(subjectKind), subjectHash, Uint8Array.of(asset), Uint8Array.of(tier), controller, payer, nonce];
  const want = [13, 32, 1, 32, 1, 1, 32, 32, 16];
  parts.forEach((p, i) => { if (p.length !== want[i]) throw Error(`context part ${i} is ${p.length} bytes, wants ${want[i]}`); });
  const out = new Uint8Array(want.reduce((a, b) => a + b, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export async function context(fields) {
  const msg = contextBytes(fields);
  const d = new Uint8Array(await (globalThis.crypto?.subtle ?? (await import('node:crypto')).webcrypto.subtle).digest('SHA-256', msg));
  d[0] &= 0x1f;
  return big(d);
}

/* ------------------------------------------------------------------ Baby Jubjub (circomlib's curve and base point B8) */
const A = 168700n, D = 168696n;
export const SUBORDER = 2736030358979909402780800718157159386076813972158567259200215660948447373041n;
export const B8 = [5299619240641551281634865583518297030282874472190772894086521144482721001553n, 16950150798460657717958625567821834550301663161624707787222815936182638968203n];
function inv(a) { let [r0, r1, s0, s1] = [mod(a), FIELD, 1n, 0n]; while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; } return mod(s0); }
export function addPt([x1, y1], [x2, y2]) {
  const t = mod(D * x1 * x2 % FIELD * y1 % FIELD * y2);
  return [mod((x1 * y2 + y1 * x2) % FIELD * inv(1n + t)), mod((y1 * y2 - A * x1 * x2) % FIELD * inv(1n - t + FIELD))];
}
export function mulPt(P0, e) { let r = [0n, 1n], p = P0, k = BigInt(e); while (k > 0n) { if (k & 1n) r = addPt(r, p); p = addPt(p, p); k >>= 1n; } return r; }
export function onCurve([x, y]) { const x2 = x * x % FIELD, y2 = y * y % FIELD; return mod(A * x2 + y2) === mod(1n + D * x2 % FIELD * y2); }
function randomBelow(limit) {
  for (;;) { const b = new Uint8Array(32); globalThis.crypto.getRandomValues(b); b[0] &= 0x0f; const v = big(b); if (v > 0n && v < limit) return v; }
}
/* the revocation key: k secret (the keeper's), K = k·B8 public (the program's ZkConfig.escrow) */
export function escrowKeypair(k = randomBelow(SUBORDER)) { return { secret: k, public: mulPt(B8, k) }; }
/* the client's ephemeral scalar (253 bits, as the circuit's Num2Bits(253)) */
export const ephemeralScalar = () => randomBelow(1n << 252n);
export const pads = (P, shared) => Array.from({ length: N }, (_, i) => P([ESC_DOMAIN, shared[0], shared[1], BigInt(i)]));
/* the keeper: the nullifiers of a certificate from its public (R, ct) and the revocation secret; tags check each one */
export function openEscrow(P, secret, eph, cts, tags) {
  const S = mulPt(eph, secret);
  const pd = pads(P, S);
  return cts.map((c, i) => {
    if (BigInt(c) === 0n) return null;
    const nf = mod(BigInt(c) - pd[i]);
    if (tags && P([TAG_DOMAIN, nf]) !== BigInt(tags[i])) throw Error(`escrow slot ${i} does not open to its tag`);
    return nf;
  });
}

/* ------------------------------------------------------------------ the circuit's inputs
   ring:   { ownerId (bigint) | ownerKey (32 bytes), nk (bigint | 31 bytes), ownerSecret (bigint) }
   registry: { root, index, path[20] }: the ring owner's leaf in the POF owner registry
   notes:  1..N of { amount, blinding, dataHash?, ringTerm?, leafIndex, statePath[32], lowValue, nextValue, lowIndex, nullPath[40] }
           (paths as bigints or 32-byte arrays, siblings from the leaf up)
   pub:    { stateRoot, nullRoot, mint (32 bytes) | assetHash, minAmount, ctx, escrow: [x, y] }
   r:      the ephemeral escrow scalar (ephemeralScalar()).
   Returns { input, publicSignals (as the circuit orders them), notes: [{ tag, nullifier, commitment }] sorted by tag }. */
const F = v => (v instanceof Uint8Array ? big(v) : BigInt(v));
export function buildInputs(P, { ring, notes, pub, r, registry }) {
  if (!notes.length || notes.length > N) throw Error(`1..${N} notes`);
  const oid = ring.ownerId != null ? F(ring.ownerId) : ownerId(P, ring.ownerKey);
  const nk = F(ring.nk);
  const asset = pub.assetHash != null ? F(pub.assetHash) : assetHash(P, pub.mint);
  const S = mulPt([F(pub.escrow[0]), F(pub.escrow[1])], r);
  const R = mulPt(B8, r);
  const pd = pads(P, S);
  const rich = notes.map(n => {
    const h = noteHashes(P, { ownerId: oid, nk, asset, amount: n.amount, blinding: F(n.blinding), dataHash: n.dataHash != null ? F(n.dataHash) : 0n, ringTerm: n.ringTerm != null ? F(n.ringTerm) : undefined });
    return { n, h };
  }).sort((a, b) => (a.h.tag < b.h.tag ? -1 : a.h.tag > b.h.tag ? 1 : 0));
  for (let i = 1; i < rich.length; i++) if (rich[i].h.tag === rich[i - 1].h.tag) throw Error('the same note twice');
  const zeroPath = h => Array(h).fill('0');
  const slot = i => rich[i];
  const input = {
    stateRoot: F(pub.stateRoot).toString(), nullRoot: F(pub.nullRoot).toString(), assetHash: asset.toString(), minAmount: BigInt(pub.minAmount).toString(),
    ctx: F(pub.ctx).toString(), escrowX: F(pub.escrow[0]).toString(), escrowY: F(pub.escrow[1]).toString(), ephX: R[0].toString(), ephY: R[1].toString(),
    tag: [], ct: [], registryRoot: F(registry.root).toString(), ownerId: oid.toString(), nk: nk.toString(), r: BigInt(r).toString(),
    ownerSecret: BigInt(ring.ownerSecret ?? 0n).toString(), regIndex: BigInt(registry.index).toString(), regPath: registry.path.map(x => F(x).toString()),
    enabled: [], amount: [], blinding: [], dataHash: [], ringTerm: [], leafIndex: [], statePath: [], lowValue: [], nextValue: [], lowIndex: [], nullPath: [],
  };
  for (let i = 0; i < N; i++) {
    const s = slot(i);
    if (!s) {
      input.tag.push('0'); input.ct.push('0'); input.enabled.push('0'); input.amount.push('0'); input.blinding.push('0'); input.dataHash.push('0');
      input.ringTerm.push('0'); input.leafIndex.push('0'); input.statePath.push(zeroPath(STATE_H)); input.lowValue.push('0'); input.nextValue.push('0');
      input.lowIndex.push('0'); input.nullPath.push(zeroPath(NULL_H));
      continue;
    }
    const { n, h } = s;
    if (n.statePath.length !== STATE_H || n.nullPath.length !== NULL_H) throw Error('a state path has 32 siblings and a nullifier path 40');
    input.tag.push(h.tag.toString());
    input.ct.push(mod(h.nullifier + pd[i]).toString());
    input.enabled.push('1');
    input.amount.push(BigInt(n.amount).toString());
    input.blinding.push(F(n.blinding).toString());
    input.dataHash.push((n.dataHash != null ? F(n.dataHash) : 0n).toString());
    input.ringTerm.push((n.ringTerm != null ? F(n.ringTerm) : P([0n, 0n])).toString());
    input.leafIndex.push(BigInt(n.leafIndex).toString());
    input.statePath.push(n.statePath.map(x => F(x).toString()));
    input.lowValue.push(F(n.lowValue).toString());
    input.nextValue.push(F(n.nextValue).toString());
    input.lowIndex.push(BigInt(n.lowIndex).toString());
    input.nullPath.push(n.nullPath.map(x => F(x).toString()));
  }
  if (registry.path.length !== REG_H) throw Error('a registry path has 20 siblings');
  const publicSignals = [input.stateRoot, input.nullRoot, input.assetHash, input.minAmount, input.ctx, input.escrowX, input.escrowY, input.ephX, input.ephY, ...input.tag, ...input.ct, input.registryRoot];
  return { input, publicSignals, notes: rich.map(({ h }) => ({ tag: h.tag, nullifier: h.nullifier, commitment: h.commitment })) };
}

/* ------------------------------------------------------------------ the proof for the program
   The on-chain verifier (onchain/groth16.rs) takes A negated (so the check is one product of four pairings equal to one),
   all coordinates 32-byte big-endian, G2 as (x.c1, x.c0, y.c1, y.c0): the layout of Solana's alt_bn128 syscalls. 256 bytes. */
export function proofBytes(proof) {
  const out = new Uint8Array(256);
  const put = (v, at) => out.set(be32(BigInt(v)), at);
  put(proof.pi_a[0], 0); put(mod(BASE_Q - BigInt(proof.pi_a[1]), BASE_Q), 32);
  put(proof.pi_b[0][1], 64); put(proof.pi_b[0][0], 96); put(proof.pi_b[1][1], 128); put(proof.pi_b[1][0], 160);
  put(proof.pi_c[0], 192); put(proof.pi_c[1], 224);
  return out;
}
/* the instruction's zk part: proof, the three roots, R, the tags and ciphertexts (all 32-byte BE) */
export function certifyZkArgs(proof, publicSignals) {
  const ps = publicSignals.map(BigInt);
  return {
    proof: proofBytes(proof),
    stateRoot: be32(ps[0]), nullRoot: be32(ps[1]),
    eph: [be32(ps[7]), be32(ps[8])],
    tags: ps.slice(9, 9 + N).map(be32), cts: ps.slice(9 + N, 9 + 2 * N).map(be32),
    registryRoot: be32(ps[9 + 2 * N]),
    noteCount: ps.slice(9, 9 + N).filter(x => x !== 0n).length,
  };
}

/* ------------------------------------------------------------------ proving (snarkjs, passed in so the page decides how it loads)
   wasm and zkey: URLs or bytes. onStage(name) reports progress for the loading state. Returns the proof, the public signals, the
   timings in ms and the bytes for certify_zk. */
export async function prove(snarkjs, { input, wasm, zkey, onStage = () => {} }) {
  const t0 = performance.now();
  onStage('witness');
  const wtns = { type: 'mem' };
  await snarkjs.wtns.calculate(input, wasm, wtns);
  const t1 = performance.now();
  onStage('proof');
  const { proof, publicSignals } = await snarkjs.groth16.prove(zkey, wtns);
  const t2 = performance.now();
  onStage('done');
  return { proof, publicSignals, ms: { witness: Math.round(t1 - t0), prove: Math.round(t2 - t1), total: Math.round(t2 - t0) }, args: certifyZkArgs(proof, publicSignals) };
}
