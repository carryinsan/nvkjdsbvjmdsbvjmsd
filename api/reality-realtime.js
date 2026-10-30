// Durable realtime synchronization over authenticated HTTP polling.
// The database event log is authoritative; this endpoint deliberately does not
// depend on process-local WebSocket connections or serverless instance affinity.
import { handler as coreHandler } from './reality.js';

export default async function realityRealtime(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ success: false, code: 'METHOD_NOT_ALLOWED', error: 'Use GET for durable event synchronization.' }));
  }
  const incoming = new URL(req.url, 'https://reality.local');
  const action = incoming.searchParams.get('action') || 'sync';
  if (action !== 'sync') {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ success: false, code: 'ACTION_NOT_SUPPORTED', error: 'Only sync is supported on this endpoint.' }));
  }
  req.url = `/api/reality?action=sync&${incoming.searchParams.toString().replace(/(^|&)action=sync(&|$)/, '$1').replace(/^&|&$/g, '')}`;
  return coreHandler(req, res);
}
