-- Migration 003: Persist explicit broker verification state in PostgreSQL
ALTER TABLE broker_integrations
  DROP CONSTRAINT IF EXISTS broker_integrations_status_check;

ALTER TABLE broker_integrations
  ADD CONSTRAINT broker_integrations_status_check
  CHECK (status IN ('CONNECTED','PENDING_VERIFICATION','PAUSED','DISCONNECTED','REVOKED'));

ALTER TABLE broker_integrations
  ADD COLUMN IF NOT EXISTS upstream_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED';
