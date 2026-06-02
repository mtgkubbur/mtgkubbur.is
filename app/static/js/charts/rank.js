import * as Plot from "/static/js/vendor/plot-0.6.17.min.js";
import { chartTheme, isMonth, basePlot, baseGridStyle } from "/static/js/theme.js";

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
  const domainMax = Math.max(Math.max(...data.map((d) => d.rank)), 10);

  const chart = Plot.plot({
    ...basePlot(t, container, 340),
    x: { type: "time", label: null, axis: null },
    y: { label: null, domain: [domainMax, 1], axis: null },
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
        label: S.axis_saeti,
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
        y1: domainMax,
        y2: "rank",
        fill: t.red,
        fillOpacity: 0.1,
        curve: "catmull-rom",
      }),
      Plot.lineY(data, {
        x: "date",
        y: "rank",
        stroke: t.red,
        strokeWidth: 2.5,
        curve: "catmull-rom",
      }),
      Plot.dot([last], {
        x: "date",
        y: "rank",
        fill: t.red,
        r: 5,
        stroke: t.haloBg,
        strokeWidth: 2,
      }),
      Plot.text([last], {
        x: "date",
        y: "rank",
        text: (d) => `#${d.rank}`,
        dy: -14,
        fontSize: 12,
        fontWeight: 600,
        fill: t.red,
        stroke: t.haloBg,
        strokeWidth: 4,
      }),
    ],
  });
  container.replaceChildren(chart);
}
