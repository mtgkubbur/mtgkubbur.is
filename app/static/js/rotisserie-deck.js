// Rotisserie deckbuilder — load a player's pool, arrange it in mana-value
// columns (creatures above, non-creatures below), cut to a sideboard, add
// basics, and pull still-available cards in as speculative picks.
//
// All user state lives in localStorage (rot-deck:<player>); the deck itself is
// always DERIVED from the live pool, so new picks appear on reload. The
// classification helpers (colourGroup, primaryType, cmcBucket, …) are copied
// from rotisserie.js on purpose: the two pages must stay independently
// editable, and the duplicated block is small and stable.
const S = window.STR;

const els = {
  player: document.getElementById("rd-player"),
  counts: document.getElementById("rd-counts"),
  exportBtn: document.getElementById("rd-export"),
  reset: document.getElementById("rd-reset"),
  columns: document.getElementById("rd-columns"),
  side: document.getElementById("rd-side"),
  available: document.getElementById("rd-available"),
  search: document.getElementById("rd-search"),
  colourFilters: document.getElementById("rd-colour-filters"),
  cmcFilters: document.getElementById("rd-cmc-filters"),
  typeFilter: document.getElementById("rd-type-filter"),
  clear: document.getElementById("rd-clear"),
  popover: document.getElementById("rd-popover"),
  lightbox: document.getElementById("rot-lightbox"),
};

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const BASICS = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
const STORAGE_PREFIX = "rot-deck:";
const LAST_PLAYER_KEY = "rot-deck:last-player";
const STATE_VERSION = 1;

// ── Classification (kept in sync with rotisserie.js by convention) ──
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

function frontFaceTypeLine(card) {
  return (card?.type_line || "").split(" // ")[0];
}

function colourGroup(card) {
  if (!card) return "C";
  if (frontFaceTypeLine(card).includes("Land")) return "LAND";
  const colours = card.colors || [];
  if (colours.length === 0) return "C";
  if (colours.length > 1) return "GOLD";
  return colours[0];
}

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

const byName = (a, b) => String(a.name).localeCompare(String(b.name), "is");
const byColourThenName = (a, b) =>
  COLOUR_ORDER.get(colourGroup(a.card)) - COLOUR_ORDER.get(colourGroup(b.card)) || byName(a, b);
const byCurve = (a, b) => (a.card?.cmc ?? 0) - (b.card?.cmc ?? 0) || byColourThenName(a, b);

const cmcBucket = (card) => Math.min(Math.floor(card?.cmc ?? 0), 7);

// ── State ──
let draft = null;
let cards = {};
let player = null;
let state = null;

function freshState() {
  return {
    version: STATE_VERSION,
    sideboard: {},
    pile_overrides: {},
    basics: { Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 },
    speculative: [],
    lost: [],
    updated_at: "",
  };
}

function loadState(who) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + who);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    // Unknown versions are discarded wholesale, never partially applied.
    if (parsed?.version !== STATE_VERSION) return freshState();
    const base = freshState();
    return {
      ...base,
      ...parsed,
      sideboard: { ...parsed.sideboard },
      pile_overrides: { ...parsed.pile_overrides },
      basics: { ...base.basics, ...parsed.basics },
      speculative: [...(parsed.speculative || [])],
      lost: [...(parsed.lost || [])],
    };
  } catch {
    return freshState();
  }
}

function saveState() {
  state.updated_at = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_PREFIX + player, JSON.stringify(state));
  } catch {
    // Storage full/blocked: the build keeps working, it just won't persist.
  }
}

function countBy(names) {
  const out = new Map();
  for (const n of names) out.set(n, (out.get(n) || 0) + 1);
  return out;
}

// Speculation lifecycle + storage hygiene. Runs once per load/refresh:
// a speculative card that entered the player's own pool became real; one
// that vanished from the remaining pool was drafted by someone else and is
// marked lost (sticky until dismissed). Sideboard counts and pile overrides
// are clamped to what the player actually holds.
function reconcile() {
  const poolCounts = countBy(draft.pools[player] || []);
  const remainingCounts = countBy(draft.remaining || []);

  const stillSpec = [];
  for (const name of state.speculative) {
    if (poolCounts.has(name)) continue; // became real
    if (!remainingCounts.has(name)) {
      if (!state.lost.includes(name)) state.lost.push(name);
      continue;
    }
    if (!stillSpec.includes(name)) stillSpec.push(name);
  }
  state.speculative = stillSpec;
  state.lost = state.lost.filter((n) => !poolCounts.has(n));

  const owned = new Map(poolCounts);
  for (const name of state.speculative) owned.set(name, (owned.get(name) || 0) + 1);

  for (const [name, count] of Object.entries(state.sideboard)) {
    const max = owned.get(name) || 0;
    const clamped = Math.min(Math.max(0, Math.floor(count)), max);
    if (clamped <= 0) delete state.sideboard[name];
    else state.sideboard[name] = clamped;
  }
  for (const name of Object.keys(state.pile_overrides)) {
    if (!owned.has(name)) delete state.pile_overrides[name];
  }
  for (const name of Object.keys(state.basics)) {
    if (!BASICS.includes(name)) delete state.basics[name];
    else state.basics[name] = Math.max(0, Math.floor(state.basics[name]) || 0);
  }
}

function naturalPile(card) {
  return primaryType(card) === "Creature" ? "creature" : "noncreature";
}

function pileFor(entry) {
  return state.pile_overrides[entry.name] || naturalPile(entry.card);
}

// The deck is derived, never stored: live pool + speculative − sideboard.
function deriveBoards() {
  const entries = [
    ...(draft.pools[player] || []).map((name) => ({ name, card: cards[name], spec: false })),
    ...state.speculative.map((name) => ({ name, card: cards[name], spec: true })),
  ];

  const sideLeft = new Map(Object.entries(state.sideboard));
  const deck = [];
  const side = [];
  for (const entry of entries) {
    const left = sideLeft.get(entry.name) || 0;
    if (left > 0) {
      sideLeft.set(entry.name, left - 1);
      side.push(entry);
    } else {
      deck.push(entry);
    }
  }

  const lands = deck.filter((e) => colourGroup(e.card) === "LAND").sort(byCurve);
  const spells = deck.filter((e) => colourGroup(e.card) !== "LAND");
  const columns = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({
    bucket: n,
    label: n === 7 ? "7+" : String(n),
    creatures: spells.filter((e) => cmcBucket(e.card) === n && pileFor(e) === "creature").sort(byColourThenName),
    noncreatures: spells
      .filter((e) => cmcBucket(e.card) === n && pileFor(e) === "noncreature")
      .sort(byColourThenName),
  }));

  const basicsTotal = BASICS.reduce((sum, n) => sum + (state.basics[n] || 0), 0);
  const creatures = spells.filter((e) => pileFor(e) === "creature").length;
  const counts = {
    total: deck.length + basicsTotal,
    creatures,
    lands: lands.length + basicsTotal,
    side: side.length,
  };
  return { columns, lands, side: side.sort(byCurve), counts };
}

// ── Rendering ──
function cardTile(entry, zone) {
  const { name, card, spec } = entry;
  const src = card?.img_small || "";
  const label = card?.name || name;
  const specCls = spec ? " rd-spec" : "";
  const badge = spec ? `<span class="rd-badge">${esc(S.rotisserie_deck_spec_badge)}</span>` : "";
  const inner = src
    ? `<img loading="lazy" decoding="async" src="${esc(src)}" data-full="${esc(card?.img_normal || "")}"
         alt="${esc(label)}" title="${esc(label)}" draggable="false" />`
    : `<span class="rot-card-missing">${esc(label)}</span>`;
  return `<div class="rd-card${specCls}" draggable="true" tabindex="0" role="button"
      data-name="${esc(name)}" data-zone="${zone}">${inner}${badge}</div>`;
}

function pileHtml(colIndex, pile, entries) {
  const label = pile === "creature" ? S.rotisserie_deck_creatures : S.rotisserie_deck_noncreatures;
  const body = entries.length
    ? entries.map((e) => cardTile(e, "deck")).join("")
    : `<span class="rd-pile-empty">${esc(S.rotisserie_deck_empty)}</span>`;
  return `<div class="rd-pile" data-pile="${pile}" data-col="${colIndex}">
      <div class="rd-pile-label">${esc(label)} <span>${entries.length}</span></div>
      <div class="rd-stack">${body}</div>
    </div>`;
}

function basicRow(name) {
  const card = cards[name];
  const n = state.basics[name] || 0;
  return `<div class="rd-basic" data-basic="${esc(name)}">
      <img src="${esc(card?.img_small || "")}" alt="${esc(name)}" title="${esc(name)}" loading="lazy" draggable="false" />
      <div class="rd-stepper">
        <button type="button" class="rd-step" data-step="-1" aria-label="−1 ${esc(name)}">−</button>
        <span class="rd-basic-count">${n}</span>
        <button type="button" class="rd-step" data-step="1" aria-label="+1 ${esc(name)}">+</button>
      </div>
    </div>`;
}

function renderColumns(boards) {
  const cols = boards.columns
    .map(
      (c) => `<div class="rd-col">
        <div class="rd-col-head">${esc(c.label)} <span>${c.creatures.length + c.noncreatures.length}</span></div>
        ${pileHtml(c.bucket, "creature", c.creatures)}
        ${pileHtml(c.bucket, "noncreature", c.noncreatures)}
      </div>`,
    )
    .join("");

  const landTiles = boards.lands.length
    ? boards.lands.map((e) => cardTile(e, "deck")).join("")
    : "";
  const landsCol = `<div class="rd-col rd-lands" data-lands>
      <div class="rd-col-head">${esc(S.rotisserie_deck_lands)} <span>${boards.counts.lands}</span></div>
      <div class="rd-stack">${landTiles}</div>
      <div class="rd-basics">${BASICS.map(basicRow).join("")}</div>
    </div>`;

  els.columns.innerHTML = cols + landsCol;
}

function renderSide(boards) {
  const lost = state.lost
    .map(
      (name) => `<span class="rd-lost" data-lost="${esc(name)}">
        ${esc(cards[name]?.name || name)} · ${esc(S.rotisserie_deck_lost_badge)}
        <button type="button" class="rd-dismiss" aria-label="${esc(S.rotisserie_deck_dismiss)}">×</button>
      </span>`,
    )
    .join("");
  const body = boards.side.length
    ? `<div class="rd-stack rd-side-stack">${boards.side.map((e) => cardTile(e, "side")).join("")}</div>`
    : `<p class="empty-state rd-side-empty">${esc(S.rotisserie_deck_empty)}</p>`;
  els.side.innerHTML = (lost ? `<div class="rd-lost-row">${lost}</div>` : "") + body;
}

function renderCounts(boards) {
  const c = boards.counts;
  els.counts.innerHTML = `
    <span>${esc(S.rotisserie_deck_total)}: <strong>${c.total}</strong></span>
    <span>${esc(S.rotisserie_deck_creatures)}: <strong>${c.creatures}</strong></span>
    <span>${esc(S.rotisserie_deck_lands)}: <strong>${c.lands}</strong></span>
    <span>${esc(S.rotisserie_deck_sideboard)}: <strong>${c.side}</strong></span>`;
}

// ── Available browser (same filter mechanics as the parent page) ──
const filters = { text: "", colours: new Set(), cmc: new Set(), type: "" };

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

function availableEntries() {
  // What's genuinely left to speculate on: the remaining pool minus cards
  // already taken as speculative.
  const specLeft = countBy(state.speculative);
  const out = [];
  for (const name of draft.remaining || []) {
    const reserved = specLeft.get(name) || 0;
    if (reserved > 0) {
      specLeft.set(name, reserved - 1);
      continue;
    }
    out.push({ name, card: cards[name], spec: false });
  }
  return out;
}

function renderAvailable(forceOpen = false) {
  const entries = availableEntries();
  const shown = entries.filter(matchesFilters).sort(byCurve);
  els.clear.hidden = !filtersActive();
  const summary = `${shown.length} / ${entries.length} ${esc(S.rotisserie_cards_count)}`;
  const body =
    shown.length === 0
      ? `<p class="empty-state">${esc(S.rotisserie_no_matches)}</p>`
      : `<div class="rot-grid">${shown.map((e) => cardTile(e, "avail")).join("")}</div>`;
  const open = els.available.querySelector("details")?.open || forceOpen ? " open" : "";
  els.available.innerHTML = `<details class="rot-remaining"${open}>
      <summary>${summary}</summary>${body}
    </details>`;
}

function buildFilterControls() {
  els.colourFilters.innerHTML = COLOUR_GROUPS.map(
    (g) =>
      `<button type="button" class="rot-colour-btn" data-colour="${g.key}"
         aria-pressed="false" aria-label="${esc(g.label())}" title="${esc(g.label())}">
         <i class="ms ${g.pip}" aria-hidden="true"></i></button>`,
  ).join("");

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

  els.colourFilters.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-colour]");
    if (!btn) return;
    const key = btn.dataset.colour;
    const on = filters.colours.has(key);
    if (on) filters.colours.delete(key);
    else filters.colours.add(key);
    btn.setAttribute("aria-pressed", String(!on));
    renderAvailable(true);
  });

  els.cmcFilters.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-cmc]");
    if (!btn) return;
    const key = Number(btn.dataset.cmc);
    const on = filters.cmc.has(key);
    if (on) filters.cmc.delete(key);
    else filters.cmc.add(key);
    btn.setAttribute("aria-pressed", String(!on));
    renderAvailable(true);
  });

  els.typeFilter.addEventListener("change", () => {
    filters.type = els.typeFilter.value;
    renderAvailable(true);
  });

  els.clear.addEventListener("click", () => {
    filters.text = "";
    filters.colours.clear();
    filters.cmc.clear();
    filters.type = "";
    els.search.value = "";
    els.typeFilter.value = "";
    for (const btn of document.querySelectorAll(".rot-colour-btn, .rot-cmc-btn")) {
      btn.setAttribute("aria-pressed", "false");
    }
    renderAvailable(true);
  });

  let debounce;
  els.search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      filters.text = els.search.value.trim().toLowerCase();
      renderAvailable(true);
    }, 120);
  });
}

// ── Mutations (each saves then re-renders — immediate-mode, like the parent) ──
function moveToSide(name) {
  const owned = countBy([...(draft.pools[player] || []), ...state.speculative]).get(name) || 0;
  const current = state.sideboard[name] || 0;
  if (current < owned) state.sideboard[name] = current + 1;
}

function moveToDeck(name) {
  const current = state.sideboard[name] || 0;
  if (current <= 1) delete state.sideboard[name];
  else state.sideboard[name] = current - 1;
}

function setPile(name, pile) {
  const card = cards[name];
  if (colourGroup(card) === "LAND") return; // lands have no pile
  if (naturalPile(card) === pile) delete state.pile_overrides[name];
  else state.pile_overrides[name] = pile;
}

function switchPile(name) {
  const card = cards[name];
  setPile(name, pileFor({ name, card }) === "creature" ? "noncreature" : "creature");
}

function addSpeculative(name) {
  const remainingCount = countBy(draft.remaining || []).get(name) || 0;
  const specCount = state.speculative.filter((n) => n === name).length;
  if (specCount < remainingCount) state.speculative.push(name);
}

function removeSpeculative(name) {
  const idx = state.speculative.indexOf(name);
  if (idx >= 0) state.speculative.splice(idx, 1);
}

function dismissLost(name) {
  state.lost = state.lost.filter((n) => n !== name);
}

function commit() {
  reconcile();
  saveState();
  render();
}

// ── Popover ──
function popoverActions(tile) {
  const name = tile.dataset.name;
  const zone = tile.dataset.zone;
  const spec = tile.classList.contains("rd-spec");
  const isLand = colourGroup(cards[name]) === "LAND";
  const actions = [];
  if (zone === "deck") {
    actions.push({ act: "to-side", label: S.rotisserie_deck_to_side });
    if (!isLand) actions.push({ act: "switch-pile", label: S.rotisserie_deck_switch_pile });
    if (spec) actions.push({ act: "remove-spec", label: S.rotisserie_deck_remove_spec });
  } else if (zone === "side") {
    actions.push({ act: "to-deck", label: S.rotisserie_deck_to_deck });
    if (spec) actions.push({ act: "remove-spec", label: S.rotisserie_deck_remove_spec });
  } else if (zone === "avail") {
    actions.push({ act: "add-spec", label: S.rotisserie_deck_add_spec });
  }
  actions.push({ act: "enlarge", label: S.rotisserie_deck_enlarge });
  return actions;
}

function openPopover(tile, x, y) {
  const actions = popoverActions(tile);
  els.popover.innerHTML = actions
    .map((a) => `<button type="button" data-act="${a.act}">${esc(a.label)}</button>`)
    .join("");
  els.popover.dataset.name = tile.dataset.name;
  els.popover.dataset.zone = tile.dataset.zone;
  els.popover.hidden = false;
  const rect = els.popover.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  els.popover.style.left = `${Math.max(8, left)}px`;
  els.popover.style.top = `${Math.max(8, top)}px`;
}

function closePopover() {
  els.popover.hidden = true;
}

function runAction(act, name) {
  if (act === "to-side") moveToSide(name);
  else if (act === "to-deck") moveToDeck(name);
  else if (act === "switch-pile") switchPile(name);
  else if (act === "add-spec") addSpeculative(name);
  else if (act === "remove-spec") {
    removeSpeculative(name);
    delete state.sideboard[name];
  } else if (act === "enlarge") {
    openLightbox(name);
    return; // no state change
  }
  commit();
}

// ── Lightbox (opened from the popover, since plain click is the tap fallback) ──
let lightboxOpener = null;

function openLightbox(name) {
  const card = cards[name];
  if (!card?.img_normal) return;
  const img = els.lightbox.querySelector("img");
  img.src = card.img_normal;
  img.alt = card.name || name;
  els.lightbox.hidden = false;
}

function closeLightbox() {
  if (els.lightbox.hidden) return;
  els.lightbox.hidden = true;
  if (lightboxOpener) lightboxOpener.focus();
  lightboxOpener = null;
}

// ── Drag and drop ──
function initDragAndDrop() {
  document.addEventListener("dragstart", (ev) => {
    const tile = ev.target.closest?.(".rd-card");
    if (!tile) return;
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData(
      "text/plain",
      JSON.stringify({ name: tile.dataset.name, from: tile.dataset.zone }),
    );
    closePopover();
  });

  const zoneOf = (target) => {
    const pile = target.closest?.(".rd-pile");
    if (pile) return { kind: "pile", pile: pile.dataset.pile, el: pile };
    if (target.closest?.("[data-lands]")) return { kind: "lands", el: target.closest("[data-lands]") };
    if (target.closest?.("#rd-side")) return { kind: "side", el: els.side };
    if (target.closest?.("#rd-available")) return { kind: "avail", el: els.available };
    return null;
  };

  let highlighted = null;
  document.addEventListener("dragover", (ev) => {
    const zone = zoneOf(ev.target);
    if (!zone) {
      if (highlighted) highlighted.classList.remove("rd-drop-over");
      highlighted = null;
      return;
    }
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    if (highlighted !== zone.el) {
      if (highlighted) highlighted.classList.remove("rd-drop-over");
      zone.el.classList.add("rd-drop-over");
      highlighted = zone.el;
    }
  });

  document.addEventListener("drop", (ev) => {
    if (highlighted) highlighted.classList.remove("rd-drop-over");
    highlighted = null;
    const zone = zoneOf(ev.target);
    if (!zone) return;
    ev.preventDefault();
    let payload;
    try {
      payload = JSON.parse(ev.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    const { name, from } = payload || {};
    if (!name || !(name in cards)) return;

    if (from === "avail") {
      // Any drop from the available browser adds the card as a speculative
      // pick; it files itself by mana value.
      if (zone.kind !== "avail") {
        addSpeculative(name);
        if (zone.kind === "pile") setPile(name, zone.pile);
      }
    } else if (zone.kind === "pile") {
      if (from === "side") moveToDeck(name);
      setPile(name, zone.pile);
    } else if (zone.kind === "lands") {
      if (from === "side") moveToDeck(name);
    } else if (zone.kind === "side") {
      if (from === "deck") moveToSide(name);
    } else if (zone.kind === "avail") {
      // Dropping a speculative card back onto the browser un-speculates it.
      const entryIsSpec = state.speculative.includes(name);
      if (entryIsSpec) {
        removeSpeculative(name);
        delete state.sideboard[name];
      }
    }
    commit();
  });
}

// ── Global click/keyboard wiring ──
function initInteractions() {
  document.addEventListener("click", (ev) => {
    const actBtn = ev.target.closest?.("#rd-popover button[data-act]");
    if (actBtn) {
      runAction(actBtn.dataset.act, els.popover.dataset.name);
      closePopover();
      return;
    }

    const step = ev.target.closest?.(".rd-step");
    if (step) {
      const name = step.closest(".rd-basic").dataset.basic;
      state.basics[name] = Math.max(0, (state.basics[name] || 0) + Number(step.dataset.step));
      commit();
      return;
    }

    const dismiss = ev.target.closest?.(".rd-dismiss");
    if (dismiss) {
      dismissLost(dismiss.closest(".rd-lost").dataset.lost);
      commit();
      return;
    }

    const tile = ev.target.closest?.(".rd-card");
    if (tile) {
      lightboxOpener = tile;
      openPopover(tile, ev.clientX, ev.clientY);
      return;
    }

    closePopover();
    closeLightbox();
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      closePopover();
      closeLightbox();
      return;
    }
    const tile = ev.target.closest?.(".rd-card");
    if (!tile) return;
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      lightboxOpener = tile;
      const rect = tile.getBoundingClientRect();
      openPopover(tile, rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
  });

  els.player.addEventListener("change", () => {
    player = els.player.value;
    try {
      localStorage.setItem(LAST_PLAYER_KEY, player);
    } catch {
      // non-fatal
    }
    state = loadState(player);
    commit();
  });

  els.exportBtn.addEventListener("click", async () => {
    const text = exportText();
    try {
      await navigator.clipboard.writeText(text);
      const old = els.exportBtn.textContent;
      els.exportBtn.textContent = S.rotisserie_deck_exported;
      setTimeout(() => {
        els.exportBtn.textContent = old;
      }, 1500);
    } catch {
      window.prompt(S.rotisserie_deck_export, text);
    }
  });

  els.reset.addEventListener("click", () => {
    if (!window.confirm(S.rotisserie_deck_reset_confirm)) return;
    try {
      localStorage.removeItem(STORAGE_PREFIX + player);
    } catch {
      // non-fatal
    }
    state = freshState();
    commit();
  });
}

function exportText() {
  const boards = deriveBoards();
  const lines = [];
  const grouped = new Map();
  for (const e of [...boards.columns.flatMap((c) => [...c.creatures, ...c.noncreatures]), ...boards.lands]) {
    grouped.set(e.name, (grouped.get(e.name) || 0) + 1);
  }
  for (const [name, n] of grouped) lines.push(`${n} ${cards[name]?.name || name}`);
  for (const name of BASICS) {
    if (state.basics[name] > 0) lines.push(`${state.basics[name]} ${name}`);
  }
  if (boards.side.length) {
    lines.push("", `${S.rotisserie_deck_sideboard}:`);
    const sideGrouped = new Map();
    for (const e of boards.side) sideGrouped.set(e.name, (sideGrouped.get(e.name) || 0) + 1);
    for (const [name, n] of sideGrouped) lines.push(`${n} ${cards[name]?.name || name}`);
  }
  if (state.speculative.length) {
    lines.push("", `${S.rotisserie_deck_spec_badge}:`);
    for (const name of state.speculative) lines.push(`1 ${cards[name]?.name || name}`);
  }
  return lines.join("\n");
}

// ── Render root ──
function render() {
  const boards = deriveBoards();
  renderCounts(boards);
  renderColumns(boards);
  renderSide(boards);
  renderAvailable();
}

function buildPlayerSelect() {
  els.player.innerHTML = draft.players
    .map((p) => `<option value="${esc(p)}">${esc(p)}</option>`)
    .join("");
  let last = null;
  try {
    last = localStorage.getItem(LAST_PLAYER_KEY);
  } catch {
    // non-fatal
  }
  player = draft.players.includes(last) ? last : draft.players[0];
  els.player.value = player;
}

// ── Boot ──
async function init() {
  els.counts.innerHTML = `<span>${esc(S.loading)}</span>`;
  try {
    const resp = await fetch("/data/rotisserie");
    if (!resp.ok) throw new Error(String(resp.status));
    const payload = await resp.json();
    draft = payload.draft;
    cards = payload.cards || {};
    if (!draft || !draft.players || !draft.pools) {
      throw new Error("malformed rotisserie payload");
    }
    buildPlayerSelect();
    state = loadState(player);
    buildFilterControls();
    initInteractions();
    initDragAndDrop();
    commit();
  } catch (err) {
    console.error(err);
    els.counts.innerHTML = `<span>${esc(S.error)}</span>`;
  }
}

init();
