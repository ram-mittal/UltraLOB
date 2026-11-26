import pg from "pg";

const { Pool } = pg;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ultralob_execution_connectors (
  id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  broker TEXT NOT NULL CHECK (broker = 'MT5'),
  environment TEXT NOT NULL CHECK (environment = 'DEMO'),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','REVOKED')),
  strategy_ids TEXT[] NOT NULL DEFAULT '{}',
  allowed_symbols TEXT[] NOT NULL DEFAULT '{}',
  max_trade_risk_pct DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  max_daily_loss_pct DOUBLE PRECISION NOT NULL DEFAULT 2.0,
  max_drawdown_pct DOUBLE PRECISION NOT NULL DEFAULT 8.0,
  max_spread_points DOUBLE PRECISION NOT NULL DEFAULT 100,
  max_open_positions INTEGER NOT NULL DEFAULT 2,
  max_deviation_points INTEGER NOT NULL DEFAULT 20,
  account_login TEXT,
  account_server TEXT,
  account_company TEXT,
  account_currency TEXT,
  account_leverage INTEGER,
  trade_mode TEXT,
  terminal_connected BOOLEAN NOT NULL DEFAULT FALSE,
  terminal_trade_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  ea_trade_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  balance DOUBLE PRECISION,
  equity DOUBLE PRECISION,
  margin DOUBLE PRECISION,
  margin_free DOUBLE PRECISION,
  day_key TEXT,
  day_start_equity DOUBLE PRECISION,
  equity_high_water DOUBLE PRECISION,
  positions JSONB NOT NULL DEFAULT '[]'::jsonb,
  symbol_specs JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ultralob_execution_commands (
  id UUID PRIMARY KEY,
  connector_id UUID NOT NULL REFERENCES ultralob_execution_connectors(id),
  signal_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  order_type TEXT NOT NULL DEFAULT 'MARKET',
  requested_risk_pct DOUBLE PRECISION NOT NULL,
  stop_loss DOUBLE PRECISION NOT NULL,
  take_profit DOUBLE PRECISION NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  volume DOUBLE PRECISION,
  entry_reference DOUBLE PRECISION,
  risk_amount DOUBLE PRECISION,
  risk_pct DOUBLE PRECISION,
  spread_points DOUBLE PRECISION,
  broker_order_id TEXT,
  broker_deal_id TEXT,
  broker_retcode TEXT,
  broker_comment TEXT,
  error_code TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connector_id, signal_id)
);

CREATE INDEX IF NOT EXISTS idx_ultralob_execution_connectors_heartbeat
  ON ultralob_execution_connectors(last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_ultralob_execution_commands_queue
  ON ultralob_execution_commands(connector_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_ultralob_execution_commands_strategy
  ON ultralob_execution_commands(strategy_id, created_at);

CREATE TABLE IF NOT EXISTS ultralob_execution_events (
  id BIGSERIAL PRIMARY KEY,
  connector_id UUID NOT NULL REFERENCES ultralob_execution_connectors(id),
  command_id UUID,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ultralob_execution_events_connector
  ON ultralob_execution_events(connector_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ultralob_execution_events_command
  ON ultralob_execution_events(command_id, created_at DESC);
`;

function mapConnector(row) {
  if (!row) return null;
  return {
    ...row,
    max_trade_risk_pct: Number(row.max_trade_risk_pct),
    max_daily_loss_pct: Number(row.max_daily_loss_pct),
    max_drawdown_pct: Number(row.max_drawdown_pct),
    max_spread_points: Number(row.max_spread_points),
    max_open_positions: Number(row.max_open_positions),
    max_deviation_points: Number(row.max_deviation_points),
    balance: row.balance == null ? null : Number(row.balance),
    equity: row.equity == null ? null : Number(row.equity),
    margin: row.margin == null ? null : Number(row.margin),
    margin_free: row.margin_free == null ? null : Number(row.margin_free),
    day_start_equity: row.day_start_equity == null ? null : Number(row.day_start_equity),
    equity_high_water: row.equity_high_water == null ? null : Number(row.equity_high_water),
    positions: Array.isArray(row.positions) ? row.positions : [],
    symbol_specs: Array.isArray(row.symbol_specs) ? row.symbol_specs : []
  };
}

function mapCommand(row) {
  if (!row) return null;
  return {
    ...row,
    requested_risk_pct: Number(row.requested_risk_pct),
    volume: row.volume == null ? null : Number(row.volume),
    stop_loss: Number(row.stop_loss),
    take_profit: Number(row.take_profit),
    entry_reference: row.entry_reference == null ? null : Number(row.entry_reference),
    risk_amount: row.risk_amount == null ? null : Number(row.risk_amount),
    risk_pct: row.risk_pct == null ? null : Number(row.risk_pct),
    spread_points: row.spread_points == null ? null : Number(row.spread_points)
  };
}

async function appendEvent(client, connectorId, commandId, eventType, payload = {}) {
  await client.query(
    `INSERT INTO ultralob_execution_events
     (connector_id, command_id, event_type, payload)
     VALUES ($1,$2,$3,$4::jsonb)`,
    [connectorId, commandId || null, eventType, JSON.stringify(payload)]
  );
}

export class PostgresExecutionStore {
  constructor({ connectionString, ssl = false, max = 5 } = {}) {
    if (!connectionString) throw new Error("DATABASE_URL is required for execution storage.");
    this.pool = new Pool({
      connectionString,
      ssl: ssl ? { rejectUnauthorized: true } : undefined,
      max,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      application_name: "ultralob-execution"
    });
    this.initialized = false;
    this.initializing = null;
  }

  async initialize() {
    if (this.initialized) return;
    if (!this.initializing) {
      this.initializing = this.pool.query(SCHEMA).then(() => {
        this.initialized = true;
      }).catch((error) => {
        this.initializing = null;
        throw error;
      });
    }
    await this.initializing;
  }

  async createConnector(input) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO ultralob_execution_connectors
         (id, token_hash, label, broker, environment, strategy_ids, allowed_symbols,
          max_trade_risk_pct, max_daily_loss_pct, max_drawdown_pct, max_spread_points,
          max_open_positions, max_deviation_points)
         VALUES ($1,$2,$3,'MT5','DEMO',$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          input.id, input.token_hash, input.label, input.strategy_ids, input.allowed_symbols,
          input.max_trade_risk_pct, input.max_daily_loss_pct, input.max_drawdown_pct,
          input.max_spread_points, input.max_open_positions, input.max_deviation_points
        ]
      );
      await appendEvent(client, input.id, null, "CONNECTOR_CREATED", {
        label: input.label,
        broker: "MT5",
        environment: "DEMO",
        strategy_ids: input.strategy_ids,
        allowed_symbols: input.allowed_symbols
      });
      await client.query("COMMIT");
      return mapConnector(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getConnectorByTokenHash(tokenHash) {
    const result = await this.pool.query(
      "SELECT * FROM ultralob_execution_connectors WHERE token_hash=$1 AND status IN ('ACTIVE','PAUSED')",
      [tokenHash]
    );
    return mapConnector(result.rows[0]);
  }

  async getConnector(id) {
    const result = await this.pool.query("SELECT * FROM ultralob_execution_connectors WHERE id=$1", [id]);
    return mapConnector(result.rows[0]);
  }

  async listConnectors() {
    const result = await this.pool.query(`
      SELECT id, label, broker, environment, status, strategy_ids, allowed_symbols,
             max_trade_risk_pct, max_daily_loss_pct, max_drawdown_pct,
             max_spread_points, max_open_positions, account_login, account_server,
             account_company, account_currency, account_leverage, trade_mode,
             terminal_connected, terminal_trade_allowed, ea_trade_allowed,
             balance, equity, margin, margin_free, day_start_equity, equity_high_water,
             jsonb_array_length(positions) AS open_positions_count,
             last_heartbeat_at, created_at, updated_at
      FROM ultralob_execution_connectors ORDER BY created_at DESC
    `);
    return result.rows.map((row) => ({
      ...row,
      balance: row.balance == null ? null : Number(row.balance),
      equity: row.equity == null ? null : Number(row.equity),
      margin: row.margin == null ? null : Number(row.margin),
      margin_free: row.margin_free == null ? null : Number(row.margin_free),
      max_trade_risk_pct: Number(row.max_trade_risk_pct),
      max_daily_loss_pct: Number(row.max_daily_loss_pct),
      max_drawdown_pct: Number(row.max_drawdown_pct),
      max_spread_points: Number(row.max_spread_points)
    }));
  }

  async updateHeartbeat(id, snapshot) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const currentResult = await client.query(
        "SELECT day_key, day_start_equity, equity_high_water FROM ultralob_execution_connectors WHERE id=$1 FOR UPDATE",
        [id]
      );
      if (!currentResult.rows[0]) throw new Error("Connector not found.");
      const current = currentResult.rows[0];
      const today = new Date().toISOString().slice(0, 10);
      const dayStart = current.day_key === today && Number(current.day_start_equity) > 0
        ? Number(current.day_start_equity)
        : snapshot.equity;
      const highWater = Math.max(Number(current.equity_high_water) || 0, snapshot.equity);

      const result = await client.query(
        `UPDATE ultralob_execution_connectors SET
           account_login=$2, account_server=$3, account_company=$4, account_currency=$5,
           account_leverage=$6, trade_mode=$7, terminal_connected=$8,
           terminal_trade_allowed=$9, ea_trade_allowed=$10,
           balance=$11, equity=$12, margin=$13, margin_free=$14,
           positions=$15::jsonb, symbol_specs=$16::jsonb,
           day_key=$17, day_start_equity=$18, equity_high_water=$19,
           last_heartbeat_at=NOW(), updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [
          id, snapshot.login, snapshot.server, snapshot.company, snapshot.currency,
          snapshot.leverage, snapshot.trade_mode, snapshot.terminal_connected,
          snapshot.terminal_trade_allowed, snapshot.ea_trade_allowed,
          snapshot.balance, snapshot.equity, snapshot.margin, snapshot.margin_free,
          JSON.stringify(snapshot.positions), JSON.stringify(snapshot.symbol_specs),
          today, dayStart, highWater
        ]
      );
      await client.query("COMMIT");
      return mapConnector(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async enqueueSignal(signal) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const connectors = await client.query(
        `SELECT id FROM ultralob_execution_connectors
         WHERE status='ACTIVE' AND environment='DEMO'
           AND $1 = ANY(strategy_ids) AND $2 = ANY(allowed_symbols)`,
        [signal.strategy_id, signal.symbol]
      );
      const commandIds = [];
      for (const connector of connectors.rows) {
        const commandId = signal.command_id_factory();
        const result = await client.query(
          `INSERT INTO ultralob_execution_commands
           (id, connector_id, signal_id, strategy_id, strategy_version, symbol, side,
            order_type, requested_risk_pct, stop_loss, take_profit, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'MARKET',$8,$9,$10,$11)
           ON CONFLICT (connector_id, signal_id) DO NOTHING
           RETURNING id`,
          [
            commandId, connector.id, signal.signal_id, signal.strategy_id,
            signal.strategy_version, signal.symbol, signal.side,
            signal.risk_pct, signal.stop_loss, signal.take_profit, signal.expires_at
          ]
        );
        if (result.rows[0]) {
          commandIds.push(result.rows[0].id);
          await appendEvent(client, connector.id, result.rows[0].id, "SIGNAL_QUEUED", {
            signal_id: signal.signal_id,
            strategy_id: signal.strategy_id,
            strategy_version: signal.strategy_version,
            symbol: signal.symbol,
            side: signal.side,
            risk_pct: signal.risk_pct,
            expires_at: signal.expires_at
          });
        }
      }
      await client.query("COMMIT");
      return { matched_connectors: connectors.rowCount, queued_commands: commandIds.length, command_ids: commandIds };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async takeNextQueuedCommand(connectorId) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        `SELECT * FROM ultralob_execution_commands
         WHERE connector_id=$1 AND (
           status='QUEUED' OR (status='DISPATCHED' AND lease_expires_at < NOW())
         )
         ORDER BY created_at ASC
         LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [connectorId]
      );
      if (!selected.rows[0]) {
        await client.query("COMMIT");
        return null;
      }
      const result = await client.query(
        `UPDATE ultralob_execution_commands
         SET status='DISPATCHED', attempts=attempts+1,
             lease_expires_at=NOW() + INTERVAL '15 seconds', updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [selected.rows[0].id]
      );
      await appendEvent(client, connectorId, selected.rows[0].id, "COMMAND_DISPATCHED", {
        attempts: result.rows[0].attempts
      });
      await client.query("COMMIT");
      return mapCommand(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateCommandRisk(id, risk) {
    const result = await this.pool.query(
      `UPDATE ultralob_execution_commands SET
         volume=$2, entry_reference=$3, risk_amount=$4, risk_pct=$5,
         spread_points=$6, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id, risk.volume, risk.entry_reference, risk.risk_amount, risk.risk_pct, risk.spread_points]
    );
    return mapCommand(result.rows[0]);
  }

  async rejectCommand(id, code, message) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE ultralob_execution_commands SET
           status='REJECTED', error_code=$2, error_message=$3,
           lease_expires_at=NULL, updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [id, code, message]
      );
      if (result.rows[0]) {
        await appendEvent(client, result.rows[0].connector_id, id, "RISK_REJECTED", {
          error_code: code,
          error_message: message
        });
      }
      await client.query("COMMIT");
      return mapCommand(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async acknowledgeCommand(connectorId, commandId, acknowledgement) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE ultralob_execution_commands SET
           status=$3, broker_order_id=COALESCE($4,broker_order_id),
           broker_deal_id=COALESCE($5,broker_deal_id),
           broker_retcode=COALESCE($6,broker_retcode),
           broker_comment=COALESCE($7,broker_comment),
           error_code=$8, error_message=$9,
           lease_expires_at=NULL, updated_at=NOW()
         WHERE id=$1 AND connector_id=$2 AND status IN ('DISPATCHED','ACCEPTED','PARTIAL')
         RETURNING *`,
        [
          commandId, connectorId, acknowledgement.status,
          acknowledgement.broker_order_id, acknowledgement.broker_deal_id,
          acknowledgement.broker_retcode, acknowledgement.broker_comment,
          acknowledgement.error_code, acknowledgement.error_message
        ]
      );
      if (result.rows[0]) {
        await appendEvent(client, connectorId, commandId, "BROKER_ACKNOWLEDGEMENT", {
          status: acknowledgement.status,
          broker_order_id: acknowledgement.broker_order_id,
          broker_deal_id: acknowledgement.broker_deal_id,
          broker_retcode: acknowledgement.broker_retcode,
          broker_comment: acknowledgement.broker_comment,
          error_code: acknowledgement.error_code,
          error_message: acknowledgement.error_message
        });
      }
      await client.query("COMMIT");
      return mapCommand(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setConnectorStatus(connectorId, status) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "UPDATE ultralob_execution_connectors SET status=$2, updated_at=NOW() WHERE id=$1 RETURNING id,status",
        [connectorId, status]
      );
      if (result.rows[0]) {
        await appendEvent(client, connectorId, null, "CONNECTOR_STATUS_CHANGED", { status });
      }
      await client.query("COMMIT");
      return result.rows[0] || null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listCommands(limit = 100) {
    const result = await this.pool.query(
      `SELECT id, connector_id, signal_id, strategy_id, strategy_version, symbol,
              side, status, volume, requested_risk_pct, risk_amount, risk_pct,
              stop_loss, take_profit, broker_order_id, broker_deal_id,
              broker_retcode, error_code, error_message, created_at, updated_at
       FROM ultralob_execution_commands ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows.map((row) => ({
      ...row,
      requested_risk_pct: Number(row.requested_risk_pct),
      risk_pct: row.risk_pct == null ? null : Number(row.risk_pct),
      risk_amount: row.risk_amount == null ? null : Number(row.risk_amount),
      volume: row.volume == null ? null : Number(row.volume)
    }));
  }

  async listEvents({ connectorId = null, limit = 100 } = {}) {
    const result = await this.pool.query(
      `SELECT id, connector_id, command_id, event_type, payload, created_at
       FROM ultralob_execution_events
       WHERE ($1::uuid IS NULL OR connector_id=$1)
       ORDER BY created_at DESC LIMIT $2`,
      [connectorId, limit]
    );
    return result.rows;
  }

  async close() {
    await this.pool.end();
  }
}
