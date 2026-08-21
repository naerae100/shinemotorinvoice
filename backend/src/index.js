import 'dotenv/config';
import { config } from './config/env.js';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.js';
import materialRoutes from './routes/materials.js';
import supplierRoutes from './routes/suppliers.js';
import docketRoutes from './routes/dockets.js';
import invoiceRoutes from './routes/invoices.js';
import consigneeRoutes from './routes/consignees.js';
import settingsRoutes from './routes/settings.js';
import reportRoutes from './routes/reports.js';
import userRoutes from './routes/users.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app = express();

// Behind Railway/Vercel/nginx the client IP arrives in X-Forwarded-For. Without
// this, express-rate-limit sees the proxy's IP for every request and rate-limits
// all users as if they were one.
if (config.isProduction) {
  app.set('trust proxy', 1);
}

app.use(helmet());
app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

// Static file serving for uploads removed. Images are now Base64 Data URIs.

// Brute-force protection on password submission only. It deliberately does not
// cover GET /auth/me: every client calls that on load, and a shared office IP
// would exhaust the quota on page refreshes alone.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
});

app.use('/api/auth/login', loginLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/dockets', docketRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/consignees', consigneeRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', notFoundHandler);
app.use(errorHandler);

if (!process.env.VERCEL) {
  const server = app.listen(config.port, () => {
    console.log(`Shine Metals API running on port ${config.port}`);
  });

  // Last-resort safety net. Route handlers are wrapped in asyncHandler, so reaching
  // here means a bug outside the request cycle — log it and stay up rather than
  // letting Node's default behaviour take the API down mid-shift.
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
  });

  function shutdown(signal) {
    console.log(`${signal} received, shutting down.`);
    server.close(() => process.exit(0));
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export default app;
