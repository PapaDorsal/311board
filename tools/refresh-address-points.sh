#!/usr/bin/env bash
# Rebuilds data/address-points.json, and refuses to leave a bad one behind.
#
# This file exists so the guard can be tested. It used to be inline in
# .github/workflows/refresh-data.yml, where the only way to find out whether the
# restore worked was to wait for a real failure in production. The build command
# is injectable through ADDRESS_BUILD_CMD for exactly that reason; nothing sets it
# except tools/test-refresh-guard.sh.
#
# A stale address file is survivable: parcels change slowly and ward boundaries
# only at a remap. A corrupt or half-written one is not, because it would make the
# lookup tell residents the wrong ward. So the previous file is restored unless the
# new one both builds and still answers a known address correctly.
set -uo pipefail

OUT="data/address-points.json"
BUILD="${ADDRESS_BUILD_CMD:-node tools/build-address-points.mjs}"
PREV="$(mktemp)"
trap 'rm -f "$PREV"' EXIT

had_previous=0
if [ -f "$OUT" ]; then
  cp "$OUT" "$PREV"
  had_previous=1
fi

restore() {
  if [ "$had_previous" = 1 ]; then
    cp "$PREV" "$OUT"
    echo "address points: kept the previous file"
  else
    # Nothing to fall back to. Leave no file rather than a bad one: the page
    # reports that the address data did not load, which is true and is safe.
    rm -f "$OUT"
    echo "address points: no previous file to keep, removed the bad one"
  fi
}

# A subshell, so a build command that exits cannot take this script with it and
# skip the restore.
if ! ( eval "$BUILD" ); then
  echo "address points: build failed"
  restore
  exit 1
fi

if ! node -e '
  const C = require("./assets/address.js");
  const raw = require("./data/address-points.json");
  if (!raw.streets || typeof raw.streets !== "object") throw new Error("no streets object");
  const ix = C.prepare(raw);
  const streets = Object.keys(ix.streets).length;
  if (!(streets > 3000)) throw new Error("implausibly few streets: " + streets);
  let faces = 0;
  for (const v of Object.values(ix.streets)) faces += v.length / 2;
  if (!(faces > 40000)) throw new Error("implausibly few block faces: " + faces);
  // A known address, and a known non-address. The first catches a file that is
  // structurally fine but wrong; the second catches a rebuild that reintroduced
  // confident answers for addresses outside the city.
  const ok = C.lookup("1060 W Addison St", ix);
  if (ok.state !== "CONFIRMED" || ok.ward !== 44) {
    throw new Error("1060 W Addison St came back as " + JSON.stringify(ok));
  }
  const out = C.lookup("13900 S Torrence Ave", ix);
  if (out.state === "CONFIRMED") throw new Error("an address outside the city resolved to a ward");
  console.log("address points ok: " + streets + " streets, " + faces + " block faces");
'; then
  echo "address points: the new file did not pass validation"
  restore
  exit 1
fi

echo "address points: refreshed"
