// Institutional Chart.js Wrappers (Deep Graphite, Restrained Blue, Muted Green/Red)

const charts = {};

export function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

export function destroyAllCharts() {
  Object.keys(charts).forEach((id) => destroyChart(id));
}

function normalizeEquityPoints(points = []) {
  return (points || []).map((pt, idx) => {
    if (typeof pt === "number") return { label: `T${idx + 1}`, val: pt };
    const val = Number(pt?.equity ?? pt?.value ?? pt?.y ?? 0);
    const rawLabel = pt?.date || pt?.timestamp || pt?.time || pt?.label || `T${idx + 1}`;
    const label = typeof rawLabel === "string" && rawLabel.includes("T") ? rawLabel.slice(0, 10) : String(rawLabel);
    return { label, val: Number.isFinite(val) ? val : 0 };
  });
}

export function createEquityCurve(canvasId, points, label = "Equity ($)") {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return null;

  const norm = normalizeEquityPoints(points);
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height || 260);
  grad.addColorStop(0, "rgba(59, 130, 246, 0.22)");
  grad.addColorStop(1, "rgba(59, 130, 246, 0.0)");

  charts[canvasId] = new Chart(ctx, {
    type: "line",
    data: {
      labels: norm.map((p) => p.label),
      datasets: [{
        label,
        data: norm.map((p) => p.val),
        borderColor: "#3b82f6",
        backgroundColor: grad,
        borderWidth: 1.75,
        fill: true,
        tension: 0.18,
        pointRadius: norm.length > 40 ? 0 : 2,
        pointHoverRadius: 4,
        pointBackgroundColor: "#3b82f6"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#11151d",
          titleColor: "#e6edf6",
          bodyColor: "#94a3b8",
          borderColor: "#2e3748",
          borderWidth: 1,
          padding: 8,
          callbacks: {
            label: (c) => `${label}: $${Number(c.parsed.y).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(148, 163, 184, 0.06)" },
          ticks: { color: "#64748b", maxTicksLimit: 8, font: { size: 10, family: "IBM Plex Mono" } }
        },
        y: {
          grid: { color: "rgba(148, 163, 184, 0.08)" },
          ticks: {
            color: "#64748b",
            font: { size: 10, family: "IBM Plex Mono" },
            callback: (v) => "$" + Number(v).toLocaleString()
          }
        }
      }
    }
  });
  return charts[canvasId];
}

export function createDrawdownChart(canvasId, drawdowns) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return null;

  const series = (drawdowns || []).map((d, i) => ({
    label: typeof d === "object" ? String(d.date || d.label || d.timestamp || `T${i + 1}`).slice(0, 10) : `T${i + 1}`,
    val: typeof d === "object" ? -Math.abs(Number(d.drawdown ?? d.value ?? 0)) : -Math.abs(Number(d || 0))
  }));

  charts[canvasId] = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels: series.map((s) => s.label),
      datasets: [{
        label: "Drawdown %",
        data: series.map((s) => s.val),
        borderColor: "#ef4444",
        backgroundColor: "rgba(239, 68, 68, 0.14)",
        borderWidth: 1.5,
        fill: true,
        tension: 0.15,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: "rgba(148, 163, 184, 0.05)" }, ticks: { color: "#64748b", maxTicksLimit: 8, font: { size: 10, family: "IBM Plex Mono" } } },
        y: {
          max: 0,
          grid: { color: "rgba(148, 163, 184, 0.08)" },
          ticks: { color: "#64748b", font: { size: 10, family: "IBM Plex Mono" }, callback: (v) => `${Number(v).toFixed(1)}%` }
        }
      }
    }
  });
  return charts[canvasId];
}

export function createDrawdownDistributionChart(canvasId, buckets = []) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return null;

  charts[canvasId] = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: buckets.map((b) => b.label),
      datasets: [{
        label: "Observations",
        data: buckets.map((b) => Number(b.count || 0)),
        backgroundColor: ["rgba(59,130,246,0.55)", "rgba(59,130,246,0.65)", "rgba(234,179,8,0.6)", "rgba(239,68,68,0.65)", "rgba(239,68,68,0.85)"],
        borderRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#94a3b8", font: { size: 10, family: "IBM Plex Mono" } } },
        y: { beginAtZero: true, grid: { color: "rgba(148, 163, 184, 0.08)" }, ticks: { color: "#64748b", precision: 0, font: { size: 10, family: "IBM Plex Mono" } } }
      }
    }
  });
  return charts[canvasId];
}

export function createMonthlyReturnsBar(canvasId, monthlyData = []) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return null;

  const items = (monthlyData || []).map((m, i) => ({
    label: typeof m === "object" ? (m.month || m.label || `M${i + 1}`) : `M${i + 1}`,
    val: typeof m === "object" ? Number(m.return_pct ?? m.value ?? 0) : Number(m || 0)
  }));

  charts[canvasId] = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: items.map((i) => i.label),
      datasets: [{
        label: "Monthly Return %",
        data: items.map((i) => i.val),
        backgroundColor: items.map((i) => i.val >= 0 ? "rgba(34, 197, 94, 0.65)" : "rgba(239, 68, 68, 0.65)"),
        borderColor: items.map((i) => i.val >= 0 ? "#22c55e" : "#ef4444"),
        borderWidth: 1,
        borderRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#64748b", font: { size: 10, family: "IBM Plex Mono" } } },
        y: { grid: { color: "rgba(148, 163, 184, 0.08)" }, ticks: { color: "#64748b", font: { size: 10, family: "IBM Plex Mono" }, callback: (v) => v + "%" } }
      }
    }
  });
  return charts[canvasId];
}

export function createMonteCarloFan(canvasId, mc) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined" || !mc) return null;

  const paths = mc.percentile_paths || mc.percentiles || {};
  const p5 = paths.p5 || [];
  const p25 = paths.p25 || [];
  const p50 = paths.p50 || [];
  const p75 = paths.p75 || [];
  const p95 = paths.p95 || [];
  const days = paths.days || p50.map((_, i) => i);
  if (!p50.length) return null;

  const ds = [
    { label: "95th Percentile", data: p95, borderColor: "rgba(34, 197, 94, 0.45)", borderWidth: 1, borderDash: [4, 4], fill: false, pointRadius: 0 },
    p75.length ? { label: "75th Percentile", data: p75, borderColor: "rgba(59, 130, 246, 0.45)", backgroundColor: "rgba(59, 130, 246, 0.08)", borderWidth: 1, fill: "+1", pointRadius: 0 } : null,
    { label: "Median Path (P50)", data: p50, borderColor: "#3b82f6", borderWidth: 2, fill: false, pointRadius: 0 },
    p25.length ? { label: "25th Percentile", data: p25, borderColor: "rgba(59, 130, 246, 0.45)", backgroundColor: "rgba(59, 130, 246, 0.08)", borderWidth: 1, fill: "-1", pointRadius: 0 } : null,
    { label: "5th Percentile (Tail)", data: p5, borderColor: "rgba(239, 68, 68, 0.55)", borderWidth: 1, borderDash: [4, 4], fill: false, pointRadius: 0 }
  ].filter(Boolean);

  charts[canvasId] = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels: days.map((d) => (Number(d) === 0 ? "Start" : `D${d}`)),
      datasets: ds
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#94a3b8", font: { size: 10, family: "IBM Plex Mono" }, boxWidth: 10 } }
      },
      scales: {
        x: { grid: { color: "rgba(148, 163, 184, 0.05)" }, ticks: { color: "#64748b", maxTicksLimit: 10, font: { size: 10, family: "IBM Plex Mono" } } },
        y: { grid: { color: "rgba(148, 163, 184, 0.08)" }, ticks: { color: "#64748b", font: { size: 10, family: "IBM Plex Mono" }, callback: (v) => "$" + Number(v).toLocaleString() } }
      }
    }
  });
  return charts[canvasId];
}

export function createDonutChart(canvasId, labels, values, colors) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return null;

  charts[canvasId] = new Chart(canvas.getContext("2d"), {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors || ["#3b82f6", "#22c55e", "#eab308", "#94a3b8", "#ef4444", "#0ea5e9"],
        borderColor: "#11151d",
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: {
        legend: {
          position: "right",
          labels: { color: "#94a3b8", font: { size: 11, family: "Inter" }, padding: 10, boxWidth: 10 }
        }
      }
    }
  });
  return charts[canvasId];
}
