#!/bin/zsh
# onchain/patch/pof-program.diff: what onchain/apply.py changes in the committed program/ (HEAD), as a reviewable diff.
set -euo pipefail
ZK=${0:A:h}/..
T=${POF_ZK_OUT:-/Users/artem/Desktop/sol/scratchpad/pof-zk}/diff
rm -rf $T; mkdir -p $T/a $T/b
git -C $ZK/.. archive HEAD program/programs | tar -x -C $T/a
cp -R $T/a/program $T/b/program
python3 $ZK/onchain/apply.py $T/b/program > /dev/null
(cd $T && diff -ruN a/program/programs b/program/programs > $ZK/onchain/patch/pof-program.diff) || true
echo "onchain/patch/pof-program.diff against program $(git -C $ZK/.. log -1 --format=%h -- program): $(wc -l < $ZK/onchain/patch/pof-program.diff) lines"
