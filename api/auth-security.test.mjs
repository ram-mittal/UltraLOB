import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  assertJwtSecretConfigured,
  hashRefreshToken,
  resolveJwtSecret,
  signToken,
  verifyToken
} from "./store.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("server.js fails production startup when ULTRALOB_JWT_SECRET is missing or weak", () => {
  const cleanEnv = { ...process.env };
  delete cleanEnv.ULTRALOB_JWT_SECRET;
  delete cleanEnv.NODE_TEST_CONTEXT;
  delete cleanEnv.ULTRALOB_TEST_DISABLE_UPSTREAMS;
  cleanEnv.NODE_ENV = "production";
  cleanEnv.PORT = "0";

  const missingRun = spawnSync(process.execPath, [path.join(PROJECT_ROOT, "server.js")], {
    env: cleanEnv,
    encoding: "utf8",
    timeout: 5000
  });
  assert.notEqual(missingRun.status, 0);
  assert.match(missingRun.stderr, /ULTRALOB_JWT_SECRET/);

  const weakRun = spawnSync(process.execPath, [path.join(PROJECT_ROOT, "server.js")], {
    env: { ...cleanEnv, ULTRALOB_JWT_SECRET: "ultralob-dev-secret-change-in-prod" },
    encoding: "utf8",
    timeout: 5000
  });
  assert.notEqual(weakRun.status, 0);
  assert.match(weakRun.stderr, /insecure placeholder/i);

  const shortRun = spawnSync(process.execPath, [path.join(PROJECT_ROOT, "server.js")], {
    env: { ...cleanEnv, ULTRALOB_JWT_SECRET: "short-secret-123" },
    encoding: "utf8",
    timeout: 5000
  });
  assert.notEqual(shortRun.status, 0);
  assert.match(shortRun.stderr, /at least 32 characters/i);

  const requireDbEnv = {
    ...cleanEnv,
    ULTRALOB_JWT_SECRET: crypto.randomBytes(32).toString("hex"),
    ULTRALOB_REQUIRE_DATABASE: "true"
  };
  delete requireDbEnv.DATABASE_URL;
  const missingDbRun = spawnSync(process.execPath, [path.join(PROJECT_ROOT, "server.js")], {
    env: requireDbEnv,
    encoding: "utf8",
    timeout: 5000
  });
  assert.notEqual(missingDbRun.status, 0);
  assert.match(missingDbRun.stderr, /DATABASE_URL is not configured/i);
});

test("assertJwtSecretConfigured rejects legacy fallback and enforces length under strict mode", () => {
  const prevSecret = process.env.ULTRALOB_JWT_SECRET;
  const prevReq = process.env.ULTRALOB_REQUIRE_JWT_SECRET;
  try {
    process.env.ULTRALOB_REQUIRE_JWT_SECRET = "true";
    delete process.env.ULTRALOB_JWT_SECRET;
    assert.throws(() => assertJwtSecretConfigured(), /ULTRALOB_JWT_SECRET/);

    process.env.ULTRALOB_JWT_SECRET = "ultralob-dev-secret-change-in-prod";
    assert.throws(() => resolveJwtSecret(), /insecure placeholder/i);

    const validSecret = crypto.randomBytes(48).toString("hex");
    process.env.ULTRALOB_JWT_SECRET = validSecret;
    assert.equal(assertJwtSecretConfigured(), validSecret);
  } finally {
    if (prevSecret === undefined) delete process.env.ULTRALOB_JWT_SECRET;
    else process.env.ULTRALOB_JWT_SECRET = prevSecret;
    if (prevReq === undefined) delete process.env.ULTRALOB_REQUIRE_JWT_SECRET;
    else process.env.ULTRALOB_REQUIRE_JWT_SECRET = prevReq;
  }
});

test("forged tokens signed with old dev fallback are rejected and secret rotation invalidates sessions", () => {
  const prevSecret = process.env.ULTRALOB_JWT_SECRET;
  const prevMinIat = process.env.ULTRALOB_JWT_MIN_IAT;
  try {
    const secretA = crypto.randomBytes(48).toString("hex");
    const secretB = crypto.randomBytes(48).toString("hex");
    process.env.ULTRALOB_JWT_SECRET = secretA;

    // 1. Forge token using historical predictable dev secret & verify it is rejected
    const forgedBody = Buffer.from(
      JSON.stringify({ id: "attacker", role: "admin", iat: Date.now(), exp: Date.now() + 3600_000 })
    ).toString("base64url");
    const legacyFallbackKey = crypto
      .createHash("sha256")
      .update("ultralob-dev-secret-change-in-prod")
      .digest("hex");
    const forgedSig = crypto.createHmac("sha256", legacyFallbackKey).update(forgedBody).digest("base64url");
    assert.equal(verifyToken(`${forgedBody}.${forgedSig}`), null);

    // 2. Mint valid access + refresh tokens under secretA
    const accessA = signToken({ id: "u-1", role: "investor" }, 3600);
    const refreshRaw = "ulr_" + crypto.randomBytes(24).toString("base64url");
    const refreshHashA = hashRefreshToken(refreshRaw);
    assert.equal(verifyToken(accessA)?.id, "u-1");

    // 3. Rotate secret -> secretB: prior access token AND prior refresh hash are both invalidated
    process.env.ULTRALOB_JWT_SECRET = secretB;
    assert.equal(verifyToken(accessA), null);
    assert.notEqual(hashRefreshToken(refreshRaw), refreshHashA);

    // 4. Epoch cut-off invalidation via ULTRALOB_JWT_MIN_IAT also rejects tokens issued earlier
    const issuedBeforeCutoff = signToken({ id: "u-2", role: "investor" }, 3600);
    process.env.ULTRALOB_JWT_MIN_IAT = String(Date.now() + 5000);
    assert.equal(verifyToken(issuedBeforeCutoff), null);
  } finally {
    if (prevSecret === undefined) delete process.env.ULTRALOB_JWT_SECRET;
    else process.env.ULTRALOB_JWT_SECRET = prevSecret;
    if (prevMinIat === undefined) delete process.env.ULTRALOB_JWT_MIN_IAT;
    else process.env.ULTRALOB_JWT_MIN_IAT = prevMinIat;
  }
});
