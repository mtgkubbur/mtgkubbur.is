// Kubbar page — fetch /data/cubes/{slug}, render summary + trophy + player
// rankings + event-date picker + per-event results. Re-renders on theme flip.
import { chartTheme } from "/static/js/theme.js";

const S = window.STR;

const els = {
  cubeSelect: document.getElementById("cube-select"),
  empty: document.getElementById("kubbar-empty"),
  summary: document.getElementById("kubbar-summary"),
  trophy: document.getElementById("kubbar-trophy"),
  rankings: document.getElementById("kubbar-rankings"),
  eventPickerWrap: document.getElementById("event-date-selector"),
  eventSelect: document.getElementById("event-select"),
  event: document.getElementById("kubbar-event"),
};

let cubeData = null; // last fetched cubes/<slug>.json
let selectedEventDate = null; // ISO date string of the chosen event

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// "YYYY-MM-DD" -> "YY.MM.DD"
function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  return `${y.slice(2)}.${m}.${d}`;
}

function clearAll() {
  els.summary.innerHTML = "";
  els.trophy.innerHTML = "";
  els.rankings.innerHTML = "";
  els.event.innerHTML = "";
  els.eventSelect.innerHTML = "";
  els.eventPickerWrap.hidden = true;
}

// ── 1. Summary card (.player-summary, 5 stats) ──
function renderSummary(t) {
  const s = cubeData.summary || {};
  els.summary.innerHTML = `
    <div class="player-summary">
      <div class="stat">
        <div class="stat-value" style="color:${t.blue}">${s.n_events ?? "–"}</div>
        <div class="stat-label">${esc(S.stat_events)}</div>
      </div>
      <div class="stat">
        <div class="stat-value" style="color:${t.red}">${s.n_matches ?? "–"}</div>
        <div class="stat-label">${esc(S.stat_matches)}</div>
      </div>
      <div class="stat">
        <div class="stat-value" style="color:${t.green}">${s.n_players ?? "–"}</div>
        <div class="stat-label">${esc(S.stat_players)}</div>
      </div>
      <div class="stat">
        <div class="stat-value" style="color:${t.gold}">${fmtDate(s.first_played)}</div>
        <div class="stat-label">${esc(S.stat_first)}</div>
      </div>
      <div class="stat">
        <div class="stat-value" style="color:${t.gold}">${fmtDate(s.last_played)}</div>
        <div class="stat-label">${esc(S.stat_last)}</div>
      </div>
    </div>`;
}

// ── 2. Trophy leaderboard (.trophy-card) — only if trophy_leaders non-empty ──
function renderTrophies(t) {
  const leaders = cubeData.trophy_leaders || [];
  if (leaders.length === 0) {
    els.trophy.innerHTML = "";
    return;
  }
  const rows = leaders
    .map(
      (l) => `
      <tr>
        <td class="cube-record-name">${esc(l.player)}</td>
        <td style="text-align:center;font-weight:600;color:${t.gold}">${"🏆".repeat(l.trophies)}</td>
      </tr>`,
    )
    .join("");
  els.trophy.innerHTML = `
    <div class="trophy-card">
      <div class="cube-affinity-title">${esc(S.trophy_title)}</div>
      <table class="trophy-table">
        <thead>
          <tr><th>${esc(S.col_player)}</th><th>${esc(S.col_bikarar)}</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── 3. Player rankings (.cube-combined-card) — Matches | Games groups ──
function renderRankings(t) {
  const players = cubeData.player_rankings || []; // already sorted by game_pct desc
  if (players.length === 0) {
    els.rankings.innerHTML = "";
    return;
  }
  const pctColour = (p) => (p >= 50 ? t.green : t.red);
  const rows = players
    .map(
      (r) => `
      <tr>
        <td class="cube-record-name">${esc(r.player)}</td>
        <td>${r.match_w}</td>
        <td>${r.match_l}</td>
        <td style="color:${pctColour(r.match_pct)};font-weight:600">${r.match_pct}%</td>
        <td>${r.game_w}</td>
        <td>${r.game_l}</td>
        <td style="color:${pctColour(r.game_pct)};font-weight:600">${r.game_pct}%</td>
      </tr>`,
    )
    .join("");
  els.rankings.innerHTML = `
    <div class="cube-combined-card">
      <div class="cube-affinity-title">${esc(S.rankings_title)}</div>
      <table class="cube-combined-table">
        <thead>
          <tr>
            <th></th>
            <th colspan="3" class="col-group-header">${esc(S.group_matches)}</th>
            <th colspan="3" class="col-group-header">${esc(S.group_games)}</th>
          </tr>
          <tr>
            <th>${esc(S.col_player)}</th>
            <th>${esc(S.col_wins)}</th>
            <th>${esc(S.col_losses)}</th>
            <th>${esc(S.col_pct)}</th>
            <th>${esc(S.col_wins)}</th>
            <th>${esc(S.col_losses)}</th>
            <th>${esc(S.col_pct)}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── 4. Event-date picker (#event-date-selector) — events are NEWEST-FIRST ──
function buildEventPicker() {
  const events = cubeData.events || [];
  if (events.length === 0) {
    els.eventSelect.innerHTML = "";
    els.eventPickerWrap.hidden = true;
    selectedEventDate = null;
    return;
  }
  els.eventSelect.innerHTML = events
    .map((e) => `<option value="${esc(e.date)}">${fmtDate(e.date)}</option>`)
    .join("");
  selectedEventDate = events[0].date; // default = most recent
  els.eventSelect.value = selectedEventDate;
  els.eventPickerWrap.hidden = false;
}

// ── 5. Event results (.recent-events-card) — Matches | Games groups ──
function renderEvent() {
  const events = cubeData?.events || [];
  const ev = events.find((e) => e.date === selectedEventDate);
  if (!ev) {
    els.event.innerHTML = "";
    return;
  }
  const results = (ev.results || [])
    .slice()
    .sort((a, b) => b.match_w - a.match_w);
  const rows = results
    .map(
      (r) => `
      <tr>
        <td class="cube-record-name">${esc(r.player)}${r.trophy ? " 🏆" : ""}</td>
        <td style="text-align:center">${r.match_w}</td>
        <td style="text-align:center">${r.match_l}</td>
        <td style="text-align:center">${r.game_w}</td>
        <td style="text-align:center">${r.game_l}</td>
      </tr>`,
    )
    .join("");
  els.event.innerHTML = `
    <div class="recent-events-card">
      <div class="cube-affinity-title">${esc(S.event_title)}</div>
      <table class="trophy-table">
        <thead>
          <tr>
            <th></th>
            <th colspan="2" class="col-group-header">${esc(S.group_matches)}</th>
            <th colspan="2" class="col-group-header">${esc(S.group_games)}</th>
          </tr>
          <tr>
            <th>${esc(S.col_player)}</th>
            <th>${esc(S.col_wins)}</th>
            <th>${esc(S.col_losses)}</th>
            <th>${esc(S.col_wins)}</th>
            <th>${esc(S.col_losses)}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// Render everything that depends on theme colours (summary/trophy/rankings/event).
function renderAll() {
  if (!cubeData) return;
  const t = chartTheme();
  try {
    renderSummary(t);
    renderTrophies(t);
    renderRankings(t);
    renderEvent();
  } catch (e) {
    console.error("Kubbar render failed:", e);
  }
}

async function loadCube(slug) {
  if (!slug) {
    cubeData = null;
    selectedEventDate = null;
    clearAll();
    els.empty.hidden = false;
    return;
  }
  els.empty.hidden = true;
  try {
    const resp = await fetch(`/data/cubes/${encodeURIComponent(slug)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    cubeData = await resp.json();
  } catch (e) {
    console.error(`Failed to load cube ${slug}:`, e);
    cubeData = null;
    clearAll();
    els.summary.innerHTML = `<div class="empty-state"><div>${esc(S.error)}</div></div>`;
    return;
  }
  buildEventPicker();
  renderAll();
}

els.cubeSelect.addEventListener("change", (e) => loadCube(e.target.value));
els.eventSelect.addEventListener("change", (e) => {
  selectedEventDate = e.target.value;
  renderEvent();
});

// Re-render on theme flip so stat/percent colours follow the palette.
const mo = new MutationObserver(renderAll);
mo.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"],
});
