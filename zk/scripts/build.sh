#!/bin/zsh
# Compiles circuits/pof.circom with circom 2.2.2 (--O2) into $POF_ZK_OUT/build: the r1cs, the witness wasm, the symbols.
# circom is not in npm: install it once with
#   cargo install --locked --git https://github.com/iden3/circom --tag v2.2.2 circom --root $POF_ZK_OUT/tools
set -euo pipefail
HERE=${0:A:h}/..
cd $HERE
OUT=${POF_ZK_OUT:-/Users/artem/Desktop/sol/scratchpad/pof-zk}
CIRCOM=${CIRCOM:-$OUT/tools/bin/circom}
mkdir -p $OUT/build
$CIRCOM circuits/pof.circom --r1cs --wasm --sym --O2 -o $OUT/build
shasum -a 256 $OUT/build/pof.r1cs
