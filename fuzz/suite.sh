#!/bin/zsh
# Re-runs the program's OWN suites (pof/program/test: test.mjs then closing.mjs, which winds everything down and closes the
# programs) against the fuzzer's snapshot build, on a fresh fuzz chain (fuzz/chain.sh), from a copy in the scratchpad so the
# program agent's tree is never written to. The copy gets the snapshot IDLs and the fuzz upgrade authority. Results are appended
# to fuzz/results/suite-runs.txt; the logs go to fuzz/results/suite-<n>.log.
#   zsh fuzz/suite.sh [runs=2]
set -e
here=${0:A:h}
P=$here/../program
S=${FUZZ_SCRATCH:-/private/tmp/claude-501/-Users-artem-Desktop-sol/be802bf9-e299-4d83-b38b-bc795e5cbb1e/scratchpad/pof-fuzz}
C=$S/suite
runs=${1:-2}
for r in $(seq 1 $runs); do
  rm -rf $C && mkdir -p $C/idl
  # the suite of the same commit the snapshot was built from (the program agent's working tree may be ahead of it)
  ref=$(node -e 'console.log(require(process.argv[1]).ref)' $here/results/snapshot.json)
  if [[ $ref != "working tree" ]]; then
    ( cd $P/.. && git archive $ref program/test program/js program/wind-down.mjs program/ops.mjs program/PROGRAM_ID.txt program/GATE_ID.txt program/PROGRAM_DATA.txt program/package.json ) | tar -x -C $C --strip-components 1
  else
    rsync -a --exclude '.run' $P/test/ $C/test/ && cp -R $P/js $C/js
    cp $P/wind-down.mjs $P/PROGRAM_ID.txt $P/GATE_ID.txt $P/PROGRAM_DATA.txt $P/package.json $C/
    [[ -f $P/ops.mjs ]] && cp $P/ops.mjs $C/
  fi
  rsync -a --exclude 'ledger*' --exclude 'validator*' $P/test/.run/ $C/test/.run/
  cp $S/idl/pof.json $S/idl/pof_gate.json $C/idl/
  ln -s $P/node_modules $C/node_modules
  # wind-down.mjs closes the programs through sol-ops, which stages target/deploy/*.so: the snapshot's binaries
  mkdir -p $C/target/deploy && cp $S/so/pof.so $S/so/pof_gate.so $C/target/deploy/
  cp $S/authority.json $C/test/.run/authority.json
  rm -f $C/test/.run/result-*.txt(N)
  FUZZ_BARE=1 zsh $here/chain.sh
  log=$here/results/suite-$r.log
  { RPC_URL=http://127.0.0.1:52899 perl -e 'alarm shift; exec @ARGV' ${SUITE_TIMEOUT:-1200} node $C/test/test.mjs || echo "  (test.mjs stopped: exit $?, timeout ${SUITE_TIMEOUT:-1200} s)"; RPC_URL=http://127.0.0.1:52899 perl -e 'alarm shift; exec @ARGV' 900 node $C/test/closing.mjs; } 2>&1 | tee $log || true
  zsh $here/chain.sh stop
  line="$(date '+%Y-%m-%d %H:%M:%S') snapshot=$(node -e 'console.log(require(process.argv[1]).sources["programs/pof/src/lib.rs"].slice(0,12))' $here/results/snapshot.json) suite=$(cat $C/test/.run/result-suite.txt 2>/dev/null || echo '?') closing=$(cat $C/test/.run/result-closing.txt 2>/dev/null || echo '?')"
  echo $line | tee -a $here/results/suite-runs.txt
done
rm -rf $C
