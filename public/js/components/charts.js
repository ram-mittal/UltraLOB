// Chart.js Wrapper Utilities for UltraLOB
const chartInstances = new Map();

function destroyChart(canvasId) {
  const existing = chartInstances.get(canvasId);
  if (existing) { existing.destroy(); chartInstances.delete(canvasId); }
}

const defaultFont = { family: "'Inter', 'system-ui', sans-serif", size: 11 };
const gridColor = 'rgba(148,163,184,0.06)';
const tickColor = '#64748b';

export function createEquityCurve(canvasId, labels, data, options = {}) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const gradient = canvas.getContext('2d').createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, 'rgba(99,102,241,0.25)');
  gradient.addColorStop(1, 'rgba(99,102,241,0.0)');

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: options.label || 'Equity',
        data,
        borderColor: '#6366f1',
        backgroundColor: gradient,
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: '#6366f1',
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.95)',
          titleFont: defaultFont,
          bodyFont: defaultFont,
          borderColor: 'rgba(99,102,241,0.2)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (ctx) => `${options.prefix || '$'}${ctx.parsed.y.toLocaleString()}`
          }
        }
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: tickColor, font: defaultFont, maxTicksLimit: 8 } },
        y: { grid: { color: gridColor }, ticks: { color: tickColor, font: defaultFont, callback: v => `${options.prefix || '$'}${v.toLocaleString()}` } }
      }
    }
  });
  chartInstances.set(canvasId, chart);
  return chart;
}

export function createDrawdownChart(canvasId, labels, data) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const gradient = canvas.getContext('2d').createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, 'rgba(239,68,68,0.0)');
  gradient.addColorStop(1, 'rgba(239,68,68,0.2)');

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Drawdown',
        data,
        borderColor: '#ef4444',
        backgroundColor: gradient,
        borderWidth: 1.5,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.95)',
          callbacks: { label: (ctx) => `${ctx.parsed.y.toFixed(2)}%` }
        }
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: tickColor, font: defaultFont, maxTicksLimit: 8 } },
        y: { grid: { color: gridColor }, ticks: { color: tickColor, font: defaultFont, callback: v => `${v}%` }, reverse: false }
      }
    }
  });
  chartInstances.set(canvasId, chart);
  return chart;
}

export function createMonthlyReturnsBar(canvasId, labels, data) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const colors = data.map(v => v >= 0 ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.7)');
  const borders = data.map(v => v >= 0 ? '#10b981' : '#ef4444');

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Monthly Return',
        data,
        backgroundColor: colors,
        borderColor: borders,
        borderWidth: 1,
        borderRadius: 3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx) => `${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y.toFixed(2)}%` }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: tickColor, font: defaultFont } },
        y: { grid: { color: gridColor }, ticks: { color: tickColor, font: defaultFont, callback: v => `${v}%` } }
      }
    }
  });
  chartInstances.set(canvasId, chart);
  return chart;
}

export function createMonteCarloFan(canvasId, labels, scenarios) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const datasets = [];
  const colors = [
    { border: 'rgba(99,102,241,0.15)', bg: 'rgba(99,102,241,0.03)' },  // P5
    { border: 'rgba(99,102,241,0.3)', bg: 'rgba(99,102,241,0.06)' },   // P25
    { border: '#6366f1', bg: 'rgba(99,102,241,0.1)' },                  // Median
    { border: 'rgba(99,102,241,0.3)', bg: 'rgba(99,102,241,0.06)' },   // P75
    { border: 'rgba(99,102,241,0.15)', bg: 'rgba(99,102,241,0.03)' },  // P95
  ];
  const names = ['P5 (Bear)', 'P25', 'Median', 'P75', 'P95 (Bull)'];

  scenarios.forEach((data, i) => {
    datasets.push({
      label: names[i] || `Scenario ${i+1}`,
      data,
      borderColor: colors[i]?.border || '#6366f1',
      backgroundColor: 'transparent',
      borderWidth: i === 2 ? 2.5 : 1,
      borderDash: i === 2 ? [] : [4, 4],
      tension: 0.3,
      pointRadius: 0,
      fill: false,
    });
  });

  const chart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: tickColor, font: defaultFont, boxWidth: 20 } },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.95)',
          callbacks: { label: (ctx) => `${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString()}` }
        }
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: tickColor, font: defaultFont, maxTicksLimit: 8 } },
        y: { grid: { color: gridColor }, ticks: { color: tickColor, font: defaultFont, callback: v => `$${v.toLocaleString()}` } }
      }
    }
  });
  chartInstances.set(canvasId, chart);
  return chart;
}

export function createDonutChart(canvasId, labels, data, colors) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 4 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { position: 'bottom', labels: { color: tickColor, font: defaultFont, padding: 12, usePointStyle: true } }
      }
    }
  });
  chartInstances.set(canvasId, chart);
  return chart;
}

export function destroyAllCharts() {
  chartInstances.forEach(c => c.destroy());
  chartInstances.clear();
}
