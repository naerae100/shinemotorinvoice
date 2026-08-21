import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

/**
 * Translates known error shapes into useful status codes, and anything else
 * into a 500 that does not leak internals to the client.
 */
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: err.flatten() });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': {
        const fields = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : 'field';
        return res.status(409).json({ error: `A record with that ${fields} already exists` });
      }
      case 'P2003':
        return res.status(400).json({ error: 'Referenced record does not exist' });
      case 'P2025':
        return res.status(404).json({ error: 'Record not found' });
      default:
        break;
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    console.error(err);
    return res.status(400).json({ error: 'Invalid request data' });
  }

  // Multer surfaces upload problems with a `code` string
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is too large (max 5 MB)' });
  }
  if (err?.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Unexpected file field' });
  }
  if (err?.status === 415) {
    return res.status(415).json({ error: err.message });
  }

  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

/** 404 for unmatched /api routes, so they return JSON rather than Express's HTML page. */
export function notFoundHandler(req, res) {
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
}
