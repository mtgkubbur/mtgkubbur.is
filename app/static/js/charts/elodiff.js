// Chart 6 — ELO-munur yfir tíma (head-to-head ELO difference over time).
import * as Plot from "/static/js/vendor/plot-0.6.17.min.js";
import { chartTheme, isMonth } from "/static/js/theme.js";

// history1 / history2: arrays of {date: string|Date, score_median: number} (player files, oldest-first).
export function render(container, p1Name, p2Name, history1, history2) {
  container.replaceChildren(); // clear any previous render

  const toDay = (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.getTime();
  };
  // Map p2's score by day so we can difference on shared dates only.
  const p2ByDay = new Map();
  for (const h of history2 || []) {
    if (h && h.score_median != null)
      p2ByDay.set(toDay(h.date), +h.score_median);
  }
  const eloDiff = [];
  for (const h of history1 || []) {
    if (!h || h.score_median == null) continue;
    const key = toDay(h.date);
    if (p2ByDay.has(key)) {
      eloDiff.push({
        date: new Date(key),
        diff: +h.score_median - p2ByDay.get(key),
      });
    }
  }
  eloDiff.sort((a, b) => a.date - b.date);

  if (eloDiff.length < 2) return; // parity: need ≥2 shared dates

  const t = chartTheme(); // read INSIDE render so theme flip recolours
  const latest = eloDiff[eloDiff.length - 1];
  const latestColour = latest.diff >= 0 ? t.green : t.red;

  const chart = Plot.plot({
    width: container.clientWidth || 580,
    height: 280,
    marginLeft: 55,
    marginRight: 20,
    marginBottom: 40,
    marginTop: 12,
    style: {
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: "12px",
      background: "transparent",
      color: t.text,
    },
    x: { type: "time", label: null, axis: null },
    y: { label: null, axis: null },
    marks: [
      Plot.gridY({
        stroke: t.grid,
        strokeOpacity: 0.6,
        strokeDasharray: "3,4",
      }),
      Plot.axisX({
        tickSize: 4,
        tickPadding: 6,
        stroke: t.grid,
        fill: t.muted,
        ticks: Plot.utcMonth,
        tickFormat: isMonth,
      }),
      Plot.axisY({
        label: window.STR.axis_elodiff,
        labelArrow: "none",
        labelAnchor: "top",
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
      // Split-colour fill: green above 0 (p1 ahead), red below 0 (p2 ahead).
      Plot.differenceY(eloDiff, {
        x: "date",
        y: "diff",
        positiveFill: t.green,
        negativeFill: t.red,
        fillOpacity: 0.22,
        curve: "catmull-rom",
      }),
      Plot.lineY(eloDiff, {
        x: "date",
        y: "diff",
        stroke: t.line,
        strokeWidth: 1.5,
        curve: "catmull-rom",
      }),
      Plot.dot([latest], {
        x: "date",
        y: "diff",
        fill: latestColour,
        r: 5,
        stroke: t.haloBg,
        strokeWidth: 2,
      }),
      Plot.text([latest], {
        x: "date",
        y: "diff",
        text: (d) => (d.diff > 0 ? "+" : "") + d.diff,
        dy: -14,
        fontSize: 12,
        fontWeight: 600,
        fill: latestColour,
        stroke: t.haloBg,
        strokeWidth: 4,
      }),
    ],
  });

  const wrap = document.createElement("div");
  wrap.className = "h2h-elo-chart";

  const title = document.createElement("div");
  title.className = "h2h-chart-title";
  title.textContent = window.STR.chart_elodiff_title;

  const subtitle = document.createElement("div");
  subtitle.className = "h2h-chart-subtitle";
  subtitle.textContent = `${p1Name} og ${p2Name}`;

  const legend = document.createElement("div");
  legend.className = "h2h-chart-legend";
  const legItem = (colour, name) => {
    const item = document.createElement("span");
    item.className = "h2h-legend-item";
    const pip = document.createElement("span");
    pip.className = "h2h-legend-pip";
    pip.style.background = colour;
    item.appendChild(pip);
    item.appendChild(
      document.createTextNode(`${name} ${window.STR.legend_framar}`),
    );
    return item;
  };
  legend.appendChild(legItem(t.green, p1Name));
  legend.appendChild(legItem(t.red, p2Name));

  wrap.appendChild(title);
  wrap.appendChild(subtitle);
  wrap.appendChild(chart);
  wrap.appendChild(legend);
  container.appendChild(wrap);
}
