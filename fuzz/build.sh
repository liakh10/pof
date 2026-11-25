#!/bin/zsh
# The fuzzer's own snapshot build. The program agent keeps editing pof/program, so the fuzzer never builds in its tree: it copies
# the program sources as they are now into the scratchpad, adds hostile/ as a third program of that workspace, builds the QUICK
# feature (validity floor 10 slots, rotation floor 5, so expiries and rotations pass in seconds on a local chain) with
# cargo build-sbf into the scratchpad's own target/, and builds the IDLs of that snapshot. The sha256 of every source file goes into
# results/snapshot.json, so each report row names the exact code it ran against.
#   zsh fuzz/build.sh            snapshot the working tree of pof/program
#   SNAP_REF=<commit> zsh fuzz/build.sh   snapshot a commit instead (git show)
set -e
here=${0:A:h}
prog=$here/../program
S=${FUZZ_SCRATCH:-/private/tmp/claude-501/-Users-artem-Desktop-sol/be802bf9-e299-4d83-b38b-bc795e5cbb1e/scratchpad/pof-fuzz}
ws=$S/ws
mkdir -p $S
free=$(df -k / | awk 'NR==2{print $4}')
(( free >= 20000000 )) || { echo "under 20 GB free on the disk: not building"; exit 1; }
rm -rf $ws && mkdir -p $ws/programs
if [[ -n $SNAP_REF ]]; then
  ( cd $prog/.. && git archive $SNAP_REF program/Cargo.toml program/Cargo.lock program/rust-toolchain.toml program/Anchor.toml program/programs program/test/fixtures ) | tar -x -C $ws --strip-components 1
else
  cp $prog/Cargo.toml $prog/Cargo.lock $prog/rust-toolchain.toml $prog/Anchor.toml $ws/
  cp -R $prog/programs/pof $prog/programs/pof_gate $ws/programs/
  mkdir -p $ws/test && cp -R $prog/test/fixtures $ws/test/
fi
cp -R $here/hostile $ws/programs/hostile
sed -i '' 's#\.\./\.\./program/programs/#../#' $ws/programs/hostile/Cargo.toml
find $ws/programs -name "*.rs" -exec touch {} +   # git archive keeps commit mtimes; cargo must see the sources as new
export CARGO_TARGET_DIR=$S/target
out=$S/so
rm -rf $out && mkdir -p $out
cd $ws
cargo build-sbf --manifest-path programs/pof/Cargo.toml --features quick --sbf-out-dir $out 2>&1 | grep -vE '^\s*(Compiling|Downloaded|Downloading)' | tail -5
cargo build-sbf --manifest-path programs/pof_gate/Cargo.toml --features quick --sbf-out-dir $out 2>&1 | grep -vE '^\s*(Compiling|Downloaded|Downloading)' | tail -5
cargo build-sbf --manifest-path programs/hostile/Cargo.toml --sbf-out-dir $out 2>&1 | grep -vE '^\s*(Compiling|Downloaded|Downloading)' | tail -5
ls -la $out/*.so
# the IDLs of this snapshot (the fuzzer's codec reads them, never pof/program/idl)
mkdir -p $S/idl
for p in pof pof_gate; do anchor idl build -p $p -o $S/idl/$p.json >/dev/null 2>$S/idl/$p.err || { echo "idl $p failed"; tail -20 $S/idl/$p.err; exit 1; }; done
# what was built: the source hashes, the binaries' hashes and sizes
node -e '
const fs=require("fs"),c=require("crypto"),p=require("path");
const ws=process.argv[1],out=process.argv[2],ref=process.argv[3];
const h=f=>c.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const files=["programs/pof/src/lib.rs","programs/pof/src/ext.rs","programs/pof/src/errors.rs","programs/pof_gate/src/lib.rs","programs/hostile/src/lib.rs","Cargo.lock"];
const so=fs.readdirSync(out).filter(f=>f.endsWith(".so"));
const snap={built:new Date().toISOString(),ref:ref||"working tree",feature:"quick",sources:Object.fromEntries(files.map(f=>[f,h(p.join(ws,f))])),binaries:Object.fromEntries(so.map(f=>[f,{sha256:h(p.join(out,f)),bytes:fs.statSync(p.join(out,f)).size}]))};
fs.mkdirSync(process.argv[4],{recursive:true});fs.writeFileSync(p.join(process.argv[4],"snapshot.json"),JSON.stringify(snap,null,1));console.log(JSON.stringify(snap.sources,null,1));
' $ws $out "$SNAP_REF" $here/results
