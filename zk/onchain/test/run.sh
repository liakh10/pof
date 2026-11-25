#!/bin/zsh
# The on-chain suite of certify_zk against pof/program itself: certify_zk is merged there behind the cargo feature `zk`
# (cd51f22, 1c02f89), so nothing is patched any more (onchain/apply.py and patch/ are the history of that merge).
# It copies the COMMITTED program (git HEAD, never another agent's work in progress) into $POF_ZK_OUT/program, builds it there
# with `--features zk,quick` into its own target (pof/program/target is never touched), uses the zk build's IDL
# (program/idl/pof-zk.json as built), and runs zk-chain.mjs on its own validator (ports 46899..). At most 3 validators.
#   zsh onchain/test/run.sh                 build from HEAD, then run
#   zsh onchain/test/run.sh --no-build      run against what $POF_ZK_OUT/program already holds (program/test/zk.sh prepares it)
set -euo pipefail
ZK=${0:A:h}/../..
ZK=${ZK:A}
POF=${ZK:h}
OUT=${POF_ZK_OUT:-/private/tmp/claude-501/-Users-artem-Desktop-sol/be802bf9-e299-4d83-b38b-bc795e5cbb1e/scratchpad/pof-zk}
P=$OUT/program
export POF_ZK_OUT=$OUT
mkdir -p $P
if [[ "${1:-}" != "--no-build" ]]; then
  SRC=$OUT/program-head; rm -rf $SRC; mkdir -p $SRC
  git -C $POF archive HEAD program | tar -x -C $SRC
  echo "program at $(git -C $POF log -1 --format=%h -- program)"
  rsync -a --delete --exclude target --exclude node_modules --exclude 'test/.run' --exclude test-ledger $SRC/program/ $P/
  [[ -e $P/node_modules ]] || ln -s $POF/program/node_modules $P/node_modules
  mkdir -p $P/target/deploy
  cp $POF/program/target/deploy/pof-keypair.json $POF/program/target/deploy/pof_gate-keypair.json $P/target/deploy/ 2>/dev/null || true
  (cd $P && anchor build -p pof -- --features zk,quick 2>&1 | grep -E "^error|warning: unused|Finished" | tail -20)
  cp $P/target/idl/pof.json $P/idl/pof.json
  node -e 'const i=require(process.argv[1]); if (!i.instructions.some(x => x.name === "certify_zk")) { console.log("the build has no certify_zk: the zk feature did not apply"); process.exit(1) }' $P/idl/pof.json
  ls -la $P/target/deploy/pof.so
fi
cp $ZK/onchain/test/zk-chain.mjs $P/test/zk-chain.mjs
cd $P && POF_ZK=$ZK node test/zk-chain.mjs
