#!/bin/zsh
# The fuzzer's own local validator: RPC 52899 (ws 52900), faucet 53900, gossip 52000, dynamic 52100-52300, ledger in the scratchpad.
# Loads the Privacy Program binary (the suite's dump), the genesis accounts of fuzz/prep.mjs, and the snapshot build of
# fuzz/build.sh: pof, pof_gate (quick feature) and hostile, upgradeable, with $SCRATCH/authority.json as their upgrade authority.
# Never starts while 3 validators already run on the machine. Only the validator whose PID this script wrote is ever stopped.
#   zsh fuzz/chain.sh          start fresh        zsh fuzz/chain.sh stop        (stop also deletes the ledger)
set -e
here=${0:A:h}
S=${FUZZ_SCRATCH:-/private/tmp/claude-501/-Users-artem-Desktop-sol/be802bf9-e299-4d83-b38b-bc795e5cbb1e/scratchpad/pof-fuzz}
base=52899; faucet=53900; gossip=52000
pidfile=$S/validator.pid
led=$S/ledger
busy() { { lsof -nP -iTCP:$base -iTCP:$((base+1)) -iTCP:$faucet -sTCP:LISTEN || lsof -nP -iUDP:$gossip; } >/dev/null 2>&1; }
halt() {
  [[ -f $pidfile ]] || return 0
  local pid=$(cat $pidfile)
  if ps -o args= -p $pid 2>/dev/null | grep -q -- "--ledger $led "; then
    kill $pid 2>/dev/null || true
    for i in {1..40}; do kill -0 $pid 2>/dev/null || break; sleep 0.5; done
    kill -0 $pid 2>/dev/null && kill -9 $pid 2>/dev/null || true
  fi
  rm -f $pidfile
  for i in {1..60}; do busy || break; sleep 1; done
}
halt
if [[ $1 == stop ]]; then rm -rf $led; exit 0; fi
[[ -f /Users/artem/Desktop/sol/_x/pof/STOP ]] && { echo "STOP file present"; exit 1; }
n=$(pgrep -x solana-test-validator | wc -l | tr -d ' ')
(( n < 3 )) || { echo "$n validators already run on this machine: not starting"; exit 2; }
busy && { echo "ports $base/$faucet/$gossip in use: not starting"; exit 1; }
[[ -f $S/so/pof.so && -d $S/accounts ]] || { echo "run zsh fuzz/build.sh and node fuzz/prep.mjs first"; exit 1; }
[[ -f $S/authority.json ]] || solana-keygen new --no-bip39-passphrase -s -o $S/authority.json >/dev/null
rm -rf $led
args=(--reset --quiet --ledger $led --limit-ledger-size 5000000 --rpc-port $base --faucet-port $faucet --gossip-port $gossip --dynamic-port-range 52100-52300 --ticks-per-slot ${FUZZ_TICKS:-16})
# the program suite's clones (read-only use of pof/program/test/.run): Rings and pump.fun binaries, its accounts (spent PDAs,
# look-alikes, tree 0 with the real nullifier roots), so the suite itself can also run on this chain; then the fuzzer's own accounts
sr=$here/../program/test/.run
for p in $(cat $sr/programs.txt); do [[ -s $sr/programs/$p.so ]] && args+=(--upgradeable-program $p $sr/programs/$p.so none); done
for f in $sr/accounts/*.json(N); do [[ -f $S/accounts/${f:t} ]] || args+=(--account ${f:t:r} $f); done
for f in $S/accounts/*.json(N); do args+=(--account ${f:t:r} $f); done
[[ -z $FUZZ_BARE ]] && for f in $S/accounts-genesis/*.json(N); do args+=(--account ${f:t:r} $f); done
args+=(--upgradeable-program pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT $S/so/pof.so $S/authority.json)
args+=(--upgradeable-program gatSToJMD8ZPLa85fKj6seYHUtYx4ah3ptZvLkisLPU $S/so/pof_gate.so $S/authority.json)
args+=(--upgradeable-program $(grep -o 'declare_id!("[A-Za-z0-9]*")' $here/hostile/src/lib.rs | cut -d'"' -f2) $S/so/hostile.so $S/authority.json)
nohup solana-test-validator $args > $S/validator.log 2>&1 &
echo $! > $pidfile
for i in {1..180}; do
  if solana -u http://127.0.0.1:$base cluster-version >/dev/null 2>&1; then echo "fuzz validator up on 127.0.0.1:$base (pid $(cat $pidfile))"; exit 0; fi
  kill -0 $(cat $pidfile) 2>/dev/null || break
  sleep 1
done
rm -f $pidfile; echo "validator did not start"; tail -20 $S/validator.log; exit 1
