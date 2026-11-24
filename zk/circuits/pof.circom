pragma circom 2.1.9;

// Proof of Funds, phase 2: a Groth16 proof that the prover owns 1..N notes of the Helius Privacy Rings state tree at a root the
// chain holds, that their nullifiers are derived correctly and are absent from the Rings nullifier tree at a nullifier root the
// chain holds, that their amounts in one asset sum to at least the tier minimum, and that every nullifier is escrowed to the
// revocation key, without revealing any amount, the nullifier key nk, the owner, the leaves or the nullifiers.
//
// Every hash is Poseidon over BN254 with the circom parameters, which is exactly the Rings SDK hasher (light-poseidon,
// @heliuslabs/spr dist/hasher); pof/RINGS.md §2 and §3 give the formulas, test/parity.test.mjs checks them value for value.
//
//   ownerHash  = Poseidon(ownerId, Poseidon(nk))                         ownerId = hashBytes(0x53 ‖ owner key), private
//   commitment = Poseidon(3, treeId 0, assetHash, amount, dataHash, ringTerm, Poseidon(ownerHash, blinding))
//   nullifier  = Poseidon(commitment, blinding, nk)
//   state tree : height 32, node Poseidon(left, right), leaf = commitment
//   nullifier tree (indexed): height 40, leaf Poseidon(value, nextValue); nf is absent iff a leaf has value < nf < nextValue
//                (nextValue 0 marks the last element: then value < nf suffices)
//   tag        = Poseidon(TAG_DOMAIN, nullifier)                        public, stored on the certificate (one per note)
//   escrow     : R = r·B8 and S = r·K on Baby Jubjub (K = the revocation key), ct = nullifier + Poseidon(ESC_DOMAIN, Sx, Sy, i)
//
// Public inputs (in this order; the program rebuilds or checks each one):
//   0 stateRoot   1 nullRoot   2 assetHash   3 minAmount   4 ctx   5 escrowX   6 escrowY   7 ephX   8 ephY
//   9.. tag[N]    9+N.. ct[N]    9+2N registryRoot
//   registry   : the ring owner's registration leaf Poseidon(ownerId, Poseidon(OWN_DOMAIN, ownerSecret)) in the POF owner registry
//                (height 20) at registryRoot: proves the ring owner consented, not just that nk is known (audit ZK-04)
// A note slot that is not used has enabled = 0, tag = 0 and ct = 0; used slots come first.

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/escalarmulfix.circom";
include "../node_modules/circomlib/circuits/escalarmulany.circom";

// The root of a binary Merkle tree from a leaf, its index bits (bit i = 1: the node at level i is a right child) and the
// siblings from the leaf up.
template MerkleRoot(H) {
    signal input leaf;
    signal input bits[H];
    signal input siblings[H];
    signal output root;

    component h[H];
    signal cur[H + 1];
    signal left[H];
    cur[0] <== leaf;
    for (var i = 0; i < H; i++) {
        left[i] <== cur[i] + bits[i] * (siblings[i] - cur[i]);
        h[i] = Poseidon(2);
        h[i].inputs[0] <== left[i];
        h[i].inputs[1] <== cur[i] + siblings[i] - left[i];
        cur[i + 1] <== h[i].out;
    }
    root <== cur[H];
}

// A field element as its canonical integer, split into two 127-bit halves (Num2Bits_strict refuses the alias x + p).
template Halves() {
    signal input in;
    signal output hi;
    signal output lo;
    component b = Num2Bits_strict();
    b.in <== in;
    var h = 0;
    var l = 0;
    var e = 1;
    for (var i = 0; i < 127; i++) {
        l += b.out[i] * e;
        h += b.out[127 + i] * e;
        e = e + e;
    }
    hi <== h;
    lo <== l;
}

// a < b as integers in [0, p), from their halves.
template HalvesLessThan() {
    signal input aHi;
    signal input aLo;
    signal input bHi;
    signal input bLo;
    signal output out;
    component ltHi = LessThan(127);
    ltHi.in[0] <== aHi;
    ltHi.in[1] <== bHi;
    component eqHi = IsEqual();
    eqHi.in[0] <== aHi;
    eqHi.in[1] <== bHi;
    component ltLo = LessThan(127);
    ltLo.in[0] <== aLo;
    ltLo.in[1] <== bLo;
    signal tie <== eqHi.out * ltLo.out;
    out <== ltHi.out + tie;
}

// One note: its commitment in the state tree, its nullifier, the nullifier's absence from the nullifier tree, its tag and
// escrow ciphertext. Every check is gated by `enabled`, so an unused slot of zeros satisfies it.
template Note(STATE_H, NULL_H, TAG_DOMAIN, ESC_DOMAIN, SLOT) {
    signal input enabled;
    signal input ownerHash;
    signal input nk;
    signal input assetHash;
    signal input stateRoot;
    signal input nullRoot;
    signal input shared[2];

    signal input amount;
    signal input blinding;
    signal input dataHash;
    signal input ringTerm;
    signal input leafIndex;
    signal input statePath[STATE_H];
    signal input lowValue;
    signal input nextValue;
    signal input lowIndex;
    signal input nullPath[NULL_H];

    signal output value;    // enabled * amount
    signal output tag;      // enabled * Poseidon(TAG_DOMAIN, nullifier)
    signal output ct;       // enabled * (nullifier + pad)

    // the amount is a u64, as on chain
    component amountBits = Num2Bits(64);
    amountBits.in <== amount;
    value <== enabled * amount;

    // the commitment (RINGS §2)
    component inner = Poseidon(2);
    inner.inputs[0] <== ownerHash;
    inner.inputs[1] <== blinding;
    component commit = Poseidon(7);
    commit.inputs[0] <== 3;
    commit.inputs[1] <== 0;
    commit.inputs[2] <== assetHash;
    commit.inputs[3] <== amount;
    commit.inputs[4] <== dataHash;
    commit.inputs[5] <== ringTerm;
    commit.inputs[6] <== inner.out;

    // in the state tree at stateRoot
    component leafBits = Num2Bits(STATE_H);
    leafBits.in <== leafIndex;
    component stateRootOf = MerkleRoot(STATE_H);
    stateRootOf.leaf <== commit.out;
    for (var i = 0; i < STATE_H; i++) {
        stateRootOf.bits[i] <== leafBits.out[i];
        stateRootOf.siblings[i] <== statePath[i];
    }
    enabled * (stateRootOf.root - stateRoot) === 0;

    // the nullifier (RINGS §3)
    component nf = Poseidon(3);
    nf.inputs[0] <== commit.out;
    nf.inputs[1] <== blinding;
    nf.inputs[2] <== nk;

    // absent from the indexed nullifier tree at nullRoot: a leaf (lowValue, nextValue) with lowValue < nf < nextValue
    component lowLeaf = Poseidon(2);
    lowLeaf.inputs[0] <== lowValue;
    lowLeaf.inputs[1] <== nextValue;
    component lowBits = Num2Bits(NULL_H);
    lowBits.in <== lowIndex;
    component nullRootOf = MerkleRoot(NULL_H);
    nullRootOf.leaf <== lowLeaf.out;
    for (var i = 0; i < NULL_H; i++) {
        nullRootOf.bits[i] <== lowBits.out[i];
        nullRootOf.siblings[i] <== nullPath[i];
    }
    enabled * (nullRootOf.root - nullRoot) === 0;

    component hLow = Halves();
    hLow.in <== lowValue;
    component hNf = Halves();
    hNf.in <== nf.out;
    component hNext = Halves();
    hNext.in <== nextValue;
    component above = HalvesLessThan();
    above.aHi <== hLow.hi;
    above.aLo <== hLow.lo;
    above.bHi <== hNf.hi;
    above.bLo <== hNf.lo;
    component below = HalvesLessThan();
    below.aHi <== hNf.hi;
    below.aLo <== hNf.lo;
    below.bHi <== hNext.hi;
    below.bLo <== hNext.lo;
    // the last element of the indexed list has nextValue 0 (no upper bound): absent iff above it
    component lastLeaf = IsZero();
    lastLeaf.in <== nextValue;
    signal belowOk <== lastLeaf.out + (1 - lastLeaf.out) * below.out;
    enabled * (1 - above.out) === 0;
    enabled * (1 - belowOk) === 0;

    // the public tag, and the nullifier escrowed to the revocation key
    component t = Poseidon(2);
    t.inputs[0] <== TAG_DOMAIN;
    t.inputs[1] <== nf.out;
    tag <== enabled * t.out;
    component pad = Poseidon(4);
    pad.inputs[0] <== ESC_DOMAIN;
    pad.inputs[1] <== shared[0];
    pad.inputs[2] <== shared[1];
    pad.inputs[3] <== SLOT;
    ct <== enabled * (nf.out + pad.out);
}

template ProofOfFunds(N, STATE_H, NULL_H, REG_H) {
    // "pof:zk:tag:v1", "pof:zk:esc:v1" and "pof:zk:own:v1" as big-endian integers
    var TAG_DOMAIN = 0x706f663a7a6b3a7461673a7631;
    var ESC_DOMAIN = 0x706f663a7a6b3a6573633a7631;
    var OWN_DOMAIN = 0x706f663a7a6b3a6f776e3a7631;

    // public
    signal input stateRoot;
    signal input nullRoot;
    signal input assetHash;
    signal input minAmount;
    signal input ctx;
    signal input escrowX;
    signal input escrowY;
    signal input ephX;
    signal input ephY;
    signal input tag[N];
    signal input ct[N];
    signal input registryRoot;

    // private: the ring
    signal input ownerId;
    signal input nk;
    signal input r;
    // private: the ring owner's registration (ZK-04): the owner signed register_zk_owner with Poseidon(OWN_DOMAIN, ownerSecret)
    signal input ownerSecret;
    signal input regIndex;
    signal input regPath[REG_H];
    // private: the notes
    signal input enabled[N];
    signal input amount[N];
    signal input blinding[N];
    signal input dataHash[N];
    signal input ringTerm[N];
    signal input leafIndex[N];
    signal input statePath[N][STATE_H];
    signal input lowValue[N];
    signal input nextValue[N];
    signal input lowIndex[N];
    signal input nullPath[N][NULL_H];

    // the context (sha256 of the certificate's subject, asset, tier, controller, payer and nonce, rebuilt by the program) is
    // bound to the proof; squaring it puts it in a constraint
    signal ctxSq <== ctx * ctx;

    // the minimum is a u64
    component minBits = Num2Bits(64);
    minBits.in <== minAmount;

    // used slots first, at least one
    enabled[0] === 1;
    for (var i = 0; i < N; i++) {
        enabled[i] * (1 - enabled[i]) === 0;
        if (i > 0) {
            enabled[i] * (1 - enabled[i - 1]) === 0;
        }
    }

    // spend authority (ZK-04): the ring owner registered Poseidon(ownerId, Poseidon(OWN_DOMAIN, ownerSecret)) with its own
    // signature, so nk and the openings alone (which a phase 1 Verifier has seen) are not enough
    component ownCommit = Poseidon(2);
    ownCommit.inputs[0] <== OWN_DOMAIN;
    ownCommit.inputs[1] <== ownerSecret;
    component regLeaf = Poseidon(2);
    regLeaf.inputs[0] <== ownerId;
    regLeaf.inputs[1] <== ownCommit.out;
    component regBits = Num2Bits(REG_H);
    regBits.in <== regIndex;
    component regRootOf = MerkleRoot(REG_H);
    regRootOf.leaf <== regLeaf.out;
    for (var i = 0; i < REG_H; i++) {
        regRootOf.bits[i] <== regBits.out[i];
        regRootOf.siblings[i] <== regPath[i];
    }
    regRootOf.root === registryRoot;

    // the ring's owner hash
    component npk = Poseidon(1);
    npk.inputs[0] <== nk;
    component owner = Poseidon(2);
    owner.inputs[0] <== ownerId;
    owner.inputs[1] <== npk.out;

    // the escrow: R = r·B8 is public, S = r·K is the shared point
    component rBits = Num2Bits(253);
    rBits.in <== r;
    var BASE8[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];
    component eph = EscalarMulFix(253, BASE8);
    for (var i = 0; i < 253; i++) {
        eph.e[i] <== rBits.out[i];
    }
    eph.out[0] === ephX;
    eph.out[1] === ephY;
    component sharedPt = EscalarMulAny(254);
    for (var i = 0; i < 253; i++) {
        sharedPt.e[i] <== rBits.out[i];
    }
    sharedPt.e[253] <== 0;
    sharedPt.p[0] <== escrowX;
    sharedPt.p[1] <== escrowY;

    component notes[N];
    var total = 0;
    for (var i = 0; i < N; i++) {
        notes[i] = Note(STATE_H, NULL_H, TAG_DOMAIN, ESC_DOMAIN, i);
        notes[i].enabled <== enabled[i];
        notes[i].ownerHash <== owner.out;
        notes[i].nk <== nk;
        notes[i].assetHash <== assetHash;
        notes[i].stateRoot <== stateRoot;
        notes[i].nullRoot <== nullRoot;
        notes[i].shared[0] <== sharedPt.out[0];
        notes[i].shared[1] <== sharedPt.out[1];
        notes[i].amount <== amount[i];
        notes[i].blinding <== blinding[i];
        notes[i].dataHash <== dataHash[i];
        notes[i].ringTerm <== ringTerm[i];
        notes[i].leafIndex <== leafIndex[i];
        for (var j = 0; j < STATE_H; j++) {
            notes[i].statePath[j] <== statePath[i][j];
        }
        notes[i].lowValue <== lowValue[i];
        notes[i].nextValue <== nextValue[i];
        notes[i].lowIndex <== lowIndex[i];
        for (var j = 0; j < NULL_H; j++) {
            notes[i].nullPath[j] <== nullPath[i][j];
        }
        notes[i].tag === tag[i];
        notes[i].ct === ct[i];
        total += notes[i].value;
    }

    // the sum reaches the minimum (four u64 amounts stay below 2^66)
    component enough = GreaterEqThan(66);
    enough.in[0] <== total;
    enough.in[1] <== minAmount;
    enough.out === 1;
}

component main {public [stateRoot, nullRoot, assetHash, minAmount, ctx, escrowX, escrowY, ephX, ephY, tag, ct, registryRoot]} = ProofOfFunds(4, 32, 40, 20);
