#!/usr/bin/env bash
#
# Apply pending migrations to the production (Sydney) database.
#
# The Vercel pipeline runs `prisma generate` and nothing else, so migrations
# never reach production on their own. Pushing schema-dependent code without
# running this first fails every query that selects a new column — which is not
# graceful: on 15 Sep 2026 one unapplied migration took out the dashboard,
# Purchases and Clients at once.
#
# Two traps this closes, both of which have already bitten:
#
#   1. .env.sydney names its variables SYDNEY_DATABASE_URL / SYDNEY_DIRECT_URL,
#      which nothing reads. Without the mapping below, Prisma falls back to
#      backend/.env — still pointed at the DECOMMISSIONED Tokyo instance — and
#      reports success against a dead server.
#   2. Migrations need the direct connection. pgBouncer rejects them.
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

export DATABASE_URL="${SYDNEY_DATABASE_URL:-$SYDNEY_DIRECT_URL}"
export DIRECT_URL="$SYDNEY_DIRECT_URL"

host="$(printf '%s' "$DIRECT_URL" | sed -E 's#.*@([^:/?]+).*#\1#')"
echo "target: $host"
if [[ "$host" == *ap-northeast-1* ]]; then
  echo "refusing: that is the decommissioned Tokyo instance." >&2
  exit 1
fi
echo

# Status first, always. The migrations folder is not a reliable guide to what
# production is missing — the taxMode column reached it via `prisma db push`,
# so a column can exist live while its migration sits unapplied.
#
# `migrate status` exits non-zero precisely when there is something to apply,
# so under `set -e` it would abort the script in the one case it exists for.
npx prisma migrate status || true
echo

npx prisma migrate deploy
