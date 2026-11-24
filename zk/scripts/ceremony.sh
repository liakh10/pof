#!/bin/zsh
# The DEVELOPMENT trusted setup of the POF circuit: a local Powers of Tau (BN254, 2^17) and a Groth16 phase 2 for build/pof.r1cs.
# Two random contributions in each phase (entropy from /dev/urandom, never written anywhere) and a final public beacon (a
# finalized Solana mainnet blockhash, read-only RPC). Every step is verified with snarkjs and the transcript, with every
# contribution hash, lands in setup/TRANSCRIPT.md. Only the final zkey, the verification key and the transcript are kept in git;
# the ptau files (about 150 MB) stay in $OUT.
#
# This setup is for development and devnet only: one machine made every contribution, so whoever ran it could keep the toxic
# waste. Mainnet needs the public ceremony in docs (Perpetual Powers of Tau for phase 1, an open phase 2 with outside
# contributors). Run: zsh scripts/ceremony.sh   (after scripts/build.sh)
set -euo pipefail
HERE=${0:A:h}/..
cd $HERE
OUT=${POF_ZK_OUT:-/Users/artem/Desktop/sol/scratchpad/pof-zk}
B=$OUT/build
C=$OUT/ceremony
mkdir -p $C setup
SNARK="node --max-old-space-size=6144 node_modules/snarkjs/build/cli.cjs"
POW=17
LOG=$C/phase1.log
ent() { head -c 64 /dev/urandom | xxd -p | tr -d '\n'; }
step() { print -r -- "\n## $1" >> $LOG; shift; print -r -- "\$ ${(j: :)@}" | sed -E 's/-e=[0-9a-f]+/-e=<64 random bytes, discarded>/' >> $LOG; "$@" 2>&1 | sed -E 's/\x1b\[[0-9;]*m//g' >> $LOG; }

# the public beacon: a finalized mainnet slot and its blockhash (anyone can read the same block again)
if [[ -z "${BEACON_SLOT:-}" ]]; then
  BEACON_SLOT=$(curl -s https://api.mainnet-beta.solana.com -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getSlot","params":[{"commitment":"finalized"}]}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result-64))')
fi
BEACON_HASH58=$(curl -s https://api.mainnet-beta.solana.com -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBlock\",\"params\":[$BEACON_SLOT,{\"transactionDetails\":\"none\",\"rewards\":false,\"maxSupportedTransactionVersion\":0}]}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.blockhash))')
BEACON_HEX=$(node -e 'const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";let x=0n;for(const c of process.argv[1])x=x*58n+BigInt(A.indexOf(c));console.log(require("crypto").createHash("sha256").update(Buffer.from(x.toString(16).padStart(64,"0"),"hex")).digest("hex"))' $BEACON_HASH58)

T0=$SECONDS
# phase 1 (circuit independent: kept and reused when pot_final.ptau exists, so a circuit change redoes phase 2 only)
if [[ ! -f $C/pot_final.ptau ]]; then
: > $LOG
print -r -- "beacon: mainnet slot $BEACON_SLOT blockhash $BEACON_HASH58 -> sha256(blockhash bytes) = $BEACON_HEX, 2^10 iterations" >> $LOG
step "phase 1: new" $=SNARK powersoftau new bn128 $POW $C/pot_0000.ptau
step "phase 1: contribution 1" $=SNARK powersoftau contribute $C/pot_0000.ptau $C/pot_0001.ptau --name="pof-zk dev contribution 1" -e=$(ent)
step "phase 1: contribution 2" $=SNARK powersoftau contribute $C/pot_0001.ptau $C/pot_0002.ptau --name="pof-zk dev contribution 2" -e=$(ent)
step "phase 1: beacon" $=SNARK powersoftau beacon $C/pot_0002.ptau $C/pot_beacon.ptau $BEACON_HEX 10 -n="mainnet blockhash beacon slot $BEACON_SLOT"
step "phase 1: prepare phase 2" $=SNARK powersoftau prepare phase2 $C/pot_beacon.ptau $C/pot_final.ptau
step "phase 1: verify" $=SNARK powersoftau verify $C/pot_final.ptau
rm -f $C/pot_0000.ptau $C/pot_0001.ptau $C/pot_0002.ptau
print -r -- "\nseconds: $((SECONDS - T0))" >> $LOG
[[ -n "${PHASE1_ONLY:-}" ]] && exit 0
fi
# phase 2
T0=$SECONDS
LOG=$C/phase2.log
: > $LOG
print -r -- "beacon: mainnet slot $BEACON_SLOT blockhash $BEACON_HASH58 -> sha256(blockhash bytes) = $BEACON_HEX, 2^10 iterations" >> $LOG
step "phase 2: groth16 setup" $=SNARK groth16 setup $B/pof.r1cs $C/pot_final.ptau $C/pof_0000.zkey
step "phase 2: contribution 1" $=SNARK zkey contribute $C/pof_0000.zkey $C/pof_0001.zkey --name="pof-zk dev phase2 contribution 1" -e=$(ent)
step "phase 2: contribution 2" $=SNARK zkey contribute $C/pof_0001.zkey $C/pof_0002.zkey --name="pof-zk dev phase2 contribution 2" -e=$(ent)
step "phase 2: beacon" $=SNARK zkey beacon $C/pof_0002.zkey $C/pof_final.zkey $BEACON_HEX 10 -n="mainnet blockhash beacon slot $BEACON_SLOT"
step "phase 2: verify against the r1cs and the ptau" $=SNARK zkey verify $B/pof.r1cs $C/pot_final.ptau $C/pof_final.zkey
step "export the verification key" $=SNARK zkey export verificationkey $C/pof_final.zkey $C/verification_key.json
rm -f $C/pof_0000.zkey $C/pof_0001.zkey $C/pof_0002.zkey
print -r -- "\nseconds: $((SECONDS - T0))" >> $LOG
node scripts/transcript.mjs $C $B $BEACON_SLOT $BEACON_HASH58 $BEACON_HEX
