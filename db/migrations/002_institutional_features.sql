-- Phase 6: Enterprise API Keys & Institutional Governance Extensions

CREATE TABLE IF NOT EXISTS enterprise_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['strategies:read','portfolio:read'],
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_enterprise_api_keys_user ON enterprise_api_keys(user_id);
