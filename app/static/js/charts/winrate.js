import * as Plot from "/static/js/vendor/plot-0.6.17.min.js";
import { chartTheme, isMonth } from "/static/js/theme.js";

const S = window.STR;

export function render(container, history) {
  if (!container) return;
  const data = (history || []).map((d) => ({ ...d, date: new Date(d.date) }));
  if (data.length === 0) {
    container.replaceChildren();
    return;
  }
  const t = chartTheme();
  const last = data[data.length - 1];

  const chart = Plot.plot({
    width: container.clientWidth || 700,
    height: 340,
    marginLeft: 50,
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
    y: { label: null, domain: [0, 100], axis: null },
    marks: [
      Plot.gridY({
        stroke: t.grid,
        strokeOpacity: 0.6,
        strokeDasharray: "3,4",
      }),
      Plot.axisX({
        ticks: Plot.utcMonth,
        tickFormat: isMonth,
        tickSize: 4,
        tickPadding: 6,
        stroke: t.grid,
        fill: t.muted,
      }),
      Plot.axisY({
        label: S.axis_winrate,
        labelAnchor: "top",
        labelArrow: "none",
        tickSize: 0,
        tickPadding: 8,
        fill: t.muted,
        textStroke: t.haloBg,
        textStrokeWidth: 3,
      }),
      Plot.ruleY([50], {
        stroke: t.muted,
        strokeDasharray: "6,4",
        strokeOpacity: 0.5,
      }),
      Plot.areaY(data, {
        x: "date",
        y1: 50,
        y2: "win_rate",
        fill: t.green,
        fillOpacity: 0.12,
        curve: "catmull-rom",
      }),
      Plot.lineY(data, {
        x: "date",
        y: "win_rate",
        stroke: t.green,
        strokeWidth: 2.5,
        curve: "catmull-rom",
      }),
      Plot.dot([last], {
        x: "date",
        y: "win_rate",
        fill: t.green,
        r: 5,
        stroke: t.haloBg,
        strokeWidth: 2,
      }),
      Plot.text([last], {
        x: "date",
        y: "win_rate",
        text: (d) => `${d.win_rate.toFixed(0)}%`,
        dy: -14,
        fontSize: 12,
        fontWeight: 600,
        fill: t.green,
        stroke: t.haloBg,
        strokeWidth: 4,
      }),
    ],
  });
  container.replaceChildren(chart);
}
