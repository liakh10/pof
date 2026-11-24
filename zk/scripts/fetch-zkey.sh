#!/bin/zsh
# Gets the proving key of the development ceremony and checks it: downloads setup/pof_final.zkey.gz from the public repo,
# pinned to the commit that added it (d7f850b, never `main`), or from POF_ZKEY_URL if set (a later key, e.g. a release asset
# from scripts/publish-zkey-release.sh after a public ceremony). Checks the sha256 of the download against setup/ZKEY.sha256,
# then unpacks it and checks the unpacked key (scripts/unpack-zkey.sh). POF_ZKEY_LOCAL=1 skips the download and uses the copy in git.
# Run: zsh scripts/fetch-zkey.sh
set -euo pipefail
cd ${0:A:h}/..
PINNED=https://raw.githubusercontent.com/liakh10/pof/d7f850b1c1700010c1cbfb61e02c7835983bc77c/zk/setup/pof_final.zkey.gz
if [[ -z "${POF_ZKEY_LOCAL:-}" ]]; then
  curl -fL --retry 3 -o setup/pof_final.zkey.gz.part "${POF_ZKEY_URL:-$PINNED}"
  mv setup/pof_final.zkey.gz.part setup/pof_final.zkey.gz
fi
want_gz=$(awk '$2=="pof_final.zkey.gz"{print $1}' setup/ZKEY.sha256)
got_gz=$(shasum -a 256 setup/pof_final.zkey.gz | cut -d' ' -f1)
[[ "$want_gz" == "$got_gz" ]] || { echo "pof_final.zkey.gz sha256 $got_gz, want $want_gz"; exit 1; }
zsh scripts/unpack-zkey.sh
