// Admin health and one-time schema initialization.
import { timingSafeEqual } from 'node:crypto';
import { handler as coreHandler, getPool } from './reality.js';

const SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS reality_worlds (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  owner_id TEXT NOT NULL,\n  title VARCHAR(120) NOT NULL,\n  domain VARCHAR(100) NOT NULL,\n  schema_version VARCHAR(20) NOT NULL DEFAULT '1.0.0',\n  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  deleted_at TIMESTAMPTZ\n);\nCREATE INDEX IF NOT EXISTS reality_worlds_owner_updated_idx ON reality_worlds(owner_id, updated_at DESC) WHERE deleted_at IS NULL;\n\nCREATE TABLE IF NOT EXISTS reality_branches (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  world_id UUID NOT NULL REFERENCES reality_worlds(id) ON DELETE CASCADE,\n  owner_id TEXT NOT NULL,\n  name VARCHAR(100) NOT NULL,\n  parent_branch_id UUID REFERENCES reality_branches(id) ON DELETE SET NULL,\n  base_snapshot_id UUID,\n  sequence BIGINT NOT NULL DEFAULT 0 CHECK (sequence >= 0),\n  current_spec JSONB NOT NULL,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\nCREATE INDEX IF NOT EXISTS reality_branches_world_idx ON reality_branches(world_id, created_at);\nCREATE INDEX IF NOT EXISTS reality_branches_owner_idx ON reality_branches(owner_id, updated_at DESC);\n\nCREATE TABLE IF NOT EXISTS reality_snapshots (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  world_id UUID NOT NULL REFERENCES reality_worlds(id) ON DELETE CASCADE,\n  branch_id UUID NOT NULL REFERENCES reality_branches(id) ON DELETE CASCADE,\n  sequence BIGINT NOT NULL,\n  spec JSONB NOT NULL,\n  state_hash CHAR(64) NOT NULL,\n  engine_version VARCHAR(30) NOT NULL,\n  created_by TEXT NOT NULL,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\nCREATE INDEX IF NOT EXISTS reality_snapshots_branch_idx ON reality_snapshots(branch_id, created_at DESC);\n\nDO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reality_branches_base_snapshot_fk') THEN\n    ALTER TABLE reality_branches\n      ADD CONSTRAINT reality_branches_base_snapshot_fk\n      FOREIGN KEY (base_snapshot_id) REFERENCES reality_snapshots(id) ON DELETE SET NULL;\n  END IF;\nEND $$;\n\nCREATE TABLE IF NOT EXISTS reality_events (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  world_id UUID NOT NULL REFERENCES reality_worlds(id) ON DELETE CASCADE,\n  branch_id UUID NOT NULL REFERENCES reality_branches(id) ON DELETE CASCADE,\n  sequence BIGINT NOT NULL CHECK (sequence > 0),\n  actor_id TEXT NOT NULL,\n  event_type VARCHAR(80) NOT NULL,\n  payload JSONB NOT NULL,\n  command_id VARCHAR(100),\n  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  UNIQUE(branch_id, sequence),\n  UNIQUE(branch_id, command_id)\n);\nCREATE INDEX IF NOT EXISTS reality_events_branch_sequence_idx ON reality_events(branch_id, sequence);\nCREATE INDEX IF NOT EXISTS reality_events_world_created_idx ON reality_events(world_id, created_at DESC);\n\nCREATE TABLE IF NOT EXISTS reality_assets (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  world_id UUID NOT NULL REFERENCES reality_worlds(id) ON DELETE CASCADE,\n  owner_id TEXT NOT NULL,\n  storage_key TEXT NOT NULL UNIQUE,\n  original_name VARCHAR(255) NOT NULL,\n  content_type VARCHAR(120) NOT NULL,\n  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),\n  checksum_sha256 CHAR(64),\n  status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploaded','verified','rejected')),\n  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\nCREATE INDEX IF NOT EXISTS reality_assets_world_idx ON reality_assets(world_id, created_at DESC);\n\nCREATE TABLE IF NOT EXISTS reality_rate_limits (\n  owner_id TEXT NOT NULL,\n  operation VARCHAR(80) NOT NULL,\n  window_start TIMESTAMPTZ NOT NULL,\n  request_count INTEGER NOT NULL CHECK (request_count >= 0),\n  PRIMARY KEY(owner_id, operation, window_start)\n);\n\nCREATE TABLE IF NOT EXISTS reality_jobs (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  world_id UUID NOT NULL REFERENCES reality_worlds(id) ON DELETE CASCADE,\n  owner_id TEXT NOT NULL,\n  job_type VARCHAR(80) NOT NULL,\n  status VARCHAR(24) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),\n  input JSONB NOT NULL,\n  output JSONB,\n  error_code VARCHAR(80),\n  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\nCREATE INDEX IF NOT EXISTS reality_jobs_owner_idx ON reality_jobs(owner_id, created_at DESC);\n\nCREATE TABLE IF NOT EXISTS reality_approvals (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  world_id UUID NOT NULL REFERENCES reality_worlds(id) ON DELETE CASCADE,\n  owner_id TEXT NOT NULL,\n  status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','executed','expired')),\n  proposal JSONB NOT NULL,\n  approved_at TIMESTAMPTZ,\n  executed_at TIMESTAMPTZ,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\nCREATE INDEX IF NOT EXISTS reality_approvals_owner_idx ON reality_approvals(owner_id, created_at DESC);\n\nCREATE TABLE IF NOT EXISTS reality_schema_migrations (\n  migration_id VARCHAR(200) PRIMARY KEY,\n  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\nINSERT INTO reality_schema_migrations(migration_id)\nVALUES ('001_initial.sql')\nON CONFLICT (migration_id) DO NOTHING;\n";

export default async function realityAdmin(req, res) {
  if (req.method === 'GET') {
    req.url = '/api/reality?action=health';
    return coreHandler(req, res);
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ success: false, code: 'METHOD_NOT_ALLOWED', error: 'Use GET for health or POST for initialization.' }));
  }

  try {
    const expected = process.env.REALITY_ADMIN_TOKEN || '';
    const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (expected.length < 32 || supplied.length !== expected.length
      || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ success: false, code: 'ADMIN_AUTH_FAILED', error: 'A valid REALITY_ADMIN_TOKEN is required.' }));
    }
    let body = req.body;
    if (!body || typeof body !== 'object') {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk.toString('utf8');
        if (raw.length > 4096) throw Object.assign(new Error('Request body too large.'), { status: 413 });
      }
      body = raw ? JSON.parse(raw) : {};
    }
    if (body.action !== 'initialize_database') {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ success: false, code: 'ACTION_INVALID', error: 'Expected action initialize_database.' }));
    }
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(SCHEMA_SQL);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ success: true, schema: '001_initial.sql', status: 'initialized' }));
  } catch (error) {
    console.error('[reality-admin]', error.message);
    res.statusCode = Number.isInteger(error.status) ? error.status : 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ success: false, code: 'SCHEMA_INITIALIZATION_FAILED', error: res.statusCode >= 500 ? 'Database initialization failed. Check server logs and database permissions.' : error.message }));
  }
}
