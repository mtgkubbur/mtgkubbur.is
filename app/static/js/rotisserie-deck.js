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
  banner: document.getElementById("rd-banner"),
  counts: document.getElementById("rd-counts"),
  mana: document.getElementById("rd-mana"),
  exportBtn: document.getElementById("rd-export"),
  shareBtn: document.getElementById("rd-share"),
  undoBtn: document.getElementById("rd-undo"),
  handBtn: document.getElementById("rd-hand-btn"),
  hand: document.getElementById("rd-hand"),
  hover: document.getElementById("rd-hover"),
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
const DECK_TARGET = 40;
const UNDO_CAP = 20;
// Shared-deck links render the page read-only: state comes from the URL
// fragment, mutations are disabled, and nothing touches localStorage.
let readOnly = false;

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
const BUCKETS = [0, 1, 2, 3, 4, 5, 6, 7];
const bucketLabel = (b) => (b === 7 ? "7+" : String(b));
const clampBucket = (b) => Math.min(7, Math.max(0, Math.floor(b)));
const MAX_BASICS = 40;
const clampBasics = (v) => Math.min(MAX_BASICS, Math.max(0, Math.floor(Number(v)) || 0));

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
    // Manual mana-value filing (e.g. Shriekmaw shown as a 2-drop for its
    // evoke cost): per-name column bucket 0–7 overriding cmcBucket.
    cmc_overrides: {},
    basics: { Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 },
    speculative: [],
    lost: [],
    // Pool counts as of the last reconcile, so pool GROWTH (a new pick) can
    // absorb a speculative copy without eating deliberate "one real + one
    // spec" holdings of a duplicated name. null = never reconciled.
    pool_counts: null,
    updated_at: "",
  };
}

// Rebuild a full state object from parsed JSON (localStorage, an undo
// snapshot, or a share payload). Copies every container so no caller can
// alias the source. Share payloads are UNTRUSTED (anyone can craft a URL
// fragment), so every container is shape-checked — a truthy non-array
// `speculative` must degrade to [], never throw — and the name lists are
// capped so a crafted link cannot flood the DOM.
const NAME_LIST_CAP = 500;

function plainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function nameList(v) {
  return (Array.isArray(v) ? v : [])
    .filter((n) => typeof n === "string")
    .slice(0, NAME_LIST_CAP);
}

function reviveState(parsed) {
  const base = freshState();
  return {
    ...base,
    version: STATE_VERSION,
    updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : "",
    sideboard: { ...plainObject(parsed.sideboard) },
    pile_overrides: { ...plainObject(parsed.pile_overrides) },
    cmc_overrides: { ...plainObject(parsed.cmc_overrides) },
    basics: { ...base.basics, ...plainObject(parsed.basics) },
    speculative: nameList(parsed.speculative),
    lost: nameList(parsed.lost),
    pool_counts: parsed.pool_counts && typeof parsed.pool_counts === "object" ? parsed.pool_counts : null,
  };
}

function loadState(who) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + who);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    // Unknown versions are discarded wholesale, never partially applied.
    if (parsed?.version !== STATE_VERSION) return freshState();
    return reviveState(parsed);
  } catch {
    return freshState();
  }
}

function saveState() {
  if (readOnly) return;
  state.updated_at = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_PREFIX + player, JSON.stringify(state));
  } catch {
    // Storage full/blocked: the build keeps working, it just won't persist.
  }
}

// ── Undo ──
// Snapshots are pushed by every mutation entry point BEFORE it touches
// state (commit() runs after the mutation, too late to capture "before").
const undoStack = [];

function pushUndo() {
  if (readOnly) return;
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > UNDO_CAP) undoStack.shift();
}

function undo() {
  if (readOnly || !undoStack.length) return;
  // Same staleness precaution as the player-change handler: a popover
  // opened on the pre-undo board must not act on the reverted state.
  closePopover();
  state = reviveState(JSON.parse(undoStack.pop()));
  commit();
}

function countBy(names) {
  const out = new Map();
  for (const n of names) out.set(n, (out.get(n) || 0) + 1);
  return out;
}

// Speculation lifecycle + storage hygiene. Runs on every commit. Everything
// here is COUNT-based, never presence-based: the cube can list the same name
// twice (Explore), so a player can legitimately hold one real and one
// speculative copy at once. Per speculative copy, in order:
//   1. pool GROWTH since the last reconcile absorbs it (it became real) —
//      growth, not raw pool count, so an owned copy never eats a deliberate
//      extra speculation;
//   2. a copy still in the remaining pool justifies keeping it;
//   3. otherwise someone else drafted it — marked lost, sticky until
//      dismissed.
// Exported pure (all inputs explicit) so it can be exercised with synthetic
// draft states from the browser console / preview harness.
export function reconcileState(state, poolNames, remainingNames) {
  const poolCounts = countBy(poolNames);
  const remainingCounts = countBy(remainingNames);
  const prevPool = state.pool_counts; // null = never reconciled: no growth

  const stillSpec = [];
  const budget = new Map(); // name -> { absorb, keep } remaining allowances
  for (const name of state.speculative) {
    if (!budget.has(name)) {
      const growth =
        prevPool === null
          ? 0
          : Math.max(0, (poolCounts.get(name) || 0) - (prevPool[name] || 0));
      budget.set(name, { absorb: growth, keep: remainingCounts.get(name) || 0 });
    }
    const b = budget.get(name);
    if (b.absorb > 0) {
      b.absorb -= 1; // became real
    } else if (b.keep > 0) {
      b.keep -= 1;
      stillSpec.push(name);
    } else if (!state.lost.includes(name)) {
      state.lost.push(name);
    }
  }
  state.speculative = stillSpec;
  state.lost = state.lost.filter((n) => !poolCounts.has(n));
  state.pool_counts = Object.fromEntries(poolCounts);

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
  for (const [name, bucket] of Object.entries(state.cmc_overrides || {})) {
    // typeof check first: null/""/false would COERCE to bucket 0 through
    // Math.floor and silently file a card as a 0-drop.
    if (!owned.has(name) || typeof bucket !== "number" || !Number.isFinite(bucket)) {
      delete state.cmc_overrides[name];
    } else {
      state.cmc_overrides[name] = clampBucket(bucket);
    }
  }
  for (const name of Object.keys(state.basics)) {
    if (!BASICS.includes(name)) delete state.basics[name];
    // The upper clamp here is load-bearing: it bounds every downstream loop
    // (landColourSets, deckNamesForHand, basicRow) against a crafted share
    // payload like {basics: {Plains: 1e12}}, and caps the +stepper too.
    else state.basics[name] = Math.min(MAX_BASICS, Math.max(0, Math.floor(state.basics[name]) || 0));
  }
}

function reconcile() {
  reconcileState(state, draft.pools[player] || [], draft.remaining || []);
}

function naturalPile(card) {
  return primaryType(card) === "Creature" ? "creature" : "noncreature";
}

function pileFor(entry) {
  return state.pile_overrides[entry.name] || naturalPile(entry.card);
}

// Effective mana-value bucket: the user's manual filing wins (Shriekmaw as
// a 2-drop), otherwise the card's real mana value.
function bucketFor(entry) {
  const o = state.cmc_overrides[entry.name];
  return o === undefined ? cmcBucket(entry.card) : o;
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
  const columns = BUCKETS.map((n) => ({
    bucket: n,
    label: bucketLabel(n),
    creatures: spells.filter((e) => bucketFor(e) === n && pileFor(e) === "creature").sort(byColourThenName),
    noncreatures: spells
      .filter((e) => bucketFor(e) === n && pileFor(e) === "noncreature")
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
  return `<div class="rd-card${specCls}" draggable="${readOnly ? "false" : "true"}" tabindex="0" role="button"
      aria-label="${esc(label)}" aria-haspopup="menu"
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
  // clampBasics at the sink: reconcile guarantees a bounded number today,
  // but this value reaches innerHTML — keep the guarantee local.
  const n = clampBasics(state.basics[name]);
  const count = readOnly
    ? `<span class="rd-basic-count">${n}</span>`
    : `<input type="number" class="rd-basic-count" value="${n}" min="0" max="${MAX_BASICS}"
         inputmode="numeric" aria-label="${esc(name)}" />`;
  const step = (d, sign) =>
    readOnly
      ? ""
      : `<button type="button" class="rd-step" data-step="${d}" aria-label="${sign}1 ${esc(name)}">${sign}</button>`;
  return `<div class="rd-basic" data-basic="${esc(name)}">
      <img src="${esc(card?.img_small || "")}" alt="${esc(name)}" title="${esc(name)}" loading="lazy" draggable="false" />
      <div class="rd-stepper">
        ${step(-1, "−")}
        ${count}
        ${step(1, "+")}
      </div>
    </div>`;
}

function renderColumns(boards) {
  const cols = boards.columns
    .map(
      (c) => `<div class="rd-col">
        <div class="rd-col-head">${esc(c.label)}<span class="rd-col-count">· ${c.creatures.length + c.noncreatures.length}</span></div>
        ${pileHtml(c.bucket, "creature", c.creatures)}
        ${pileHtml(c.bucket, "noncreature", c.noncreatures)}
      </div>`,
    )
    .join("");

  const landTiles = boards.lands.length
    ? boards.lands.map((e) => cardTile(e, "deck")).join("")
    : "";
  const landsCol = `<div class="rd-col rd-lands" data-lands>
      <div class="rd-col-head">${esc(S.rotisserie_deck_lands)}<span class="rd-col-count">· ${boards.counts.lands}</span></div>
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
  // Informational targets, never enforcement: 40 cards, ~17 lands.
  const totalCls = c.total === DECK_TARGET ? "rd-target-ok" : c.total > DECK_TARGET ? "rd-target-over" : "";
  els.counts.innerHTML = `
    <span>${esc(S.rotisserie_deck_total)}: <strong class="${totalCls}">${c.total}</strong><span class="rd-target"> / ${DECK_TARGET}</span></span>
    <span>${esc(S.rotisserie_deck_creatures)}: <strong>${c.creatures}</strong></span>
    <span>${esc(S.rotisserie_deck_lands)}: <strong>${c.lands}</strong> <span class="rd-target">${esc(S.rotisserie_deck_lands_hint)}</span></span>
    <span>${esc(S.rotisserie_deck_sideboard)}: <strong>${c.side}</strong></span>`;
  if (els.undoBtn) els.undoBtn.disabled = !undoStack.length;
  // Under 7 cards a sample hand is meaningless; a dead-looking button is
  // worse than a disabled one.
  if (els.handBtn) els.handBtn.disabled = c.total < 7;
}

// ── Mana odds ──
const BASIC_COLOURS = { Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G" };
const WUBRG = ["W", "U", "B", "R", "G"];
const MAX_TURN = 6;

// Per-land colour capability among the deck's lands (drafted lands +
// basics): one Set of WUBRG colours per land, basics expanded by count.
// Exported pure for console testing. A TYPED fetch (Flooded Strand) can
// reach every colour producible through its fetchable types — including
// the off-type colours of typed duals (fetching Steam Vents via "Mountain"
// also yields U). A basics-only fetch (Fabled Passage) reaches only colours
// of basics actually in the deck. basicsCounts is a plain {Plains: n, ...}.
export function landColourSets(landCards, basicsCounts) {
  const sets = [];
  for (const [basic, n] of Object.entries(basicsCounts)) {
    const colour = BASIC_COLOURS[basic];
    if (!colour) continue;
    for (let i = 0; i < Math.max(0, n); i++) sets.push(new Set([colour]));
  }

  const producers = landCards.filter((c) => !(c?.fetch_types || []).length);
  for (const card of producers) {
    sets.push(new Set((card?.produced_mana || []).filter((c) => WUBRG.includes(c))));
  }

  // Per basic type: every colour a fetched land of that type could produce.
  const reachColours = {};
  for (const [type, colour] of Object.entries(BASIC_COLOURS)) {
    const set = new Set();
    if ((basicsCounts[type] || 0) > 0) set.add(colour);
    for (const card of producers) {
      if ((card?.type_line || "").includes(type)) {
        for (const c of card?.produced_mana || []) {
          if (WUBRG.includes(c)) set.add(c);
        }
      }
    }
    reachColours[type] = set;
  }

  for (const card of landCards) {
    const fetchable = card?.fetch_types || [];
    if (!fetchable.length) continue;
    const colours = new Set();
    for (const type of fetchable) {
      if (card.fetch_basics_only) {
        if ((basicsCounts[type] || 0) > 0) colours.add(BASIC_COLOURS[type]);
      } else {
        for (const c of reachColours[type]) colours.add(c);
      }
    }
    sets.push(colours);
  }
  return sets;
}

// Colour source counts (a land with {R,G} counts once for each) — the
// mono-colour rows' "have" numbers. Kept as the sum over landColourSets so
// the joint model below can never disagree with the displayed counts.
export function manaSources(landCards, basicsCounts) {
  const counts = Object.fromEntries(WUBRG.map((c) => [c, 0]));
  for (const set of landColourSets(landCards, basicsCounts)) {
    for (const c of set) counts[c] += 1;
  }
  return counts;
}

// Float binomial: exact integers up to C(60,30) ≈ 1.2e17 are represented
// with ~1e-15 relative error in doubles — far below display precision.
function comb(n, k) {
  if (k < 0 || k > n) return 0;
  const m = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < m; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

// Karsten-2022 castability: P(≥pips colour sources among cards seen by
// `turn` on the play | ≥turn lands seen). Sources are a subset of lands.
// Returns 0 when the conditioning event is impossible (e.g. lands < turn).
export function castProbability(deckSize, lands, sources, pips, turn) {
  const N = Math.floor(deckSize);
  if (N <= 0 || pips <= 0 || turn < pips) return 0;
  const L = Math.min(Math.floor(lands), N);
  const K = Math.min(Math.floor(sources), L);
  const n = Math.min(7 + turn - 1, N);
  let den = 0;
  for (let j = turn; j <= Math.min(L, n); j++) den += comb(L, j) * comb(N - L, n - j);
  if (den <= 0) return 0;
  let num = 0;
  for (let s = pips; s <= Math.min(K, n); s++) {
    for (let l = Math.max(0, turn - s); l <= Math.min(L - K, n - s); l++) {
      num += comb(K, s) * comb(L - K, l) * comb(N - L, n - s - l);
    }
  }
  return num / den;
}

// Joint multicolour castability: P(the drawn lands can pay every coloured
// pip of e.g. {R}{G} by `turn`, on the play | ≥turn lands seen). Each land
// taps once, so duals are a matching problem, not a double count: payability
// of a draw is decided by Hall's condition — for every subset T of the
// required colours, pips(T) ≤ #drawn lands producing at least one colour in
// T. Lands are grouped into classes by which required colours they produce
// (a Stomping Ground is one "RG" land), and the draw distribution is the
// multivariate hypergeometric over those classes + other lands + non-lands,
// conditioned exactly like castProbability. landSets = landColourSets(...).
export function castProbabilityJoint(deckSize, landSets, pipCounts, turn) {
  const N = Math.floor(deckSize);
  const colours = WUBRG.filter((c) => (pipCounts[c] || 0) > 0);
  const totalPips = colours.reduce((s, c) => s + pipCounts[c], 0);
  if (N <= 0 || totalPips <= 0 || turn < totalPips) return 0;
  if (colours.length === 1) {
    const c = colours[0];
    const have = landSets.filter((s) => s.has(c)).length;
    return castProbability(N, landSets.length, have, pipCounts[c], turn);
  }

  const L = Math.min(landSets.length, N);
  const n = Math.min(7 + turn - 1, N);

  // Class = bitmask over `colours` of what the land can produce (0 = a land
  // producing none of them). classCounts[mask] = how many such lands.
  const classCounts = new Array(1 << colours.length).fill(0);
  for (const set of landSets) {
    let mask = 0;
    colours.forEach((c, i) => {
      if (set.has(c)) mask |= 1 << i;
    });
    classCounts[mask] += 1;
  }

  // Hall's condition per colour-subset T: demand(T) ≤ supply(T).
  const nMasks = classCounts.length;
  const demands = [];
  for (let T = 1; T < nMasks; T++) {
    let d = 0;
    colours.forEach((c, i) => {
      if (T & (1 << i)) d += pipCounts[c];
    });
    demands.push({ T, d });
  }
  const feasible = (drawn) => {
    for (const { T, d } of demands) {
      let supply = 0;
      for (let mask = 1; mask < nMasks; mask++) {
        if (mask & T) supply += drawn[mask];
      }
      if (supply < d) return false;
    }
    return true;
  };

  let den = 0;
  for (let l = turn; l <= Math.min(L, n); l++) den += comb(L, l) * comb(N - L, n - l);
  if (den <= 0) return 0;

  // Enumerate class draws recursively; counts are tiny (n ≤ 12, ≤8 classes).
  let num = 0;
  const drawn = new Array(nMasks).fill(0);
  const rec = (idx, landsSoFar, weight) => {
    if (idx === nMasks) {
      if (landsSoFar >= turn && n - landsSoFar <= N - L && feasible(drawn)) {
        num += weight * comb(N - L, n - landsSoFar);
      }
      return;
    }
    const maxHere = Math.min(classCounts[idx], n - landsSoFar);
    for (let x = 0; x <= maxHere; x++) {
      drawn[idx] = x;
      rec(idx + 1, landsSoFar + x, weight * comb(classCounts[idx], x));
    }
    drawn[idx] = 0;
  };
  rec(0, 0, 1);
  return num / den;
}

// Karsten's consistency target: 89+turn % (90% at T1 … 95% at T6).
export function karstenTarget(turn) {
  return (89 + Math.min(turn, MAX_TURN)) / 100;
}

// Smallest source count reaching the target (turn is already capped at
// MAX_TURN by pipRequirements), or null when even all-lands-of-this-colour
// falls short.
export function sourcesNeeded(deckSize, lands, pips, turn) {
  const threshold = karstenTarget(turn);
  for (let K = pips; K <= lands; K++) {
    if (castProbability(deckSize, lands, K, pips, turn) >= threshold) return K;
  }
  return null;
}

// Coloured pips of a card's front-face cost. Hybrid and {X} symbols are
// not pure pips and don't count (stated simplification in the panel note).
function costPips(card) {
  const cost = String(card?.mana_cost || "").split(" // ")[0];
  const pipCounts = {};
  for (const m of cost.matchAll(/\{([WUBRG])\}/g)) {
    pipCounts[m[1]] = (pipCounts[m[1]] || 0) + 1;
  }
  return pipCounts;
}

// The deck's actual colour requirements: for each colour, each distinct
// same-colour pip count k among spell costs, at the earliest turn the deck
// wants it — t = clamp(max(mv, k), ·, MAX_TURN). Spells arrive as
// {card, mv} pairs so a manual column filing (Shriekmaw as a 2-drop)
// moves its requirement to the earlier turn too.
export function pipRequirements(spells) {
  const reqs = Object.fromEntries(WUBRG.map((c) => [c, {}]));
  for (const { card, mv } of spells) {
    const pipCounts = costPips(card);
    for (const [colour, k] of Object.entries(pipCounts)) {
      const t = Math.min(Math.max(Math.floor(mv), k), MAX_TURN);
      const cur = reqs[colour][k];
      reqs[colour][k] = cur === undefined ? t : Math.min(cur, t);
    }
  }
  return reqs;
}

// Multicolour requirements: one row per distinct coloured-cost signature
// spanning ≥2 colours (e.g. {R}{G}, or {R}{R}{G}), at the earliest turn any
// spell with that signature wants it. Same mv/turn conventions as above.
export function jointPipRequirements(spells) {
  const bySig = new Map();
  for (const { card, mv } of spells) {
    const pipCounts = costPips(card);
    const colours = WUBRG.filter((c) => pipCounts[c]);
    if (colours.length < 2) continue;
    const totalPips = colours.reduce((s, c) => s + pipCounts[c], 0);
    const t = Math.min(Math.max(Math.floor(mv), totalPips), MAX_TURN);
    const key = colours.map((c) => `${c}${pipCounts[c]}`).join("");
    const cur = bySig.get(key);
    if (cur === undefined) bySig.set(key, { key, pips: { ...pipCounts }, turn: t });
    else cur.turn = Math.min(cur.turn, t);
  }
  return [...bySig.values()].sort((a, b) => a.turn - b.turn || a.key.localeCompare(b.key));
}

function renderMana(boards) {
  const landCards = boards.lands.map((e) => e.card);
  const landSets = landColourSets(landCards, state.basics);
  const sources = manaSources(landCards, state.basics);
  // Spells carry their EFFECTIVE mana value — the column they're filed in —
  // so a manual filing moves the requirement's turn with it.
  const spells = boards.columns.flatMap((c) =>
    [...c.creatures, ...c.noncreatures].map((e) => ({ card: e.card, mv: c.bucket })),
  );
  const reqs = pipRequirements(spells);
  const joint = jointPipRequirements(spells);

  const rows = [];
  for (const colour of WUBRG) {
    const ks = Object.keys(reqs[colour]).map(Number).sort((a, b) => a - b);
    for (const k of ks) rows.push({ colour, pips: k, turn: reqs[colour][k] });
  }
  if (!rows.length) {
    els.mana.hidden = true;
    return;
  }

  const N = boards.counts.total;
  const L = boards.counts.lands;
  const pipFor = Object.fromEntries(COLOUR_GROUPS.map((g) => [g.key, g.pip]));
  const monoBody = rows
    .map(({ colour, pips, turn }) => {
      const have = sources[colour];
      const needed = sourcesNeeded(N, L, pips, turn);
      const feasible = N > 0 && L >= turn;
      const p = castProbability(N, L, have, pips, turn);
      const pct = feasible ? `${Math.round(p * 100)}%` : "—";
      const neededLabel = needed === null ? `${L}+` : String(needed);
      const ok = needed !== null && have >= needed;
      const badge = ok ? "✓" : needed === null ? "!" : `−${needed - have}`;
      const icons = `<i class="ms ${pipFor[colour]}" aria-hidden="true"></i>`.repeat(pips);
      return `<tr class="${ok ? "rd-mana-ok" : "rd-mana-short"}">
          <td>${icons} <span class="rd-mana-k">${esc(S.rotisserie_deck_mana_turn_prefix)}${turn}</span></td>
          <td>${pct}</td>
          <td>${have}/${neededLabel} ${esc(S.rotisserie_deck_sources)}</td>
          <td class="rd-mana-badge">${badge}</td>
        </tr>`;
    })
    .join("");

  // Joint rows: multicolour costs (duals tap once — a matching model, so
  // there is no single "needed" count; the row shows the exact probability).
  const jointBody = joint
    .map(({ pips, turn }) => {
      const feasible = N > 0 && L >= turn;
      const p = castProbabilityJoint(N, landSets, pips, turn);
      const pct = feasible ? `${Math.round(p * 100)}%` : "—";
      const ok = feasible && p >= karstenTarget(turn);
      const icons = WUBRG.filter((c) => pips[c])
        .map((c) => `<i class="ms ${pipFor[c]}" aria-hidden="true"></i>`.repeat(pips[c]))
        .join("");
      return `<tr class="${ok ? "rd-mana-ok" : "rd-mana-short"}">
          <td>${icons} <span class="rd-mana-k">${esc(S.rotisserie_deck_mana_turn_prefix)}${turn}</span></td>
          <td>${pct}</td>
          <td class="rd-mana-joint-note">${esc(S.rotisserie_deck_mana_joint)}</td>
          <td class="rd-mana-badge">${ok ? "✓" : "!"}</td>
        </tr>`;
    })
    .join("");

  // Untouched builds (whole pool, no basics) drown the panel in red: keep
  // it collapsed until building has started, and preserve the user's toggle
  // across re-renders after that.
  const started =
    BASICS.some((b) => (state.basics[b] || 0) > 0) ||
    Object.keys(state.sideboard).length > 0 ||
    state.speculative.length > 0;
  const existing = els.mana.querySelector("details");
  const open = (existing ? existing.open : started) ? " open" : "";

  els.mana.hidden = false;
  els.mana.innerHTML = `<details class="rd-mana-details"${open}>
    <summary>
      <span class="rd-mana-title">${esc(S.rotisserie_deck_mana_title)}</span>
      <span class="rd-mana-note">${esc(S.rotisserie_deck_mana_note)}</span>
    </summary>
    <table><tbody>${monoBody}${jointBody}</tbody></table>
  </details>`;
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

  els.cmcFilters.innerHTML = BUCKETS.map(
    (n) =>
      `<button type="button" class="rot-cmc-btn" data-cmc="${n}"
         aria-pressed="false">${bucketLabel(n)}</button>`,
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

// Manual mana-value filing (Shriekmaw in the 2-column for its evoke cost).
function setCol(name, bucket) {
  const card = cards[name];
  if (colourGroup(card) === "LAND") return; // lands live in their own column
  const b = clampBucket(bucket);
  if (cmcBucket(card) === b) delete state.cmc_overrides[name];
  else state.cmc_overrides[name] = b;
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
  // Entry points snapshot BEFORE mutating, so a no-op interaction (a card
  // dropped back where it was) would burn an undo level on an identical
  // snapshot; discard it. String compare is exact when nothing changed —
  // key order is preserved because nothing was touched.
  if (undoStack.length && undoStack[undoStack.length - 1] === JSON.stringify(state)) {
    undoStack.pop();
  }
  saveState();
  render();
}

// ── Popover ──
let popoverOpener = null;

function popoverActions(tile) {
  const name = tile.dataset.name;
  const zone = tile.dataset.zone;
  const spec = tile.classList.contains("rd-spec");
  const isLand = colourGroup(cards[name]) === "LAND";
  const actions = [];
  if (!readOnly) {
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
  }
  actions.push({ act: "enlarge", label: S.rotisserie_deck_enlarge });
  return actions;
}

// Mini column picker inside the popover — the no-drag path for manual
// mana-value filing. Only for non-land deck cards.
function popoverColsHtml(tile) {
  const name = tile.dataset.name;
  if (readOnly || tile.dataset.zone !== "deck") return "";
  const card = cards[name];
  if (colourGroup(card) === "LAND") return "";
  const current = bucketFor({ name, card });
  const natural = cmcBucket(card);
  const buttons = BUCKETS.map((b) => {
    const label = bucketLabel(b);
    const cls = b === current ? ' class="rd-col-pick-on"' : "";
    const mark = b === natural ? ` title="MV ${label}"` : "";
    return `<button type="button" data-col="${b}"${cls}${mark} aria-pressed="${b === current}">${label}</button>`;
  }).join("");
  return `<div class="rd-popover-cols" role="group" aria-label="${esc(S.rotisserie_deck_move_col)}">
      <span class="rd-popover-cols-label">${esc(S.rotisserie_deck_move_col)}</span>
      <div class="rd-popover-cols-row">${buttons}</div>
    </div>`;
}

function openPopover(tile, x, y) {
  const actions = popoverActions(tile);
  els.popover.innerHTML =
    actions
      .map((a) => `<button type="button" role="menuitem" data-act="${a.act}">${esc(a.label)}</button>`)
      .join("") + popoverColsHtml(tile);
  els.popover.dataset.name = tile.dataset.name;
  els.popover.dataset.zone = tile.dataset.zone;
  els.popover.hidden = false;
  hideHover();
  const rect = els.popover.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  els.popover.style.left = `${Math.max(8, left)}px`;
  els.popover.style.top = `${Math.max(8, top)}px`;
  popoverOpener = tile;
  els.popover.querySelector("button")?.focus();
}

function closePopover() {
  if (els.popover.hidden) return;
  const hadFocus = els.popover.contains(document.activeElement);
  els.popover.hidden = true;
  // Only pull focus back when the popover actually held it (closing via an
  // outside click must not yank the viewport to the opener tile).
  if (hadFocus && popoverOpener?.isConnected) popoverOpener.focus();
  popoverOpener = null;
}

function runAction(act, name) {
  if (act === "enlarge") {
    openLightbox(name);
    return; // no state change
  }
  if (readOnly) return;
  pushUndo();
  if (act === "to-side") moveToSide(name);
  else if (act === "to-deck") moveToDeck(name);
  else if (act === "switch-pile") switchPile(name);
  else if (act === "add-spec") addSpeculative(name);
  else if (act === "remove-spec") {
    removeSpeculative(name);
    delete state.sideboard[name];
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

// ── Hover preview (desktop) ──
// Full-card image following the pointer over any tile — the stacks only
// show name bars, and cut decisions mean reading cards constantly. Mouse
// pointers only; touch keeps the popover's "Skoða spil".
const FINE_POINTER = window.matchMedia?.("(pointer: fine)").matches ?? false;
let hoverTimer = null;

function hideHover() {
  clearTimeout(hoverTimer);
  hoverTimer = null;
  if (els.hover) els.hover.hidden = true;
}

function showHover(tile) {
  const card = cards[tile.dataset.name];
  if (!card?.img_normal || !els.popover.hidden || !els.lightbox.hidden) return;
  const img = els.hover.querySelector("img");
  if (img.src !== card.img_normal) img.src = card.img_normal;
  img.alt = card.name || tile.dataset.name;
  els.hover.hidden = false;
  const rect = tile.getBoundingClientRect();
  const box = els.hover.getBoundingClientRect();
  // Prefer the right side of the tile; fall back to the left; clamp to the
  // viewport vertically.
  let left = rect.right + 12;
  if (left + box.width > window.innerWidth - 8) left = rect.left - box.width - 12;
  const top = Math.max(8, Math.min(rect.top, window.innerHeight - box.height - 8));
  els.hover.style.left = `${Math.max(8, left)}px`;
  els.hover.style.top = `${top}px`;
}

function initHoverPreview() {
  if (!FINE_POINTER || !els.hover) return;
  document.addEventListener("mouseover", (ev) => {
    const tile = ev.target.closest?.(".rd-card, .rd-hand-card");
    if (!tile || !tile.dataset.name) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => showHover(tile), 100);
  });
  document.addEventListener("mouseout", (ev) => {
    if (ev.target.closest?.(".rd-card, .rd-hand-card")) hideHover();
  });
  document.addEventListener("dragstart", hideHover);
  document.addEventListener("scroll", hideHover, true);
}

// ── Share links ──
// The whole user state fits in the URL fragment, so a deck built at home
// reaches game night (or the group chat) with zero backend: the viewer
// derives the deck from the LIVE pool plus the shared state, read-only.
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(b64) {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function shareUrl() {
  const payload = { v: 1, p: player, st: state };
  return `${location.origin}/rotisserie/deck#share=${b64urlEncode(JSON.stringify(payload))}`;
}

function parseShareHash() {
  const m = location.hash.match(/^#share=(.+)$/);
  if (!m) return null;
  try {
    const payload = JSON.parse(b64urlDecode(m[1]));
    if (payload?.v !== 1 || typeof payload.p !== "string") return null;
    // The inner state carries the same version guard as localStorage:
    // unknown versions are rejected wholesale, never partially applied.
    const st = payload.st;
    if (!st || typeof st !== "object" || Array.isArray(st) || st.version !== STATE_VERSION) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Sample hand ──
// Deal from the current deck (spells + drafted lands + basics). Casual
// mulligan practice: each mulligan deals one card fewer.
const hand = { library: [], size: 7, drawn: 0 };

function deckNamesForHand() {
  const boards = deriveBoards();
  const names = [
    ...boards.columns.flatMap((c) => [...c.creatures, ...c.noncreatures]).map((e) => e.name),
    ...boards.lands.map((e) => e.name),
  ];
  for (const basic of BASICS) {
    for (let i = 0; i < (state.basics[basic] || 0); i++) names.push(basic);
  }
  return names;
}

function shuffleHand(size, names = deckNamesForHand()) {
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  hand.library = names;
  hand.size = size;
  hand.drawn = Math.min(size, names.length);
}

function renderHand() {
  const title = els.hand.querySelector(".rd-hand-title");
  const grid = els.hand.querySelector(".rd-hand-grid");
  const mull = els.hand.querySelector('[data-hand="mulligan"]');
  title.textContent = `${S.rotisserie_deck_hand_title} (${hand.drawn}/${hand.library.length})`;
  mull.disabled = hand.size <= 1;
  grid.innerHTML = hand.library
    .slice(0, hand.drawn)
    .map((name) => {
      const card = cards[name];
      const label = card?.name || name;
      return card?.img_small
        ? `<img class="rd-hand-card" src="${esc(card.img_small)}" alt="${esc(label)}"
             title="${esc(label)}" data-name="${esc(name)}" draggable="false" />`
        : `<span class="rot-card-missing rd-hand-card" data-name="${esc(name)}">${esc(label)}</span>`;
    })
    .join("");
}

function openHand() {
  const names = deckNamesForHand();
  if (names.length < 7) return; // button is disabled below 7; belt and braces
  shuffleHand(7, names);
  els.hand.hidden = false;
  renderHand();
}

function closeHand() {
  if (els.hand.hidden) return;
  els.hand.hidden = true;
  hideHover();
}

function initHand() {
  if (!els.hand || !els.handBtn) return;
  els.handBtn.addEventListener("click", openHand);
  els.hand.addEventListener("click", (ev) => {
    const btn = ev.target.closest?.("button[data-hand]");
    if (btn) {
      const act = btn.dataset.hand;
      if (act === "close") closeHand();
      else if (act === "new") shuffleHand(7);
      else if (act === "mulligan") shuffleHand(Math.max(1, hand.size - 1));
      else if (act === "draw") hand.drawn = Math.min(hand.drawn + 1, hand.library.length);
      if (act !== "close") renderHand();
      return;
    }
    // Backdrop click closes; clicks on the dialog body don't.
    if (ev.target === els.hand) closeHand();
  });
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
    if (pile) return { kind: "pile", pile: pile.dataset.pile, col: Number(pile.dataset.col), el: pile };
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

  // A cancelled drag (Escape, or released outside every zone) fires no drop,
  // so the highlight must also be cleared on dragend or it sticks to the
  // persistent containers (#rd-side, #rd-available) across re-renders.
  document.addEventListener("dragend", () => {
    if (highlighted) highlighted.classList.remove("rd-drop-over");
    highlighted = null;
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

    pushUndo();
    if (from === "avail") {
      // Any drop from the available browser adds the card as a speculative
      // pick; it files itself by mana value unless dropped on a column.
      if (zone.kind !== "avail") {
        addSpeculative(name);
        if (zone.kind === "pile") {
          setPile(name, zone.pile);
          setCol(name, zone.col);
        }
      }
    } else if (zone.kind === "pile") {
      if (from === "side") moveToDeck(name);
      setPile(name, zone.pile);
      // Dropping on another column's pile also refiles the mana value
      // (Shriekmaw dragged to the 2-column for its evoke cost).
      setCol(name, zone.col);
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

    const colBtn = ev.target.closest?.("#rd-popover button[data-col]");
    if (colBtn) {
      if (!readOnly) {
        pushUndo();
        setCol(els.popover.dataset.name, Number(colBtn.dataset.col));
        commit();
      }
      closePopover();
      return;
    }

    const step = ev.target.closest?.(".rd-step");
    if (step) {
      if (readOnly) return;
      const basic = step.closest(".rd-basic");
      const name = basic.dataset.basic;
      const input = basic.querySelector("input.rd-basic-count");
      // Absorb any uncommitted typed value (and cancel its pending commit):
      // the blur-driven change event fires between mousedown and this click.
      clearTimeout(input?._commit);
      const base = input ? clampBasics(input.value) : state.basics[name] || 0;
      pushUndo();
      state.basics[name] = clampBasics(base + Number(step.dataset.step));
      commit();
      return;
    }

    const dismiss = ev.target.closest?.(".rd-dismiss");
    if (dismiss) {
      if (readOnly) return;
      pushUndo();
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

    if (ev.target.closest?.("#rd-popover")) return;
    closePopover();
    closeLightbox();
  });

  // Typed basic-land counts (bulk entry beats 17 stepper clicks). The
  // commit is deferred one tick: committing inside the blur-driven change
  // event re-renders the columns BETWEEN mousedown and mouseup of a stepper
  // click, destroying the button so the click never fires (verified live).
  // Deferring lets the click land first; the stepper handler absorbs the
  // typed value and cancels this timer.
  document.addEventListener("change", (ev) => {
    const input = ev.target.closest?.("input.rd-basic-count");
    if (!input || readOnly) return;
    const name = input.closest(".rd-basic").dataset.basic;
    const forPlayer = player;
    clearTimeout(input._commit);
    input._commit = setTimeout(() => {
      if (player !== forPlayer) return; // typed under the previous player
      pushUndo();
      state.basics[name] = clampBasics(input.value);
      commit();
    }, 0);
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      closePopover();
      closeLightbox();
      closeHand();
      hideHover();
      return;
    }
    // Undo on the platform shortcut — but never while typing in a field.
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target?.tagName || "");
    if ((ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key.toLowerCase() === "z" && !typing) {
      ev.preventDefault();
      undo();
      return;
    }
    // Arrow keys walk the open popover's actions.
    if (!els.popover.hidden && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
      const buttons = [...els.popover.querySelectorAll("button")];
      const idx = buttons.indexOf(document.activeElement);
      if (idx >= 0) {
        ev.preventDefault();
        const next = ev.key === "ArrowDown" ? idx + 1 : idx - 1;
        buttons[(next + buttons.length) % buttons.length].focus();
      }
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

  els.undoBtn?.addEventListener("click", undo);

  els.player.addEventListener("change", () => {
    // A popover opened on the previous player's card must not act on the
    // new player's state (change can fire without a click, e.g. keyboard).
    closePopover();
    player = els.player.value;
    undoStack.length = 0; // snapshots belong to the previous player
    try {
      localStorage.setItem(LAST_PLAYER_KEY, player);
    } catch {
      // non-fatal
    }
    state = loadState(player);
    commit();
  });

  // Restore from the constant, not a captured textContent: a second click
  // during the feedback window would capture the ok-label as the label to
  // restore and stick the button there forever.
  const copyWithFeedback = async (btn, text, okLabel, idleLabel) => {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = okLabel;
      clearTimeout(btn._restore);
      btn._restore = setTimeout(() => {
        btn.textContent = idleLabel;
      }, 1500);
    } catch {
      window.prompt(idleLabel, text);
    }
  };

  els.exportBtn.addEventListener("click", () =>
    copyWithFeedback(els.exportBtn, exportText(), S.rotisserie_deck_exported, S.rotisserie_deck_export),
  );

  els.shareBtn?.addEventListener("click", () =>
    copyWithFeedback(els.shareBtn, shareUrl(), S.rotisserie_deck_shared, S.rotisserie_deck_share),
  );

  els.reset.addEventListener("click", () => {
    if (readOnly) return;
    if (!window.confirm(S.rotisserie_deck_reset_confirm)) return;
    pushUndo(); // a reset is a mutation like any other — Ctrl+Z brings it back
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
    // Annotation, not extra cards: speculative copies are already counted in
    // the deck/sideboard lines above, so listing them as "1 Name" again
    // would read as a longer list than the counts claim.
    const names = state.speculative.map((n) => cards[n]?.name || n);
    lines.push("", `${S.rotisserie_deck_spec_badge}: ${names.join(", ")}`);
  }
  return lines.join("\n");
}

// ── Render root ──
function render() {
  const boards = deriveBoards();
  renderCounts(boards);
  renderMana(boards);
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

// A share link renders someone's build read-only: their state from the URL,
// the deck derived from the live pool, no localStorage writes, no mutations.
function enterReadOnly(share) {
  readOnly = true;
  document.body.classList.add("rd-readonly");
  player = share.p;
  state = reviveState(share.st);
  els.player.innerHTML = `<option>${esc(player)}</option>`;
  els.player.disabled = true;
  const when = String(share.st.updated_at || "").slice(0, 10);
  els.banner.hidden = false;
  els.banner.innerHTML = `<span>${esc(S.rotisserie_deck_shared_banner)} <strong>${esc(player)}</strong>${
    when ? ` · ${esc(when)}` : ""
  }</span>
    <button type="button" id="rd-exit-share" class="rot-clear-btn">${esc(S.rotisserie_deck_shared_exit)}</button>`;
  document.getElementById("rd-exit-share").addEventListener("click", () => {
    location.hash = "";
    location.reload();
  });
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
    const share = parseShareHash();
    if (share && draft.players.includes(share.p)) {
      enterReadOnly(share);
    } else {
      // A #share= fragment that didn't parse (chat apps clip long URLs) must
      // not silently masquerade as the viewer's own editable builder.
      if (location.hash.startsWith("#share=")) {
        els.banner.hidden = false;
        els.banner.textContent = S.rotisserie_deck_shared_invalid;
      }
      buildPlayerSelect();
      state = loadState(player);
    }
    buildFilterControls();
    initInteractions();
    initHoverPreview();
    initHand();
    if (!readOnly) initDragAndDrop();
    commit();
  } catch (err) {
    console.error(err);
    els.counts.innerHTML = `<span>${esc(S.error)}</span>`;
  }
}

init();
