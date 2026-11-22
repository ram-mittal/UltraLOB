export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  const serviceUrl = process.env.PRICING_SERVICE_URL;
  if (!serviceUrl) {
    return res.status(503).json({
      error: "Pricing service is not configured",
      hint: "Set PRICING_SERVICE_URL in Vercel to the origin of the deployed UltraLOB pricing service.",
    });
  }

  const isHealthCheck = req.method === "GET";
  if (!isHealthCheck && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const baseUrl = serviceUrl.replace(/\/+$/, "");
  const endpoint = isHealthCheck
    ? `${baseUrl}/health`
    : `${baseUrl}/pricing/monte-carlo`;

  const headers = { Accept: "application/json" };
  if (!isHealthCheck) headers["Content-Type"] = "application/json";
  if (process.env.PRICING_API_KEY) {
    headers.Authorization = `Bearer ${process.env.PRICING_API_KEY}`;
  }

  try {
    const upstream = await fetch(endpoint, {
      method: isHealthCheck ? "GET" : "POST",
      headers,
      ...(isHealthCheck ? {} : { body: JSON.stringify(req.body ?? {}) }),
      signal: AbortSignal.timeout(125000),
    });

    const raw = await upstream.text();
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { error: "Pricing service returned a non-JSON response" };
    }
    return res.status(upstream.status).json(payload);
  } catch (error) {
    const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
    return res.status(timeout ? 504 : 502).json({
      error: timeout ? "Pricing service timed out" : "Could not reach the pricing service",
      detail: error?.message ?? "Upstream connection failed",
    });
  }
}
