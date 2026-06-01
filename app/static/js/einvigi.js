// Einvígi — two-player head-to-head card + ELO-difference chart (chart 6).
import { chartTheme } from "/static/js/theme.js";
import * as elodiff from "/static/js/charts/elodiff.js";

const sel1 = document.getElementById("einvigi-player1");
const sel2 = document.getElementById("einvigi-player2");
const cardEl = document.getElementById("h2h-card");
const chartMount = document.getElementById("h2h-elo-chart-mount");

const STR = window.STR;

// --- caches ---------------------------------------------------------------
let h2hCache = null; // head_to_head.json (array)
const playerCache = new Map(); // slug -> player file
// name -> slug map from the option list (so we can resolve player files by name).
const nameToSlug = new Map();
const slugToName = new Map();
for (const opt of sel1.options) {
  if (opt.value) {
    nameToSlug.set(opt.textContent, opt.value);
    slugToName.set(opt.value, opt.textContent);
  }
}

async function getH2H() {
  if (h2hCache === null) {
    const r = await fetch("/data/head_to_head");
    h2hCache = r.ok ? await r.json() : [];
  }
  return h2hCache;
}

async function getPlayer(slug) {
  if (!playerCache.has(slug)) {
    const r = await fetch(`/data/players/${slug}`);
    playerCache.set(slug, r.ok ? await r.json() : null);
  }
  return playerCache.get(slug);
}

// --- DOM helpers ----------------------------------------------------------
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function emptyState(icon, message) {
  cardEl.replaceChildren();
  const wrap = el("div", "empty-state");
  const ic = el("div", "empty-icon");
  ic.innerHTML = icon; // HTML entity (&#9876; / &#10068;)
  wrap.appendChild(ic);
  wrap.appendChild(el("div", null, message));
  cardEl.appendChild(wrap);
  chartMount.replaceChildren();
}

// --- card render ----------------------------------------------------------
function renderCard(p1Name, p2Name, p1Wins, p2Wins, cubeRows) {
  const t = chartTheme();
  const total = p1Wins + p2Wins;
  const p1Pct = Math.round((p1Wins / total) * 100);
  const p2Pct = 100 - p1Pct;
  const p1Colour = p1Wins >= p2Wins ? t.green : t.red;
  const p2Colour = p2Wins >= p1Wins ? t.green : t.red;

  const card = el("div", "h2h-card");

  // header: player / vs / player
  const header = el("div", "h2h-header");
  const playerBlock = (name, wins, colour) => {
    const blk = el("div", "h2h-player");
    blk.appendChild(el("div", "h2h-name", name));
    const w = el("div", "h2h-wins");
    w.style.color = colour;
    w.appendChild(document.createTextNode(`${wins} `));
    w.appendChild(el("span", "h2h-wins-label", STR.wins_label));
    blk.appendChild(w);
    return blk;
  };
  header.appendChild(playerBlock(p1Name, p1Wins, p1Colour));
  header.appendChild(el("div", "h2h-vs", STR.vs));
  header.appendChild(playerBlock(p2Name, p2Wins, p2Colour));
  card.appendChild(header);

  // win bar
  const bar = el("div", "h2h-bar-container");
  const fill1 = el("div", "h2h-bar-fill h2h-bar-p1", `${p1Pct}%`);
  fill1.style.width = `${p1Pct}%`;
  fill1.style.background = p1Colour;
  const fill2 = el("div", "h2h-bar-fill h2h-bar-p2", `${p2Pct}%`);
  fill2.style.width = `${p2Pct}%`;
  fill2.style.background = p2Colour;
  bar.appendChild(fill1);
  bar.appendChild(fill2);
  card.appendChild(bar);

  // total line: "{n} leikir samtals"
  card.appendChild(el("div", "h2h-total", `${total} ${STR.total_suffix}`));

  // cube breakdown (only if rows exist)
  if (cubeRows.length > 0) {
    const bd = el("div", "h2h-cube-breakdown");
    bd.appendChild(el("div", "h2h-cube-title", STR.h2h_cube_title));
    const table = el("table", "h2h-cube-table");
    const thead = el("thead");
    const htr = el("tr");
    htr.appendChild(el("th")); // blank
    htr.appendChild(el("th", null, p1Name));
    htr.appendChild(el("th", null, p2Name));
    htr.appendChild(el("th", null, STR.col_total));
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = el("tbody");
    for (const r of cubeRows) {
      const tr = el("tr");
      tr.appendChild(el("td", null, r.cube));
      const c1 = el("td", null, String(r.p1Wins));
      c1.style.color = r.p1Wins >= r.p2Wins ? t.green : t.red;
      c1.style.fontWeight = "600";
      const c2 = el("td", null, String(r.p2Wins));
      c2.style.color = r.p2Wins >= r.p1Wins ? t.green : t.red;
      c2.style.fontWeight = "600";
      tr.appendChild(c1);
      tr.appendChild(c2);
      tr.appendChild(el("td", null, String(r.total)));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    bd.appendChild(table);
    card.appendChild(bd);
  }

  cardEl.replaceChildren(card);
}

// --- pair resolution + cube rows -----------------------------------------
// Map a head_to_head record's a_wins/b_wins onto (player1, player2).
function mapWins(rec, name1) {
  if (rec.player_a === name1) return { w1: rec.a_wins, w2: rec.b_wins };
  return { w1: rec.b_wins, w2: rec.a_wins };
}

function buildCubeRows(rec, name1) {
  const rows = (rec.by_cube || []).map((c) => {
    const m =
      rec.player_a === name1
        ? { w1: c.a_wins, w2: c.b_wins }
        : { w1: c.b_wins, w2: c.a_wins };
    return { cube: c.cube, p1Wins: m.w1, p2Wins: m.w2, total: m.w1 + m.w2 };
  });
  rows.sort((a, b) => a.cube.localeCompare(b.cube, "is"));
  return rows;
}

// --- main update ----------------------------------------------------------
// remembered state for theme-flip re-render of the chart
let current = null; // {p1Name, p2Name, h1, h2}

async function update() {
  const slug1 = sel1.value;
  const slug2 = sel2.value;

  if (!slug1 || !slug2) {
    current = null;
    emptyState("&#9876;", STR.einvigi_empty);
    return;
  }
  if (slug1 === slug2) {
    current = null;
    emptyState("&#9876;", STR.einvigi_same);
    return;
  }

  const name1 = slugToName.get(slug1);
  const name2 = slugToName.get(slug2);

  const [h2h, h1, h2] = await Promise.all([
    getH2H(),
    getPlayer(slug1),
    getPlayer(slug2),
  ]);

  // head_to_head player_a/player_b use an internal (non-alphabetical) order,
  // so match the pair in either orientation.
  const rec = h2h.find(
    (d) =>
      (d.player_a === name1 && d.player_b === name2) ||
      (d.player_a === name2 && d.player_b === name1),
  );

  const p1Wins = rec ? mapWins(rec, name1).w1 : 0;
  const p2Wins = rec ? mapWins(rec, name1).w2 : 0;
  const total = p1Wins + p2Wins;

  if (total === 0) {
    current = null;
    emptyState(
      "&#10068;",
      STR.no_games.replace("{p1}", name1).replace("{p2}", name2),
    );
    return;
  }

  const cubeRows = rec ? buildCubeRows(rec, name1) : [];
  renderCard(name1, name2, p1Wins, p2Wins, cubeRows);

  // chart: difference the two histories on shared dates
  current = { p1Name: name1, p2Name: name2, h1: h1 || {}, h2: h2 || {} };
  elodiff.render(
    chartMount,
    name1,
    name2,
    current.h1.history || [],
    current.h2.history || [],
  );
}

// re-render the chart only on theme flip (parity: card not re-rendered)
const mo = new MutationObserver(() => {
  if (current) {
    elodiff.render(
      chartMount,
      current.p1Name,
      current.p2Name,
      current.h1.history || [],
      current.h2.history || [],
    );
  }
});
mo.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"],
});

sel1.addEventListener("change", update);
sel2.addEventListener("change", update);
