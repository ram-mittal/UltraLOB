-- Migration 005: Persistent JSON state for paper portfolios and hierarchical risk governance
ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS paper_state JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE risk_configs
  ADD COLUMN IF NOT EXISTS max_margin_usage_pct DOUBLE PRECISION NOT NULL DEFAULT 80.0;

ALTER TABLE risk_configs
  ADD COLUMN IF NOT EXISTS max_slippage_points DOUBLE PRECISION NOT NULL DEFAULT 30.0;

ALTER TABLE risk_configs
  ADD COLUMN IF NOT EXISTS kill_switches JSONB NOT NULL DEFAULT '{"global_active":false,"global_reason":null,"strategies":{},"instruments":{}}'::jsonb;
