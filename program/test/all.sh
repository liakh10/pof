#!/bin/zsh
# One full run: the programs' unit tests (the attestation layout, base58 and subject hashes, the tier tables, the rotation rule, the
# nullifier-tree membership against a real mainnet path; no chain), then the validator lock, a fresh local chain (16 ticks a slot, the
# quick build), the suite (test.mjs), the wind-down with live state (closing.mjs), the chain stopped by its PID, its ledger deleted,
# the lock released. Needs `zsh test/build.sh` and `node test/prep.mjs` first. Run it twice for the record: each run appends a line to
# .run/runs.txt.
set -e
here=${0:A:h}
cd $here/..
source $here/lock.sh
mkdir -p $here/.run
[[ -f /Users/artem/Desktop/sol/_x/pof/STOP ]] && { echo "STOP file present: not running"; exit 1; }
take_lock
stopchain() { zsh test/chain.sh stop; rm -rf ${CC_LEDGERS:-$here/.run}/ledger; drop_lock; }
trap stopchain EXIT
rm -f $here/.run/result-*.txt(N)
rm -rf ${CC_LEDGERS:-$here/.run}/ledger
out=$(cargo test --lib 2>&1 | grep -E 'test result' | awk '{p+=$4; f+=$6} END {print p" "f}')
echo "${out% *}/$(( ${out% *} + ${out#* } ))" > $here/.run/result-unit.txt
CC_TICKS=16 zsh test/chain.sh
node test/test.mjs 2>&1 | tee $here/.run/test.log || true
node test/closing.mjs 2>&1 | tee $here/.run/closing.log || true
for s in unit suite closing; do
  r=$(cat $here/.run/result-$s.txt 2>/dev/null || echo 0/1)
  echo "pof $s $r"
  all="$all $s=$r"
  [[ ${r%/*} -eq ${r#*/} ]] || bad=1
done
echo "$(date '+%Y-%m-%d %H:%M:%S')$all" >> $here/.run/runs.txt
[[ -z $bad ]]
