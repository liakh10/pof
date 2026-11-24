#!/bin/zsh
# Gets the proving key and checks it: setup/pof_final.zkey.gz from POF_ZKEY_URL (for example a release asset of liakh10/pof,
# tag zk-dev-ceremony-1, once it is published) or, without a URL, the copy in git; then unpacks it and checks both sha256 values
# against setup/ZKEY.sha256 (and the transcript). Run: zsh scripts/fetch-zkey.sh
set -euo pipefail
cd ${0:A:h}/..
if [[ -n "${POF_ZKEY_URL:-}" ]]; then curl -fL --retry 3 -o setup/pof_final.zkey.gz "$POF_ZKEY_URL"; fi
want_gz=$(awk '$2=="pof_final.zkey.gz"{print $1}' setup/ZKEY.sha256)
got_gz=$(shasum -a 256 setup/pof_final.zkey.gz | cut -d' ' -f1)
[[ "$want_gz" == "$got_gz" ]] || { echo "pof_final.zkey.gz sha256 $got_gz, want $want_gz"; exit 1; }
zsh scripts/unpack-zkey.sh
