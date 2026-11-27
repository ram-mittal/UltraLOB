import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { once } from "node:events";

process.env.ULTRALOB_RENDER_MODE = "true";
process.env.ULTRALOB_TEST_DISABLE_UPSTREAMS = "true";
delete process.env.PRICING_SERVICE_URL;
delete process.env.DATABASE_URL;
delete process.env.ULTRALOB_EXECUTION_ADMIN_KEY;

const { default: server } = await import("./market-data.js");

test("Render adapter serves Phase 1 institutional SPA, RBAC auth, honest strategy registry, risk & broker APIs", async () => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Institutional SPA shell & all 12 workspace routes
    const spa = await fetch(baseUrl + "/");
    assert.equal(spa.status, 200);
    const spaHtml = await spa.text();
    assert.match(spaHtml, /UltraLOB — Institutional Strategy Allocation & Risk Infrastructure/);
    assert.match(spaHtml, /\/public\/js\/app\.js/);

    for (const route of [
      "/overview", "/marketplace", "/portfolio", "/ai", "/markets", "/risk",
      "/copy-trading", "/broker", "/execution", "/research", "/reports", "/settings",
      "/dashboard", "/terminal"
    ]) {
      const page = await fetch(baseUrl + route);
      assert.equal(page.status, 200, `Expected 200 for ${route}`);
      assert.match(await page.text(), /UltraLOB/);
    }

    const appJs = await fetch(baseUrl + "/public/js/app.js");
    assert.equal(appJs.status, 200);
    assert.match(appJs.headers.get("content-type") || "", /javascript/);

    // 2. Classic FIX / Market Monte Carlo terminal preserved at /legacy
    const legacy = await fetch(baseUrl + "/legacy");
    assert.equal(legacy.status, 200);
    const legacyHtml = await legacy.text();
    assert.match(legacyHtml, /wss:\/\/ws\.kraken\.com\/v2/);
    assert.match(legacyHtml, /Market Monte Carlo Simulation/);
    assert.match(legacyHtml, /runMarketMonteCarlo\(\)/);
    const scriptStart = legacyHtml.indexOf("<script>");
    const scriptEnd = legacyHtml.indexOf("</script>", scriptStart);
    assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, "legacy inline script should be present");
    assert.doesNotThrow(() => new Function(legacyHtml.slice(scriptStart + "<script>".length, scriptEnd)));

    // 3. System Status & Execution Health
    const health = await fetch(baseUrl + "/healthz");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");

    const sysStatus = await fetch(baseUrl + "/api/system/status");
    assert.equal(sysStatus.status, 200);
    const sysPayload = await sysStatus.json();
    assert.equal(sysPayload.execution.environment, "DEMO_ONLY");
    assert.equal(sysPayload.execution.live_execution_enabled, false);
    assert.equal(sysPayload.market_feeds.xauusd.origin, "AWAITING_DATA");

    const executionHealth = await fetch(baseUrl + "/api/execution/health");
    const executionHealthPayload = await executionHealth.json();
    assert.equal(executionHealth.status, 200);
    assert.equal(executionHealthPayload.environment, "DEMO_ONLY");
    assert.equal(executionHealthPayload.storage, "not-configured");
    assert.equal(executionHealthPayload.live_execution_enabled, false);

    // 4. RBAC Auth + Refresh Token Rotation
    const investorEmail = `investor-${Date.now()}@ultralob.io`;
    const invReg = await fetch(baseUrl + "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Investor Test", email: investorEmail, password: "secret123", role: "investor" })
    });
    assert.equal(invReg.status, 201);
    const invData = await invReg.json();
    assert.equal(invData.user.role, "investor");
    assert.ok(invData.token && invData.refreshToken);

    const providerEmail = `provider-${Date.now()}@ultralob.io`;
    const provReg = await fetch(baseUrl + "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Quant Provider",
        email: providerEmail,
        password: "secret123",
        role: "strategy_provider",
        organization_name: "Alpha Gold Desk"
      })
    });
    assert.equal(provReg.status, 201);
    const provData = await provReg.json();
    assert.equal(provData.user.role, "strategy_provider");
    assert.equal(provData.user.org_name, "Alpha Gold Desk");

    const refreshRes = await fetch(baseUrl + "/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: provData.refreshToken })
    });
    assert.equal(refreshRes.status, 200);
    const refreshed = await refreshRes.json();
    assert.ok(refreshed.token && refreshed.refreshToken !== provData.refreshToken);

    const me = await fetch(baseUrl + "/api/auth/me", {
      headers: { Authorization: `Bearer ${refreshed.token}` }
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.email, providerEmail);

    // 4b. Secret rotation invalidates pre-rotation access & refresh sessions
    const prevSecret = process.env.ULTRALOB_JWT_SECRET;
    try {
      process.env.ULTRALOB_JWT_SECRET = "rotated-" + "b".repeat(56);
      const staleMe = await fetch(baseUrl + "/api/auth/me", {
        headers: { Authorization: `Bearer ${refreshed.token}` }
      });
      assert.equal(staleMe.status, 401);
      const staleRefresh = await fetch(baseUrl + "/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refreshed.refreshToken })
      });
      assert.equal(staleRefresh.status, 401);
    } finally {
      if (prevSecret === undefined) delete process.env.ULTRALOB_JWT_SECRET;
      else process.env.ULTRALOB_JWT_SECRET = prevSecret;
    }

    // 5. Strategy Registry (UL-01..UL-05 with zero fabricated returns + RBAC publish)
    const strats = await fetch(baseUrl + "/api/strategies");
    assert.equal(strats.status, 200);
    const stratData = await strats.json();
    assert.equal(stratData.strategies.length, 5);
    assert.ok(stratData.strategies.every((s) => s.lifecycle_status === "RESEARCH"));
    assert.ok(stratData.strategies.every((s) => s.total_return === null && s.sharpe_ratio === null));
    assert.ok(stratData.strategies.some((s) => s.code === "UL-01" && s.instrument === "XAUUSD"));

    // Investor role cannot publish strategies
    const forbiddenStrat = await fetch(baseUrl + "/api/strategies", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ name: "Unauthorized Spec", description: "Should be rejected" })
    });
    assert.equal(forbiddenStrat.status, 403);

    // Strategy provider can publish a RESEARCH strategy (no invented return stats)
    const createStrat = await fetch(baseUrl + "/api/strategies", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${refreshed.token}` },
      body: JSON.stringify({
        name: "UL-06 Session Breakout",
        code: "UL-06",
        description: "London session breakout specification on XAUUSD",
        instrument: "XAUUSD",
        risk_level: "medium"
      })
    });
    assert.equal(createStrat.status, 201);
    const createdPayload = await createStrat.json();
    assert.equal(createdPayload.strategy.lifecycle_status, "RESEARCH");
    assert.equal(createdPayload.strategy.total_return, null);

    // 6. Broker connection rejects LIVE mode, unimplemented raw passwords/API keys, and unverified fake-connected states
    const liveBlocked = await fetch(baseUrl + "/api/broker/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({
        type: "exness",
        mode: "ea_bridge",
        environment: "LIVE",
        server: "Exness-MT5Real",
        account_id: "19283746"
      })
    });
    assert.equal(liveBlocked.status, 403);

    // Reject unimplemented direct MT5 password / Exness API secret flows with 501 (never fake connected:true)
    const unimplementedExness = await fetch(baseUrl + "/api/broker/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({
        type: "exness",
        environment: "DEMO",
        server: "Exness-MT5Trial8",
        account_id: "19283746",
        api_key: "ex-key-demo",
        api_secret: "ex-sec-demo"
      })
    });
    assert.equal(unimplementedExness.status, 501);
    const unimplPayload = await unimplementedExness.json();
    assert.equal(unimplPayload.code, "ADAPTER_NOT_IMPLEMENTED");
    assert.equal(unimplPayload.connected, false);
    assert.equal(unimplPayload.upstreamVerified, false);

    // Provision non-custodial EA bridge (no password): strictly connected:false + upstreamVerified:false until EA heartbeat
    const conn = await fetch(baseUrl + "/api/broker/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({
        type: "exness",
        mode: "ea_bridge",
        environment: "DEMO",
        server: "Exness-MT5Trial8",
        account_id: "19283746"
      })
    });
    assert.equal(conn.status, 202);
    const connData = await conn.json();
    assert.equal(connData.connected, false);
    assert.equal(connData.paired, true);
    assert.equal(connData.upstreamVerified, false);
    assert.equal(connData.verification_status, "PENDING_EA_HEARTBEAT");
    assert.equal(connData.broker.environment, "DEMO");
    assert.ok(connData.broker.bridgeToken);

    const statusCheck = await fetch(baseUrl + "/api/broker/status", {
      headers: { Authorization: `Bearer ${invData.token}` }
    });
    assert.equal(statusCheck.status, 200);
    const statusData = await statusCheck.json();
    assert.equal(statusData.connected, false);
    assert.equal(statusData.upstreamVerified, false);
    assert.equal(statusData.verification_status, "PENDING_EA_HEARTBEAT");

    // Unverified MetaApi upstream failure must NOT store or return connected:true
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes("agiliumtrade")) {
        return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
      }
      return origFetch(url, opts);
    };
    try {
      const badMeta = await origFetch(baseUrl + "/api/broker/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
        body: JSON.stringify({
          type: "mt5",
          mode: "metaapi_demo",
          environment: "DEMO",
          metaapi_account_id: "fake-acc",
          metaapi_token: "bad-tok"
        })
      });
      assert.equal(badMeta.status, 502);
      const badMetaJson = await badMeta.json();
      assert.equal(badMetaJson.connected, false);
      assert.equal(badMetaJson.upstreamVerified, false);
    } finally {
      globalThis.fetch = origFetch;
    }

    const eaFile = await fetch(baseUrl + "/api/broker/mt5/ea", {
      headers: { Authorization: `Bearer ${invData.token}` }
    });
    assert.equal(eaFile.status, 200);
    const eaSource = await eaFile.text();
    assert.match(eaSource, /UltraLOB Bridge EA/);
    assert.match(eaSource, /ACCOUNT_TRADE_MODE_DEMO/);

    // Execution Monitor requires auth (401 unauthenticated) and scopes strictly to user
    const unauthMonitor = await fetch(baseUrl + "/api/execution/monitor");
    assert.equal(unauthMonitor.status, 401);

    const monitorRes = await fetch(baseUrl + "/api/execution/monitor", {
      headers: { Authorization: `Bearer ${invData.token}` }
    });
    assert.equal(monitorRes.status, 200);
    assert.equal((await monitorRes.json()).environment, "DEMO_ONLY");

    // Guests get isolated read-only $0 portfolio and are blocked (401) from all mutations
    const guestPort = await fetch(baseUrl + "/api/copy-trading/portfolio");
    assert.equal(guestPort.status, 200);
    const guestPortData = await guestPort.json();
    assert.equal(guestPortData.guest_read_only, true);
    assert.equal(guestPortData.summary.balance, 0);

    for (const [ep, body] of [
      ["/api/broker/connect", { type: "mt5", mode: "ea_bridge", account_id: "123", server: "Demo" }],
      ["/api/copy-trading/sandbox-capital", { amount: 10000 }],
      ["/api/copy-trading/subscribe", { strategyId: "ul-01-gold-trend", allocation: 1000 }],
      ["/api/portfolio/rebalance", { method: "RISK_WEIGHTED", total_capital: 10000 }],
      ["/api/portfolio/risk/kill-switch", { scope: "GLOBAL", active: true }],
      ["/api/ai/evaluate", { strategy_id: "ul-01-gold-trend", symbol: "XAUUSD" }]
    ]) {
      const blocked = await fetch(baseUrl + ep, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      assert.equal(blocked.status, 401, `Expected 401 for unauthenticated POST ${ep}`);
    }

    const sizePreview = await fetch(baseUrl + "/api/copy-trading/size-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ equity: 10000, risk_pct: 0.5, stop_distance: 5.0, tick_size: 0.01, tick_value: 1.0 })
    });
    assert.equal(sizePreview.status, 200);
    assert.equal((await sizePreview.json()).volume, 0.1);

    // 7. Portfolio starts at $0 (honest), sandbox funding enables MC execution, kill switch blocks
    const emptyPort = await fetch(baseUrl + "/api/copy-trading/portfolio", {
      headers: { Authorization: `Bearer ${invData.token}` }
    });
    assert.equal((await emptyPort.json()).summary.balance, 0);

    const fundRes = await fetch(baseUrl + "/api/copy-trading/sandbox-capital", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ amount: 10000 })
    });
    assert.equal(fundRes.status, 200);
    assert.equal((await fundRes.json()).balance, 10000);

    const mcExec = await fetch(baseUrl + "/api/copy-trading/mc-signal", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({
        symbol: "BTC/USD",
        spot: 97500,
        direction: "long",
        targetFirstProb: 0.68,
        stopFirstProb: 0.22,
        expectedReturn: 0.012,
        medianReturn: 0.010,
        stopPrice: 96525,
        targetPrice: 98962.5,
        execute: true
      })
    });
    assert.equal(mcExec.status, 200);
    const mcData = await mcExec.json();
    assert.equal(mcData.evaluation.qualified, true);
    assert.equal(mcData.executedTrades.length, 1);

    const signals = await fetch(
      baseUrl + `/api/broker/mt5/signals?token=${encodeURIComponent(connData.broker.bridgeToken)}`
    );
    assert.equal(signals.status, 200);
    const sigPayload = await signals.json();
    assert.equal(sigPayload.count, 1);
    assert.equal(sigPayload.signals[0].side, "BUY");

    // RBAC forbids investor from modifying hard risk policy or global kill switches
    const invBlockedRisk = await fetch(baseUrl + "/api/copy-trading/risk-config", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ kill_switch_active: true })
    });
    assert.equal(invBlockedRisk.status, 403);
    assert.equal((await invBlockedRisk.json()).code, "FORBIDDEN_ROLE");

    // Register a Risk Manager and a second Investor (IDOR / role tests)
    const riskReg = await fetch(baseUrl + "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Risk Officer", email: `risk-${Date.now()}@ultralob.io`, password: "secret123", role: "risk_manager" })
    });
    assert.equal(riskReg.status, 201);
    const riskData = await riskReg.json();

    const inv2Reg = await fetch(baseUrl + "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Other Investor", email: `inv2-${Date.now()}@ultralob.io`, password: "secret123", role: "investor" })
    });
    assert.equal(inv2Reg.status, 201);
    const inv2Data = await inv2Reg.json();

    // Cross-account IDOR: second investor cannot query first investor's portfolio or backtests
    const idorPort = await fetch(baseUrl + `/api/portfolio/summary?user_id=${encodeURIComponent(invData.user.id)}`, {
      headers: { Authorization: `Bearer ${inv2Data.token}` }
    });
    assert.equal(idorPort.status, 403);
    assert.equal((await idorPort.json()).code, "FORBIDDEN_OWNERSHIP");

    // Strategy provider role cannot rebalance allocations or execute trades
    const provRebalBlocked = await fetch(baseUrl + "/api/portfolio/rebalance", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${refreshed.token}` },
      body: JSON.stringify({ method: "RISK_WEIGHTED", total_capital: 25000 })
    });
    assert.equal(provRebalBlocked.status, 403);

    // Risk Manager activates GLOBAL kill switch on its risk scope; Risk Manager + cross-org block check
    const crossOrgRisk = await fetch(baseUrl + "/api/portfolio/risk/kill-switch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${riskData.token}` },
      body: JSON.stringify({ scope: "GLOBAL", target_user_id: invData.user.id, active: true })
    });
    assert.equal(crossOrgRisk.status, 403);

    const rmGlobalKs = await fetch(baseUrl + "/api/copy-trading/risk-config", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${riskData.token}` },
      body: JSON.stringify({ kill_switch_active: true })
    });
    assert.equal(rmGlobalKs.status, 200);
    // Investor can still execute on their own unhalted sandbox, verified below against kill-switch on Risk Officer eval

    // 8. WebSocket heartbeat & 404
    const socketUrl = baseUrl.replace(/^http/, "ws") + "/api/market-data?symbols=BTCUSDT";
    const socket = new WebSocket(socketUrl, { origin: baseUrl });
    const messages = [];
    socket.on("message", (raw) => {
      try { messages.push(JSON.parse(raw.toString())); } catch {}
    });
    await once(socket, "open");
    socket.send(JSON.stringify({ event: "ping", timestamp: Date.now() }));
    for (let attempt = 0; attempt < 20 && !messages.some((item) => item.event === "heartbeat"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(messages.some((item) => item.event === "heartbeat"));
    const socketClosed = once(socket, "close");
    socket.close(1000, "test complete");
    await socketClosed;

    const notFound = await fetch(baseUrl + "/unknown-route");
    assert.equal(notFound.status, 404);

    // 9. Phase 2 Research Backtest Bridge (Node -> Python -> Strategy Lifecycle)
    const invBlockedBt = await fetch(baseUrl + "/api/research/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ strategy_id: "ul-01-gold-trend", data_source: "SIMULATED_RESEARCH" })
    });
    assert.equal(invBlockedBt.status, 403);

    const simBt = await fetch(baseUrl + "/api/research/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${refreshed.token}` },
      body: JSON.stringify({
        strategy_id: "ul-01-gold-trend",
        data_source: "SIMULATED_RESEARCH",
        bars: 600,
        mc_simulations: 150
      })
    });
    assert.equal(simBt.status, 200);
    const simBtData = await simBt.json();
    assert.equal(simBtData.backtest.data_origin, "SIMULATED_RESEARCH");
    assert.equal(simBtData.backtest.can_promote_to_backtested, false);

    // Confirm synthetic run did NOT promote UL-01 past RESEARCH
    const ul01Check = await fetch(baseUrl + "/api/strategies/ul-01-gold-trend");
    assert.equal((await ul01Check.json()).lifecycle_status, "RESEARCH");

    // Guests do not see private SIMULATED_RESEARCH backtests; owner does
    const guestBtList = await fetch(baseUrl + "/api/research/backtests");
    assert.equal(guestBtList.status, 200);
    assert.equal((await guestBtList.json()).backtests.length, 0);

    const otherUserBtDetail = await fetch(baseUrl + `/api/research/backtests/${simBtData.backtest.id}`, {
      headers: { Authorization: `Bearer ${invData.token}` }
    });
    assert.equal(otherUserBtDetail.status, 403);

    const btList = await fetch(baseUrl + "/api/research/backtests", {
      headers: { Authorization: `Bearer ${refreshed.token}` }
    });
    assert.equal(btList.status, 200);
    assert.ok((await btList.json()).backtests.length >= 1);

    // 10. Phase 4 Portfolio Allocation & Hierarchical Risk Governance
    const rebal = await fetch(baseUrl + "/api/portfolio/rebalance", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({
        method: "RISK_WEIGHTED",
        total_capital: 25000,
        constraints: { max_allocation_per_strategy_pct: 35, max_instrument_exposure_pct: 60 }
      })
    });
    assert.equal(rebal.status, 200);
    const rebalData = await rebal.json();
    assert.equal(rebalData.plan.method, "RISK_WEIGHTED");
    assert.ok(rebalData.plan.allocations.length === 6);

    // Risk Manager toggles XAUUSD instrument kill switch on its governed scope; Investor gets 403 trying to toggle
    const invKsForbidden = await fetch(baseUrl + "/api/portfolio/risk/kill-switch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ scope: "INSTRUMENT", target: "XAUUSD", active: true, reason: "Unauthorized" })
    });
    assert.equal(invKsForbidden.status, 403);

    await fetch(baseUrl + "/api/copy-trading/risk-config", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${riskData.token}` },
      body: JSON.stringify({ kill_switch_active: false })
    });
    const instKs = await fetch(baseUrl + "/api/portfolio/risk/kill-switch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${riskData.token}` },
      body: JSON.stringify({ scope: "INSTRUMENT", target: "XAUUSD", active: true, reason: "Volatility spike halt" })
    });
    assert.equal(instKs.status, 200);

    const kelly = await fetch(baseUrl + "/api/portfolio/risk/kelly-research", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ win_probability: 0.6, payoff_ratio: 2.0 })
    });
    assert.equal(kelly.status, 200);
    const kellyPayload = await kelly.json();
    assert.equal(kellyPayload.classification, "SIMULATED_RESEARCH_INPUT_ONLY");
    assert.ok(kellyPayload.hard_capped_risk_pct <= 0.5);

    // 11. Phase 5 UltraLOB AI Advisory Pipeline, Ownership Check & Event Intelligence
    const aiEvalBlocked = await fetch(baseUrl + "/api/ai/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${riskData.token}` },
      body: JSON.stringify({ strategy_id: "ul-01-gold-trend", symbol: "XAUUSD", side: "BUY", proposed_risk_pct: 0.5 })
    });
    assert.equal(aiEvalBlocked.status, 200);
    const aiBlockedData = await aiEvalBlocked.json();
    assert.equal(aiBlockedData.decision.mode, "ADVISORY");
    // Must be halted because XAUUSD instrument kill switch is active on riskData's scope!
    assert.equal(aiBlockedData.decision.decision, "HALT");
    assert.equal(aiBlockedData.decision.gate_status, "BLOCKED_BY_RISK");
    assert.equal(aiBlockedData.decision.instrument, "XAUUSD");

    // Cross-user IDOR check on AI decision authorization & listing
    const invAiEval = await fetch(baseUrl + "/api/ai/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ strategy_id: "ul-01-gold-trend", symbol: "XAUUSD", side: "BUY", proposed_risk_pct: 0.5 })
    });
    assert.equal(invAiEval.status, 200);
    const invAiData = await invAiEval.json();

    // Another investor cannot authorize first investor's AI decision
    const idorAiAuth = await fetch(baseUrl + `/api/ai/decisions/${invAiData.decision.id}/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${inv2Data.token}` },
      body: JSON.stringify({ approve: true })
    });
    assert.equal(idorAiAuth.status, 403);
    assert.equal((await idorAiAuth.json()).code, "FORBIDDEN_OWNERSHIP");

    // Other investor's decision query only returns their own decisions (0)
    const inv2Decisions = await fetch(baseUrl + "/api/ai/decisions", {
      headers: { Authorization: `Bearer ${inv2Data.token}` }
    });
    assert.equal(inv2Decisions.status, 200);
    assert.equal((await inv2Decisions.json()).decisions.length, 0);

    const stressRes = await fetch(baseUrl + "/api/portfolio/risk/stress-test", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({})
    });
    assert.equal(stressRes.status, 200);
    const stressData = await stressRes.json();
    assert.equal(stressData.stress.data_origin, "SIMULATED_RESEARCH");
    assert.ok(Array.isArray(stressData.stress.scenarios) && stressData.stress.scenarios.length >= 3);

    // Step 11b: Validate Risk Engine STILL denies human authorization when kill switch is active on owner's scope
    await fetch(baseUrl + "/api/copy-trading/sandbox-capital", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ amount: 10000 })
    });
    await fetch(baseUrl + "/api/portfolio/risk/kill-switch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${riskData.token}` },
      body: JSON.stringify({ scope: "GLOBAL", active: false })
    });
    const rmAuthDenied = await fetch(baseUrl + `/api/ai/decisions/${aiBlockedData.decision.id}/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${riskData.token}` },
      body: JSON.stringify({ approve: true })
    });
    assert.equal(rmAuthDenied.status, 403);

    const macroEv = await fetch(baseUrl + "/api/ai/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ title: "FOMC Rate Statement", currency: "USD", impact: "HIGH", timestamp_utc: new Date(Date.now() + 600000).toISOString() })
    });
    assert.equal(macroEv.status, 201);
    const evStatusOwner = await fetch(baseUrl + "/api/ai/events?symbol=XAUUSD", {
      headers: { Authorization: `Bearer ${invData.token}` }
    });
    assert.equal(evStatusOwner.status, 200);
    assert.equal((await evStatusOwner.json()).restriction.status, "RESTRICTED");
    const evStatusOther = await fetch(baseUrl + "/api/ai/events?symbol=XAUUSD", {
      headers: { Authorization: `Bearer ${inv2Data.token}` }
    });
    assert.equal((await evStatusOther.json()).restriction.status, "CLEAR");

    // 12. Phase 6 Institutional Mandates, Statements, HWM Fee Framework & Enterprise API Keys
    const mandatePut = await fetch(baseUrl + "/api/institutional/mandate", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ risk_tolerance: "CONSERVATIVE", permitted_instruments: ["XAUUSD"], max_portfolio_drawdown_pct: 10 })
    });
    assert.equal(mandatePut.status, 200);

    // Mandate blocks subscribing to high-risk UL-04 on CONSERVATIVE mandate
    const mandateBlockedSub = await fetch(baseUrl + "/api/copy-trading/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ strategyId: "ul-04-gold-scalper", allocation: 2000, maxDrawdownPct: 8 })
    });
    assert.equal(mandateBlockedSub.status, 403);
    assert.equal((await mandateBlockedSub.json()).code, "MANDATE_RISK_TIER_EXCEEDED");

    const csvStmt = await fetch(baseUrl + "/api/institutional/statement?format=csv", {
      headers: { Authorization: `Bearer ${invData.token}` }
    });
    assert.equal(csvStmt.status, 200);
    assert.match(await csvStmt.text(), /StatementID,GeneratedAt,DataOrigin/);

    const feeRes = await fetch(baseUrl + "/api/institutional/fees/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ beginningEquity: 10000, endingEquity: 12000, highWaterMarkEquity: 10000, annualMgmtFeePct: 0, performanceFeePct: 15 })
    });
    assert.equal(feeRes.status, 200);
    const feeData = await feeRes.json();
    assert.equal(feeData.billing_status, "ACCOUNTING_FRAMEWORK_ONLY_NO_BILLING");
    assert.equal(feeData.performance_fee_usd, 300);

    const apiKeyCreate = await fetch(baseUrl + "/api/institutional/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ label: "CIO Read Feed" })
    });
    assert.equal(apiKeyCreate.status, 201);
    const keyPayload = await apiKeyCreate.json();
    assert.match(keyPayload.secret_key, /^ulb_ent_/);

    // Enterprise x-api-key resolves authenticated investor portfolio read-only, and refuses writes
    const entAccess = await fetch(baseUrl + "/api/portfolio/summary", {
      headers: { "x-api-key": keyPayload.secret_key }
    });
    assert.equal(entAccess.status, 200);
    assert.equal((await entAccess.json()).balance, 10000);

    const entWriteBlocked = await fetch(baseUrl + "/api/copy-trading/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": keyPayload.secret_key },
      body: JSON.stringify({ symbol: "XAUUSD", side: "BUY", qty: 0.01, price: 2650 })
    });
    assert.equal(entWriteBlocked.status, 403);
    assert.equal((await entWriteBlocked.json()).code, "API_KEY_READ_ONLY");

    // Revoking key invalidates x-api-key access immediately
    await fetch(baseUrl + `/api/institutional/api-keys/${keyPayload.key.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${invData.token}` }
    });
    const revokedAccess = await fetch(baseUrl + "/api/portfolio/summary", {
      headers: { "x-api-key": keyPayload.secret_key }
    });
    assert.equal((await revokedAccess.json()).balance, 0);

    // 13. Verify every frontend SPA page module exports render() & produces clean HTML
    const pageFiles = [
      "../public/js/pages/landing.js",
      "../public/js/pages/marketplace.js",
      "../public/js/pages/strategy-detail.js",
      "../public/js/pages/dashboard.js",
      "../public/js/pages/portfolio.js",
      "../public/js/pages/ai.js",
      "../public/js/pages/risk.js",
      "../public/js/pages/execution.js",
      "../public/js/pages/broker.js",
      "../public/js/pages/research.js",
      "../public/js/pages/reports.js",
      "../public/js/pages/admin.js",
      "../public/js/pages/terminal.js",
      "../public/js/pages/auth.js",
      "../public/js/pages/workspace.js"
    ];
    for (const file of pageFiles) {
      const mod = await import(file);
      assert.equal(typeof mod.render, "function", `${file} must export render()`);
      const html = mod.render({ path: file.includes("workspace") ? "/portfolio" : "/", id: "ul-01-gold-trend", params: new URLSearchParams() });
      assert.equal(typeof html, "string");
      assert.ok(html.length > 50, `${file} render() returned empty HTML`);
    }
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
