/**
 * Which screens a contractor is allowed to open.
 *
 * This mirrors CONTRACTOR_ALLOWED in backend/src/middleware/auth.js, and it is
 * worth being clear about which one is the security boundary: the server is.
 * Every endpoint outside this list answers 403 to a contractor, and that is
 * what actually protects the data — typing /suppliers into the address bar
 * already produced an empty page with no supplier on it.
 *
 * What it produced instead was the furniture: the Purchases heading, the
 * filter bar, the empty table and "Could not load records". Nothing was
 * exposed, but it reads as a broken app at best and an unlocked door at
 * worst, and neither is something to hand a contractor on their first day.
 *
 * So this is the same list again, kept deliberately as an allowlist rather
 * than a list of things to hide: a screen added next month is closed to
 * contractors until somebody comes here and opens it, which is the failure
 * direction to prefer.
 */
const CONTRACTOR_PATHS = [
  // The index route decides for itself — see HomeForRole in App.jsx.
  /^\/$/,
  /^\/collections(\/|$)/,
  /^\/local-suppliers(\/|$)/,
  // Their own account and devices. Everyone needs to be able to see where
  // they are signed in, including the role that cannot open Staff & logins.
  /^\/account$/,
];

/** True if a contractor may open this path. */
export function contractorMayVisit(pathname) {
  const path = String(pathname || '');
  return CONTRACTOR_PATHS.some((re) => re.test(path));
}

/** Where a contractor is sent when they land somewhere they cannot open. */
export const CONTRACTOR_HOME = '/collections';
