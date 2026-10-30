/*
 * ArixAI Reality Engine — database-free temporary mode.
 * Health is served by the core route. Schema initialization is intentionally
 * unavailable because browser-local mode does not create or query PostgreSQL.
 */
import { handler as coreHandler } from './reality.js';

export default async function realityAdmin(req, res) {
  if (req.method === 'GET') {
    req.url = '/api/reality?action=health';
    return coreHandler(req, res);
  }

  res.statusCode = 410;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end(JSON.stringify({
    success: false,
    code: 'DATABASE_MODE_DISABLED',
    error: 'Database initialization is disabled in browser-local mode. Worlds are stored in the browser instead.'
  }));
}
