#!/bin/zsh
# A local validator with Helius Privacy Rings cloned from mainnet (RINGS.md §8). Usage:
#   zsh lab/rings-local/chain.sh [start|stop] [extra solana-test-validator args…]
# Ports: RPC 35899, websocket 35900, faucet 36900, gossip 35000, dynamic 35100-35300. Ledger under the session scratchpad.
# Machine rule: at most 3 validators at once (counted with pgrep -x). Only the validator whose PID this script wrote is stopped.
# Extra programs (the pof program under test): POF_PROGRAMS="<id>=<so>[=<upgrade authority json>] …"
# Extra accounts (a simulated spent nullifier PDA, for revoke tests): POF_ACCOUNTS="<file.json> …"
set -e
here=${0:A:h}
run=$here/.run
led=${POF_LEDGER_DIR:-/private/tmp/claude-501/-Users-artem-Desktop-sol/be802bf9-e299-4d83-b38b-bc795e5cbb1e/scratchpad/pof-rings}
pidfile=$run/validator.pid
rpc=http://127.0.0.1:35899
mkdir -p $led
if [[ $1 == stop ]]; then
  if [[ -f $pidfile ]] && kill -0 $(cat $pidfile) 2>/dev/null; then kill $(cat $pidfile); sleep 2; fi
  rm -f $pidfile; rm -rf $led/ledger; echo "stopped"; exit 0
fi
[[ $1 == start ]] && shift
if [[ -f $pidfile ]] && kill -0 $(cat $pidfile) 2>/dev/null; then echo "already up on $rpc (pid $(cat $pidfile))"; exit 0; fi
(( $(pgrep -x solana-test-validator | wc -l) >= 3 )) && { echo "3 validators already run on this machine: not starting"; exit 1; }
[[ -d $run/accounts ]] || { echo "run node lab/rings-local/prep.mjs first"; exit 1; }
args=(--reset --quiet --ledger $led/ledger --rpc-port 35899 --faucet-port 36900 --gossip-port 35000 --dynamic-port-range 35100-35300 --limit-ledger-size 5000000)
[[ -s $run/warp-slot.txt ]] && args+=(--warp-slot $(cat $run/warp-slot.txt))
for so in $run/programs/*.so(N); do args+=(--upgradeable-program ${so:t:r} $so none); done
for f in $run/accounts/*.json(N); do args+=(--account ${f:t:r} $f); done
for f in ${=POF_ACCOUNTS}; do args+=(--account $(node -e "console.log(JSON.parse(require('fs').readFileSync('$f','utf8')).pubkey)") $f); done
for p in ${=POF_PROGRAMS}; do parts=(${(s:=:)p}); args+=(--upgradeable-program $parts[1] $parts[2] ${parts[3]:-none}); done
nohup solana-test-validator $args "$@" > $run/validator.log 2>&1 &
echo $! > $pidfile
for i in {1..120}; do
  if solana -u $rpc cluster-version >/dev/null 2>&1; then echo "validator up on $rpc (pid $(cat $pidfile))"; exit 0; fi
  kill -0 $(cat $pidfile) 2>/dev/null || break
  sleep 1
done
echo "validator did not start"; tail -20 $run/validator.log; exit 1
