#!/bin/zsh
# Phase 2 on this program: zk's own on-chain suite (pof/zk/onchain/test/zk-chain.mjs, real Groth16 proofs from the development setup)
# run against THIS program built with the `zk` feature (target/zk/pof.so, idl/pof-zk.json), in a scratch copy, on zk's own validator
# port (46899). zk's last-run.json is kept as it was; this run's results go to test/.run/zk-last-run.json. Needs zsh test/build.sh.
set -e
here=${0:A:h}
cd $here/..
source $here/lock.sh
export POF_ZK_OUT=${CC_LEDGERS}/zkrun
mkdir -p $POF_ZK_OUT/program
u=$(cargo test --lib -p pof --features zk 2>&1 | grep -E 'test result' | head -1 | sed -E 's/.* ([0-9]+) passed; ([0-9]+) failed.*/\1 \2/')
mkdir -p $here/.run; echo "${u% *}/$(( ${u% *} + ${u#* } ))" > $here/.run/result-unit-zk.txt
echo "pof unit (zk feature) $(cat $here/.run/result-unit-zk.txt)"
while (( $(pgrep -x solana-test-validator | wc -l) >= 3 )); do sleep 5; done
rsync -a --delete --exclude node_modules --exclude 'test/.run' --exclude target ./ $POF_ZK_OUT/program/
mkdir -p $POF_ZK_OUT/program/target/deploy
cp target/zk/pof.so $POF_ZK_OUT/program/target/deploy/pof.so
cp target/quick/pof_gate.so target/deploy/*-keypair.json $POF_ZK_OUT/program/target/deploy/
cp idl/pof-zk.json $POF_ZK_OUT/program/idl/pof.json
ln -sfn $here/../node_modules $POF_ZK_OUT/program/node_modules
keep=$(mktemp); cp ../zk/onchain/test/last-run.json $keep
zsh ../zk/onchain/test/run.sh --no-build > $POF_ZK_OUT/zk.log 2>&1 || true
mkdir -p $here/.run; cp ../zk/onchain/test/last-run.json $here/.run/zk-last-run.json; cp $keep ../zk/onchain/test/last-run.json; rm -f $keep
grep -E "^(ok|FAIL)" $POF_ZK_OUT/zk.log
node -e 'const j=require(process.argv[1]); console.log("pof zk", j.pass + "/" + (j.pass + j.fail)); process.exit(j.fail ? 1 : 0)' $here/.run/zk-last-run.json
rm -rf $POF_ZK_OUT
