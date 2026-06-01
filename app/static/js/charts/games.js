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
  const yMax = Math.max(...data.map((d) => d.games)) * 1.1 || 10;

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
    y: { label: null, domain: [0, yMax], axis: null },
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
        label: S.axis_games,
        labelAnchor: "top",
        labelArrow: "none",
        tickSize: 0,
        tickPadding: 8,
        fill: t.muted,
        textStroke: t.haloBg,
        textStrokeWidth: 3,
      }),
      Plot.areaY(data, {
        x: "date",
        y1: 0,
        y2: "games",
        fill: t.gold,
        fillOpacity: 0.12,
        curve: "step-after",
      }),
      Plot.lineY(data, {
        x: "date",
        y: "games",
        stroke: t.gold,
        strokeWidth: 2.5,
        curve: "step-after",
      }),
      Plot.dot([last], {
        x: "date",
        y: "games",
        fill: t.gold,
        r: 5,
        stroke: t.haloBg,
        strokeWidth: 2,
      }),
      Plot.text([last], {
        x: "date",
        y: "games",
        text: (d) => `${d.games}`,
        dy: -14,
        fontSize: 12,
        fontWeight: 600,
        fill: t.gold,
        stroke: t.haloBg,
        strokeWidth: 4,
      }),
    ],
  });
  container.replaceChildren(chart);
}
