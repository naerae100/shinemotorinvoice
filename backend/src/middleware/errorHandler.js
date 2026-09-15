export function errorHandler(err, req, res, next) {
  console.error(err);
  res.status(500).json({
    error: err.message,
    stack: err.stack,
    details: 'Custom error handler added for debugging'
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Route not found' });
}
