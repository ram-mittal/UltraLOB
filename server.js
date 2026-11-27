// This entry point is used by Render's persistent Node web service.
process.env.ULTRALOB_RENDER_MODE = "true";

const { assertJwtSecretConfigured, ensureDbReady } = await import("./api/store.js");
const { getDatabaseStatus, isDatabaseConfigured } = await import("./db/client.js");

try {
  assertJwtSecretConfigured();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const requireDb = process.env.ULTRALOB_REQUIRE_DATABASE === "true";
if (isDatabaseConfigured()) {
  try {
    await ensureDbReady();
    console.info("[startup] PostgreSQL connected and migrations verified.");
  } catch (error) {
    console.error(`[startup] PostgreSQL initialization failed: ${error.message}`);
    if (requireDb) {
      process.exit(1);
    }
  }
} else {
  const msg =
    "[startup] WARNING: DATABASE_URL is not configured. Non-database components (auth, sandbox portfolios, risk configs, backtests, AI decisions) are using ephemeral in-memory fallback storage, and the MT5 Execution Bridge is disabled (503). Configure DATABASE_URL via private deployment environment variables.";
  if (requireDb) {
    console.error("FATAL: " + msg);
    process.exit(1);
  }
  console.warn(msg);
}

const { default: server } = await import("./api/market-data.js");

const port = Number.parseInt(process.env.PORT || "10000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}

server.listen(port, "0.0.0.0", () => {
  const dbStatus = getDatabaseStatus();
  console.log(`UltraLOB listening on port ${port} (storage=${dbStatus.mode})`);
});
