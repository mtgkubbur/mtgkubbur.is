// Rotisserie draft page — one fetch of /data/rotisserie, then render status,
// per-player pools, the remaining pool browser and the pick log.
const S = window.STR;

const els = {
  status: document.getElementById("rot-status"),
  pools: document.getElementById("rot-pools"),
  poolOrder: document.getElementById("rot-pool-order"),
  remaining: document.getElementById("rot-remaining"),
  log: document.getElementById("rot-log"),
  search: document.getElementById("rot-search"),
  colourFilters: document.getElementById("rot-colour-filters"),
  cmcFilters: document.getElementById("rot-cmc-filters"),
  typeFilter: document.getElementById("rot-type-filter"),
  sort: document.getElementById("rot-sort"),
  clear: document.getElementById("rot-clear"),
  lightbox: document.getElementById("rot-lightbox"),
};

let draft = null;
let cards = {};

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── Colour grouping ──
// pip: mana-font glyph for the filter buttons; mana-pip-* colour classes are
// the same ones the site chrome uses, so dark mode is already handled.
const COLOUR_GROUPS = [
  { key: "W", label: () => S.colour_w, pip: "ms-w mana-pip-w" },
  { key: "U", label: () => S.colour_u, pip: "ms-u mana-pip-u" },
  { key: "B", label: () => S.colour_b, pip: "ms-b mana-pip-b" },
  { key: "R", label: () => S.colour_r, pip: "ms-r mana-pip-r" },
  { key: "G", label: () => S.colour_g, pip: "ms-g mana-pip-g" },
  { key: "GOLD", label: () => S.colour_gold, pip: "ms-multicolor rot-pip-gold" },
  { key: "C", label: () => S.colour_colourless, pip: "ms-c" },
  { key: "LAND", label: () => S.colour_land, pip: "ms-land" },
];
const COLOUR_ORDER = new Map(COLOUR_GROUPS.map((g, i) => [g.key, i]));

// Only the front face decides whether a double-faced card is a land: a
// player identifies the card by its front (Legion's Landing is a white
// enchantment that happens to flip into a land, not a land itself), and this
// must agree with primaryType()'s front-face reading below.
function frontFaceTypeLine(card) {
  return (card?.type_line || "").split(" // ")[0];
}

// Order matters: lands first so a mana-producing dual is not filed under Gold.
function colourGroup(card) {
  if (!card) return "C";
  if (frontFaceTypeLine(card).includes("Land")) return "LAND";
  const colours = card.colors || [];
  if (colours.length === 0) return "C";
  if (colours.length > 1) return "GOLD";
  return colours[0];
}

// ── Card types ──
// Ordered: the first match wins, so "Artifact Creature" files under Creature
// and "Land" only catches cards with no other permanent type.
const TYPES = [
  { key: "Creature", label: () => S.type_creature },
  { key: "Planeswalker", label: () => S.type_planeswalker },
  { key: "Battle", label: () => S.type_battle },
  { key: "Instant", label: () => S.type_instant },
  { key: "Sorcery", label: () => S.type_sorcery },
  { key: "Enchantment", label: () => S.type_enchantment },
  { key: "Artifact", label: () => S.type_artifact },
  { key: "Land", label: () => S.type_land },
];

function primaryType(card) {
  const line = frontFaceTypeLine(card);
  return TYPES.find((t) => line.includes(t.key))?.key || "";
}

// ── Sort comparators ──
const byName = (a, b) => String(a.name).localeCompare(String(b.name), "is");
const byCurve = (a, b) => (a.card?.cmc ?? 0) - (b.card?.cmc ?? 0) || byName(a, b);
const byColour = (a, b) =>
  COLOUR_ORDER.get(colourGroup(a.card)) - COLOUR_ORDER.get(colourGroup(b.card)) || byCurve(a, b);

// Everything past six mana shares one curve bucket; nobody needs a column per
// Emrakul-priced spell.
const cmcBucket = (card) => Math.min(Math.floor(card?.cmc ?? 0), 7);

// ── Pool grouping modes ──
// Each mode returns the pool as ordered, non-empty {label, entries} columns.
const POOL_ORDERS = [
  { key: "colour", label: () => S.rotisserie_order_colour },
  { key: "curve", label: () => S.rotisserie_order_curve },
  { key: "creature", label: () => S.rotisserie_order_creature },
  { key: "type", label: () => S.rotisserie_order_type },
];
let poolOrder = "colour";

function bucketBy(entries, keyFn, buckets) {
  const map = new Map(buckets.map((b) => [b.key, []]));
  const rest = [];
  for (const entry of entries) {
    const list = map.get(keyFn(entry));
    if (list) list.push(entry);
    else rest.push(entry);
  }
  return { map, rest };
}

function groupPool(entries, mode) {
  if (mode === "curve") {
    // Lands sit outside the curve: their cmc 0 says nothing about when a
    // player casts spells, so they get their own trailing column.
    const spells = entries.filter((e) => colourGroup(e.card) !== "LAND");
    const lands = entries.filter((e) => colourGroup(e.card) === "LAND");
    const buckets = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({
      key: n,
      label: n === 7 ? "7+" : String(n),
      entries: spells.filter((e) => cmcBucket(e.card) === n).sort(byColour),
    }));
    buckets.push({ label: S.colour_land, entries: lands.sort(byColour) });
    return buckets.filter((b) => b.entries.length > 0);
  }

  if (mode === "creature") {
    const groups = [
      { test: (e) => primaryType(e.card) === "Creature", label: S.type_creature },
      {
        test: (e) => colourGroup(e.card) !== "LAND",
        label: S.type_noncreature,
      },
      { test: () => true, label: S.colour_land },
    ];
    const out = [];
    let pool = entries.slice();
    for (const g of groups) {
      const hit = pool.filter(g.test);
      pool = pool.filter((e) => !g.test(e));
      if (hit.length > 0) out.push({ label: g.label, entries: hit.sort(byCurve) });
    }
    return out;
  }

  if (mode === "type") {
    const { map, rest } = bucketBy(entries, (e) => primaryType(e.card), TYPES);
    const out = TYPES.filter((t) => map.get(t.key).length > 0).map((t) => ({
      label: t.label(),
      entries: map.get(t.key).sort(byCurve),
    }));
    if (rest.length > 0) out.push({ label: S.type_other, entries: rest.sort(byCurve) });
    return out;
  }

  // Default: colour columns, curve-sorted within each.
  const { map, rest } = bucketBy(entries, (e) => colourGroup(e.card), COLOUR_GROUPS);
  const out = COLOUR_GROUPS.filter((g) => map.get(g.key).length > 0).map((g) => ({
    label: g.label(),
    entries: map.get(g.key).sort(byCurve),
  }));
  if (rest.length > 0) out.push({ label: S.type_other, entries: rest.sort(byCurve) });
  return out;
}

// ── Card tile ──
function cardTile({ name, card }) {
  const src = card?.img_small || "";
  const full = card?.img_normal || "";
  const label = card?.name || name;
  if (!src) {
    return `<div class="rot-card rot-card-missing">${esc(label)}</div>`;
  }
  return `<img class="rot-card" loading="lazy" decoding="async"
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
function buildPoolOrderControl() {
  els.poolOrder.innerHTML = POOL_ORDERS.map(
    (o) => `<option value="${o.key}">${esc(o.label())}</option>`,
  ).join("");
  els.poolOrder.value = poolOrder;
  els.poolOrder.addEventListener("change", () => {
    poolOrder = els.poolOrder.value;
    renderPools();
  });
}

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
      const entries = names.map((name) => ({ name, card: cards[name] }));
      const columns = groupPool(entries, poolOrder)
        .map(
          (g) => `<div class="rot-col">
              <div class="rot-col-head">${esc(g.label)} <span>${g.entries.length}</span></div>
              <div class="rot-stack">${g.entries.map(cardTile).join("")}</div>
            </div>`,
        )
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
const filters = { text: "", colours: new Set(), cmc: new Set(), type: "" };

const SORTS = [
  { key: "curve", label: () => S.rotisserie_order_curve, cmp: byCurve },
  { key: "name", label: () => S.rotisserie_sort_name, cmp: byName },
  { key: "colour", label: () => S.rotisserie_order_colour, cmp: byColour },
];
let remainingSort = "curve";

function matchesFilters({ name, card }) {
  if (filters.text) {
    const haystack = `${name} ${card?.name || ""}`.toLowerCase();
    if (!haystack.includes(filters.text)) return false;
  }
  if (filters.colours.size > 0 && !filters.colours.has(colourGroup(card))) return false;
  if (filters.cmc.size > 0 && !filters.cmc.has(cmcBucket(card))) return false;
  if (filters.type && primaryType(card) !== filters.type) return false;
  return true;
}

function filtersActive() {
  return Boolean(filters.text || filters.colours.size || filters.cmc.size || filters.type);
}

function clearFilters() {
  filters.text = "";
  filters.colours.clear();
  filters.cmc.clear();
  filters.type = "";
  els.search.value = "";
  els.typeFilter.value = "";
  for (const btn of document.querySelectorAll(".rot-colour-btn, .rot-cmc-btn")) {
    btn.setAttribute("aria-pressed", "false");
  }
}

function buildFilterControls() {
  els.colourFilters.innerHTML = COLOUR_GROUPS.map(
    (g) =>
      `<button type="button" class="rot-colour-btn" data-colour="${g.key}"
         aria-pressed="false" aria-label="${esc(g.label())}" title="${esc(g.label())}">
         <i class="ms ${g.pip}" aria-hidden="true"></i></button>`,
  ).join("");

  // Mana value buttons: 0–6 and a shared 7+ bucket, multi-select like colours.
  els.cmcFilters.innerHTML = [0, 1, 2, 3, 4, 5, 6, 7]
    .map(
      (n) =>
        `<button type="button" class="rot-cmc-btn" data-cmc="${n}"
           aria-pressed="false">${n === 7 ? "7+" : n}</button>`,
    )
    .join("");

  els.typeFilter.innerHTML =
    `<option value="">${esc(S.rotisserie_type_all)}</option>` +
    TYPES.map((t) => `<option value="${t.key}">${esc(t.label())}</option>`).join("");

  els.sort.innerHTML = SORTS.map(
    (s) => `<option value="${s.key}">${esc(S.rotisserie_order_label)}: ${esc(s.label())}</option>`,
  ).join("");
  els.sort.value = remainingSort;

  els.colourFilters.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-colour]");
    if (!btn) return;
    const key = btn.dataset.colour;
    const on = filters.colours.has(key);
    if (on) filters.colours.delete(key);
    else filters.colours.add(key);
    btn.setAttribute("aria-pressed", String(!on));
    renderRemaining(true);
  });

  els.cmcFilters.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-cmc]");
    if (!btn) return;
    const key = Number(btn.dataset.cmc);
    const on = filters.cmc.has(key);
    if (on) filters.cmc.delete(key);
    else filters.cmc.add(key);
    btn.setAttribute("aria-pressed", String(!on));
    renderRemaining(true);
  });

  els.typeFilter.addEventListener("change", () => {
    filters.type = els.typeFilter.value;
    renderRemaining(true);
  });

  els.sort.addEventListener("change", () => {
    remainingSort = els.sort.value;
    renderRemaining(true);
  });

  els.clear.addEventListener("click", () => {
    clearFilters();
    renderRemaining(true);
  });

  let debounce;
  els.search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      filters.text = els.search.value.trim().toLowerCase();
      renderRemaining(true);
    }, 120);
  });
}

// forceOpen: any filter/sort interaction expands the browser, otherwise typing
// a search into the collapsed <details> would appear to do nothing.
function renderRemaining(forceOpen = false) {
  const entries = draft.remaining.map((name) => ({ name, card: cards[name] }));
  const shown = entries.filter(matchesFilters);
  shown.sort(SORTS.find((s) => s.key === remainingSort)?.cmp || byCurve);

  els.clear.hidden = !filtersActive();

  const summary = `${shown.length} / ${entries.length} ${esc(S.rotisserie_cards_count)}`;
  const body =
    shown.length === 0
      ? `<p class="empty-state">${esc(S.rotisserie_no_matches)}</p>`
      : `<div class="rot-grid">${shown.map(cardTile).join("")}</div>`;

  // <details> keeps 531 images collapsed on day one without any JS state.
  const open = els.remaining.querySelector("details")?.open || forceOpen ? " open" : "";
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
    buildPoolOrderControl();
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
