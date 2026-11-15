#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project_dir="$PWD"
: "${ARCHIVE_SOURCE_DIR:?Set ARCHIVE_SOURCE_DIR to verified libarchive3.8.10 source}"
cd "$ARCHIVE_SOURCE_DIR"
# Release source SHA256: 56cad765459d5ee25a3b761f90c47d99379d28297fbfb72d908880d6b875fb96
emconfigure ./configure --disable-shared --disable-bsdtar --disable-bsdcat --disable-bsdcpio --disable-bsdunzip --disable-acl --disable-xattr --without-bz2lib --without-lzma --without-lz4 --without-zstd --without-openssl --without-xml2 --without-expat --without-iconv CFLAGS='-O2 -sUSE_ZLIB=1' LDFLAGS='-sUSE_ZLIB=1'
emmake make -j4 libarchive.la
emcc "$project_dir/tools/resource-src/archive-reader.c" .libs/libarchive.a -Ilibarchive -O2 -sUSE_ZLIB=1 -lworkerfs.js -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=536870912 -sINITIAL_MEMORY=16777216 -sEXPORTED_FUNCTIONS='["_malloc","_free"]' -sEXPORTED_RUNTIME_METHODS='["FS","WORKERFS","ccall","UTF8ToString"]' --no-entry -o "$project_dir/web/assets/mdict/archive-core.mjs"
