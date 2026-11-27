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

    // 6. Broker connection rejects LIVE mode, pairs DEMO mode
    const liveBlocked = await fetch(baseUrl + "/api/broker/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({
        type: "exness",
        environment: "LIVE",
        server: "Exness-MT5Real",
        account_id: "19283746",
        api_key: "ex-key",
        api_secret: "ex-sec"
      })
    });
    assert.equal(liveBlocked.status, 403);

    const conn = await fetch(baseUrl + "/api/broker/connect", {
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
    assert.equal(conn.status, 200);
    const connData = await conn.json();
    assert.equal(connData.connected, true);
    assert.equal(connData.broker.environment, "DEMO");
    assert.ok(connData.broker.bridgeToken);

    const eaFile = await fetch(baseUrl + "/api/broker/mt5/ea", {
      headers: { Authorization: `Bearer ${invData.token}` }
    });
    assert.equal(eaFile.status, 200);
    const eaSource = await eaFile.text();
    assert.match(eaSource, /UltraLOB Bridge EA/);
    assert.match(eaSource, /ACCOUNT_TRADE_MODE_DEMO/);

    const monitorRes = await fetch(baseUrl + "/api/execution/monitor");
    assert.equal(monitorRes.status, 200);
    assert.equal((await monitorRes.json()).environment, "DEMO_ONLY");

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

    // Kill switch blocks new executions
    await fetch(baseUrl + "/api/copy-trading/risk-config", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ kill_switch_active: true })
    });
    const blockedExec = await fetch(baseUrl + "/api/copy-trading/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ symbol: "BTC/USD", side: "BUY", qty: 0.01, price: 97500 })
    });
    assert.equal(blockedExec.status, 403);
    assert.equal((await blockedExec.json()).code, "GLOBAL_KILL_SWITCH_ACTIVE");

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

    const btList = await fetch(baseUrl + "/api/research/backtests");
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

    // Strategy-scoped kill switch blocks that strategy independently
    await fetch(baseUrl + "/api/copy-trading/risk-config", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ kill_switch_active: false })
    });
    const instKs = await fetch(baseUrl + "/api/portfolio/risk/kill-switch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ scope: "INSTRUMENT", target: "XAUUSD", active: true, reason: "Volatility spike halt" })
    });
    assert.equal(instKs.status, 200);

    const blockedGold = await fetch(baseUrl + "/api/copy-trading/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ symbol: "XAUUSD", side: "BUY", qty: 0.1, price: 2650 })
    });
    assert.equal(blockedGold.status, 403);
    assert.equal((await blockedGold.json()).code, "INSTRUMENT_KILL_SWITCH_ACTIVE");

    const kelly = await fetch(baseUrl + "/api/portfolio/risk/kelly-research", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ win_probability: 0.6, payoff_ratio: 2.0 })
    });
    assert.equal(kelly.status, 200);
    const kellyPayload = await kelly.json();
    assert.equal(kellyPayload.classification, "SIMULATED_RESEARCH_INPUT_ONLY");
    assert.ok(kellyPayload.hard_capped_risk_pct <= 0.5);

    // 11. Phase 5 UltraLOB AI Advisory Pipeline & Event Intelligence
    const aiEvalBlocked = await fetch(baseUrl + "/api/ai/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ strategy_id: "ul-01-gold-trend", symbol: "XAUUSD", side: "BUY", proposed_risk_pct: 0.5 })
    });
    assert.equal(aiEvalBlocked.status, 200);
    const aiBlockedData = await aiEvalBlocked.json();
    assert.equal(aiBlockedData.decision.mode, "ADVISORY");
    // Must be blocked because XAUUSD instrument kill switch is still active from step 10!
    assert.equal(aiBlockedData.decision.decision, "BLOCKED_BY_RISK");

    // Human authorization must ALSO be refused by Risk Engine while kill switch is active
    const authDenied = await fetch(baseUrl + `/api/ai/decisions/${aiBlockedData.decision.id}/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ approve: true })
    });
    assert.equal(authDenied.status, 403);

    const macroEv = await fetch(baseUrl + "/api/ai/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invData.token}` },
      body: JSON.stringify({ title: "FOMC Rate Statement", currency: "USD", impact: "HIGH", timestamp_utc: new Date(Date.now() + 600000).toISOString() })
    });
    assert.equal(macroEv.status, 201);
    const evStatus = await fetch(baseUrl + "/api/ai/events?symbol=XAUUSD");
    assert.equal(evStatus.status, 200);
    assert.equal((await evStatus.json()).restriction.status, "RESTRICTED");

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
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
