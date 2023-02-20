#!/bin/sh

set -e

WORKDIR=keys
ZKEY_URL=https://keys.unirep.io/2-beta-1/buildOrderedTree.zkey
WASM_URL=https://keys.unirep.io/2-beta-1/buildOrderedTree.wasm

wget $ZKEY_URL --progress=bar:force:noscroll -P $WORKDIR
wget $WASM_URL --progress=bar:force:noscroll -P $WORKDIR
