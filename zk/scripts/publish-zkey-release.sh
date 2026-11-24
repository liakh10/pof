#!/bin/zsh
# For a FUTURE key (after the public ceremony), run by the repo owner since it publishes a public file: uploads
# setup/pof_final.zkey.gz as a GitHub Release asset of liakh10/pof. The development key needs no release: it is in git at d7f850b.
# Each key gets its own tag and setup/ZKEY.sha256 entry instead of another large file in git; then point fetch-zkey.sh at it
# with POF_ZKEY_URL. Run: zsh scripts/publish-zkey-release.sh <tag>   (for example zk-ceremony-1)
set -euo pipefail
cd ${0:A:h}/..
TAG=${1:?give the release tag, e.g. zk-ceremony-1}
shasum -a 256 -c setup/ZKEY.sha256 --ignore-missing
gh release create $TAG setup/pof_final.zkey.gz setup/verification_key.json --repo liakh10/pof --prerelease \
  --title "POF zk proving key $TAG" \
  --notes "Proving key of the POF phase 2 circuit. Check setup/TRANSCRIPT.md for the ceremony it comes from (a development setup is NOT for mainnet). sha256: $(cat setup/ZKEY.sha256 | tr '\n' ' ')"
echo "then: POF_ZKEY_URL=https://github.com/liakh10/pof/releases/download/$TAG/pof_final.zkey.gz zsh scripts/fetch-zkey.sh"
