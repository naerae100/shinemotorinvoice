#!/usr/bin/env bash
#
# Put a newly-reset Supabase password into the local credentials file, and print
# the two connection strings to paste into Vercel.
#
# The password is typed at a hidden prompt and never appears in your shell
# history, in an argument list, or on screen.
#
# It is URL-encoded on the way in, which is the trap this script exists for: a
# connection string is a URL, so a password containing @ : / ? # or $ has to be
# escaped or the string parses as a different host entirely and the connection
# fails with something unhelpful. The password in use before this rotation
# contained both $ and ?.
#
set -euo pipefail

cd "$(dirname "$0")/.."

ENVFILE=.env.sydney
[[ -f "$ENVFILE" ]] || { echo "error: $ENVFILE not found." >&2; exit 1; }

# Read the existing strings so host, port, user and database are carried over
# unchanged — only the password is being replaced.
set -a
# shellcheck disable=SC1091
. ./"$ENVFILE"
set +a
: "${SYDNEY_DIRECT_URL:?SYDNEY_DIRECT_URL missing}"
: "${SYDNEY_DATABASE_URL:?SYDNEY_DATABASE_URL missing}"

printf 'New Supabase database password (input hidden): '
read -rs NEWPASS
echo
[[ -n "$NEWPASS" ]] || { echo "error: nothing entered." >&2; exit 1; }

ENCODED="$(NEWPASS="$NEWPASS" python3 -c '
import os, urllib.parse
print(urllib.parse.quote(os.environ["NEWPASS"], safe=""))
')"

swap() {
  URL="$1" ENC="$ENCODED" python3 -c '
import os, re, sys
url, enc = os.environ["URL"], os.environ["ENC"]
# Replace only the password: everything between the first ":" after the
# userinfo and the "@" that ends it.
new, n = re.subn(r"^(postgres(?:ql)?://[^:/?#]+:)[^@]*(@)", r"\g<1>" + enc + r"\g<2>", url)
if n != 1:
    sys.exit("could not find a password in one of the connection strings")
print(new)
'
}

NEW_DIRECT="$(swap "$SYDNEY_DIRECT_URL")"
NEW_POOLED="$(swap "$SYDNEY_DATABASE_URL")"

cp "$ENVFILE" "$ENVFILE.bak-$(date +%Y%m%d-%H%M%S)"

TMP="$(mktemp)"
NEW_DIRECT="$NEW_DIRECT" NEW_POOLED="$NEW_POOLED" python3 - "$ENVFILE" > "$TMP" <<'PY'
import os, sys
out = []
for line in open(sys.argv[1]):
    if line.startswith('SYDNEY_DIRECT_URL='):
        out.append(f'SYDNEY_DIRECT_URL={os.environ["NEW_DIRECT"]}\n')
    elif line.startswith('SYDNEY_DATABASE_URL='):
        out.append(f'SYDNEY_DATABASE_URL={os.environ["NEW_POOLED"]}\n')
    else:
        out.append(line)
sys.stdout.write(''.join(out))
PY
mv "$TMP" "$ENVFILE"
chmod 600 "$ENVFILE"

echo "Updated $ENVFILE (previous copy kept alongside it)."
echo
echo "Now paste these into Vercel -> Settings -> Environment Variables (Production),"
echo "then REDEPLOY — a variable change alone does not reach the running functions."
echo
echo "DATABASE_URL"
echo "$NEW_POOLED"
echo
echo "DIRECT_URL"
echo "$NEW_DIRECT"
echo
echo "Then check it locally with:  npm run migrate:prod"
