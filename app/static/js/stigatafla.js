// Stigatafla — per-table client search + sortable headers over the
// server-rendered .score-table panels. The cube-category panel toggle is
// Alpine (x-model in index.html); this module only wires search + sort.
// Tables are <= 24 rows, so plain DOM sorting is fine.

function wireTable(table) {
  const tbody = table.querySelector("tbody");
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll("tr"));
  const search = table.querySelector("[data-search]");

  // --- search: filter by data-player, locale/case-insensitive ---
  if (search) {
    search.addEventListener("input", () => {
      const q = search.value.trim().toLocaleLowerCase("is");
      for (const tr of rows) {
        const name = (tr.getAttribute("data-player") || "").toLocaleLowerCase(
          "is",
        );
        tr.style.display = !q || name.includes(q) ? "" : "none";
      }
    });
  }

  // --- sort: click a th.sortable, toggle asc/desc on its data-key ---
  const headers = Array.from(table.querySelectorAll("thead th.sortable"));
  let activeKey = null;
  let asc = true;

  headers.forEach((th, colIndex) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-key");
      if (activeKey === key) {
        asc = !asc;
      } else {
        activeKey = key;
        asc = true;
      }
      const sorted = rows.slice().sort((a, b) => {
        const av = a.children[colIndex].getAttribute("data-sort");
        const bv = b.children[colIndex].getAttribute("data-sort");
        const an = parseFloat(av);
        const bn = parseFloat(bv);
        let cmp;
        if (Number.isNaN(an) || Number.isNaN(bn)) {
          cmp = String(av).localeCompare(String(bv), "is");
        } else {
          cmp = an - bn;
        }
        return asc ? cmp : -cmp;
      });
      // reflect aria-sort for a11y; re-append in new order
      headers.forEach((h) => h.removeAttribute("aria-sort"));
      th.setAttribute("aria-sort", asc ? "ascending" : "descending");
      for (const tr of sorted) tbody.appendChild(tr);
    });
  });
}

function init() {
  document.querySelectorAll(".score-table").forEach(wireTable);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
