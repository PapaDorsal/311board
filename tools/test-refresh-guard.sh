#!/usr/bin/env bash
# Proves tools/refresh-address-points.sh keeps the previous address file when a
# rebuild goes wrong. Every case swaps in a fake build through ADDRESS_BUILD_CMD,
# so none of these download anything.
#
# The real file is saved and put back at the end, so this is safe to run in a
# working tree with uncommitted changes.
#
# Run: tools/test-refresh-guard.sh
set -uo pipefail
cd "$(dirname "$0")/.."

OUT="data/address-points.json"
KEEP="$(mktemp)"
cp "$OUT" "$KEEP"
GOOD="$(mktemp)"
cp "$OUT" "$GOOD"
SUM_GOOD="$(sha256sum < "$GOOD" | cut -d' ' -f1)"
trap 'cp "$KEEP" "$OUT"; rm -f "$KEEP" "$GOOD"' EXIT

failed=0
check() { # name expected_exit expect_restored build_cmd
  local name="$1" want_exit="$2" want_restored="$3" cmd="$4"
  cp "$GOOD" "$OUT"
  ADDRESS_BUILD_CMD="$cmd" ./tools/refresh-address-points.sh >/tmp/guard.log 2>&1
  local got_exit=$?
  local now="missing"
  [ -f "$OUT" ] && now="$(sha256sum < "$OUT" | cut -d' ' -f1)"
  local restored=no
  [ "$now" = "$SUM_GOOD" ] && restored=yes
  if [ "$got_exit" != "$want_exit" ]; then
    echo "FAIL  $name"; echo "      exit $got_exit, wanted $want_exit"; echo "      $(tail -2 /tmp/guard.log)"
    failed=$((failed+1)); return
  fi
  if [ "$restored" != "$want_restored" ]; then
    echo "FAIL  $name"; echo "      previous file restored: $restored, wanted $want_restored"
    failed=$((failed+1)); return
  fi
  echo "ok    $name"
}

# A build that cannot run at all.
check "a build that exits non-zero is not committed" 1 yes "exit 3"

# A build that writes garbage over the file. This is the half-written case: the
# old inline guard would have left this in place if validation had been skipped.
check "a truncated file is not committed" 1 yes \
  "printf '{\"streets\":' > $OUT"

# Valid JSON, wrong shape.
check "valid JSON with no streets object is not committed" 1 yes \
  "printf '{\"built\":\"2026-01-01\"}' > $OUT"

# Structurally plausible but far too small: a build that silently fetched one page.
check "a file with too few streets is not committed" 1 yes \
  "node -e 'const d={built:\"x\",streets:{}};for(let i=0;i<10;i++)d.streets[\"W|X\"+i+\"|ST||O\"]=[1,44];require(\"fs\").writeFileSync(\"$OUT\",JSON.stringify(d))'"

# Big enough to pass the size floors, but the known address now answers wrongly.
# This is the case that matters most: nothing about the file looks broken.
check "a file that gets a known address wrong is not committed" 1 yes \
  "node -e '
    const fs=require(\"fs\");
    const d=JSON.parse(fs.readFileSync(\"$GOOD\",\"utf8\"));
    for (const k of Object.keys(d.streets)) if (/\\|ADDISON\\|/.test(k)) {
      const v=d.streets[k];
      for (let i=1;i<v.length;i+=2) if (typeof v[i]===\"number\") v[i]=7;
    }
    fs.writeFileSync(\"$OUT\",JSON.stringify(d));'"

# The file is fine. Nothing is restored and the step succeeds.
check "a good file is committed" 0 yes "true"

# And the good-file case must genuinely have run the validation, not skipped it.
# Captured to a file rather than piped: `grep -q` closes the pipe on its first
# match, the script gets SIGPIPE, and with pipefail the pipeline reports failure
# even though everything worked.
cp "$GOOD" "$OUT"
ADDRESS_BUILD_CMD="true" ./tools/refresh-address-points.sh >/tmp/guard-good.log 2>&1
if grep -q "address points ok:" /tmp/guard-good.log; then
  echo "ok    a good file is actually validated, not waved through"
else
  echo "FAIL  a good file is actually validated, not waved through"
  echo "      output was: $(cat /tmp/guard-good.log)"
  failed=$((failed+1))
fi

# No previous file to fall back on: leave none rather than a bad one.
rm -f "$OUT"
ADDRESS_BUILD_CMD="printf '{' > $OUT" ./tools/refresh-address-points.sh >/tmp/guard.log 2>&1
code=$?
if [ "$code" = 1 ] && [ ! -f "$OUT" ]; then
  echo "ok    with no previous file, a bad one is removed rather than kept"
else
  echo "FAIL  with no previous file, a bad one is removed rather than kept"
  echo "      exit $code, file present: $([ -f "$OUT" ] && echo yes || echo no)"
  failed=$((failed+1))
fi

echo ""
if [ "$failed" = 0 ]; then echo "all passed"; else echo "$failed failed"; fi
exit $((failed > 0))
