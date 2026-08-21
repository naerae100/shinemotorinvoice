/**
 * Wraps an async route handler so a rejected promise is forwarded to Express's
 * error handler instead of becoming an unhandled rejection.
 *
 * Express 4 does not await route handlers. Without this, a single failed query
 * (bad foreign key, unique collision, DB unavailable) leaves the request hanging
 * and terminates the Node process, taking the API down for everyone.
 */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
