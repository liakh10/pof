#!/bin/zsh
# The validator ports of the POF program (RPC 50899, websocket 50900, faucet 51900, gossip 50000, dynamic 50100-50300) are shared by its
# suite, rehearsal, own-ca and close tests: whoever runs a chain holds this lock (a directory made atomically, its owner file names the
# runner). Machine rule: at most 3 validators on the whole machine, so take_lock also waits while 3 or more run (pgrep -x).
LOCK=/private/tmp/claude-501/-Users-artem-Desktop-sol/be802bf9-e299-4d83-b38b-bc795e5cbb1e/scratchpad/pof-program/validator.lock
export CC_LEDGERS=${CC_LEDGERS:-/private/tmp/claude-501/-Users-artem-Desktop-sol/be802bf9-e299-4d83-b38b-bc795e5cbb1e/scratchpad/pof-program}   # ledgers live in the scratchpad, deleted after each run
take_lock() {
  local wait=8
  mkdir -p ${LOCK:h}
  until mkdir $LOCK 2>/dev/null; do
    echo "validator ports held by $(cat $LOCK/owner 2>/dev/null || echo '?'): waiting $wait s"
    sleep $wait
    (( wait < 60 )) && wait=$((wait * 2 > 60 ? 60 : wait * 2))
  done
  echo pof-program > $LOCK/owner
  local n=0
  while (( $(pgrep -x solana-test-validator | wc -l) >= 3 )); do
    (( n++ % 12 == 0 )) && echo "3 validators already run on this machine: waiting (checks every 5 s)"
    sleep 5
  done
}
drop_lock() {
  [[ "$(cat $LOCK/owner 2>/dev/null)" == pof-program ]] && rm -r $LOCK
  return 0
}
