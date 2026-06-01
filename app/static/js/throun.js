import {
  chartTheme,
  tierColours,
  TIER_LABEL,
  TIER_ORDER,
} from "/static/js/theme.js";
import { render as renderElo } from "/static/js/charts/elo.js";
import { render as renderRank } from "/static/js/charts/rank.js";
import { render as renderWinrate } from "/static/js/charts/winrate.js";
import { render as renderStrength } from "/static/js/charts/strength.js";
import { render as renderGames } from "/static/js/charts/games.js";

const S = window.STR;

const selectEl = document.getElementById("player-select");
const emptyEl = document.getElementById("throun-empty");
const contentEl = document.getElementById("throun-content");
const summaryEl = document.getElementById("player-summary");
const combinedEl = document.getElementById("cube-combined-mount");
const detailEl = document.getElementById("cube-detail-mount");

let current = null; // the fetched player payload, or null

function esc(s) {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

async function fetchPlayer(slug) {
  try {
    const r = await fetch(`/data/players/${encodeURIComponent(slug)}`);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.error("Failed to load player", slug, e);
    return null;
  }
}

// ---- Summary card (5 stats) ------------------------------------------------
function renderSummary(p, t) {
  const s = p.summary || {};
  const colours = tierColours(t);
  const tier = s.strongest_tier;
  const bestLabel = tier != null ? TIER_LABEL[tier] : "–";
  const bestColour = tier != null ? colours[tier] : t.muted;
  const winRate = s.win_rate != null ? `${s.win_rate.toFixed(0)}%` : "–";
  summaryEl.className = "player-summary";
  summaryEl.innerHTML = `
    <div class="stat"><div class="stat-value" style="color:${t.blue}">${s.score_median ?? "–"}</div><div class="stat-label">${esc(S.stat_elo)}</div></div>
    <div class="stat"><div class="stat-value" style="color:${t.red}">#${s.rank ?? "–"}</div><div class="stat-label">${esc(S.stat_saeti)}</div></div>
    <div class="stat"><div class="stat-value" style="color:${t.green}">${winRate}</div><div class="stat-label">${esc(S.stat_winrate)}</div></div>
    <div class="stat"><div class="stat-value" style="color:${t.gold}">${s.games ?? "–"}</div><div class="stat-label">${esc(S.stat_games)}</div></div>
    <div class="stat"><div class="stat-value" style="color:${bestColour}">${esc(bestLabel)}</div><div class="stat-label">${esc(S.stat_best)}</div></div>`;
}

// ---- Per-tier aggregate (sum cubes[] by tier; gamma from history[-1].strength) ----
function tierAggregates(p) {
  const agg = {};
  for (const tier of TIER_ORDER) agg[tier] = { wins: 0, losses: 0, games: 0 };
  for (const c of p.cubes || []) {
    const tier = c.tier;
    if (!agg[tier]) continue;
    agg[tier].wins += c.wins || 0;
    agg[tier].losses += c.losses || 0;
    agg[tier].games += c.games || 0;
  }
  const hist = p.history || [];
  const strength = hist.length ? hist[hist.length - 1].strength || {} : {};
  for (const tier of TIER_ORDER) {
    const g = strength[tier];
    agg[tier].gamma = g != null ? g : null;
    agg[tier].winrate =
      agg[tier].games > 0
        ? Math.round((agg[tier].wins / agg[tier].games) * 100)
        : null;
  }
  return agg;
}

function renderCombined(p, t) {
  const agg = tierAggregates(p);
  const colours = tierColours(t);
  // Rows: tiers in display order, skipping those with no games AND null gamma.
  const rows = TIER_ORDER.filter(
    (tier) => agg[tier].games > 0 || agg[tier].gamma != null,
  );
  if (rows.length === 0) {
    combinedEl.innerHTML = "";
    return;
  }
  let maxAbs = 0.15;
  for (const tier of rows) {
    if (agg[tier].gamma != null)
      maxAbs = Math.max(maxAbs, Math.abs(agg[tier].gamma));
  }
  const body = rows
    .map((tier) => {
      const a = agg[tier];
      const wins = a.games > 0 ? a.wins : "–";
      const losses = a.games > 0 ? a.losses : "–";
      const pctColour =
        a.winrate != null ? (a.winrate >= 50 ? t.green : t.red) : t.muted;
      const pct = a.winrate != null ? `${a.winrate}%` : "–";
      let styrkur;
      if (a.gamma != null) {
        const barPct = (Math.abs(a.gamma) / maxAbs) * 40;
        const pos = a.gamma >= 0;
        const negFill = !pos
          ? `<div class="gamma-bar-fill" style="width:${barPct}%;background:${t.red}"></div>`
          : "";
        const posFill = pos
          ? `<div class="gamma-bar-fill" style="width:${barPct}%;background:${t.green}"></div>`
          : "";
        const valColour = a.gamma >= 0 ? t.green : t.red;
        const valTxt = `${a.gamma >= 0 ? "+" : ""}${a.gamma.toFixed(2)}`;
        styrkur = `
          <div class="gamma-bar-inline">
            <div class="gamma-bar-neg-side">${negFill}</div>
            <div class="gamma-bar-mid"></div>
            <div class="gamma-bar-pos-side">${posFill}</div>
          </div>
          <span class="gamma-val" style="color:${valColour}">${valTxt}</span>`;
      } else {
        styrkur = `<span style="color:${t.muted}">–</span>`;
      }
      return `
        <tr>
          <td class="cube-record-name"><span class="cube-record-pip" style="background:${colours[tier]}"></span>${esc(TIER_LABEL[tier])}</td>
          <td>${wins}</td>
          <td>${losses}</td>
          <td style="color:${pctColour};font-weight:600">${pct}</td>
          <td class="gamma-cell">${styrkur}</td>
        </tr>`;
    })
    .join("");
  combinedEl.innerHTML = `
    <table class="cube-combined-table">
      <thead><tr><th></th><th>${esc(S.col_wins)}</th><th>${esc(S.col_losses)}</th><th>${esc(S.col_pct)}</th><th>${esc(S.col_styrkur)}</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

// ---- Per-cube detail (cubes[] sorted by games desc) ------------------------
function renderDetail(p, t) {
  const cubes = [...(p.cubes || [])].sort(
    (a, b) => (b.games || 0) - (a.games || 0),
  );
  if (cubes.length === 0) {
    detailEl.innerHTML = "";
    return;
  }
  const body = cubes
    .map((c) => {
      const pctColour = c.win_rate >= 50 ? t.green : t.red;
      const trophies = c.trophies > 0 ? "🏆".repeat(c.trophies) : "";
      return `
        <tr>
          <td class="cube-detail-name">${esc(c.cube)}</td>
          <td>${c.wins}</td>
          <td>${c.losses}</td>
          <td>${c.games}</td>
          <td style="color:${pctColour};font-weight:600">${c.win_rate}%</td>
          <td style="text-align:center">${trophies}</td>
        </tr>`;
    })
    .join("");
  detailEl.innerHTML = `
    <details class="cube-detail-toggle">
      <summary>${esc(S.detail_summary)}</summary>
      <table class="cube-detail-table">
        <thead><tr><th></th><th>${esc(S.col_wins)}</th><th>${esc(S.col_losses)}</th><th>${esc(S.col_games_en)}</th><th>${esc(S.col_pct)}</th><th></th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </details>`;
}

// ---- Charts ----------------------------------------------------------------
function renderCharts(p) {
  const history = p.history || [];
  renderElo(document.getElementById("chart-elo"), history);
  renderRank(document.getElementById("chart-rank"), history);
  renderWinrate(document.getElementById("chart-winrate"), history);
  renderStrength(document.getElementById("chart-strength"), history);
  renderGames(document.getElementById("chart-games"), history);
}

// ---- Orchestration ---------------------------------------------------------
function renderAll() {
  if (!current) return;
  const t = chartTheme();
  renderSummary(current, t);
  renderCombined(current, t);
  renderDetail(current, t);
  renderCharts(current);
}

async function onSelect() {
  const slug = selectEl.value;
  if (!slug) {
    current = null;
    contentEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  current = await fetchPlayer(slug);
  if (!current) {
    contentEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  contentEl.hidden = false;
  renderAll();
}

selectEl.addEventListener("change", onSelect);

// Re-render on theme flip (recolours pips, gamma values, and all charts).
const mo = new MutationObserver(() => renderAll());
mo.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"],
});
