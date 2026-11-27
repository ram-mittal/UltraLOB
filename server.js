// This entry point is used by Render's persistent Node web service.
process.env.ULTRALOB_RENDER_MODE = "true";

const { assertJwtSecretConfigured } = await import("./api/store.js");
try {
  assertJwtSecretConfigured();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const { default: server } = await import("./api/market-data.js");

const port = Number.parseInt(process.env.PORT || "10000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}

server.listen(port, "0.0.0.0", () => {
  console.log(`UltraLOB listening on port ${port}`);
});
