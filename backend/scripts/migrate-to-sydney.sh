#!/usr/bin/env bash
#
# One-off move of the production database from Tokyo (ap-northeast-1) to
# Sydney (ap-southeast-2).
#
#   1. Dumps the public schema from the old project.
#   2. Restores it into the new one, which must be empty.
#   3. Runs `prisma migrate deploy`, which upgrades the restored data through
#      every migration the old database never received — including the taxMode
#      backfill and the invoice currency/container changes.
#   4. Compares row counts and re-measures latency.
#
# Reads the old URLs from .env and the new ones from .env.sydney. Nothing is
# written to the old database at any point, and it is left running.

set -euo pipefail
cd "$(dirname "$0")/.."

PGDUMP=/opt/homebrew/bin/pg_dump   # 18.x — must be >= the server's 17.6
PSQL=/opt/homebrew/bin/psql

set -a; . ./.env; . ./.env.sydney; set +a

if [ -z "${SYDNEY_DIRECT_URL:-}" ] || [ -z "${SYDNEY_DATABASE_URL:-}" ]; then
  echo "Fill in SYDNEY_DATABASE_URL and SYDNEY_DIRECT_URL in backend/.env.sydney first." >&2
  exit 1
fi

STAMP=$(date +%Y%m%d-%H%M%S)
DUMP="backups/tokyo-${STAMP}.sql"
mkdir -p backups

echo "▸ Dumping the public schema from Tokyo…"
"$PGDUMP" "$DIRECT_URL" \
  --schema=public --no-owner --no-privileges --no-comments \
  --quote-all-identifiers -f "$DUMP"
echo "  $(wc -l < "$DUMP") lines, $(du -h "$DUMP" | cut -f1) → $DUMP"

echo "▸ Checking Sydney is empty before touching it…"
EXISTING=$("$PSQL" "$SYDNEY_DIRECT_URL" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
if [ "$EXISTING" != "0" ]; then
  echo "  Sydney already has $EXISTING tables in public. Refusing to overwrite." >&2
  echo "  Drop them first if this is a retry: DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >&2
  exit 1
fi

echo "▸ Restoring into Sydney…"
# Supabase creates the public schema itself, so pg_dump's own CREATE SCHEMA
# would abort the restore. Everything else in the dump is applied unchanged.
grep -v '^CREATE SCHEMA "public";$' "$DUMP" \
  | "$PSQL" "$SYDNEY_DIRECT_URL" -v ON_ERROR_STOP=1 -q

echo "▸ Applying the migrations Tokyo never received…"
DATABASE_URL="$SYDNEY_DATABASE_URL" DIRECT_URL="$SYDNEY_DIRECT_URL" npx prisma migrate deploy

echo "▸ Comparing row counts…"
COUNT_SQL="SELECT 'Docket', count(*) FROM \"Docket\"
     UNION ALL SELECT 'DocketLineItem', count(*) FROM \"DocketLineItem\"
     UNION ALL SELECT 'ExportInvoice', count(*) FROM \"ExportInvoice\"
     UNION ALL SELECT 'InvoiceLineItem', count(*) FROM \"InvoiceLineItem\"
     UNION ALL SELECT 'Supplier', count(*) FROM \"Supplier\"
     UNION ALL SELECT 'Consignee', count(*) FROM \"Consignee\"
     UNION ALL SELECT 'Material', count(*) FROM \"Material\"
     UNION ALL SELECT 'User', count(*) FROM \"User\" ORDER BY 1"
diff <("$PSQL" "$DIRECT_URL" -tAF, -c "$COUNT_SQL") \
     <("$PSQL" "$SYDNEY_DIRECT_URL" -tAF, -c "$COUNT_SQL") \
  && echo "  ✓ every table matches" \
  || { echo "  ✗ ROW COUNTS DIFFER — do not switch over" >&2; exit 1; }

echo "▸ Latency, old vs new:"
for label in "Tokyo:$DIRECT_URL" "Sydney:$SYDNEY_DIRECT_URL"; do
  name=${label%%:*}; url=${label#*:}
  ms=$("$PSQL" "$url" -qAt -c "\timing on" -c "select 1" -c "select 1" -c "select 1" 2>/dev/null \
        | grep -i '^Time' | tail -1 | sed 's/[^0-9.]//g')
  printf "  %-7s %s ms\n" "$name" "$ms"
done

echo
echo "Done. The old database is untouched and still serving."
echo "Next: point Vercel's DATABASE_URL / DIRECT_URL at Sydney and redeploy."
