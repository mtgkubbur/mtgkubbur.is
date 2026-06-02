import * as Plot from "/static/js/vendor/plot-0.6.17.min.js";
import {
  chartTheme,
  isMonth,
  basePlot,
  baseGridStyle,
  TIER_LABEL,
  TIER_ORDER,
  tierColours,
} from "/static/js/theme.js";

const S = window.STR;

export function render(container, history) {
  if (!container) return;
  const t = chartTheme();
  const colours = tierColours(t);
  const labels = TIER_ORDER.map((tier) => TIER_LABEL[tier]); // ["High","Medium","Low","Annað"]
  const range = TIER_ORDER.map((tier) => colours[tier]); // [red, blue, green, gold]

  const data = (history || []).map((d) => ({ ...d, date: new Date(d.date) }));
  // Flatten strength{} → one row per (date, tier) with non-null gamma.
  const gammaData = [];
  for (const d of data) {
    const strength = d.strength || {};
    for (const tier of TIER_ORDER) {
      const g = strength[tier];
      if (g != null)
        gammaData.push({ date: d.date, tier: TIER_LABEL[tier], gamma: g });
    }
  }

  const cell = document.getElementById("cell-strength");
  if (gammaData.length === 0) {
    if (cell) cell.style.display = "none";
    container.replaceChildren();
    return;
  }
  if (cell) cell.style.display = "";

  // Endpoint dots: latest gamma per tier (at that tier's last non-null date).
  const lastByTier = [];
  for (const tier of TIER_ORDER) {
    const label = TIER_LABEL[tier];
    const rows = gammaData.filter((r) => r.tier === label);
    if (rows.length) lastByTier.push(rows[rows.length - 1]);
  }

  const chart = Plot.plot({
    ...basePlot(t, container, 340),
    x: { type: "time", label: null, axis: null },
    y: { label: null, axis: null },
    color: { domain: labels, range: range, legend: true },
    marks: [
      Plot.gridY(baseGridStyle(t)),
      Plot.axisX({
        ticks: Plot.utcMonth,
        tickFormat: isMonth,
        tickSize: 4,
        tickPadding: 6,
        stroke: t.grid,
        fill: t.muted,
      }),
      Plot.axisY({
        label: S.axis_strength,
        labelAnchor: "top",
        labelArrow: "none",
        tickSize: 0,
        tickPadding: 8,
        fill: t.muted,
        textStroke: t.haloBg,
        textStrokeWidth: 3,
      }),
      Plot.ruleY([0], {
        stroke: t.muted,
        strokeDasharray: "6,4",
        strokeOpacity: 0.5,
      }),
      Plot.lineY(gammaData, {
        x: "date",
        y: "gamma",
        stroke: "tier",
        strokeWidth: 2,
        curve: "catmull-rom",
      }),
      Plot.dot(lastByTier, {
        x: "date",
        y: "gamma",
        fill: "tier",
        r: 4,
        stroke: t.haloBg,
        strokeWidth: 2,
      }),
    ],
  });
  container.replaceChildren(chart);
}
