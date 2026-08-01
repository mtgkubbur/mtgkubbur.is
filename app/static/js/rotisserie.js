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
     src="${esc(src)}" data-full="${esc(full)}" alt="${esc(label)}" title="${esc(label)}"
     tabindex="0" role="button" />`;
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
// Delegated listeners (not per-tile handlers) so this keeps scaling once
// Task 9 adds hundreds more tiles to the page.
function initLightbox() {
  let opener = null;

  function openLightbox(img) {
    opener = img;
    const lbImg = els.lightbox.querySelector("img");
    lbImg.src = img.dataset.full;
    lbImg.alt = img.alt;
    els.lightbox.hidden = false;
  }

  function closeLightbox() {
    if (els.lightbox.hidden) return;
    els.lightbox.hidden = true;
    // Return keyboard focus to whichever tile opened the lightbox, rather
    // than dropping the user back at the top of the document.
    if (opener) opener.focus();
    opener = null;
  }

  document.addEventListener("click", (ev) => {
    const img = ev.target.closest?.("img.rot-card");
    if (img && img.dataset.full) {
      openLightbox(img);
      return;
    }
    closeLightbox();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      closeLightbox();
      return;
    }
    const img = ev.target.closest?.("img.rot-card");
    if (!img) return;
    if (ev.key === "Enter" || ev.key === " ") {
      // Space would otherwise scroll the page for a focused, non-native
      // "button" element.
      ev.preventDefault();
      if (img.dataset.full) openLightbox(img);
    }
  });
}

// ── 3. Remaining pool browser ──
// Ordered: the first match wins, so "Artifact Creature" files under Creature
// and "Land" only catches cards with no other permanent type.
const TYPES = [
  { key: "Creature", label: () => S.type_creature },
  { key: "Planeswalker", label: () => S.type_planeswalker },
  { key: "Instant", label: () => S.type_instant },
  { key: "Sorcery", label: () => S.type_sorcery },
  { key: "Enchantment", label: () => S.type_enchantment },
  { key: "Artifact", label: () => S.type_artifact },
  { key: "Land", label: () => S.type_land },
];

const filters = { text: "", colours: new Set(), type: "" };

function primaryType(card) {
  const line = card?.type_line || "";
  return TYPES.find((t) => line.includes(t.key))?.key || "";
}

function matchesFilters({ name, card }) {
  if (filters.text) {
    const haystack = `${name} ${card?.name || ""}`.toLowerCase();
    if (!haystack.includes(filters.text)) return false;
  }
  if (filters.colours.size > 0 && !filters.colours.has(colourGroup(card))) return false;
  if (filters.type && primaryType(card) !== filters.type) return false;
  return true;
}

function buildFilterControls() {
  els.colourFilters.innerHTML = COLOUR_GROUPS.map(
    (g) =>
      `<button type="button" class="rot-colour-btn" data-colour="${g.key}"
         aria-pressed="false" title="${esc(g.label())}">${esc(g.label().slice(0, 1))}</button>`,
  ).join("");

  els.typeFilter.innerHTML =
    `<option value="">${esc(S.rotisserie_type_all)}</option>` +
    TYPES.map((t) => `<option value="${t.key}">${esc(t.label())}</option>`).join("");

  els.colourFilters.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-colour]");
    if (!btn) return;
    const key = btn.dataset.colour;
    const on = filters.colours.has(key);
    if (on) filters.colours.delete(key);
    else filters.colours.add(key);
    btn.setAttribute("aria-pressed", String(!on));
    renderRemaining();
  });

  els.typeFilter.addEventListener("change", () => {
    filters.type = els.typeFilter.value;
    renderRemaining();
  });

  let debounce;
  els.search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      filters.text = els.search.value.trim().toLowerCase();
      renderRemaining();
    }, 120);
  });
}

function renderRemaining() {
  const entries = draft.remaining.map((name) => ({ name, card: cards[name] }));
  const shown = entries.filter(matchesFilters);
  shown.sort((a, b) => {
    const dc = (a.card?.cmc ?? 0) - (b.card?.cmc ?? 0);
    return dc !== 0 ? dc : String(a.name).localeCompare(String(b.name), "is");
  });

  const summary = `${shown.length} / ${entries.length} ${esc(S.rotisserie_cards_count)}`;
  const body =
    shown.length === 0
      ? `<p class="empty-state">${esc(S.rotisserie_no_matches)}</p>`
      : `<div class="rot-grid">${shown.map(cardTile).join("")}</div>`;

  // <details> keeps 531 images collapsed on day one without any JS state.
  const open = els.remaining.querySelector("details")?.open ? " open" : "";
  els.remaining.innerHTML = `<details class="rot-remaining"${open}>
      <summary>${summary}</summary>${body}
    </details>`;
}

// ── 4. Pick log ──
function renderLog() {
  if (!draft.log || draft.log.length === 0) {
    els.log.innerHTML = `<p class="empty-state">${esc(S.rotisserie_no_cards)}</p>`;
    return;
  }
  els.log.innerHTML = `<ul class="rot-log-list">${draft.log
    .map(
      (e) => `<li>
        <span class="rot-log-round">${esc(S.rotisserie_round)} ${e.round}</span>
        <span class="rot-log-player">${esc(e.player)}</span>
        <span class="rot-log-card">${esc(cards[e.card]?.name || e.card)}</span>
      </li>`,
    )
    .join("")}</ul>`;
}

// ── Boot ──
async function init() {
  els.status.innerHTML = `<p class="empty-state">${esc(S.loading)}</p>`;
  // Render calls live inside this try/catch too: a payload that parses but
  // doesn't match the shape the renderers need (e.g. players present but
  // pools missing) must surface the same error state, not throw past it.
  try {
    const resp = await fetch("/data/rotisserie");
    if (!resp.ok) throw new Error(String(resp.status));
    const payload = await resp.json();
    draft = payload.draft;
    cards = payload.cards || {};
    if (!draft || !draft.players || !draft.pools) {
      throw new Error("malformed rotisserie payload");
    }
    renderStatus();
    renderPools();
    buildFilterControls();
    renderRemaining();
    renderLog();
    initLightbox();
  } catch (err) {
    console.error(err);
    els.status.innerHTML = `<p class="empty-state">${esc(S.error)}</p>`;
  }
}

init();
