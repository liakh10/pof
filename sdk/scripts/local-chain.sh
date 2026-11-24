#!/bin/zsh
# A local validator with this build of pof and pof_gate (upgradeable, a throwaway upgrade authority), on devx's own ports,
# then the integration suite against it, then stop. Never starts a 4th validator on the machine.
#   zsh sdk/scripts/local-chain.sh            (from the repo root or anywhere)
set -e
here=${0:A:h}
root=${here:h:h}
run=${POF_DEVX_RUN:-${TMPDIR:-/tmp}/pof-devx}
mkdir -p $run
n=$(pgrep -x solana-test-validator | wc -l | tr -d ' ')
if (( n >= 3 )); then echo "$n validators already run on this machine (limit 3): not starting"; exit 2; fi
# the first port block nobody listens on: rpc, websocket (rpc+1), faucet (rpc+1001), gossip and dynamic ports below rpc
busy() { lsof -nP -iTCP:$1 -sTCP:LISTEN >/dev/null 2>&1 || lsof -nP -iUDP:$1 >/dev/null 2>&1; }
rpc_port=
for base in 46899 41899 43899 37899 33899; do
  ok=1
  for p in $base $((base+1)) $((base+1001)) $((base-899)) $((base-799)) $((base-700)) $((base-600)); do busy $p && ok=0; done
  (( ok )) && { rpc_port=$base; break; }
done
[[ -n $rpc_port ]] || { echo "no free port block"; exit 1; }
[[ -f $run/authority.json ]] || solana-keygen new --no-bip39-passphrase -s -o $run/authority.json >/dev/null
extra=()
# POF_EXTRA_PROGRAMS="<id>=<path to .so> ...": more programs to load (the examples use it)
for pair in ${=POF_EXTRA_PROGRAMS}; do extra+=(--bpf-program ${pair%%=*} ${pair#*=}); done
pof_id=$(solana-keygen pubkey $root/program/target/deploy/pof-keypair.json)
gate_id=$(solana-keygen pubkey $root/program/target/deploy/pof_gate-keypair.json)
solana-test-validator --reset --quiet --ledger $run/ledger --limit-ledger-size 10000000 \
  --rpc-port $rpc_port --faucet-port $((rpc_port+1001)) --gossip-port $((rpc_port-899)) --dynamic-port-range $((rpc_port-799))-$((rpc_port-600)) --ticks-per-slot 16 \
  --upgradeable-program $pof_id $root/program/target/deploy/pof.so $run/authority.json \
  --upgradeable-program $gate_id $root/program/target/deploy/pof_gate.so $run/authority.json $extra &
vpid=$!
trap 'kill $vpid 2>/dev/null; wait $vpid 2>/dev/null; rm -rf $run/ledger' EXIT
for i in {1..60}; do
  curl -s -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' http://127.0.0.1:$rpc_port | grep -q ok && break
  sleep 1
done
POF_LOCAL_RPC=http://127.0.0.1:$rpc_port POF_AUTHORITY=$run/authority.json node --test --test-timeout=300000 ${POF_TESTS:-$root/sdk/test/integration/}
