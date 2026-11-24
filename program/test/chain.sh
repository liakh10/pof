#!/bin/zsh
# The suite's own local chain: the Helius Privacy Rings program and its tree 0 (with its real nullifier root history), pump.fun and the
# programs a pump.fun create touches, cloned from mainnet (test/prep.mjs saved the list in .run/programs.txt and their binaries in
# .run/programs/), the spent-nullifier PDAs prep.mjs made (byte for byte what a real spend leaves), and this build of pof and pof_gate
# loaded as upgradeable programs with test/.run/authority.json as their upgrade authority.
# Ports of the POF program only: RPC 50899 (websocket 50900), faucet 51900, gossip 50000, dynamic 50100-50300.
# Only the validator whose PID this script wrote, running on this ledger, is ever stopped. Callers take the lock first (lock.sh).
#   zsh test/chain.sh              start fresh (target/quick: the quick build, low floors of validity and rotation)
#   zsh test/chain.sh stop
# CC_CHAIN=site starts the same clone without our programs (sol-ops deploys the launch build, as on launch day). CC_TICKS sets ticks
# per slot (the suite runs 16: slots about 4x faster than mainnet's, so expiries and rotation delays pass in seconds).
set -e
here=${0:A:h}
run=$here/.run
sfx=${CC_CHAIN:+-$CC_CHAIN}
base=50899
faucet=51900
gossip=50000
rpc=http://127.0.0.1:$base
mkdir -p $run
led=${CC_LEDGERS:-$run}
mkdir -p $led
pidfile=$run/validator$sfx.pid
busy() { { lsof -nP -iTCP:$base -iTCP:$((base+1)) -iTCP:$faucet -sTCP:LISTEN || lsof -nP -iUDP:$gossip; } >/dev/null 2>&1; }
halt() {
  [[ -f $pidfile ]] || return 0
  local pid=$(cat $pidfile)
  if ps -o args= -p $pid 2>/dev/null | grep -q -- "--ledger $led/ledger$sfx "; then
    kill $pid 2>/dev/null || true
    for i in {1..40}; do kill -0 $pid 2>/dev/null || break; sleep 0.5; done
    kill -0 $pid 2>/dev/null && kill -9 $pid 2>/dev/null || true
  fi
  rm -f $pidfile
  for i in {1..60}; do busy || break; sleep 1; done
}
halt
[[ $1 == stop ]] && exit 0
if busy; then echo "ports $base, $((base+1)), $faucet, $gossip are in use by something else: not starting"; exit 1; fi
for i in {1..36}; do
  free=$(df -k / | awk 'NR==2{print $4}')
  (( free >= 20000000 )) && break
  echo "under 20 GB free on the disk ($free KB): waiting 5 minutes"; sleep 300
done
(( free >= 20000000 )) || { echo "still under 20 GB free: not starting"; exit 1; }
[[ -f $run/programs.txt ]] || { echo "no clones saved: run node test/prep.mjs first"; exit 1; }
ports=(--rpc-port $base --faucet-port $faucet --gossip-port $gossip --dynamic-port-range 50100-50300)
[[ -f $run/authority.json ]] || solana-keygen new --no-bip39-passphrase -s -o $run/authority.json >/dev/null
args=(--reset --quiet --ledger $led/ledger$sfx --limit-ledger-size 20000000 $ports)
[[ -n $CC_TICKS ]] && args+=(--ticks-per-slot $CC_TICKS)
for p in $(cat $run/programs.txt); do
  [[ -s $run/programs/$p.so ]] && args+=(--upgradeable-program $p $run/programs/$p.so none)
done
for f in $run/accounts/*.json(N); do args+=(--account ${f:t:r} $f); done
if [[ -z $CC_CHAIN ]]; then
  for n in pof pof_gate; do
    so=$here/../target/${CC_SO:-quick}/$n.so
    [[ -f $so ]] || so=$here/../target/deploy/$n.so
    id=$(solana-keygen pubkey $here/../target/deploy/$n-keypair.json)
    args+=(--upgradeable-program $id $so $run/authority.json)
  done
fi
nohup solana-test-validator $args > $run/validator$sfx.log 2>&1 &
echo $! > $pidfile
for i in {1..240}; do
  if solana -u $rpc cluster-version >/dev/null 2>&1; then echo "validator up on $rpc (pid $(cat $pidfile))"; exit 0; fi
  kill -0 $(cat $pidfile) 2>/dev/null || break
  sleep 1
done
rm -f $pidfile
echo "validator did not start"; tail -20 $run/validator$sfx.log; exit 1
