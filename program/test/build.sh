#!/bin/zsh
# Both binaries of each program: target/quick/*.so (the validity floor lowered to 10 slots and the rotation delay floor to 5, so the
# suite expires and rotates in seconds; test/all.sh runs it) and target/deploy/*.so (the launch build: validity floor 216,000 slots,
# rotation 9,000; the rehearsal, own-ca and launch deploy it). The launch build is made last, so target/deploy always holds what
# sol-ops deploys, and program/idl is refreshed from it. Waits while the disk is under 20 GB.
set -e
cd ${0:A:h}/..
for i in {1..36}; do
  free=$(df -k / | awk 'NR==2{print $4}')
  (( free >= 20000000 )) && break
  echo "under 20 GB free on the disk ($free KB): waiting 5 minutes"; sleep 300
done
(( free >= 20000000 )) || { echo "still under 20 GB free: not building"; exit 1; }
anchor build -- --features quick
mkdir -p target/quick
cp target/deploy/pof.so target/deploy/pof_gate.so target/quick/
anchor build
cmp -s target/quick/pof.so target/deploy/pof.so && { echo "the two builds are identical: the quick feature did not apply"; exit 1; }
mkdir -p idl/types
cp target/idl/pof.json target/idl/pof_gate.json idl/
cp target/types/*.ts idl/types/
echo "built: target/quick (suite) and target/deploy (launch): pof $(stat -f %z target/deploy/pof.so) bytes, pof_gate $(stat -f %z target/deploy/pof_gate.so) bytes; idl/ refreshed"
