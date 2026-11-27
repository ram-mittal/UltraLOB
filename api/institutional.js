import crypto from "node:crypto";
import {
  ensureDbReady,
  resolveAuthContext,
  getMemoryStore,
  hydrateUserPortfolio,
  listRiskEventsForUser,
  listAuditLogsForUser,
  sha256Hex,
  query
} from "./store.js";
import { authorizeRequest, roleHasPermission } from "./security.js";
import { recordAuditLog } from "../db/client.js";
import {
  RISK_TOLERANCE_TIERS,
  createDefaultMandate,
  computeFeeSchedule,
  generateInstitutionalStatement,
  formatStatementCsv
} from "../institutional/governance.js";
import { resolveUserBrokerStatus } from "./broker.js";

function getMandateForUser(mem, userId) {
  if (!mem.mandates) mem.mandates = new Map();
  if (!mem.mandates.has(userId)) {
    mem.mandates.set(userId, createDefaultMandate());
  }
  return mem.mandates.get(userId);
}

export default async function institutionalHandler(request, response, { executionStore = null } = {}) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  const subPath = (request.path || request.url || "").replace(/^\/api\/institutional/, "").split("?")[0];
  const dbAvailable = await ensureDbReady().catch(() => false);
  const auth = await resolveAuthContext(request, dbAvailable);
  const userId = auth.userId;
  const mem = getMemoryStore();
  if (!mem.mandates) mem.mandates = new Map();
  if (!mem.apiKeys) mem.apiKeys = [];
  if (!mem.orgMembers) mem.orgMembers = [];

  // GET /api/institutional/statement?format=json|csv
  if (request.method === "GET" && subPath === "/statement") {
    const gate = authorizeRequest(auth, ["reports:read", "portfolio:read"], {
      isMutation: false,
      apiKeyScope: "statements:read"
    });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });

    const portfolio = await hydrateUserPortfolio(userId, dbAvailable);
    let mandate = getMandateForUser(mem, userId);
    if (dbAvailable && /^[0-9a-f-]{36}$/i.test(userId)) {
      const mRes = await query(`SELECT * FROM investor_profiles WHERE user_id = $1`, [userId]).catch(() => ({ rows: [] }));
      if (mRes.rows[0]) mandate = mRes.rows[0];
    }
    const brokerState = await resolveUserBrokerStatus(userId, { executionStore, dbAvailable });
    const [riskEvents, auditLogs] = await Promise.all([
      listRiskEventsForUser(userId, { mem, dbAvailable, limit: 100 }),
      listAuditLogsForUser(userId, { mem, dbAvailable, limit: 100 })
    ]);

    const statement = generateInstitutionalStatement({
      user: { name: auth.name, email: auth.email, role: auth.role, org_name: auth.orgId },
      portfolio,
      mandate,
      broker: brokerState.broker,
      auditLogs,
      riskEvents
    });

    if (String(request.query?.format || "").toLowerCase() === "csv") {
      const csv = formatStatementCsv(statement);
      response.setHeader("Content-Type", "text/csv; charset=utf-8");
      response.setHeader("Content-Disposition", `attachment; filename="ultralob-${statement.statement_id}.csv"`);
      return response.status(200).send(csv);
    }

    return response.status(200).json({ statement });
  }

  // GET /api/institutional/mandate
  if (request.method === "GET" && subPath === "/mandate") {
    const gate = authorizeRequest(auth, ["mandates:manage", "portfolio:read"], {
      isMutation: false,
      apiKeyScope: "portfolio:read"
    });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });

    if (dbAvailable && /^[0-9a-f-]{36}$/i.test(userId)) {
      const res = await query(`SELECT * FROM investor_profiles WHERE user_id = $1`, [userId]);
      if (res.rows[0]) {
        return response.status(200).json({ mandate: res.rows[0], tiers: RISK_TOLERANCE_TIERS });
      }
    }
    return response.status(200).json({ mandate: getMandateForUser(mem, userId), tiers: RISK_TOLERANCE_TIERS });
  }

  // PUT /api/institutional/mandate
  if (request.method === "PUT" && subPath === "/mandate") {
    const gate = authorizeRequest(auth, "mandates:manage", { isMutation: true });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });
    const b = request.body || {};
    const cur = getMandateForUser(mem, userId);
    const riskTolerance = RISK_TOLERANCE_TIERS.includes(String(b.risk_tolerance || "").toUpperCase())
      ? String(b.risk_tolerance).toUpperCase()
      : cur.risk_tolerance;

    const permitted = Array.isArray(b.permitted_instruments)
      ? b.permitted_instruments.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
      : typeof b.permitted_instruments === "string"
        ? b.permitted_instruments.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
        : cur.permitted_instruments;

    const updated = {
      risk_tolerance: riskTolerance,
      base_currency: String(b.base_currency || cur.base_currency || "USD").toUpperCase().slice(0, 6),
      permitted_instruments: permitted.length ? permitted : ["XAUUSD"],
      max_portfolio_drawdown_pct: Math.min(35, Math.max(1, Number(b.max_portfolio_drawdown_pct ?? cur.max_portfolio_drawdown_pct))),
      max_daily_loss_pct: Math.min(10, Math.max(0.25, Number(b.max_daily_loss_pct ?? cur.max_daily_loss_pct))),
      mandate_notes: String(b.mandate_notes ?? cur.mandate_notes ?? "").slice(0, 500),
      updated_at: new Date().toISOString()
    };
    mem.mandates.set(userId, updated);

    if (dbAvailable && auth.authenticated && /^[0-9a-f-]{36}$/i.test(userId)) {
      await query(
        `INSERT INTO investor_profiles (user_id, risk_tolerance, base_currency, permitted_instruments, max_portfolio_drawdown_pct, max_daily_loss_pct, mandate_notes, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           risk_tolerance=$2, base_currency=$3, permitted_instruments=$4,
           max_portfolio_drawdown_pct=$5, max_daily_loss_pct=$6, mandate_notes=$7, updated_at=NOW()`,
        [userId, updated.risk_tolerance, updated.base_currency, updated.permitted_instruments, updated.max_portfolio_drawdown_pct, updated.max_daily_loss_pct, updated.mandate_notes]
      );
      await recordAuditLog({
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: "INVESTOR_MANDATE_UPDATED",
        targetType: "investor_profile",
        targetId: userId,
        details: updated
      });
    }

    return response.status(200).json({ mandate: updated });
  }

  // POST /api/institutional/fees/preview
  if (request.method === "POST" && subPath === "/fees/preview") {
    const calc = computeFeeSchedule(request.body || {});
    return response.status(calc.ok ? 200 : 400).json(calc);
  }

  // Enterprise API Keys (hashed storage, revealed once on creation; forbid management via API key itself)
  if (request.method === "GET" && subPath === "/api-keys") {
    const gate = authorizeRequest(auth, null, { isMutation: false });
    if (!gate.ok || auth.authMethod === "api_key") {
      return response.status(auth.authMethod === "api_key" ? 403 : gate.status).json({ error: auth.authMethod === "api_key" ? "API keys cannot list other API keys." : gate.error, code: auth.authMethod === "api_key" ? "API_KEY_FORBIDDEN" : gate.code });
    }
    if (dbAvailable && /^[0-9a-f-]{36}$/i.test(userId)) {
      const res = await query(
        `SELECT id, label, key_prefix, scopes, status, created_at, revoked_at
         FROM enterprise_api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
      );
      return response.status(200).json({ keys: res.rows });
    }
    return response.status(200).json({
      keys: mem.apiKeys.filter((k) => k.userId === userId).map(({ key_hash, ...rest }) => rest)
    });
  }

  if (request.method === "POST" && subPath === "/api-keys") {
    const gate = authorizeRequest(auth, null, { isMutation: true });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });
    const label = String(request.body?.label || "").trim().slice(0, 80);
    if (!label || label.length < 3) {
      return response.status(400).json({ error: "API key label (min 3 chars) is required." });
    }
    const scopes = Array.isArray(request.body?.scopes) && request.body.scopes.length
      ? request.body.scopes.map((s) => String(s).trim())
      : ["strategies:read", "portfolio:read", "statements:read"];

    const rawKey = "ulb_ent_" + crypto.randomBytes(24).toString("base64url");
    const keyHash = sha256Hex(rawKey);
    const keyPrefix = rawKey.slice(0, 14) + "...";
    const id = crypto.randomUUID();

    if (dbAvailable && /^[0-9a-f-]{36}$/i.test(userId)) {
      await query(
        `INSERT INTO enterprise_api_keys (id, user_id, org_id, label, key_prefix, key_hash, scopes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, userId, auth.orgId, label, keyPrefix, keyHash, scopes]
      );
      await recordAuditLog({
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: "ENTERPRISE_API_KEY_CREATED",
        targetType: "api_key",
        targetId: id,
        details: { label, scopes }
      });
    } else {
      mem.apiKeys.unshift({
        id,
        userId,
        label,
        key_prefix: keyPrefix,
        key_hash: keyHash,
        scopes,
        status: "ACTIVE",
        created_at: new Date().toISOString()
      });
    }

    return response.status(201).json({
      key: { id, label, key_prefix: keyPrefix, scopes, status: "ACTIVE" },
      secret_key: rawKey,
      notice: "Copy this enterprise API key now. Only a SHA-256 hash is retained."
    });
  }

  const revokeMatch = subPath.match(/^\/api-keys\/([^/]+)$/);
  if (request.method === "DELETE" && revokeMatch) {
    const gate = authorizeRequest(auth, null, { isMutation: true });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });
    const id = revokeMatch[1];
    if (dbAvailable && /^[0-9a-f-]{36}$/i.test(id)) {
      const upd = await query(
        `UPDATE enterprise_api_keys SET status='REVOKED', revoked_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING id`,
        [id, userId]
      );
      if (!upd.rows[0]) return response.status(404).json({ error: "API key not found for this account." });
    } else {
      const k = mem.apiKeys.find((item) => item.id === id && item.userId === userId);
      if (!k) return response.status(404).json({ error: "API key not found for this account." });
      k.status = "REVOKED";
      k.revoked_at = new Date().toISOString();
    }
    return response.status(200).json({ status: "revoked", id });
  }

  // Organization Desk Management (authenticated + owner/org-scoped)
  if (request.method === "GET" && subPath === "/organization") {
    const gate = authorizeRequest(auth, ["portfolio:read", "org:manage"], { isMutation: false, apiKeyScope: "portfolio:read" });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });
    const members = mem.orgMembers.filter((m) => m.ownerUserId === userId || (auth.orgId && m.orgId === auth.orgId));
    return response.status(200).json({
      organization: {
        org_id: auth.orgId || null,
        role: auth.role,
        can_manage_org: roleHasPermission(auth.role, "org:manage") || auth.role === "admin",
        members
      }
    });
  }

  if (request.method === "POST" && subPath === "/organization/members") {
    const gate = authorizeRequest(auth, "org:manage", { isMutation: true });
    if (!gate.ok) return response.status(gate.status).json({ error: gate.error, code: gate.code });
    const { email, org_role = "ANALYST" } = request.body || {};
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      return response.status(400).json({ error: "Valid member email is required." });
    }
    const member = {
      id: "mem-" + crypto.randomUUID().slice(0, 8),
      ownerUserId: userId,
      orgId: auth.orgId || userId,
      email: cleanEmail,
      org_role: ["OWNER", "MANAGER", "ANALYST", "RISK_OFFICER", "MEMBER"].includes(org_role) ? org_role : "ANALYST",
      status: "INVITED",
      created_at: new Date().toISOString()
    };
    mem.orgMembers.unshift(member);
    return response.status(201).json({ member });
  }

  return response.status(404).json({ error: "Institutional endpoint not found." });
}
