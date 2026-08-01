// Rotisserie draft page — one fetch of /data/rotisserie, then render status,
// per-player pools, the remaining pool browser and the pick log.
const S = window.STR;

const els = {
  status: document.getElementById("rot-status"),
  pools: document.getElementById("rot-pools"),
  remaining: document.getElementById("rot-remaining"),
  log: document.getElementById("rot-log"),
  search: document.getElementById("rot-search"),
  colourFilters: document.getElementById("rot-colour-filters"),
  typeFilter: document.getElementById("rot-type-filter"),
  lightbox: document.getElementById("rot-lightbox"),
};

let draft = null;
let cards = {};

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── Colour grouping ──
// Order matters: lands first so a mana-producing dual is not filed under Gold.
const COLOUR_GROUPS = [
  { key: "W", label: () => S.colour_w },
  { key: "U", label: () => S.colour_u },
  { key: "B", label: () => S.colour_b },
  { key: "R", label: () => S.colour_r },
  { key: "G", label: () => S.colour_g },
  { key: "GOLD", label: () => S.colour_gold },
  { key: "C", label: () => S.colour_colourless },
  { key: "LAND", label: () => S.colour_land },
];

function colourGroup(card) {
  if (!card) return "C";
  if ((card.type_line || "").includes("Land")) return "LAND";
  const colours = card.colors || [];
  if (colours.length === 0) return "C";
  if (colours.length > 1) return "GOLD";
  return colours[0];
}

function groupPool(names, lookup) {
  const groups = new Map(COLOUR_GROUPS.map((g) => [g.key, []]));
  for (const name of names) {
    const card = lookup[name];
    groups.get(colourGroup(card)).push({ name, card });
  }
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const dc = (a.card?.cmc ?? 0) - (b.card?.cmc ?? 0);
      return dc !== 0 ? dc : String(a.name).localeCompare(String(b.name), "is");
    });
  }
  return groups;
}

// ── Card tile ──
function cardTile({ name, card }, index) {
  const src = card?.img_small || "";
  const full = card?.img_normal || "";
  const label = card?.name || name;
  if (!src) {
    return `<div class="rot-card rot-card-missing" style="--i:${index}">${esc(label)}</div>`;
  }
  return `<img class="rot-card" style="--i:${index}" loading="lazy" decoding="async"
     src="${esc(src)}" data-full="${esc(full)}" alt="${esc(label)}" title="${esc(label)}" />`;
}

// ── 1. Status header ──
function renderStatus() {
  const lastSeen = draft.log?.[0]?.first_seen;
  const next = draft.next_player
    ? `<div class="stat"><span class="stat-label">${esc(S.rotisserie_next)}</span>
         <span class="stat-value rot-next">${esc(draft.next_player)}</span></div>`
    : `<div class="stat"><span class="stat-value">${esc(S.rotisserie_done)}</span></div>`;

  els.status.innerHTML = `
    <div class="player-summary">
      <div class="stat">
        <span class="stat-label">${esc(S.rotisserie_round)}</span>
        <span class="stat-value">${draft.current_round} ${esc(S.rotisserie_of)} ${draft.rounds_total}</span>
      </div>
      <div class="stat">
        <span class="stat-label">${esc(S.rotisserie_picks)}</span>
        <span class="stat-value">${draft.picks_made} ${esc(S.rotisserie_of)} ${draft.picks_total}</span>
      </div>
      ${next}
      ${
        lastSeen
          ? `<div class="stat"><span class="stat-label">${esc(S.rotisserie_last_seen)}</span>
               <span class="stat-value">${esc(fmtSeen(lastSeen))}</span></div>`
          : ""
      }
    </div>`;
}

// The sheet carries no timestamps, so this is when the sync job first observed
// the pick — never presented as when the player actually made it.
function fmtSeen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── 2. Player pools ──
function renderPools() {
  els.pools.innerHTML = draft.players
    .map((player) => {
      const names = draft.pools[player] || [];
      if (names.length === 0) {
        return `<section class="rot-pool">
            <h3 class="rot-pool-name">${esc(player)} <span class="rot-pool-count">0</span></h3>
            <p class="empty-state">${esc(S.rotisserie_no_cards)}</p>
          </section>`;
      }
      const groups = groupPool(names, cards);
      const columns = COLOUR_GROUPS.filter((g) => groups.get(g.key).length > 0)
        .map((g) => {
          const list = groups.get(g.key);
          return `<div class="rot-col">
              <div class="rot-col-head">${esc(g.label())} <span>${list.length}</span></div>
              <div class="rot-stack">${list.map(cardTile).join("")}</div>
            </div>`;
        })
        .join("");
      return `<section class="rot-pool">
          <h3 class="rot-pool-name">${esc(player)}
            <span class="rot-pool-count">${names.length} ${esc(S.rotisserie_cards_count)}</span>
          </h3>
          <div class="rot-cols">${columns}</div>
        </section>`;
    })
    .join("");
}

// ── Lightbox ──
function initLightbox() {
  document.addEventListener("click", (ev) => {
    const img = ev.target.closest?.("img.rot-card");
    if (img && img.dataset.full) {
      els.lightbox.querySelector("img").src = img.dataset.full;
      els.lightbox.querySelector("img").alt = img.alt;
      els.lightbox.hidden = false;
      return;
    }
    if (!els.lightbox.hidden) els.lightbox.hidden = true;
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") els.lightbox.hidden = true;
  });
}

// ── Boot ──
async function init() {
  els.status.innerHTML = `<p class="empty-state">${esc(S.loading)}</p>`;
  try {
    const resp = await fetch("/data/rotisserie");
    if (!resp.ok) throw new Error(String(resp.status));
    const payload = await resp.json();
    draft = payload.draft;
    cards = payload.cards || {};
  } catch {
    els.status.innerHTML = `<p class="empty-state">${esc(S.error)}</p>`;
    return;
  }
  if (!draft || !draft.players) {
    els.status.innerHTML = `<p class="empty-state">${esc(S.error)}</p>`;
    return;
  }
  renderStatus();
  renderPools();
  initLightbox();
}

init();
