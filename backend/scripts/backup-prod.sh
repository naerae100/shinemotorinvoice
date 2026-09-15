#!/usr/bin/env bash
#
# Dump the production (Sydney) database to backend/backups/.
#
# There is no point-in-time recovery on the Supabase Free tier, so this script
# is the only way back from a bad migration or a mistaken delete. Run it before
# every `prisma migrate deploy`, and on a schedule.
#
# Two traps this script exists to close, both of which have already bitten:
#
#   1. .env.sydney names its variables SYDNEY_DATABASE_URL / SYDNEY_DIRECT_URL.
#      Nothing reads those, so a plain `set -a; . .env.sydney` leaves Prisma and
#      pg_dump falling back to backend/.env — which still points at the
#      DECOMMISSIONED Tokyo instance.
#
#   2. Homebrew's postgresql@16 ships pg_dump 16, and the server is 17.6.
#      pg_dump refuses to read a newer server and exits non-zero. Chained after
#      `&&` that is visible; on its own line it scrolls past and the migration
#      runs with no backup. libpq's pg_dump is 18.x and works.
#
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env.sydney ]]; then
  echo "error: backend/.env.sydney not found — it holds the production credentials." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env.sydney
set +a

: "${SYDNEY_DIRECT_URL:?SYDNEY_DIRECT_URL is not set in .env.sydney}"

# Migrations and dumps both need the direct connection; pgBouncer rejects them.
DUMP_URL="$SYDNEY_DIRECT_URL"

# Pick a pg_dump new enough for the server. libpq's is the newest on this
# machine; fall back to anything on PATH and let pg_dump report the mismatch.
PG_DUMP=""
for candidate in \
  /opt/homebrew/opt/libpq/bin/pg_dump \
  /opt/homebrew/opt/postgresql@17/bin/pg_dump \
  "$(command -v pg_dump || true)"
do
  if [[ -x "$candidate" ]]; then PG_DUMP="$candidate"; break; fi
done

if [[ -z "$PG_DUMP" ]]; then
  echo "error: no pg_dump found. Try: brew install libpq" >&2
  exit 1
fi

mkdir -p backups
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="backups/prod-${STAMP}.sql.gz"

echo "pg_dump:  $PG_DUMP ($("$PG_DUMP" --version | awk '{print $NF}'))"
echo "target:   $(printf '%s' "$DUMP_URL" | sed -E 's#(postgres[^:]*:)[^:@]*@#\1***@#')"
echo "writing:  $OUT"

# --no-owner/--no-privileges so the dump restores into a local scratch database
# without Supabase's roles existing there — which is what a restore drill needs.
"$PG_DUMP" "$DUMP_URL" --no-owner --no-privileges | gzip > "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
echo
echo "done: $OUT ($SIZE)"
echo
echo "A backup you have never restored is not a backup. To verify this one:"
echo "  createdb -p 5433 restore_check && gunzip -c $OUT | psql -p 5433 -d restore_check"
