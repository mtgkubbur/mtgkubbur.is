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
  const yMin = Math.min(...data.map((d) => d.score_lower));
  const yMax = Math.max(...data.map((d) => d.score_upper));

  const chart = Plot.plot({
    ...basePlot(t, container, 380),
    x: { type: "time", label: null, axis: null },
    y: { label: null, domain: [yMin, yMax], axis: null },
    color: {
      domain: [S.legend_90, S.legend_50, S.legend_median],
      range: [t.blueArea1, t.blueArea2, t.blue],
      legend: true,
    },
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
        label: S.axis_elo,
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
        y1: "score_lower",
        y2: "score_upper",
        fill: t.blueArea1,
        curve: "catmull-rom",
      }),
      Plot.areaY(data, {
        x: "date",
        y1: "score_q25",
        y2: "score_q75",
        fill: t.blueArea2,
        curve: "catmull-rom",
      }),
      Plot.lineY(data, {
        x: "date",
        y: "score_median",
        stroke: t.blue,
        strokeWidth: 2.5,
        curve: "catmull-rom",
      }),
      Plot.dot([last], {
        x: "date",
        y: "score_median",
        fill: t.blue,
        r: 5,
        stroke: t.haloBg,
        strokeWidth: 2,
      }),
      Plot.text([last], {
        x: "date",
        y: "score_median",
        text: (d) => `${d.score_median}`,
        dy: -14,
        fontSize: 12,
        fontWeight: 600,
        fill: t.blue,
        stroke: t.haloBg,
        strokeWidth: 4,
      }),
    ],
  });
  container.replaceChildren(chart);
}
