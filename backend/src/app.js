'use strict';
const path = require('path');
const express = require('express');
const { errorHandler, ApiError, errorBody } = require('./lib/errors');
const { rateLimit } = require('./lib/rateLimit');
const { guestWriteGuard } = require('./lib/guest');
const { isHealthy } = require('./db/reset');

function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  // CORS for the mobile web build and tools.
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Cache-Control, Last-Event-ID');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });

  // Bodies over 1 MB -> 413 PAYLOAD_TOO_LARGE (handled in errorHandler).
  app.use(express.json({ limit: '1mb', type: () => true }));

  // FR-4.3: guest tokens can never mutate state (checked before any route).
  app.use(guestWriteGuard);

  app.get('/health', async (req, res) => {
    if (await isHealthy()) return res.status(200).json({ status: 'ok' });
    return res.status(503).json(errorBody(new ApiError(503, 'NOT_READY', 'Database not ready or not seeded.')));
  });

  // Product and club media (images). Paths are stored on records as media keys, e.g. "products/x.jpg".
  app.use('/media', express.static(path.join(__dirname, '..', 'media'), {
    maxAge: '7d', index: false, dotfiles: 'deny',
    setHeaders: (res) => res.set('Cross-Origin-Resource-Policy', 'cross-origin'),
  }));

  // Server-Sent Events for live match updates (not rate limited, read-only public match data).
  app.get('/realtime/matches/:match_id', require('./routes/realtime'));

  // Phase II public surfaces: /q short links, /web guest player, /metrics, SSE stream, member chat.
  app.use(require('./routes/day2/public'));

  app.use('/audit/v1', require('./routes/audit'));
  app.use('/api/v1', rateLimit, require('./routes/api'), require('./routes/day2/streaming').apiRouter);

  app.use((req, res) => res.status(404).json(errorBody(new ApiError(404, 'NOT_FOUND', 'Route not found.'))));
  app.use(errorHandler);
  return app;
}

module.exports = { buildApp };
