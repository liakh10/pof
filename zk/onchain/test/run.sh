#!/bin/zsh
# The on-chain suite of certify_zk: copies pof/program (read-only use) into $POF_ZK_OUT/program, applies onchain/apply.py,
# (the committed HEAD of program/), builds the quick binary, refreshes the copy's IDL, and runs zk-chain.mjs on its own validator (ports 46899..). Nothing in
# pof/program changes. Run: zsh onchain/test/run.sh   [--no-build]
set -euo pipefail
ZK=${0:A:h}/../..
ZK=${ZK:A}
OUT=${POF_ZK_OUT:-/Users/artem/Desktop/sol/scratchpad/pof-zk}
P=$OUT/program
mkdir -p $P
if [[ "${1:-}" != "--no-build" ]]; then
  # the committed program (HEAD), never another agent's uncommitted work in progress
  SRC=$OUT/program-head; rm -rf $SRC; mkdir -p $SRC
  git -C /Users/artem/Desktop/sol/pof archive HEAD program | tar -x -C $SRC
  echo "program at $(git -C /Users/artem/Desktop/sol/pof log -1 --format=%h -- program)"
  rsync -a --delete --exclude target --exclude node_modules --exclude 'test/.run' --exclude test-ledger $SRC/program/ $P/
  [[ -e $P/node_modules ]] || ln -s /Users/artem/Desktop/sol/pof/program/node_modules $P/node_modules
  python3 $ZK/onchain/apply.py $P
  (cd $P && anchor build -p pof -- --features quick 2>&1 | grep -E "error|warning: unused|Finished" | tail -20)
  cp $P/target/idl/pof.json $P/idl/pof.json
  ls -la $P/target/deploy/pof.so
fi
cp $ZK/onchain/test/zk-chain.mjs $P/test/zk-chain.mjs
[[ -e $P/test/node_modules ]] || true
cd $P && POF_ZK=$ZK node test/zk-chain.mjs
