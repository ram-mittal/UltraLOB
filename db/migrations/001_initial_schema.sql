-- UltraLOB Phase 1 PostgreSQL Schema Migration (001_initial_schema.sql)
-- Institutional Strategy Allocation, Portfolio Risk & Copy-Trading Infrastructure

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Roles & Permissions
CREATE TABLE IF NOT EXISTS roles (
  name TEXT PRIMARY KEY CHECK (name IN ('investor','strategy_provider','fund_manager','risk_manager','researcher','admin')),
  description TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO roles (name, description, permissions) VALUES
  ('investor', 'Capital allocator viewing verified strategies, connecting demo/live accounts, and managing copy mandates.', '["strategies:read","portfolio:manage","broker:manage","copy:manage","reports:read"]'::jsonb),
  ('strategy_provider', 'Quantitative author submitting and versioning strategies through lifecycle gates.', '["strategies:read","strategies:create","strategies:version","backtests:run"]'::jsonb),
  ('fund_manager', 'Institutional allocator managing multi-user portfolios and mandates.', '["strategies:read","portfolio:manage","mandates:manage","allocations:manage","reports:read","org:manage"]'::jsonb),
  ('risk_manager', 'Independent risk officer configuring hard limits and triggering kill switches.', '["risk:read","risk:configure","risk:kill_switch","audit:read","execution:read"]'::jsonb),
  ('researcher', 'Quantitative researcher executing backtests, OOS validation, and Monte Carlo robustness runs.', '["strategies:read","strategies:create","backtests:run","research:read"]'::jsonb),
  ('admin', 'Platform administrator with full operational and audit visibility.', '["*"]'::jsonb)
ON CONFLICT (name) DO NOTHING;

-- 2. Organizations / Teams
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'INDIVIDUAL' CHECK (type IN ('INDIVIDUAL','FUND','PROP_FIRM','FAMILY_OFFICE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Users & Refresh Tokens
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'investor' REFERENCES roles(name),
  org_id UUID REFERENCES organizations(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','LOCKED')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS org_members (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (org_role IN ('OWNER','MANAGER','ANALYST','RISK_OFFICER','MEMBER')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- 4. Investor Profiles & Mandates
CREATE TABLE IF NOT EXISTS investor_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  risk_tolerance TEXT NOT NULL DEFAULT 'CONSERVATIVE' CHECK (risk_tolerance IN ('CONSERVATIVE','MODERATE','AGGRESSIVE','INSTITUTIONAL_MANDATE')),
  base_currency TEXT NOT NULL DEFAULT 'USD',
  permitted_instruments TEXT[] NOT NULL DEFAULT ARRAY['XAUUSD'],
  max_portfolio_drawdown_pct DOUBLE PRECISION NOT NULL DEFAULT 10.0,
  max_daily_loss_pct DOUBLE PRECISION NOT NULL DEFAULT 2.0,
  mandate_notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Broker Integrations & Accounts (zero custody of raw broker passwords)
CREATE TABLE IF NOT EXISTS broker_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker_type TEXT NOT NULL CHECK (broker_type IN ('MT5','EXNESS_MT5','PAPER_SANDBOX')),
  environment TEXT NOT NULL DEFAULT 'DEMO' CHECK (environment IN ('DEMO','LIVE','PAPER')),
  server_name TEXT,
  account_label TEXT NOT NULL,
  bridge_token_hash TEXT UNIQUE,
  execution_connector_id UUID,
  status TEXT NOT NULL DEFAULT 'CONNECTED' CHECK (status IN ('CONNECTED','PAUSED','DISCONNECTED','REVOKED')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS broker_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES broker_integrations(id) ON DELETE CASCADE,
  account_login TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  leverage INTEGER,
  balance DOUBLE PRECISION NOT NULL DEFAULT 0,
  equity DOUBLE PRECISION NOT NULL DEFAULT 0,
  margin DOUBLE PRECISION NOT NULL DEFAULT 0,
  margin_free DOUBLE PRECISION NOT NULL DEFAULT 0,
  trade_mode TEXT NOT NULL DEFAULT 'DEMO',
  last_synced_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Quantitative Strategy Catalogue & Lifecycle
CREATE TABLE IF NOT EXISTS strategies (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  author TEXT NOT NULL,
  owner_user_id UUID REFERENCES users(id),
  category TEXT NOT NULL,
  instrument TEXT NOT NULL DEFAULT 'XAUUSD',
  supported_instruments TEXT[] NOT NULL DEFAULT ARRAY['XAUUSD'],
  timeframes TEXT[] NOT NULL DEFAULT ARRAY['H4','H1','M15'],
  lifecycle_status TEXT NOT NULL DEFAULT 'RESEARCH' CHECK (lifecycle_status IN ('RESEARCH','BACKTESTED','FORWARD_TESTING','LIVE_PILOT','VERIFIED_LIVE','PAUSED','RETIRED')),
  data_source_label TEXT NOT NULL DEFAULT 'RESEARCH',
  current_version TEXT NOT NULL DEFAULT '1.0.0',
  description TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high')),
  min_capital DOUBLE PRECISION NOT NULL DEFAULT 1000,
  capacity_limit_usd DOUBLE PRECISION,
  supported_brokers TEXT[] NOT NULL DEFAULT ARRAY['MT5 Demo','Exness MT5 Demo'],
  status_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id TEXT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  entry_logic TEXT NOT NULL,
  exit_logic TEXT NOT NULL,
  stop_loss_methodology TEXT NOT NULL,
  take_profit_methodology TEXT NOT NULL,
  position_sizing_methodology TEXT NOT NULL,
  risk_per_trade_pct DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  cost_slippage_assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  changelog TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (strategy_id, version)
);

CREATE TABLE IF NOT EXISTS strategy_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_version_id UUID NOT NULL REFERENCES strategy_versions(id) ON DELETE CASCADE,
  param_key TEXT NOT NULL,
  param_value JSONB NOT NULL,
  description TEXT,
  UNIQUE (strategy_version_id, param_key)
);

CREATE TABLE IF NOT EXISTS strategy_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id TEXT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('RESEARCH','BACKTEST','DEMO','LIVE_PILOT','LIVE')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','HALTED')),
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Backtests, OOS Validation & Monte Carlo Simulations
CREATE TABLE IF NOT EXISTS backtests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id TEXT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  strategy_version TEXT NOT NULL,
  instrument TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  data_source TEXT NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  oos_start_date TIMESTAMPTZ,
  walk_forward_windows INTEGER,
  cost_model JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS backtest_results (
  backtest_id UUID PRIMARY KEY REFERENCES backtests(id) ON DELETE CASCADE,
  total_return_pct DOUBLE PRECISION,
  cagr_pct DOUBLE PRECISION,
  sharpe_ratio DOUBLE PRECISION,
  sortino_ratio DOUBLE PRECISION,
  max_drawdown_pct DOUBLE PRECISION,
  profit_factor DOUBLE PRECISION,
  win_rate_pct DOUBLE PRECISION,
  avg_profit_trade DOUBLE PRECISION,
  avg_loss_trade DOUBLE PRECISION,
  expectancy DOUBLE PRECISION,
  total_trades INTEGER NOT NULL DEFAULT 0,
  avg_holding_minutes DOUBLE PRECISION,
  max_consecutive_losses INTEGER,
  risk_of_ruin_pct DOUBLE PRECISION,
  oos_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  walk_forward_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  equity_curve JSONB NOT NULL DEFAULT '[]'::jsonb,
  drawdown_series JSONB NOT NULL DEFAULT '[]'::jsonb,
  monthly_returns JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS monte_carlo_simulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id TEXT REFERENCES strategies(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  simulation_type TEXT NOT NULL CHECK (simulation_type IN ('OPTION_PRICING','TRADE_SEQUENCE_BOOTSTRAP','PRICE_PATH_FORECAST')),
  data_source_label TEXT NOT NULL DEFAULT 'SIMULATED_RESEARCH',
  symbol TEXT NOT NULL,
  paths INTEGER NOT NULL,
  horizon_steps INTEGER,
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  results JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Signals & UltraLOB AI Decisions
CREATE TABLE IF NOT EXISTS signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id TEXT NOT NULL REFERENCES strategies(id),
  strategy_version TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL','HOLD')),
  entry_price DOUBLE PRECISION,
  stop_loss DOUBLE PRECISION,
  take_profit DOUBLE PRECISION,
  requested_risk_pct DOUBLE PRECISION,
  data_origin TEXT NOT NULL CHECK (data_origin IN ('REAL_MARKET','BACKTEST','DEMO_BROKER','PAPER_SANDBOX')),
  status TEXT NOT NULL DEFAULT 'GENERATED' CHECK (status IN ('GENERATED','APPROVED','REJECTED','QUEUED','EXECUTED','EXPIRED')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES signals(id) ON DELETE SET NULL,
  strategy_id TEXT REFERENCES strategies(id) ON DELETE SET NULL,
  engine_outputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  mode TEXT NOT NULL DEFAULT 'ADVISORY' CHECK (mode IN ('ADVISORY','GUARDED_AUTO')),
  decision TEXT NOT NULL,
  confidence DOUBLE PRECISION,
  risk_approved BOOLEAN,
  human_approved_by UUID REFERENCES users(id),
  rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Portfolios, Allocations & Snapshots
CREATE TABLE IF NOT EXISTS portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Primary Portfolio',
  environment TEXT NOT NULL DEFAULT 'PAPER_SANDBOX' CHECK (environment IN ('PAPER_SANDBOX','DEMO_BROKER','LIVE_BROKER')),
  balance DOUBLE PRECISION NOT NULL DEFAULT 0,
  equity DOUBLE PRECISION NOT NULL DEFAULT 0,
  margin_used DOUBLE PRECISION NOT NULL DEFAULT 0,
  equity_high_water DOUBLE PRECISION NOT NULL DEFAULT 0,
  mc_config JSONB NOT NULL DEFAULT '{"enabled":false,"minTargetProb":0.55,"minEdgePct":10,"minExpectedReturnPct":0.25,"riskAmountUsd":250}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, environment)
);

CREATE TABLE IF NOT EXISTS allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  strategy_id TEXT NOT NULL REFERENCES strategies(id),
  allocation_method TEXT NOT NULL DEFAULT 'RISK_NORMALIZED' CHECK (allocation_method IN ('FIXED','RISK_NORMALIZED','VOLATILITY_ADJUSTED','EQUAL_RISK_CONTRIBUTION','FRACTIONAL')),
  allocated_capital DOUBLE PRECISION NOT NULL DEFAULT 0,
  risk_per_trade_pct DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  max_drawdown_pct DOUBLE PRECISION NOT NULL DEFAULT 10.0,
  lot_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  auto_mc_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','STOPPED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (portfolio_id, strategy_id)
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  data_origin TEXT NOT NULL,
  balance DOUBLE PRECISION NOT NULL,
  equity DOUBLE PRECISION NOT NULL,
  margin_used DOUBLE PRECISION NOT NULL DEFAULT 0,
  drawdown_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_pid ON portfolio_snapshots(portfolio_id, recorded_at DESC);

-- 10. Orders, Executions, Positions & Trade History
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  strategy_id TEXT REFERENCES strategies(id),
  signal_id UUID REFERENCES signals(id),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  order_type TEXT NOT NULL DEFAULT 'MARKET',
  quantity DOUBLE PRECISION NOT NULL,
  requested_price DOUBLE PRECISION,
  stop_loss DOUBLE PRECISION,
  take_profit DOUBLE PRECISION,
  environment TEXT NOT NULL CHECK (environment IN ('PAPER_SANDBOX','DEMO_BROKER','LIVE_BROKER')),
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  broker_order_id TEXT,
  broker_deal_id TEXT,
  fill_price DOUBLE PRECISION NOT NULL,
  filled_qty DOUBLE PRECISION NOT NULL,
  commission DOUBLE PRECISION NOT NULL DEFAULT 0,
  swap DOUBLE PRECISION NOT NULL DEFAULT 0,
  slippage_points DOUBLE PRECISION NOT NULL DEFAULT 0,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  strategy_id TEXT REFERENCES strategies(id),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  quantity DOUBLE PRECISION NOT NULL,
  entry_price DOUBLE PRECISION NOT NULL,
  stop_loss DOUBLE PRECISION,
  take_profit DOUBLE PRECISION,
  unrealized_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
  environment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS trade_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  strategy_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  quantity DOUBLE PRECISION NOT NULL,
  entry_price DOUBLE PRECISION NOT NULL,
  exit_price DOUBLE PRECISION,
  realized_pnl DOUBLE PRECISION,
  commission DOUBLE PRECISION NOT NULL DEFAULT 0,
  swap DOUBLE PRECISION NOT NULL DEFAULT 0,
  environment TEXT NOT NULL,
  source TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_trade_history_pid ON trade_history(portfolio_id, opened_at DESC);

-- 11. Independent Risk Engine, Kill Switches, Audit Logs & Notifications
CREATE TABLE IF NOT EXISTS risk_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('GLOBAL','ORG','USER','PORTFOLIO','STRATEGY')),
  scope_id TEXT NOT NULL,
  max_risk_per_trade_pct DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  max_daily_loss_pct DOUBLE PRECISION NOT NULL DEFAULT 2.0,
  max_weekly_loss_pct DOUBLE PRECISION NOT NULL DEFAULT 5.0,
  max_monthly_loss_pct DOUBLE PRECISION NOT NULL DEFAULT 10.0,
  max_drawdown_pct DOUBLE PRECISION NOT NULL DEFAULT 12.0,
  max_open_positions INTEGER NOT NULL DEFAULT 5,
  max_leverage DOUBLE PRECISION NOT NULL DEFAULT 20.0,
  max_spread_points DOUBLE PRECISION NOT NULL DEFAULT 100.0,
  kill_switch_active BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS risk_events (
  id BIGSERIAL PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','BREACH','KILL_SWITCH')),
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'SYSTEM',
  severity TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
