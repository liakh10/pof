#!/bin/zsh
# Build the example if needed, then run its test on a local validator with pof, pof_gate and otc_desk loaded.
set -e
here=${0:A:h}
ex=${here:h}
root=${ex:h:h}
[[ -f $ex/target/deploy/otc_desk.so ]] || (cd $ex && anchor build)
id=$(grep -o 'declare_id!("[^"]*")' $ex/programs/otc_desk/src/lib.rs | sed 's/declare_id!("//;s/")//')
POF_EXTRA_PROGRAMS="$id=$ex/target/deploy/otc_desk.so" POF_TESTS=$here/otc.test.mjs zsh $root/sdk/scripts/local-chain.sh
