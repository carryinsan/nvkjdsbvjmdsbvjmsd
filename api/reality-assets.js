// Dedicated asset route. The core handler performs authentication, ownership checks,
// MIME/size validation, signed uploads, GLB header verification and download signing.
import { handler as coreHandler } from './reality.js';

export default async function realityAssets(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ success: false, code: 'METHOD_NOT_ALLOWED', error: 'Use POST for asset operations.' }));
  }
  return coreHandler(req, res);
}
