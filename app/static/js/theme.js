// Palette reader — reads MTG CSS custom properties for the CURRENT [data-theme].
// Call chartTheme() INSIDE each render() so a theme flip + re-render recolours.
export function chartTheme() {
  const root = document.documentElement;
  const dark = root.getAttribute("data-theme") === "dark";
  const css = getComputedStyle(root);
  const v = (name, fb) => css.getPropertyValue(name).trim() || fb;
  const text = v("--text-primary", dark ? "#e8e4dc" : "#2a1f14");
  return {
    dark,
    text,
    line: text, // ELO-diff line stroke = primary text colour
    muted: v("--text-muted", dark ? "#9a9590" : "#5c4f42"),
    grid: v("--chart-grid", dark ? "rgba(255,255,255,0.12)" : "#d4cfc9"),
    blue: v("--mtg-blue", dark ? "#3b9edd" : "#0e68ab"),
    green: v("--mtg-green", dark ? "#2ecc71" : "#00733e"),
    red: v("--mtg-red", dark ? "#e74c3c" : "#d3202a"),
    gold: v("--mtg-gold", dark ? "#d4a843" : "#c9a84c"),
    blueArea1: v("--chart-blue-area-1", dark ? "rgba(59,158,221,0.1)" : "rgba(14,104,171,0.12)"),
    blueArea2: v("--chart-blue-area-2", dark ? "rgba(59,158,221,0.2)" : "rgba(14,104,171,0.25)"),
    haloBg: dark ? "#1e1e26" : "#ffffff",
  };
}

// Tier → colour (parity: High=red, Medium=blue, Low=green, Other=gold).
export const TIER_ORDER = ["High", "Medium", "Low", "Other"];
export function tierColours(t) {
  return { High: t.red, Medium: t.blue, Low: t.green, Other: t.gold };
}
// Tier display label (Other → Annað).
export const TIER_LABEL = { High: "High", Medium: "Medium", Low: "Low", Other: "Annað" };

// Icelandic short-month tick formatter for time axes.
export function isMonth(d) {
  return d.toLocaleDateString("is-IS", { month: "short" });
}
