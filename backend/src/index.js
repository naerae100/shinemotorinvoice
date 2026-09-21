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
import xeroRoutes from './routes/xero.js';
import auditRoutes from './routes/audit.js';
import localSupplierRoutes from './routes/localSuppliers.js';
import collectionRoutes from './routes/collections.js';
import abnRoutes from './routes/abn.js';
import addressRoutes from './routes/address.js';
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
    /**
     * The web app and the Android app are the same build, served from
     * different origins.
     *
     * Inside the Capacitor shell the page is served locally, so its Origin is
     * https://localhost (or capacitor://localhost on older shells) — not the
     * Vercel domain. A single-origin allowlist blocks every request the tablet
     * makes, and the failure is a CORS error in a log nobody reads, not
     * anything the operator can act on.
     *
     * A request with no Origin at all is allowed through: that is curl, the
     * health check, and the app's own non-browser fetches. Origin is a browser
     * control, and a null one is not something to authenticate against — the
     * JWT does that job.
     */
    origin(origin, callback) {
      const allowed = [
        ...config.siteOrigins,
        'https://localhost',
        'capacitor://localhost',
        'http://localhost',
      ];
      callback(null, !origin || allowed.includes(origin));
    },
    credentials: true,
    // The renewed session token rides back on a header, and a browser cannot
    // read a response header unless it is exposed. Without this the tablet
    // would be signed out while the server believed it had renewed the
    // session — see issueSlidingToken in middleware/auth.js.
    exposedHeaders: ['X-Refreshed-Token'],
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
app.use('/api/xero', xeroRoutes);
app.use('/api/audit', auditRoutes);
// Field collections. Mounted before the catch-all 404 like everything else;
// what makes these reachable by a contractor is the allowlist in
// middleware/auth.js, not the order here.
app.use('/api/local-suppliers', localSupplierRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/abn', abnRoutes);
app.use('/api/address', addressRoutes);

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
