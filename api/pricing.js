const configuredFallbackPaths = Number.parseInt(process.env.PRICING_FALLBACK_MAX_PATHS || "10000000", 10);
const MAX_FALLBACK_PATHS = Number.isSafeInteger(configuredFallbackPaths) && configuredFallbackPaths >= 4
  ? Math.min(configuredFallbackPaths, 50000000)
  : 10000000;
const NORMAL_95 = 1.959963984540054;
const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);

function parseRequestBody(body) {
  if (body == null || body === "") return {};
  if (typeof body === "string") return JSON.parse(body);
  return body;
}

function validateRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Request body must be a JSON object." };
  }
  const fields = [
    ["spot", 100.0, 0, 1000000000, false],
    ["strike", 100.0, 0, 1000000000, false],
    ["risk_free_rate", 0.05, -1, 1, true],
    ["dividend_yield", 0.0, -1, 1, true],
    ["volatility", 0.2, 0, 5, true],
    ["maturity_years", 1.0, 0, 100, false]
  ];
  const values = {};
  for (const [name, fallback, min, max, minInclusive] of fields) {
    const value = input[name] === undefined ? fallback : Number(input[name]);
    if (!Number.isFinite(value) || (minInclusive ? value < min : value <= min) || value > max) {
      return { error: name + " must be " + (minInclusive ? "at least " : "greater than ") + min + " and at most " + max + "." };
    }
    values[name] = value;
  }

  const paths = input.paths === undefined ? 1000000 : Number(input.paths);
  if (!Number.isSafeInteger(paths) || paths < 4 || paths > 50000000 || paths % 2 !== 0) {
    return { error: "paths must be an even integer between 4 and 50,000,000." };
  }
  const seed = input.seed === undefined ? 42 : Number(input.seed);
  if (!Number.isSafeInteger(seed) || seed < 0) {
    return { error: "seed must be a non-negative safe integer." };
  }
  const backend = input.backend === undefined ? "auto" : input.backend;
  if (!["auto", "cpu", "cuda"].includes(backend)) {
    return { error: "backend must be auto, cpu, or cuda." };
  }
  return { value: { ...values, paths, seed, backend } };
}

function normalCdf(x) {
  // Abramowitz-Stegun approximation; absolute error is below 8e-8.
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * ax);
  const polynomial = t * (
    0.319381530 + t * (
      -0.356563782 + t * (
        1.781477937 + t * (
          -1.821255978 + t * 1.330274429
        )
      )
    )
  );
  const tail = Math.exp(-0.5 * ax * ax) / SQRT_TWO_PI * polynomial;
  return x >= 0 ? 1 - tail : tail;
}

function blackScholes(input) {
  const spot = input.spot;
  const strike = input.strike;
  const rate = input.risk_free_rate;
  const dividend = input.dividend_yield;
  const volatility = input.volatility;
  const maturity = input.maturity_years;
  const discountRate = Math.exp(-rate * maturity);
  const discountDividend = Math.exp(-dividend * maturity);
  if (volatility === 0) {
    const forward = spot * Math.exp((rate - dividend) * maturity);
    return {
      call: discountRate * Math.max(forward - strike, 0),
      put: discountRate * Math.max(strike - forward, 0)
    };
  }
  const sigmaRootT = volatility * Math.sqrt(maturity);
  const d1 = (Math.log(spot / strike) + (rate - dividend + 0.5 * volatility * volatility) * maturity) / sigmaRootT;
  const d2 = d1 - sigmaRootT;
  return {
    call: spot * discountDividend * normalCdf(d1) - strike * discountRate * normalCdf(d2),
    put: strike * discountRate * normalCdf(-d2) - spot * discountDividend * normalCdf(-d1)
  };
}

function estimate(sum, squareSum, observations, discount) {
  const n = observations;
  const mean = sum / n;
  const centered = Math.max(0, squareSum - (sum * sum) / n);
  const variance = n > 1 ? centered / (n - 1) : 0;
  const standardError = discount * Math.sqrt(variance / n);
  const price = discount * mean;
  const margin = NORMAL_95 * standardError;
  return {
    price,
    standard_error: standardError,
    confidence_low_95: price - margin,
    confidence_high_95: price + margin
  };
}

function runFallbackPricing(input) {
  if (input.paths > MAX_FALLBACK_PATHS) {
    const error = new Error(
      "The built-in JavaScript CPU fallback is capped at " + MAX_FALLBACK_PATHS.toLocaleString() +
      " paths. Connect a dedicated pricing service for larger simulations or CUDA execution."
    );
    error.statusCode = 413;
    throw error;
  }

  const pairCount = input.paths / 2;
  const drift = (input.risk_free_rate - input.dividend_yield - 0.5 * input.volatility * input.volatility) * input.maturity_years;
  const diffusion = input.volatility * Math.sqrt(input.maturity_years);
  const discount = Math.exp(-input.risk_free_rate * input.maturity_years);

  // Mulberry32 gives deterministic, seeded uniforms without native dependencies.
  const lowSeed = input.seed >>> 0;
  const highSeed = Math.floor(input.seed / 0x100000000) >>> 0;
  let state = (lowSeed ^ Math.imul(highSeed, 0x9e3779b9)) >>> 0;
  function uniform() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  let callSum = 0;
  let callSquareSum = 0;
  let putSum = 0;
  let putSquareSum = 0;
  const start = process.hrtime.bigint();
  for (let i = 0; i < pairCount; i += 1) {
    let z = 0;
    if (diffusion !== 0) {
      const u1 = Math.max(uniform(), Number.MIN_VALUE);
      const u2 = uniform();
      z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
    const up = input.spot * Math.exp(drift + diffusion * z);
    const down = input.spot * Math.exp(drift - diffusion * z);
    const callPayoff = 0.5 * (Math.max(up - input.strike, 0) + Math.max(down - input.strike, 0));
    const putPayoff = 0.5 * (Math.max(input.strike - up, 0) + Math.max(input.strike - down, 0));
    callSum += callPayoff;
    callSquareSum += callPayoff * callPayoff;
    putSum += putPayoff;
    putSquareSum += putPayoff * putPayoff;
  }
  if (![callSum, callSquareSum, putSum, putSquareSum].every(Number.isFinite)) {
    const error = new Error("Simulation produced non-finite values. Reduce volatility or maturity and try again.");
    error.statusCode = 422;
    throw error;
  }
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  const analytic = blackScholes(input);
  const elapsedSeconds = Math.max(elapsedMs / 1000, 1e-9);

  return {
    backend: "CPU",
    execution_engine: "javascript-fallback",
    execution_location: "node-api",
    paths: input.paths,
    seed: input.seed,
    elapsed_ms: elapsedMs,
    paths_per_second: input.paths / elapsedSeconds,
    service_elapsed_ms: elapsedMs,
    inputs: {
      spot: input.spot,
      strike: input.strike,
      risk_free_rate: input.risk_free_rate,
      dividend_yield: input.dividend_yield,
      volatility: input.volatility,
      maturity_years: input.maturity_years
    },
    call: { ...estimate(callSum, callSquareSum, pairCount, discount), black_scholes: analytic.call },
    put: { ...estimate(putSum, putSquareSum, pairCount, discount), black_scholes: analytic.put },
    model: "risk-neutral-gbm-european-vanilla",
    variance_reduction: "antithetic-variates",
    gpu_utilization: null
  };
}

function fallbackHealth(res, reason) {
  return res.status(200).json({
    status: "ok",
    service: "ultralob-javascript-cpu-fallback",
    native_library_available: false,
    cuda_build_enabled: false,
    fallback_enabled: true,
    fallback_max_paths: MAX_FALLBACK_PATHS,
    execution_location: "node-api",
    upstream_service_available: false,
    upstream_service_detail: reason || "No external pricing service is configured."
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const serviceUrl = process.env.PRICING_SERVICE_URL;
  const isHealthCheck = req.method === "GET";
  if (!isHealthCheck && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (isHealthCheck && !serviceUrl) return fallbackHealth(res);

  if (isHealthCheck) {
    const baseUrl = serviceUrl.replace(/\/+$/, "");
    try {
      const upstream = await fetch(baseUrl + "/health", {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000)
      });
      const raw = await upstream.text();
      let payload;
      try { payload = raw ? JSON.parse(raw) : {}; }
      catch { payload = { error: "Pricing service returned a non-JSON response" }; }
      if (upstream.ok && payload.status === "ok" && payload.native_library_available !== false) {
        return res.status(200).json(payload);
      }
      return fallbackHealth(res, payload.detail || payload.error || ("Upstream pricing service returned HTTP " + upstream.status + "."));
    } catch (error) {
      return fallbackHealth(res, error?.message || "Could not reach the external pricing service.");
    }
  }

  let input;
  try {
    const parsed = parseRequestBody(req.body);
    const validation = validateRequest(parsed);
    if (validation.error) return res.status(422).json({ error: validation.error });
    input = validation.value;
  } catch (error) {
    return res.status(400).json({ error: "Invalid JSON request body: " + error.message });
  }

  if (!serviceUrl) {
    if (input.backend === "cuda") {
      return res.status(503).json({
        error: "CUDA pricing is not connected",
        hint: "Deploy pricing_service/Dockerfile.cuda on a GPU host, then set PRICING_SERVICE_URL and PRICING_API_KEY in your hosting environment variables."
      });
    }
    try {
      return res.status(200).json(runFallbackPricing(input));
    } catch (error) {
      return res.status(error.statusCode || 500).json({ error: error.message || "CPU fallback pricing failed" });
    }
  }

  const baseUrl = serviceUrl.replace(/\/+$/, "");
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  if (process.env.PRICING_API_KEY) headers.Authorization = "Bearer " + process.env.PRICING_API_KEY;

  try {
    const upstream = await fetch(baseUrl + "/pricing/monte-carlo", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(125000)
    });
    const raw = await upstream.text();
    let payload;
    try { payload = raw ? JSON.parse(raw) : {}; }
    catch { payload = { error: "Pricing service returned a non-JSON response" }; }
    const validPricingPayload = payload && typeof payload === "object" && payload.call && payload.put;
    if (upstream.ok && validPricingPayload) return res.status(upstream.status).json(payload);

    if (input.backend !== "cuda" && (
      upstream.status >= 500 || upstream.ok || [401, 403, 408, 429].includes(upstream.status)
    )) {
      try {
        const reason = upstream.ok
          ? "External pricing service returned an invalid pricing payload."
          : "External pricing service returned HTTP " + upstream.status + ".";
        const fallback = runFallbackPricing(input);
        fallback.fallback_reason = reason + " Executed on the built-in CPU fallback.";
        return res.status(200).json(fallback);
      } catch (error) {
        return res.status(error.statusCode || 502).json({ error: error.message || payload?.error || "Pricing service failed" });
      }
    }
    return res.status(upstream.ok ? 502 : upstream.status).json(payload);
  } catch (error) {
    if (input.backend !== "cuda") {
      try {
        const fallback = runFallbackPricing(input);
        fallback.fallback_reason = "External pricing service is unreachable; executed on the built-in CPU fallback.";
        return res.status(200).json(fallback);
      } catch (fallbackError) {
        return res.status(fallbackError.statusCode || 502).json({ error: fallbackError.message || "Pricing service and CPU fallback failed" });
      }
    }
    const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
    return res.status(timeout ? 504 : 502).json({
      error: timeout ? "Pricing service timed out" : "Could not reach the pricing service",
      detail: error?.message ?? "Upstream connection failed"
    });
  }
}
