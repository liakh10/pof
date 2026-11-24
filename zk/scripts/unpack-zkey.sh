#!/bin/zsh
# setup/pof_final.zkey.gz (in git, 38.5 MB) -> setup/pof_final.zkey (57.7 MB, not in git), checked against the sha256 in
# setup/TRANSCRIPT.md. Node tests and the program's vk.rs need exactly this key. Run: zsh scripts/unpack-zkey.sh
set -euo pipefail
cd ${0:A:h}/..
gunzip -c setup/pof_final.zkey.gz > setup/pof_final.zkey
want=$(grep -m1 '`pof_final.zkey`' setup/TRANSCRIPT.md | grep -oE '[0-9a-f]{64}')
got=$(shasum -a 256 setup/pof_final.zkey | cut -d' ' -f1)
[[ "$want" == "$got" ]] || { echo "pof_final.zkey sha256 $got, the transcript says $want"; exit 1; }
echo "setup/pof_final.zkey ok ($got)"
