#!/bin/zsh
# The on-chain suite of certify_zk: copies pof/program (read-only use) into $POF_ZK_OUT/program, applies onchain/apply.py,
# builds the quick binary, refreshes the copy's IDL, and runs zk-chain.mjs on its own validator (ports 52899..). Nothing in
# pof/program changes. Run: zsh onchain/test/run.sh   [--no-build]
set -euo pipefail
ZK=${0:A:h}/../..
ZK=${ZK:A}
OUT=${POF_ZK_OUT:-/Users/artem/Desktop/sol/scratchpad/pof-zk}
P=$OUT/program
mkdir -p $P
if [[ "${1:-}" != "--no-build" ]]; then
  rsync -a --delete --exclude target --exclude node_modules --exclude 'test/.run' --exclude test-ledger /Users/artem/Desktop/sol/pof/program/ $P/
  [[ -e $P/node_modules ]] || ln -s /Users/artem/Desktop/sol/pof/program/node_modules $P/node_modules
  python3 $ZK/onchain/apply.py $P
  (cd $P && anchor build -p pof -- --features quick 2>&1 | grep -E "error|warning: unused|Finished" | tail -20)
  cp $P/target/idl/pof.json $P/idl/pof.json
  ls -la $P/target/deploy/pof.so
fi
cp $ZK/onchain/test/zk-chain.mjs $P/test/zk-chain.mjs
[[ -e $P/test/node_modules ]] || true
cd $P && POF_ZK=$ZK node test/zk-chain.mjs
