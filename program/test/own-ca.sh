#!/bin/zsh
# The owner's-own-CA launch on a fresh local clone: see test/own-ca.mjs. Takes the validator lock (the POF program ports), runs on the
# "site" chain (no program loaded: launch.mjs deploys the launch build through sol-ops, as on launch day), releases the lock.
# Needs node test/prep.mjs once and zsh test/build.sh.
set -e
here=${0:A:h}
cd $here/..
source $here/lock.sh
mkdir -p $here/.run
[[ -f /Users/artem/Desktop/sol/_x/pof/STOP ]] && { echo "STOP file present: not running"; exit 1; }
take_lock
cleanup() { CC_CHAIN=site zsh test/chain.sh stop; rm -rf ${CC_LEDGERS:-$here/.run}/ledger-site; drop_lock; }
trap cleanup EXIT
rm -f $here/.run/own-ca.txt
rm -rf ${CC_LEDGERS:-$here/.run}/ledger-site
up=0
for i in 1 2 3; do CC_TICKS=16 CC_CHAIN=site zsh test/chain.sh && { up=1; break; }; CC_CHAIN=site zsh test/chain.sh stop; sleep 10; done
(( up )) || { echo "the local chain did not start"; exit 1; }
node test/own-ca.mjs 2>&1 | tee $here/.run/own-ca.log || true
r=$(cat $here/.run/own-ca.txt 2>/dev/null || echo 0/1)
echo "pof own-ca $r"
[[ ${r%/*} -eq ${r#*/} ]]
