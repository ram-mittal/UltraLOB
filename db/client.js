import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

let sharedPool = null;
let initializedPromise = null;
let dbReady = false;
let dbError = null;

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim());
}

export function isDatabaseReady() {
  return dbReady;
}

export function getDatabaseStatus() {
  return {
    configured: isDatabaseConfigured(),
    ready: dbReady,
    error: dbError ? dbError.message : null,
    mode: isDatabaseConfigured() ? (dbReady ? "postgresql" : "postgresql-error") : "memory-sandbox"
  };
}

export function getPool() {
  if (!isDatabaseConfigured()) return null;
  if (!sharedPool) {
    sharedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
      max: Number.parseInt(process.env.PG_POOL_MAX || "10", 10) || 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      application_name: "ultralob-core"
    });
    sharedPool.on("error", (err) => {
      console.error("[db] unexpected pool error:", err.message);
    });
  }
  return sharedPool;
}

export async function runMigrations() {
  const pool = getPool();
  if (!pool) return { applied: [], mode: "memory-sandbox" };

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = [];
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  for (const file of files) {
    const existing = await pool.query(
      "SELECT filename FROM schema_migrations WHERE filename = $1",
      [file]
    );
    if (existing.rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  return { applied, mode: "postgresql" };
}

export async function initializeDatabase({ seedStrategiesFn = null } = {}) {
  if (!isDatabaseConfigured()) {
    dbReady = false;
    dbError = null;
    return { ready: false, mode: "memory-sandbox" };
  }

  if (!initializedPromise) {
    initializedPromise = (async () => {
      try {
        const res = await runMigrations();
        if (typeof seedStrategiesFn === "function") {
          await seedStrategiesFn(getPool());
        }
        dbReady = true;
        dbError = null;
        if (res.applied.length > 0) {
          console.info("[db] applied migrations:", res.applied.join(", "));
        }
        return { ready: true, mode: "postgresql", applied: res.applied };
      } catch (err) {
        dbReady = false;
        dbError = err;
        initializedPromise = null;
        console.error("[db] initialization failed:", err.message);
        throw err;
      }
    })();
  }

  return initializedPromise;
}

export async function query(text, params = []) {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }
  if (!dbReady) {
    await initializeDatabase();
  }
  return pool.query(text, params);
}

export async function recordAuditLog({
  actorUserId = null,
  actorRole = null,
  action,
  targetType = null,
  targetId = null,
  details = {},
  ipAddress = null
}) {
  if (!isDatabaseConfigured() || !dbReady) return null;
  try {
    const isUuid = typeof actorUserId === "string" && /^[0-9a-f-]{36}$/i.test(actorUserId);
    const res = await query(
      `INSERT INTO audit_logs (actor_user_id, actor_role, action, target_type, target_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id, created_at`,
      [isUuid ? actorUserId : null, actorRole, action, targetType, targetId, JSON.stringify(details), ipAddress]
    );
    return res.rows[0];
  } catch (err) {
    console.warn("[audit] failed to persist audit log:", err.message);
    return null;
  }
}

export async function closeDatabase() {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = null;
    initializedPromise = null;
    dbReady = false;
  }
}
