#!/bin/zsh
# For the repo owner (it publishes a public file): uploads setup/pof_final.zkey.gz as a GitHub Release asset of liakh10/pof,
# tag zk-dev-ceremony-1, marked as a DEVELOPMENT ceremony and a pre-release. Future key rotations get their own tag and
# setup/ZKEY.sha256 entry instead of another large file in git. Run: zsh scripts/publish-zkey-release.sh
set -euo pipefail
cd ${0:A:h}/..
TAG=${1:-zk-dev-ceremony-1}
shasum -a 256 -c setup/ZKEY.sha256 --ignore-missing
gh release create $TAG setup/pof_final.zkey.gz setup/verification_key.json --repo liakh10/pof --prerelease \
  --title "zk development ceremony 1 (NOT for mainnet)" \
  --notes "Development trusted setup of the POF phase 2 circuit, made on one machine: whoever ran it could forge proofs for this key. Local tests and devnet only. Transcript: zk/setup/TRANSCRIPT.md. sha256: $(cat setup/ZKEY.sha256 | tr '\n' ' ')"
echo "then: POF_ZKEY_URL=https://github.com/liakh10/pof/releases/download/$TAG/pof_final.zkey.gz zsh scripts/fetch-zkey.sh"
